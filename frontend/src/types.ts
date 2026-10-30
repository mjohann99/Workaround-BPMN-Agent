// ======================================================
// PROCESS STATUS
// ======================================================

export type ProcessStatus =
  | "eliciting"
  | "review"
  | "confirmed";


// ======================================================
// ORGANIZATIONAL STRUCTURE
// ======================================================

export type ParticipantType =
  | "internal"
  | "external"
  | "system";

export type ProcessVisibility =
  | "white_box"
  | "black_box";

export type Participant = {
  id: string;

  name: string;

  type: ParticipantType;

  processVisibility:
    ProcessVisibility;
};

export type ParticipantDraft = {
  tempRef: string;

  name: string;

  type: ParticipantType;

  processVisibility:
    ProcessVisibility;
};

export type ParticipantUpdate = {
  id: string;

  name?: string;

  type?: ParticipantType;

  processVisibility?:
    ProcessVisibility;
};


// ======================================================
// LANES
// ======================================================

export type LaneType =
  | "role"
  | "department"
  | "team"
  | "system";

export type Lane = {
  id: string;

  participantId: string;

  name: string;

  type: LaneType;
};

export type LaneDraft = {
  tempRef: string;

  participantRef: string;

  name: string;

  type: LaneType;
};

export type LaneUpdate = {
  id: string;

  name?: string;

  type?: LaneType;

  participantId?: string;

  participantRef?: string;
};


// ======================================================
// TASK EXECUTION
// ======================================================

export type ExecutionType =
  | "human"
  | "automated"
  | "mixed";


// ======================================================
// LEGACY WORKAROUNDS
// ======================================================
//
// These structures remain temporarily because parts of
// the existing application still reference them.
//
// New deviation detection should NOT use them as its
// source of truth.
//
// New architecture:
//
// Conformance
// -> DeviationCandidate
// -> DeviationInvestigation
// -> OwnerReview
// ======================================================

export type WorkaroundCategory =
  | "system_limitation"
  | "missing_functionality"
  | "manual_rework"
  | "data_quality"
  | "missing_authorization"
  | "performance"
  | "policy_deviation"
  | "other";

export type WorkaroundLogVisibility =
  | "logged"
  | "partially_logged"
  | "not_logged"
  | "unknown";

export type WorkaroundStatus =
  | "suspected"
  | "confirmed"
  | "rejected";

export type WorkaroundCandidate = {
  id: string;

  relatedActivityIds:
    string[];

  actualPractice:
    string;

  expectedPractice?:
    string;

  obstacleOrMisfit?:
    string;

  goalOrMotivation?:
    string;

  category?:
    WorkaroundCategory;

  frequency?:
    string;

  logVisibility:
    WorkaroundLogVisibility;

  status:
    WorkaroundStatus;

  evidenceMessageIds:
    string[];
};

export type WorkaroundCandidateDraft = {
  tempRef: string;

  relatedActivityRefs:
    string[];

  actualPractice:
    string;

  obstacleOrMisfit?:
    string;

  category?:
    WorkaroundCategory;
};

export type WorkaroundCandidateUpdate = {
  id: string;

  relatedActivityIds?:
    string[];

  actualPractice?:
    string;

  expectedPractice?:
    string;

  obstacleOrMisfit?:
    string;

  goalOrMotivation?:
    string;

  category?:
    WorkaroundCategory;

  frequency?:
    string;

  logVisibility?:
    WorkaroundLogVisibility;

  status?:
    WorkaroundStatus;

  evidenceMessageIds?:
    string[];
};


// ======================================================
// PROCESS ELEMENTS
// ======================================================

type ProcessElementBase = {
  id: string;

  name: string;

  participantId?:
    string;

  laneId?:
    string;
};

export type BpmnEventDefinitionType =
  | "message"
  | "timer"
  | "error"
  | "escalation"
  | "conditional"
  | "link"
  | "signal"
  | "cancel"
  | "compensation"
  | "terminate"
  | "multiple"
  | "parallelMultiple";

