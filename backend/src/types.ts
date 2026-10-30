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
// These types remain temporarily because the current
// LLM/process implementation still uses them.
//
// Long term:
//
// ProcessModel.workarounds and the workaround fields on
// tasks should be removed.
//
// The new source of truth will be:
//
// SessionAnalysis.deviations
// -> investigations
// -> ownerReviews
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
        // LEGACY INTERNAL WORKAROUND FIELDS
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

        attachedToRef: string;

        cancelActivity: boolean;

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
    BpmnEventDefinitionType | null;

  attachedToRef?:
    string;

  cancelActivity?:
    boolean;

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
    string;

  cancelActivity?:
    boolean;

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

  condition?: string;
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
// This remains the source of truth for the ACTUAL,
// employee-described AS-IS process.
//
// Reference processes are stored separately.
// Conformance analysis is stored in SessionAnalysis.
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
   * Temporary legacy field.
   *
   * New deviation detection should NOT depend on this.
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
  // Flow Nodes
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
// PROCESS IDENTIFICATION
// ======================================================
//
// This entire section is INTERNAL.
//
// The employee must not receive:
//
// - candidate processes
// - scores
// - selected reference process
// - revisions
// - conformance information
//
// The Process Owner may see all of it.
// ======================================================

export type ProcessIdentificationStatus =
  | "unresolved"
  | "probable"
  | "selected";


// ======================================================
// PROCESS CANDIDATE SCORE
// ======================================================
//
// These are retrieval / identification scores.
//
// They are NOT conformance scores and should not be
// presented as such.
// ======================================================

export type ProcessCandidateScore = {
  /**
   * Similarity between the employee-declared process
   * name and owner-defined name / aliases.
   */
  nameSimilarity:
    number;

  /**
   * Similarity between elicited and reference
   * activity labels.
   */
  activitySimilarity:
    number;

  /**
   * Similarity of systems such as SAP / Excel.
   */
  systemSimilarity:
    number;

  /**
   * Similarity of lanes / organizational roles.
   */
  laneSimilarity:
    number;

  /**
   * Simple structural similarity.
   *
   * Example:
   * directly-follows relationships.
   */
  structureSimilarity:
    number;

  /**
   * Combined heuristic score used for candidate
   * ranking.
   *
   * This is NOT BPMN conformance fitness.
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

  /**
   * The exact reference version against which this
   * candidate was evaluated.
   */
  referenceProcessVersion:
    number;

  name:
    string;

  score:
    ProcessCandidateScore;

  /**
   * Optional diagnostics for the owner.
   */
  matchedActualActivityIds?:
    string[];

  matchedReferenceActivityIds?:
    string[];
};


// ======================================================
// PROCESS IDENTIFICATION HISTORY
// ======================================================
//
// We preserve the internal history so that a later
// evaluation can explain:
//
// - when a process was first selected,
// - whether that selection changed,
// - how much evidence was available.
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
// CURRENT PROCESS IDENTIFICATION STATE
// ======================================================

export type ProcessIdentification = {
  status:
    ProcessIdentificationStatus;

  /**
   * Employee answer to:
   *
  * "Which process would you like to describe?"
   *
   * This is only initial evidence.
   * It does not automatically determine the
   * reference process.
   */
  declaredProcessName?:
    string;

  /**
   * Current ranked candidate list.
   */
  candidates:
    ProcessCandidate[];

  /**
   * Current internally selected reference process.
   */
  selectedReferenceProcessId?:
    string;

  /**
   * Exact immutable reference version used by
   * conformance checking.
   */
  selectedReferenceProcessVersion?:
    number;

  /**
   * Allows us to verify that the reference version
   * has not silently changed.
   */
  selectedReferenceModelHash?:
    string;

  selectedBy?:
    | "automatic"
    | "owner";

  /**
   * true:
   * owner explicitly selected the reference process.
   *
   * Automatic identification must not override it.
   */
  lockedByOwner:
    boolean;

  /**
   * true:
   * automatic identification is considered sufficiently
   * stable for conformance investigation.
   *
   * It can still be revised under the configured early
   * revision policy unless lockedByOwner is true.
   */
  stable:
    boolean;

  /**
   * Current confidence in the selected candidate.
   *
   * 0..1
   */
  confidence:
    number;

  /**
   * Difference between the first and second ranked
   * candidates.
   */
  marginToSecondCandidate:
    number;

  /**
   * Number of actual activities known when the current
   * reference process was selected.
   */
  selectedAtActivityCount?:
    number;

  /**
   * Number of automatic reference-process switches.
   */
  revisionCount:
    number;

  lastEvaluatedAt?:
    string;

  /**
   * Audit trail of automatic / manual decisions.
   */
  history:
    ProcessIdentificationDecision[];
};


