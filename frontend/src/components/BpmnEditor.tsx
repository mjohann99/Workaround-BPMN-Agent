import {
  useEffect,
  useRef
} from "react";

import BpmnModelerLib from "bpmn-js/lib/Modeler";

import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";

import {
  type BpmnEventDefinitionType,
  type ProcessElement,
  type ProcessModel,
  type SequenceFlow
} from "../types";

// Visual-only band emitted by the backend renderer; never a model lane.
const UNASSIGNED_LANE_ID =
  "Lane_unassigned_band";


// ======================================================
// PROPS
// ======================================================

export type BpmnHighlight = {
  activityId:
    string;

  status:
    | "candidate"
    | "confirmed";
};


export type BpmnEditorMode =
  | "employee"
  | "owner";


export type BpmnXmlImportMode =
  | "display"
  | "draft";


type Props = {
  xml:
    string;

  process:
    ProcessModel;

  mode:
    BpmnEditorMode;

  highlights?:
    BpmnHighlight[];

  /**
   * display:
   *
   * Normal backend-generated BPMN XML.
   *
   * Importing it only updates the visualization and
   * must not be interpreted as a manual process change.
   *
   *
   * draft:
   *
   * Explicit BPMN upload by the Process Owner.
   *
   * After import the BPMN model is translated into the
   * semantic ProcessModel and returned through
   * onProcessChange().
   */
  xmlImportMode?:
    BpmnXmlImportMode;

  onImportError?:
    (
      error:
        Error
    ) => void;

  onProcessChange:
    (
      process:
        ProcessModel
    ) => void;
};


// ======================================================
// BPMN-JS TYPES
// ======================================================

type BpmnCanvas = {
  zoom: (
    arg:
      string
  ) => void;

  addMarker: (
    elementId:
      string,

    marker:
      string
  ) => void;

  removeMarker: (
    elementId:
      string,

    marker:
      string
  ) => void;
};


type BpmnOverlays = {
  add: (
    elementId:
      string,

    options: {
      position: {
        top?:
          number;

        left?:
          number;

        right?:
          number;

        bottom?:
          number;
      };

      html:
        string;
    }
  ) => void;

  clear:
    () => void;
};


type BpmnBusinessObject = {
  id?:
    string;

  name?:
    string;

  $type?:
    string;

  $parent?:
    BpmnBusinessObject;

  processRef?: {
    id?:
      string;
  };

  flowNodeRef?: Array<{
    id?:
      string;
  }>;

  sourceRef?: {
    id?:
      string;
  };

  eventDefinitions?: Array<{
    $type?:
      string;
  }>;

  attachedToRef?: {
    id?:
      string;
  };

  cancelActivity?:
    boolean;

  targetRef?: {
    id?:
      string;
  };
};


type BpmnElement = {
  id:
    string;

  type?:
    string;

  businessObject?:
    BpmnBusinessObject;

  source?: {
    id:
      string;
  };

  target?: {
    id:
      string;
  };

  parent?:
    BpmnElement;

  /**
   * diagram-js represents text labels as separate
   * registry elements.
   *
   * They point to the actual BPMN shape through
   * labelTarget and frequently share its businessObject.
   *
   * These elements must NEVER become ProcessElements.
   */
  labelTarget?:
    BpmnElement;
};


type ElementRegistry = {
  getAll:
    () => BpmnElement[];

  get: (
    id:
      string
  ) =>
    BpmnElement |
    undefined;
};


type EventBusCallback =
  (...args: unknown[]) => void;


type EventBus = {
  on: (
    event:
      string,

    callback:
      EventBusCallback
  ) => void;

  off: (
    event:
      string,

    callback:
      EventBusCallback
  ) => void;
};

// ======================================================
// DIAGRAM LABEL
// ======================================================
//
// elementRegistry.getAll() also contains graphical text
// labels.
//
// Example:
//
// actual shape:
//   element.id = "start_1"
//   businessObject.id = "start_1"
//   businessObject.$type = "bpmn:StartEvent"
//
// graphical label:
//   element.id = "start_1_label"
//   element.type = "label"
//   businessObject.id = "start_1"
//   businessObject.$type = "bpmn:StartEvent"
//
// Without filtering the label, the same semantic BPMN
// element would be inserted twice into ProcessModel.
// ======================================================

function isDiagramLabel(
  element:
    BpmnElement
): boolean {
  return (
    element.type ===
      "label" ||
    Boolean(
      element.labelTarget
    )
  );
}

// ======================================================
// BPMN TYPE HELPERS
// ======================================================

