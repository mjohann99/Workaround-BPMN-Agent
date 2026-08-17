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

  /**
   * internal:
   * Own organization / internal organizational participant.
   *
   * external:
   * Customer, supplier, authority, partner, etc.
   *
   * system:
   * Only when a system is explicitly modeled as
   * an independent BPMN participant.
   */
  type: ParticipantType;

  /**
   * white_box:
   * Internal process behavior is modeled.
   *
   * black_box:
   * Only the participant itself and its interactions
   * with other participants are modeled.
   */
  processVisibility: ProcessVisibility;
};

export type ParticipantDraft = {
  tempRef: string;

  name: string;

  type: ParticipantType;

  processVisibility: ProcessVisibility;
};

export type ParticipantUpdate = {
  id: string;

  name?: string;

  type?: ParticipantType;

  processVisibility?: ProcessVisibility;
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

  /**
   * Participant / pool this lane belongs to.
   */
  participantId: string;

  name: string;

  type: LaneType;
};

export type LaneDraft = {
  tempRef: string;

  /**
   * Existing participant ID or temporary participant ref.
   */
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
// WORKAROUNDS
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

  relatedActivityIds: string[];

  actualPractice: string;

  expectedPractice?: string;

  obstacleOrMisfit?: string;

  goalOrMotivation?: string;

  category?: WorkaroundCategory;

  frequency?: string;

  logVisibility: WorkaroundLogVisibility;

  status: WorkaroundStatus;

  evidenceMessageIds: string[];
};

export type WorkaroundCandidateDraft = {
  tempRef: string;

  relatedActivityRefs: string[];

  actualPractice: string;

  obstacleOrMisfit?: string;

  category?: WorkaroundCategory;
};

export type WorkaroundCandidateUpdate = {
  id: string;

  relatedActivityIds?: string[];

  actualPractice?: string;

  expectedPractice?: string;

  obstacleOrMisfit?: string;

  goalOrMotivation?: string;

  category?: WorkaroundCategory;

  frequency?: string;

  logVisibility?: WorkaroundLogVisibility;

  status?: WorkaroundStatus;

  evidenceMessageIds?: string[];
};


// ======================================================
// PROCESS ELEMENTS
// ======================================================

type ProcessElementBase = {
  id: string;

  name: string;

  /**
   * Pool / participant in which this BPMN node exists.
   *
   * Optional because this information may still be
   * unknown during process elicitation.
   */
  participantId?: string;

  /**
   * Lane responsible for the activity / event / gateway.
   *
   * Optional until responsibility has been elicited.
   */
  laneId?: string;
};