export type ProcessElement =
  | (
      ProcessElementBase & {
        type: "start";

        eventDefinitionType?:
          BpmnEventDefinitionType;
      }
    )
  | (
      ProcessElementBase & {
        type: "task";

        performer?:
          string;

        system?:
          string;

        executionType?:
          ExecutionType;

        employeeConfirmed?:
          boolean;

        // ----------------------------------------------
        // Legacy workaround fields
        // ----------------------------------------------

        workaroundCandidate?:
          boolean;

        workaroundConfirmed?:
          boolean;

        workaroundReason?:
          string;

        workaroundCategory?:
          WorkaroundCategory;
      }
    )
  | (
      ProcessElementBase & {
        type:
          "exclusiveGateway";
      }
    )
  | (
      ProcessElementBase & {
        type:
          | "intermediateCatchEvent"
          | "intermediateThrowEvent";

        eventDefinitionType?:
          BpmnEventDefinitionType;
      }
    )
  | (
      ProcessElementBase & {
        type: "boundaryEvent";

        attachedToRef:
          string;

        cancelActivity:
          boolean;

        eventDefinitionType?:
          BpmnEventDefinitionType;
      }
    )
  | (
      ProcessElementBase & {
        type: "end";

        eventDefinitionType?:
          BpmnEventDefinitionType;
      }
    );


// ======================================================
// PROCESS ELEMENT DRAFT
// ======================================================

export type ProcessElementDraft = {
  id?: string;

  tempRef?: string;

  type:
    | "start"
    | "task"
    | "exclusiveGateway"
    | "intermediateCatchEvent"
    | "intermediateThrowEvent"
    | "boundaryEvent"
    | "end";

  name: string;

  eventDefinitionType?:
    BpmnEventDefinitionType;

  attachedToRef?:
    string | null;

  cancelActivity?:
    boolean | null;

  participantRef?:
    string;

  laneRef?:
    string;

  performer?:
    string;

  system?:
    string;

  executionType?:
    ExecutionType;

  employeeConfirmed?:
    boolean;

  workaroundCandidate?:
    boolean;

  workaroundConfirmed?:
    boolean;

  workaroundReason?:
    string;

  workaroundCategory?:
    WorkaroundCategory;
};


// ======================================================
// PROCESS ELEMENT UPDATE
// ======================================================

export type ProcessElementUpdate = {
  id: string;

  name?: string;

  eventDefinitionType?:
    BpmnEventDefinitionType | null;

  attachedToRef?:
    string | null;

  cancelActivity?:
    boolean | null;

  participantId?:
    string;

  laneId?:
    string;

  participantRef?:
    string;

  laneRef?:
    string;

  performer?:
    string;

  system?:
    string;

  executionType?:
    ExecutionType;

  employeeConfirmed?:
    boolean;

  workaroundCandidate?:
    boolean;

  workaroundConfirmed?:
    boolean;

  workaroundReason?:
    string;

  workaroundCategory?:
    WorkaroundCategory;
};


// ======================================================
// SEQUENCE FLOWS
// ======================================================

export type SequenceFlow = {
  id: string;

  from: string;

  to: string;

  condition?:
    string;
};

export type SequenceFlowDraft = {
  id?: string;

  from?: string;

  to?: string;

  fromRef?: string;

  toRef?: string;

  condition?: string;
};


// ======================================================
// MESSAGE FLOWS
// ======================================================

export type MessageFlow = {
  id: string;

  fromParticipantId:
    string;

  toParticipantId:
    string;

  sourceElementId?:
    string;

  targetElementId?:
    string;

  name?: string;
};

export type MessageFlowDraft = {
  id?: string;

  tempRef?: string;

  fromParticipantRef:
    string;

  toParticipantRef:
    string;

  sourceElementRef?:
    string;

  targetElementRef?:
    string;

  name?: string;
};


// ======================================================
// PROCESS MODEL
// ======================================================
//
// Employee-described actual AS-IS process.
//
// Reference processes are stored separately.
// ======================================================

export type ProcessModel = {
  id: string;

  name: string;

  status:
    ProcessStatus;

  participants:
    Participant[];

  lanes:
    Lane[];

  elements:
    ProcessElement[];

  flows:
    SequenceFlow[];

  messageFlows:
    MessageFlow[];

  /**
   * Legacy.
   *
   * New conformance detection should not depend on this.
   */
  workarounds:
    WorkaroundCandidate[];

  updatedAt: string;
};


// ======================================================
// PROCESS CHANGES
// ======================================================

