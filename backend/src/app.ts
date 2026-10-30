import {
  randomUUID
} from "node:crypto";

import express from "express";
import cors from "cors";

import {
  generateBpmnXml
} from "./bpmn.js";

import {
  logInteraction
} from "./logging.js";

import {
  buildMainTrace
} from "./conformance/trace-builder.js";

import {
  isActivityMappingReliable,
  mapTraceActivities
} from "./reference/activity-matcher.js";

import {
  refreshConformanceForSession
} from "./conformance/run.js";

import {
  proposeProcessChanges
} from "./openai.js";

import {
  applyProcessChanges,
  normalizeOrganizationName,
  ProcessValidationError,
  validateProcessModel
} from "./process.js";

import {
  llmProcessResponseSchema
} from "./schemas.js";

import {
  assignIntervieweeRole,
  sanitizeProcessChanges,
  repairIntervieweeRoleStatement
} from "./process-change-sanitizer.js";

import {
  addMessage,
  createSession,
  getSession,
  listSessions,
  resetUnreviewedConformanceAnalysis,
  replacePractices,
  setDeclaredProcessName,
  updateProcessIdentification,
  updateSessionProcess,
  updateSessionState,
  replaceActivityMappings,
  upsertOwnerReview
} from "./store.js";

import {
  mergeEmployeeProcessView,
  toEmployeeProcessView,
  toEmployeeSessionView,
  toOwnerSessionView,
  type EmployeeProcessView
} from "./view.js";

import {
  createReferenceProcess,
  getReferenceProcess,
  listReferenceProcesses,
  listActiveReferenceProcesses,
  saveReferenceProcessVersion,
  updateReferenceMetadata,
  deleteReferenceProcess
} from "./reference/repository.js";

import {
  type PendingQuestion,
  type ProcessChanges,
  type ProcessIdentification,
  type ProcessModel
} from "./types.js";

import {
  rankReferenceProcesses
} from "./reference/matcher.js";

import {
  isAutomaticSelectionStable,
  shouldReviseSelection,
  shouldSelectCandidate
} from "./reference/identification-policy.js";

import {
  applyPracticeHints,
  choosePracticeQuestion,
  createEvidence,
  describePracticesForModel,
  fallbackPracticeAnswer,
  groupingHintsForAnswer,
  isDeviationEligible,
  recordPracticeAnswers,
  syncPractices
} from "./analysis/practices.js";

import {
  getConfirmationFollowUp
} from "./analysis/confirmation.js";

import {
  laneAssignmentsChanged
} from "./analysis/responsibility.js";

import {
  parseCancellation
} from "./analysis/cancellation.js";

import {
  continuationMessage,
  currentResponsibility,
  intervieweeResponsibility,
  isRedundantResponsibilityQuestion,
  responsibilityStatePatch,
  selectResponsibilityQuestion,
  tasksWithoutLane
} from "./analysis/responsibility.js";

import {
  isFallbackLaneName
} from "./lane-constants.js";

import {
  explainRejectedUpdate,
  planLaneRemovals
} from "./analysis/lane-edits.js";


// ======================================================
// APP
// ======================================================

export const app =
  express();

app.use(
  cors()
);

app.use(
  express.json({
    limit:
      "1mb"
  })
);


// ======================================================
// OWNER REVIEW DECISIONS
// ======================================================

const OWNER_REVIEW_DECISIONS = [
  "confirmed_workaround",
  "accepted_variant",
  "model_outdated",
  "not_a_workaround",
  "needs_information"
] as const;

type OwnerReviewDecision =
  (typeof OWNER_REVIEW_DECISIONS)[number];


function isOwnerReviewDecision(
  value:
    unknown
): value is OwnerReviewDecision {
  return (
    typeof value ===
    "string" &&
    OWNER_REVIEW_DECISIONS.some(
      (
        decision
      ) =>
        decision ===
        value
    )
  );
}


// ======================================================
// HELPERS
// ======================================================

function emptyProcessChanges():
  ProcessChanges {
  return {
    // Participants
    addParticipants:
      [],

    updateParticipants:
      [],

    removeParticipantIds:
      [],

    // Lanes
    addLanes:
      [],

    updateLanes:
      [],

    removeLaneIds:
      [],

    // Elements
    addElements:
      [],

    updateElements:
      [],

    removeElementIds:
      [],

    // Sequence Flows
    addFlows:
      [],

    removeFlowIds:
      [],

    // Message Flows
    addMessageFlows:
      [],

    removeMessageFlowIds:
      [],

    // Legacy workaround schema
    addWorkarounds:
      [],

    updateWorkarounds:
      []
  };
}


// ======================================================
// EMPLOYEE MESSAGE SAFETY
// ======================================================
//
// Internal conformance terminology must never be exposed
// through employee endpoints.
//
// This is only a final safety net.
// ======================================================

function isEmployeeSafeMessage(
  message:
    string
): boolean {
  const forbidden =
    /\b(workaround|non-compliance|violation|regelverstoß|abweich\w*|umgeh\w*|verdächtig)\b/i;

  return !forbidden.test(
    message
  );
}


function chooseEmployeeMessage(
  assistantMessage:
    string,

  nextQuestion?:
    string
): string {
  if (
    isEmployeeSafeMessage(
      assistantMessage
    )
  ) {
    return assistantMessage;
  }

  if (
    nextQuestion &&
    isEmployeeSafeMessage(
      nextQuestion
    )
  ) {
    return nextQuestion;
  }

  return "Please describe the next steps in the process.";
}


// ======================================================
// PROCESS HELPERS
// ======================================================

function countTasks(
  process:
    ProcessModel
): number {
  return process.elements
    .filter(
      (
        element
      ) =>
        element.type ===
        "task"
    )
    .length;
}

// ======================================================
// AUTOMATIC REFERENCE PROCESS IDENTIFICATION
// ======================================================
//
// Hidden employee-side identification.
//
// Employee APIs never expose:
//
// - candidate list
// - scores
// - selected reference process
// - confidence
// - revision history
//
// Owner-locked selections are never changed.
// ======================================================

async function refreshAutomaticProcessIdentification(
  sessionId:
    string,

  actualProcess:
    ProcessModel
): Promise<
  ProcessIdentification
