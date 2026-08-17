import {
  type ProcessElement,
  type ProcessModel,
  type SequenceFlow
} from "./types.js";

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = [number, number];

// ======================================================
// ELEMENT SIZE
// ======================================================

const ELEMENT_WIDTH: Record<
  ProcessElement["type"],
  number
> = {
  start: 36,
  task: 140,
  exclusiveGateway: 50,
  end: 36
};

const ELEMENT_HEIGHT: Record<
  ProcessElement["type"],
  number
> = {
  start: 36,
  task: 80,
  exclusiveGateway: 50,
  end: 36
};

// ======================================================
// LAYOUT
// ======================================================

const POOL_X = 80;
const TOP_Y = 80;

const PARTICIPANT_LABEL_WIDTH = 30;

const EXTERNAL_POOL_HEIGHT = 100;
const EXTERNAL_POOL_GAP = 60;

const LANE_HEIGHT = 180;
const DEFAULT_INTERNAL_POOL_HEIGHT = 220;

const CONTENT_LEFT_PADDING = 100;
const CONTENT_RIGHT_PADDING = 160;

const STEP_X = 210;

const MIN_POOL_WIDTH = 1000;

// ======================================================
// XML HELPERS
// ======================================================

export function escapeXml(
  value: string
): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeId(
  value: string
): string {
  return value.replace(
    /[^A-Za-z0-9_]/g,
    "_"
  );
}

function generatedId(
  prefix: string,
  value: string
): string {
  return `${prefix}_${sanitizeId(
    value
  )}`;
}

// ======================================================
// ELEMENT TAG
// ======================================================

function bpmnTagForElement(
  element: ProcessElement
): string {
  if (element.type === "start") {
    return "bpmn:startEvent";
  }

  if (element.type === "task") {
    return "bpmn:task";
  }

  if (
    element.type ===
    "exclusiveGateway"
  ) {
    return "bpmn:exclusiveGateway";
  }

  return "bpmn:endEvent";
}

// ======================================================
// ELEMENT XML
// ======================================================

function renderElementXml(
  element: ProcessElement
): string {
  const tag =
    bpmnTagForElement(element);

  return [
    `<${tag}`,
    ` id="${escapeXml(element.id)}"`,
    ` name="${escapeXml(element.name)}"`,
    ` />`
  ].join("");
}

// ======================================================
// SEQUENCE FLOW XML
// ======================================================

function renderFlowXml(
  flow: SequenceFlow
): string {
  if (!flow.condition) {
    return [
      `<bpmn:sequenceFlow`,
      ` id="${escapeXml(flow.id)}"`,
      ` sourceRef="${escapeXml(flow.from)}"`,
      ` targetRef="${escapeXml(flow.to)}"`,
      ` />`
    ].join("");
  }

  return [
    `<bpmn:sequenceFlow`,
    ` id="${escapeXml(flow.id)}"`,
    ` sourceRef="${escapeXml(flow.from)}"`,
    ` targetRef="${escapeXml(flow.to)}"`,
    `>`,
    `<bpmn:conditionExpression`,
    ` xsi:type="bpmn:tFormalExpression"`,
    `>`,
    escapeXml(flow.condition),
    `</bpmn:conditionExpression>`,
    `</bpmn:sequenceFlow>`
  ].join("");
}

// ======================================================
// MESSAGE FLOW XML
// ======================================================

function renderMessageFlowXml(
  flow: ProcessModel["messageFlows"][number]
): string {
  const sourceRef =
    flow.sourceElementId ??
    flow.fromParticipantId;

  const targetRef =
    flow.targetElementId ??
    flow.toParticipantId;

  const name =
    flow.name
      ? ` name="${escapeXml(
          flow.name
        )}"`
      : "";

  return [
    `<bpmn:messageFlow`,
    ` id="${escapeXml(flow.id)}"`,
    ` sourceRef="${escapeXml(sourceRef)}"`,
    ` targetRef="${escapeXml(targetRef)}"`,
    name,
    ` />`
  ].join("");
}

// ======================================================
// PARTICIPANT XML
// ======================================================

