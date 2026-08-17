import {
  useEffect,
  useRef
} from "react";

import BpmnModelerLib from "bpmn-js/lib/Modeler";

import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";

import {
  type ProcessElement,
  type ProcessModel,
  type SequenceFlow
} from "../types";

type Props = {
  xml: string;
  process: ProcessModel;

  /**
   * Wird nur bei einer tatsächlichen semantischen
   * Änderung durch den Benutzer aufgerufen.
   */
  onProcessChange: (
    process: ProcessModel
  ) => void;
};

// ======================================================
// BPMN-JS TYPES
// ======================================================

type BpmnCanvas = {
  zoom: (
    arg: string
  ) => void;

  addMarker: (
    elementId: string,
    marker: string
  ) => void;

  removeMarker: (
    elementId: string,
    marker: string
  ) => void;
};

type BpmnOverlays = {
  add: (
    elementId: string,
    options: {
      position: {
        top?: number;
        left?: number;
        right?: number;
        bottom?: number;
      };

      html: string;
    }
  ) => void;

  clear: () => void;
};

type BpmnBusinessObject = {
  id?: string;

  name?: string;

  $type?: string;

  $parent?: BpmnBusinessObject;

  processRef?: {
    id?: string;
  };

  flowNodeRef?: Array<{
    id?: string;
  }>;

  sourceRef?: {
    id?: string;
  };

  targetRef?: {
    id?: string;
  };
};

type BpmnElement = {
  id: string;

  type?: string;

  businessObject?: BpmnBusinessObject;

  source?: {
    id: string;
  };

  target?: {
    id: string;
  };

  parent?: BpmnElement;
};

type ElementRegistry = {
  getAll: () => BpmnElement[];

  get: (
    id: string
  ) => BpmnElement | undefined;
};

type EventBusCallback =
  (...args: unknown[]) => void;

type EventBus = {
  on: (
    event: string,
    callback: EventBusCallback
  ) => void;

  off: (
    event: string,
    callback: EventBusCallback
  ) => void;
};

// ======================================================
// BPMN TYPE HELPERS
// ======================================================

function getBpmnType(
  element: BpmnElement
): string | undefined {
  return (
    element.businessObject?.$type ??
    element.type
  );
}

function getElementType(
  element: BpmnElement
):
  | ProcessElement["type"]
  | undefined {
  const type =
    getBpmnType(element);

  switch (type) {
    case "bpmn:StartEvent":
      return "start";

    case "bpmn:Task":
    case "bpmn:UserTask":
    case "bpmn:ManualTask":
    case "bpmn:ServiceTask":
    case "bpmn:BusinessRuleTask":
    case "bpmn:ScriptTask":
    case "bpmn:SendTask":
    case "bpmn:ReceiveTask":
      return "task";

    case "bpmn:ExclusiveGateway":
      return "exclusiveGateway";

    case "bpmn:EndEvent":
      return "end";

    default:
      return undefined;
  }
}

function getElementId(
  element: BpmnElement
): string {
  return (
    element.businessObject?.id ??
    element.id
  );
}

// ======================================================
// EXECUTION TYPE
// ======================================================

function inferExecutionType(
  element: BpmnElement
):
  | "human"
  | "automated"
  | undefined {
  const type =
    getBpmnType(element);

  switch (type) {
    case "bpmn:UserTask":
    case "bpmn:ManualTask":
      return "human";

    case "bpmn:ServiceTask":
    case "bpmn:ScriptTask":
    case "bpmn:BusinessRuleTask":
      return "automated";

    default:
      return undefined;
  }
}

// ======================================================
// BUILD PROCESS MODEL FROM BPMN-JS
// ======================================================