> {
  const session =
    getSession(
      sessionId
    );

  if (
    !session
  ) {
    throw new Error(
      "Session not found while refreshing process identification"
    );
  }

  const current =
    session.analysis
      .processIdentification;


  // ====================================================
  // OWNER LOCK
  // ====================================================
  //
  // Owner override is authoritative.
  // ====================================================

  if (
    current.lockedByOwner
  ) {
    return current;
  }


  // ====================================================
  // LOAD ACTIVE REFERENCES
  // ====================================================

  const references =
    await listActiveReferenceProcesses();


  // ====================================================
  // NO REFERENCES AVAILABLE
  // ====================================================

  if (
    references.length ===
    0
  ) {
    const next:
      ProcessIdentification = {
      ...current,

      status:
        "unresolved",

      candidates:
        [],

      stable:
        false,

      confidence:
        0,

      marginToSecondCandidate:
        0,

      lastEvaluatedAt:
        new Date()
          .toISOString()
    };

    updateProcessIdentification(
      sessionId,
      next
    );

    return next;
  }


  // ====================================================
  // RANK REFERENCES
  // ====================================================

  const candidates =
    rankReferenceProcesses(
      actualProcess,

      current
        .declaredProcessName,

      references
    );

  const topCandidate =
    candidates[0];

  if (
    !topCandidate
  ) {
    const next:
      ProcessIdentification = {
      ...current,

      status:
        "unresolved",

      candidates:
        [],

      stable:
        false,

      confidence:
        0,

      marginToSecondCandidate:
        0,

      lastEvaluatedAt:
        new Date()
          .toISOString()
    };

    updateProcessIdentification(
      sessionId,
      next
    );

    return next;
  }


  // ====================================================
  // SCORE + MARGIN
  // ====================================================

  const topScore =
    topCandidate
      .score
      .combinedScore;

  const secondScore =
    candidates[1]
      ?.score
      .combinedScore ??
    0;

  const margin =
    Math.max(
      0,
      topScore -
      secondScore
    );

  const taskCount =
    countTasks(
      actualProcess
    );

  const timestamp =
    new Date()
      .toISOString();


  // ====================================================
  // CURRENT SELECTION SCORE
  // ====================================================

  const currentCandidate =
    current
      .selectedReferenceProcessId
      ? candidates.find(
        (
          candidate
        ) =>
          candidate
            .referenceProcessId ===
          current
            .selectedReferenceProcessId
      )
      : undefined;

  const currentScore =
    currentCandidate
      ?.score
      .combinedScore ??
    0;


  // ====================================================
  // CASE 1:
  // NO REFERENCE SELECTED YET
  // ====================================================

  if (
    !current
      .selectedReferenceProcessId
  ) {
    const select =
      shouldSelectCandidate(
        taskCount,
        topScore,
        margin
      );


    // --------------------------------------------------
    // Not enough evidence yet
    // --------------------------------------------------

    if (
      !select
    ) {
      const next:
        ProcessIdentification = {
        ...current,

        status:
          topScore >
            0
            ? "probable"
            : "unresolved",

        candidates,

        stable:
          false,

        confidence:
          topScore,

        marginToSecondCandidate:
          margin,

        lastEvaluatedAt:
          timestamp
      };

      updateProcessIdentification(
        sessionId,
        next
      );

      return next;
    }


    // --------------------------------------------------
    // Select reference process
    // --------------------------------------------------

    const selectedReference =
      references.find(
        (
          reference
        ) =>
          reference
            .metadata
            .id ===
          topCandidate
            .referenceProcessId
      );

    if (
      !selectedReference
    ) {
      throw new Error(
        "Top reference-process candidate could not be resolved"
      );
    }

    const stable =
      isAutomaticSelectionStable(
        taskCount,
        current.revisionCount
      );

    const next:
      ProcessIdentification = {
      ...current,

      status:
        "selected",

      candidates,

      selectedReferenceProcessId:
        topCandidate
          .referenceProcessId,

      selectedReferenceProcessVersion:
        topCandidate
          .referenceProcessVersion,

      selectedReferenceModelHash:
        selectedReference
          .currentVersion
          .modelHash,

      selectedBy:
        "automatic",

      lockedByOwner:
        false,

      stable,

      confidence:
        topScore,

      marginToSecondCandidate:
        margin,

      selectedAtActivityCount:
        taskCount,

      lastEvaluatedAt:
        timestamp,

      history: [
        ...current.history,

        {
          timestamp,

          activityCount:
            taskCount,

          candidates:
            structuredClone(
              candidates
            ),

          selectedReferenceProcessId:
            topCandidate
              .referenceProcessId,

          selectedReferenceProcessVersion:
            topCandidate
              .referenceProcessVersion,

          reason:
            "activity_evidence"
        }
      ]
    };

    updateProcessIdentification(
      sessionId,
      next
    );

    return next;
  }


  // ====================================================
  // CASE 2:
  // REFERENCE ALREADY SELECTED
  // ====================================================

  const topIsCurrentSelection =
    topCandidate
      .referenceProcessId ===
    current
      .selectedReferenceProcessId;


  // ====================================================
  // SAME REFERENCE STILL ON TOP
  // ====================================================

  if (
    topIsCurrentSelection
  ) {
    const stable =
      isAutomaticSelectionStable(
        taskCount,
        current.revisionCount
      );

    const next:
      ProcessIdentification = {
      ...current,

      status:
        "selected",

      candidates,

      stable,

      confidence:
        topScore,

      marginToSecondCandidate:
        margin,

      lastEvaluatedAt:
        timestamp
    };

    updateProcessIdentification(
      sessionId,
      next
    );

    return next;
  }


  // ====================================================
  // DIFFERENT REFERENCE IS NOW ON TOP
  // ====================================================

  const revise =
    shouldReviseSelection(
      currentScore,
      topScore,
      taskCount,
      current.revisionCount,
      current.lockedByOwner
    );


  // ====================================================
  // KEEP CURRENT SELECTION
  // ====================================================

  if (
    !revise
  ) {
    const stable =
      isAutomaticSelectionStable(
        taskCount,
        current.revisionCount
      );

    const next:
      ProcessIdentification = {
      ...current,

      status:
        "selected",

      candidates,

      stable,

      confidence:
        currentScore,

      marginToSecondCandidate:
        margin,

      lastEvaluatedAt:
        timestamp
    };

    updateProcessIdentification(
      sessionId,
      next
    );

    return next;
  }


  // ====================================================
  // REVISE AUTOMATIC SELECTION
  // ====================================================

  const selectedReference =
    references.find(
      (
        reference
      ) =>
        reference
          .metadata
          .id ===
        topCandidate
          .referenceProcessId
    );

  if (
    !selectedReference
  ) {
    throw new Error(
      "Revised reference-process candidate could not be resolved"
    );
  }


  // ----------------------------------------------------
  // Old mappings, runs and unreviewed deviations are no
  // longer valid against the new reference process.
  // ----------------------------------------------------

  resetUnreviewedConformanceAnalysis(
    sessionId
  );

  const revisionCount =
    current.revisionCount +
    1;

  const stable =
    isAutomaticSelectionStable(
      taskCount,
      revisionCount
    );

  const next:
    ProcessIdentification = {
    ...current,

    status:
      "selected",

    candidates,

    selectedReferenceProcessId:
      topCandidate
        .referenceProcessId,

    selectedReferenceProcessVersion:
      topCandidate
        .referenceProcessVersion,

    selectedReferenceModelHash:
      selectedReference
        .currentVersion
        .modelHash,

    selectedBy:
      "automatic",

    lockedByOwner:
      false,

    stable,

    confidence:
      topScore,

    marginToSecondCandidate:
      margin,

    selectedAtActivityCount:
      taskCount,

    revisionCount,

    lastEvaluatedAt:
      timestamp,

    history: [
      ...current.history,

      {
        timestamp,

        activityCount:
          taskCount,

        candidates:
          structuredClone(
            candidates
          ),

        selectedReferenceProcessId:
          topCandidate
            .referenceProcessId,

        selectedReferenceProcessVersion:
          topCandidate
            .referenceProcessVersion,

        reason:
          "selection_revised"
      }
    ]
  };

  updateProcessIdentification(
    sessionId,
    next
  );

  return next;
}

// ======================================================
// TRACE DEBUGGING
// ======================================================
//
// ElicitedTraceVariant is DERIVED from ProcessModel.
//
// It is deliberately not stored as another source of
// truth.
//
// Later:
//
// ProcessModel
// -> buildMainTrace()
// -> Activity Mapping
// -> Prefix TBR / Alignment
// -> ConformanceRun
// ======================================================

function buildAndLogMainTrace(
  processModel:
    ProcessModel,

  source:
    string
): ReturnType<
  typeof buildMainTrace
> {
  const trace =
    buildMainTrace(
      processModel
    );

  if (
    process.env.NODE_ENV !==
    "production"
  ) {
    console.info(
      `[workaround-check] elicited trace (${source}):`,
      JSON.stringify(
        trace,
        null,
        2
      )
    );
  }

  return trace;
}

// ======================================================
// REFRESH ACTIVITY MAPPINGS
// ======================================================
//
// Activity mappings are internal analysis data.
//
// They are generated only if a reference process and
// reference-process version have already been selected.
//
// IMPORTANT:
//
// This function does NOT create deviations.
//
// In particular:
//
// unmatched activity
// != deviation
//
// uncertain mapping
// != deviation
//
// uncertain mapping
// != workaround
// ======================================================