function getBpmnType(
  element:
    BpmnElement
): string | undefined {
  /**
   * Never interpret diagram-js labels as semantic BPMN
   * elements.
   *
   * Their businessObject points to the actual task,
   * event, gateway, participant, lane, etc.
   */
  if (
    isDiagramLabel(
      element
    )
  ) {
    return undefined;
  }

  return (
    element
      .businessObject
      ?.$type ??
    element.type
  );
}


function getElementType(
  element:
    BpmnElement
):
  | ProcessElement["type"]
  | undefined {
  const type =
    getBpmnType(
      element
    );

  switch (
    type
  ) {
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

    case "bpmn:IntermediateCatchEvent":
      return "intermediateCatchEvent";

    case "bpmn:IntermediateThrowEvent":
      return "intermediateThrowEvent";

    case "bpmn:BoundaryEvent":
      return "boundaryEvent";

    case "bpmn:EndEvent":
      return "end";

    default:
      return undefined;
  }
}


function getEventDefinitionType(
  element:
    BpmnElement
): BpmnEventDefinitionType | undefined {
  const definitionType =
    element
      .businessObject
      ?.eventDefinitions
      ?.[0]
      ?.$type;

  if (!definitionType) {
    return undefined;
  }

  const suffix =
    definitionType
      .replace(
        /^bpmn:/,
        ""
      )
      .replace(
        /EventDefinition$/,
        ""
      );

  const normalized =
    suffix === "compensate"
      ? "compensation"
      : suffix[0]?.toLowerCase() +
        suffix.slice(1);

  const supportedTypes: BpmnEventDefinitionType[] = [
    "message",
    "timer",
    "error",
    "escalation",
    "conditional",
    "link",
    "signal",
    "cancel",
    "compensation",
    "terminate",
    "multiple",
    "parallelMultiple"
  ];

  return supportedTypes.find(
    (type) => type === normalized
  );
}


function getElementId(
  element:
    BpmnElement
): string {
  return (
    element
      .businessObject
      ?.id ??
    element.id
  );
}


// ======================================================
// EXECUTION TYPE
// ======================================================