export type ProcessChanges = {
  // ----------------------------------------------------
  // Participants
  // ----------------------------------------------------

  addParticipants:
    ParticipantDraft[];

  updateParticipants:
    ParticipantUpdate[];

  removeParticipantIds:
    string[];

  // ----------------------------------------------------
  // Lanes
  // ----------------------------------------------------

  addLanes:
    LaneDraft[];

  updateLanes:
    LaneUpdate[];

  removeLaneIds:
    string[];

  // ----------------------------------------------------
  // Elements
  // ----------------------------------------------------

  addElements:
    ProcessElementDraft[];

  updateElements:
    ProcessElementUpdate[];

  removeElementIds:
    string[];

  // ----------------------------------------------------
  // Sequence Flows
  // ----------------------------------------------------

  addFlows:
    SequenceFlowDraft[];

  removeFlowIds:
    string[];

  // ----------------------------------------------------
  // Message Flows
  // ----------------------------------------------------

  addMessageFlows:
    MessageFlowDraft[];

  removeMessageFlowIds:
    string[];

  // ----------------------------------------------------
  // Legacy Workaround Changes
  // ----------------------------------------------------

  addWorkarounds:
    WorkaroundCandidateDraft[];

  updateWorkarounds:
    WorkaroundCandidateUpdate[];
};


// ======================================================
// CHAT
// ======================================================

export type ChatMessage = {
  id: string;

  role:
    | "employee"
    | "assistant";

  content: string;

  timestamp: string;
};


// ======================================================
// ELICITATION STATE
// ======================================================

export type ElicitationPhase =
  | "scope"
  | "main_flow"
  | "branches_and_exceptions"
  | "workarounds"
  | "review"
  | "complete";

export type PendingQuestionKind =
  // ----------------------------------------------------
  // Process identification
  // ----------------------------------------------------

  | "process_scope"
  | "process_disambiguation"

  // ----------------------------------------------------
  // General process elicitation
  // ----------------------------------------------------

  | "clarification"
  | "element_confirmation"
  | "sequence_confirmation"

  // ----------------------------------------------------
  // Organizational elicitation
  // ----------------------------------------------------

  | "participant_boundary"
  | "actor_role"
  | "lane_assignment"
  | "handoff_target"

  // ----------------------------------------------------
  // Legacy workaround elicitation
  // ----------------------------------------------------

  | "workaround_expected_practice"
  | "workaround_obstacle"
  | "workaround_goal"
  | "workaround_frequency"
  | "workaround_log_visibility"
  | "workaround_confirmation"

  // ----------------------------------------------------
  // Neutral deviation investigation
  // ----------------------------------------------------

  | "practice_reason"
  | "practice_since"
  | "practice_frequency"
  | "expected_practice";


// ======================================================
// INVESTIGATION FACTS
// ======================================================

export type InvestigationFacts = {
  reason?:
    string;

  sinceWhen?:
    string;

  frequency?:
    string;

  expectedPractice?:
    string;

  goalOrMotivation?:
    string;

  awareness?:
    string;

  documented?:
    boolean;

  approved?:
    boolean;

  consequenceWithoutPractice?:
    string;
};

export type InvestigationField =
  keyof InvestigationFacts;


// ======================================================
// PENDING QUESTION
// ======================================================

export type PendingQuestion = {
  id: string;

  kind:
    PendingQuestionKind;

  targetIds:
    string[];

  field?:
    string;

  question:
    string;

  /**
   * Present when the employee is currently answering a
   * neutral investigation question.
   */
  investigationId?:
    string;

  investigationField?:
    InvestigationField;
};


// ======================================================
// PROCESS IDENTIFICATION
// ======================================================
//
// Hidden from the Employee UI.
//
// The Process Owner may inspect these fields.
// ======================================================

export type ProcessIdentificationStatus =
  | "unresolved"
  | "probable"
  | "selected";


// ======================================================
// PROCESS CANDIDATE SCORE
// ======================================================

export type ProcessCandidateScore = {
  nameSimilarity:
    number;

  activitySimilarity:
    number;

  systemSimilarity:
    number;

  laneSimilarity:
    number;

  structureSimilarity:
    number;

  /**
   * Heuristic candidate ranking score.
   *
   * This is NOT conformance fitness.
   */
  combinedScore:
    number;
};


// ======================================================
// PROCESS CANDIDATE
// ======================================================

export type ProcessCandidate = {
  referenceProcessId:
    string;

  referenceProcessVersion:
    number;

  name:
    string;

  score:
    ProcessCandidateScore;

  matchedActualActivityIds?:
    string[];

  matchedReferenceActivityIds?:
    string[];
};