async function refreshActivityMappings(
  sessionId:
    string,

  trace:
    ReturnType<
      typeof buildMainTrace
    >
): Promise<void> {
  const session =
    getSession(
      sessionId
    );

  if (
    !session
  ) {
    throw new Error(
      "Session not found while refreshing activity mappings"
    );
  }

  const identification =
    session.analysis
      .processIdentification;

  const referenceProcessId =
    identification
      .selectedReferenceProcessId;

  const referenceProcessVersion =
    identification
      .selectedReferenceProcessVersion;


  // ====================================================
  // NO REFERENCE SELECTED
  // ====================================================

  if (
    !referenceProcessId ||
    referenceProcessVersion ===
    undefined
  ) {
    replaceActivityMappings(
      sessionId,
      []
    );

    return;
  }


  // ====================================================
  // LOAD EXACT REFERENCE VERSION
  // ====================================================

  const reference =
    await getReferenceProcess(
      referenceProcessId,
      referenceProcessVersion
    );

  if (
    !reference
  ) {
    replaceActivityMappings(
      sessionId,
      []
    );

    console.warn(
      "[workaround-check] selected reference process/version could not be loaded:",
      {
        referenceProcessId,
        referenceProcessVersion
      }
    );

    return;
  }


  // ====================================================
  // MAP ACTIVITIES
  // ====================================================

  const mappings =
    mapTraceActivities(
      trace,
      reference.currentVersion
    );


  // ====================================================
  // STORE INTERNAL ANALYSIS
  // ====================================================

  replaceActivityMappings(
    sessionId,
    mappings
  );


  // ====================================================
  // DEBUG
  // ====================================================

  if (
    process.env.NODE_ENV !==
    "production"
  ) {
    const reliableMappings =
      mappings.filter(
        (
          mapping
        ) =>
          isActivityMappingReliable(
            mapping
          )
      );

    const uncertainMappings =
      mappings.filter(
        (
          mapping
        ) =>
          !isActivityMappingReliable(
            mapping
          )
      );

    console.info(
      "[workaround-check] activity mappings:",
      JSON.stringify(
        mappings,
        null,
        2
      )
    );

    console.info(
      "[workaround-check] mapping summary:",
      {
        total:
          mappings.length,

        reliable:
          reliableMappings.length,

        uncertain:
          uncertainMappings.length
      }
    );
  }
}


// ======================================================
// STRING ARRAY VALIDATION
// ======================================================

function readOptionalStringArray(
  value:
    unknown
): string[] | undefined {
  if (
    value ===
    undefined
  ) {
    return undefined;
  }

  if (
    !Array.isArray(
      value
    )
  ) {
    return undefined;
  }

  return value
    .filter(
      (
        item
      ): item is string =>
        typeof item ===
        "string"
    )
    .map(
      (
        item
      ) =>
        item.trim()
    )
    .filter(
      Boolean
    );
}


// ======================================================
// EMPLOYEE
// CREATE SESSION
// ======================================================

app.post(
  "/api/employee/sessions",
  (
    _req,
    res
  ) => {
    try {
      const session =
        createSession();

      const bpmnXml =
        generateBpmnXml(
          session.process
        );

      return res
        .status(
          201
        )
        .json({
          session:
            toEmployeeSessionView(
              session,
              bpmnXml
            )
        });
    } catch (
    error
    ) {
      console.error(
        "[employee:create-session]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            "Failed to create session"
        });
    }
  }
);


// ======================================================
// EMPLOYEE
// GET SESSION
// ======================================================

app.get(
  "/api/employee/sessions/:id",
  (
    req,
    res
  ) => {
    try {
      const session =
        getSession(
          req.params.id
        );

      if (
        !session
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Session not found"
          });
      }

      const bpmnXml =
        generateBpmnXml(
          session.process
        );

      return res.json({
        session:
          toEmployeeSessionView(
            session,
            bpmnXml
          )
      });
    } catch (
    error
    ) {
      console.error(
        "[employee:get-session]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            "Failed to load session"
        });
    }
  }
);


// ======================================================
// EMPLOYEE
// PROCESS CHAT MESSAGE
// ======================================================

// Answers without touching the process; the last valid state stays.
async function respondUnchanged(
  res: express.Response,
  params: {
    sessionId: string;
    userMessage: string;
    process: ProcessModel;
    message: string;
    pending?: {
      kind: PendingQuestion["kind"];
      targetIds: string[];
    };
  }
) {
  updateSessionState(
    params.sessionId,
    {
      pendingQuestion:
        params.pending
          ? {
            id: randomUUID(),
            kind: params.pending.kind,
            targetIds: params.pending.targetIds,
            question: params.message
          }
          : undefined,

      lastFocusedElementIds:
        params.pending?.targetIds ?? []
    }
  );

  addMessage(
    params.sessionId,
    "assistant",
    params.message
  );

  await logInteraction({
    timestamp:
      new Date().toISOString(),
    sessionId:
      params.sessionId,
    userMessage:
      params.userMessage,
    assistantMessage:
      params.message,
    processBefore:
      params.process,
    proposedChanges:
      emptyProcessChanges(),
    processAfter:
      params.process
  });

  return res.json({
    assistantMessage:
      params.message,
    process:
      toEmployeeProcessView(
        params.process
      ),
    bpmnXml:
      generateBpmnXml(
        params.process
      )
  });
}

