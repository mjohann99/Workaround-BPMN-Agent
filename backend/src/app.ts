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
