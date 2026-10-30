import {
  generateBpmnXml
} from "../../src/bpmn.js";
import {
  applyProcessChanges,
  createInitialProcess
} from "../../src/process.js";
import {
  repairIntervieweeRoleStatement,
  sanitizeProcessChanges
} from "../../src/process-change-sanitizer.js";
import {
  type ProcessChanges,
  type ProcessModel
} from "../../src/types.js";

export const INTERNAL = "participant_internal";

export function changes(
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

export function laneDraft(
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

// Same pipeline order as the message route (without lane planning).
export function turn(
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

export function linearProcess(
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

export function idByName(
  process: ProcessModel,
  name: string
): string {
  const element =
    process.elements.find(
      (candidate) => candidate.name === name
    );

  if (!element) {
    throw new Error(`No element named ${name}`);
  }

  return element.id;
}

export function laneIdByName(
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

export function laneOf(
  process: ProcessModel,
  name: string
): string | undefined {
  return process.elements.find(
    (element) => element.name === name
  )?.laneId;
}

export function laneMembers(
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

// Every model assignment must be reproduced by the exported BPMN.
export function exportedAssignmentsMatch(
  process: ProcessModel
): boolean {
  const xml = generateBpmnXml(process);

  return process.lanes.every(
    (lane) =>
      laneMembers(xml, lane.id).sort().join(",") ===
      process.elements
        .filter((element) => element.laneId === lane.id)
        .map((element) => element.id)
        .sort()
        .join(",")
  );
}
