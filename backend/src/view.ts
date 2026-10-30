import {
  type ChatMessage,
  type InterviewSession,
  type Lane,
  type MessageFlow,
  type Participant,
  type ProcessElement,
  type ProcessModel,
  type SequenceFlow,
  type SessionAnalysis
} from "./types.js";

import {
  practiceInvestigations
} from "./analysis/practices.js";

// ======================================================
// EMPLOYEE PROCESS TYPES
// ======================================================
//
// The employee must not receive internal workaround
// classification information.
//
// Therefore the employee-facing task type does not even
// contain the legacy workaround properties.
// ======================================================

type ProcessTask = Extract<
  ProcessElement,
  { type: "task" }
>;

export type EmployeeTask = Omit<
  ProcessTask,
  | "workaroundCandidate"
  | "workaroundConfirmed"
  | "workaroundReason"
  | "workaroundCategory"
>;

export type EmployeeProcessElement =
  | Exclude<
      ProcessElement,
      ProcessTask
    >
  | EmployeeTask;

// ======================================================
// EMPLOYEE PROCESS VIEW
// ======================================================

export type EmployeeProcessView = {
  id: string;

  name: string;

  /**
   * The employee does not need to know internal review
   * states such as "review".
   */
  status:
    | "eliciting"
    | "complete";

  participants: Participant[];

  lanes: Lane[];

  elements: EmployeeProcessElement[];

  flows: SequenceFlow[];

  messageFlows: MessageFlow[];

  /**
   * Intentionally NO:
   *
   * workarounds
   * deviations
   * analysis
   */
  updatedAt: string;
};

// ======================================================
// EMPLOYEE PROCESS PROJECTION
// ======================================================

export function toEmployeeProcessView(
  process: ProcessModel
): EmployeeProcessView {
  const elements:
    EmployeeProcessElement[] =
    process.elements.map(
      (
        element
      ): EmployeeProcessElement => {
        // ----------------------------------------------
        // Non-task elements contain no workaround
        // classification and may be copied directly.
        // ----------------------------------------------

        if (
          element.type !== "task"
        ) {
          return {
            ...element
          };
        }

        // ----------------------------------------------
        // Task
        // ----------------------------------------------
        //
        // Explicitly construct the employee-facing task.
        //
        // Do NOT spread the complete task object here,
        // otherwise legacy workaround fields could leak
        // into the API response.
        // ----------------------------------------------

        const employeeTask:
          EmployeeTask = {
          id:
            element.id,

          type:
            "task",

          name:
            element.name,

          ...(element.participantId
            ? {
                participantId:
                  element.participantId
              }
            : {}),

          ...(element.laneId
            ? {
                laneId:
                  element.laneId
              }
            : {}),

          ...(element.performer
            ? {
                performer:
                  element.performer
              }
            : {}),

          ...(element.system
            ? {
                system:
                  element.system
              }
            : {}),

          ...(element.executionType
            ? {
                executionType:
                  element.executionType
              }
            : {}),

          ...(element.employeeConfirmed !==
          undefined
            ? {
                employeeConfirmed:
                  element.employeeConfirmed
              }
            : {})
        };

        return employeeTask;
      }
    );

  return {
    id:
      process.id,

    name:
      process.name,

    status:
      process.status ===
      "confirmed"
        ? "complete"
        : "eliciting",

    participants:
      process.participants.map(
        (participant) => ({
          ...participant
        })
      ),

    lanes:
      process.lanes.map(
        (lane) => ({
          ...lane
        })
      ),

    elements,

    flows:
      process.flows.map(
        (flow) => ({
          ...flow
        })
      ),

    messageFlows:
      process.messageFlows.map(
        (flow) => ({
          ...flow
        })
      ),

    updatedAt:
      process.updatedAt
  };
}
// ======================================================
// MERGE EMPLOYEE PROCESS BACK INTO INTERNAL PROCESS
// ======================================================
//
// The employee receives only a sanitized process model.
//
// When the employee manually edits the BPMN, the returned
// EmployeeProcessView must therefore be merged into the
// internal ProcessModel.
//
// Internal information such as workaround metadata must
// never be overwritten or deleted simply because the
// employee-facing representation does not contain it.
// ======================================================