export type ProcessElement =
  | (
      ProcessElementBase & {
        type: "start";
      }
    )
  | (
      ProcessElementBase & {
        type: "task";

        /**
         * Human role or actor performing the activity.
         *
         * Example:
         * "Order clerk"
         */
        performer?: string;

        /**
         * Tool / IT system used for the activity.
         *
         * Example:
         * SAP, Excel
         */
        system?: string;

        /**
         * Distinguishes human work from autonomous
         * system execution.
         */
        executionType?: ExecutionType;

        employeeConfirmed?: boolean;

        // ----------------------------------------------
        // Legacy task-level workaround fields
        // ----------------------------------------------
        //
        // process.workarounds remains the preferred
        // workaround source of truth.
        // ----------------------------------------------

        workaroundCandidate?: boolean;

        workaroundConfirmed?: boolean;

        workaroundReason?: string;

        workaroundCategory?: WorkaroundCategory;
      }
    )
  | (
      ProcessElementBase & {
        type: "exclusiveGateway";
      }
    )
  | (
      ProcessElementBase & {
        type: "end";
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
    | "end";

  name: string;

  /**
   * Existing participant ID or temporary participant ref.
   */
  participantRef?: string;

  /**
   * Existing lane ID or temporary lane ref.
   */
  laneRef?: string;

  performer?: string;

  system?: string;

  executionType?: ExecutionType;

  employeeConfirmed?: boolean;

  workaroundCandidate?: boolean;

  workaroundConfirmed?: boolean;

  workaroundReason?: string;

  workaroundCategory?: WorkaroundCategory;
};


// ======================================================
// PROCESS ELEMENT UPDATE
// ======================================================

export type ProcessElementUpdate = {
  id: string;

  name?: string;

  /**
   * Stable participant/lane IDs.
   */
  participantId?: string;

  laneId?: string;

  /**
   * Used when participant/lane was created in
   * the same ProcessChanges response.
   */
  participantRef?: string;

  laneRef?: string;

  performer?: string;

  system?: string;

  executionType?: ExecutionType;

  employeeConfirmed?: boolean;

  workaroundCandidate?: boolean;

  workaroundConfirmed?: boolean;

  workaroundReason?: string;

  workaroundCategory?: WorkaroundCategory;
};


// ======================================================
// SEQUENCE FLOWS
// ======================================================
//
// SequenceFlow is used inside one BPMN participant.
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
//
// MessageFlow is used between different BPMN participants.
// ======================================================

export type MessageFlow = {
  id: string;

  fromParticipantId: string;

  toParticipantId: string;

  /**
   * Optional concrete BPMN source/target nodes.
   *
   * Example:
   * task_send_order -> participant_supplier
   */
  sourceElementId?: string;

  targetElementId?: string;

  name?: string;
};

export type MessageFlowDraft = {
  id?: string;

  tempRef?: string;

  /**
   * Existing participant IDs or temporary refs.
   */
  fromParticipantRef: string;

  toParticipantRef: string;

  /**
   * Existing element IDs or temporary refs.
   */
  sourceElementRef?: string;

  targetElementRef?: string;

  name?: string;
};


// ======================================================
// PROCESS MODEL
// ======================================================

export type ProcessModel = {
  id: string;

  name: string;

  status: ProcessStatus;

  /**
   * BPMN pools / participants.
   */
  participants: Participant[];

  /**
   * Roles, departments, teams or system lanes
   * inside participants.
   */
  lanes: Lane[];

  elements: ProcessElement[];

  /**
   * Control flow inside a participant.
   */
  flows: SequenceFlow[];

  /**
   * Communication between participants.
   */
  messageFlows: MessageFlow[];

  workarounds: WorkaroundCandidate[];

  updatedAt: string;
};


// ======================================================
// PROCESS CHANGES
// ======================================================

export type ProcessChanges = {
  // ----------------------------------------------------
  // Participants / Pools
  // ----------------------------------------------------

  addParticipants: ParticipantDraft[];

  updateParticipants: ParticipantUpdate[];

  removeParticipantIds: string[];

  // ----------------------------------------------------
  // Lanes
  // ----------------------------------------------------

  addLanes: LaneDraft[];

  updateLanes: LaneUpdate[];

  removeLaneIds: string[];

  // ----------------------------------------------------
  // Process Elements
  // ----------------------------------------------------

  addElements: ProcessElementDraft[];

  updateElements: ProcessElementUpdate[];

  removeElementIds: string[];

  // ----------------------------------------------------
  // Sequence Flows
  // ----------------------------------------------------

  addFlows: SequenceFlowDraft[];

  removeFlowIds: string[];

  // ----------------------------------------------------
  // Message Flows
  // ----------------------------------------------------

  addMessageFlows: MessageFlowDraft[];

  removeMessageFlowIds: string[];

  // ----------------------------------------------------
  // Workarounds
  // ----------------------------------------------------

  addWorkarounds: WorkaroundCandidateDraft[];

  updateWorkarounds: WorkaroundCandidateUpdate[];
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
  | "clarification"
  | "element_confirmation"
  | "sequence_confirmation"

  // Organizational elicitation
  | "participant_boundary"
  | "actor_role"
  | "lane_assignment"
  | "handoff_target"

  // Workaround elicitation
  | "workaround_expected_practice"
  | "workaround_obstacle"
  | "workaround_goal"
  | "workaround_frequency"
  | "workaround_log_visibility"
  | "workaround_confirmation";

export type PendingQuestion = {
  id: string;

  kind: PendingQuestionKind;

  targetIds: string[];

  field?: string;

  question: string;
};


// ======================================================
// INTERVIEW SESSION
// ======================================================

export type InterviewSession = {
  id: string;

  messages: ChatMessage[];

  process: ProcessModel;

  elicitationPhase: ElicitationPhase;

  pendingQuestion?: PendingQuestion;

  lastFocusedElementIds: string[];

  unresolvedProcessItems: string[];

  createdAt: string;

  updatedAt: string;

  /**
   * Added to the frontend API representation.
   *
   * The backend session itself does not necessarily
   * persist this field.
   */
  bpmnXml: string;
};


// ======================================================
// POST MESSAGE RESPONSE
// ======================================================

export type PostMessageResponse = {
  assistantMessage: string;

  process: ProcessModel;

  processChanges: ProcessChanges;

  bpmnXml: string;
};


// ======================================================
// MANUAL PROCESS UPDATE RESPONSE
// ======================================================
//
// Used by:
//
// PUT /api/sessions/:id/process
// ======================================================

export type UpdateProcessResponse = {
  process: ProcessModel;

  bpmnXml: string;
};