app.post(
  "/api/employee/sessions/:id/message",
  async (
    req,
    res
  ) => {
    const session =
      getSession(
        req.params.id
      );

    if (
      !session
    ) {
      return res
        .status(
          404
        )
        .json({
          error:
            "Session not found"
        });
    }

    const message =
      req.body?.message;

    if (
      typeof message !==
      "string" ||
      !message.trim()
    ) {
      return res
        .status(
          400
        )
        .json({
          error:
            "message must be a non-empty string"
        });
    }

    const rawUserMessage =
      message.trim();

    // "Never mind, the next activity is ..." withdraws the pending
    // question and still carries process information.
    const pendingAtStart =
      session.pendingQuestion;

    const cancellation =
      pendingAtStart &&
        pendingAtStart.kind !== "process_scope"
        ? parseCancellation(rawUserMessage)
        : { cancelled: false, remainder: rawUserMessage };

    const userMessage =
      cancellation.cancelled
        ? cancellation.remainder
        : rawUserMessage;


    // ==================================================
    // STORE EMPLOYEE MESSAGE
    // ==================================================

    addMessage(
      session.id,
      "employee",
      rawUserMessage
    );

    if (cancellation.cancelled) {
      updateSessionState(
        session.id,
        {
          pendingQuestion:
            undefined,

          lastFocusedElementIds:
            []
        }
      );
    }

    const sessionAfterUserMessage =
      getSession(
        session.id
      );

    if (
      !sessionAfterUserMessage
    ) {
      return res
        .status(
          500
        )
        .json({
          error:
            "Session disappeared unexpectedly"
        });
    }

    const processBefore =
      structuredClone(
        sessionAfterUserMessage
          .process
      );


    if (
      cancellation.cancelled &&
      !userMessage
    ) {
      return respondUnchanged(
        res,
        {
          sessionId:
            session.id,

          userMessage:
            rawUserMessage,

          process:
            sessionAfterUserMessage.process,

          message:
            "Okay, I dropped that. What is the next activity in the process?"
        }
      );
    }


    try {
      // ==================================================
      // INITIAL PROCESS SCOPE
      // ==================================================
      //
      // Assistant:
      //
      // "Which process would you like to describe?"
      //
      // Employee:
      //
      // "Auftragserfassung"
      //
      // This answer is NOT an activity.
      // ==================================================

      if (
        sessionAfterUserMessage
          .pendingQuestion
          ?.kind ===
        "process_scope"
      ) {
        // ----------------------------------------------
        // Store declared process name as identification
        // evidence.
        // ----------------------------------------------

        setDeclaredProcessName(
          session.id,
          userMessage
        );


        // ----------------------------------------------
        // Use employee wording as AS-IS model name.
        // ----------------------------------------------

        const renamedProcess:
          ProcessModel = {
          ...sessionAfterUserMessage
            .process,

          name:
            userMessage,

          updatedAt:
            new Date()
              .toISOString()
        };

        const processSession =
          updateSessionProcess(
            session.id,
            renamedProcess
          );


        // ----------------------------------------------
        // Next question: trigger
        // ----------------------------------------------

        const assistantMessage =
          "What usually triggers this process?";

        updateSessionState(
          session.id,
          {
            elicitationPhase:
              "scope",

            pendingQuestion: {
              id:
                randomUUID(),

              kind:
                "clarification",

              targetIds: [
                "start_1"
              ],

              field:
                "trigger",

              question:
                assistantMessage
            },

            lastFocusedElementIds: [
              "start_1"
            ],

            unresolvedProcessItems: [
              "process_trigger"
            ]
          }
        );

        addMessage(
          session.id,
          "assistant",
          assistantMessage
        );

        const updatedSession =
          getSession(
            session.id
          );

        if (
          !updatedSession
        ) {
          throw new Error(
            "Session disappeared unexpectedly"
          );
        }

        const bpmnXml =
          generateBpmnXml(
            updatedSession.process
          );

        await logInteraction({
          timestamp:
            new Date()
              .toISOString(),

          sessionId:
            session.id,

          userMessage,

          assistantMessage,

          processBefore,

          proposedChanges:
            emptyProcessChanges(),

          processAfter:
            processSession.process
        });

        return res.json({
          assistantMessage,

          process:
            toEmployeeProcessView(
              updatedSession.process
            ),

          bpmnXml
        });
      }


      // ==================================================
      // NORMAL LLM PROCESS EXTRACTION
      // ==================================================
      //
      // Answers to follow-up questions about a practice also
      // pass through here: the model reports their scope and
      // may combine them with new process information.
      // ==================================================

      const llmResponse =
        await proposeProcessChanges({
          userMessage,

          messages:
            sessionAfterUserMessage
              .messages,

          processModel:
            sessionAfterUserMessage
              .process,

          elicitationPhase:
            sessionAfterUserMessage
              .elicitationPhase,

          pendingQuestion:
            sessionAfterUserMessage
              .pendingQuestion,

          practiceContext:
            describePracticesForModel(
              sessionAfterUserMessage.analysis.practices,
              sessionAfterUserMessage.process
            ),

          responsibilityContext: {
            intervieweeRole:
              intervieweeResponsibility(
                sessionAfterUserMessage.process,
                sessionAfterUserMessage.responsibility
              ),

            currentRole:
              currentResponsibility(
                sessionAfterUserMessage.process
              ),

            distinctionDeclined:
              sessionAfterUserMessage
                .responsibility
                ?.distinctionDeclined
          }
        });


      // ==================================================
      // VALIDATE STRUCTURED LLM RESULT
      // ==================================================

      const validated =
        llmProcessResponseSchema
          .parse(
            llmResponse
          );

      const confirmationFollowUp =
        getConfirmationFollowUp(
          userMessage,
          sessionAfterUserMessage.pendingQuestion,
          sessionAfterUserMessage.process
        );

      if (confirmationFollowUp) {
        validated.intent = "confirmation";
        validated.assistantMessage =
          confirmationFollowUp.question;
        validated.contextPatch = {};
        validated.changes = emptyProcessChanges();
        validated.uncertainties = [];
        validated.nextQuestion = {
          required: true,
          kind: confirmationFollowUp.kind,
          targetRefs: confirmationFollowUp.targetIds,
          question: confirmationFollowUp.question
        };
        validated.validationRequest = {
          required: false,
          elementIds: [],
          question: ""
        };
      }


      // ======================================================
      // DETERMINISTIC PROCESS-CHANGE SANITIZATION
      // ======================================================

      const intervieweeBefore =
        intervieweeResponsibility(
          sessionAfterUserMessage.process,
          sessionAfterUserMessage.responsibility
        );

      const responsibilityHint =
        validated.responsibility;

      const sanitizedChanges =
        sanitizeProcessChanges(
          sessionAfterUserMessage.process,
          validated.changes,
          {
            actor:
              responsibilityHint?.actor,

            intervieweeLaneId:
              intervieweeBefore?.laneId
          }
        );


      // ======================================================
      // INTERVIEWEE ORGANIZATIONAL ROLE
      // ======================================================

      const roleRepair =
        repairIntervieweeRoleStatement(
          sessionAfterUserMessage.process,
          sanitizedChanges,
          userMessage
        );

      let roleChanges =
        roleRepair.changes;

      let establishedRole =
        roleRepair.applied
          ? roleRepair.roleName
          : undefined;

      // A newly stated role is applied once; repeating it changes nothing.
      const statedRole =
        responsibilityHint
          ?.intervieweeRole
          ?.trim();

      if (
        !establishedRole &&
        statedRole &&
        !isFallbackLaneName(statedRole) &&
        normalizeOrganizationName(statedRole) !==
        normalizeOrganizationName(
          intervieweeBefore?.name ?? ""
        )
      ) {
        roleChanges =
          assignIntervieweeRole(
            sessionAfterUserMessage.process,
            structuredClone(roleChanges),
            statedRole
          ).changes;

        establishedRole =
          statedRole;
      }


      // ======================================================
      // PRACTICE ANSWER (RECORDED BEFORE ANYTHING CAN REJECT THE TURN)
      // ======================================================
      //
      // The answer belongs to the pending question's practice and
      // field. It is stored first so a rejected process update or a
      // later scheduling step can never make the question reappear.
      // ======================================================

      const lastUserMessage =
        [...sessionAfterUserMessage.messages]
          .reverse()
          .find(
            (message) =>
              message.role === "employee"
          );

      const practiceEvidence =
        createEvidence(
          userMessage,
          lastUserMessage?.id
        );

      const practiceAnswers =
        validated.practiceAnswers?.length
          ? validated.practiceAnswers
          : (() => {
            const fallback =
              sessionAfterUserMessage.pendingQuestion
                ? fallbackPracticeAnswer(
                  userMessage,
                  sessionAfterUserMessage.pendingQuestion
                )
                : undefined;

            return fallback ? [fallback] : [];
          })();

      if (practiceAnswers.length > 0) {
        replacePractices(
          session.id,
          recordPracticeAnswers(
            sessionAfterUserMessage.analysis.practices,
            practiceAnswers,
            {
              process:
                sessionAfterUserMessage.process,

              refToId:
                {},

              evidence:
                practiceEvidence
            },
            sessionAfterUserMessage.pendingQuestion,
            {
              redirects:
                sessionAfterUserMessage.analysis
                  .practiceGrouping.redirects,

              deferUnresolved:
                true
            }
          )
        );
      }


      // ======================================================
      // LANE REMOVALS
      // ======================================================
      //
      // Occupied lanes are reassigned when the destination is
      // clear; otherwise nothing is applied and the missing
      // destination is asked for.
      // ======================================================

      const lanePlan =
        planLaneRemovals(
          sessionAfterUserMessage.process,
          roleChanges
        );

      if (lanePlan.clarification) {
        return respondUnchanged(
          res,
          {
            sessionId:
              session.id,

            userMessage,

            process:
              sessionAfterUserMessage.process,

            message:
              lanePlan.clarification.question,

            pending: {
              kind:
                "lane_assignment",

              targetIds:
                lanePlan.clarification.targetIds
            }
          }
        );
      }

      const finalChanges =
        lanePlan.changes;


      if (
        process.env.NODE_ENV !==
        "production"
      ) {
        console.info(
          "[workaround-check] final process changes:",
          JSON.stringify(
            finalChanges,
            null,
            2
          )
        );
      }


      // ======================================================
      // APPLY PROCESS CHANGES
      // ======================================================

      let applyResult:
        ReturnType<
          typeof applyProcessChanges
        >;

      try {
        applyResult =
          applyProcessChanges(
            sessionAfterUserMessage.process,
            finalChanges,
            userMessage
          );
      } catch (
        applyError
      ) {
        if (
          !(
            applyError instanceof
            ProcessValidationError
          )
        ) {
          throw applyError;
        }

        // The last valid process stays untouched.
        console.warn(
          "[workaround-check] process update rejected:",
          applyError.message
        );

        const rejection =
          explainRejectedUpdate(
            applyError,
            sessionAfterUserMessage.process
          );

        return respondUnchanged(
          res,
          {
            sessionId:
              session.id,

            userMessage,

            process:
              sessionAfterUserMessage.process,

            message:
              rejection.question,

            pending: {
              kind:
                "lane_assignment",

              targetIds:
                rejection.targetIds
            }
          }
        );
      }

      const {
        process:
        updatedProcess,

        processChanges
      } =
        applyResult;

      // ==================================================
      // SAVE ACTUAL AS-IS PROCESS
      // ==================================================

      const updatedSession =
        updateSessionProcess(
          session.id,
          updatedProcess
        );


      // ==================================================
      // BUILD CURRENT EMPLOYEE TRACE
      // ==================================================
      //
      // This runs after every normal employee process
      // update.
      //
      // No trace is persisted separately.
      //
      // ProcessModel remains the source of truth.
      // ==================================================

      const elicitedTrace =
        buildAndLogMainTrace(
          updatedSession.process,
          "employee-bpmn-edit"
        );

      await refreshAutomaticProcessIdentification(
        session.id,
        updatedSession.process
      );

      await refreshActivityMappings(
        session.id,
        elicitedTrace
      );

      await refreshConformanceForSession(
        session.id,
        elicitedTrace
      );


      // ======================================================
      // CONFORMANCE
      // ======================================================

      await refreshConformanceForSession(
        session.id,
        elicitedTrace
      );

      // ======================================================
      // LOAD ANALYSIS AFTER CONFORMANCE
      // ======================================================

      const analyzedSession =
        getSession(
          session.id
        );

      if (
        !analyzedSession
      ) {
        throw new Error(
          "Session disappeared after conformance analysis"
        );
      }


      // ======================================================
      // WORKAROUND CANDIDATES (PRACTICES)
      // ======================================================
      //
      // 1. every eligible deviation belongs to a practice
      // 2. grouping statements of the employee are applied
      // 3. the answer is recorded with scope and evidence
      // 4. the next question is about the shared practice
      // ======================================================

      const analysisDeviations =
        analyzedSession
          .analysis
          .deviations;

      const eligibleDeviationIds =
        new Set(
          analysisDeviations
            .filter((deviation) =>
              isDeviationEligible(
                deviation,
                analyzedSession.analysis.conformanceRuns,
                analyzedSession.analysis
                  .processIdentification
                  .stable
              )
            )
            .map((deviation) => deviation.id)
        );

      const practiceContext = {
        process:
          analyzedSession.process,

        refToId:
          applyResult.tempRefIds,

        deviations:
          analysisDeviations,

        evidence:
          practiceEvidence
      };

      let practiceState =
        syncPractices(
          analyzedSession.analysis.practices,
          analysisDeviations,
          eligibleDeviationIds
        );

      const groupingResult =
        applyPracticeHints(
          practiceState,
          analyzedSession.analysis.practiceGrouping,
          groupingHintsForAnswer(
            validated.practiceHints ?? [],
            userMessage,
            sessionAfterUserMessage.pendingQuestion
          ),
          practiceContext
        );

      practiceState =
        groupingResult.practices;

      practiceState =
        recordPracticeAnswers(
          practiceState,
          practiceAnswers,
          practiceContext,
          sessionAfterUserMessage.pendingQuestion,
          {
            redirects:
              groupingResult.grouping.redirects
          }
        );

      const practiceSchedule =
        choosePracticeQuestion({
          practices:
            practiceState,

          grouping:
            groupingResult.grouping,

          deviations:
            analysisDeviations,

          process:
            analyzedSession.process
        });

      replacePractices(
        session.id,
        practiceSchedule.practices,
        practiceSchedule.grouping
      );

      const nextInvestigationQuestion =
        practiceSchedule.question;


      // ======================================================
      // RESPONSIBILITY STATE AFTER THIS TURN
      // ======================================================

      const responsibilityPatch =
        responsibilityStatePatch(
          updatedProcess,
          responsibilityHint,
          establishedRole
        );

      const knownAskedIds =
        sessionAfterUserMessage
          .responsibility
          ?.askedActivityIds ?? [];

      const responsibilityState = {
        ...sessionAfterUserMessage.responsibility,
        ...responsibilityPatch,
        askedActivityIds:
          knownAskedIds
      };

      // Do not ask again for a responsibility that is already known.
      const redundantModelQuestion =
        isRedundantResponsibilityQuestion(
          validated.nextQuestion,
          updatedProcess,
          responsibilityState
        );

      // ======================================================
      // NORMAL LLM PENDING QUESTION
      // ======================================================

      const normalPendingQuestion:
        PendingQuestion | undefined =
        validated
          .nextQuestion
          ?.required &&
          !redundantModelQuestion
          ? {
            id:
              randomUUID(),

            kind:
              validated
                .nextQuestion
                .kind,

            targetIds:
              validated
                .nextQuestion
                .targetRefs,

            question:
              validated
                .nextQuestion
                .question
          }
          : undefined;


      // ======================================================
      // INVESTIGATION PENDING QUESTION
      // ======================================================

      const investigationPendingQuestion:
        PendingQuestion | undefined =
        nextInvestigationQuestion
          ? {
            id:
              randomUUID(),

            kind:
              nextInvestigationQuestion
                .kind,

            targetIds:
              nextInvestigationQuestion
                .targetIds,

            question:
              nextInvestigationQuestion
                .question,

            practiceId:
              nextInvestigationQuestion
                .practiceId,

            practiceField:
              nextInvestigationQuestion
                .field
          }
          : undefined;


      // ======================================================
      // RESPONSIBILITY CLARIFICATION
      // ======================================================

      const responsibilityQuestion =
        !nextInvestigationQuestion &&
          !normalPendingQuestion &&
          laneAssignmentsChanged(
            processBefore,
            updatedProcess
          )
          ? selectResponsibilityQuestion(
            updatedProcess,
            responsibilityState,
            true
          )
          : undefined;

      const responsibilityPendingQuestion:
        PendingQuestion | undefined =
        responsibilityQuestion
          ? {
            id:
              randomUUID(),

            kind:
              "lane_assignment",

            targetIds:
              responsibilityQuestion
                .targetIds,

            question:
              responsibilityQuestion
                .question
          }
          : undefined;


      // ======================================================
      // INVESTIGATION QUESTION HAS PRIORITY
      // ======================================================

      // Pending questions may only point at elements that were committed.
      const committedElementIds =
        new Set(
          updatedProcess.elements.map(
            (element) =>
              element.id
          )
        );

      const proposedPendingQuestion:
        PendingQuestion | undefined =
        investigationPendingQuestion ??
        normalPendingQuestion ??
        responsibilityPendingQuestion;

      const pendingQuestion:
        PendingQuestion | undefined =
        proposedPendingQuestion
          ? {
            ...proposedPendingQuestion,

            targetIds:
              proposedPendingQuestion
                .targetIds
                .filter(
                  (id) =>
                    committedElementIds.has(
                      id
                    )
                )
          }
          : undefined;


      // ======================================================
      // CHOOSE EMPLOYEE-FACING MESSAGE
      // ======================================================

      const rawEmployeeMessage =
        nextInvestigationQuestion
          ?.question ??
        (
          validated
            .nextQuestion
            ?.required &&
            !redundantModelQuestion
            ? validated
              .nextQuestion
              .question
            : responsibilityQuestion
              ? `${validated.assistantMessage.trim()} ${responsibilityQuestion.question}`
              : redundantModelQuestion
                ? continuationMessage(
                  validated.assistantMessage
                )
                : validated
                  .assistantMessage
        );


      const employeeAssistantMessage =
        chooseEmployeeMessage(
          rawEmployeeMessage,

          normalPendingQuestion
            ?.question
        );


      // ======================================================
      // ELICITATION PHASE
      // ======================================================

      const elicitationPhase =
        validated.intent ===
          "correction"
          ? "review"
          : sessionAfterUserMessage
            .elicitationPhase;


      // ======================================================
      // UPDATE DIALOGUE STATE
      // ======================================================

      // Remember what was asked so no activity is asked about twice.
      const askedNow =
        responsibilityQuestion
          ? responsibilityQuestion.targetIds
          : normalPendingQuestion &&
            ["actor_role", "lane_assignment"].includes(
              normalPendingQuestion.kind
            )
            ? tasksWithoutLane(updatedProcess)
              .map((task) => task.id)
            : [];

      updateSessionState(
        session.id,
        {
          elicitationPhase,

          responsibility: {
            ...responsibilityPatch,
            askedActivityIds:
              askedNow
          },

          pendingQuestion,

          lastFocusedElementIds:
            pendingQuestion
              ?.targetIds ??
            [],

          unresolvedProcessItems:
            validated
              .uncertainties
              .map(
                (
                  uncertainty
                ) =>
                  uncertainty
                    .description
              )
        }
      );

      void elicitedTrace;


      // ==================================================
      // STORE ASSISTANT MESSAGE
      // ==================================================

      addMessage(
        session.id,
        "assistant",
        employeeAssistantMessage
      );


      // ==================================================
      // INTERNAL LOGGING
      // ==================================================

      await logInteraction({
        timestamp:
          new Date()
            .toISOString(),

        sessionId:
          session.id,

        userMessage,

        assistantMessage:
          employeeAssistantMessage,

        processBefore,

        proposedChanges:
          processChanges,

        processAfter:
          updatedProcess
      });


      // ==================================================
      // BPMN
      // ==================================================

      const bpmnXml =
        generateBpmnXml(
          updatedSession.process
        );


      // ==================================================
      // EMPLOYEE RESPONSE
      // ==================================================
      //
      // NEVER RETURN:
      //
      // - ProcessChanges
      // - SessionAnalysis
      // - reference-process selection
      // - candidate rankings
      // - ActivityMapping[]
      // - ConformanceRun[]
      // - DeviationCandidate[]
      // - Investigation[]
      // - OwnerReview[]
      // - legacy workaround metadata
      // ==================================================

      return res.json({
        assistantMessage:
          employeeAssistantMessage,

        process:
          toEmployeeProcessView(
            updatedSession.process
          ),

        bpmnXml
      });
    } catch (
    error:
      unknown
    ) {
      console.error(
        "[workaround-check] MESSAGE_PROCESSING_FAILED"
      );

      console.error(
        error
      );

      const details =
        error instanceof
          Error
          ? error.message
          : String(
            error
          );

      console.error(
        "[workaround-check] Details:",
        details
      );

      if (
        error instanceof
        ProcessValidationError
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              details,

            details
          });
      }

      return res
        .status(
          500
        )
        .json({
          error:
            process.env
              .NODE_ENV !==
              "production"
              ? `Failed to process message: ${details}`
              : "Failed to process message",

          details
        });
    }
  }
);


