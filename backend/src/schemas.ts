import { z } from "zod";

// ======================================================
// ENUMS
// ======================================================

export const participantTypeSchema = z.enum([
  "internal",
  "external",
  "system"
]);

export const processVisibilitySchema = z.enum([
  "white_box",
  "black_box"
]);

export const laneTypeSchema = z.enum([
  "role",
  "department",
  "team",
  "system"
]);

export const executionTypeSchema = z.enum([
  "human",
  "automated",
  "mixed"
]);

export const workaroundCategorySchema = z.enum([
  "system_limitation",
  "missing_functionality",
  "manual_rework",
  "data_quality",
  "missing_authorization",
  "performance",
  "policy_deviation",
  "other"
]);

export const workaroundStatusSchema = z.enum([
  "suspected",
  "confirmed",
  "rejected"
]);

export const workaroundLogVisibilitySchema = z.enum([
  "logged",
  "partially_logged",
  "not_logged",
  "unknown"
]);

export const intentSchema = z.enum([
  "process_description",
  "answer_to_question",
  "correction",
  "confirmation",
  "rejection",
  "workaround_detail",
  "process_completion",
  "unclear"
]);

export const pendingQuestionKindSchema = z.enum([
  "clarification",
  "element_confirmation",
  "sequence_confirmation",

  // Organizational elicitation
  "participant_boundary",
  "actor_role",
  "lane_assignment",
  "handoff_target",

  // Workaround elicitation
  "workaround_expected_practice",
  "workaround_obstacle",
  "workaround_goal",
  "workaround_frequency",
  "workaround_log_visibility",
  "workaround_confirmation"
]);

export const uncertaintyTypeSchema = z.enum([
  "sequence",
  "condition",
  "meaning",
  "workaround",
  "reference",

  // Organizational uncertainty
  "participant",
  "lane",
  "handoff"
]);

// ======================================================
// HELPERS FOR STRUCTURED OUTPUT PATCH VALUES
// ======================================================
//
// Structured Output PATCH objects may contain null.
//
// null means:
// "Do not change / information not supplied."
//
// After Zod parsing these helpers transform:
// null -> undefined
// ======================================================

const nullableOptionalString = z
  .string()
  .nullable()
  .optional()
  .transform(
    (
      value: string | null | undefined
    ): string | undefined =>
      value ?? undefined
  );

const nullableOptionalBoolean = z
  .boolean()
  .nullable()
  .optional()
  .transform(
    (
      value: boolean | null | undefined
    ): boolean | undefined =>
      value ?? undefined
  );

const nullableOptionalStringArray = z
  .array(z.string().min(1))
  .nullable()
  .optional()
  .transform(
    (
      value: string[] | null | undefined
    ): string[] | undefined =>
      value ?? undefined
  );

const nullableOptionalParticipantType =
  participantTypeSchema
    .nullable()
    .optional()
    .transform(
      (
        value:
          | z.infer<typeof participantTypeSchema>
          | null
          | undefined
      ):
        | z.infer<typeof participantTypeSchema>
        | undefined =>
        value ?? undefined
    );

const nullableOptionalProcessVisibility =
  processVisibilitySchema
    .nullable()
    .optional()
    .transform(
      (
        value:
          | z.infer<typeof processVisibilitySchema>
          | null
          | undefined
      ):
        | z.infer<typeof processVisibilitySchema>
        | undefined =>
        value ?? undefined
    );

const nullableOptionalLaneType =
  laneTypeSchema
    .nullable()
    .optional()
    .transform(
      (
        value:
          | z.infer<typeof laneTypeSchema>
          | null
          | undefined
      ):
        | z.infer<typeof laneTypeSchema>
        | undefined =>
        value ?? undefined
    );

const nullableOptionalExecutionType =
  executionTypeSchema
    .nullable()
    .optional()
    .transform(
      (
        value:
          | z.infer<typeof executionTypeSchema>
          | null
          | undefined
      ):
        | z.infer<typeof executionTypeSchema>
        | undefined =>
        value ?? undefined
    );

const nullableOptionalCategory =
  workaroundCategorySchema
    .nullable()
    .optional()
    .transform(
      (
        value:
          | z.infer<typeof workaroundCategorySchema>
          | null
          | undefined
      ):
        | z.infer<typeof workaroundCategorySchema>
        | undefined =>
        value ?? undefined
    );

