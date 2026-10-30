import {
  describe,
  expect,
  it
} from "vitest";

import {
  getConfirmationFollowUp
} from "../src/analysis/confirmation.js";

import {
  createInitialProcess
} from "../src/process.js";

import {
  type PendingQuestion
} from "../src/types.js";

describe("confirmation follow-up", () => {
  it("advances after a bare yes to an activity confirmation", () => {
    const process = createInitialProcess();
    process.elements.push({
      id: "task_1",
      type: "task",
      name: "Withdraw raw materials"
    });

    const pendingQuestion: PendingQuestion = {
      id: "question_1",
      kind: "element_confirmation",
      targetIds: ["task_1"],
      question:
        'Is "Withdraw raw materials" correctly captured as the first activity?'
    };

    expect(
      getConfirmationFollowUp(
        "Yes",
        pendingQuestion,
        process
      )
    ).toEqual({
      kind: "clarification",
      targetIds: ["task_1"],
      question:
        'What is the next activity after "Withdraw raw materials"?'
    });
  });

  it("leaves affirmative replies with new details to normal extraction", () => {
    const process = createInitialProcess();
    const pendingQuestion: PendingQuestion = {
      id: "question_1",
      kind: "element_confirmation",
      targetIds: [],
      question: "Is this activity correct?"
    };

    expect(
      getConfirmationFollowUp(
        "Yes, then I check the stock level.",
        pendingQuestion,
        process
      )
    ).toBeUndefined();
  });
});