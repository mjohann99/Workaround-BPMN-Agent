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
  buildResponsibilityQuestion,
  laneAssignmentsChanged
} from "../src/analysis/responsibility.js";
import {
  generateBpmnXml,
  UNASSIGNED_LANE_ID
} from "../src/bpmn.js";
import { proposeProcessChanges } from "../src/openai.js";
import {
  applyProcessChanges,
  createInitialProcess,
  ProcessValidationError,
  validateProcessModel
} from "../src/process.js";
import {
  repairIntervieweeRoleStatement,
  sanitizeProcessChanges
} from "../src/process-change-sanitizer.js";
import {
  createSession,
  getSession,
  updateSessionProcess,
  updateSessionState
} from "../src/store.js";
import {
  type ProcessChanges,
  type ProcessModel
} from "../src/types.js";
import {
  mergeEmployeeProcessView,
  toEmployeeProcessView
} from "../src/view.js";

// ======================================================
// HELPERS
// ======================================================

const INTERNAL = "participant_internal";

function changes(
  overrides: Partial<ProcessChanges> = {}
): ProcessChanges {
  return {
    addParticipants: [],
    updateParticipants: [],
    removeParticipantIds: [],
    addLanes: [],
    updateLanes: [],
    removeLaneIds: [],
    addElements: [],
    updateElements: [],
    removeElementIds: [],
    addFlows: [],
    removeFlowIds: [],
    addMessageFlows: [],
    removeMessageFlowIds: [],
    addWorkarounds: [],
    updateWorkarounds: [],
    ...overrides
  };
}

// Same pipeline order as the message route.
function turn(
  process: ProcessModel,
  proposed: ProcessChanges,
  message = "turn"
): ProcessModel {
  const sanitized =
    sanitizeProcessChanges(process, proposed);

  const repaired =
    repairIntervieweeRoleStatement(
      process,
      sanitized,
      message
    );

  return applyProcessChanges(
    process,
    repaired.changes,
    message
  ).process;
}

function laneDraft(
  tempRef: string,
  name: string
): ProcessChanges["addLanes"][number] {
  return {
    tempRef,
    participantRef: INTERNAL,
    name,
    type: "department"
  };
}

function linearProcess(
  taskNames: string[]
): ProcessModel {
  return applyProcessChanges(
    createInitialProcess("Arbitrary process"),
    changes({
      addElements:
        taskNames.map((name, index) => ({
          tempRef: `task_${index}`,
          type: "task" as const,
          name
        })),
      addFlows:
        taskNames.map((_, index) => ({
          id: `seq_${index}`,
          fromRef:
            index === 0
              ? "start_1"
              : `task_${index - 1}`,
          toRef: `task_${index}`
        }))
    }),
    "setup"
  ).process;
}

function taskIdByName(
  process: ProcessModel,
  name: string
): string {
  const task =
    process.elements.find(
      (element) => element.name === name
    );

  if (!task) {
    throw new Error(`No element named ${name}`);
  }

  return task.id;
}

function laneIdByName(
  process: ProcessModel,
  name: string
): string {
  const lane =
    process.lanes.find(
      (candidate) => candidate.name === name
    );

  if (!lane) {
    throw new Error(`No lane named ${name}`);
  }

  return lane.id;
}

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function shape(
  xml: string,
  id: string
): Rect {
  const match =
    new RegExp(
      `bpmnElement="${id}"[^>]*><dc:Bounds x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`
    ).exec(xml);

  if (!match) {
    throw new Error(`No diagram shape for ${id}`);
  }

  return {
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4])
  };
}

function centerY(rect: Rect): number {
  return rect.y + rect.height / 2;
}

function inside(
  inner: Rect,
  outer: Rect
): boolean {
  return (
    centerY(inner) >= outer.y &&
    centerY(inner) <= outer.y + outer.height
  );
}

function laneMembers(
  xml: string,
  laneId: string
): string[] {
  const lane =
    new RegExp(
      `<bpmn:lane id="${laneId}"[^>]*>(.*?)</bpmn:lane>`
    ).exec(xml);

  if (!lane) {
    throw new Error(`No lane ${laneId} in XML`);
  }

  return [
    ...lane[1].matchAll(
      /<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/g
    )
  ].map((match) => match[1]);
}

// Mirrors the editor importer: flowNodeRef decides the lane; the
// visual-only unassigned band is ignored.
function importLaneAssignments(
  xml: string
): {
  lanes: Array<{ id: string; name: string }>;
  laneByElement: Record<string, string>;
} {
  const lanes: Array<{ id: string; name: string }> = [];
  const laneByElement: Record<string, string> = {};

  for (
    const match of xml.matchAll(
      /<bpmn:lane id="([^"]+)" name="([^"]*)">(.*?)<\/bpmn:lane>/g
    )
  ) {
    if (match[1] === UNASSIGNED_LANE_ID) {
      continue;
    }

    lanes.push({ id: match[1], name: match[2] });

    for (
      const ref of match[3].matchAll(
        /<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/g
      )
    ) {
      laneByElement[ref[1]] = match[1];
    }
  }

  return { lanes, laneByElement };
}