function inferExecutionType(
  element:
    BpmnElement
):
  | "human"
  | "automated"
  | undefined {
  const type =
    getBpmnType(
      element
    );

  switch (
    type
  ) {
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
  modeler:
    BpmnModelerLib,

  previousProcess:
    ProcessModel
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
      (
        element
      ) =>
        getBpmnType(
          element
        ) ===
        "bpmn:Participant"
    );


  let participants:
    ProcessModel["participants"] =
    participantElements.map(
      (
        element
      ) => {
        const id =
          getElementId(
            element
          );

        const oldParticipant =
          previousProcess
            .participants
            .find(
              (
                participant
              ) =>
                participant.id ===
                id
            );

        const hasProcessRef =
          Boolean(
            element
              .businessObject
              ?.processRef
              ?.id
          );

        return {
          id,

          name:
            element
              .businessObject
              ?.name
              ?.trim() ||
            oldParticipant
              ?.name ||
            id,

          type:
            oldParticipant
              ?.type ??
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


  // ====================================================
  // FALLBACK FOR BPMN WITHOUT COLLABORATION
  // ====================================================

  if (
    participants.length ===
    0
  ) {
    participants =
      previousProcess
        .participants
        .map(
          (
            participant
          ) => ({
            ...participant
          })
        );
  }


  const participantsById =
    new Map(
      participants.map(
        (
          participant
        ) => [
          participant.id,
          participant
        ]
      )
    );


  const defaultInternalParticipantId =
    participants.find(
      (
        participant
      ) =>
        participant.type ===
          "internal" &&
        participant
          .processVisibility ===
          "white_box"
    )?.id;


  // ====================================================
  // PROCESS -> PARTICIPANT
  // ====================================================

  const processIdToParticipantId =
    new Map<
      string,
      string
    >();


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

    if (
      processRefId
    ) {
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
      (
        element
      ) =>
        getBpmnType(
          element
        ) ===
        "bpmn:Lane" &&
        getElementId(
          element
        ) !==
        UNASSIGNED_LANE_ID
    );


  const lanes:
    ProcessModel["lanes"] =
    laneElements.map(
      (
        element
      ) => {
        const id =
          getElementId(
            element
          );

        const oldLane =
          previousProcess
            .lanes
            .find(
              (
                lane
              ) =>
                lane.id ===
                id
            );

        const participantId =
          oldLane
            ?.participantId ??
          defaultInternalParticipantId;

        if (
          !participantId
        ) {
          throw new Error(
            `Cannot determine participant for lane ${id}`
          );
        }

        return {
          id,

          participantId,

          name:
            element
              .businessObject
              ?.name
              ?.trim() ||
            oldLane
              ?.name ||
            id,

          /**
           * BPMN itself does not contain our
           * role/department/team classification.
           *
           * Preserve known metadata where possible.
           */
          type:
            oldLane
              ?.type ??
            "department"
        };
      }
    );


  const lanesById =
    new Map(
      lanes.map(
        (
          lane
        ) => [
          lane.id,
          lane
        ]
      )
    );


  // ====================================================
  // FLOW NODE -> LANE
  // ====================================================

  const laneIdByElementId =
    new Map<
      string,
      string
    >();


  // ----------------------------------------------------
  // Preferred:
  // BPMN lane.flowNodeRef
  // ----------------------------------------------------

  for (
    const laneElement of
    laneElements
  ) {
    const laneId =
      getElementId(
        laneElement
      );

    const flowNodeRefs =
      laneElement
        .businessObject
        ?.flowNodeRef ??
      [];

    for (
      const flowNode of
      flowNodeRefs
    ) {
      if (
        flowNode.id
      ) {
        laneIdByElementId.set(
          flowNode.id,
          laneId
        );
      }
    }
  }


  // ----------------------------------------------------
  // Fallback:
  // graphical parent relation
  // ----------------------------------------------------

  const explicitlyUnassignedIds =
    new Set<string>();

  for (
    const element of
    bpmnElements
  ) {
    const processType =
      getElementType(
        element
      );

    if (
      !processType
    ) {
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
      const parentLaneId =
        getElementId(
          element.parent!
        );

      if (
        parentLaneId ===
        UNASSIGNED_LANE_ID
      ) {
        explicitlyUnassignedIds.add(
          getElementId(
            element
          )
        );

        laneIdByElementId.delete(
          getElementId(
            element
          )
        );

        continue;
      }

      laneIdByElementId.set(
        getElementId(
          element
        ),

        parentLaneId
      );
    }
  }


  // ====================================================
  // PROCESS ELEMENTS
  // ====================================================

  const elements:
    ProcessElement[] =
    [];


  for (
    const element of
    bpmnElements
  ) {
    const type =
      getElementType(
        element
      );

    if (
      !type
    ) {
      continue;
    }

    const id =
      getElementId(
        element
      );

    const oldElement =
      previousProcess
        .elements
        .find(
          (
            candidate
          ) =>
            candidate.id ===
            id
        );

    const name =
      element
        .businessObject
        ?.name
        ?.trim() ||
      oldElement
        ?.name ||
      id;


    // ==================================================
    // LANE
    // ==================================================

    let laneId =
      laneIdByElementId.get(
        id
      );

    if (
      !laneId &&
      !explicitlyUnassignedIds.has(
        id
      ) &&
      oldElement
        ?.laneId &&
      lanesById.has(
        oldElement.laneId
      )
    ) {
      laneId =
        oldElement.laneId;
    }


    // ==================================================
    // PARTICIPANT
    // ==================================================

    let participantId:
      | string
      | undefined;


    if (
      laneId
    ) {
      participantId =
        lanesById.get(
          laneId
        )?.participantId;
    }


    const parentProcessId =
      element
        .businessObject
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
      oldElement
        ?.participantId &&
      participantsById.has(
        oldElement
          .participantId
      )
    ) {
      participantId =
        oldElement
          .participantId;
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
      type ===
      "task"
    ) {
      const oldTask =
        oldElement
          ?.type ===
        "task"
          ? oldElement
          : undefined;

      const inferredExecutionType =
        inferExecutionType(
          element
        );

      elements.push({
        id,

        type:
          "task",

        name,

        ...(
          participantId
            ? {
                participantId
              }
            : {}
        ),

        ...(
          laneId
            ? {
                laneId
              }
            : {}
        ),

        ...(
          oldTask
            ?.performer
            ? {
                performer:
                  oldTask
                    .performer
              }
            : {}
        ),

        ...(
          oldTask
            ?.system
            ? {
                system:
                  oldTask
                    .system
              }
            : {}
        ),

        ...(
          oldTask
            ?.executionType
            ? {
                executionType:
                  oldTask
                    .executionType
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

        /**
         * Legacy compatibility only.
         *
         * These fields are not used as the source of
         * truth for Owner analysis markers.
         */
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

        ...(
          oldTask
            ?.workaroundReason !==
          undefined
            ? {
                workaroundReason:
                  oldTask
                    .workaroundReason
              }
            : {}
        ),

        ...(
          oldTask
            ?.workaroundCategory !==
          undefined
            ? {
                workaroundCategory:
                  oldTask
                    .workaroundCategory
              }
            : {}
        )
      });

      continue;
    }


    // ==================================================
    // START
    // ==================================================

    if (
      type ===
      "start"
    ) {
      elements.push({
        id,

        type:
          "start",

        name,

        ...(getEventDefinitionType(element)
          ? {
              eventDefinitionType:
                getEventDefinitionType(element)
            }
          : {}),

        ...(
          participantId
            ? {
                participantId
              }
            : {}
        ),

        ...(
          laneId
            ? {
                laneId
              }
            : {}
        )
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

        ...(
          participantId
            ? {
                participantId
              }
            : {}
        ),

        ...(
          laneId
            ? {
                laneId
              }
            : {}
        )
      });

      continue;
    }


    // ==================================================
    // END
    // ==================================================

    if (type === "boundaryEvent") {
      const attachedToRef =
        element.businessObject
          ?.attachedToRef
          ?.id;

      if (!attachedToRef) {
        continue;
      }

      elements.push({
        id,

        type: "boundaryEvent",

        name,

        ...(getEventDefinitionType(element)
          ? {
              eventDefinitionType:
                getEventDefinitionType(element)
            }
          : {}),

        attachedToRef,

        cancelActivity:
          element.businessObject?.cancelActivity ?? true,

        ...(
          participantId
            ? {
                participantId
              }
            : {}
        ),

        ...(
          laneId
            ? {
                laneId
              }
            : {}
        )
      });

        continue;
      }

      if (
        type === "end" ||
        type === "intermediateCatchEvent" ||
        type === "intermediateThrowEvent"
      ) {
        elements.push({
          id,

          type,

          name,

          ...(getEventDefinitionType(element)
            ? {
                eventDefinitionType:
                  getEventDefinitionType(element)
              }
            : {}),

          ...(
            participantId
              ? {
                  participantId
                }
              : {}
          ),

          ...(
            laneId
              ? {
                  laneId
                }
              : {}
          )
        });
    }
  }

  // ======================================================
// DEFENSIVE DUPLICATE CHECK
// ======================================================
//
// A valid ProcessModel must contain each semantic BPMN
// element exactly once.
//
// Do not silently deduplicate here.
//
// A duplicate indicates a bug in BPMN -> ProcessModel
// translation and should be detected before the model is
// sent to the backend.
// ======================================================

const seenElementIds =
  new Set<
    string
  >();


for (
  const element of
  elements
) {
  if (
    seenElementIds.has(
      element.id
    )
  ) {
    throw new Error(
      `BPMN import produced duplicate process element ID: ${element.id}`
    );
  }

  seenElementIds.add(
    element.id
  );
}

  const elementsById =
    new Map(
      elements.map(
        (
          element
        ) => [
          element.id,
          element
        ]
      )
    );


  // ====================================================
  // SEQUENCE FLOWS
  // ====================================================

  const flows:
    SequenceFlow[] =
    [];


  for (
    const element of
    bpmnElements
  ) {
    if (
      getBpmnType(
        element
      ) !==
      "bpmn:SequenceFlow"
    ) {
      continue;
    }

    const id =
      getElementId(
        element
      );

    const from =
      element
        .source
        ?.id ??
      element
        .businessObject
        ?.sourceRef
        ?.id;

    const to =
      element
        .target
        ?.id ??
      element
        .businessObject
        ?.targetRef
        ?.id;

    if (
      !from ||
      !to
    ) {
      continue;
    }

    const oldFlow =
      previousProcess
        .flows
        .find(
          (
            flow
          ) =>
            flow.id ===
            id
        );

    const label =
      element
        .businessObject
        ?.name
        ?.trim();

    flows.push({
      id,

      from,

      to,

      ...(
        label
          ? {
              condition:
                label
            }
          : oldFlow
              ?.condition
            ? {
                condition:
                  oldFlow
                    .condition
              }
            : {}
      )
    });
  }

  const seenFlowIds =
  new Set<
    string
  >();


for (
  const flow of
  flows
) {
  if (
    seenFlowIds.has(
      flow.id
    )
  ) {
    throw new Error(
      `BPMN import produced duplicate sequence flow ID: ${flow.id}`
    );
  }

  seenFlowIds.add(
    flow.id
  );
}

  // ====================================================
  // MESSAGE FLOWS
  // ====================================================

  const messageFlows:
    ProcessModel["messageFlows"] =
    [];


  const resolveParticipantForEndpoint =
    (
      endpointId:
        string |
        undefined
    ):
      string |
      undefined => {
      if (
        !endpointId
      ) {
        return undefined;
      }

      if (
        participantsById.has(
          endpointId
        )
      ) {
        return endpointId;
      }

      return elementsById
        .get(
          endpointId
        )
        ?.participantId;
    };


  for (
    const element of
    bpmnElements
  ) {
    if (
      getBpmnType(
        element
      ) !==
      "bpmn:MessageFlow"
    ) {
      continue;
    }

    const id =
      getElementId(
        element
      );

    const oldFlow =
      previousProcess
        .messageFlows
        .find(
          (
            flow
          ) =>
            flow.id ===
            id
        );

    const sourceEndpointId =
      element
        .source
        ?.id ??
      element
        .businessObject
        ?.sourceRef
        ?.id;

    const targetEndpointId =
      element
        .target
        ?.id ??
      element
        .businessObject
        ?.targetRef
        ?.id;


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


    const flowName =
      element
        .businessObject
        ?.name
        ?.trim() ||
      oldFlow
        ?.name;


    messageFlows.push({
      id,

      fromParticipantId,

      toParticipantId,

      ...(
        sourceElementId
          ? {
              sourceElementId
            }
          : {}
      ),

      ...(
        targetElementId
          ? {
              targetElementId
            }
          : {}
      ),

      ...(
        flowName
          ? {
              name:
                flowName
            }
          : {}
      )
    });
  }


  // ====================================================
  // LEGACY WORKAROUND METADATA
  // ====================================================
  //
  // This is preserved only for backwards compatibility.
  //
  // It is NOT used to render Owner markers.
  // ====================================================

  const existingTaskIds =
    new Set(
      elements
        .filter(
          (
            element
          ): element is Extract<
            ProcessElement,
            {
              type:
                "task";
            }
          > =>
            element.type ===
            "task"
        )
        .map(
          (
            element
          ) =>
            element.id
        )
    );


  const workarounds =
    previousProcess
      .workarounds
      .map(
        (
          workaround
        ) => ({
          ...workaround,

          relatedActivityIds:
            workaround
              .relatedActivityIds
              .filter(
                (
                  id
                ) =>
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
      new Date()
        .toISOString()
  };
}


// ======================================================
// SEMANTIC SIGNATURE
// ======================================================
//
// Coordinates are deliberately excluded.
//
// Moving a shape without changing its semantic lane or
// process context does not create a new process version.
// ======================================================

function semanticSignature(
  process:
    ProcessModel
): string {
  const sortById =
    <
      T extends {
        id:
          string;
      }
    >(
      values:
        T[]
    ): T[] =>
      [
        ...values
      ].sort(
        (
          left,
          right
        ) =>
          left.id
            .localeCompare(
              right.id
            )
      );


  return JSON.stringify({
    participants:
      sortById(
        process.participants
      ).map(
        (
          participant
        ) => ({
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
        (
          lane
        ) => ({
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
        (
          element
        ) => ({
          id:
            element.id,

          type:
            element.type,

          name:
            element.name,

          participantId:
            element
              .participantId,

          laneId:
            element
              .laneId,

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
        (
          flow
        ) => ({
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
        (
          flow
        ) => ({
          id:
            flow.id,

          fromParticipantId:
            flow
              .fromParticipantId,

          toParticipantId:
            flow
              .toParticipantId,

          sourceElementId:
            flow
              .sourceElementId,

          targetElementId:
            flow
              .targetElementId,

          name:
            flow.name
        })
      )
  });
}


// ======================================================
// OWNER ANALYSIS HIGHLIGHTS
// ======================================================
//
// The marker source is exclusively:
//
// OwnerView
// -> SessionAnalysis.deviations
// -> SessionAnalysis.ownerReviews
// -> BpmnHighlight[]
//
// process.workarounds is NOT consulted here.
// ======================================================

function renderHighlights(
  modeler:
    BpmnModelerLib,

  highlights:
    BpmnHighlight[],

  mode:
    BpmnEditorMode
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


  // ====================================================
  // CLEAR PREVIOUS OVERLAYS
  // ====================================================

  overlays.clear();


  // ====================================================
  // REMOVE PREVIOUS MARKERS
  // ====================================================

  for (
    const element of
    registry.getAll()
  ) {
    if (
      getElementType(
        element
      ) !==
      "task"
    ) {
      continue;
    }

    canvas.removeMarker(
      element.id,
      "deviation-candidate"
    );

    canvas.removeMarker(
      element.id,
      "deviation-confirmed"
    );
  }


  // ====================================================
  // EMPLOYEE
  // ====================================================

  if (
    mode !==
    "owner"
  ) {
    return;
  }


  // ====================================================
  // OWNER
  // ====================================================

  for (
    const highlight of
    highlights
  ) {
    if (
      !registry.get(
        highlight.activityId
      )
    ) {
      continue;
    }


    if (
      highlight.status ===
      "confirmed"
    ) {
      canvas.addMarker(
        highlight.activityId,
        "deviation-confirmed"
      );

      overlays.add(
        highlight.activityId,
        {
          position: {
            top:
              -8,

            right:
              -8
          },

          html:
            '<div class="deviation-overlay confirmed">✓</div>'
        }
      );

      continue;
    }


    canvas.addMarker(
      highlight.activityId,
      "deviation-candidate"
    );

    overlays.add(
      highlight.activityId,
      {
        position: {
          top:
            -8,

          right:
            -8
        },

        html:
          '<div class="deviation-overlay candidate">!</div>'
      }
    );
  }
}


// ======================================================
// COMPONENT
// ======================================================

export function BpmnEditor({
  xml,
  process,
  highlights = [],
  mode,
  xmlImportMode = "display",
  onImportError,
  onProcessChange
}: Props): JSX.Element {
  const containerRef =
    useRef<
      HTMLDivElement |
      null
    >(
      null
    );


  const modelerRef =
    useRef<
      BpmnModelerLib |
      null
    >(
      null
    );


  // ====================================================
  // CURRENT REACT VALUES FOR STABLE CALLBACKS
  // ====================================================

  const processRef =
    useRef<
      ProcessModel
    >(
      process
    );


  const modeRef =
    useRef<
      BpmnEditorMode
    >(
      mode
    );


  const highlightsRef =
    useRef<
      BpmnHighlight[]
    >(
      highlights
    );


  const onProcessChangeRef =
    useRef(
      onProcessChange
    );


  const onImportErrorRef =
    useRef(
      onImportError
    );


  // ====================================================
  // IMPORT STATE
  // ====================================================

  /**
   * True only while bpmn-js itself is currently
   * importing XML.
   *
   * commandStack events caused by importXML() must never
   * be interpreted as manual user changes.
   */
  const importingRef =
    useRef(
      false
    );


  /**
   * Has at least one diagram been imported successfully?
   */
  const hasImportedDiagramRef =
    useRef(
      false
    );


  /**
   * Semantic state currently represented by bpmn-js.
   */
  const renderedSignatureRef =
    useRef(
      ""
    );


  /**
   * Last successfully imported XML.
   */
  const lastValidXmlRef =
    useRef(
      ""
    );


  const lastValidSignatureRef =
    useRef(
      ""
    );


  /**
   * Invalidate outdated import effects.
   */
  const importVersionRef =
    useRef(
      0
    );


  /**
   * importXML() must not be executed concurrently on the
   * same bpmn-js modeler.
   *
   * Rapid reference changes / React lifecycle updates can
   * otherwise corrupt the internal canvas state and cause
   * errors such as:
   *
   * this._layers is undefined
   */
  const importQueueRef =
    useRef<
      Promise<void>
    >(
      Promise.resolve()
    );


  // ====================================================
  // CHANGE DEBOUNCE
  // ====================================================

  const changeTimerRef =
    useRef<
      ReturnType<
        typeof setTimeout
      > |
      undefined
    >(
      undefined
    );


  // ====================================================
  // KEEP PROCESS REF CURRENT
  // ====================================================

  useEffect(
    () => {
      processRef.current =
        process;
    },
    [
      process
    ]
  );


  // ====================================================
  // KEEP MODE REF CURRENT
  // ====================================================

  useEffect(
    () => {
      modeRef.current =
        mode;
    },
    [
      mode
    ]
  );


  // ====================================================
  // KEEP CALLBACK REF CURRENT
  // ====================================================

  useEffect(
    () => {
      onProcessChangeRef.current =
        onProcessChange;
    },
    [
      onProcessChange
    ]
  );


  // ====================================================
  // KEEP IMPORT ERROR CALLBACK CURRENT
  // ====================================================

  useEffect(
    () => {
      onImportErrorRef.current =
        onImportError;
    },
    [
      onImportError
    ]
  );


  // ====================================================
  // KEEP HIGHLIGHTS CURRENT
  // ====================================================

  useEffect(
    () => {
      highlightsRef.current =
        highlights;

      const modeler =
        modelerRef.current;

      if (
        !modeler ||
        !hasImportedDiagramRef.current ||
        importingRef.current
      ) {
        return;
      }

      try {
        renderHighlights(
          modeler,
          highlights,
          mode
        );
      } catch (
        error
      ) {
        console.error(
          "[BpmnEditor] Failed to refresh highlights",
          error
        );
      }
    },
    [
      highlights,
      mode
    ]
  );


  // ====================================================
  // CREATE BPMN MODELER ONCE
  // ====================================================

  useEffect(
    () => {
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


      // ==================================================
      // USER CHANGED BPMN
      // ==================================================

      const handleCommandStackChanged:
        EventBusCallback =
        () => {
          /**
           * Ignore bpmn-js commands produced by an XML
           * import.
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
           * One visual interaction may create several
           * command-stack events.
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
                  !currentModeler ||
                  currentModeler !==
                    modeler
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
                   * Pure graphical movement without a
                   * semantic process change is ignored.
                   */
                  if (
                    nextSignature ===
                    renderedSignatureRef
                      .current
                  ) {
                    return;
                  }


                  renderedSignatureRef.current =
                    nextSignature;


                  processRef.current =
                    nextProcess;


                  onProcessChangeRef.current(
                    nextProcess
                  );
                } catch (
                  error
                ) {
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


      // ==================================================
      // CLEANUP
      // ==================================================

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


        // ----------------------------------------------
        // Invalidate outstanding async imports BEFORE
        // destroying bpmn-js.
        // ----------------------------------------------

        importVersionRef.current +=
          1;


        if (
          modelerRef.current ===
          modeler
        ) {
          modelerRef.current =
            null;

          importingRef.current =
            false;
        }


        modeler.destroy();
      };
    },
    []
  );


  // ====================================================
  // IMPORT BPMN XML
  // ====================================================

  useEffect(
    () => {
      const modeler =
        modelerRef.current;


      if (
        !modeler ||
        !xml
      ) {
        return;
      }


      // ==================================================
      // EXPLICIT OWNER UPLOAD?
      // ==================================================

      const importingOwnerDraft =
        xmlImportMode ===
        "draft";


      // ==================================================
      // CURRENT SEMANTIC STATE
      // ==================================================

      const incomingSignature =
        semanticSignature(
          processRef.current
        );


      // ==================================================
      // SKIP REDUNDANT DISPLAY IMPORT
      // ==================================================
      //
      // Backend-generated XML may be skipped if exactly
      // the same semantic model is already displayed.
      //
      // An explicit owner upload must NEVER be skipped,
      // because its ProcessModel does not exist until the
      // uploaded XML has actually been imported.
      // ==================================================

      if (
        !importingOwnerDraft &&
        hasImportedDiagramRef.current &&
        incomingSignature ===
          renderedSignatureRef.current
      ) {
        if (
          !importingRef.current
        ) {
          try {
            renderHighlights(
              modeler,
              highlightsRef.current,
              modeRef.current
            );
          } catch (
            error
          ) {
            console.error(
              "[BpmnEditor] Failed to refresh highlights",
              error
            );
          }
        }

        return;
      }


      // ==================================================
      // IMPORT VERSION
      // ==================================================

      const importVersion =
        ++importVersionRef.current;


      let disposed =
        false;


      const isCurrentImport =
        (): boolean =>
          !disposed &&
          importVersion ===
            importVersionRef.current &&
          modelerRef.current ===
            modeler;


      // ==================================================
      // SERIALIZED IMPORT
      // ==================================================

      const runImport =
        async (): Promise<void> => {
          /**
           * This import may have become obsolete while
           * waiting for an older import to finish.
           */
          if (
            !isCurrentImport()
          ) {
            return;
          }


          importingRef.current =
            true;


          try {
            console.info(
              "[BpmnEditor] Importing BPMN XML",
              {
                mode:
                  xmlImportMode,

                xmlLength:
                  xml.length
              }
            );


            const result =
              await modeler.importXML(
                xml
              );


            /**
             * The import may have finished after a newer
             * XML request or modeler replacement.
             */
            if (
              !isCurrentImport()
            ) {
              return;
            }


            // ------------------------------------------
            // WARNINGS
            // ------------------------------------------

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


            // ------------------------------------------
            // FIT DIAGRAM
            // ------------------------------------------

            const canvas =
              modeler.get(
                "canvas"
              ) as BpmnCanvas;


            canvas.zoom(
              "fit-viewport"
            );


            // ==================================================
            // OWNER UPLOAD -> SEMANTIC PROCESS DRAFT
            // ==================================================

            if (
              importingOwnerDraft
            ) {
              const importedProcess =
                buildProcessFromModeler(
                  modeler,
                  processRef.current
                );


              processRef.current =
                importedProcess;


              renderedSignatureRef.current =
                semanticSignature(
                  importedProcess
                );


              console.info(
                "[BpmnEditor] Uploaded BPMN converted to ProcessModel",
                {
                  participants:
                    importedProcess
                      .participants
                      .length,

                  lanes:
                    importedProcess
                      .lanes
                      .length,

                  elements:
                    importedProcess
                      .elements
                      .length,

                  flows:
                    importedProcess
                      .flows
                      .length,

                  messageFlows:
                    importedProcess
                      .messageFlows
                      .length
                }
              );


              /**
               * This turns the imported BPMN into the
               * local unsaved ReferenceProcess draft.
               */
              onProcessChangeRef.current(
                importedProcess
              );
            }


            // ==================================================
            // ROLE-SPECIFIC VISUALIZATION
            // ==================================================

            renderHighlights(
              modeler,
              highlightsRef.current,
              modeRef.current
            );


            // ==================================================
            // REMEMBER SUCCESSFUL STATE
            // ==================================================

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
          } catch (
            error
          ) {
            // ==================================================
            // IGNORE OUTDATED IMPORT ERRORS
            // ==================================================
            //
            // An old React lifecycle/import operation may fail
            // after a newer model has already replaced it.
            //
            // That must not be reported as a corrupt BPMN file.
            // ==================================================

            if (
              !isCurrentImport()
            ) {
              return;
            }


            const normalizedError =
              error instanceof
                Error
                ? error
                : new Error(
                    String(
                      error
                    )
                  );


            console.error(
              "[BpmnEditor] BPMN import failed:",
              normalizedError
            );


            onImportErrorRef
              .current
              ?.(
                normalizedError
              );


            // ==================================================
            // RESTORE LAST VALID DIAGRAM
            // ==================================================

            const previousXml =
              lastValidXmlRef.current;


            if (
              previousXml &&
              previousXml !==
                xml
            ) {
              try {
                console.warn(
                  "[BpmnEditor] Restoring last valid BPMN diagram"
                );


                await modeler.importXML(
                  previousXml
                );


                if (
                  !isCurrentImport()
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


                renderHighlights(
                  modeler,
                  highlightsRef.current,
                  modeRef.current
                );
              } catch (
                restoreError
              ) {
                if (
                  !isCurrentImport()
                ) {
                  return;
                }


                console.error(
                  "[BpmnEditor] Failed to restore previous BPMN diagram:",
                  restoreError
                );
              }
            }
          } finally {
            /**
             * Imports are serialized, therefore this import
             * may safely clear the import flag after it
             * actually finishes.
             *
             * Do not let a destroyed old modeler interfere
             * with a replacement modeler.
             */
            if (
              modelerRef.current ===
              modeler
            ) {
              importingRef.current =
                false;
            }
          }
        };


      // ==================================================
      // IMPORT QUEUE
      // ==================================================
      //
      // Critical:
      //
      // Never run two modeler.importXML() operations
      // concurrently.
      //
      // This protects diagram-js' internal Canvas layers.
      // ==================================================

      importQueueRef.current =
        importQueueRef.current
          .catch(
            (
              queueError
            ) => {
              console.error(
                "[BpmnEditor] Previous queued import failed:",
                queueError
              );
            }
          )
          .then(
            async () => {
              await runImport();
            }
          );


      // ==================================================
      // EFFECT CLEANUP
      // ==================================================

      return () => {
        disposed =
          true;


        /**
         * Invalidate this import request.
         *
         * If it is already running, it may finish inside
         * bpmn-js, but its result is ignored.
         *
         * The next XML import waits in the queue.
         */
        if (
          importVersion ===
          importVersionRef.current
        ) {
          importVersionRef.current +=
            1;
        }
      };
    },
    [
      xml,
      xmlImportMode
    ]
  );


  // ====================================================
  // RENDER
  // ====================================================

  return (
    <div
      className={
        `bpmn-editor bpmn-editor-${mode}`
      }
    >
      <div
        ref={
          containerRef
        }

        className="bpmn-canvas"
      />
    </div>
  );
}