// ======================================================
// ACTIVITY MAPPING
// ======================================================
//
// Conformance checking requires actual employee tasks to
// be mapped to reference-model activities.
//
// An uncertain mapping must not automatically become a
// deviation.
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

  /**
   * Exact employee activities considered by this run.
   */
  traceActivityIds:
    string[];

  method:
    ConformanceMethod;

  /**
   * false while the employee is still describing
   * the process.
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
   * Prefix Token Replay may not provide full alignment
   * moves.
   *
   * Therefore this may be empty for prefix_tbr.
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
// A deviation is a technical conformance finding.
//
// Only the Process Owner decides later whether it is:
//
// - a confirmed workaround
// - an accepted variant
// - an outdated reference model
// - not a workaround
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

  /**
   * Reference process against which this deviation
   * was detected.
   */
  referenceProcessId:
    string;

  referenceProcessVersion:
    number;

  /**
   * Every deviation belongs to the concrete analysis
   * run that generated it.
   *
   * Perspective checks may share the ID of the
   * surrounding conformance run.
   */
  sourceConformanceRunId:
    string;

  detectionMethod:
    DeviationDetectionMethod;

  /**
   * true:
   * preliminary finding during an incomplete interview.
   *
   * false:
   * confirmed as a technical deviation by a completed
   * conformance analysis.
   *
   * This still does NOT mean "confirmed workaround".
   */
  provisional:
    boolean;

  dimension:
    DeviationDimension;

  moveType?:
    AlignmentMoveType;

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
// INVESTIGATION
// ======================================================
//
// Employee-facing questioning collects context about a
// technical deviation without telling the employee that
// a deviation / workaround has been detected.
// ======================================================

