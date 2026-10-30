import request from "supertest";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/openai.js", () => ({
  proposeProcessChanges: vi.fn()
}));

vi.mock("../src/logging.js", () => ({
  logInteraction: vi.fn()
}));

import { app } from "../src/app.js";
import {
  parseCancellation
} from "../src/analysis/cancellation.js";
import {
  explainRejectedUpdate,
  planLaneRemovals
} from "../src/analysis/lane-edits.js";
import {
  generateBpmnXml,
  UNASSIGNED_LANE_ID
} from "../src/bpmn.js";
import {
  mapConformanceRunToDeviations
} from "../src/conformance/deviation-mapper.js";
import { proposeProcessChanges } from "../src/openai.js";
import {
  applyProcessChanges,
  ProcessValidationError
} from "../src/process.js";
import {
  createSession,
  getSession,
  updateSessionProcess,
  updateSessionState
} from "../src/store.js";
import {
  type ActivityMapping,
  type ConformanceRun,
  type DeviationCandidate,
  type LlmProcessResponse,
  type ProcessChanges,
  type ProcessModel
} from "../src/types.js";
import {
  changes,
  exportedAssignmentsMatch,
  idByName,
  laneDraft,
  laneIdByName,
  laneMembers,
  laneOf,
  linearProcess,
  turn
} from "./helpers/process-fixtures.js";

// ======================================================
// FIXTURES
// ======================================================

// start -> A (lane a) -> B (lane b) -> C (lane c) -> D (lane b) -> E (lane a)
function weavingProcess(
  names: [string, string, string, string, string],
  lanes: [string, string, string]
): ProcessModel {
  const base = linearProcess(names);

  return turn(
    base,
    changes({
      addLanes: [
        laneDraft("l_a", lanes[0]),
        laneDraft("l_b", lanes[1]),
        laneDraft("l_c", lanes[2])
      ],
      updateElements: [
        { id: "task_0", laneRef: "l_a" },
        { id: "task_1", laneRef: "l_b" },
        { id: "task_2", laneRef: "l_c" },
        { id: "task_3", laneRef: "l_b" },
        { id: "task_4", laneRef: "l_a" }
      ]
    })
  );
}

// start -> receive (lane a) -> check (lane b) -> gateway (lane b) -> end (lane b)
function claimProcess(
  laneA: string,
  laneB: string
): ProcessModel {
  const base =
    applyProcessChanges(
      linearProcess(["Receive claim"]),
      changes({
        addLanes: [
          laneDraft("l_a", laneA),
          laneDraft("l_b", laneB)
        ],
        updateElements: [
          { id: "task_0", laneRef: "l_a" }
        ],
        addElements: [
          {
            tempRef: "check",
            type: "task",
            name: "Check claim",
            laneRef: "l_b"
          },
          {
            tempRef: "gate",
            type: "exclusiveGateway",
            name: "Claim valid?",
            laneRef: "l_b"
          },
          {
            tempRef: "done",
            type: "end",
            name: "Claim closed",
            laneRef: "l_b"
          }
        ],
        addFlows: [
          { id: "f_check", fromRef: "task_0", toRef: "check" },
          { id: "f_gate", fromRef: "check", toRef: "gate" },
          { id: "f_done", fromRef: "gate", toRef: "done" }
        ]
      }),
      "setup"
    ).process;

  return base;
}

function llmResponse(
  proposed: ProcessChanges,
  assistantMessage = "Done."
): LlmProcessResponse {
  return {
    language: "en",
    intent: "process_description",
    assistantMessage,
    contextPatch: {},
    changes: proposed,
    uncertainties: [],
    nextQuestion: {
      required: false,
      kind: "clarification",
      targetRefs: [],
      question: ""
    },
    validationRequest: {
      required: false,
      elementIds: [],
      question: ""
    }
  };
}

function seedSession(
  process: ProcessModel,
  pending?: Parameters<typeof updateSessionState>[1]["pendingQuestion"]
): string {
  const session = createSession();

  updateSessionProcess(session.id, process);
  updateSessionState(session.id, {
    pendingQuestion: pending
  });

  return session.id;
}

async function send(
  sessionId: string,
  message: string
) {
  return request(app)
    .post(`/api/employee/sessions/${sessionId}/message`)
    .send({ message });
}

// ======================================================
// LANE REMOVAL
// ======================================================