// ======================================================
// PROCESS IDENTIFICATION HISTORY
// ======================================================

export type ProcessIdentificationDecisionReason =
  | "initial_name_match"
  | "activity_evidence"
  | "conformance_evidence"
  | "owner_override"
  | "selection_revised";

export type ProcessIdentificationDecision = {
  timestamp:
    string;

  activityCount:
    number;

  candidates:
    ProcessCandidate[];

  selectedReferenceProcessId?:
    string;

  selectedReferenceProcessVersion?:
    number;

  reason:
    ProcessIdentificationDecisionReason;
};


// ======================================================
// CURRENT PROCESS IDENTIFICATION
// ======================================================

export type ProcessIdentification = {
  status:
    ProcessIdentificationStatus;

  /**
   * Initial wording provided by the employee.
   *
   * Example:
   * "Auftragserfassung"
   */
  declaredProcessName?:
    string;

  /**
   * Current ranked candidate set.
   */
  candidates:
    ProcessCandidate[];

  /**
   * Currently selected reference process.
   */
  selectedReferenceProcessId?:
    string;

  /**
   * Exact reference-process version used by conformance.
   */
  selectedReferenceProcessVersion?:
    number;

  selectedReferenceModelHash?:
    string;

  selectedBy?:
    | "automatic"
    | "owner";

  /**
   * Owner selection cannot be automatically overwritten.
   */
  lockedByOwner:
    boolean;

  /**
   * Whether automatic identification is considered
   * sufficiently stable.
   */
  stable:
    boolean;

  /**
   * Current identification confidence.
   *
   * 0..1
   */
  confidence:
    number;

  /**
   * Difference between best and second-best candidate.
   */
  marginToSecondCandidate:
    number;

  selectedAtActivityCount?:
    number;

  revisionCount:
    number;

  lastEvaluatedAt?:
    string;

  history:
    ProcessIdentificationDecision[];
};


// ======================================================
// ACTIVITY MAPPING
// ======================================================
//
// Maps employee AS-IS activities to reference-process
// activities.
// ======================================================

export type ActivityMappingMethod =
  | "exact"
  | "normalized"
  | "alias"
  | "token_similarity"
  | "unmatched";

export type ActivityMapping = {
  actualActivityId:
    string;

  actualLabel:
    string;

  referenceProcessId:
    string;

  referenceProcessVersion:
    number;

  referenceActivityId?:
    string;

  referenceLabel?:
    string;

  /**
   * Mapping confidence.
   *
   * 0..1
   */
  confidence:
    number;

  method:
    ActivityMappingMethod;
};


// ======================================================
// CONFORMANCE
// ======================================================

export type ConformanceMethod =
  | "prefix_tbr"
  | "alignment";

export type AlignmentMoveType =
  | "synchronous"
  | "log_move"
  | "model_move";

export type DeviationMoveType =
  | "log_move"
  | "model_move";

export type ConformanceMove = {
  type:
    AlignmentMoveType;

  actualActivityId?:
    string;

  actualLabel?:
    string;

  referenceActivityId?:
    string;

  referenceLabel?:
    string;
};

export type ConformanceRun = {
  id: string;

  referenceProcessId:
    string;

  referenceProcessVersion:
    number;

  traceActivityIds:
    string[];

  method:
    ConformanceMethod;

  /**
   * false while the employee is still describing the
   * process.
   */
  complete:
    boolean;

  /**
   * 0..1
   */
  fitness:
    number;

  conformant:
    boolean;

  /**
   * May be empty for simple prefix replay.
   */
  moves:
    ConformanceMove[];

  createdAt:
    string;
};


// ======================================================
// DEVIATIONS
// ======================================================
//
// Deviation != Workaround.
//
// A deviation is a technical conformance result.
//
// Only the Process Owner classifies whether it is a
// workaround.
// ======================================================

export type DeviationDimension =
  | "control_flow"
  | "lane"
  | "participant"
  | "system"
  | "message_flow";

export type DeviationDetectionMethod =
  | "prefix_tbr"
  | "alignment"
  | "perspective_check";

export type DeviationStatus =
  | "open"
  | "information_complete"
  | "reviewed";