function buildProcessFromModeler(
  modeler: BpmnModelerLib,
  previousProcess: ProcessModel
): ProcessModel {
  const registry =
    modeler.get(
      "elementRegistry"
    ) as ElementRegistry;

  const bpmnElements =
    registry.getAll();

  // ====================================================
  // PARTICIPANTS / POOLS
  // ====================================================

  const participantElements =
    bpmnElements.filter(
      (element) =>
        getBpmnType(element) ===
        "bpmn:Participant"
    );

  let participants:
    ProcessModel["participants"] =
    participantElements.map(
      (element) => {
        const id =
          getElementId(element);

        const oldParticipant =
          previousProcess.participants.find(
            (participant) =>
              participant.id === id
          );

        const hasProcessRef =
          Boolean(
            element.businessObject
              ?.processRef?.id
          );

        return {
          id,

          name:
            element.businessObject
              ?.name?.trim() ||
            oldParticipant?.name ||
            id,

          type:
            oldParticipant?.type ??
            (
              hasProcessRef
                ? "internal"
                : "external"
            ),

          processVisibility:
            oldParticipant
              ?.processVisibility ??
            (
              hasProcessRef
                ? "white_box"
                : "black_box"
            )
        };
      }
    );

  /**
   * Fallback für alte BPMN-Dokumente ohne
   * Collaboration/Participant-Shapes.
   */
  if (
    participants.length === 0
  ) {
    participants =
      previousProcess.participants.map(
        (participant) => ({
          ...participant
        })
      );
  }

  const participantsById =
    new Map(
      participants.map(
        (participant) => [
          participant.id,
          participant
        ]
      )
    );

  const defaultInternalParticipantId =
    participants.find(
      (participant) =>
        participant.type ===
          "internal" &&
        participant.processVisibility ===
          "white_box"
    )?.id;

  // ----------------------------------------------------
  // Map BPMN processRef -> participantId
  // ----------------------------------------------------

  const processIdToParticipantId =
    new Map<string, string>();

  for (
    const participantElement of
    participantElements
  ) {
    const participantId =
      getElementId(
        participantElement
      );

    const processRefId =
      participantElement
        .businessObject
        ?.processRef
        ?.id;

    if (processRefId) {
      processIdToParticipantId.set(
        processRefId,
        participantId
      );
    }
  }

  // ====================================================
  // LANES
  // ====================================================

  const laneElements =
    bpmnElements.filter(
      (element) =>
        getBpmnType(element) ===
        "bpmn:Lane"
    );

  const lanes:
    ProcessModel["lanes"] =
    laneElements.map(
      (element) => {
        const id =
          getElementId(element);

        const oldLane =
          previousProcess.lanes.find(
            (lane) =>
              lane.id === id
          );

        /**
         * Für unseren Prototyp gibt es genau
         * einen internen White-box-Pool.
         *
         * Eine neue Lane wird daher diesem
         * Participant zugeordnet.
         */
        const participantId =
          oldLane?.participantId ??
          defaultInternalParticipantId;

        if (!participantId) {
          throw new Error(
            `Cannot determine participant for lane ${id}`
          );
        }

        return {
          id,

          participantId,

          name:
            element.businessObject
              ?.name?.trim() ||
            oldLane?.name ||
            id,

          /**
           * BPMN selbst unterscheidet hier nicht unsere
           * Forschungs-Typen role/department/team.
           * Bestehende Information wird erhalten.
           */
          type:
            oldLane?.type ??
            "department"
        };
      }
    );

  const lanesById =
    new Map(
      lanes.map(
        (lane) => [
          lane.id,
          lane
        ]
      )
    );

  // ====================================================
  // FLOW NODE -> LANE
  // ====================================================

  const laneIdByElementId =
    new Map<string, string>();

  // Preferred:
  // read BPMN lane.flowNodeRef
  for (
    const laneElement of
    laneElements
  ) {
    const laneId =
      getElementId(
        laneElement
      );

    const flowNodeRefs =
      laneElement.businessObject
        ?.flowNodeRef ??
      [];

    for (
      const flowNode of
      flowNodeRefs
    ) {
      if (flowNode.id) {
        laneIdByElementId.set(
          flowNode.id,
          laneId
        );
      }
    }
  }

  // Additional fallback:
  // inspect graphical parent relation.
  for (
    const element of
    bpmnElements
  ) {
    const processType =
      getElementType(element);

    if (!processType) {
      continue;
    }

    const parentType =
      element.parent
        ? getBpmnType(
            element.parent
          )
        : undefined;

    if (
      parentType ===
      "bpmn:Lane"
    ) {
      laneIdByElementId.set(
        getElementId(element),
        getElementId(
          element.parent!
        )
      );
    }
  }

  // ====================================================
  // PROCESS ELEMENTS
  // ====================================================

  const elements:
    ProcessElement[] = [];

  for (
    const element of
    bpmnElements
  ) {
    const type =
      getElementType(element);

    if (!type) {
      continue;
    }

    const id =
      getElementId(element);

    const oldElement =
      previousProcess.elements.find(
        (candidate) =>
          candidate.id === id
      );

    const name =
      element.businessObject
        ?.name?.trim() ||
      oldElement?.name ||
      id;

    // --------------------------------------------------
    // LANE
    // --------------------------------------------------

    let laneId =
      laneIdByElementId.get(
        id
      );

    /**
     * Falls bpmn-js keine Lane-Beziehung liefert,
     * behalten wir die alte nur dann, wenn diese
     * Lane noch existiert.
     */
    if (
      !laneId &&
      oldElement?.laneId &&
      lanesById.has(
        oldElement.laneId
      )
    ) {
      laneId =
        oldElement.laneId;
    }

    // --------------------------------------------------
    // PARTICIPANT
    // --------------------------------------------------

    let participantId:
      | string
      | undefined;

    if (laneId) {
      participantId =
        lanesById.get(
          laneId
        )?.participantId;
    }

    /**
     * BPMN FlowNodes haben normalerweise den
     * Process als $parent.
     *
     * Darüber kann der zugehörige Participant
     * gefunden werden.
     */
    const parentProcessId =
      element.businessObject
        ?.$parent
        ?.id;

    if (
      !participantId &&
      parentProcessId
    ) {
      participantId =
        processIdToParticipantId.get(
          parentProcessId
        );
    }

    if (
      !participantId &&
      oldElement?.participantId &&
      participantsById.has(
        oldElement.participantId
      )
    ) {
      participantId =
        oldElement.participantId;
    }

    if (
      !participantId
    ) {
      participantId =
        defaultInternalParticipantId;
    }

    // ==================================================
    // TASK
    // ==================================================

    if (
      type === "task"
    ) {
      const oldTask =
        oldElement?.type ===
        "task"
          ? oldElement
          : undefined;

      const inferredExecutionType =
        inferExecutionType(
          element
        );

      elements.push({
        id,
        type: "task",
        name,

        ...(participantId
          ? {
              participantId
            }
          : {}),

        ...(laneId
          ? {
              laneId
            }
          : {}),

        ...(oldTask?.performer
          ? {
              performer:
                oldTask.performer
            }
          : {}),

        ...(oldTask?.system
          ? {
              system:
                oldTask.system
            }
          : {}),

        ...(
          oldTask?.executionType
            ? {
                executionType:
                  oldTask.executionType
              }
            : inferredExecutionType
              ? {
                  executionType:
                    inferredExecutionType
                }
              : {}
        ),

        ...(
          oldTask
            ?.employeeConfirmed !==
          undefined
            ? {
                employeeConfirmed:
                  oldTask
                    .employeeConfirmed
              }
            : {}
        ),

        ...(
          oldTask
            ?.workaroundCandidate !==
          undefined
            ? {
                workaroundCandidate:
                  oldTask
                    .workaroundCandidate
              }
            : {}
        ),

        ...(
          oldTask
            ?.workaroundConfirmed !==
          undefined
            ? {
                workaroundConfirmed:
                  oldTask
                    .workaroundConfirmed
              }
            : {}
        ),

        ...(oldTask?.workaroundReason
          ? {
              workaroundReason:
                oldTask
                  .workaroundReason
            }
          : {}),

        ...(oldTask
          ?.workaroundCategory
          ? {
              workaroundCategory:
                oldTask
                  .workaroundCategory
            }
          : {})
      });

      continue;
    }

    // ==================================================
    // START
    // ==================================================

    if (
      type === "start"
    ) {
      elements.push({
        id,
        type: "start",
        name,

        ...(participantId
          ? {
              participantId
            }
          : {}),

        ...(laneId
          ? {
              laneId
            }
          : {})
      });

      continue;
    }

    // ==================================================
    // EXCLUSIVE GATEWAY
    // ==================================================

    if (
      type ===
      "exclusiveGateway"
    ) {
      elements.push({
        id,

        type:
          "exclusiveGateway",

        name,

        ...(participantId
          ? {
              participantId
            }
          : {}),

        ...(laneId
          ? {
              laneId
            }
          : {})
      });

      continue;
    }

    // ==================================================
    // END
    // ==================================================

    if (
      type === "end"
    ) {
      elements.push({
        id,
        type: "end",
        name,

        ...(participantId
          ? {
              participantId
            }
          : {}),

        ...(laneId
          ? {
              laneId
            }
          : {})
      });
    }
  }

  const elementsById =
    new Map(
      elements.map(
        (element) => [
          element.id,
          element
        ]
      )
    );

  // ====================================================
  // SEQUENCE FLOWS
  // ====================================================

  const flows:
    SequenceFlow[] = [];

  for (
    const element of
    bpmnElements
  ) {
    if (
      getBpmnType(element) !==
      "bpmn:SequenceFlow"
    ) {
      continue;
    }

    const id =
      getElementId(element);

    const from =
      element.source?.id ??
      element.businessObject
        ?.sourceRef?.id;

    const to =
      element.target?.id ??
      element.businessObject
        ?.targetRef?.id;

    if (
      !from ||
      !to
    ) {
      continue;
    }

    const oldFlow =
      previousProcess.flows.find(
        (flow) =>
          flow.id === id
      );

    const label =
      element.businessObject
        ?.name?.trim();

    flows.push({
      id,
      from,
      to,

      ...(label
        ? {
            condition:
              label
          }
        : oldFlow?.condition
          ? {
              condition:
                oldFlow.condition
            }
          : {})
    });
  }

  // ====================================================
  // MESSAGE FLOWS
  // ====================================================

  const messageFlows:
    ProcessModel["messageFlows"] =
    [];

  const resolveParticipantForEndpoint = (
    endpointId:
      string | undefined
  ): string | undefined => {
    if (!endpointId) {
      return undefined;
    }

    // Endpoint itself is a pool.
    if (
      participantsById.has(
        endpointId
      )
    ) {
      return endpointId;
    }

    // Endpoint is an activity/event/gateway.
    return elementsById.get(
      endpointId
    )?.participantId;
  };

  for (
    const element of
    bpmnElements
  ) {
    if (
      getBpmnType(element) !==
      "bpmn:MessageFlow"
    ) {
      continue;
    }

    const id =
      getElementId(element);

    const oldFlow =
      previousProcess
        .messageFlows
        .find(
          (flow) =>
            flow.id === id
        );

    const sourceEndpointId =
      element.source?.id ??
      element.businessObject
        ?.sourceRef?.id;

    const targetEndpointId =
      element.target?.id ??
      element.businessObject
        ?.targetRef?.id;

    const fromParticipantId =
      resolveParticipantForEndpoint(
        sourceEndpointId
      ) ??
      oldFlow
        ?.fromParticipantId;

    const toParticipantId =
      resolveParticipantForEndpoint(
        targetEndpointId
      ) ??
      oldFlow
        ?.toParticipantId;

    if (
      !fromParticipantId ||
      !toParticipantId
    ) {
      throw new Error(
        `Cannot determine participants for message flow ${id}`
      );
    }

    const sourceElementId =
      sourceEndpointId &&
      elementsById.has(
        sourceEndpointId
      )
        ? sourceEndpointId
        : undefined;

    const targetElementId =
      targetEndpointId &&
      elementsById.has(
        targetEndpointId
      )
        ? targetEndpointId
        : undefined;

    const name =
      element.businessObject
        ?.name?.trim() ||
      oldFlow?.name;

    messageFlows.push({
      id,

      fromParticipantId,

      toParticipantId,

      ...(sourceElementId
        ? {
            sourceElementId
          }
        : {}),

      ...(targetElementId
        ? {
            targetElementId
          }
        : {}),

      ...(name
        ? {
            name
          }
        : {})
    });
  }

  // ====================================================
  // PRESERVE WORKAROUND METADATA
  // ====================================================

  const existingTaskIds =
    new Set(
      elements
        .filter(
          (
            element
          ): element is Extract<
            ProcessElement,
            { type: "task" }
          > =>
            element.type ===
            "task"
        )
        .map(
          (element) =>
            element.id
        )
    );

  const workarounds =
    previousProcess
      .workarounds
      .map(
        (workaround) => ({
          ...workaround,

          relatedActivityIds:
            workaround
              .relatedActivityIds
              .filter(
                (id) =>
                  existingTaskIds.has(
                    id
                  )
              )
        })
      );

  // ====================================================
  // FINAL PROCESS
  // ====================================================

  return {
    ...previousProcess,

    participants,

    lanes,

    elements,

    flows,

    messageFlows,

    workarounds,

    updatedAt:
      new Date().toISOString()
  };
}

