import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createSession, postMessage } from "./api";
import { BpmnEditor } from "./components/BpmnEditor";
import { type ChatMessage, type ProcessModel } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function buildLocalMessage(role: "employee" | "assistant", content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: nowIso()
  };
}

function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function App(): JSX.Element {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [process, setProcess] = useState<ProcessModel | null>(null);
  const [bpmnXml, setBpmnXml] = useState<string>("");
  const [input, setInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [ready, setReady] = useState<boolean>(false);

  const scrollTargetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    createSession()
      .then((session) => {
        setSessionId(session.id);
        setMessages(session.messages);
        setProcess(session.process);
        setBpmnXml(session.bpmnXml);
        setReady(true);
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Failed to create session");
      });
  }, []);

  useEffect(() => {
    scrollTargetRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const summary = useMemo(() => {
    if (!process) {
      return {
        activities: 0,
        candidates: 0,
        confirmed: 0,
        status: "eliciting" as const
      };
    }

    const tasks = process.elements.filter((element) => element.type === "task");
    const candidates = tasks.filter(
      (task) => task.workaroundCandidate === true && task.workaroundConfirmed !== true
    );
    const confirmed = tasks.filter((task) => task.workaroundConfirmed === true);

    return {
      activities: tasks.length,
      candidates: candidates.length,
      confirmed: confirmed.length,
      status: process.status
    };
  }, [process]);

  async function onSend(): Promise<void> {
    if (!sessionId || !input.trim() || isLoading) {
      return;
    }

    setError("");
    setIsLoading(true);

    const userText = input.trim();
    setInput("");
    setMessages((prev) => [...prev, buildLocalMessage("employee", userText)]);

    try {
      const response = await postMessage(sessionId, userText);
      setProcess(response.process);
      setBpmnXml(response.bpmnXml);
      setMessages((prev) => [...prev, buildLocalMessage("assistant", response.assistantMessage)]);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Failed to send message");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleManualProcessChange(
    nextProcess: ProcessModel
  ): Promise<void> {
    if (!sessionId) {
      return;
    }

    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/process`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            process: nextProcess
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
          "Failed to update process"
        );
      }

      setProcess(data.process);
      setBpmnXml(data.bpmnXml);
    } catch (error) {
      console.error(
        "Failed to save manual BPMN change:",
        error
      );
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void onSend();
    }
  }

  function exportBpmn(): void {
    if (!bpmnXml) {
      return;
    }
    downloadFile("process.bpmn", bpmnXml, "application/xml");
  }

  function exportJson(): void {
    if (!process) {
      return;
    }

    downloadFile("process-model.json", JSON.stringify(process, null, 2), "application/json");
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Workaround Check</h1>
      </header>

      <main className="layout">
        <section className="panel conversation-panel">
          <h2>Conversation</h2>
          <div className="chat-list">
            {messages.map((message) => (
              <article key={message.id} className={`bubble ${message.role}`}>
                <div className="bubble-role">{message.role === "employee" ? "Employee" : "Assistant"}</div>
                <div className="bubble-content">{message.content}</div>
              </article>
            ))}
            {isLoading && <div className="loading">Assistant is thinking...</div>}
            <div ref={scrollTargetRef} />
          </div>

          <div className="composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Describe the next step in your real process..."
              rows={4}
              disabled={!ready || isLoading}
            />
            <button onClick={() => void onSend()} disabled={!ready || isLoading || !input.trim()}>
              Send
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </section>

        <section className="panel diagram-panel">
          <div className="diagram-header">
            <h2>Live Process Model</h2>
            <div className="actions">
              <button onClick={exportBpmn} disabled={!bpmnXml}>
                Export BPMN
              </button>
              <button onClick={exportJson} disabled={!process}>
                Export JSON
              </button>
            </div>
          </div>

          <div className="diagram-container">
            {process ? (
              <BpmnEditor
                xml={bpmnXml}
                process={process}
                onProcessChange={handleManualProcessChange}
              />
            ) : (
              <div className="empty">
                Loading model...
              </div>
            )}
          </div>

          <div className="summary">
            <div>Activities: {summary.activities}</div>
            <div>Workaround candidates: {summary.candidates}</div>
            <div>Confirmed workarounds: {summary.confirmed}</div>
            <div>Process status: {summary.status}</div>
          </div>
        </section>
      </main>
    </div>
  );
}