const nullableOptionalLogVisibility =
  workaroundLogVisibilitySchema
    .nullable()
    .optional()
    .transform(
      (
        value:
          | z.infer<typeof workaroundLogVisibilitySchema>
          | null
          | undefined
      ):
        | z.infer<typeof workaroundLogVisibilitySchema>
        | undefined =>
        value ?? undefined
    );

const nullableOptionalStatus =
  workaroundStatusSchema
    .nullable()
    .optional()
    .transform(
      (
        value:
          | z.infer<typeof workaroundStatusSchema>
          | null
          | undefined
      ):
        | z.infer<typeof workaroundStatusSchema>
        | undefined =>
        value ?? undefined
    );

// ======================================================
// PARTICIPANTS / POOLS
// ======================================================

export const participantSchema = z
  .object({
    id: z.string().min(1),

    name: z.string().min(1),

    type: participantTypeSchema,

    processVisibility:
      processVisibilitySchema
  })
  .strict();

export const participantDraftSchema = z
  .object({
    tempRef: z.string().min(1),

    name: z.string().min(1),

    type: participantTypeSchema,

    processVisibility:
      processVisibilitySchema
  })
  .strict();

export const participantUpdateSchema = z
  .object({
    id: z.string().min(1),

    name:
      nullableOptionalString,

    type:
      nullableOptionalParticipantType,

    processVisibility:
      nullableOptionalProcessVisibility
  })
  .strict();

// ======================================================
// LANES
// ======================================================

export const laneSchema = z
  .object({
    id: z.string().min(1),

    participantId:
      z.string().min(1),

    name:
      z.string().min(1),

    type:
      laneTypeSchema
  })
  .strict();

export const laneDraftSchema = z
  .object({
    tempRef:
      z.string().min(1),

    /**
     * Existing participant ID or tempRef of a participant
     * created in the same LLM response.
     */
    participantRef:
      z.string().min(1),

    name:
      z.string().min(1),

    type:
      laneTypeSchema
  })
  .strict();

export const laneUpdateSchema = z
  .object({
    id:
      z.string().min(1),

    name:
      nullableOptionalString,

    type:
      nullableOptionalLaneType,

    participantId:
      nullableOptionalString,

    participantRef:
      nullableOptionalString
  })
  .strict();

// ======================================================
// PROCESS ELEMENTS
// ======================================================

const bpmnEventDefinitionTypeSchema = z.enum([
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
]);

const startElementSchema = z
  .object({
    id:
      z.string().min(1),

    type:
      z.literal("start"),

    name:
      z.string().min(1),

    participantId:
      z.string().min(1).optional(),

    laneId:
      z.string().min(1).optional(),

    eventDefinitionType:
      bpmnEventDefinitionTypeSchema.optional()
  })
  .strict();

const taskElementSchema = z
  .object({
    id:
      z.string().min(1),

    type:
      z.literal("task"),

    name:
      z.string().min(1),

    participantId:
      z.string().min(1).optional(),

    laneId:
      z.string().min(1).optional(),

    performer:
      z.string().min(1).optional(),

    system:
      z.string().min(1).optional(),

    executionType:
      executionTypeSchema.optional(),

    employeeConfirmed:
      z.boolean().optional(),

    // ----------------------------------------------
    // Legacy task-level workaround fields
    // ----------------------------------------------

    workaroundCandidate:
      z.boolean().optional(),

    workaroundConfirmed:
      z.boolean().optional(),

    workaroundReason:
      z.string().optional(),

    workaroundCategory:
      workaroundCategorySchema.optional()
  })
  .strict();

const gatewayElementSchema = z
  .object({
    id:
      z.string().min(1),

    type:
      z.literal("exclusiveGateway"),

    name:
      z.string().min(1),

    participantId:
      z.string().min(1).optional(),

    laneId:
      z.string().min(1).optional()
  })
  .strict();

const intermediateEventSchema = z
  .object({
    id:
      z.string().min(1),

    type:
      z.enum([
        "intermediateCatchEvent",
        "intermediateThrowEvent"
      ]),

    name:
      z.string().min(1),

    participantId:
      z.string().min(1).optional(),

    laneId:
      z.string().min(1).optional(),

    eventDefinitionType:
      bpmnEventDefinitionTypeSchema.optional()
  })
  .strict();

const boundaryEventSchema = z
  .object({
    id:
      z.string().min(1),

    type:
      z.literal("boundaryEvent"),

    name:
      z.string().min(1),

    participantId:
      z.string().min(1).optional(),

    laneId:
      z.string().min(1).optional(),

    attachedToRef:
      z.string().min(1),

    cancelActivity:
      z.boolean(),

    eventDefinitionType:
      bpmnEventDefinitionTypeSchema.optional()
  })
  .strict();

