import { type InterviewSession, type PostMessageResponse } from "./types";

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      // Ignore JSON parsing errors and keep fallback message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function createSession(): Promise<InterviewSession> {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    }
  });

  const data = await parseResponse<{ session: InterviewSession }>(response);
  return data.session;
}

export async function postMessage(sessionId: string, message: string): Promise<PostMessageResponse> {
  const response = await fetch(`/api/sessions/${sessionId}/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message })
  });

  return parseResponse<PostMessageResponse>(response);
}