export function mergeEmployeeProcessView(
  current: ProcessModel,
  employee: EmployeeProcessView
): ProcessModel {
  // ----------------------------------------------------
  // EXISTING ELEMENTS
  // ----------------------------------------------------

  const previousElementsById =
    new Map(
      current.elements.map(
        (element) => [
          element.id,
          element
        ]
      )
    );

  // ----------------------------------------------------
  // MERGE PROCESS ELEMENTS
  // ----------------------------------------------------

  const elements:
    ProcessElement[] =
    employee.elements.map(
      (element): ProcessElement => {
        // ----------------------------------------------
        // Non-task elements contain no workaround
        // metadata.
        // ----------------------------------------------

        if (
          element.type !== "task"
        ) {
          return {
            ...element
          };
        }

        // ----------------------------------------------
        // Existing task
        // ----------------------------------------------

        const previousElement =
          previousElementsById.get(
            element.id
          );

        const previousTask =
          previousElement?.type ===
          "task"
            ? previousElement
            : undefined;

        /**
         * Employee-visible properties come from the
         * edited BPMN.
         *
         * Internal workaround properties are restored
         * from the previous internal ProcessModel.
         */
        return {
          ...element,

          ...(previousTask
            ?.workaroundCandidate !==
          undefined
            ? {
                workaroundCandidate:
                  previousTask
                    .workaroundCandidate
              }
            : {}),

          ...(previousTask
            ?.workaroundConfirmed !==
          undefined
            ? {
                workaroundConfirmed:
                  previousTask
                    .workaroundConfirmed
              }
            : {}),

          ...(previousTask
            ?.workaroundReason !==
          undefined
            ? {
                workaroundReason:
                  previousTask
                    .workaroundReason
              }
            : {}),

          ...(previousTask
            ?.workaroundCategory !==
          undefined
            ? {
                workaroundCategory:
                  previousTask
                    .workaroundCategory
              }
            : {})
        };
      }
    );

  // ----------------------------------------------------
  // CURRENT TASK IDS
  // ----------------------------------------------------
  //
  // If the employee really deletes a task from the BPMN,
  // internal workaround references to that task must also
  // be removed.
  // ----------------------------------------------------

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

  // ----------------------------------------------------
  // PRESERVE INTERNAL WORKAROUNDS
  // ----------------------------------------------------

  const workarounds =
    current.workarounds.map(
      (workaround) => ({
        ...workaround,

        relatedActivityIds:
          workaround
            .relatedActivityIds
            .filter(
              (activityId) =>
                existingTaskIds.has(
                  activityId
                )
            )
      })
    );

  // ----------------------------------------------------
  // BUILD COMPLETE INTERNAL PROCESS MODEL
  // ----------------------------------------------------

  return {
    /**
     * Start with the complete internal process.
     *
     * This preserves every field that is intentionally
     * invisible to the employee.
     */
    ...current,

    /**
     * Employee-editable process properties.
     */
    name:
      employee.name,

    participants:
      employee.participants.map(
        (participant) => ({
          ...participant
        })
      ),

    lanes:
      employee.lanes.map(
        (lane) => ({
          ...lane
        })
      ),

    elements,

    flows:
      employee.flows.map(
        (flow) => ({
          ...flow
        })
      ),

    messageFlows:
      employee.messageFlows.map(
        (flow) => ({
          ...flow
        })
      ),

    /**
     * Internal information is explicitly retained.
     */
    workarounds,

    /**
     * Do NOT use employee.status here.
     *
     * The internal process lifecycle remains controlled
     * by the backend.
     */
    status:
      current.status,

    updatedAt:
      new Date()
        .toISOString()
  };
}
// ======================================================
// EMPLOYEE SESSION VIEW
// ======================================================
//
// Useful for:
//
// GET /api/employee/sessions/:id
//
// The employee receives conversation + AS-IS process,
// but absolutely no internal analysis.
// ======================================================

export type EmployeeSessionView = {
  sessionId: string;

  messages: ChatMessage[];

  process: EmployeeProcessView;

  elicitationPhase:
    InterviewSession["elicitationPhase"];

  pendingQuestion?:
    InterviewSession["pendingQuestion"];

  createdAt: string;

  updatedAt: string;

  bpmnXml: string;
};

// ======================================================
// EMPLOYEE SESSION PROJECTION
// ======================================================

export function toEmployeeSessionView(
  session: InterviewSession,
  bpmnXml: string
): EmployeeSessionView {
  const result:
    EmployeeSessionView = {
    sessionId:
      session.id,

    messages:
      session.messages.map(
        (message) => ({
          ...message
        })
      ),

    process:
      toEmployeeProcessView(
        session.process
      ),

    elicitationPhase:
      session.elicitationPhase,

    createdAt:
      session.createdAt,

    updatedAt:
      session.updatedAt,

    bpmnXml
  };

  if (
    session.pendingQuestion
  ) {
    result.pendingQuestion = {
      ...session.pendingQuestion,

      targetIds: [
        ...session.pendingQuestion
          .targetIds
      ]
    };
  }

  return result;
}

// ======================================================
// OWNER SESSION VIEW
// ======================================================
//
// The Process Owner receives the complete internal
// representation.
//
// This includes:
//
// - full ProcessModel
// - workaround candidates
// - process identification
// - deviations
// - investigations
// - owner reviews
// - employee conversation
// ======================================================

export type OwnerSessionView = {
  sessionId: string;

  process: ProcessModel;

  analysis: SessionAnalysis;

  messages: ChatMessage[];

  createdAt: string;

  updatedAt: string;

  bpmnXml: string;
};

// ======================================================
// OWNER SESSION PROJECTION
// ======================================================

