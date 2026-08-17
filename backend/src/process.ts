import nodeProcess from "node:process";

import {
  type ProcessChanges,
  type ProcessElement,
  type ProcessElementDraft,
  type ProcessElementUpdate,
  type ProcessModel,
  type WorkaroundCandidate,
  type WorkaroundCandidateDraft
} from "./types.js";

export class ProcessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessValidationError";
  }
}

const WORKAROUND_SIGNAL_REGEX =
  /normally i should|instead|because the system cannot|because .* does not allow|i have to|i use another tool because|i don't have authorization|the normal process doesn't work|workaround/i;

const CONFIRMATION_REGEX =
  /\b(yes|i confirm|confirmed|correct|that's right|that is right|exactly|ja|stimmt|genau|richtig|korrekt|bestätigt|ich bestätige)\b/i;

export function createInitialProcess(
  name = "Employee Process"
): ProcessModel {
  return {
    id: "process_main",

    name,

    status: "eliciting",

    participants: [
      {
        id: "participant_internal",
        name: "Own organization",
        type: "internal",
        processVisibility: "white_box"
      }
    ],

    lanes: [],

    elements: [
      {
        id: "start_1",
        type: "start",
        name: "Process Trigger",
        participantId: "participant_internal"
      }
    ],

    flows: [],

    messageFlows: [],

    workarounds: [],

    updatedAt: new Date().toISOString()
  };
}

export function detectWorkaroundSignal(text: string): boolean {
  return WORKAROUND_SIGNAL_REGEX.test(text);
}

export function isExplicitConfirmation(text: string): boolean {
  return CONFIRMATION_REGEX.test(text);
}

function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function assertUniqueIds(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) {
      throw new ProcessValidationError(`Missing ${label} id`);
    }
    if (seen.has(value)) {
      throw new ProcessValidationError(`Duplicate ${label} id: ${value}`);
    }
    seen.add(value);
  }
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "element";
}

function computeStatus(
  process: ProcessModel
): ProcessModel["status"] {
  const tasks = process.elements.filter(
    (
      element
    ): element is Extract<
      ProcessElement,
      { type: "task" }
    > => element.type === "task"
  );

  if (tasks.length === 0) {
    return "eliciting";
  }

  const hasPendingWorkaround =
    process.workarounds.some(
      (workaround) =>
        workaround.status === "suspected"
    );

  if (hasPendingWorkaround) {
    return "review";
  }

  if (
    tasks.every(
      (task) =>
        task.employeeConfirmed === true
    )
  ) {
    return "confirmed";
  }

  return "eliciting";
}

function sanitizeTaskUpdateForConfirmation(
  update: ProcessElementUpdate,
  userMessage: string
): ProcessElementUpdate {
  if (update.workaroundConfirmed === true && !isExplicitConfirmation(userMessage)) {
    return { ...update, workaroundConfirmed: false };
  }
  return update;
}

function sanitizeTaskForConfirmation(
  task: Extract<ProcessElement, { type: "task" }>,
  userMessage: string
): Extract<ProcessElement, { type: "task" }> {
  if (task.workaroundConfirmed === true && !isExplicitConfirmation(userMessage)) {
    return { ...task, workaroundConfirmed: false };
  }
  return task;
}