const endElementSchema = z
  .object({
    id:
      z.string().min(1),

    type:
      z.literal("end"),

    name:
      z.string().min(1),

    participantId:
      z.string().min(1).optional(),

    laneId:
      z.string().min(1).optional(),

    eventDefinitionType:
      bpmnEventDefinitionTypeSchema.optional()
  })
  .strict();

export const processElementSchema =
  z.discriminatedUnion(
    "type",
    [
      startElementSchema,
      taskElementSchema,
      gatewayElementSchema,
      intermediateEventSchema,
      boundaryEventSchema,
      endElementSchema
    ]
  );

// ======================================================
// PROCESS ELEMENT DRAFT
// ======================================================
//
// participantRef / laneRef may reference either:
// - an existing stable ID
// - a tempRef created in the same response
// ======================================================

export const changeElementSchema = z
  .object({
    id:
      z.string().min(1).optional(),

    tempRef:
      z.string().min(1).optional(),

    type: z.enum([
      "start",
      "task",
      "exclusiveGateway",
      "intermediateCatchEvent",
      "intermediateThrowEvent",
      "boundaryEvent",
      "end"
    ]),

    name:
      z.string().min(1),

    eventDefinitionType:
      bpmnEventDefinitionTypeSchema.nullable().optional(),

    attachedToRef:
      nullableOptionalString,

    cancelActivity:
      nullableOptionalBoolean,

    participantRef:
      nullableOptionalString,

    laneRef:
      nullableOptionalString,

    performer:
      nullableOptionalString,

    system:
      nullableOptionalString,

    executionType:
      nullableOptionalExecutionType,

    employeeConfirmed:
      nullableOptionalBoolean,

    workaroundCandidate:
      nullableOptionalBoolean,

    workaroundConfirmed:
      nullableOptionalBoolean,

    workaroundReason:
      nullableOptionalString,

    workaroundCategory:
      nullableOptionalCategory
  })
  .strict();

// ======================================================
// PROCESS ELEMENT UPDATE
// ======================================================

export const processElementUpdateSchema = z
  .object({
    id:
      z.string().min(1),

    name:
      nullableOptionalString,

    eventDefinitionType:
      bpmnEventDefinitionTypeSchema.nullable().optional(),

    attachedToRef:
      nullableOptionalString,

    cancelActivity:
      nullableOptionalBoolean,

    // Stable organizational IDs
    participantId:
      nullableOptionalString,

    laneId:
      nullableOptionalString,

    // Temp refs for entities created in the same response
    participantRef:
      nullableOptionalString,

    laneRef:
      nullableOptionalString,

    performer:
      nullableOptionalString,

    system:
      nullableOptionalString,

    executionType:
      nullableOptionalExecutionType,

    employeeConfirmed:
      nullableOptionalBoolean,

    workaroundCandidate:
      nullableOptionalBoolean,

    workaroundConfirmed:
      nullableOptionalBoolean,

    workaroundReason:
      nullableOptionalString,

    workaroundCategory:
      nullableOptionalCategory
  })
  .strict();

// ======================================================
// SEQUENCE FLOWS
// ======================================================
//
// Sequence flows connect flow nodes inside one participant.
// ======================================================

export const sequenceFlowSchema = z
  .object({
    id:
      z.string().min(1),

    from:
      z.string().min(1),

    to:
      z.string().min(1),

    condition:
      z.string().min(1).optional()
  })
  .strict();

// ======================================================
// SEQUENCE FLOW DRAFT
// ======================================================

export const changeFlowSchema = z
  .object({
    id:
      z.string().min(1).optional(),

    from:
      z.string().min(1).optional(),

    to:
      z.string().min(1).optional(),

    fromRef:
      z.string().min(1).optional(),

    toRef:
      z.string().min(1).optional(),

    condition:
      nullableOptionalString
  })
  .strict()
  .refine(
    (flow) =>
      Boolean(
        flow.from ||
        flow.fromRef
      ),
    {
      message:
        "Flow requires a source reference"
    }
  )
  .refine(
    (flow) =>
      Boolean(
        flow.to ||
        flow.toRef
      ),
    {
      message:
        "Flow requires a target reference"
    }
  );

// ======================================================
// MESSAGE FLOWS
// ======================================================
//
// Message flows connect different participants / pools.
// ======================================================

