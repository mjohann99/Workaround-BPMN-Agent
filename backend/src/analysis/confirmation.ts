import {
  type PendingQuestion,
  type ProcessModel
} from "../types.js";

export type ConfirmationFollowUp = {
  kind: "clarification";
  targetIds: string[];
  question: string;
};

const BARE_AFFIRMATIVE_REPLY =
  /^(?:yes|yeah|yep|correct|exactly|that's right|that is right|confirmed|i confirm|ja|stimmt|genau|richtig|korrekt|bestätigt|ich bestätige)[.!?]*$/i;

export function getConfirmationFollowUp(
  message: string,
  pendingQuestion: PendingQuestion | undefined,
  process: ProcessModel
): ConfirmationFollowUp | undefined {
  if (
    !BARE_AFFIRMATIVE_REPLY.test(message.trim()) ||
    !pendingQuestion ||
    (pendingQuestion.kind !== "element_confirmation" &&
      pendingQuestion.kind !== "sequence_confirmation")
  ) {
    return undefined;
  }

  for (const targetId of [...pendingQuestion.targetIds].reverse()) {
    const element = process.elements.find(
      (candidate) => candidate.id === targetId
    );

    if (element?.type === "task") {
      return {
        kind: "clarification",
        targetIds: [element.id],
        question: `What is the next activity after "${element.name}"?`
      };
    }
  }

  return {
    kind: "clarification",
    targetIds: [],
    question: "What is the next activity in the process?"
  };
}