export type DeviationCandidate = {
  id: string;

  referenceProcessId:
    string;

  /**
   * Exact reference version against which the
   * deviation was detected.
   */
  referenceProcessVersion:
    number;

  /**
   * Conformance run that produced the finding.
   */
  sourceConformanceRunId:
    string;

  detectionMethod:
    DeviationDetectionMethod;

  /**
   * true while this is still a preliminary finding
   * during an incomplete interview.
   */
  provisional:
    boolean;

  dimension:
    DeviationDimension;

  moveType?:
    DeviationMoveType;

  actualActivityIds:
    string[];

  expectedReferenceActivityIds:
    string[];

  description:
    string;

  firstDetectedAt:
    string;

  status:
    DeviationStatus;
};


// ======================================================
// DEVIATION INVESTIGATION
// ======================================================

export type DeviationInvestigation = {
  id: string;

  deviationId:
    string;

  facts:
    InvestigationFacts;

  missingFields:
    InvestigationField[];

  status:
    | "open"
    | "complete";
};


// ======================================================
// OWNER REVIEW
// ======================================================

export type OwnerReviewDecision =
  | "confirmed_workaround"
  | "accepted_variant"
  | "model_outdated"
  | "not_a_workaround"
  | "needs_information";

export type OwnerReview = {
  id: string;

  deviationId:
    string;

  decision:
    OwnerReviewDecision;

  comment?:
    string;

  reviewedAt:
    string;
};


// ======================================================
// COMPLETE INTERNAL SESSION ANALYSIS
// ======================================================
//
// Employee APIs must not expose this structure.
//
// Owner APIs may expose it.
// ======================================================

export type PracticeField =
  | "reason"
  | "sinceWhen"
  | "frequency";

export type PracticeEvidence = {
  id: string;
  messageId?: string;
  excerpt: string;
  recordedAt: string;
};

export type PracticeFact = {
  status: "answered" | "unknown";
  value?: string;
  scope: "practice" | "activities";
  activityIds: string[];
  evidenceId: string;
  recordedAt: string;
};

export type PracticeCandidate = {
  id: string;
  deviationIds: string[];
  activityIds: string[];
  facts: Partial<Record<PracticeField, PracticeFact>>;
  activityFacts: Array<PracticeFact & { field: PracticeField }>;
  evidence: PracticeEvidence[];
  groupingBasis: PracticeEvidence[];
  createdAt: string;
  updatedAt: string;
};

export type SessionAnalysis = {
  processIdentification:
    ProcessIdentification;

  activityMappings:
    ActivityMapping[];

  conformanceRuns:
    ConformanceRun[];

  deviations:
    DeviationCandidate[];

  investigations:
    DeviationInvestigation[];

  practices:
    PracticeCandidate[];

  ownerReviews:
    OwnerReview[];
};


// ======================================================
// INTERNAL / GENERIC INTERVIEW SESSION
// ======================================================
//
// This type is rarely needed by the employee frontend.
// EmployeeSessionView / OwnerSessionView are preferred.
// ======================================================

export type InterviewSession = {
  id: string;

  messages:
    ChatMessage[];

  process:
    ProcessModel;

  analysis:
    SessionAnalysis;

  elicitationPhase:
    ElicitationPhase;

  pendingQuestion?:
    PendingQuestion;

  lastFocusedElementIds:
    string[];

  unresolvedProcessItems:
    string[];

  createdAt:
    string;

  updatedAt:
    string;
};


// ======================================================
// EMPLOYEE PROCESS VIEW
// ======================================================
//
// Employee must not receive workaround metadata.
// ======================================================

type FrontendProcessTask =
  Extract<
    ProcessElement,
    { type: "task" }
  >;

export type EmployeeTask =
  Omit<
    FrontendProcessTask,
    | "workaroundCandidate"
    | "workaroundConfirmed"
    | "workaroundReason"
    | "workaroundCategory"
  >;

export type EmployeeProcessElement =
  | Exclude<
      ProcessElement,
      FrontendProcessTask
    >
  | EmployeeTask;

export type EmployeeProcessView = {
  id: string;

  name: string;

  status:
    | "eliciting"
    | "complete";

  participants:
    Participant[];

  lanes:
    Lane[];

  elements:
    EmployeeProcessElement[];

  flows:
    SequenceFlow[];

  messageFlows:
    MessageFlow[];

  updatedAt: string;
};


// ======================================================
// EMPLOYEE SESSION VIEW
// ======================================================
//
// This is the sanitized structure returned by the
// employee endpoints.
//
// Important:
//
// No:
// - SessionAnalysis
// - deviations
// - conformance runs
// - reference process selection
// - workarounds
// ======================================================