export function toOwnerSessionView(
  session: InterviewSession,
  bpmnXml: string
): OwnerSessionView {
  return {
    sessionId:
      session.id,

    process:
      structuredClone(
        session.process
      ),

    analysis: {
      ...structuredClone(
        session.analysis
      ),

      // Shared answers of a practice, shown per deviation.
      investigations:
        practiceInvestigations(
          session.analysis.practices,
          session.analysis.deviations
        )
    },

    messages:
      session.messages.map(
        (message) => ({
          ...message
        })
      ),

    createdAt:
      session.createdAt,

    updatedAt:
      session.updatedAt,

    bpmnXml
  };
}
import express from "express";
import cors from "cors";
import { generateBpmnXml } from "./bpmn.js";
import { logInteraction } from "./logging.js";
import { proposeProcessChanges } from "./openai.js";
import { applyProcessChanges, ProcessValidationError } from "./process.js";
import { llmProcessResponseSchema } from "./schemas.js";
import { addMessage, createSession, getSession, updateSessionProcess, updateSessionState } from "./store.js";

export const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.post("/api/sessions", (_req, res) => {
  const session = createSession();
  const bpmnXml = generateBpmnXml(session.process);

  res.status(201).json({
    session: {
      ...session,
      bpmnXml
    }
  });
});

app.get("/api/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const bpmnXml = generateBpmnXml(session.process);

  return res.json({
    session: {
      ...session,
      bpmnXml
    }
  });
});

app.post("/api/sessions/:id/message", async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message must be a non-empty string" });
  }

  const userMessage = message.trim();
  addMessage(session.id, "employee", userMessage);

  const sessionAfterUserMessage = getSession(session.id);
  if (!sessionAfterUserMessage) {
    return res.status(500).json({ error: "Session disappeared unexpectedly" });
  }

  const processBefore = JSON.parse(JSON.stringify(sessionAfterUserMessage.process));

  try {
    const llmResponse = await proposeProcessChanges({
      userMessage,
      messages: sessionAfterUserMessage.messages,
      processModel: sessionAfterUserMessage.process,
      elicitationPhase: sessionAfterUserMessage.elicitationPhase,
      pendingQuestion: sessionAfterUserMessage.pendingQuestion
    });

    const validated = llmProcessResponseSchema.parse(llmResponse);
    console.log(
      "[workaround-check] LLM changes:",
      JSON.stringify(
        validated.changes,
        null,
        2
      )
    );
    const { process, processChanges } = applyProcessChanges(
      sessionAfterUserMessage.process,
      validated.changes,
      userMessage
    );
    console.log(
      "[workaround-check] Process organization:",
      JSON.stringify(
        {
          participants:
            process.participants,

          lanes:
            process.lanes,

          elements:
            process.elements.map(
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

                ...(
                  element.type === "task"
                    ? {
                      performer:
                        element.performer,

                      system:
                        element.system,

                      executionType:
                        element.executionType
                    }
                    : {}
                )
              })
            ),

          messageFlows:
            process.messageFlows
        },
        null,
        2
      )
    );

    const pendingQuestion = validated.nextQuestion?.required
      ? {
        id: `question_${Date.now()}`,
        kind: validated.nextQuestion.kind,
        targetIds: validated.nextQuestion.targetRefs,
        question: validated.nextQuestion.question
      }
      : undefined;

    const elicitationPhase =
      validated.intent === "workaround_detail"
        ? "workarounds"
        : validated.intent === "correction"
          ? "review"
          : sessionAfterUserMessage.elicitationPhase;

    updateSessionState(session.id, {
      elicitationPhase,
      pendingQuestion,
      lastFocusedElementIds: validated.nextQuestion?.targetRefs ?? [],
      unresolvedProcessItems: validated.uncertainties.map((uncertainty) => uncertainty.description)
    });

    const updatedSession = updateSessionProcess(session.id, process);
    addMessage(session.id, "assistant", validated.assistantMessage);

    await logInteraction({
      timestamp: new Date().toISOString(),
      sessionId: session.id,
      userMessage,
      assistantMessage: validated.assistantMessage,
      processBefore,
      proposedChanges: processChanges,
      processAfter: process
    });

    const bpmnXml = generateBpmnXml(process);

    return res.json({
      assistantMessage: validated.assistantMessage,
      process: updatedSession.process,
      processChanges,
      bpmnXml
    });
  } catch (error: unknown) {
    console.error(
      "[workaround-check] MESSAGE_PROCESSING_FAILED"
    );

    console.error(error);

    const details =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "[workaround-check] Details:",
      details
    );

    if (error instanceof ProcessValidationError) {
      return res.status(400).json({
        error: details,
        details
      });
    }

    return res.status(500).json({
      // During development expose the actual reason
      // so the frontend shows it immediately.
      error:
        process.env.NODE_ENV !== "production"
          ? `Failed to process message: ${details}`
          : "Failed to process message",

      details
    });
  }
});