// ======================================================
// EMPLOYEE
// MANUALLY UPDATE BPMN / PROCESS MODEL
// ======================================================
//
// BPMN editing can also change the AS-IS process.
//
// Therefore the derived trace is rebuilt here as well.
// ======================================================

app.put(
  "/api/employee/sessions/:id/process",
  async (
    req,
    res
  ) => {
    try {
      const session =
        getSession(
          req.params.id
        );

      if (
        !session
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Session not found"
          });
      }

      const employeeProcess =
        req.body?.process as
        | EmployeeProcessView
        | undefined;

      if (
        !employeeProcess
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "Missing process"
          });
      }

      if (
        employeeProcess.id !==
        session.process.id
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "Process ID does not match session"
          });
      }

      const mergedProcess =
        mergeEmployeeProcessView(
          session.process,
          employeeProcess
        );

      validateProcessModel(
        mergedProcess
      );

      const updatedSession =
        updateSessionProcess(
          session.id,
          mergedProcess
        );


      // ==================================================
      // REBUILD DERIVED TRACE
      // ==================================================

      const elicitedTrace =
        buildAndLogMainTrace(
          updatedSession.process,
          "employee-bpmn-edit"
        );

      await refreshActivityMappings(
        session.id,
        elicitedTrace
      );

      await refreshConformanceForSession(
        session.id,
        elicitedTrace
      );


      // ==================================================
      // TODO:
      // WHEN CONFORMANCE PIPELINE EXISTS
      // ==================================================
      //
      // A semantic BPMN edit must also trigger:
      //
      // Activity Mapping
      // -> Prefix TBR / Alignment
      // -> updated deviations
      // ==================================================

      const bpmnXml =
        generateBpmnXml(
          updatedSession.process
        );

      return res.json({
        process:
          toEmployeeProcessView(
            updatedSession.process
          ),

        bpmnXml
      });
    } catch (
    error:
      unknown
    ) {
      console.error(
        "[employee:update-process]",
        error
      );

      const details =
        error instanceof
          Error
          ? error.message
          : String(
            error
          );

      if (
        error instanceof
        ProcessValidationError
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              details,

            details
          });
      }

      return res
        .status(
          400
        )
        .json({
          error:
            details
        });
    }
  }
);


