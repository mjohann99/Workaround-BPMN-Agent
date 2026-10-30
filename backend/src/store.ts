import {
  randomUUID
} from "node:crypto";

import {
  createInitialProcess
} from "./process.js";

import {
  isPracticeComplete
} from "./analysis/practices.js";

import {
  type ActivityMapping,
  type ChatMessage,
  type ConformanceRun,
  type DeviationCandidate,
  type DeviationInvestigation,
  type ElicitationPhase,
  type InterviewSession,
  type OwnerReview,
  type PendingQuestion,
  type PracticeCandidate,
  type PracticeGrouping,
  type ProcessIdentification,
  type ProcessModel,
  type ResponsibilityState,
  type SessionAnalysis
} from "./types.js";

// ======================================================
// IN-MEMORY SESSION STORE
// ======================================================
//
// Research prototype:
//
// Sessions are currently stored only in memory.
//
// Restarting the backend removes all interview sessions.
//
// Reference processes will be stored separately in:
//
// backend/data/reference-processes/
//
// This store is only responsible for employee interview
// sessions and their internal analysis state.
// ======================================================

const sessions =
  new Map<
    string,
    InterviewSession
  >();

// ======================================================
// CLONING
// ======================================================
//
// Never expose the mutable object stored inside the Map.
//
// Routes and services always receive copies.
// ======================================================

function cloneValue<T>(
  value: T
): T {
  return structuredClone(
    value
  );
}

// ======================================================
// SESSION LOOKUP
// ======================================================

function requireSession(
  sessionId: string
): InterviewSession {
  const session =
    sessions.get(
      sessionId
    );

  if (!session) {
    throw new Error(
      `Session not found: ${sessionId}`
    );
  }

  return session;
}

// ======================================================
// TIMESTAMP
// ======================================================

function nowIso(): string {
  return new Date()
    .toISOString();
}

function touchSession(
  session: InterviewSession
): void {
  session.updatedAt =
    nowIso();
}

// ======================================================
// INITIAL ANALYSIS
// ======================================================
//
// Important:
//
// Everything stored in SessionAnalysis is INTERNAL.
//
// Employee API endpoints must never return this object.
//
// Owner API endpoints may return it.
// ======================================================

export function createInitialSessionAnalysis():
  SessionAnalysis {
  return {
    // ==================================================
    // REFERENCE PROCESS IDENTIFICATION
    // ==================================================

    processIdentification: {
      status:
        "unresolved",

      /**
       * The employee has not yet answered:
       *
      * "Which process would you like to describe?"
       */
      declaredProcessName:
        undefined,

      candidates:
        [],

      selectedReferenceProcessId:
        undefined,

      selectedReferenceProcessVersion:
        undefined,

      selectedReferenceModelHash:
        undefined,

      selectedBy:
        undefined,

      /**
       * Automatic process identification may still
       * change its selection.
       */
      lockedByOwner:
        false,

      /**
       * Not enough evidence yet for conformance-based
       * investigation.
       */
      stable:
        false,

      confidence:
        0,

      marginToSecondCandidate:
        0,

      selectedAtActivityCount:
        undefined,

      revisionCount:
        0,

      lastEvaluatedAt:
        undefined,

      history:
        []
    },

    // ==================================================
    // ACTIVITY MAPPING
    // ==================================================
    //
    // Actual employee activities
    // ->
    // reference-process activities
    // ==================================================

    activityMappings:
      [],

    // ==================================================
    // CONFORMANCE HISTORY
    // ==================================================
    //
    // Prefix replay and alignment runs will be stored
    // here later.
    // ==================================================

    conformanceRuns:
      [],

    // ==================================================
    // TECHNICAL DEVIATIONS
    // ==================================================

    deviations:
      [],

    // ==================================================
    // NEUTRAL EMPLOYEE INVESTIGATIONS
    // ==================================================

    investigations:
      [],

    // ==================================================
    // WORKAROUND CANDIDATES (GROUPED PRACTICES)
    // ==================================================

    practices:
      [],

    practiceGrouping: {
      askedSets: [],
      independentPairs: [],
      redirects: {}
    },

    // ==================================================
    // PROCESS OWNER DECISIONS
    // ==================================================

    ownerReviews:
      []
  };
}