export type EmployeeSessionView = {
  sessionId:
    string;

  messages:
    ChatMessage[];

  process:
    EmployeeProcessView;

  elicitationPhase:
    ElicitationPhase;

  pendingQuestion?:
    PendingQuestion;

  createdAt:
    string;

  updatedAt:
    string;

  bpmnXml:
    string;
};


// ======================================================
// EMPLOYEE POST MESSAGE RESPONSE
// ======================================================
//
// Current employee message endpoint:
//
// POST /api/employee/sessions/:id/message
//
// deliberately does not return processChanges.
// ======================================================

export type EmployeePostMessageResponse = {
  assistantMessage:
    string;

  process:
    EmployeeProcessView;

  bpmnXml:
    string;
};


// ======================================================
// EMPLOYEE PROCESS UPDATE RESPONSE
// ======================================================

export type EmployeeUpdateProcessResponse = {
  process:
    EmployeeProcessView;

  bpmnXml:
    string;
};


// ======================================================
// OWNER SESSION VIEW
// ======================================================

export type OwnerSessionView = {
  sessionId:
    string;

  process:
    ProcessModel;

  analysis:
    SessionAnalysis;

  messages:
    ChatMessage[];

  createdAt:
    string;

  updatedAt:
    string;

  bpmnXml:
    string;
};


// ======================================================
// REFERENCE PROCESSES
// ======================================================
//
// Owner-managed reference / target processes.
// ======================================================

export type ReferenceProcessMetadata = {
  id:
    string;

  /**
   * Owner-defined display name.
   */
  name:
    string;

  aliases:
    string[];

  description?:
    string;

  active:
    boolean;

  currentVersion:
    number;

  createdAt:
    string;

  updatedAt:
    string;
};

export type ReferenceProcessVersion = {
  referenceProcessId:
    string;

  version:
    number;

  modelHash:
    string;

  process:
    ProcessModel;

  bpmnXml:
    string;

  createdAt:
    string;
};

export type ReferenceProcessRecord = {
  metadata:
    ReferenceProcessMetadata;

  currentVersion:
    ReferenceProcessVersion;
};

export type ReferenceProcessSummary = {
  id:
    string;

  name:
    string;

  aliases:
    string[];

  description?:
    string;

  active:
    boolean;

  currentVersion:
    number;

  updatedAt:
    string;

  /**
   * Optional aggregation from the Owner API.
   */
  assignedSessionCount?:
    number;

  /**
   * Optional aggregation from the Owner API.
   */
  openDeviationCount?:
    number;
};


// ======================================================
// REFERENCE PROCESS OVERVIEW
// ======================================================

export type ReferenceProcessOverviewSession = {
  sessionId:
    string;

  processName:
    string;

  referenceProcessVersion?:
    number;

  identificationStatus:
    ProcessIdentificationStatus;

  identificationConfidence:
    number;

  deviationCount:
    number;

  openDeviationCount:
    number;

  updatedAt:
    string;
};

export type ReferenceProcessOverviewData = {
  referenceProcessId:
    string;

  name:
    string;

  currentVersion:
    number;

  active:
    boolean;

  sessionCount:
    number;

  openDeviationCount:
    number;

  sessions:
    ReferenceProcessOverviewSession[];
};


// ======================================================
// OWNER SESSION SUMMARY
// ======================================================
//
// Used by:
//
// GET /api/owner/sessions
// ======================================================

export type OwnerSessionSummary = {
  sessionId:
    string;

  processName:
    string;

  updatedAt:
    string;

  identificationStatus:
    ProcessIdentificationStatus;

  selectedReferenceProcessId?:
    string;

  selectedReferenceProcessVersion?:
    number;

  identificationConfidence:
    number;

  deviationCount:
    number;

  openDeviationCount:
    number;
};


// ======================================================
// LEGACY RESPONSE TYPES
// ======================================================
//
// Keep these temporarily only if older frontend code
// still imports them.
//
// New EmployeeView should use:
//
// EmployeePostMessageResponse
// EmployeeUpdateProcessResponse
// ======================================================

export type PostMessageResponse = {
  assistantMessage:
    string;

  process:
    ProcessModel;

  processChanges:
    ProcessChanges;

  bpmnXml:
    string;
};

export type UpdateProcessResponse = {
  process:
    ProcessModel;

  bpmnXml:
    string;
};