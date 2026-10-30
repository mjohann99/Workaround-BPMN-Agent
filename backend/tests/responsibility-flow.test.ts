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
  continuationMessage,
  isRedundantResponsibilityQuestion
} from "../src/analysis/responsibility.js";
import { proposeProcessChanges } from "../src/openai.js";
import { sanitizeProcessChanges } from "../src/process-change-sanitizer.js";
import {
  createSession,
  getSession,
  updateSessionProcess,
  updateSessionState
} from "../src/store.js";
import {
  type LlmProcessResponse,
  type NextQuestion,
  type ProcessChanges,
  type ProcessModel,
  type ResponsibilityHint
} from "../src/types.js";
import {
  changes,
  laneDraft,
  laneIdByName,
  laneOf,
  linearProcess,
  turn
} from "./helpers/process-fixtures.js";

// ======================================================
// INTERVIEW HARNESS
// ======================================================

type Reply = {
  changes?: ProcessChanges;
  responsibility?: ResponsibilityHint;
  question?: Pick<NextQuestion, "kind" | "question">;
};

function llm(reply: Reply): LlmProcessResponse {
  return {
    language: "en",
    intent: "process_description",
    assistantMessage: "Noted.",
    contextPatch: {},
    changes: reply.changes ?? changes(),
    uncertainties: [],
    nextQuestion: reply.question
      ? {
        required: true,
        kind: reply.question.kind,
        targetRefs: [],
        question: reply.question.question
      }
      : {
        required: false,
        kind: "clarification",
        targetRefs: [],
        question: ""
      },
    validationRequest: {
      required: false,
      elementIds: [],
      question: ""
    },
    responsibility: reply.responsibility ?? {}
  };
}

function startInterview(
  process?: ProcessModel
): string {
  const session = createSession();

  if (process) {
    updateSessionProcess(session.id, process);
  }

  updateSessionState(session.id, {
    pendingQuestion: undefined
  });

  return session.id;
}

async function say(
  sessionId: string,
  message: string,
  reply: Reply
) {
  vi.mocked(proposeProcessChanges).mockResolvedValueOnce(
    llm(reply)
  );

  const response =
    await request(app)
      .post(`/api/employee/sessions/${sessionId}/message`)
      .send({ message });

  expect(response.status).toBe(200);

  return {
    message: response.body.assistantMessage as string,
    session: getSession(sessionId)!
  };
}

function lastCallContext() {
  const calls = vi.mocked(proposeProcessChanges).mock.calls;

  return calls[calls.length - 1][0].responsibilityContext;
}

function laneName(
  process: ProcessModel,
  elementName: string
): string | undefined {
  const laneId = laneOf(process, elementName);

  return process.lanes.find((lane) => lane.id === laneId)?.name;
}

const asksWho = /which role|who performs|which team/i;

// ======================================================
// INTERVIEW FLOW
// ======================================================