// ======================================================
// INITIAL ASSISTANT MESSAGE
// ======================================================
//
// The employee is first asked which process they want to
// describe.
//
// The answer is only initial evidence for hidden
// reference-process identification.
// ======================================================

function createInitialAssistantMessage(
  timestamp: string
): ChatMessage {
  return {
    id:
      randomUUID(),

    role:
      "assistant",

    content:
      "Which process would you like to describe?",

    timestamp
  };
}

// ======================================================
// INITIAL PENDING QUESTION
// ======================================================

function createInitialPendingQuestion():
  PendingQuestion {
  return {
    id:
      randomUUID(),

    kind:
      "process_scope",

    targetIds:
      [],

    field:
      "declaredProcessName",

    question:
      "Which process would you like to describe?"
  };
}

// ======================================================
// CREATE SESSION
// ======================================================

export function createSession(
  processName =
    "Interviewed AS-IS Process"
): InterviewSession {
  const timestamp =
    nowIso();

  const process =
    createInitialProcess(
      processName
    );

  const session:
    InterviewSession = {
    id:
      randomUUID(),

    messages: [
      createInitialAssistantMessage(
        timestamp
      )
    ],

    /**
     * Actual process described by the employee.
     */
    process,

    /**
     * Hidden internal analysis.
     */
    analysis:
      createInitialSessionAnalysis(),

    elicitationPhase:
      "scope",

    pendingQuestion:
      createInitialPendingQuestion(),

    /**
     * No process element is currently focused because
     * we first identify the intended business process.
     */
    lastFocusedElementIds:
      [],

    /**
     * Trigger elicitation comes after initial process
     * identification.
     */
    unresolvedProcessItems: [
      "reference_process",
      "process_trigger"
    ],

    createdAt:
      timestamp,

    updatedAt:
      timestamp
  };

  sessions.set(
    session.id,
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// GET SESSION
// ======================================================

export function getSession(
  sessionId: string
): InterviewSession | undefined {
  const session =
    sessions.get(
      sessionId
    );

  return session
    ? cloneValue(
      session
    )
    : undefined;
}

// ======================================================
// LIST SESSIONS
// ======================================================
//
// Useful for Process Owner dashboards later.
// ======================================================

export function listSessions():
  InterviewSession[] {
  return Array.from(
    sessions.values()
  ).map(
    (session) =>
      cloneValue(
        session
      )
  );
}

// ======================================================
// DELETE SESSION
// ======================================================

export function deleteSession(
  sessionId: string
): boolean {
  return sessions.delete(
    sessionId
  );
}

// ======================================================
// ADD CHAT MESSAGE
// ======================================================

export function addMessage(
  sessionId: string,
  role: ChatMessage["role"],
  content: string
): ChatMessage {
  const session =
    requireSession(
      sessionId
    );

  const normalizedContent =
    content.trim();

  if (
    !normalizedContent
  ) {
    throw new Error(
      "Chat message must not be empty"
    );
  }

  const message:
    ChatMessage = {
    id:
      randomUUID(),

    role,

    content:
      normalizedContent,

    timestamp:
      nowIso()
  };

  session.messages.push(
    message
  );

  touchSession(
    session
  );

  return cloneValue(
    message
  );
}

// ======================================================
// UPDATE PROCESS MODEL
// ======================================================
//
// The ProcessModel contains only the actual AS-IS
// process.
//
// Reference-process identification and conformance
// results belong to session.analysis.
// ======================================================

export function updateSessionProcess(
  sessionId: string,
  process: ProcessModel
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  session.process =
    cloneValue(
      process
    );

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// SESSION DIALOGUE STATE
// ======================================================

export type SessionStatePatch = {
  elicitationPhase?:
  ElicitationPhase;

  /**
   * Explicit undefined removes the currently pending
   * question.
   */
  pendingQuestion?:
  PendingQuestion |
  undefined;

  lastFocusedElementIds?:
  string[];

  unresolvedProcessItems?:
  string[];

  /** Merged into the stored responsibility state. */
  responsibility?:
  Partial<ResponsibilityState>;
};

export function updateSessionState(
  sessionId: string,
  patch: SessionStatePatch
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  // ----------------------------------------------------
  // ELICITATION PHASE
  // ----------------------------------------------------

  if (
    patch.elicitationPhase !==
    undefined
  ) {
    session.elicitationPhase =
      patch.elicitationPhase;
  }

  // ----------------------------------------------------
  // PENDING QUESTION
  // ----------------------------------------------------
  //
  // Important distinction:
  //
  // property missing
  // -> retain current pending question
  //
  // pendingQuestion: undefined
  // -> explicitly remove question
  // ----------------------------------------------------

  if (
    Object.prototype
      .hasOwnProperty.call(
        patch,
        "pendingQuestion"
      )
  ) {
    if (
      patch.pendingQuestion
    ) {
      session.pendingQuestion =
        cloneValue(
          patch.pendingQuestion
        );
    } else {
      delete session
        .pendingQuestion;
    }
  }

  // ----------------------------------------------------
  // FOCUSED ELEMENTS
  // ----------------------------------------------------

  if (
    patch.lastFocusedElementIds !==
    undefined
  ) {
    session
      .lastFocusedElementIds = [
        ...patch
          .lastFocusedElementIds
      ];
  }

  // ----------------------------------------------------
  // UNRESOLVED PROCESS ITEMS
  // ----------------------------------------------------

  if (
    patch.unresolvedProcessItems !==
    undefined
  ) {
    session
      .unresolvedProcessItems = [
        ...patch
          .unresolvedProcessItems
      ];
  }

  // ----------------------------------------------------
  // RESPONSIBILITY STATE
  // ----------------------------------------------------

  if (
    patch.responsibility !==
    undefined
  ) {
    const current =
      session.responsibility ?? {
        askedActivityIds: []
      };

    session.responsibility = {
      ...current,
      ...patch.responsibility,
      askedActivityIds: [
        ...new Set([
          ...current.askedActivityIds,
          ...(patch.responsibility
            .askedActivityIds ?? [])
        ])
      ]
    };
  }

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// REPLACE COMPLETE ANALYSIS
// ======================================================
//
// Prefer specialized update functions where possible.
//
// Useful when analysis must be reset atomically after a
// reference-process change.
// ======================================================

export function replaceSessionAnalysis(
  sessionId: string,
  analysis: SessionAnalysis
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  session.analysis =
    cloneValue(
      analysis
    );

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// PATCH ANALYSIS
// ======================================================
//
// This is intentionally a shallow patch.
//
// Example:
//
// updateSessionAnalysis(id, {
//   activityMappings,
//   deviations
// });
//
// All omitted analysis fields remain unchanged.
// ======================================================

export function updateSessionAnalysis(
  sessionId: string,
  patch:
    Partial<SessionAnalysis>
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  session.analysis = {
    ...session.analysis,
    ...cloneValue(
      patch
    )
  };

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// PROCESS IDENTIFICATION
// ======================================================

export function updateProcessIdentification(
  sessionId: string,
  identification:
    ProcessIdentification
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  session.analysis
    .processIdentification =
    cloneValue(
      identification
    );

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// DECLARED PROCESS NAME
// ======================================================
//
// Convenience function used after the employee answers:
//
// "Which process would you like to describe?"
//
// It does NOT select a reference process.
//
// It merely stores the employee's wording as evidence.
// ======================================================

export function setDeclaredProcessName(
  sessionId: string,
  declaredProcessName: string
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  const normalizedName =
    declaredProcessName.trim();

  if (
    !normalizedName
  ) {
    throw new Error(
      "Declared process name must not be empty"
    );
  }

  session.analysis
    .processIdentification = {
    ...session.analysis
      .processIdentification,

    declaredProcessName:
      normalizedName,

    lastEvaluatedAt:
      nowIso()
  };

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// ACTIVITY MAPPINGS
// ======================================================
//
// Mapping:
//
// employee activity
// ->
// reference-process activity
//
// These mappings are internal and must never be exposed
// through the Employee API.
// ======================================================

export function replaceActivityMappings(
  sessionId: string,
  mappings:
    ActivityMapping[]
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  session.analysis
    .activityMappings =
    cloneValue(
      mappings
    );

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// CONFORMANCE RUNS
// ======================================================

export function replaceConformanceRuns(
  sessionId: string,
  runs:
    ConformanceRun[]
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  session.analysis
    .conformanceRuns =
    cloneValue(
      runs
    );

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

export function addConformanceRun(
  sessionId: string,
  run: ConformanceRun
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  /**
   * Defensive duplicate protection.
   */
  const existingIndex =
    session.analysis
      .conformanceRuns
      .findIndex(
        (candidate) =>
          candidate.id ===
          run.id
      );

  if (
    existingIndex === -1
  ) {
    session.analysis
      .conformanceRuns
      .push(
        cloneValue(
          run
        )
      );
  } else {
    session.analysis
      .conformanceRuns[
      existingIndex
    ] =
      cloneValue(
        run
      );
  }

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// DEVIATIONS
// ======================================================

export function replaceDeviations(
  sessionId: string,
  deviations:
    DeviationCandidate[]
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  session.analysis.deviations =
    cloneValue(
      deviations
    );

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

export function upsertDeviation(
  sessionId: string,
  deviation:
    DeviationCandidate
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  const index =
    session.analysis
      .deviations
      .findIndex(
        (candidate) =>
          candidate.id ===
          deviation.id
      );

  if (
    index === -1
  ) {
    session.analysis
      .deviations
      .push(
        cloneValue(
          deviation
        )
      );
  } else {
    session.analysis
      .deviations[
      index
    ] =
      cloneValue(
        deviation
      );
  }

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}
// ======================================================
// RECONCILE CURRENT DEVIATIONS
// ======================================================
//
// Conformance checking runs repeatedly while the
// employee is describing the process.
//
// Therefore a technical deviation may be detected
// multiple times:
//
// Prefix run 1
// -> deviation A
//
// Prefix run 2
// -> deviation A again
//
// Final alignment
// -> deviation A again
//
// We must NOT create a new deviation ID every time.
//
// Otherwise:
//
// - investigations would lose their target
// - collected facts would be lost
// - owner reviews could point to stale deviations
//
// This function therefore reconciles newly detected
// deviations with the currently stored deviations for
// the same reference-process version.
// ======================================================

function deviationSemanticKey(
  deviation:
    DeviationCandidate
): string {
  const actualActivityIds =
    [
      ...deviation
        .actualActivityIds
    ]
      .sort()
      .join(",");

  const expectedReferenceActivityIds =
    [
      ...deviation
        .expectedReferenceActivityIds
    ]
      .sort()
      .join(",");

  return [
    deviation
      .referenceProcessId,

    deviation
      .referenceProcessVersion,

    deviation
      .dimension,

    deviation
      .moveType ??
    "-",

    actualActivityIds,

    expectedReferenceActivityIds
  ].join(
    "|"
  );
}


export function reconcileCurrentDeviations(
  sessionId:
    string,

  referenceProcessId:
    string,

  referenceProcessVersion:
    number,

  detectedDeviations:
    DeviationCandidate[]
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  const analysis =
    session.analysis;


  // ====================================================
  // DEFENSIVE REFERENCE CHECK
  // ====================================================

  for (
    const deviation of
    detectedDeviations
  ) {
    if (
      deviation
        .referenceProcessId !==
      referenceProcessId ||

      deviation
        .referenceProcessVersion !==
      referenceProcessVersion
    ) {
      throw new Error(
        "Detected deviation belongs to a different reference-process version"
      );
    }
  }


  // ====================================================
  // CURRENT DEVIATIONS FOR THIS REFERENCE VERSION
  // ====================================================

  const existingCurrent =
    analysis
      .deviations
      .filter(
        (
          deviation
        ) =>
          deviation
            .referenceProcessId ===
          referenceProcessId &&

          deviation
            .referenceProcessVersion ===
          referenceProcessVersion
      );


  // ====================================================
  // INDEX EXISTING DEVIATIONS BY SEMANTIC IDENTITY
  // ====================================================

  const existingByKey =
    new Map<
      string,
      DeviationCandidate
    >();

  for (
    const deviation of
    existingCurrent
  ) {
    existingByKey.set(
      deviationSemanticKey(
        deviation
      ),
      deviation
    );
  }


  // ====================================================
  // DEDUPLICATE NEW DETECTIONS
  // ====================================================

  const detectedByKey =
    new Map<
      string,
      DeviationCandidate
    >();

  for (
    const deviation of
    detectedDeviations
  ) {
    detectedByKey.set(
      deviationSemanticKey(
        deviation
      ),
      deviation
    );
  }


  // ====================================================
  // RECONCILE DETECTED DEVIATIONS
  // ====================================================

  const reconciled:
    DeviationCandidate[] =
    [];

  for (
    const [
      key,
      detected
    ] of
    detectedByKey
  ) {
    const existing =
      existingByKey.get(
        key
      );

    // --------------------------------------------------
    // NEW DEVIATION
    // --------------------------------------------------

    if (
      !existing
    ) {
      reconciled.push(
        cloneValue(
          detected
        )
      );

      continue;
    }


    // --------------------------------------------------
    // EXISTING INVESTIGATION
    // --------------------------------------------------

    const investigation =
      analysis
        .investigations
        .find(
          (
            candidate
          ) =>
            candidate
              .deviationId ===
            existing.id
        );


    // --------------------------------------------------
    // EXISTING OWNER REVIEW
    // --------------------------------------------------

    const ownerReview =
      analysis
        .ownerReviews
        .find(
          (
            candidate
          ) =>
            candidate
              .deviationId ===
            existing.id
        );


    // --------------------------------------------------
    // PRESERVE STATE
    // --------------------------------------------------
    //
    // The latest technical finding is used, but:
    //
    // - stable deviation ID remains
    // - firstDetectedAt remains
    // - investigation progress remains
    // - owner decision remains
    // --------------------------------------------------

    let status:
      DeviationCandidate["status"] =
      "open";

    if (
      ownerReview &&
      ownerReview.decision !==
      "needs_information"
    ) {
      status =
        "reviewed";
    } else if (
      analysis.practices.some(
        (practice) =>
          practice.deviationIds.includes(
            existing.id
          ) &&
          isPracticeComplete(
            practice
          )
      )
    ) {
      status =
        "information_complete";
    } else if (
      investigation?.status ===
      "complete"
    ) {
      status =
        "information_complete";
    }

    reconciled.push({
      ...cloneValue(
        detected
      ),

      id:
        existing.id,

      firstDetectedAt:
        existing
          .firstDetectedAt,

      status
    });
  }


  // ====================================================
  // PROTECT OWNER-REVIEWED DEVIATIONS
  // ====================================================
  //
  // If a later technical run does not detect a finding
  // anymore, an already reviewed finding remains in the
  // audit history.
  // ====================================================

  const protectedDeviationIds =
    new Set<string>();

  for (
    const review of
    analysis.ownerReviews
  ) {
    protectedDeviationIds.add(
      review.deviationId
    );
  }

  for (
    const deviation of
    existingCurrent
  ) {
    if (
      deviation.status ===
      "reviewed"
    ) {
      protectedDeviationIds.add(
        deviation.id
      );
    }
  }


  const reconciledIds =
    new Set(
      reconciled.map(
        (
          deviation
        ) =>
          deviation.id
      )
    );

  const protectedCurrent =
    existingCurrent
      .filter(
        (
          deviation
        ) =>
          protectedDeviationIds.has(
            deviation.id
          ) &&
          !reconciledIds.has(
            deviation.id
          )
      );


  // ====================================================
  // PRESERVE DEVIATIONS FROM OTHER REFERENCE VERSIONS
  // ====================================================

  const otherReferenceDeviations =
    analysis
      .deviations
      .filter(
        (
          deviation
        ) =>
          !(
            deviation
              .referenceProcessId ===
            referenceProcessId &&

            deviation
              .referenceProcessVersion ===
            referenceProcessVersion
          )
      );


  // ====================================================
  // FINAL DEVIATION SET
  // ====================================================

  const nextDeviations = [
    ...otherReferenceDeviations,
    ...protectedCurrent,
    ...reconciled
  ];

  session.analysis
    .deviations =
    cloneValue(
      nextDeviations
    );


  // ====================================================
  // REMOVE ORPHANED INVESTIGATIONS
  // ====================================================

  const retainedDeviationIds =
    new Set(
      nextDeviations.map(
        (
          deviation
        ) =>
          deviation.id
      )
    );

  session.analysis
    .investigations =
    session.analysis
      .investigations
      .filter(
        (
          investigation
        ) =>
          retainedDeviationIds.has(
            investigation
              .deviationId
          )
      );


  // ====================================================
  // REMOVE ORPHANED OWNER REVIEWS
  // ====================================================

  // Practices lose links to vanished deviations but keep their
  // answers; one without links or answers is dropped.
  session.analysis
    .practices =
    session.analysis
      .practices
      .map(
        (practice) => ({
          ...practice,
          deviationIds:
            practice.deviationIds.filter(
              (id) =>
                retainedDeviationIds.has(id)
            )
        })
      )
      .filter(
        (practice) =>
          practice.deviationIds.length > 0 ||
          Object.keys(practice.facts).length > 0 ||
          practice.activityFacts.length > 0 ||
          practice.groupingBasis.length > 0
      );

  session.analysis
    .ownerReviews =
    session.analysis
      .ownerReviews
      .filter(
        (
          review
        ) =>
          retainedDeviationIds.has(
            review
              .deviationId
          )
      );


  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

export function removeDeviation(
  sessionId: string,
  deviationId: string
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  session.analysis.deviations =
    session.analysis
      .deviations
      .filter(
        (deviation) =>
          deviation.id !==
          deviationId
      );

  /**
   * Investigation has no valid target anymore.
   */
  session.analysis
    .investigations =
    session.analysis
      .investigations
      .filter(
        (investigation) =>
          investigation
            .deviationId !==
          deviationId
      );

  /**
   * Owner review has no valid target anymore.
   */
  session.analysis
    .ownerReviews =
    session.analysis
      .ownerReviews
      .filter(
        (review) =>
          review
            .deviationId !==
          deviationId
      );

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// PRACTICES (WORKAROUND CANDIDATES)
// ======================================================

export function replacePractices(
  sessionId: string,
  practices:
    PracticeCandidate[],

  grouping?:
    PracticeGrouping
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  session.analysis
    .practices =
    cloneValue(
      practices
    );

  if (grouping) {
    session.analysis
      .practiceGrouping =
      cloneValue(
        grouping
      );
  }

  // Keep the technical deviation status in sync.
  for (
    const deviation of
    session.analysis.deviations
  ) {
    if (
      deviation.status ===
      "reviewed"
    ) {
      continue;
    }

    const practice =
      practices.find(
        (candidate) =>
          candidate.deviationIds.includes(
            deviation.id
          )
      );

    if (practice) {
      deviation.status =
        isPracticeComplete(
          practice
        )
          ? "information_complete"
          : "open";
    }
  }

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// INVESTIGATIONS
// ======================================================

export function replaceInvestigations(
  sessionId: string,
  investigations:
    DeviationInvestigation[]
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  session.analysis
    .investigations =
    cloneValue(
      investigations
    );

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

export function upsertInvestigation(
  sessionId: string,
  investigation:
    DeviationInvestigation
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  /**
   * Normally there is one investigation per technical
   * deviation.
   */
  const index =
    session.analysis
      .investigations
      .findIndex(
        (candidate) =>
          candidate.id ===
          investigation.id ||
          candidate.deviationId ===
          investigation
            .deviationId
      );

  if (
    index === -1
  ) {
    session.analysis
      .investigations
      .push(
        cloneValue(
          investigation
        )
      );
  } else {
    session.analysis
      .investigations[
      index
    ] =
      cloneValue(
        investigation
      );
  }

  /**
   * Keep the technical deviation status synchronized.
   */
  const deviation =
    session.analysis
      .deviations
      .find(
        (candidate) =>
          candidate.id ===
          investigation
            .deviationId
      );

  if (
    deviation &&
    deviation.status !==
    "reviewed"
  ) {
    deviation.status =
      investigation.status ===
        "complete"
        ? "information_complete"
        : "open";
  }

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// OWNER REVIEWS
// ======================================================

export function upsertOwnerReview(
  sessionId: string,
  review:
    OwnerReview
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  /**
   * One current Process Owner decision per deviation.
   *
   * Re-reviewing a deviation replaces the previous
   * decision.
   */
  const index =
    session.analysis
      .ownerReviews
      .findIndex(
        (candidate) =>
          candidate.id ===
          review.id ||
          candidate.deviationId ===
          review.deviationId
      );

  if (
    index === -1
  ) {
    session.analysis
      .ownerReviews
      .push(
        cloneValue(
          review
        )
      );
  } else {
    session.analysis
      .ownerReviews[
      index
    ] =
      cloneValue(
        review
      );
  }

  // ----------------------------------------------------
  // UPDATE DEVIATION STATUS
  // ----------------------------------------------------

  const deviation =
    session.analysis
      .deviations
      .find(
        (candidate) =>
          candidate.id ===
          review.deviationId
      );

  if (
    deviation
  ) {
    /**
     * "needs_information" means that the investigation
     * is not finished from the owner's perspective.
     */
    deviation.status =
      review.decision ===
        "needs_information"
        ? "open"
        : "reviewed";
  }

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// RESET CONFORMANCE ANALYSIS
// ======================================================
//
// Called when the automatically selected reference
// process changes.
//
// Example:
//
// initially selected:
// Auftragserfassung
//
// later revised to:
// Bestelländerung
//
// Technical analysis against the old reference process
// must no longer be treated as current.
//
// Already reviewed deviations are retained for audit
// purposes.
// ======================================================

export function resetUnreviewedConformanceAnalysis(
  sessionId: string
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  const analysis =
    session.analysis;

  // ----------------------------------------------------
  // FIND DEVIATIONS THAT ALREADY HAVE AN OWNER REVIEW
  // ----------------------------------------------------

  const reviewedDeviationIds =
    new Set(
      analysis.ownerReviews.map(
        (review) =>
          review.deviationId
      )
    );

  // ----------------------------------------------------
  // RETAIN ONLY REVIEWED DEVIATIONS
  // ----------------------------------------------------

  const retainedDeviations =
    analysis.deviations.filter(
      (deviation) =>
        reviewedDeviationIds.has(
          deviation.id
        )
    );

  const retainedDeviationIds =
    new Set(
      retainedDeviations.map(
        (deviation) =>
          deviation.id
      )
    );

  // ----------------------------------------------------
  // RETAIN CONFORMANCE RUNS REFERENCED BY REVIEWED
  // DEVIATIONS
  // ----------------------------------------------------

  const retainedConformanceRunIds =
    new Set(
      retainedDeviations.map(
        (
          deviation
        ) =>
          deviation
            .sourceConformanceRunId
      )
    );

  const retainedConformanceRuns =
    analysis
      .conformanceRuns
      .filter(
        (
          run
        ) =>
          retainedConformanceRunIds.has(
            run.id
          )
      );

  // ----------------------------------------------------
  // RETAIN INVESTIGATIONS BELONGING TO REVIEWED
  // DEVIATIONS
  // ----------------------------------------------------

  const retainedInvestigations =
    analysis.investigations.filter(
      (investigation) =>
        retainedDeviationIds.has(
          investigation.deviationId
        )
    );

  // ----------------------------------------------------
  // RETAIN OWNER REVIEWS BELONGING TO RETAINED
  // DEVIATIONS
  // ----------------------------------------------------

  const retainedOwnerReviews =
    analysis.ownerReviews.filter(
      (review) =>
        retainedDeviationIds.has(
          review.deviationId
        )
    );

  // ----------------------------------------------------
  // RESET CURRENT CONFORMANCE ANALYSIS
  // ----------------------------------------------------

  session.analysis = {
    ...analysis,

    /**
     * These mappings were created against the old
     * reference process and are therefore invalid.
     */
    activityMappings:
      [],

    /**
     * Conformance runs against the old reference model
     * must not be reused.
     */
    conformanceRuns:
      retainedConformanceRuns,

    /**
     * Unreviewed deviations are discarded and will be
     * recalculated against the new reference process.
     */
    deviations:
      retainedDeviations,

    /**
     * Only investigations belonging to already reviewed
     * deviations are retained.
     */
    investigations:
      retainedInvestigations,

    /**
     * Practices keep only the reviewed deviations; the rest
     * is regrouped against the new reference process.
     */
    practices:
      analysis.practices
        .map(
          (practice) => ({
            ...practice,
            deviationIds:
              practice.deviationIds.filter(
                (id) =>
                  retainedDeviationIds.has(id)
              )
          })
        )
        .filter(
          (practice) =>
            practice.deviationIds.length > 0
        ),

    /**
     * Preserve completed Process Owner decisions.
     */
    ownerReviews:
      retainedOwnerReviews
  };

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// CLEAR ONLY CURRENT PROCESS IDENTIFICATION
// ======================================================
//
// Useful for tests or if a reference process is removed.
//
// The employee-declared process name can optionally be
// retained.
// ======================================================

export function resetProcessIdentification(
  sessionId: string,
  keepDeclaredName =
    true
): InterviewSession {
  const session =
    requireSession(
      sessionId
    );

  const current =
    session.analysis
      .processIdentification;

  session.analysis
    .processIdentification = {
    status:
      "unresolved",

    declaredProcessName:
      keepDeclaredName
        ? current
          .declaredProcessName
        : undefined,

    candidates:
      [],

    selectedReferenceProcessId:
      undefined,

    selectedReferenceProcessVersion:
      undefined,

    selectedReferenceModelHash:
      undefined,

    selectedBy:
      undefined,

    lockedByOwner:
      false,

    stable:
      false,

    confidence:
      0,

    marginToSecondCandidate:
      0,

    selectedAtActivityCount:
      undefined,

    revisionCount:
      0,

    lastEvaluatedAt:
      undefined,

    history:
      []
  };

  session.analysis
    .activityMappings =
    [];

  session.analysis
    .conformanceRuns =
    [];

  session.analysis
    .deviations =
    [];

  session.analysis
    .investigations =
    [];

  session.analysis
    .practices =
    [];

  session.analysis
    .practiceGrouping = {
    askedSets: [],
    independentPairs: [],
    redirects: {}
  };

  session.analysis
    .ownerReviews =
    [];

  touchSession(
    session
  );

  return cloneValue(
    session
  );
}

// ======================================================
// TEST SUPPORT
// ======================================================
//
// Useful in Vitest beforeEach().
//
// Never expose this through HTTP.
// ======================================================

export function clearSessions():
  void {
  sessions.clear();
}