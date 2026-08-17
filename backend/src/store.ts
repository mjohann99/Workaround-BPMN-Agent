import { v4 as uuidv4 } from "uuid";
import { createInitialProcess } from "./process.js";
import { type ChatMessage, type InterviewSession, type PendingQuestion } from "./types.js";

const sessions = new Map<string, InterviewSession>();

function nowIso(): string {
  return new Date().toISOString();
}

export function createSession(): InterviewSession {
  const timestamp = nowIso();
  const sessionId = uuidv4();

  const session: InterviewSession = {
    id: sessionId,
    messages: [
      {
        id: uuidv4(),
        role: "assistant",
        content: "Let's reconstruct how you actually perform this process. What triggers the process?",
        timestamp
      }
    ],
    process: createInitialProcess("Interviewed AS-IS Process"),
    elicitationPhase: "scope",
    pendingQuestion: {
      id: `question_${sessionId}`,
      kind: "clarification",
      targetIds: [],
      question: "What triggers the process?"
    },
    lastFocusedElementIds: [],
    unresolvedProcessItems: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };

  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): InterviewSession | undefined {
  return sessions.get(sessionId);
}

export function addMessage(
  sessionId: string,
  role: ChatMessage["role"],
  content: string
): InterviewSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  session.messages.push({
    id: uuidv4(),
    role,
    content,
    timestamp: nowIso()
  });
  session.updatedAt = nowIso();

  sessions.set(sessionId, session);
  return session;
}

export function updateSessionProcess(sessionId: string, process: InterviewSession["process"]): InterviewSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  session.process = process;
  session.updatedAt = nowIso();
  sessions.set(sessionId, session);

  return session;
}

export function updateSessionState(
  sessionId: string,
  updates: Partial<Pick<InterviewSession, "elicitationPhase" | "pendingQuestion" | "lastFocusedElementIds" | "unresolvedProcessItems">>
): InterviewSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  Object.assign(session, updates);
  session.updatedAt = nowIso();
  sessions.set(sessionId, session);
  return session;
}

export function clearSessions(): void {
  sessions.clear();
}