// ======================================================
// OWNER
// LIST REFERENCE PROCESSES
// ======================================================

app.get(
  "/api/owner/reference-processes",
  async (
    _req,
    res
  ) => {
    try {
      const referenceProcesses =
        await listReferenceProcesses();

      const sessions =
        listSessions();

      // --------------------------------------------------
      // Add runtime aggregation.
      //
      // These values do not belong in the filesystem
      // repository itself.
      // --------------------------------------------------

      const processes =
        referenceProcesses.map(
          (
            reference
          ) => {
            const assignedSessions =
              sessions.filter(
                (
                  session
                ) =>
                  session.analysis
                    .processIdentification
                    .selectedReferenceProcessId ===
                  reference.id
              );

            const openDeviationCount =
              assignedSessions
                .flatMap(
                  (
                    session
                  ) =>
                    session.analysis
                      .deviations
                )
                .filter(
                  (
                    deviation
                  ) =>
                    deviation
                      .referenceProcessId ===
                    reference.id &&
                    deviation.status !==
                    "reviewed"
                )
                .length;

            return {
              ...reference,

              assignedSessionCount:
                assignedSessions.length,

              openDeviationCount
            };
          }
        );

      return res.json({
        processes
      });
    } catch (
    error
    ) {
      console.error(
        "[owner:list-reference-processes]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            "Failed to load reference processes"
        });
    }
  }
);


// ======================================================
// OWNER
// CREATE REFERENCE PROCESS
// ======================================================

app.post(
  "/api/owner/reference-processes",
  async (
    req,
    res
  ) => {
    try {
      const name =
        req.body?.name;

      if (
        typeof name !==
        "string" ||
        !name.trim()
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "name must be a non-empty string"
          });
      }

      const aliases =
        readOptionalStringArray(
          req.body?.aliases
        );

      if (
        req.body?.aliases !==
        undefined &&
        aliases ===
        undefined
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "aliases must be an array of strings"
          });
      }

      const rawDescription =
        req.body?.description;

      if (
        rawDescription !==
        undefined &&
        typeof rawDescription !==
        "string"
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "description must be a string"
          });
      }

      const created =
        await createReferenceProcess({
          name:
            name.trim(),

          aliases:
            aliases ??
            [],

          description:
            typeof rawDescription ===
              "string" &&
              rawDescription.trim()
              ? rawDescription.trim()
              : undefined
        });

      return res
        .status(
          201
        )
        .json(
          created
        );
    } catch (
    error
    ) {
      console.error(
        "[owner:create-reference-process]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            error instanceof
              Error
              ? error.message
              : "Failed to create reference process"
        });
    }
  }
);


// ======================================================
// OWNER
// GET ONE REFERENCE PROCESS
// ======================================================

app.get(
  "/api/owner/reference-processes/:id",
  async (
    req,
    res
  ) => {
    try {
      const reference =
        await getReferenceProcess(
          req.params.id
        );

      if (
        !reference
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Reference process not found"
          });
      }

      return res.json(
        reference
      );
    } catch (
    error
    ) {
      console.error(
        "[owner:get-reference-process]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            "Failed to load reference process"
        });
    }
  }
);


// ======================================================
// OWNER
// UPDATE REFERENCE PROCESS METADATA
// ======================================================