// ======================================================
// SEMANTIC SIGNATURE
// ======================================================
//
// Position / x / y are intentionally NOT included.
//
// Thus:
// moving a shape inside the same lane
// -> no backend update
//
// Moving a task into another lane
// -> laneId changes
// -> backend update
// ======================================================

function semanticSignature(
  process: ProcessModel
): string {
  const sortById =
    <T extends { id: string }>(
      values: T[]
    ): T[] =>
      [...values].sort(
        (a, b) =>
          a.id.localeCompare(
            b.id
          )
      );

  return JSON.stringify({
    participants:
      sortById(
        process.participants
      ).map(
        (participant) => ({
          id:
            participant.id,

          name:
            participant.name,

          type:
            participant.type,

          processVisibility:
            participant
              .processVisibility
        })
      ),

    lanes:
      sortById(
        process.lanes
      ).map(
        (lane) => ({
          id:
            lane.id,

          participantId:
            lane.participantId,

          name:
            lane.name,

          type:
            lane.type
        })
      ),

    elements:
      sortById(
        process.elements
      ).map(
        (element) => ({
          id:
            element.id,

          type:
            element.type,

          name:
            element.name,

          participantId:
            element.participantId,

          laneId:
            element.laneId,

          performer:
            element.type ===
            "task"
              ? element.performer
              : undefined,

          system:
            element.type ===
            "task"
              ? element.system
              : undefined,

          executionType:
            element.type ===
            "task"
              ? element
                  .executionType
              : undefined
        })
      ),

    flows:
      sortById(
        process.flows
      ).map(
        (flow) => ({
          id:
            flow.id,

          from:
            flow.from,

          to:
            flow.to,

          condition:
            flow.condition
        })
      ),

    messageFlows:
      sortById(
        process.messageFlows
      ).map(
        (flow) => ({
          id:
            flow.id,

          fromParticipantId:
            flow
              .fromParticipantId,

          toParticipantId:
            flow
              .toParticipantId,

          sourceElementId:
            flow.sourceElementId,

          targetElementId:
            flow.targetElementId,

          name:
            flow.name
        })
      )
  });
}