export function validateProcessModel(
  process: ProcessModel
): void {
  // ====================================================
  // UNIQUE IDS WITHIN EACH MODEL AREA
  // ====================================================

  assertUniqueIds(
    process.participants.map(
      (participant) => participant.id
    ),
    "participant"
  );

  assertUniqueIds(
    process.lanes.map(
      (lane) => lane.id
    ),
    "lane"
  );

  assertUniqueIds(
    process.elements.map(
      (element) => element.id
    ),
    "element"
  );

  assertUniqueIds(
    process.flows.map(
      (flow) => flow.id
    ),
    "flow"
  );

  assertUniqueIds(
    process.messageFlows.map(
      (flow) => flow.id
    ),
    "message flow"
  );

  assertUniqueIds(
    process.workarounds.map(
      (workaround) => workaround.id
    ),
    "workaround"
  );

  // ====================================================
  // BPMN IDS SHOULD BE GLOBALLY UNIQUE
  // ====================================================

  const allBpmnIds = [
    ...process.participants.map(
      (participant) => participant.id
    ),
    ...process.lanes.map(
      (lane) => lane.id
    ),
    ...process.elements.map(
      (element) => element.id
    ),
    ...process.flows.map(
      (flow) => flow.id
    ),
    ...process.messageFlows.map(
      (flow) => flow.id
    )
  ];

  assertUniqueIds(
    allBpmnIds,
    "BPMN object"
  );

  // ====================================================
  // LOOKUP MAPS
  // ====================================================

  const participantsById = new Map(
    process.participants.map(
      (participant) => [
        participant.id,
        participant
      ]
    )
  );

  const lanesById = new Map(
    process.lanes.map(
      (lane) => [
        lane.id,
        lane
      ]
    )
  );

  const elementsById = new Map(
    process.elements.map(
      (element) => [
        element.id,
        element
      ]
    )
  );

  // ====================================================
  // BASIC PARTICIPANT MODEL
  // ====================================================
  //
  // For the current prototype:
  //
  // - exactly one internal white-box participant
  // - external participants are normally black-box
  //
  // This prevents the LLM from accidentally turning
  // departments into separate internal pools.
  // ====================================================

  const internalWhiteBoxParticipants =
    process.participants.filter(
      (participant) =>
        participant.type === "internal" &&
        participant.processVisibility ===
        "white_box"
    );

  if (
    internalWhiteBoxParticipants.length !== 1
  ) {
    throw new ProcessValidationError(
      `Process must contain exactly one internal white-box participant, but found ${internalWhiteBoxParticipants.length}`
    );
  }

  // ====================================================
  // VALIDATE LANES
  // ====================================================

  for (const lane of process.lanes) {
    const participant =
      participantsById.get(
        lane.participantId
      );

    if (!participant) {
      throw new ProcessValidationError(
        `Lane ${lane.id} references missing participant ${lane.participantId}`
      );
    }

    // A black-box pool has no modeled internal behavior,
    // therefore it must not contain lanes.
    if (
      participant.processVisibility ===
      "black_box"
    ) {
      throw new ProcessValidationError(
        `Lane ${lane.id} belongs to black-box participant ${participant.id}`
      );
    }
  }

  // ====================================================
  // VALIDATE ELEMENT ORGANIZATIONAL ASSIGNMENTS
  // ====================================================

  for (const element of process.elements) {
    let elementParticipantId =
      element.participantId;

    if (element.participantId) {
      const participant =
        participantsById.get(
          element.participantId
        );

      if (!participant) {
        throw new ProcessValidationError(
          `Element ${element.id} references missing participant ${element.participantId}`
        );
      }

      if (
        participant.processVisibility ===
        "black_box"
      ) {
        throw new ProcessValidationError(
          `Element ${element.id} cannot belong to black-box participant ${participant.id}`
        );
      }
    }

    if (element.laneId) {
      const lane =
        lanesById.get(
          element.laneId
        );

      if (!lane) {
        throw new ProcessValidationError(
          `Element ${element.id} references missing lane ${element.laneId}`
        );
      }

      // If participantId is explicitly present on the
      // element, it must agree with the lane.
      if (
        elementParticipantId &&
        lane.participantId !==
        elementParticipantId
      ) {
        throw new ProcessValidationError(
          `Element ${element.id} belongs to participant ${elementParticipantId}, but lane ${lane.id} belongs to participant ${lane.participantId}`
        );
      }

      // An element may have only laneId while the
      // participant is implied through that lane.
      if (!elementParticipantId) {
        elementParticipantId =
          lane.participantId;
      }
    }
  }

  // ====================================================
  // HELPER:
  // RESOLVE PARTICIPANT OF AN ELEMENT
  // ====================================================

  const getElementParticipantId = (
    elementId: string
  ): string | undefined => {
    const element =
      elementsById.get(elementId);

    if (!element) {
      return undefined;
    }

    if (element.participantId) {
      return element.participantId;
    }

    if (element.laneId) {
      return lanesById.get(
        element.laneId
      )?.participantId;
    }

    return undefined;
  };

  // ====================================================
  // VALIDATE SEQUENCE FLOWS
  // ====================================================

  for (const flow of process.flows) {
    const source =
      elementsById.get(flow.from);

    if (!source) {
      throw new ProcessValidationError(
        `Flow ${flow.id} references missing source ${flow.from}`
      );
    }

    const target =
      elementsById.get(flow.to);

    if (!target) {
      throw new ProcessValidationError(
        `Flow ${flow.id} references missing target ${flow.to}`
      );
    }

    const sourceParticipantId =
      getElementParticipantId(
        source.id
      );

    const targetParticipantId =
      getElementParticipantId(
        target.id
      );

    // BPMN Sequence Flows may cross lanes,
    // but must not cross pools.
    if (
      sourceParticipantId &&
      targetParticipantId &&
      sourceParticipantId !==
      targetParticipantId
    ) {
      throw new ProcessValidationError(
        `Sequence flow ${flow.id} crosses participant boundary from ${sourceParticipantId} to ${targetParticipantId}. Use a message flow instead.`
      );
    }
  }

  // ====================================================
  // VALIDATE MESSAGE FLOWS
  // ====================================================

  for (
    const messageFlow of
    process.messageFlows
  ) {
    const sourceParticipant =
      participantsById.get(
        messageFlow.fromParticipantId
      );

    if (!sourceParticipant) {
      throw new ProcessValidationError(
        `Message flow ${messageFlow.id} references missing source participant ${messageFlow.fromParticipantId}`
      );
    }

    const targetParticipant =
      participantsById.get(
        messageFlow.toParticipantId
      );

    if (!targetParticipant) {
      throw new ProcessValidationError(
        `Message flow ${messageFlow.id} references missing target participant ${messageFlow.toParticipantId}`
      );
    }

    // Message flows are specifically for communication
    // between different BPMN participants.
    if (
      messageFlow.fromParticipantId ===
      messageFlow.toParticipantId
    ) {
      throw new ProcessValidationError(
        `Message flow ${messageFlow.id} connects participant ${messageFlow.fromParticipantId} to itself`
      );
    }

    if (messageFlow.sourceElementId) {
      const sourceElement =
        elementsById.get(
          messageFlow.sourceElementId
        );

      if (!sourceElement) {
        throw new ProcessValidationError(
          `Message flow ${messageFlow.id} references missing source element ${messageFlow.sourceElementId}`
        );
      }

      const sourceElementParticipantId =
        getElementParticipantId(
          sourceElement.id
        );

      if (
        sourceElementParticipantId &&
        sourceElementParticipantId !==
        messageFlow.fromParticipantId
      ) {
        throw new ProcessValidationError(
          `Message flow ${messageFlow.id} source element ${sourceElement.id} belongs to participant ${sourceElementParticipantId}, not ${messageFlow.fromParticipantId}`
        );
      }
    }

    if (messageFlow.targetElementId) {
      const targetElement =
        elementsById.get(
          messageFlow.targetElementId
        );

      if (!targetElement) {
        throw new ProcessValidationError(
          `Message flow ${messageFlow.id} references missing target element ${messageFlow.targetElementId}`
        );
      }

      const targetElementParticipantId =
        getElementParticipantId(
          targetElement.id
        );

      if (
        targetElementParticipantId &&
        targetElementParticipantId !==
        messageFlow.toParticipantId
      ) {
        throw new ProcessValidationError(
          `Message flow ${messageFlow.id} target element ${targetElement.id} belongs to participant ${targetElementParticipantId}, not ${messageFlow.toParticipantId}`
        );
      }
    }
  }

  // ====================================================
  // VALIDATE WORKAROUND REFERENCES
  // ====================================================

  for (
    const workaround of
    process.workarounds
  ) {
    for (
      const activityId of
      workaround.relatedActivityIds
    ) {
      const element =
        elementsById.get(activityId);

      if (!element) {
        throw new ProcessValidationError(
          `Workaround ${workaround.id} references missing activity ${activityId}`
        );
      }

      if (element.type !== "task") {
        throw new ProcessValidationError(
          `Workaround ${workaround.id} references non-task element ${activityId}`
        );
      }
    }
  }
}