function modelAssignments(
  process: ProcessModel
): Record<string, string> {
  return Object.fromEntries(
    process.elements
      .filter((element) => element.laneId)
      .map((element) => [element.id, element.laneId!])
  );
}

// ======================================================
// MODEL SCENARIOS
// ======================================================

describe("responsibility handling — model", () => {
  it("introduces a new responsibility after several activities without moving earlier ones", () => {
    const base =
      linearProcess([
        "Gather input",
        "Draft offer",
        "Check offer"
      ]);

    const result =
      turn(
        base,
        changes({
          addLanes: [
            laneDraft("l_new", "Quartz Desk")
          ],
          addElements: [
            {
              tempRef: "n1",
              type: "task",
              name: "Approve offer",
              laneRef: "l_new"
            }
          ],
          addFlows: [
            {
              id: "seq_handoff",
              fromRef: taskIdByName(base, "Check offer"),
              toRef: "n1"
            }
          ]
        })
      );

    const lane = laneIdByName(result, "Quartz Desk");

    expect(
      result.elements.map((element) => element.name)
    ).toEqual([
      ...base.elements.map((element) => element.name),
      "Approve offer"
    ]);

    expect(
      modelAssignments(result)
    ).toEqual({
      [taskIdByName(result, "Approve offer")]: lane
    });

    expect(result.flows).toHaveLength(
      base.flows.length + 1
    );

    validateProcessModel(result);

    const xml = generateBpmnXml(result);

    expect(laneMembers(xml, lane)).toEqual([
      taskIdByName(result, "Approve offer")
    ]);

    // Earlier activities are visibly unassigned, not inside the lane.
    const band = shape(xml, UNASSIGNED_LANE_ID);
    const laneRect = shape(xml, lane);

    for (const name of ["Gather input", "Draft offer", "Check offer"]) {
      const rect = shape(xml, taskIdByName(result, name));
      expect(inside(rect, band)).toBe(true);
      expect(inside(rect, laneRect)).toBe(false);
    }

    expect(
      inside(
        shape(xml, taskIdByName(result, "Approve offer")),
        laneRect
      )
    ).toBe(true);

    // The handoff keeps its sequence flow across the lane boundary.
    expect(xml).toContain(
      `<bpmn:sequenceFlow id="seq_handoff" sourceRef="${taskIdByName(result, "Check offer")}" targetRef="${taskIdByName(result, "Approve offer")}" />`
    );

    expect(xml).toMatch(
      /bpmnElement="seq_handoff"><di:waypoint [^>]*\/><di:waypoint/
    );
  });

  it("applies a retrospective clarification only to the activities it covers", () => {
    const base =
      linearProcess([
        "Step one",
        "Step two",
        "Step three"
      ]);

    const result =
      turn(
        base,
        changes({
          addLanes: [
            laneDraft("l_a", "Amber Unit")
          ],
          updateElements: [
            {
              id: taskIdByName(base, "Step one"),
              laneRef: "l_a"
            },
            {
              id: taskIdByName(base, "Step two"),
              laneRef: "l_a"
            }
          ]
        })
      );

    const lane = laneIdByName(result, "Amber Unit");

    // The start event joins the lane of the first activity it triggers.
    expect(modelAssignments(result)).toEqual({
      start_1: lane,
      [taskIdByName(result, "Step one")]: lane,
      [taskIdByName(result, "Step two")]: lane
    });

    expect(result.elements).toHaveLength(
      base.elements.length
    );

    expect(result.flows).toEqual(base.flows);

    expect(
      result.elements.map((element) => element.id)
    ).toEqual(
      base.elements.map((element) => element.id)
    );

    expect(laneAssignmentsChanged(base, result)).toBe(true);

    expect(
      buildResponsibilityQuestion(result)
    ).toEqual({
      question:
        'Which role or department performs "Step three"?',
      targetIds: [taskIdByName(result, "Step three")]
    });
  });

  it("handles the current role and the next role in one turn", () => {
    const base =
      linearProcess(["Collect", "Assemble"]);

    const result =
      turn(
        base,
        changes({
          addLanes: [
            laneDraft("l_a", "Zeta Crew"),
            laneDraft("l_b", "Onyx Office")
          ],
          updateElements: [
            { id: "start_1", laneRef: "l_a" },
            {
              id: taskIdByName(base, "Collect"),
              laneRef: "l_a"
            },
            {
              id: taskIdByName(base, "Assemble"),
              laneRef: "l_a"
            }
          ],
          addElements: [
            {
              tempRef: "n1",
              type: "task",
              name: "File report",
              laneRef: "l_b"
            }
          ],
          addFlows: [
            {
              id: "seq_next",
              fromRef: taskIdByName(base, "Assemble"),
              toRef: "n1"
            }
          ]
        })
      );

    const a = laneIdByName(result, "Zeta Crew");
    const b = laneIdByName(result, "Onyx Office");

    expect(result.lanes).toHaveLength(2);

    expect(modelAssignments(result)).toEqual({
      start_1: a,
      [taskIdByName(result, "Collect")]: a,
      [taskIdByName(result, "Assemble")]: a,
      [taskIdByName(result, "File report")]: b
    });

    const xml = generateBpmnXml(result);

    expect(xml).not.toContain(UNASSIGNED_LANE_ID);

    expect(
      shape(xml, a).y
    ).not.toBe(shape(xml, b).y);

    expect(
      inside(
        shape(xml, taskIdByName(result, "File report")),
        shape(xml, b)
      )
    ).toBe(true);

    expect(
      inside(
        shape(xml, taskIdByName(result, "Collect")),
        shape(xml, a)
      )
    ).toBe(true);
  });

  it("reuses an existing lane when the user returns to it", () => {
    const first =
      turn(
        linearProcess(["One", "Two"]),
        changes({
          addLanes: [
            laneDraft("l_a", "Amber Unit"),
            laneDraft("l_b", "Quartz Desk")
          ],
          updateElements: [
            { id: "start_1", laneRef: "l_a" },
            {
              id: "task_0",
              laneRef: "l_a"
            },
            {
              id: "task_1",
              laneRef: "l_b"
            }
          ]
        })
      );

    const amberId = laneIdByName(first, "Amber Unit");
    const quartzId = laneIdByName(first, "Quartz Desk");

    const second =
      turn(
        first,
        changes({
          addLanes: [
            laneDraft("l_again", "  AMBER   unit ")
          ],
          addElements: [
            {
              tempRef: "n1",
              type: "task",
              name: "Return step",
              laneRef: "l_again"
            }
          ],
          addFlows: [
            {
              id: "seq_back",
              fromRef: "task_1",
              toRef: "n1"
            }
          ]
        })
      );

    expect(
      second.lanes.map((lane) => lane.id)
    ).toEqual([amberId, quartzId]);

    expect(
      second.elements.find(
        (element) => element.name === "Return step"
      )?.laneId
    ).toBe(amberId);
  });

  it("is safe to apply repeated clarifications and confirmations", () => {
    const base =
      linearProcess(["Alpha", "Beta"]);

    const clarification =
      changes({
        addLanes: [
          laneDraft("l_a", "Cobalt Team")
        ],
        updateElements: [
          { id: "task_0", laneRef: "l_a" }
        ]
      });

    const once = turn(base, clarification);
    const twice = turn(once, clarification);
    const confirmed = turn(twice, changes(), "yes");

    expect(twice.lanes).toEqual(once.lanes);
    expect(twice.elements).toEqual(once.elements);
    expect(twice.flows).toEqual(once.flows);
    expect(confirmed.lanes).toEqual(once.lanes);
    expect(confirmed.elements).toEqual(once.elements);

    const identity =
      turn(
        base,
        changes(),
        "We are Fjord Division"
      );

    const identityAgain =
      turn(
        identity,
        changes(),
        "We are Fjord Division"
      );

    expect(identityAgain.lanes).toEqual(identity.lanes);
    expect(identityAgain.elements).toEqual(identity.elements);
    expect(identity.lanes).toHaveLength(1);
  });

  it("rejects unresolved or inconsistent lane references and leaves the input untouched", () => {
    const base =
      turn(
        linearProcess(["Alpha", "Beta"]),
        changes({
          addLanes: [
            laneDraft("l_a", "Cobalt Team"),
            laneDraft("l_b", "Ivory Hub")
          ],
          updateElements: [
            { id: "task_0", laneRef: "l_a" }
          ]
        })
      );

    const snapshot = structuredClone(base);

    const invalid: ProcessChanges[] = [
      changes({
        updateElements: [
          { id: "task_1", laneRef: "no_such_lane" }
        ]
      }),
      changes({
        addElements: [
          {
            tempRef: "n1",
            type: "task",
            name: "Orphan",
            laneRef: "no_such_lane"
          }
        ]
      }),
      changes({
        updateLanes: [{ id: "no_such_lane", name: "Ghost" }]
      }),
      changes({
        updateLanes: [
          {
            id: laneIdByName(base, "Ivory Hub"),
            name: "cobalt team"
          }
        ]
      }),
      changes({
        removeLaneIds: [laneIdByName(base, "Cobalt Team")]
      })
    ];

    for (const proposal of invalid) {
      expect(() =>
        applyProcessChanges(base, proposal, "x")
      ).toThrow(ProcessValidationError);
    }

    expect(base).toEqual(snapshot);
  });
});