describe("lane removal", () => {
  it("removes an empty lane and preserves the process", () => {
    const base =
      turn(
        linearProcess(["Pick parts", "Pack box"]),
        changes({
          addLanes: [
            laneDraft("l_a", "Falcon Cell"),
            laneDraft("l_b", "Mint Desk")
          ],
          updateElements: [
            { id: "task_0", laneRef: "l_a" },
            { id: "task_1", laneRef: "l_a" }
          ]
        })
      );

    const plan =
      planLaneRemovals(
        base,
        changes({
          removeLaneIds: [laneIdByName(base, "Mint Desk")]
        })
      );

    expect(plan.clarification).toBeUndefined();

    const result =
      applyProcessChanges(base, plan.changes, "x").process;

    expect(result.lanes.map((lane) => lane.name)).toEqual([
      "Falcon Cell"
    ]);
    expect(result.elements).toEqual(base.elements);
    expect(result.flows).toEqual(base.flows);
  });

  it("moves events and gateways of an occupied lane to the destination implied by the flow", () => {
    const base = claimProcess("Cedar Unit", "Opal Desk");
    const opal = laneIdByName(base, "Opal Desk");
    const cedar = laneIdByName(base, "Cedar Unit");

    const plan =
      planLaneRemovals(
        base,
        changes({ removeLaneIds: [opal] })
      );

    expect(plan.clarification).toBeUndefined();

    const result =
      applyProcessChanges(base, plan.changes, "x").process;

    expect(result.lanes.map((lane) => lane.id)).toEqual([cedar]);

    expect(
      result.elements.every(
        (element) => element.laneId === cedar
      )
    ).toBe(true);

    expect(
      result.elements.map((element) => element.id)
    ).toEqual(base.elements.map((element) => element.id));

    expect(result.flows).toEqual(base.flows);
    expect(exportedAssignmentsMatch(result)).toBe(true);

    const xml = generateBpmnXml(result);

    expect(xml).not.toContain(UNASSIGNED_LANE_ID);
    expect(laneMembers(xml, cedar)).toHaveLength(
      result.elements.length
    );
  });

  it("asks which lane the affected elements belong to when the destination is ambiguous", () => {
    const base =
      weavingProcess(
        ["Step A", "Step B", "Step C", "Step D", "Step E"],
        ["Ruby Team", "Teal Counter", "Slate Group"]
      );

    const plan =
      planLaneRemovals(
        base,
        changes({
          removeLaneIds: [laneIdByName(base, "Teal Counter")]
        })
      );

    expect(plan.clarification?.targetIds).toEqual([
      idByName(base, "Step B"),
      idByName(base, "Step D")
    ]);

    expect(plan.clarification?.question).toContain(
      '"Teal Counter"'
    );
    expect(plan.clarification?.question).toContain('"Step B"');
    expect(plan.clarification?.question).toContain('"Step D"');
  });

  it("reassigns referenced elements atomically when the user names the destination", () => {
    const base =
      weavingProcess(
        ["Intake", "Review", "Audit", "Rework", "Release"],
        ["Ruby Team", "Teal Counter", "Slate Group"]
      );

    const teal = laneIdByName(base, "Teal Counter");

    const plan =
      planLaneRemovals(
        base,
        changes({
          removeLaneIds: [teal],
          updateElements: [
            { id: idByName(base, "Review"), laneId: laneIdByName(base, "Slate Group") },
            { id: idByName(base, "Rework"), laneId: laneIdByName(base, "Ruby Team") }
          ]
        })
      );

    expect(plan.clarification).toBeUndefined();

    const result =
      applyProcessChanges(base, plan.changes, "x").process;

    expect(result.lanes.map((lane) => lane.name)).toEqual([
      "Ruby Team",
      "Slate Group"
    ]);
    expect(laneOf(result, "Review")).toBe(
      laneIdByName(result, "Slate Group")
    );
    expect(laneOf(result, "Rework")).toBe(
      laneIdByName(result, "Ruby Team")
    );
    expect(exportedAssignmentsMatch(result)).toBe(true);
  });

  it("does not remove a lane (or change anything) when the update is rejected", () => {
    const base =
      weavingProcess(
        ["P1", "P2", "P3", "P4", "P5"],
        ["Ruby Team", "Teal Counter", "Slate Group"]
      );

    const snapshot = structuredClone(base);

    expect(() =>
      applyProcessChanges(
        base,
        changes({
          removeLaneIds: [laneIdByName(base, "Teal Counter")]
        }),
        "x"
      )
    ).toThrow(ProcessValidationError);

    expect(base).toEqual(snapshot);
  });
});