function renderParticipantXml(
  participant:
    ProcessModel["participants"][number],
  internalParticipantId: string,
  processId: string
): string {
  const processRef =
    participant.id ===
    internalParticipantId
      ? ` processRef="${escapeXml(
          processId
        )}"`
      : "";

  return [
    `<bpmn:participant`,
    ` id="${escapeXml(participant.id)}"`,
    ` name="${escapeXml(participant.name)}"`,
    processRef,
    ` />`
  ].join("");
}

// ======================================================
// LANE SET XML
// ======================================================

function renderLaneSetXml(
  process: ProcessModel,
  internalParticipantId: string
): string {
  const lanes =
    process.lanes.filter(
      (lane) =>
        lane.participantId ===
        internalParticipantId
    );

  if (lanes.length === 0) {
    return "";
  }

  const laneXml =
    lanes
      .map((lane) => {
        const flowNodeRefs =
          process.elements
            .filter(
              (element) =>
                element.laneId === lane.id
            )
            .map(
              (element) =>
                `<bpmn:flowNodeRef>${escapeXml(
                  element.id
                )}</bpmn:flowNodeRef>`
            )
            .join("");

        return [
          `<bpmn:lane`,
          ` id="${escapeXml(lane.id)}"`,
          ` name="${escapeXml(lane.name)}"`,
          `>`,
          flowNodeRefs,
          `</bpmn:lane>`
        ].join("");
      })
      .join("");

  return [
    `<bpmn:laneSet`,
    ` id="${generatedId(
      "LaneSet",
      process.id
    )}"`,
    `>`,
    laneXml,
    `</bpmn:laneSet>`
  ].join("");
}

// ======================================================
// MAIN POOL WIDTH
// ======================================================

function calculatePoolWidth(
  process: ProcessModel
): number {
  const maxElementWidth =
    process.elements.length > 0
      ? Math.max(
          ...process.elements.map(
            (element) =>
              ELEMENT_WIDTH[
                element.type
              ]
          )
        )
      : 0;

  const requiredWidth =
    PARTICIPANT_LABEL_WIDTH +
    CONTENT_LEFT_PADDING +
    Math.max(
      0,
      process.elements.length - 1
    ) *
      STEP_X +
    maxElementWidth +
    CONTENT_RIGHT_PADDING;

  return Math.max(
    MIN_POOL_WIDTH,
    requiredWidth
  );
}

// ======================================================
// SEQUENCE FLOW WAYPOINTS
// ======================================================

function sequenceFlowWaypoints(
  from: Bounds,
  to: Bounds
): Point[] {
  const fromX =
    from.x + from.width;

  const fromY =
    from.y +
    from.height / 2;

  const toX =
    to.x;

  const toY =
    to.y +
    to.height / 2;

  if (
    Math.abs(fromY - toY) < 1
  ) {
    return [
      [fromX, fromY],
      [toX, toY]
    ];
  }

  const middleX =
    (fromX + toX) / 2;

  return [
    [fromX, fromY],
    [middleX, fromY],
    [middleX, toY],
    [toX, toY]
  ];
}

// ======================================================
// MESSAGE FLOW WAYPOINTS
// ======================================================

function messageFlowWaypoints(
  from: Bounds,
  to: Bounds
): Point[] {
  const fromCenterX =
    from.x +
    from.width / 2;

  const fromCenterY =
    from.y +
    from.height / 2;

  const toCenterX =
    to.x +
    to.width / 2;

  const toCenterY =
    to.y +
    to.height / 2;

  // Source is above target
  if (
    from.y + from.height <=
    to.y
  ) {
    const source: Point = [
      fromCenterX,
      from.y + from.height
    ];

    const target: Point = [
      toCenterX,
      to.y
    ];

    const middleY =
      (source[1] + target[1]) / 2;

    return [
      source,
      [
        source[0],
        middleY
      ],
      [
        target[0],
        middleY
      ],
      target
    ];
  }

  // Source is below target
  if (
    to.y + to.height <=
    from.y
  ) {
    const source: Point = [
      fromCenterX,
      from.y
    ];

    const target: Point = [
      toCenterX,
      to.y + to.height
    ];

    const middleY =
      (source[1] + target[1]) / 2;

    return [
      source,
      [
        source[0],
        middleY
      ],
      [
        target[0],
        middleY
      ],
      target
    ];
  }

  // Horizontal fallback
  if (
    fromCenterX <=
    toCenterX
  ) {
    return [
      [
        from.x + from.width,
        fromCenterY
      ],
      [
        to.x,
        toCenterY
      ]
    ];
  }

  return [
    [
      from.x,
      fromCenterY
    ],
    [
      to.x + to.width,
      toCenterY
    ]
  ];
}