// ======================================================
// WORKAROUND MARKERS
// ======================================================

function renderWorkaroundMarkers(
  modeler: BpmnModelerLib,
  process: ProcessModel
): void {
  const canvas =
    modeler.get(
      "canvas"
    ) as BpmnCanvas;

  const overlays =
    modeler.get(
      "overlays"
    ) as BpmnOverlays;

  const registry =
    modeler.get(
      "elementRegistry"
    ) as ElementRegistry;

  overlays.clear();

  // ----------------------------------------------------
  // REMOVE PREVIOUS MARKERS
  // ----------------------------------------------------

  for (
    const element of
    registry.getAll()
  ) {
    if (
      getElementType(element) !==
      "task"
    ) {
      continue;
    }

    canvas.removeMarker(
      element.id,
      "task-workaround-candidate"
    );

    canvas.removeMarker(
      element.id,
      "task-workaround-confirmed"
    );
  }

  // ----------------------------------------------------
  // ADD CURRENT MARKERS
  // ----------------------------------------------------

  for (
    const workaround of
    process.workarounds
  ) {
    if (
      workaround.status ===
      "rejected"
    ) {
      continue;
    }

    for (
      const activityId of
      workaround.relatedActivityIds
    ) {
      /**
       * Prevent overlays for activities that no longer
       * exist in the currently displayed BPMN.
       */
      if (
        !registry.get(
          activityId
        )
      ) {
        continue;
      }

      if (
        workaround.status ===
        "confirmed"
      ) {
        canvas.addMarker(
          activityId,
          "task-workaround-confirmed"
        );

        overlays.add(
          activityId,
          {
            position: {
              top: -8,
              right: -8
            },

            html:
              '<div class="workaround-overlay confirmed">✓</div>'
          }
        );

        continue;
      }

      canvas.addMarker(
        activityId,
        "task-workaround-candidate"
      );

      overlays.add(
        activityId,
        {
          position: {
            top: -8,
            right: -8
          },

          html:
            '<div class="workaround-overlay candidate">⚠</div>'
        }
      );
    }
  }
}