// ======================================================
// SYSTEM FALLBACK LANE
// ======================================================

describe("system fallback lane", () => {
  function partial(): ProcessModel {
    return turn(
      linearProcess(["Open file", "Close file"]),
      changes({
        addLanes: [laneDraft("l_a", "Falcon Cell")],
        updateElements: [{ id: "task_0", laneRef: "l_a" }]
      })
    );
  }

  it("asks for a destination instead of removing the band while elements are unassigned", () => {
    const base = partial();

    const plan =
      planLaneRemovals(
        base,
        changes({ removeLaneIds: [UNASSIGNED_LANE_ID] })
      );

    expect(plan.clarification?.targetIds).toEqual([
      idByName(base, "Close file")
    ]);
    expect(plan.clarification?.question).toContain("Unassigned");
    expect(plan.clarification?.question).toContain('"Close file"');
  });

  it("ignores a removal of the band once nothing is unassigned", () => {
    const base =
      turn(
        partial(),
        changes({
          updateElements: [
            { id: "task_1", laneRef: laneIdByName(partial(), "Falcon Cell") }
          ]
        })
      );

    const plan =
      planLaneRemovals(
        base,
        changes({ removeLaneIds: [UNASSIGNED_LANE_ID] })
      );

    expect(plan.clarification).toBeUndefined();
    expect(plan.changes.removeLaneIds).toEqual([]);
  });

  it("migrates a leftover fallback lane instead of rejecting its removal", () => {
    const base = partial();

    base.lanes.push({
      id: "lane_legacy_fallback",
      participantId: "participant_internal",
      name: "Unassigned",
      type: "department"
    });

    base.elements.find(
      (element) => element.id === "task_1"
    )!.laneId = "lane_legacy_fallback";

    const result =
      applyProcessChanges(
        base,
        changes({ removeLaneIds: ["lane_legacy_fallback"] }),
        "remove it"
      ).process;

    expect(result.lanes.map((lane) => lane.name)).toEqual([
      "Falcon Cell"
    ]);
    expect(
      result.elements.find((element) => element.id === "task_1")
        ?.laneId
    ).toBeUndefined();
    expect(generateBpmnXml(result)).toContain(UNASSIGNED_LANE_ID);
  });

  it("keeps the reserved name from becoming a modeled role", () => {
    const base = partial();

    expect(() =>
      applyProcessChanges(
        base,
        changes({
          updateLanes: [
            { id: laneIdByName(base, "Falcon Cell"), name: " unassigned " }
          ]
        }),
        "x"
      )
    ).toThrow(/reserved/);

    const result =
      applyProcessChanges(
        base,
        changes({
          addLanes: [laneDraft("l_fb", "UNASSIGNED")],
          updateElements: [{ id: "task_1", laneRef: "l_fb" }]
        }),
        "x"
      ).process;

    expect(result.lanes).toEqual(base.lanes);
    expect(
      result.elements.find((element) => element.id === "task_1")
        ?.laneId
    ).toBeUndefined();
  });
});

// ======================================================
// RESPONSIBILITY CONTEXT
// ======================================================