export type InvestigationFacts = {
  /**
   * Why is the actual practice performed?
   */
  reason?: string;

  /**
   * Since when has it been performed this way?
   */
  sinceWhen?: string;

  /**
   * How often does it occur?
   */
  frequency?: string;

  /**
   * How should the activity normally be performed?
   */
  expectedPractice?: string;

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
// WORKAROUND CANDIDATE (PRACTICE)
// ======================================================
//
// Activities and technical deviations are observations.
// A practice candidate is a SEPARATE record for one coherent
// alternative way of working. It references any number of
// activities and deviations and carries the shared answers
// (reason, onset, frequency) with the conversation evidence
// behind them. A model difference alone never sets a purpose.
// ======================================================

export type PracticeField =
  | "reason"
  | "sinceWhen"
  | "frequency";

export type PracticeEvidence = {
  id: string;

  /** Chat message that contains the evidence. */
  messageId?: string;

  /** What the employee said. */
  excerpt: string;

  recordedAt: string;
};

export type PracticeFact = {
  /** "unknown" is an answer ("I do not know"), not a gap. */
  status:
    | "answered"
    | "unknown";

  value?: string;

  /** Whole practice, or only the listed activities. */
  scope:
    | "practice"
    | "activities";

  /** Activities this answer covers. */
  activityIds: string[];

  evidenceId: string;

  recordedAt: string;
};

export type PracticeCandidate = {
  id: string;

  /** Technical observations linked to this practice. */
  deviationIds: string[];

  /** BPMN activities that belong to the practice. */
  activityIds: string[];

  /** Answers that hold for the whole practice. */
  facts: Partial<Record<PracticeField, PracticeFact>>;

  /** Answers limited to some activities (explanations, exceptions). */
  activityFacts: Array<PracticeFact & { field: PracticeField }>;

  evidence: PracticeEvidence[];

  /** Why activities were grouped (conversation evidence). */
  groupingBasis: PracticeEvidence[];

  /** How often each field has been asked, so nothing is asked forever. */
  asked: Partial<Record<PracticeField, number>>;

  createdAt: string;

  updatedAt: string;
};

/** Group membership decisions already taken or asked about. */
export type PracticeGrouping = {
  /** Sorted activity-ID sets the employee was asked to group. */
  askedSets: string[];

  /** Activity pairs the employee called independent ("a|b"). */
  independentPairs: string[];

  /** Merged-away practice ID -> surviving practice ID, so stale references still resolve. */
  redirects: Record<string, string>;
};

/** The model's statement about how activities relate. */
export type PracticeHint = {
  activityRefs: string[];

  relation:
    | "same_practice"
    | "independent";

  /** Existing practice the activities extend. */
  extendsPracticeId?: string | null;

  /** Shared purpose, obstacle or cause that justifies the grouping. */
  basis?: string | null;
};

/** An answer the employee gave to a practice question. */
export type PracticeAnswerHint = {
  practiceId?: string | null;

  field: PracticeField;

  scope:
    | "practice"
    | "activities";

  activityRefs: string[];

  unknown?: boolean | null;

  value?: string | null;
};


// ======================================================
// COMPLETE INTERNAL SESSION ANALYSIS
// ======================================================
//
// Employee APIs must NEVER return this object.
//
// Owner APIs may return it.
// ======================================================

export type SessionAnalysis = {
  processIdentification:
    ProcessIdentification;

  /**
   * Mapping of actual activities to the currently
   * selected reference process.
   */
  activityMappings:
    ActivityMapping[];

  /**
   * History of conformance checks during the interview.
   */
  conformanceRuns:
    ConformanceRun[];

  deviations:
    DeviationCandidate[];

  investigations:
    DeviationInvestigation[];

  /**
   * Workaround candidates: coherent practices that group
   * activities and deviations and own the shared answers.
   */
  practices:
    PracticeCandidate[];

  practiceGrouping:
    PracticeGrouping;

  ownerReviews:
    OwnerReview[];
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
  | "practice_grouping"
  | "expected_practice";

export type PendingQuestion = {
  id: string;

  kind:
    PendingQuestionKind;

  targetIds:
    string[];

  field?: string;

  question: string;

  /**
   * Only present while answering a neutral investigation
   * question.
   */
  investigationId?: string;

  investigationField?:
    InvestigationField;

  /** Practice a follow-up question is about. */
  practiceId?: string;

  practiceField?:
    PracticeField | "grouping" | "combined";
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
// INTERVIEW SESSION
// ======================================================

export type ResponsibilityState = {
  /** Lane of the role/department the interviewee identified as their own. */
  intervieweeLaneId?: string;

  /** The interviewee said no finer distinction exists than the lane. */
  distinctionDeclined?: boolean;

  /** Activities already asked about, so none is asked twice. */
  askedActivityIds: string[];
};

export type ResponsibilityHint = {
  /** Role/department the employee states they belong to, if any. */
  intervieweeRole?: string | null;

  /** Who performs the new activities: "we/us/I", the same as before, or a named role. */
  actor?: "interviewee" | "previous" | "named" | null;

  /** The employee said there is no finer role distinction. */
  noFurtherDetail?: boolean | null;
};

export type InterviewSession = {
  id: string;

  messages:
    ChatMessage[];

  /**
   * Actual employee-described AS-IS process.
   */
  process:
    ProcessModel;

  /**
   * Completely internal analysis state.
   */
  analysis:
    SessionAnalysis;

  elicitationPhase:
    ElicitationPhase;

  pendingQuestion?:
    PendingQuestion;

  responsibility?:
    ResponsibilityState;

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
// VALIDATION REQUEST
// ======================================================

export type ValidationRequest = {
  required: boolean;

  elementIds:
    string[];

  question:
    string;
};


// ======================================================
// NEXT QUESTION
// ======================================================

export type NextQuestion = {
  required: boolean;

  kind:
    PendingQuestionKind;

  targetRefs:
    string[];

  question:
    string;
};


// ======================================================
// PROCESS CONTEXT PATCH
// ======================================================

export type ProcessContextPatch = {
  name?:
    string | null;

  goal?:
    string | null;

  trigger?:
    string | null;

  outcome?:
    string | null;
};


// ======================================================
// UNCERTAINTIES
// ======================================================

export type ProcessUncertainty = {
  type:
    | "sequence"
    | "condition"
    | "meaning"
    | "workaround"
    | "reference"

    // Organizational uncertainty
    | "participant"
    | "lane"
    | "handoff";

  targetRefs:
    string[];

  description:
    string;
};


// ======================================================
// COMPLETE LLM RESPONSE
// ======================================================

export type LlmProcessResponse = {
  language:
    | "de"
    | "en";

  intent:
    string;

  assistantMessage:
    string;

  contextPatch:
    ProcessContextPatch;

  changes:
    ProcessChanges;

  uncertainties:
    ProcessUncertainty[];

  nextQuestion:
    NextQuestion;

  validationRequest:
    ValidationRequest;

  responsibility?:
    ResponsibilityHint;

  practiceHints?:
    PracticeHint[];

  practiceAnswers?:
    PracticeAnswerHint[];
};