export function applyProcessChanges(
  process: ProcessModel,
  changes: ProcessChanges,
  userMessage: string
): {
  process: ProcessModel;
  processChanges: ProcessChanges;
} {
  // ====================================================
  // CLONE CURRENT PROCESS
  // ====================================================

  const cloned: ProcessModel = {
    ...process,

    // Compatibility with sessions created before
    // participants/pools were introduced.
    participants:
      process.participants?.length
        ? process.participants.map(
          (participant) => ({
            ...participant
          })
        )
        : [
          {
            id: "participant_internal",
            name: "Own organization",
            type: "internal",
            processVisibility: "white_box"
          }
        ],

    lanes:
      (process.lanes ?? []).map(
        (lane) => ({
          ...lane
        })
      ),

    elements:
      process.elements.map(
        (element) => ({
          ...element
        })
      ),

    flows:
      process.flows.map(
        (flow) => ({
          ...flow
        })
      ),

    messageFlows:
      (process.messageFlows ?? []).map(
        (flow) => ({
          ...flow
        })
      ),

    workarounds:
      process.workarounds.map(
        (workaround) => ({
          ...workaround,

          relatedActivityIds: [
            ...workaround.relatedActivityIds
          ],

          evidenceMessageIds: [
            ...workaround.evidenceMessageIds
          ]
        })
      )
  };

  // ====================================================
  // NORMALIZE CHANGES
  // ====================================================

  const applied: ProcessChanges = {
    // Participants / Pools
    addParticipants:
      (changes.addParticipants ?? []).map(
        (participant) => ({
          ...participant
        })
      ),

    updateParticipants:
      (changes.updateParticipants ?? []).map(
        (update) => ({
          ...update
        })
      ),

    removeParticipantIds: [
      ...(changes.removeParticipantIds ?? [])
    ],

    // Lanes
    addLanes:
      (changes.addLanes ?? []).map(
        (lane) => ({
          ...lane
        })
      ),

    updateLanes:
      (changes.updateLanes ?? []).map(
        (update) => ({
          ...update
        })
      ),

    removeLaneIds: [
      ...(changes.removeLaneIds ?? [])
    ],

    // Elements
    addElements:
      (changes.addElements ?? []).map(
        (element) => ({
          ...element
        })
      ),

    updateElements:
      (changes.updateElements ?? []).map(
        (update) => ({
          ...update
        })
      ),

    removeElementIds: [
      ...(changes.removeElementIds ?? [])
    ],

    // Sequence Flows
    addFlows:
      (changes.addFlows ?? []).map(
        (flow) => ({
          ...flow
        })
      ),

    removeFlowIds: [
      ...(changes.removeFlowIds ?? [])
    ],

    // Message Flows
    addMessageFlows:
      (changes.addMessageFlows ?? []).map(
        (flow) => ({
          ...flow
        })
      ),

    removeMessageFlowIds: [
      ...(changes.removeMessageFlowIds ?? [])
    ],

    // Workarounds
    addWorkarounds:
      (changes.addWorkarounds ?? []).map(
        (workaround) => ({
          ...workaround
        })
      ),

    updateWorkarounds:
      (changes.updateWorkarounds ?? []).map(
        (update) => ({
          ...update,

          relatedActivityIds:
            update.relatedActivityIds
              ? [...update.relatedActivityIds]
              : undefined,

          evidenceMessageIds:
            update.evidenceMessageIds
              ? [...update.evidenceMessageIds]
              : undefined
        })
      )
  };

  // ====================================================
  // WORKING COPIES
  // ====================================================

  let nextParticipants =
    cloned.participants.map(
      (participant) => ({
        ...participant
      })
    );

  let nextLanes =
    cloned.lanes.map(
      (lane) => ({
        ...lane
      })
    );

  let nextElements =
    cloned.elements.map(
      (element) => ({
        ...element
      })
    );

  let nextFlows =
    cloned.flows.map(
      (flow) => ({
        ...flow
      })
    );

  let nextMessageFlows =
    cloned.messageFlows.map(
      (flow) => ({
        ...flow
      })
    );

  let nextWorkarounds =
    cloned.workarounds.map(
      (workaround) => ({
        ...workaround,
        relatedActivityIds: [
          ...workaround.relatedActivityIds
        ],
        evidenceMessageIds: [
          ...workaround.evidenceMessageIds
        ]
      })
    );

  // ====================================================
  // VALIDATE REMOVE IDS EXIST
  // ====================================================

  const existingParticipantIds =
    new Set(
      nextParticipants.map(
        (participant) =>
          participant.id
      )
    );

  for (
    const participantId of
    applied.removeParticipantIds
  ) {
    if (
      !existingParticipantIds.has(
        participantId
      )
    ) {
      throw new ProcessValidationError(
        `Cannot remove missing participant ${participantId}`
      );
    }
  }

  const existingLaneIds =
    new Set(
      nextLanes.map(
        (lane) => lane.id
      )
    );

  for (
    const laneId of
    applied.removeLaneIds
  ) {
    if (
      !existingLaneIds.has(laneId)
    ) {
      throw new ProcessValidationError(
        `Cannot remove missing lane ${laneId}`
      );
    }
  }

  const existingElementIds =
    new Set(
      nextElements.map(
        (element) => element.id
      )
    );

  for (
    const elementId of
    applied.removeElementIds
  ) {
    if (
      !existingElementIds.has(
        elementId
      )
    ) {
      throw new ProcessValidationError(
        `Cannot remove missing element ${elementId}`
      );
    }
  }

  const existingFlowIds =
    new Set(
      nextFlows.map(
        (flow) => flow.id
      )
    );

  for (
    const flowId of
    applied.removeFlowIds
  ) {
    if (
      !existingFlowIds.has(flowId)
    ) {
      throw new ProcessValidationError(
        `Cannot remove missing flow ${flowId}`
      );
    }
  }

  const existingMessageFlowIds =
    new Set(
      nextMessageFlows.map(
        (flow) => flow.id
      )
    );

  for (
    const flowId of
    applied.removeMessageFlowIds
  ) {
    if (
      !existingMessageFlowIds.has(
        flowId
      )
    ) {
      throw new ProcessValidationError(
        `Cannot remove missing message flow ${flowId}`
      );
    }
  }

  // ====================================================
  // APPLY REMOVALS FIRST
  // ====================================================
  //
  // Referential integrity is checked at the end by
  // validateProcessModel().
  //
  // This allows atomic changes such as:
  //
  // - remove lane A
  // - move task to lane B
  //
  // in one ProcessChanges object.
  // ====================================================

  nextParticipants =
    nextParticipants.filter(
      (participant) =>
        !applied.removeParticipantIds.includes(
          participant.id
        )
    );

  nextLanes =
    nextLanes.filter(
      (lane) =>
        !applied.removeLaneIds.includes(
          lane.id
        )
    );

  nextElements =
    nextElements.filter(
      (element) =>
        !applied.removeElementIds.includes(
          element.id
        )
    );

  nextFlows =
    nextFlows.filter(
      (flow) =>
        !applied.removeFlowIds.includes(
          flow.id
        )
    );

  nextMessageFlows =
    nextMessageFlows.filter(
      (flow) =>
        !applied.removeMessageFlowIds.includes(
          flow.id
        )
    );

  // ====================================================
  // GLOBAL BPMN ID MANAGEMENT
  // ====================================================

  const usedBpmnIds =
    new Set<string>([
      ...nextParticipants.map(
        (participant) =>
          participant.id
      ),

      ...nextLanes.map(
        (lane) =>
          lane.id
      ),

      ...nextElements.map(
        (element) =>
          element.id
      ),

      ...nextFlows.map(
        (flow) =>
          flow.id
      ),

      ...nextMessageFlows.map(
        (flow) =>
          flow.id
      )
    ]);

  const allocateBpmnId = (
    requestedId: string | undefined,
    prefix: string
  ): string => {
    const raw =
      requestedId?.trim() ||
      `${prefix}_${usedBpmnIds.size + 1}`;

    const sanitized =
      sanitizeId(raw);

    const baseId =
      sanitized || prefix;

    let finalId =
      baseId;

    let counter = 1;

    while (
      usedBpmnIds.has(finalId)
    ) {
      finalId =
        `${baseId}_${counter}`;

      counter += 1;
    }

    usedBpmnIds.add(finalId);

    return finalId;
  };

  // ====================================================
  // TEMP REF MAPS
  // ====================================================

  const tempRefToParticipantId =
    new Map<string, string>();

  const tempRefToLaneId =
    new Map<string, string>();

  const tempRefToElementId =
    new Map<string, string>();

  // ====================================================
  // 1. ADD PARTICIPANTS / POOLS
  // ====================================================

  for (
    const draft of
    applied.addParticipants
  ) {
    const finalId =
      allocateBpmnId(
        draft.tempRef,
        "participant"
      );

    tempRefToParticipantId.set(
      draft.tempRef,
      finalId
    );

    nextParticipants.push({
      id: finalId,

      name:
        draft.name.trim(),

      type:
        draft.type,

      processVisibility:
        draft.processVisibility
    });
  }

  // ====================================================
  // PARTICIPANT LOOKUP
  // ====================================================

  let participantsById =
    new Map(
      nextParticipants.map(
        (participant) => [
          participant.id,
          participant
        ]
      )
    );

  const resolveParticipantRef = (
    ref: string | undefined
  ): string | undefined => {
    if (!ref) {
      return undefined;
    }

    const fromTempRef =
      tempRefToParticipantId.get(
        ref
      );

    if (fromTempRef) {
      return fromTempRef;
    }

    if (
      participantsById.has(ref)
    ) {
      return ref;
    }

    return undefined;
  };

  // ====================================================
  // 2. UPDATE PARTICIPANTS
  // ====================================================

  for (
    const update of
    applied.updateParticipants
  ) {
    const index =
      nextParticipants.findIndex(
        (participant) =>
          participant.id === update.id
      );

    if (index === -1) {
      throw new ProcessValidationError(
        `Cannot update missing participant ${update.id}`
      );
    }

    const existing =
      nextParticipants[index];

    const merged = {
      ...existing
    };

    if (
      update.name != null &&
      update.name.trim() !== ""
    ) {
      merged.name =
        update.name.trim();
    }

    if (
      update.type != null
    ) {
      merged.type =
        update.type;
    }

    if (
      update.processVisibility != null
    ) {
      merged.processVisibility =
        update.processVisibility;
    }

    nextParticipants[index] =
      merged;
  }

  participantsById =
    new Map(
      nextParticipants.map(
        (participant) => [
          participant.id,
          participant
        ]
      )
    );

  // ====================================================
  // DEFAULT INTERNAL WHITE-BOX PARTICIPANT
  // ====================================================

  const defaultInternalParticipantId =
    nextParticipants.find(
      (participant) =>
        participant.type ===
        "internal" &&
        participant.processVisibility ===
        "white_box"
    )?.id;

  // ====================================================
  // 3. ADD LANES
  // ====================================================

  for (
    const draft of
    applied.addLanes
  ) {
    const participantId =
      resolveParticipantRef(
        draft.participantRef
      );

    if (!participantId) {
      throw new ProcessValidationError(
        `Lane ${draft.tempRef} references unknown participant ${draft.participantRef}`
      );
    }

    const finalId =
      allocateBpmnId(
        draft.tempRef,
        "lane"
      );

    tempRefToLaneId.set(
      draft.tempRef,
      finalId
    );

    nextLanes.push({
      id: finalId,

      participantId,

      name:
        draft.name.trim(),

      type:
        draft.type
    });
  }

  // ====================================================
  // LANE LOOKUP
  // ====================================================

  let lanesById =
    new Map(
      nextLanes.map(
        (lane) => [
          lane.id,
          lane
        ]
      )
    );

  const resolveLaneRef = (
    ref: string | undefined
  ): string | undefined => {
    if (!ref) {
      return undefined;
    }

    const fromTempRef =
      tempRefToLaneId.get(
        ref
      );

    if (fromTempRef) {
      return fromTempRef;
    }

    if (
      lanesById.has(ref)
    ) {
      return ref;
    }

    return undefined;
  };

  // ====================================================
  // 4. UPDATE LANES
  // ====================================================

  for (
    const update of
    applied.updateLanes
  ) {
    const index =
      nextLanes.findIndex(
        (lane) =>
          lane.id === update.id
      );

    if (index === -1) {
      throw new ProcessValidationError(
        `Cannot update missing lane ${update.id}`
      );
    }

    const existing =
      nextLanes[index];

    const merged = {
      ...existing
    };

    if (
      update.name != null &&
      update.name.trim() !== ""
    ) {
      merged.name =
        update.name.trim();
    }

    if (
      update.type != null
    ) {
      merged.type =
        update.type;
    }

    let resolvedParticipantId:
      | string
      | undefined;

    if (
      update.participantId != null
    ) {
      if (
        !participantsById.has(
          update.participantId
        )
      ) {
        throw new ProcessValidationError(
          `Lane ${update.id} references unknown participant ${update.participantId}`
        );
      }

      resolvedParticipantId =
        update.participantId;
    }

    if (
      update.participantRef != null
    ) {
      const fromRef =
        resolveParticipantRef(
          update.participantRef
        );

      if (!fromRef) {
        throw new ProcessValidationError(
          `Lane ${update.id} references unknown participant ${update.participantRef}`
        );
      }

      if (
        resolvedParticipantId &&
        resolvedParticipantId !==
        fromRef
      ) {
        throw new ProcessValidationError(
          `Lane ${update.id} contains conflicting participant references`
        );
      }

      resolvedParticipantId =
        fromRef;
    }

    if (resolvedParticipantId) {
      merged.participantId =
        resolvedParticipantId;
    }

    nextLanes[index] =
      merged;
  }

  lanesById =
    new Map(
      nextLanes.map(
        (lane) => [
          lane.id,
          lane
        ]
      )
    );

  // ====================================================
  // 5. ADD PROCESS ELEMENTS
  // ====================================================

  for (
    const candidate of
    applied.addElements
  ) {
    const finalId =
      allocateBpmnId(
        candidate.id ??
        candidate.tempRef,
        candidate.type
      );

    if (candidate.tempRef) {
      tempRefToElementId.set(
        candidate.tempRef,
        finalId
      );
    }

    let participantId =
      resolveParticipantRef(
        candidate.participantRef
      );

    let laneId =
      resolveLaneRef(
        candidate.laneRef
      );

    if (
      candidate.participantRef &&
      !participantId
    ) {
      throw new ProcessValidationError(
        `Element ${candidate.tempRef ?? finalId} references unknown participant ${candidate.participantRef}`
      );
    }

    if (
      candidate.laneRef &&
      !laneId
    ) {
      throw new ProcessValidationError(
        `Element ${candidate.tempRef ?? finalId} references unknown lane ${candidate.laneRef}`
      );
    }

    // If a lane is known, its participant can be inferred.
    if (laneId) {
      const lane =
        lanesById.get(laneId);

      if (!lane) {
        throw new ProcessValidationError(
          `Element ${finalId} references missing lane ${laneId}`
        );
      }

      if (
        participantId &&
        participantId !==
        lane.participantId
      ) {
        throw new ProcessValidationError(
          `Element ${finalId} references participant ${participantId}, but lane ${laneId} belongs to participant ${lane.participantId}`
        );
      }

      participantId =
        participantId ??
        lane.participantId;
    }

    // In this prototype all modeled flow nodes belong
    // to the one internal white-box process unless an
    // explicit organizational assignment says otherwise.
    if (
      !participantId &&
      defaultInternalParticipantId
    ) {
      participantId =
        defaultInternalParticipantId;
    }

    // --------------------------------------------------
    // TASK
    // --------------------------------------------------

    if (
      candidate.type === "task"
    ) {
      const task: Extract<
        ProcessElement,
        { type: "task" }
      > = {
        id:
          finalId,

        type:
          "task",

        name:
          candidate.name.trim(),

        participantId,

        laneId
      };

      if (
        candidate.performer != null &&
        candidate.performer.trim() !== ""
      ) {
        task.performer =
          candidate.performer.trim();
      }

      if (
        candidate.system != null &&
        candidate.system.trim() !== ""
      ) {
        task.system =
          candidate.system.trim();
      }

      if (
        candidate.executionType != null
      ) {
        task.executionType =
          candidate.executionType;
      }

      if (
        candidate.employeeConfirmed != null
      ) {
        task.employeeConfirmed =
          candidate.employeeConfirmed;
      }

      if (
        candidate.workaroundCandidate != null
      ) {
        task.workaroundCandidate =
          candidate.workaroundCandidate;
      }

      if (
        candidate.workaroundConfirmed != null
      ) {
        task.workaroundConfirmed =
          candidate.workaroundConfirmed;
      }

      if (
        candidate.workaroundReason != null &&
        candidate.workaroundReason.trim() !== ""
      ) {
        task.workaroundReason =
          candidate.workaroundReason.trim();
      }

      if (
        candidate.workaroundCategory != null
      ) {
        task.workaroundCategory =
          candidate.workaroundCategory;
      }

      const normalizedTask =
        sanitizeTaskForConfirmation(
          task,
          userMessage
        );

      nextElements.push(
        normalizedTask
      );

      continue;
    }

    // --------------------------------------------------
    // START / GATEWAY / END
    // --------------------------------------------------

    nextElements.push({
      id:
        finalId,

      type:
        candidate.type,

      name:
        candidate.name.trim(),

      participantId,

      laneId
    } as ProcessElement);
  }

  // ====================================================
  // ELEMENT LOOKUP
  // ====================================================

  let elementsById =
    new Map(
      nextElements.map(
        (element) => [
          element.id,
          element
        ]
      )
    );

  const resolveElementRef = (
    ref: string | undefined
  ): string | undefined => {
    if (!ref) {
      return undefined;
    }

    const fromTempRef =
      tempRefToElementId.get(
        ref
      );

    if (fromTempRef) {
      return fromTempRef;
    }

    if (
      elementsById.has(ref)
    ) {
      return ref;
    }

    return undefined;
  };

  // ====================================================
  // 6. UPDATE PROCESS ELEMENTS
  // ====================================================

  const sanitizedUpdates =
    applied.updateElements.map(
      (update) =>
        sanitizeTaskUpdateForConfirmation(
          update,
          userMessage
        )
    );

  for (
    const update of
    sanitizedUpdates
  ) {
    const index =
      nextElements.findIndex(
        (element) =>
          element.id === update.id
      );

    if (index === -1) {
      throw new ProcessValidationError(
        `Cannot update missing element ${update.id}`
      );
    }

    const existingElement =
      nextElements[index];

    const cleanUpdate: Omit<
      ProcessElementUpdate,
      "id" | "participantRef" | "laneRef"
    > = {};

    // --------------------------------------------------
    // COMMON PROPERTIES
    // --------------------------------------------------

    if (
      update.name != null &&
      update.name.trim() !== ""
    ) {
      cleanUpdate.name =
        update.name.trim();
    }

    // --------------------------------------------------
    // PARTICIPANT ASSIGNMENT
    // --------------------------------------------------

    let resolvedParticipantId:
      | string
      | undefined;

    if (
      update.participantId != null
    ) {
      if (
        !participantsById.has(
          update.participantId
        )
      ) {
        throw new ProcessValidationError(
          `Element ${update.id} references unknown participant ${update.participantId}`
        );
      }

      resolvedParticipantId =
        update.participantId;
    }

    if (
      update.participantRef != null
    ) {
      const fromRef =
        resolveParticipantRef(
          update.participantRef
        );

      if (!fromRef) {
        throw new ProcessValidationError(
          `Element ${update.id} references unknown participant ${update.participantRef}`
        );
      }

      if (
        resolvedParticipantId &&
        resolvedParticipantId !==
        fromRef
      ) {
        throw new ProcessValidationError(
          `Element ${update.id} contains conflicting participant references`
        );
      }

      resolvedParticipantId =
        fromRef;
    }

    // --------------------------------------------------
    // LANE ASSIGNMENT
    // --------------------------------------------------

    let resolvedLaneId:
      | string
      | undefined;

    if (
      update.laneId != null
    ) {
      if (
        !lanesById.has(
          update.laneId
        )
      ) {
        throw new ProcessValidationError(
          `Element ${update.id} references unknown lane ${update.laneId}`
        );
      }

      resolvedLaneId =
        update.laneId;
    }

    if (
      update.laneRef != null
    ) {
      const fromRef =
        resolveLaneRef(
          update.laneRef
        );

      if (!fromRef) {
        throw new ProcessValidationError(
          `Element ${update.id} references unknown lane ${update.laneRef}`
        );
      }

      if (
        resolvedLaneId &&
        resolvedLaneId !==
        fromRef
      ) {
        throw new ProcessValidationError(
          `Element ${update.id} contains conflicting lane references`
        );
      }

      resolvedLaneId =
        fromRef;
    }

    if (resolvedLaneId) {
      const lane =
        lanesById.get(
          resolvedLaneId
        );

      if (!lane) {
        throw new ProcessValidationError(
          `Element ${update.id} references missing lane ${resolvedLaneId}`
        );
      }

      // If the task is moved into a lane and no explicit
      // participant was supplied, infer it from the lane.
      if (
        !resolvedParticipantId
      ) {
        resolvedParticipantId =
          lane.participantId;
      }

      if (
        resolvedParticipantId !==
        lane.participantId
      ) {
        throw new ProcessValidationError(
          `Element ${update.id} references participant ${resolvedParticipantId}, but lane ${resolvedLaneId} belongs to participant ${lane.participantId}`
        );
      }

      cleanUpdate.laneId =
        resolvedLaneId;
    }

    if (resolvedParticipantId) {
      cleanUpdate.participantId =
        resolvedParticipantId;
    }

    // --------------------------------------------------
    // TASK-ONLY PROPERTIES
    // --------------------------------------------------

    if (
      existingElement.type === "task"
    ) {
      if (
        update.performer != null &&
        update.performer.trim() !== ""
      ) {
        cleanUpdate.performer =
          update.performer.trim();
      }

      if (
        update.system != null &&
        update.system.trim() !== ""
      ) {
        cleanUpdate.system =
          update.system.trim();
      }

      if (
        update.executionType != null
      ) {
        cleanUpdate.executionType =
          update.executionType;
      }

      if (
        update.employeeConfirmed != null
      ) {
        cleanUpdate.employeeConfirmed =
          update.employeeConfirmed;
      }

      if (
        update.workaroundCandidate != null
      ) {
        cleanUpdate.workaroundCandidate =
          update.workaroundCandidate;
      }

      if (
        update.workaroundConfirmed != null
      ) {
        cleanUpdate.workaroundConfirmed =
          update.workaroundConfirmed;
      }

      if (
        update.workaroundReason != null &&
        update.workaroundReason.trim() !== ""
      ) {
        cleanUpdate.workaroundReason =
          update.workaroundReason.trim();
      }

      if (
        update.workaroundCategory != null
      ) {
        cleanUpdate.workaroundCategory =
          update.workaroundCategory;
      }
    } else {
      const receivedTaskSpecificValues =
        (update.performer != null &&
          update.performer !== "") ||
        (update.system != null &&
          update.system !== "") ||
        update.executionType != null ||
        update.employeeConfirmed != null ||
        update.workaroundCandidate != null ||
        update.workaroundConfirmed != null ||
        (update.workaroundReason != null &&
          update.workaroundReason !== "") ||
        update.workaroundCategory != null;

      if (
        receivedTaskSpecificValues &&
        nodeProcess.env.NODE_ENV !== "production"
      ) {
        console.warn(
          `[workaround-check] Ignoring task-specific update fields for ${existingElement.type} element ${existingElement.id}`
        );
      }
    }

    const merged = {
      ...existingElement,
      ...cleanUpdate
    } as ProcessElement;

    nextElements[index] =
      merged;
  }

  // ====================================================
  // BACKFILL OLD/UNASSIGNED FLOW NODES
  // ====================================================
  //
  // A lane may be unknown, but in this prototype the
  // modeled behavior belongs to the internal white-box
  // participant.
  // ====================================================

  if (
    defaultInternalParticipantId
  ) {
    nextElements =
      nextElements.map(
        (element) => {
          if (
            element.participantId ||
            element.laneId
          ) {
            return element;
          }

          return {
            ...element,
            participantId:
              defaultInternalParticipantId
          };
        }
      );
  }

  elementsById =
    new Map(
      nextElements.map(
        (element) => [
          element.id,
          element
        ]
      )
    );

  // ====================================================
  // 7. ADD SEQUENCE FLOWS
  // ====================================================

  for (
    const newFlow of
    applied.addFlows
  ) {
    const fromId =
      newFlow.from
        ? resolveElementRef(
          newFlow.from
        )
        : resolveElementRef(
          newFlow.fromRef
        );

    const toId =
      newFlow.to
        ? resolveElementRef(
          newFlow.to
        )
        : resolveElementRef(
          newFlow.toRef
        );

    if (
      !fromId ||
      !toId
    ) {
      throw new ProcessValidationError(
        `New sequence flow references missing elements`
      );
    }

    let flowId: string;

    if (newFlow.id) {
      const requested =
        sanitizeId(
          newFlow.id
        );

      if (
        usedBpmnIds.has(
          requested
        )
      ) {
        throw new ProcessValidationError(
          `Flow ${requested} already exists`
        );
      }

      usedBpmnIds.add(
        requested
      );

      flowId =
        requested;
    } else {
      flowId =
        allocateBpmnId(
          undefined,
          "flow"
        );
    }

    nextFlows.push({
      id:
        flowId,

      from:
        fromId,

      to:
        toId,

      condition:
        newFlow.condition?.trim()
          ? newFlow.condition.trim()
          : undefined
    });
  }

  // ====================================================
  // 8. ADD MESSAGE FLOWS
  // ====================================================

  for (
    const newFlow of
    applied.addMessageFlows
  ) {
    const fromParticipantId =
      resolveParticipantRef(
        newFlow.fromParticipantRef
      );

    if (!fromParticipantId) {
      throw new ProcessValidationError(
        `Message flow references unknown source participant ${newFlow.fromParticipantRef}`
      );
    }

    const toParticipantId =
      resolveParticipantRef(
        newFlow.toParticipantRef
      );

    if (!toParticipantId) {
      throw new ProcessValidationError(
        `Message flow references unknown target participant ${newFlow.toParticipantRef}`
      );
    }

    let sourceElementId:
      | string
      | undefined;

    let targetElementId:
      | string
      | undefined;

    if (
      newFlow.sourceElementRef
    ) {
      sourceElementId =
        resolveElementRef(
          newFlow.sourceElementRef
        );

      if (!sourceElementId) {
        throw new ProcessValidationError(
          `Message flow references unknown source element ${newFlow.sourceElementRef}`
        );
      }
    }

    if (
      newFlow.targetElementRef
    ) {
      targetElementId =
        resolveElementRef(
          newFlow.targetElementRef
        );

      if (!targetElementId) {
        throw new ProcessValidationError(
          `Message flow references unknown target element ${newFlow.targetElementRef}`
        );
      }
    }

    let messageFlowId: string;

    if (newFlow.id) {
      const requested =
        sanitizeId(
          newFlow.id
        );

      if (
        usedBpmnIds.has(
          requested
        )
      ) {
        throw new ProcessValidationError(
          `Message flow ${requested} already exists`
        );
      }

      usedBpmnIds.add(
        requested
      );

      messageFlowId =
        requested;
    } else {
      messageFlowId =
        allocateBpmnId(
          newFlow.tempRef,
          "message_flow"
        );
    }

    nextMessageFlows.push({
      id:
        messageFlowId,

      fromParticipantId,

      toParticipantId,

      sourceElementId,

      targetElementId,

      name:
        newFlow.name?.trim()
          ? newFlow.name.trim()
          : undefined
    });
  }

  // ====================================================
  // 9. ADD WORKAROUNDS
  // ====================================================

  const usedWorkaroundIds =
    new Set(
      nextWorkarounds.map(
        (workaround) =>
          workaround.id
      )
    );

  for (
    const draft of
    applied.addWorkarounds
  ) {
    const baseId =
      sanitizeId(
        draft.tempRef
      );

    let finalId =
      baseId;

    let counter = 1;

    while (
      usedWorkaroundIds.has(
        finalId
      )
    ) {
      finalId =
        `${baseId}_${counter}`;

      counter += 1;
    }

    usedWorkaroundIds.add(
      finalId
    );

    const relatedActivityIds =
      (
        draft.relatedActivityRefs ??
        []
      ).map(
        (ref) => {
          const resolved =
            resolveElementRef(ref);

          if (!resolved) {
            throw new ProcessValidationError(
              `Workaround ${draft.tempRef} references unknown activity ${ref}`
            );
          }

          return resolved;
        }
      );

    nextWorkarounds.push({
      id:
        finalId,

      relatedActivityIds,

      actualPractice:
        draft.actualPractice.trim(),

      obstacleOrMisfit:
        draft.obstacleOrMisfit?.trim()
          ? draft.obstacleOrMisfit.trim()
          : undefined,

      category:
        draft.category,

      logVisibility:
        "unknown",

      status:
        "suspected",

      evidenceMessageIds:
        []
    });
  }

  // ====================================================
  // 10. UPDATE WORKAROUNDS
  // ====================================================

  for (
    const update of
    applied.updateWorkarounds
  ) {
    const index =
      nextWorkarounds.findIndex(
        (workaround) =>
          workaround.id === update.id
      );

    if (index === -1) {
      throw new ProcessValidationError(
        `Cannot update missing workaround ${update.id}`
      );
    }

    const existing =
      nextWorkarounds[index];

    const merged:
      WorkaroundCandidate = {
      ...existing
    };

    if (
      update.relatedActivityIds != null
    ) {
      merged.relatedActivityIds =
        update.relatedActivityIds.map(
          (ref) => {
            const resolved =
              resolveElementRef(ref);

            if (!resolved) {
              throw new ProcessValidationError(
                `Workaround ${update.id} references unknown activity ${ref}`
              );
            }

            return resolved;
          }
        );
    }

    if (
      update.actualPractice != null &&
      update.actualPractice.trim() !== ""
    ) {
      merged.actualPractice =
        update.actualPractice.trim();
    }

    if (
      update.expectedPractice != null &&
      update.expectedPractice.trim() !== ""
    ) {
      merged.expectedPractice =
        update.expectedPractice.trim();
    }

    if (
      update.obstacleOrMisfit != null &&
      update.obstacleOrMisfit.trim() !== ""
    ) {
      merged.obstacleOrMisfit =
        update.obstacleOrMisfit.trim();
    }

    if (
      update.goalOrMotivation != null &&
      update.goalOrMotivation.trim() !== ""
    ) {
      merged.goalOrMotivation =
        update.goalOrMotivation.trim();
    }

    if (
      update.category != null
    ) {
      merged.category =
        update.category;
    }

    if (
      update.frequency != null &&
      update.frequency.trim() !== ""
    ) {
      merged.frequency =
        update.frequency.trim();
    }

    if (
      update.logVisibility != null
    ) {
      merged.logVisibility =
        update.logVisibility;
    }

    if (
      update.status != null
    ) {
      merged.status =
        update.status;
    }

    if (
      update.evidenceMessageIds != null
    ) {
      merged.evidenceMessageIds = [
        ...update.evidenceMessageIds
      ];
    }

    nextWorkarounds[index] =
      merged;
  }

  // ====================================================
  // BUILD FINAL PROCESS
  // ====================================================

  cloned.participants =
    nextParticipants;

  cloned.lanes =
    nextLanes;

  cloned.elements =
    nextElements;

  cloned.flows =
    nextFlows;

  cloned.messageFlows =
    nextMessageFlows;

  cloned.workarounds =
    nextWorkarounds;

  cloned.updatedAt =
    new Date().toISOString();

  cloned.status =
    computeStatus(cloned);

  // ====================================================
  // FINAL SEMANTIC VALIDATION
  // ====================================================

  validateProcessModel(
    cloned
  );

  return {
    process:
      cloned,

    processChanges:
      applied
  };
}