export const messageFlowSchema = z
  .object({
    id:
      z.string().min(1),

    fromParticipantId:
      z.string().min(1),

    toParticipantId:
      z.string().min(1),

    sourceElementId:
      z.string().min(1).optional(),

    targetElementId:
      z.string().min(1).optional(),

    name:
      z.string().min(1).optional()
  })
  .strict();

export const messageFlowDraftSchema = z
  .object({
    id:
      z.string().min(1).optional(),

    tempRef:
      z.string().min(1).optional(),

    /**
     * Stable participant ID or participant tempRef.
     */
    fromParticipantRef:
      z.string().min(1),

    toParticipantRef:
      z.string().min(1),

    /**
     * Stable flow-node ID or element tempRef.
     */
    sourceElementRef:
      nullableOptionalString,

    targetElementRef:
      nullableOptionalString,

    name:
      nullableOptionalString
  })
  .strict();

// ======================================================
// WORKAROUND DRAFT
// ======================================================

export const workaroundDraftSchema = z
  .object({
    tempRef:
      z.string().min(1),

    relatedActivityRefs:
      z
        .array(z.string().min(1))
        .default([]),

    actualPractice:
      z.string().min(1),

    obstacleOrMisfit:
      nullableOptionalString,

    category:
      nullableOptionalCategory
  })
  .strict();

// ======================================================
// STORED WORKAROUND CANDIDATE
// ======================================================

export const workaroundCandidateSchema = z
  .object({
    id:
      z.string().min(1),

    relatedActivityIds:
      z
        .array(z.string().min(1))
        .default([]),

    actualPractice:
      z.string().min(1),

    expectedPractice:
      z.string().min(1).optional(),

    obstacleOrMisfit:
      z.string().min(1).optional(),

    goalOrMotivation:
      z.string().min(1).optional(),

    category:
      workaroundCategorySchema.optional(),

    frequency:
      z.string().min(1).optional(),

    logVisibility:
      workaroundLogVisibilitySchema.default(
        "unknown"
      ),

    status:
      workaroundStatusSchema.default(
        "suspected"
      ),

    evidenceMessageIds:
      z
        .array(z.string().min(1))
        .default([])
  })
  .strict();

// ======================================================
// WORKAROUND UPDATE
// ======================================================

export const workaroundCandidateUpdateSchema = z
  .object({
    id:
      z.string().min(1),

    relatedActivityIds:
      nullableOptionalStringArray,

    actualPractice:
      nullableOptionalString,

    expectedPractice:
      nullableOptionalString,

    obstacleOrMisfit:
      nullableOptionalString,

    goalOrMotivation:
      nullableOptionalString,

    category:
      nullableOptionalCategory,

    frequency:
      nullableOptionalString,

    logVisibility:
      nullableOptionalLogVisibility,

    status:
      nullableOptionalStatus,

    evidenceMessageIds:
      nullableOptionalStringArray
  })
  .strict();

// ======================================================
// PROCESS MODEL
// ======================================================

export const processModelSchema = z
  .object({
    id:
      z.string().min(1),

    name:
      z.string().min(1),

    status:
      z.enum([
        "eliciting",
        "review",
        "confirmed"
      ]),

    /**
     * Defaults preserve compatibility with older stored
     * sessions that did not yet have pools and lanes.
     */
    participants:
      z
        .array(participantSchema)
        .default([]),

    lanes:
      z
        .array(laneSchema)
        .default([]),

    elements:
      z.array(processElementSchema),

    flows:
      z.array(sequenceFlowSchema),

    messageFlows:
      z
        .array(messageFlowSchema)
        .default([]),

    workarounds:
      z
        .array(workaroundCandidateSchema)
        .default([]),

    updatedAt:
      z.string().datetime()
  })
  .strict();

// ======================================================
// PROCESS CHANGES
// ======================================================