app.patch(
  "/api/owner/reference-processes/:id",
  async (
    req,
    res
  ) => {
    try {
      const existing =
        await getReferenceProcess(
          req.params.id
        );

      if (
        !existing
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Reference process not found"
          });
      }

      const rawName =
        req.body?.name;

      if (
        rawName !==
        undefined &&
        (
          typeof rawName !==
          "string" ||
          !rawName.trim()
        )
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "name must be a non-empty string"
          });
      }

      const aliases =
        readOptionalStringArray(
          req.body?.aliases
        );

      if (
        req.body?.aliases !==
        undefined &&
        aliases ===
        undefined
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "aliases must be an array of strings"
          });
      }

      const rawDescription =
        req.body?.description;

      if (
        rawDescription !==
        undefined &&
        typeof rawDescription !==
        "string"
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "description must be a string"
          });
      }

      const rawActive =
        req.body?.active;

      if (
        rawActive !==
        undefined &&
        typeof rawActive !==
        "boolean"
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "active must be a boolean"
          });
      }

      const updated =
        await updateReferenceMetadata(
          req.params.id,
          {
            name:
              typeof rawName ===
                "string"
                ? rawName.trim()
                : undefined,

            aliases,

            description:
              typeof rawDescription ===
                "string"
                ? rawDescription.trim()
                : undefined,

            active:
              typeof rawActive ===
                "boolean"
                ? rawActive
                : undefined
          }
        );

      return res.json(
        updated
      );
    } catch (
    error
    ) {
      console.error(
        "[owner:update-reference-metadata]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            error instanceof
              Error
              ? error.message
              : "Failed to update reference process"
        });
    }
  }
);
// ======================================================
// OWNER
// DELETE REFERENCE PROCESS
// ======================================================

app.delete(
  "/api/owner/reference-processes/:id",
  async (
    req,
    res
  ) => {
    try {
      const referenceProcessId =
        req.params.id;


      // ==================================================
      // REFERENCE MUST EXIST
      // ==================================================

      const reference =
        await getReferenceProcess(
          referenceProcessId
        );

      if (
        !reference
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Reference process not found"
          });
      }


      // ==================================================
      // PROTECT EXISTING SESSION REFERENCES
      // ==================================================
      //
      // Do not leave:
      //
      // Session
      // -> selectedReferenceProcessId
      // -> deleted reference process
      //
      // A process must first be unassigned/reassigned.
      // ==================================================

      const assignedSessions =
        listSessions()
          .filter(
            (
              session
            ) =>
              session.analysis
                .processIdentification
                .selectedReferenceProcessId ===
              referenceProcessId
          );


      if (
        assignedSessions.length >
        0
      ) {
        return res
          .status(
            409
          )
          .json({
            error:
              assignedSessions.length ===
                1
                ? "The reference process cannot be deleted because an employee session is still assigned to it."
                : `The reference process cannot be deleted because ${assignedSessions.length} employee sessions are still assigned to it.`,

            assignedSessionCount:
              assignedSessions.length
          });
      }


      // ==================================================
      // HARD DELETE
      // ==================================================

      await deleteReferenceProcess(
        referenceProcessId
      );


      return res.json({
        deletedReferenceProcessId:
          referenceProcessId
      });
    } catch (
    error:
      unknown
    ) {
      console.error(
        "[owner:delete-reference-process]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            error instanceof
              Error
              ? error.message
              : "Failed to delete reference process"
        });
    }
  }
);

// ======================================================
// OWNER
// SAVE NEW REFERENCE PROCESS VERSION
// ======================================================

app.put(
  "/api/owner/reference-processes/:id/process",
  async (
    req,
    res
  ) => {
    try {
      const existing =
        await getReferenceProcess(
          req.params.id
        );

      if (
        !existing
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Reference process not found"
          });
      }

      const process =
        req.body?.process as
        | ProcessModel
        | undefined;

      if (
        !process
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "Missing process"
          });
      }

      const cleanReferenceProcess:
        ProcessModel = {
        ...structuredClone(
          process
        ),

        // ----------------------------------------------
        // Reference processes contain no employee
        // workaround classifications.
        // ----------------------------------------------

        workarounds:
          [],

        elements:
          process.elements
            .map(
              (
                element
              ) => {
                if (
                  element.type !==
                  "task"
                ) {
                  return {
                    ...element
                  };
                }

                const {
                  workaroundCandidate:
                  _candidate,

                  workaroundConfirmed:
                  _confirmed,

                  workaroundReason:
                  _reason,

                  workaroundCategory:
                  _category,

                  ...cleanTask
                } =
                  element;

                return cleanTask;
              }
            )
      };

      validateProcessModel(
        cleanReferenceProcess
      );

      const updated =
        await saveReferenceProcessVersion(
          req.params.id,
          cleanReferenceProcess
        );

      return res.json(
        updated
      );
    } catch (
    error:
      unknown
    ) {
      console.error(
        "[owner:save-reference-process-version]",
        error
      );

      const details =
        error instanceof
          Error
          ? error.message
          : String(
            error
          );

      if (
        error instanceof
        ProcessValidationError
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              details,

            details
          });
      }

      return res
        .status(
          500
        )
        .json({
          error:
            details
        });
    }
  }
);


// ======================================================
// OWNER
// REFERENCE PROCESS OVERVIEW
// ======================================================

app.get(
  "/api/owner/reference-processes/:id/overview",
  async (
    req,
    res
  ) => {
    try {
      const referenceProcessId =
        req.params.id;

      const referenceProcess =
        await getReferenceProcess(
          referenceProcessId
        );

      if (
        !referenceProcess
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Reference process not found."
          });
      }


      // ==================================================
      // CURRENTLY ASSIGNED SESSIONS
      // ==================================================

      const assignedSessions =
        listSessions()
          .filter(
            (
              session
            ) =>
              session.analysis
                .processIdentification
                .selectedReferenceProcessId ===
              referenceProcessId
          );


      // ==================================================
      // SESSION SUMMARIES
      // ==================================================

      const sessionSummaries =
        assignedSessions
          .map(
            (
              session
            ) => {
              const identification =
                session.analysis
                  .processIdentification;

              // ------------------------------------------
              // Count only deviations that actually
              // belong to this reference process.
              // ------------------------------------------

              const deviations =
                session.analysis
                  .deviations
                  .filter(
                    (
                      deviation
                    ) =>
                      deviation
                        .referenceProcessId ===
                      referenceProcessId
                  );

              // ------------------------------------------
              // information_complete is still awaiting
              // Owner classification.
              // ------------------------------------------

              const openDeviations =
                deviations.filter(
                  (
                    deviation
                  ) =>
                    deviation.status !==
                    "reviewed"
                );

              return {
                sessionId:
                  session.id,

                processName:
                  session.process
                    .name,

                referenceProcessVersion:
                  identification
                    .selectedReferenceProcessVersion,

                identificationStatus:
                  identification.status,

                identificationConfidence:
                  identification
                    .confidence,

                deviationCount:
                  deviations.length,

                openDeviationCount:
                  openDeviations.length,

                updatedAt:
                  session.updatedAt
              };
            }
          );


      // ==================================================
      // RESPONSE
      // ==================================================

      return res.json({
        referenceProcessId,

        name:
          referenceProcess
            .metadata
            .name,

        currentVersion:
          referenceProcess
            .metadata
            .currentVersion,

        active:
          referenceProcess
            .metadata
            .active,

        sessionCount:
          sessionSummaries.length,

        openDeviationCount:
          sessionSummaries.reduce(
            (
              total,
              session
            ) =>
              total +
              session
                .openDeviationCount,
            0
          ),

        sessions:
          sessionSummaries
      });
    } catch (
    error
    ) {
      console.error(
        "[owner:reference-overview]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            "Reference process overview could not be loaded."
        });
    }
  }
);


// ======================================================
// OWNER
// LIST EMPLOYEE SESSIONS
// ======================================================
//
// Required by OwnerView.tsx.
//
// This endpoint intentionally returns a compact Owner
// summary instead of every message / BPMN model.
// ======================================================