// ======================================================
// PERSISTENCE AND RENDERING
// ======================================================

describe("responsibility handling — persistence round trips", () => {
  function sample(): ProcessModel {
    return turn(
      linearProcess(["Intake", "Prepare", "Decide"]),
      changes({
        addLanes: [
          laneDraft("l_a", "Slate Group"),
          laneDraft("l_b", "Pearl Office")
        ],
        updateElements: [
          { id: "start_1", laneRef: "l_a" },
          { id: "task_0", laneRef: "l_a" },
          { id: "task_1", laneRef: "l_a" }
        ],
        addElements: [
          {
            tempRef: "n1",
            type: "task",
            name: "Sign off",
            laneRef: "l_b"
          }
        ],
        addFlows: [
          {
            id: "seq_last",
            fromRef: "task_2",
            toRef: "n1"
          }
        ]
      })
    );
  }

  it("keeps lane identities and assignments through JSON and the employee view", () => {
    const original = sample();

    const json =
      JSON.parse(JSON.stringify(original)) as ProcessModel;

    validateProcessModel(json);
    expect(json).toEqual(original);

    const merged =
      mergeEmployeeProcessView(
        original,
        toEmployeeProcessView(original)
      );

    expect(merged.lanes).toEqual(original.lanes);
    expect(modelAssignments(merged)).toEqual(
      modelAssignments(original)
    );
  });

  it("writes BPMN whose lanes and memberships reproduce the model", () => {
    const original = sample();
    const xml = generateBpmnXml(original);

    const imported = importLaneAssignments(xml);

    expect(imported.lanes).toEqual(
      original.lanes.map((lane) => ({
        id: lane.id,
        name: lane.name
      }))
    );

    expect(imported.laneByElement).toEqual(
      modelAssignments(original)
    );

    expect(
      generateBpmnXml(
        JSON.parse(JSON.stringify(original))
      )
    ).toBe(xml);
  });

  it("does not turn the unassigned band into a lane or assignment", () => {
    const partial =
      turn(
        linearProcess(["Intake", "Prepare"]),
        changes({
          addLanes: [laneDraft("l_a", "Slate Group")],
          updateElements: [
            { id: "task_0", laneRef: "l_a" }
          ]
        })
      );

    const xml = generateBpmnXml(partial);

    expect(xml).toContain(UNASSIGNED_LANE_ID);

    const imported = importLaneAssignments(xml);

    expect(imported.lanes).toHaveLength(1);
    expect(imported.laneByElement).toEqual(
      modelAssignments(partial)
    );
  });

  it("refuses to render an element that references a missing lane", () => {
    const broken = sample();

    broken.elements.find(
      (element) => element.id === "task_2"
    )!.laneId = "missing_lane";

    expect(() => generateBpmnXml(broken)).toThrow(
      /missing lane/
    );
  });
});