describe("established responsibility", () => {
  beforeEach(() => {
    vi.mocked(proposeProcessChanges).mockReset();
  });

  it("keeps continuing activities in the interviewee's lane without asking again", async () => {
    const id = startInterview();

    const first =
      await say(id, "We are the Harbor Desk and start by checking the manifest", {
        changes: changes({
          addElements: [
            { tempRef: "check", type: "task", name: "Check manifest" }
          ],
          addFlows: [{ fromRef: "start_1", toRef: "check" }]
        }),
        responsibility: {
          intervieweeRole: "Harbor Desk",
          actor: "interviewee"
        },
        question: {
          kind: "clarification",
          question: "What happens after the manifest is checked?"
        }
      });

    const harbor = laneIdByName(first.session.process, "Harbor Desk");

    expect(first.session.process.lanes).toHaveLength(1);
    expect(laneName(first.session.process, "Check manifest")).toBe("Harbor Desk");
    expect(first.session.responsibility?.intervieweeLaneId).toBe(harbor);
    expect(first.message).toBe("What happens after the manifest is checked?");

    // Reloading the page must not lose the established role.
    const reloaded =
      await request(app).get(`/api/employee/sessions/${id}`);

    expect(reloaded.status).toBe(200);
    expect(JSON.stringify(reloaded.body)).not.toContain(
      "intervieweeLaneId"
    );

    // Two more activities; the model asks "who performs this?" anyway.
    const second =
      await say(id, "Then we log it and file the papers", {
        changes: changes({
          addElements: [
            { tempRef: "log", type: "task", name: "Log manifest" },
            { tempRef: "file", type: "task", name: "File papers" }
          ],
          addFlows: [
            { fromRef: "check", toRef: "log" },
            { fromRef: "log", toRef: "file" }
          ]
        }),
        responsibility: { actor: "previous" },
        question: {
          kind: "lane_assignment",
          question: "Which role or department performs these activities?"
        }
      });

    expect(lastCallContext()?.intervieweeRole?.name).toBe("Harbor Desk");
    expect(second.session.process.lanes).toHaveLength(1);
    expect(laneName(second.session.process, "Log manifest")).toBe("Harbor Desk");
    expect(laneName(second.session.process, "File papers")).toBe("Harbor Desk");
    expect(second.session.pendingQuestion).toBeUndefined();
    expect(second.message).not.toMatch(asksWho);
    expect(second.message).toContain("What happens next");
  });

  it("resolves first-person references to the interviewee after a handoff and on return", async () => {
    const id = startInterview();

    await say(id, "We are the Harbor Desk and check the manifest", {
      changes: changes({
        addElements: [
          { tempRef: "check", type: "task", name: "Check manifest" }
        ],
        addFlows: [{ fromRef: "start_1", toRef: "check" }]
      }),
      responsibility: { intervieweeRole: "Harbor Desk", actor: "interviewee" }
    });

    const handoff =
      await say(id, "Then the Customs Office stamps it", {
        changes: changes({
          addLanes: [laneDraft("l_c", "Customs Office")],
          addElements: [
            {
              tempRef: "stamp",
              type: "task",
              name: "Stamp manifest",
              laneRef: "l_c"
            }
          ],
          addFlows: [{ fromRef: "check", toRef: "stamp" }]
        }),
        responsibility: { actor: "named" }
      });

    expect(handoff.session.process.lanes).toHaveLength(2);
    expect(laneName(handoff.session.process, "Stamp manifest")).toBe(
      "Customs Office"
    );
    expect(handoff.session.pendingQuestion?.kind).not.toBe(
      "lane_assignment"
    );

    // "We" means the interviewee, not the role mentioned last.
    const firstPerson =
      await say(id, "We then archive it", {
        changes: changes({
          addElements: [
            { tempRef: "archive", type: "task", name: "Archive manifest" }
          ],
          addFlows: [{ fromRef: "stamp", toRef: "archive" }]
        }),
        responsibility: { actor: "interviewee" },
        question: {
          kind: "lane_assignment",
          question: "Who performs the archiving?"
        }
      });

    expect(lastCallContext()).toMatchObject({
      intervieweeRole: { name: "Harbor Desk" },
      currentRole: { name: "Customs Office" }
    });
    expect(laneName(firstPerson.session.process, "Archive manifest")).toBe(
      "Harbor Desk"
    );
    expect(firstPerson.session.process.lanes).toHaveLength(2);
    expect(firstPerson.message).not.toMatch(asksWho);

    // Returning to the interviewee's lane reuses it; "still us" continues it.
    const harbor =
      laneIdByName(firstPerson.session.process, "Harbor Desk");

    await say(id, "Back to us, we close the case", {
      changes: changes({
        addElements: [
          {
            tempRef: "close",
            type: "task",
            name: "Close case",
            laneRef: harbor
          }
        ],
        addFlows: [{ fromRef: "archive", toRef: "close" }]
      }),
      responsibility: { actor: "named" }
    });

    const still =
      await say(id, "Still us, we send the receipt", {
        changes: changes({
          addElements: [
            { tempRef: "receipt", type: "task", name: "Send receipt" }
          ],
          addFlows: [{ fromRef: "close", toRef: "receipt" }]
        }),
        responsibility: { actor: "previous" }
      });

    expect(still.session.process.lanes).toHaveLength(2);
    expect(laneName(still.session.process, "Close case")).toBe("Harbor Desk");
    expect(laneName(still.session.process, "Send receipt")).toBe("Harbor Desk");

    // Earlier assignments were not moved by the inheritance.
    expect(laneName(still.session.process, "Stamp manifest")).toBe(
      "Customs Office"
    );
  });

  it("accepts a department as sufficient and stops asking for narrower roles", async () => {
    const id = startInterview();

    const asked =
      await say(id, "We receive the crates", {
        changes: changes({
          addElements: [
            { tempRef: "receive", type: "task", name: "Receive crate" }
          ],
          addFlows: [{ fromRef: "start_1", toRef: "receive" }]
        }),
        question: {
          kind: "actor_role",
          question: "Which role do you work in?"
        }
      });

    // Nothing is known yet, so this question is legitimate.
    expect(asked.session.pendingQuestion?.kind).toBe("actor_role");

    const refused =
      await say(id, "There is nobody more specific, we are the Dock Team", {
        responsibility: {
          intervieweeRole: "Dock Team",
          noFurtherDetail: true
        },
        question: {
          kind: "actor_role",
          question: "Which team within the Dock Team?"
        }
      });

    expect(refused.session.responsibility?.distinctionDeclined).toBe(true);
    expect(refused.session.pendingQuestion).toBeUndefined();
    expect(refused.message).not.toMatch(asksWho);
    expect(laneName(refused.session.process, "Receive crate")).toBe("Dock Team");

    const later =
      await say(id, "Then we unload them", {
        changes: changes({
          addElements: [
            { tempRef: "unload", type: "task", name: "Unload crate" }
          ],
          addFlows: [{ fromRef: "receive", toRef: "unload" }]
        }),
        responsibility: { actor: "interviewee" },
        question: {
          kind: "lane_assignment",
          question: "Which specific person unloads them?"
        }
      });

    expect(lastCallContext()?.distinctionDeclined).toBe(true);
    expect(laneName(later.session.process, "Unload crate")).toBe("Dock Team");
    expect(later.session.pendingQuestion).toBeUndefined();
    expect(later.message).not.toMatch(asksWho);
    expect(later.session.process.lanes).toHaveLength(1);
  });

  it("asks once when responsibility is genuinely missing and never repeats the question", async () => {
    const id =
      startInterview(
        linearProcess(["Open gate", "Weigh load"])
      );

    const introduced =
      await say(id, "Then the Customs Office inspects it", {
        changes: changes({
          addLanes: [laneDraft("l_c", "Customs Office")],
          addElements: [
            {
              tempRef: "inspect",
              type: "task",
              name: "Inspect load",
              laneRef: "l_c"
            }
          ],
          addFlows: [{ fromRef: "task_1", toRef: "inspect" }]
        }),
        responsibility: { actor: "named" }
      });

    expect(introduced.session.pendingQuestion?.kind).toBe("lane_assignment");
    expect(introduced.message).toContain('"Open gate"');
    expect(introduced.message).toContain('"Weigh load"');

    const again =
      await say(id, "And then the Dock Team loads it", {
        changes: changes({
          addLanes: [laneDraft("l_d", "Dock Team")],
          addElements: [
            {
              tempRef: "load",
              type: "task",
              name: "Load truck",
              laneRef: "l_d"
            }
          ],
          addFlows: [{ fromRef: "inspect", toRef: "load" }]
        }),
        responsibility: { actor: "named" }
      });

    expect(again.message).not.toContain('"Open gate"');
    expect(again.session.pendingQuestion?.kind).not.toBe("lane_assignment");
    expect(again.session.process.lanes).toHaveLength(2);
  });
});