app.get(
  "/api/owner/sessions",
  (
    _req,
    res
  ) => {
    try {
      const sessions =
        listSessions()
          .map(
            (
              session
            ) => {
              const identification =
                session.analysis
                  .processIdentification;

              const deviations =
                session.analysis
                  .deviations;

              return {
                sessionId:
                  session.id,

                processName:
                  session.process
                    .name,

                updatedAt:
                  session.updatedAt,

                identificationStatus:
                  identification.status,

                selectedReferenceProcessId:
                  identification
                    .selectedReferenceProcessId,

                selectedReferenceProcessVersion:
                  identification
                    .selectedReferenceProcessVersion,

                identificationConfidence:
                  identification
                    .confidence,

                deviationCount:
                  deviations.length,

                openDeviationCount:
                  deviations
                    .filter(
                      (
                        deviation
                      ) =>
                        deviation.status !==
                        "reviewed"
                    )
                    .length
              };
            }
          );

      return res.json({
        sessions
      });
    } catch (
    error
    ) {
      console.error(
        "[owner:list-sessions]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            "Failed to load employee sessions"
        });
    }
  }
);


// ======================================================
// OWNER
// MANUALLY ASSIGN REFERENCE PROCESS TO SESSION
// ======================================================

app.post(
  "/api/owner/sessions/:id/reference-process",
  async (
    req,
    res
  ) => {
    try {
      const session =
        getSession(
          req.params.id
        );

      if (
        !session
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Session not found"
          });
      }

      const referenceProcessId =
        req.body
          ?.referenceProcessId;

      if (
        typeof referenceProcessId !==
        "string" ||
        !referenceProcessId.trim()
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "referenceProcessId must be a non-empty string"
          });
      }

      const reference =
        await getReferenceProcess(
          referenceProcessId
            .trim()
        );

      if (
        !reference
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Reference process not found"
          });
      }

      const previousIdentification =
        session.analysis
          .processIdentification;

      const nextReferenceId =
        reference.metadata.id;

      const nextReferenceVersion =
        reference.metadata
          .currentVersion;


      // ==================================================
      // DID REFERENCE PROCESS OR VERSION CHANGE?
      // ==================================================

      const referenceChanged =
        previousIdentification
          .selectedReferenceProcessId !==
        undefined &&
        (
          previousIdentification
            .selectedReferenceProcessId !==
          nextReferenceId ||

          previousIdentification
            .selectedReferenceProcessVersion !==
          nextReferenceVersion
        );


      // ==================================================
      // RESET OLD UNREVIEWED CONFORMANCE ANALYSIS
      // ==================================================

      if (
        referenceChanged
      ) {
        resetUnreviewedConformanceAnalysis(
          session.id
        );
      }


      // ==================================================
      // OWNER OVERRIDE
      // ==================================================

      const timestamp =
        new Date()
          .toISOString();

      const activityCount =
        countTasks(
          session.process
        );

      updateProcessIdentification(
        session.id,
        {
          ...previousIdentification,

          status:
            "selected",

          selectedReferenceProcessId:
            nextReferenceId,

          selectedReferenceProcessVersion:
            nextReferenceVersion,

          selectedReferenceModelHash:
            reference
              .currentVersion
              .modelHash,

          selectedBy:
            "owner",

          lockedByOwner:
            true,

          stable:
            true,

          confidence:
            1,

          marginToSecondCandidate:
            previousIdentification
              .marginToSecondCandidate,

          selectedAtActivityCount:
            activityCount,

          lastEvaluatedAt:
            timestamp,

          history: [
            ...previousIdentification
              .history,

            {
              timestamp,

              activityCount,

              candidates:
                structuredClone(
                  previousIdentification
                    .candidates
                ),

              selectedReferenceProcessId:
                nextReferenceId,

              selectedReferenceProcessVersion:
                nextReferenceVersion,

              reason:
                "owner_override"
            }
          ]
        }
      );


      // ==================================================
      // BUILD TRACE IMMEDIATELY
      // ==================================================
      //
      // The reference is now known.
      //
      // This is therefore the ideal point to run a fresh
      // conformance analysis once Activity Mapping and the
      // conformance engine exist.
      // ==================================================

      const elicitedTrace =
        buildAndLogMainTrace(
          session.process,
          "owner-reference-assignment"
        );

      await refreshActivityMappings(
        session.id,
        elicitedTrace
      );

      await refreshConformanceForSession(
        session.id,
        elicitedTrace
      );


      // ==================================================
      // TODO:
      // RUN CONFORMANCE IMMEDIATELY
      // ==================================================
      //
      // Next:
      //
      // const mappings =
      //   mapActivities(
      //     elicitedTrace,
      //     reference.currentVersion.process
      //   );
      //
      // if (elicitedTrace.complete) {
      //   runAlignment(...)
      // } else {
      //   runPrefixReplay(...)
      // }
      //
      // Then persist:
      //
      // ActivityMapping[]
      // ConformanceRun
      // DeviationCandidate[]
      // ==================================================


      // ==================================================
      // RETURN UPDATED OWNER SESSION
      // ==================================================

      const updatedSession =
        getSession(
          session.id
        );

      if (
        !updatedSession
      ) {
        throw new Error(
          "Session disappeared unexpectedly"
        );
      }

      const bpmnXml =
        generateBpmnXml(
          updatedSession.process
        );

      return res.json(
        toOwnerSessionView(
          updatedSession,
          bpmnXml
        )
      );
    } catch (
    error
    ) {
      console.error(
        "[owner:assign-reference-process]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            error instanceof
              Error
              ? error.message
              : "Failed to assign reference process"
        });
    }
  }
);


// ======================================================
// OWNER
// GET COMPLETE SESSION
// ======================================================

app.get(
  "/api/owner/sessions/:id",
  (
    req,
    res
  ) => {
    try {
      const session =
        getSession(
          req.params.id
        );

      if (
        !session
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Session not found"
          });
      }

      const bpmnXml =
        generateBpmnXml(
          session.process
        );

      return res.json(
        toOwnerSessionView(
          session,
          bpmnXml
        )
      );
    } catch (
    error:
      unknown
    ) {
      console.error(
        "[owner:get-session]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            "Failed to load owner session"
        });
    }
  }
);


// ======================================================
// OWNER
// REVIEW DEVIATION
// ======================================================

app.patch(
  "/api/owner/sessions/:id/deviations/:deviationId",
  (
    req,
    res
  ) => {
    try {
      const session =
        getSession(
          req.params.id
        );

      if (
        !session
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Session not found"
          });
      }

      const deviation =
        session.analysis
          .deviations
          .find(
            (
              candidate
            ) =>
              candidate.id ===
              req.params
                .deviationId
          );

      if (
        !deviation
      ) {
        return res
          .status(
            404
          )
          .json({
            error:
              "Deviation not found"
          });
      }

      const decision =
        req.body?.decision;

      if (
        !isOwnerReviewDecision(
          decision
        )
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "Invalid owner review decision",

            allowedValues:
              OWNER_REVIEW_DECISIONS
          });
      }

      const rawComment =
        req.body?.comment;

      if (
        rawComment !==
        undefined &&
        typeof rawComment !==
        "string"
      ) {
        return res
          .status(
            400
          )
          .json({
            error:
              "comment must be a string"
          });
      }

      const comment =
        typeof rawComment ===
          "string"
          ? rawComment.trim()
          : undefined;

      const existingReview =
        session.analysis
          .ownerReviews
          .find(
            (
              review
            ) =>
              review.deviationId ===
              deviation.id
          );

      const updatedSession =
        upsertOwnerReview(
          session.id,
          {
            id:
              existingReview?.id ??
              randomUUID(),

            deviationId:
              deviation.id,

            decision,

            ...(comment
              ? {
                comment
              }
              : {}),

            reviewedAt:
              new Date()
                .toISOString()
          }
        );

      const bpmnXml =
        generateBpmnXml(
          updatedSession.process
        );

      return res.json(
        toOwnerSessionView(
          updatedSession,
          bpmnXml
        )
      );
    } catch (
    error:
      unknown
    ) {
      console.error(
        "[owner:review-deviation]",
        error
      );

      return res
        .status(
          500
        )
        .json({
          error:
            error instanceof
              Error
              ? error.message
              : "Failed to update owner review"
        });
    }
  }
);