// ======================================================
// ROUTE: REJECTED UPDATE
// ======================================================

describe("responsibility handling — message route", () => {
  beforeEach(() => {
    vi.mocked(proposeProcessChanges).mockReset();
  });

  it("keeps the last valid process and answers with feedback when an update is rejected", async () => {
    const session = createSession();

    updateSessionProcess(
      session.id,
      linearProcess(["First", "Second"])
    );

    updateSessionState(session.id, {
      pendingQuestion: undefined
    });

    const before =
      structuredClone(
        getSession(session.id)!.process
      );

    vi.mocked(proposeProcessChanges).mockResolvedValue({
      language: "en",
      intent: "correction",
      assistantMessage: "Done, the assignment was applied.",
      contextPatch: {},
      changes: changes({
        updateElements: [
          { id: "task_0", laneRef: "no_such_lane" }
        ]
      }),
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
    });

    const response =
      await request(app)
        .post(
          `/api/employee/sessions/${session.id}/message`
        )
        .send({ message: "Please move that step" });

    expect(response.status).toBe(200);

    expect(response.body.assistantMessage).not.toContain(
      "Done"
    );

    expect(response.body.assistantMessage).toContain(
      "nothing was changed"
    );

    const after = getSession(session.id)!;

    expect(after.process).toEqual(before);

    expect(
      after.messages[after.messages.length - 1]
    ).toMatchObject({
      role: "assistant",
      content: response.body.assistantMessage
    });

    expect(after.pendingQuestion).toBeDefined();

    // The interview continues after the rejection.
    expect(response.body.process.lanes).toEqual([]);
    expect(response.body.bpmnXml).toContain(
      "<bpmn:process"
    );
  });
});