// ======================================================
// COMPONENT
// ======================================================

export function BpmnEditor({
  xml,
  process,
  onProcessChange
}: Props): JSX.Element {
  const containerRef =
    useRef<HTMLDivElement | null>(
      null
    );

  const modelerRef =
    useRef<BpmnModelerLib | null>(
      null
    );

  // ====================================================
  // CURRENT REACT VALUES FOR STABLE EVENT CALLBACKS
  // ====================================================

  const processRef =
    useRef<ProcessModel>(
      process
    );

  const onProcessChangeRef =
    useRef(
      onProcessChange
    );

  // ====================================================
  // IMPORT STATE
  // ====================================================

  /**
   * commandStack.changed may also fire while XML
   * is being imported.
   *
   * During an import, these events must not be sent
   * back to the backend as manual changes.
   */
  const importingRef =
    useRef(false);

  /**
   * Indicates whether at least one diagram has already
   * been imported successfully.
   */
  const hasImportedDiagramRef =
    useRef(false);

  /**
   * Semantic state that is CURRENTLY represented in the
   * bpmn-js modeler.
   *
   * Important:
   * this is deliberately separate from processRef.
   */
  const renderedSignatureRef =
    useRef("");

  /**
   * Last XML that was successfully imported.
   *
   * If a newly generated XML is invalid, we attempt
   * to restore the last working diagram.
   */
  const lastValidXmlRef =
    useRef("");

  const lastValidSignatureRef =
    useRef("");

  /**
   * Prevent older asynchronous import operations from
   * overwriting the state of a newer import.
   */
  const importVersionRef =
    useRef(0);

  // ====================================================
  // CHANGE DEBOUNCE
  // ====================================================

  const changeTimerRef =
    useRef<
      ReturnType<
        typeof setTimeout
      > | undefined
    >(undefined);

  // ====================================================
  // KEEP PROCESS REF CURRENT
  // ====================================================

  useEffect(() => {
    processRef.current =
      process;

    /**
     * Workaround status may change without changing
     * the generated BPMN XML.
     *
     * In that case we update only the markers and do
     * NOT import the diagram again.
     */
    const modeler =
      modelerRef.current;

    if (
      modeler &&
      !importingRef.current &&
      hasImportedDiagramRef.current
    ) {
      try {
        renderWorkaroundMarkers(
          modeler,
          process
        );
      } catch (error) {
        console.error(
          "[BpmnEditor] Failed to refresh workaround markers",
          error
        );
      }
    }
  }, [process]);

  // ====================================================
  // KEEP CALLBACK REF CURRENT
  // ====================================================

  useEffect(() => {
    onProcessChangeRef.current =
      onProcessChange;
  }, [onProcessChange]);

  // ====================================================
  // CREATE BPMN MODELER ONCE
  // ====================================================
  //
  // IMPORTANT:
  // Empty dependency array.
  //
  // The Modeler must not be destroyed/recreated whenever
  // App.tsx creates a new onProcessChange function.
  // ====================================================

  useEffect(() => {
    if (
      !containerRef.current
    ) {
      return;
    }

    const modeler =
      new BpmnModelerLib({
        container:
          containerRef.current
      });

    modelerRef.current =
      modeler;

    const eventBus =
      modeler.get(
        "eventBus"
      ) as EventBus;

    // --------------------------------------------------
    // USER CHANGED BPMN
    // --------------------------------------------------

    const handleCommandStackChanged:
      EventBusCallback =
      () => {
        /**
         * Ignore changes caused by importXML().
         */
        if (
          importingRef.current
        ) {
          return;
        }

        if (
          changeTimerRef.current
        ) {
          clearTimeout(
            changeTimerRef.current
          );
        }

        /**
         * One visual action may generate multiple
         * internal bpmn-js commands.
         */
        changeTimerRef.current =
          setTimeout(
            () => {
              changeTimerRef.current =
                undefined;

              if (
                importingRef.current
              ) {
                return;
              }

              const currentModeler =
                modelerRef.current;

              if (
                !currentModeler
              ) {
                return;
              }

              try {
                const nextProcess =
                  buildProcessFromModeler(
                    currentModeler,
                    processRef.current
                  );

                const nextSignature =
                  semanticSignature(
                    nextProcess
                  );

                /**
                 * Pure layout edits such as moving a
                 * task horizontally do not change the
                 * semantic signature.
                 */
                if (
                  nextSignature ===
                  renderedSignatureRef.current
                ) {
                  return;
                }

                /**
                 * The editor already represents this
                 * semantic state.
                 */
                renderedSignatureRef.current =
                  nextSignature;

                processRef.current =
                  nextProcess;

                onProcessChangeRef.current(
                  nextProcess
                );
              } catch (error) {
                console.error(
                  "[BpmnEditor] Failed to translate manual BPMN edit into ProcessModel",
                  error
                );
              }
            },
            250
          );
      };

    eventBus.on(
      "commandStack.changed",
      handleCommandStackChanged
    );

    // --------------------------------------------------
    // CLEANUP ONLY WHEN COMPONENT UNMOUNTS
    // --------------------------------------------------

    return () => {
      if (
        changeTimerRef.current
      ) {
        clearTimeout(
          changeTimerRef.current
        );

        changeTimerRef.current =
          undefined;
      }

      eventBus.off(
        "commandStack.changed",
        handleCommandStackChanged
      );

      modeler.destroy();

      modelerRef.current =
        null;
    };
  }, []);

  // ====================================================
  // IMPORT XML FROM BACKEND
  // ====================================================
  //
  // IMPORTANT:
  //
  // This effect depends ONLY on xml.
  //
  // A ProcessModel state update alone must not cause a
  // complete BPMN re-import.
  // ====================================================

  useEffect(() => {
    const modeler =
      modelerRef.current;

    if (
      !modeler ||
      !xml
    ) {
      return;
    }

    const incomingSignature =
      semanticSignature(
        processRef.current
      );

    /**
     * Important for MANUAL edits:
     *
     * 1. User moves task to another lane
     * 2. Modeler already displays that change
     * 3. Backend saves ProcessModel
     * 4. Backend returns regenerated XML
     *
     * If the semantic state is already displayed,
     * DO NOT re-import the whole BPMN.
     *
     * Otherwise selection, undo stack and visual state
     * are unnecessarily reset.
     */
    if (
      hasImportedDiagramRef.current &&
      incomingSignature ===
        renderedSignatureRef.current
    ) {
      try {
        renderWorkaroundMarkers(
          modeler,
          processRef.current
        );
      } catch (error) {
        console.error(
          "[BpmnEditor] Failed to refresh markers",
          error
        );
      }

      return;
    }

    const importVersion =
      ++importVersionRef.current;

    let disposed =
      false;

    const importDiagram =
      async (): Promise<void> => {
        importingRef.current =
          true;

        try {
          const result =
            await modeler.importXML(
              xml
            );

          /**
           * Ignore an old import result if a newer
           * import has started meanwhile.
           */
          if (
            disposed ||
            importVersion !==
              importVersionRef.current
          ) {
            return;
          }

          if (
            result.warnings &&
            result.warnings.length >
              0
          ) {
            console.warn(
              "[BpmnEditor] BPMN import warnings:",
              result.warnings
            );
          }

          const canvas =
            modeler.get(
              "canvas"
            ) as BpmnCanvas;

          canvas.zoom(
            "fit-viewport"
          );

          renderWorkaroundMarkers(
            modeler,
            processRef.current
          );

          // --------------------------------------------
          // Remember successful state
          // --------------------------------------------

          hasImportedDiagramRef.current =
            true;

          renderedSignatureRef.current =
            semanticSignature(
              processRef.current
            );

          lastValidXmlRef.current =
            xml;

          lastValidSignatureRef.current =
            renderedSignatureRef.current;
        } catch (error) {
          console.error(
            "[BpmnEditor] BPMN import failed:",
            error
          );

          // ==================================================
          // RESTORE LAST WORKING DIAGRAM
          // ==================================================
          //
          // importXML may already have cleared parts of the
          // canvas before reporting an error.
          //
          // Therefore restore the previous valid XML.
          // ==================================================

          const previousXml =
            lastValidXmlRef.current;

          if (
            !disposed &&
            previousXml &&
            previousXml !== xml
          ) {
            try {
              console.warn(
                "[BpmnEditor] Restoring last valid BPMN diagram"
              );

              await modeler.importXML(
                previousXml
              );

              if (
                disposed ||
                importVersion !==
                  importVersionRef.current
              ) {
                return;
              }

              const canvas =
                modeler.get(
                  "canvas"
                ) as BpmnCanvas;

              canvas.zoom(
                "fit-viewport"
              );

              renderedSignatureRef.current =
                lastValidSignatureRef.current;

              hasImportedDiagramRef.current =
                true;

              renderWorkaroundMarkers(
                modeler,
                processRef.current
              );
            } catch (
              restoreError
            ) {
              console.error(
                "[BpmnEditor] Failed to restore previous BPMN diagram:",
                restoreError
              );
            }
          }
        } finally {
          /**
           * Only the newest import may clear the
           * importing state.
           */
          if (
            importVersion ===
            importVersionRef.current
          ) {
            importingRef.current =
              false;
          }
        }
      };

    void importDiagram();

    return () => {
      disposed =
        true;
    };
  }, [xml]);

  // ====================================================
  // RENDER
  // ====================================================

  return (
    <div
      ref={containerRef}
      className="bpmn-canvas"
    />
  );
}