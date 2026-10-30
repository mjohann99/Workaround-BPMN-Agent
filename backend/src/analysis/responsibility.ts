import {
  normalizeOrganizationName
} from "../process.js";

import {
  type NextQuestion,
  type ProcessModel,
  type ResponsibilityHint,
  type ResponsibilityState
} from "../types.js";

export type ResponsibilityQuestion = {
  question: string;
  targetIds: string[];
};

const MAX_LISTED_ACTIVITIES = 3;

// Question kinds that ask who performs something.
const RESPONSIBILITY_QUESTION_KINDS =
  new Set<string>(["actor_role", "lane_assignment"]);

/** True when a lane was added/removed or any element's lane changed. */
export function laneAssignmentsChanged(
  before: ProcessModel,
  after: ProcessModel
): boolean {
  const beforeLaneIds =
    before.lanes.map((lane) => lane.id).join("|");

  const afterLaneIds =
    after.lanes.map((lane) => lane.id).join("|");

  if (beforeLaneIds !== afterLaneIds) {
    return true;
  }

  const beforeLaneByElement =
    new Map(
      before.elements.map(
        (element) => [element.id, element.laneId]
      )
    );

  return after.elements.some(
    (element) =>
      beforeLaneByElement.has(element.id) &&
      beforeLaneByElement.get(element.id) !==
      element.laneId
  );
}

/** Tasks that have no lane while the process already uses lanes. */
export function unassignedTasks(
  process: ProcessModel
): ProcessModel["elements"] {
  return process.lanes.length === 0
    ? []
    : tasksWithoutLane(process);
}

export function tasksWithoutLane(
  process: ProcessModel
): ProcessModel["elements"] {
  return process.elements.filter(
    (element) =>
      element.type === "task" &&
      !element.laneId
  );
}

/**
 * Once lanes exist, activities without a responsibility are
 * ambiguous; ask once instead of guessing a lane.
 */
export function buildResponsibilityQuestion(
  process: ProcessModel,
  excludeIds: string[] = []
): ResponsibilityQuestion | undefined {
  const unassigned =
    unassignedTasks(process).filter(
      (task) => !excludeIds.includes(task.id)
    );

  if (unassigned.length === 0) {
    return undefined;
  }

  const listed =
    unassigned
      .slice(0, MAX_LISTED_ACTIVITIES)
      .map((task) => `"${task.name}"`)
      .join(", ");

  const remaining =
    unassigned.length - MAX_LISTED_ACTIVITIES;

  return {
    question:
      `Which role or department performs ${listed}${remaining > 0
        ? ` and ${remaining} more`
        : ""}?`,
    targetIds:
      unassigned.map((task) => task.id)
  };
}

export function laneIdForRole(
  process: ProcessModel,
  roleName: string
): string | undefined {
  const normalized =
    normalizeOrganizationName(roleName);

  return normalized
    ? process.lanes.find(
      (lane) =>
        normalizeOrganizationName(lane.name) ===
        normalized
    )?.id
    : undefined;
}

/** Lane of the most recently captured activity that has one. */
export function currentResponsibility(
  process: ProcessModel
): { laneId: string; name: string } | undefined {
  for (
    const element of [...process.elements].reverse()
  ) {
    if (element.type !== "task" || !element.laneId) {
      continue;
    }

    const lane =
      process.lanes.find(
        (candidate) => candidate.id === element.laneId
      );

    if (lane) {
      return { laneId: lane.id, name: lane.name };
    }
  }

  return undefined;
}

export function intervieweeResponsibility(
  process: ProcessModel,
  state: ResponsibilityState | undefined
): { laneId: string; name: string } | undefined {
  const lane =
    process.lanes.find(
      (candidate) =>
        candidate.id === state?.intervieweeLaneId
    );

  return lane
    ? { laneId: lane.id, name: lane.name }
    : undefined;
}

/** Asks only about activities that are still unresolved and never asked about. */
export function selectResponsibilityQuestion(
  process: ProcessModel,
  state: ResponsibilityState | undefined,
  laneStructureChanged: boolean
): ResponsibilityQuestion | undefined {
  return laneStructureChanged
    ? buildResponsibilityQuestion(
      process,
      state?.askedActivityIds ?? []
    )
    : undefined;
}

/** Drops model questions that ask for responsibility already known. */
export function isRedundantResponsibilityQuestion(
  question: NextQuestion,
  process: ProcessModel,
  state: ResponsibilityState | undefined
): boolean {
  if (
    !question.required ||
    !RESPONSIBILITY_QUESTION_KINDS.has(question.kind)
  ) {
    return false;
  }

  if (question.kind === "actor_role") {
    return Boolean(
      state?.distinctionDeclined ||
      intervieweeResponsibility(process, state)
    );
  }

  const asked = state?.askedActivityIds ?? [];

  return tasksWithoutLane(process).every(
    (task) => asked.includes(task.id)
  );
}

/** Keeps the confirmation (when it is not itself a question) and moves on. */
export function continuationMessage(
  assistantMessage: string
): string {
  const statement =
    assistantMessage.includes("?")
      ? ""
      : assistantMessage.trim();

  return `${statement} What happens next in the process?`.trim();
}

/** State to remember after a committed turn. */
export function responsibilityStatePatch(
  process: ProcessModel,
  hint: ResponsibilityHint | undefined,
  repairedRoleName: string | undefined
): Partial<ResponsibilityState> {
  const patch: Partial<ResponsibilityState> = {};

  const role =
    repairedRoleName ??
    (hint?.intervieweeRole?.trim() || undefined);

  const laneId =
    role
      ? laneIdForRole(process, role)
      : undefined;

  if (laneId) {
    patch.intervieweeLaneId = laneId;
  }

  if (hint?.noFurtherDetail === true) {
    patch.distinctionDeclined = true;
  }

  return patch;
}