describe("responsibility context", () => {
  function metalShop(): ProcessModel {
    return turn(
      linearProcess(["Cut metal"]),
      changes({
        addLanes: [laneDraft("l_a", "Falcon Cell")],
        updateElements: [{ id: "task_0", laneRef: "l_a" }]
      })
    );
  }

  it("keeps consecutive activities in the established lane until an explicit actor change", () => {
    const base = metalShop();

    const result =
      turn(
        base,
        changes({
          addLanes: [laneDraft("l_m", "Mint Desk")],
          addElements: [
            { tempRef: "n1", type: "task", name: "Polish metal" },
            { tempRef: "n2", type: "task", name: "Inspect metal" },
            {
              tempRef: "m1",
              type: "task",
              name: "Invoice buyer",
              laneRef: "l_m"
            },
            { tempRef: "m2", type: "task", name: "File invoice" }
          ],
          addFlows: [
            { fromRef: "task_0", toRef: "n1" },
            { fromRef: "n1", toRef: "n2" },
            { fromRef: "n2", toRef: "m1" },
            { fromRef: "m1", toRef: "m2" }
          ]
        })
      );

    const falcon = laneIdByName(result, "Falcon Cell");
    const mint = laneIdByName(result, "Mint Desk");

    expect(result.lanes).toHaveLength(2);
    expect(laneOf(result, "Polish metal")).toBe(falcon);
    expect(laneOf(result, "Inspect metal")).toBe(falcon);
    expect(laneOf(result, "Invoice buyer")).toBe(mint);
    expect(laneOf(result, "File invoice")).toBe(mint);
  });

  it("attaches a single new activity after the open end and in its lane", () => {
    const base = metalShop();

    const result =
      turn(
        base,
        changes({
          addElements: [
            { tempRef: "w", type: "task", name: "Weigh crate" }
          ]
        })
      );

    const weigh = idByName(result, "Weigh crate");

    expect(
      result.flows.filter((flow) => flow.to === weigh)
    ).toEqual([
      expect.objectContaining({ from: "task_0" })
    ]);
    expect(laneOf(result, "Weigh crate")).toBe(
      laneIdByName(result, "Falcon Cell")
    );
  });

  it("treats a tool mention as system usage, not as a lane", () => {
    const base = metalShop();

    const result =
      turn(
        base,
        changes({
          addLanes: [laneDraft("l_tool", "Orbit CRM")],
          addElements: [
            {
              tempRef: "log",
              type: "task",
              name: "Log order",
              system: "Orbit CRM",
              laneRef: "l_tool"
            }
          ],
          addFlows: [{ fromRef: "task_0", toRef: "log" }]
        })
      );

    expect(result.lanes.map((lane) => lane.name)).toEqual([
      "Falcon Cell"
    ]);

    const task =
      result.elements.find(
        (element) => element.name === "Log order"
      );

    expect(task?.laneId).toBe(laneIdByName(result, "Falcon Cell"));
    expect(task).toMatchObject({ system: "Orbit CRM" });
  });

  it("keeps a system lane when the system is described as the performer", () => {
    const base = metalShop();

    const result =
      turn(
        base,
        changes({
          addLanes: [laneDraft("l_tool", "Orbit CRM")],
          addElements: [
            {
              tempRef: "log",
              type: "task",
              name: "Send reminder",
              system: "Orbit CRM",
              executionType: "automated",
              laneRef: "l_tool"
            }
          ],
          addFlows: [{ fromRef: "task_0", toRef: "log" }]
        })
      );

    expect(result.lanes.map((lane) => lane.name)).toEqual([
      "Falcon Cell",
      "Orbit CRM"
    ]);
  });

  it("gives events and gateways the lane of their neighbours", () => {
    const result =
      applyProcessChanges(
        metalShop(),
        changes({
          addElements: [
            { tempRef: "g", type: "exclusiveGateway", name: "Good?" },
            { tempRef: "e", type: "end", name: "Shipped" }
          ],
          addFlows: [
            { fromRef: "task_0", toRef: "g" },
            { fromRef: "g", toRef: "e" }
          ]
        }),
        "x"
      ).process;

    const falcon = laneIdByName(result, "Falcon Cell");

    expect(laneOf(result, "Good?")).toBe(falcon);
    expect(laneOf(result, "Shipped")).toBe(falcon);
    expect(laneOf(result, "Process Trigger")).toBe(falcon);
  });
});

// ======================================================
// CANCELLATION
// ======================================================

describe("cancellation parsing", () => {
  it.each([
    ["Never mind, the next activity is packing", "the next activity is packing"],
    ["No, never mind. Then the clerk files it.", "Then the clerk files it."],
    ["Forget it - next comes shipping", "next comes shipping"],
    ["Vergiss es, als nächstes wird verpackt", "als nächstes wird verpackt"],
    ["never mind", ""]
  ])("cancels %s", (message, remainder) => {
    expect(parseCancellation(message)).toEqual({
      cancelled: true,
      remainder
    });
  });

  it("leaves ordinary messages alone", () => {
    for (const message of [
      "The next activity is packing",
      "Mind the gap between steps",
      "Never again do we skip that"
    ]) {
      expect(parseCancellation(message).cancelled).toBe(false);
    }
  });
});

// ======================================================
// MESSAGE ROUTE
// ======================================================

