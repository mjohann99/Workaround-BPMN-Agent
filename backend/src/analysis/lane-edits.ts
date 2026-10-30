import {
  UNASSIGNED_LANE_ID,
  UNASSIGNED_LANE_NAME
} from "../lane-constants.js";

import {
  type ProcessChanges,
  type ProcessModel
} from "../types.js";

import {
  type ProcessValidationError
} from "../process.js";

export type Clarification = {
  question: string;
  targetIds: string[];
};

export type LaneRemovalPlan = {
  changes: ProcessChanges;
  clarification?: Clarification;
};

const MAX_LISTED = 4;

function nameOf(
  process: ProcessModel,
  id: string
): string {
  return (
    process.elements.find(
      (element) => element.id === id
    )?.name ?? id
  );
}

function listNames(
  process: ProcessModel,
  ids: string[]
): string {
  const listed =
    ids
      .slice(0, MAX_LISTED)
      .map((id) => `"${nameOf(process, id)}"`)
      .join(", ");

  const remaining = ids.length - MAX_LISTED;

  return remaining > 0
    ? `${listed} and ${remaining} more`
    : listed;
}

// Lane of the nearest element outside `members` along the sequence flow.
function neighbourLane(
  process: ProcessModel,
  start: string,
  members: Set<string>,
  excluded: Set<string>,
  direction: "backward" | "forward"
): string | undefined {
  const laneById =
    new Map(
      process.elements.map(
        (element) => [element.id, element.laneId]
      )
    );

  const visited = new Set<string>([start]);
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const flow of process.flows) {
      const next =
        direction === "backward"
          ? flow.to === current ? flow.from : undefined
          : flow.from === current ? flow.to : undefined;

      if (!next || visited.has(next)) {
        continue;
      }

      visited.add(next);

      if (members.has(next)) {
        queue.push(next);
        continue;
      }

      const lane = laneById.get(next);

      if (lane && !excluded.has(lane)) {
        return lane;
      }
    }
  }

  return undefined;
}

/**
 * Decides what a lane removal needs before it can be committed.
 * Empty lanes are removed; occupied lanes are only removed when the
 * members have a clear destination, otherwise a clarification is returned
 * and nothing is applied.
 */
export function planLaneRemovals(
  process: ProcessModel,
  changes: ProcessChanges
): LaneRemovalPlan {
  const result = structuredClone(changes);

  const fallbackRequested =
    changes.removeLaneIds.includes(UNASSIGNED_LANE_ID);

  result.removeLaneIds =
    changes.removeLaneIds.filter(
      (id) => id !== UNASSIGNED_LANE_ID
    );

  const removing =
    new Set(
      result.removeLaneIds.filter(
        (id) => process.lanes.some((lane) => lane.id === id)
      )
    );

  const removedElements = new Set(changes.removeElementIds);

  const destinationByElement =
    new Map<string, string>();

  for (const update of changes.updateElements) {
    const ref = update.laneId ?? update.laneRef;

    if (ref && !removing.has(ref)) {
      destinationByElement.set(update.id, ref);
    }
  }

  // ----------------------------------------------------
  // A request to remove the system fallback band
  // ----------------------------------------------------

  if (fallbackRequested) {
    const stillUnassigned =
      process.elements.filter(
        (element) =>
          !element.laneId &&
          !removedElements.has(element.id) &&
          !destinationByElement.has(element.id)
      );

    if (stillUnassigned.length > 0 && process.lanes.length > 0) {
      const ids =
        stillUnassigned.map((element) => element.id);

      return {
        changes,
        clarification: {
          question:
            `The "${UNASSIGNED_LANE_NAME}" band only shows elements without a responsibility (${listNames(process, ids)}). Which role or department should they belong to?`,
          targetIds: ids
        }
      };
    }
  }

  // ----------------------------------------------------
  // Removal of modeled lanes
  // ----------------------------------------------------

  for (const laneId of removing) {
    const lane =
      process.lanes.find((candidate) => candidate.id === laneId)!;

    const members =
      process.elements.filter(
        (element) =>
          element.laneId === laneId &&
          !removedElements.has(element.id) &&
          !destinationByElement.has(element.id)
      );

    if (members.length === 0) {
      continue;
    }

    const memberIds = new Set(members.map((member) => member.id));

    const destinations =
      members.map(
        (member) =>
          neighbourLane(
            process,
            member.id,
            memberIds,
            removing,
            "backward"
          ) ??
          neighbourLane(
            process,
            member.id,
            memberIds,
            removing,
            "forward"
          )
      );

    const unique = new Set(destinations);
    const destination = [...unique][0];

    if (unique.size !== 1 || !destination) {
      const ids = members.map((member) => member.id);

      return {
        changes,
        clarification: {
          question:
            `Lane "${lane.name}" still contains ${listNames(process, ids)}. Which role or department should they move to before I remove it?`,
          targetIds: ids
        }
      };
    }

    for (const member of members) {
      const existing =
        result.updateElements.find(
          (update) => update.id === member.id
        );

      if (existing) {
        existing.laneId = destination;
        delete existing.laneRef;
      } else {
        result.updateElements.push({
          id: member.id,
          laneId: destination
        });
      }
    }
  }

  return { changes: result };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Replaces internal IDs in an error message with names the user knows.
function humanize(
  message: string,
  process: ProcessModel
): string {
  const names: Array<[string, string]> = [
    ...process.elements.map(
      (element): [string, string] => [element.id, element.name]
    ),
    ...process.lanes.map(
      (lane): [string, string] => [lane.id, lane.name]
    )
  ];

  return names
    .sort((a, b) => b[0].length - a[0].length)
    .reduce(
      (text, [id, name]) =>
        text.replace(
          new RegExp(`\\b${escapeRegExp(id)}\\b`, "g"),
          `"${name}"`
        ),
      message
    );
}

/** Turns a rejected update into feedback that names the missing dependency. */
export function explainRejectedUpdate(
  error: ProcessValidationError,
  process: ProcessModel
): Clarification {
  const details = error.details;

  if (details) {
    const known =
      details.elementIds.filter(
        (id) =>
          process.elements.some((element) => element.id === id)
      );

    const subject =
      known.length > 0
        ? listNames(process, known)
        : "the new activity";

    return {
      question:
        details.kind === "unknown_lane"
          ? `I couldn't apply that change because I couldn't tell which role or department ${subject} should belong to, so nothing was changed. Which role or department is it?`
          : `I couldn't apply that change because the lane of ${subject} no longer exists, so nothing was changed. Which role or department should it be in?`,
      targetIds: known
    };
  }

  return {
    question:
      `I couldn't apply that change: ${humanize(error.message, process)}. Nothing was changed. Which activities do you mean?`,
    targetIds: []
  };
}