// ======================================================
// DI WAYPOINT XML
// ======================================================

function renderWaypoints(
  waypoints: Point[]
): string {
  return waypoints
    .map(
      ([x, y]) =>
        `<di:waypoint x="${Number(
          x.toFixed(2)
        )}" y="${Number(
          y.toFixed(2)
        )}" />`
    )
    .join("");
}

// ======================================================
// GENERATE BPMN XML
// ======================================================

export function generateBpmnXml(
  process: ProcessModel
): string {
  // ====================================================
  // FIND INTERNAL WHITE-BOX PARTICIPANT
  // ====================================================

  const internalParticipant =
    process.participants.find(
      (participant) =>
        participant.type ===
          "internal" &&
        participant.processVisibility ===
          "white_box"
    );

  if (!internalParticipant) {
    throw new Error(
      "Cannot generate BPMN: internal white-box participant is missing"
    );
  }

  const internalParticipantId =
    internalParticipant.id;

  // ====================================================
  // IDS
  // ====================================================

  const processId =
    `Process_${sanitizeId(
      process.id
    )}`;

  const collaborationId =
    `Collaboration_${sanitizeId(
      process.id
    )}`;

  const diagramId =
    `Diagram_${sanitizeId(
      process.id
    )}`;

  const planeId =
    `Plane_${sanitizeId(
      process.id
    )}`;

  // ====================================================
  // PARTICIPANTS
  // ====================================================

  const externalParticipants =
    process.participants.filter(
      (participant) =>
        participant.id !==
        internalParticipantId
    );

  const poolWidth =
    calculatePoolWidth(process);

  // ====================================================
  // PARTICIPANT BOUNDS
  // ====================================================

  const participantBoundsById =
    new Map<string, Bounds>();

  externalParticipants.forEach(
    (participant, index) => {
      participantBoundsById.set(
        participant.id,
        {
          x:
            POOL_X,

          y:
            TOP_Y +
            index *
              (
                EXTERNAL_POOL_HEIGHT +
                EXTERNAL_POOL_GAP
              ),

          width:
            poolWidth,

          height:
            EXTERNAL_POOL_HEIGHT
        }
      );
    }
  );

  const internalLanes =
    process.lanes.filter(
      (lane) =>
        lane.participantId ===
        internalParticipantId
    );

  const internalPoolHeight =
    internalLanes.length > 0
      ? internalLanes.length *
        LANE_HEIGHT
      : DEFAULT_INTERNAL_POOL_HEIGHT;

  const internalPoolY =
    TOP_Y +
    externalParticipants.length *
      (
        EXTERNAL_POOL_HEIGHT +
        EXTERNAL_POOL_GAP
      );

  const internalPoolBounds:
    Bounds = {
      x:
        POOL_X,

      y:
        internalPoolY,

      width:
        poolWidth,

      height:
        internalPoolHeight
    };

  participantBoundsById.set(
    internalParticipantId,
    internalPoolBounds
  );

  // ====================================================
  // LANE BOUNDS
  // ====================================================

  const laneBoundsById =
    new Map<string, Bounds>();

  internalLanes.forEach(
    (lane, index) => {
      laneBoundsById.set(
        lane.id,
        {
          x:
            internalPoolBounds.x +
            PARTICIPANT_LABEL_WIDTH,

          y:
            internalPoolBounds.y +
            index * LANE_HEIGHT,

          width:
            internalPoolBounds.width -
            PARTICIPANT_LABEL_WIDTH,

          height:
            LANE_HEIGHT
        }
      );
    }
  );

  // ====================================================
  // ELEMENT BOUNDS
  // ====================================================

  const elementBoundsById =
    new Map<string, Bounds>();

  process.elements.forEach(
    (element, index) => {
      const width =
        ELEMENT_WIDTH[
          element.type
        ];

      const height =
        ELEMENT_HEIGHT[
          element.type
        ];

      const x =
        internalPoolBounds.x +
        PARTICIPANT_LABEL_WIDTH +
        CONTENT_LEFT_PADDING +
        index * STEP_X;

      let y =
        internalPoolBounds.y +
        (
          internalPoolBounds.height -
          height
        ) /
          2;

      if (element.laneId) {
        const laneBounds =
          laneBoundsById.get(
            element.laneId
          );

        if (laneBounds) {
          y =
            laneBounds.y +
            (
              laneBounds.height -
              height
            ) /
              2;
        }
      }

      elementBoundsById.set(
        element.id,
        {
          x,
          y,
          width,
          height
        }
      );
    }
  );

  // ====================================================
  // PARTICIPANT BPMN XML
  // ====================================================

  const participantXml =
    process.participants
      .map(
        (participant) =>
          renderParticipantXml(
            participant,
            internalParticipantId,
            processId
          )
      )
      .join("");

  // ====================================================
  // MESSAGE FLOW BPMN XML
  // ====================================================

  const messageFlowXml =
    process.messageFlows
      .map(
        renderMessageFlowXml
      )
      .join("");

  // ====================================================
  // COLLABORATION XML
  // ====================================================

  const collaborationXml = [
    `<bpmn:collaboration`,
    ` id="${collaborationId}"`,
    `>`,
    participantXml,
    messageFlowXml,
    `</bpmn:collaboration>`
  ].join("");

  // ====================================================
  // PROCESS XML
  // ====================================================

  const laneSetXml =
    renderLaneSetXml(
      process,
      internalParticipantId
    );

  const elementXml =
    process.elements
      .map(renderElementXml)
      .join("");

  const sequenceFlowXml =
    process.flows
      .map(renderFlowXml)
      .join("");

  const processXml = [
    `<bpmn:process`,
    ` id="${processId}"`,
    ` isExecutable="false"`,
    `>`,
    laneSetXml,
    elementXml,
    sequenceFlowXml,
    `</bpmn:process>`
  ].join("");

  // ====================================================
  // DI PARTICIPANT SHAPES
  // ====================================================

  const participantShapes =
    process.participants
      .map(
        (participant) => {
          const bounds =
            participantBoundsById.get(
              participant.id
            );

          if (!bounds) {
            throw new Error(
              `Missing participant bounds for ${participant.id}`
            );
          }

          return [
            `<bpmndi:BPMNShape`,
            ` id="${generatedId(
              "Shape",
              participant.id
            )}"`,
            ` bpmnElement="${escapeXml(
              participant.id
            )}"`,
            ` isHorizontal="true"`,
            `>`,
            `<dc:Bounds`,
            ` x="${bounds.x}"`,
            ` y="${bounds.y}"`,
            ` width="${bounds.width}"`,
            ` height="${bounds.height}"`,
            ` />`,
            `</bpmndi:BPMNShape>`
          ].join("");
        }
      )
      .join("");

  // ====================================================
  // DI LANE SHAPES
  // ====================================================

  const laneShapes =
    internalLanes
      .map(
        (lane) => {
          const bounds =
            laneBoundsById.get(
              lane.id
            );

          if (!bounds) {
            throw new Error(
              `Missing lane bounds for ${lane.id}`
            );
          }

          return [
            `<bpmndi:BPMNShape`,
            ` id="${generatedId(
              "Shape",
              lane.id
            )}"`,
            ` bpmnElement="${escapeXml(
              lane.id
            )}"`,
            ` isHorizontal="true"`,
            `>`,
            `<dc:Bounds`,
            ` x="${bounds.x}"`,
            ` y="${bounds.y}"`,
            ` width="${bounds.width}"`,
            ` height="${bounds.height}"`,
            ` />`,
            `</bpmndi:BPMNShape>`
          ].join("");
        }
      )
      .join("");

  // ====================================================
  // DI ELEMENT SHAPES
  // ====================================================

  const elementShapes =
    process.elements
      .map(
        (element) => {
          const bounds =
            elementBoundsById.get(
              element.id
            );

          if (!bounds) {
            throw new Error(
              `Missing bounds for element ${element.id}`
            );
          }

          const gatewayMarker =
            element.type ===
            "exclusiveGateway"
              ? ` isMarkerVisible="true"`
              : "";

          return [
            `<bpmndi:BPMNShape`,
            ` id="${generatedId(
              "Shape",
              element.id
            )}"`,
            ` bpmnElement="${escapeXml(
              element.id
            )}"`,
            gatewayMarker,
            `>`,
            `<dc:Bounds`,
            ` x="${bounds.x}"`,
            ` y="${bounds.y}"`,
            ` width="${bounds.width}"`,
            ` height="${bounds.height}"`,
            ` />`,
            `</bpmndi:BPMNShape>`
          ].join("");
        }
      )
      .join("");

  // ====================================================
  // DI SEQUENCE FLOW EDGES
  // ====================================================

  const sequenceEdges =
    process.flows
      .map(
        (flow) => {
          const fromBounds =
            elementBoundsById.get(
              flow.from
            );

          const toBounds =
            elementBoundsById.get(
              flow.to
            );

          if (
            !fromBounds ||
            !toBounds
          ) {
            return "";
          }

          const waypoints =
            sequenceFlowWaypoints(
              fromBounds,
              toBounds
            );

          return [
            `<bpmndi:BPMNEdge`,
            ` id="${generatedId(
              "Edge",
              flow.id
            )}"`,
            ` bpmnElement="${escapeXml(
              flow.id
            )}"`,
            `>`,
            renderWaypoints(
              waypoints
            ),
            `</bpmndi:BPMNEdge>`
          ].join("");
        }
      )
      .join("");

  // ====================================================
  // REFERENCE BOUNDS FOR MESSAGE FLOWS
  // ====================================================

  const referenceBounds =
    new Map<string, Bounds>([
      ...participantBoundsById,
      ...elementBoundsById
    ]);

  // ====================================================
  // DI MESSAGE FLOW EDGES
  // ====================================================

  const messageEdges =
    process.messageFlows
      .map(
        (flow) => {
          const sourceRef =
            flow.sourceElementId ??
            flow.fromParticipantId;

          const targetRef =
            flow.targetElementId ??
            flow.toParticipantId;

          const fromBounds =
            referenceBounds.get(
              sourceRef
            );

          const toBounds =
            referenceBounds.get(
              targetRef
            );

          if (
            !fromBounds ||
            !toBounds
          ) {
            return "";
          }

          const waypoints =
            messageFlowWaypoints(
              fromBounds,
              toBounds
            );

          return [
            `<bpmndi:BPMNEdge`,
            ` id="${generatedId(
              "Edge",
              flow.id
            )}"`,
            ` bpmnElement="${escapeXml(
              flow.id
            )}"`,
            `>`,
            renderWaypoints(
              waypoints
            ),
            `</bpmndi:BPMNEdge>`
          ].join("");
        }
      )
      .join("");

  // ====================================================
  // COMPLETE BPMN DOCUMENT
  // ====================================================

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,

    `<bpmn:definitions`,
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
    ` xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"`,
    ` xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"`,
    ` xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"`,
    ` xmlns:di="http://www.omg.org/spec/DD/20100524/DI"`,
    ` id="Definitions_${sanitizeId(
      process.id
    )}"`,
    ` targetNamespace="http://bpmn.io/schema/bpmn"`,
    `>`,

    collaborationXml,

    processXml,

    `<bpmndi:BPMNDiagram`,
    ` id="${diagramId}"`,
    `>`,

    `<bpmndi:BPMNPlane`,
    ` id="${planeId}"`,
    ` bpmnElement="${collaborationId}"`,
    `>`,

    participantShapes,
    laneShapes,
    elementShapes,
    sequenceEdges,
    messageEdges,

    `</bpmndi:BPMNPlane>`,
    `</bpmndi:BPMNDiagram>`,

    `</bpmn:definitions>`
  ].join("");
}