describe("message route", () => {
  beforeEach(() => {
    vi.mocked(proposeProcessChanges).mockReset();
  });

  it("recovers from a rejected edit when the user cancels it and continues in the same message", async () => {
    const base =
      turn(
        linearProcess(["Cut metal", "Polish metal"]),
        changes({
          addLanes: [laneDraft("l_a", "Falcon Cell")],
          updateElements: [
            { id: "task_0", laneRef: "l_a" },
            { id: "task_1", laneRef: "l_a" }
          ]
        })
      );

    const sessionId = seedSession(base);
    const before = structuredClone(getSession(sessionId)!.process);

    vi.mocked(proposeProcessChanges).mockResolvedValueOnce(
      llmResponse(
        changes({
          updateElements: [
            { id: "task_1", laneRef: "ghost_lane" }
          ]
        }),
        "Moved it."
      )
    );

    const rejected =
      await send(sessionId, "Move polishing to the paint shop");

    expect(rejected.status).toBe(200);
    expect(rejected.body.assistantMessage).not.toContain("Moved it");
    expect(rejected.body.assistantMessage).toContain('"Polish metal"');
    expect(rejected.body.assistantMessage).toContain(
      "nothing was changed"
    );
    expect(getSession(sessionId)!.process).toEqual(before);
    expect(getSession(sessionId)!.pendingQuestion).toMatchObject({
      kind: "lane_assignment",
      targetIds: ["task_1"]
    });

    vi.mocked(proposeProcessChanges).mockResolvedValueOnce(
      llmResponse(
        changes({
          addElements: [
            { tempRef: "p", type: "task", name: "Pack box" }
          ]
        }),
        "Added Pack box."
      )
    );

    const resumed =
      await send(
        sessionId,
        "Never mind, the next activity is packing the box"
      );

    expect(resumed.status).toBe(200);

    const llmCall =
      vi.mocked(proposeProcessChanges).mock.calls[1][0];

    expect(llmCall.userMessage).toBe(
      "the next activity is packing the box"
    );
    expect(llmCall.pendingQuestion).toBeUndefined();

    const committed = getSession(sessionId)!;

    const pack = idByName(committed.process, "Pack box");

    expect(
      committed.process.flows.filter((flow) => flow.to === pack)
    ).toEqual([expect.objectContaining({ from: "task_1" })]);

    expect(laneOf(committed.process, "Pack box")).toBe(
      laneIdByName(committed.process, "Falcon Cell")
    );

    expect(committed.pendingQuestion?.kind).not.toBe(
      "lane_assignment"
    );

    // Conversation, model, diagram and export agree.
    expect(resumed.body.assistantMessage).toBe(
      committed.messages[committed.messages.length - 1].content
    );
    expect(resumed.body.process.elements.map(
      (element: { id: string }) => element.id
    )).toEqual(
      committed.process.elements.map((element) => element.id)
    );
    expect(resumed.body.bpmnXml).toBe(
      generateBpmnXml(committed.process)
    );
    expect(exportedAssignmentsMatch(committed.process)).toBe(true);
  });

  it("drops a pending question when the message only cancels it", async () => {
    const base = linearProcess(["Cut metal"]);

    const sessionId =
      seedSession(
        base,
        {
          id: "q1",
          kind: "lane_assignment",
          targetIds: ["task_0"],
          question: "Who cuts the metal?"
        }
      );

    const response = await send(sessionId, "Never mind");

    expect(response.status).toBe(200);
    expect(proposeProcessChanges).not.toHaveBeenCalled();
    expect(response.body.assistantMessage).toContain("dropped");
    expect(getSession(sessionId)!.pendingQuestion).toBeUndefined();
    expect(getSession(sessionId)!.process).toEqual(base);
  });

  it("asks a targeted question for an ambiguous lane removal and completes it after the answer", async () => {
    const base =
      weavingProcess(
        ["Intake", "Review", "Audit", "Rework", "Release"],
        ["Ruby Team", "Teal Counter", "Slate Group"]
      );

    const sessionId = seedSession(base);
    const teal = laneIdByName(base, "Teal Counter");

    vi.mocked(proposeProcessChanges).mockResolvedValueOnce(
      llmResponse(
        changes({ removeLaneIds: [teal] }),
        "Removed the lane."
      )
    );

    const asked =
      await send(sessionId, "Remove the Teal Counter lane");

    expect(asked.body.assistantMessage).toContain('"Teal Counter"');
    expect(asked.body.assistantMessage).toContain('"Review"');
    expect(asked.body.assistantMessage).toContain('"Rework"');
    expect(asked.body.assistantMessage).not.toContain("Removed");
    expect(getSession(sessionId)!.process.lanes).toHaveLength(3);

    vi.mocked(proposeProcessChanges).mockResolvedValueOnce(
      llmResponse(
        changes({
          removeLaneIds: [teal],
          updateElements: [
            { id: "task_1", laneId: laneIdByName(base, "Ruby Team") },
            { id: "task_3", laneId: laneIdByName(base, "Ruby Team") }
          ]
        }),
        "Moved them and removed the lane."
      )
    );

    const done =
      await send(sessionId, "Move them to Ruby Team");

    const committed = getSession(sessionId)!;

    expect(done.status).toBe(200);
    expect(committed.process.lanes.map((lane) => lane.name)).toEqual([
      "Ruby Team",
      "Slate Group"
    ]);
    expect(done.body.process.lanes).toEqual(committed.process.lanes);
    expect(exportedAssignmentsMatch(committed.process)).toBe(true);
  });
});