// ======================================================
// DECISION HELPERS
// ======================================================

describe("responsibility decisions", () => {
  const question = (
    kind: NextQuestion["kind"]
  ): NextQuestion => ({
    required: true,
    kind,
    targetRefs: [],
    question: "?"
  });

  const assigned =
    turn(
      linearProcess(["Pick", "Pack"]),
      changes({
        addLanes: [laneDraft("l_a", "Amber Unit")],
        updateElements: [
          { id: "task_0", laneRef: "l_a" },
          { id: "task_1", laneRef: "l_a" }
        ]
      })
    );

  it("treats a who-performs question as redundant once every task has a lane", () => {
    expect(
      isRedundantResponsibilityQuestion(
        question("lane_assignment"),
        assigned,
        { askedActivityIds: [] }
      )
    ).toBe(true);
  });

  it("keeps a question about a task that is still unresolved and unasked", () => {
    const open = linearProcess(["Pick"]);

    expect(
      isRedundantResponsibilityQuestion(
        question("lane_assignment"),
        open,
        { askedActivityIds: [] }
      )
    ).toBe(false);

    expect(
      isRedundantResponsibilityQuestion(
        question("lane_assignment"),
        open,
        { askedActivityIds: ["task_0"] }
      )
    ).toBe(true);
  });

  it("drops role questions once the interviewee's role or a refusal is on record", () => {
    expect(
      isRedundantResponsibilityQuestion(
        question("actor_role"),
        assigned,
        {
          intervieweeLaneId: laneIdByName(assigned, "Amber Unit"),
          askedActivityIds: []
        }
      )
    ).toBe(true);

    expect(
      isRedundantResponsibilityQuestion(
        question("actor_role"),
        assigned,
        { distinctionDeclined: true, askedActivityIds: [] }
      )
    ).toBe(true);

    expect(
      isRedundantResponsibilityQuestion(
        question("actor_role"),
        assigned,
        { askedActivityIds: [] }
      )
    ).toBe(false);
  });

  it("never touches unrelated question kinds", () => {
    expect(
      isRedundantResponsibilityQuestion(
        question("clarification"),
        assigned,
        { distinctionDeclined: true, askedActivityIds: [] }
      )
    ).toBe(false);
  });

  it("moves on to the next process question without repeating a question", () => {
    expect(continuationMessage("Added the step.")).toBe(
      "Added the step. What happens next in the process?"
    );
    expect(continuationMessage("Who does that?")).toBe(
      "What happens next in the process?"
    );
  });

  it("resolves first-person actors to the interviewee lane without overriding explicit lanes", () => {
    const process =
      turn(
        linearProcess(["Pick", "Pack"]),
        changes({
          addLanes: [
            laneDraft("l_a", "Amber Unit"),
            laneDraft("l_b", "Birch Desk")
          ],
          updateElements: [
            { id: "task_0", laneRef: "l_a" },
            { id: "task_1", laneRef: "l_b" }
          ]
        })
      );

    const amber = laneIdByName(process, "Amber Unit");
    const birch = laneIdByName(process, "Birch Desk");

    const proposal =
      changes({
        addElements: [
          { tempRef: "x", type: "task", name: "First-person step" },
          {
            tempRef: "y",
            type: "task",
            name: "Explicit step",
            laneRef: birch
          }
        ],
        addFlows: [
          { fromRef: "task_1", toRef: "x" },
          { fromRef: "x", toRef: "y" }
        ]
      });

    const firstPerson =
      sanitizeProcessChanges(process, proposal, {
        actor: "interviewee",
        intervieweeLaneId: amber
      });

    expect(
      firstPerson.addElements.map((element) => element.laneRef)
    ).toEqual([amber, birch]);

    // Without the hint the step continues the most recent responsibility.
    const continued =
      sanitizeProcessChanges(process, proposal, { actor: "previous" });

    expect(
      continued.addElements.map((element) => element.laneRef)
    ).toEqual([birch, birch]);
  });
});