export const processChangesSchema = z
  .object({
    // --------------------------------------------------
    // Participants / Pools
    // --------------------------------------------------

    addParticipants:
      z
        .array(participantDraftSchema)
        .default([]),

    updateParticipants:
      z
        .array(participantUpdateSchema)
        .default([]),

    removeParticipantIds:
      z
        .array(z.string().min(1))
        .default([]),

    // --------------------------------------------------
    // Lanes
    // --------------------------------------------------

    addLanes:
      z
        .array(laneDraftSchema)
        .default([]),

    updateLanes:
      z
        .array(laneUpdateSchema)
        .default([]),

    removeLaneIds:
      z
        .array(z.string().min(1))
        .default([]),

    // --------------------------------------------------
    // Elements
    // --------------------------------------------------

    addElements:
      z
        .array(changeElementSchema)
        .default([]),

    updateElements:
      z
        .array(processElementUpdateSchema)
        .default([]),

    removeElementIds:
      z
        .array(z.string().min(1))
        .default([]),

    // --------------------------------------------------
    // Sequence Flows
    // --------------------------------------------------

    addFlows:
      z
        .array(changeFlowSchema)
        .default([]),

    removeFlowIds:
      z
        .array(z.string().min(1))
        .default([]),

    // --------------------------------------------------
    // Message Flows
    // --------------------------------------------------

    addMessageFlows:
      z
        .array(messageFlowDraftSchema)
        .default([]),

    removeMessageFlowIds:
      z
        .array(z.string().min(1))
        .default([]),

    // --------------------------------------------------
    // Workarounds
    // --------------------------------------------------

    addWorkarounds:
      z
        .array(workaroundDraftSchema)
        .default([]),

    updateWorkarounds:
      z
        .array(
          workaroundCandidateUpdateSchema
        )
        .default([])
  })
  .strict();

// ======================================================
// VALIDATION REQUEST
// ======================================================

export const validationRequestSchema = z
  .object({
    required:
      z.boolean().default(false),

    elementIds:
      z
        .array(z.string().min(1))
        .default([]),

    question:
      z.string().default("")
  })
  .strict();

// ======================================================
// NEXT QUESTION
// ======================================================

export const nextQuestionSchema = z
  .object({
    required:
      z.boolean().default(false),

    kind:
      pendingQuestionKindSchema.default(
        "clarification"
      ),

    targetRefs:
      z
        .array(z.string().min(1))
        .default([]),

    question:
      z.string().default("")
  })
  .strict();

// ======================================================
// PROCESS CONTEXT PATCH
// ======================================================

export const contextPatchSchema = z
  .object({
    name:
      z
        .string()
        .nullable()
        .optional(),

    goal:
      z
        .string()
        .nullable()
        .optional(),

    trigger:
      z
        .string()
        .nullable()
        .optional(),

    outcome:
      z
        .string()
        .nullable()
        .optional()
  })
  .strict();

// ======================================================
// UNCERTAINTY
// ======================================================

export const uncertaintySchema = z
  .object({
    type:
      uncertaintyTypeSchema,

    targetRefs:
      z
        .array(z.string().min(1))
        .default([]),

    description:
      z.string().min(1)
  })
  .strict();

// ======================================================
// COMPLETE LLM RESPONSE
// ======================================================

export const llmProcessResponseSchema = z
  .object({
    language:
      z.enum([
        "de",
        "en"
      ]),

    intent:
      intentSchema.default(
        "process_description"
      ),

    assistantMessage:
      z.string().min(1),

    contextPatch:
      contextPatchSchema.default({}),

    changes:
      processChangesSchema,

    uncertainties:
      z
        .array(uncertaintySchema)
        .default([]),

    nextQuestion:
      nextQuestionSchema.default({
        required: false,
        kind: "clarification",
        targetRefs: [],
        question: ""
      }),

    validationRequest:
      validationRequestSchema.default({
        required: false,
        elementIds: [],
        question: ""
      }),

    responsibility:
      z
        .object({
          intervieweeRole:
            z.string().nullable().optional(),

          actor:
            z
              .enum(["interviewee", "previous", "named"])
              .nullable()
              .optional(),

          noFurtherDetail:
            z.boolean().nullable().optional()
        })
        .strict()
        .default({}),

    practiceHints:
      z
        .array(
          z
            .object({
              activityRefs:
                z.array(z.string()).default([]),

              relation:
                z.enum(["same_practice", "independent"]),

              extendsPracticeId:
                z.string().nullable().optional(),

              basis:
                z.string().nullable().optional()
            })
            .strict()
        )
        .default([]),

    practiceAnswers:
      z
        .array(
          z
            .object({
              practiceId:
                z.string().nullable().optional(),

              field:
                z.enum(["reason", "sinceWhen", "frequency"]),

              scope:
                z.enum(["practice", "activities"]),

              activityRefs:
                z.array(z.string()).default([]),

              unknown:
                z.boolean().nullable().optional(),

              value:
                z.string().nullable().optional()
            })
            .strict()
        )
        .default([])
  })
  .strict();