describe("rejection feedback", () => {
  it("names the elements and the missing role instead of a generic error", () => {
    const base = linearProcess(["Cut metal"]);

    let error: ProcessValidationError | undefined;

    try {
      applyProcessChanges(
        base,
        changes({
          updateElements: [{ id: "task_0", laneRef: "nowhere" }]
        }),
        "x"
      );
    } catch (caught) {
      error = caught as ProcessValidationError;
    }

    expect(error).toBeInstanceOf(ProcessValidationError);

    const feedback = explainRejectedUpdate(error!, base);

    expect(feedback.question).toContain('"Cut metal"');
    expect(feedback.question).toContain("role or department");
    expect(feedback.targetIds).toEqual(["task_0"]);
  });

  it("replaces internal IDs in other validation errors with names", () => {
    const base = linearProcess(["Cut metal"]);

    const feedback =
      explainRejectedUpdate(
        new ProcessValidationError("Cannot update missing element task_0"),
        base
      );

    expect(feedback.question).toContain('"Cut metal"');
    expect(feedback.question).not.toContain("task_0");
  });
});

// ======================================================
// GROUNDED DEVIATION QUESTIONS
// ======================================================

describe("deviation follow-up questions", () => {
  const process = linearProcess(["Pick parts", "Stamp crate"]);

  function deviation(
    overrides: Partial<DeviationCandidate>
  ): DeviationCandidate {
    return {
      id: "dev_1",
      referenceProcessId: "ref",
      referenceProcessVersion: 1,
      sourceConformanceRunId: "run",
      detectionMethod: "prefix_tbr",
      provisional: true,
      dimension: "control_flow",
      moveType: "log_move",
      actualActivityIds: ["task_1"],
      expectedReferenceActivityIds: [],
      description: "Actual activity \"Stamp crate\" has no matching activity.",
      firstDetectedAt: new Date().toISOString(),
      status: "open",
      ...overrides
    } as DeviationCandidate;
  }

  it("never turns missing ownership into a deviation", () => {
    const actual = linearProcess(["Pick parts"]);

    const reference =
      turn(
        linearProcess(["Pick parts"]),
        changes({
          addLanes: [laneDraft("l_a", "Falcon Cell")],
          updateElements: [{ id: "task_0", laneRef: "l_a" }]
        })
      );

    const run = {
      id: "run",
      referenceProcessId: "ref",
      referenceProcessVersion: 1,
      traceActivityIds: ["task_0"],
      method: "alignment",
      complete: true,
      fitness: 1,
      conformant: true,
      moves: [
        {
          type: "synchronous",
          actualActivityId: "task_0",
          actualLabel: "Pick parts",
          referenceActivityId: "task_0",
          referenceLabel: "Pick parts"
        }
      ],
      createdAt: new Date().toISOString()
    } as unknown as ConformanceRun;

    const mappings = [
      {
        actualActivityId: "task_0",
        actualLabel: "Pick parts",
        referenceProcessId: "ref",
        referenceProcessVersion: 1,
        referenceActivityId: "task_0",
        referenceLabel: "Pick parts",
        confidence: 1,
        method: "exact"
      }
    ] as ActivityMapping[];

    expect(
      mapConformanceRunToDeviations({
        run,
        actualProcess: actual,
        referenceProcess: reference,
        mappings,
        referenceStable: true
      })
    ).toEqual([]);
  });
});
