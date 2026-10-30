import {
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";

import {
    BpmnEditor
} from "../components/BpmnEditor";

import {
    type ChatMessage,
    type EmployeeProcessView,
    type EmployeeSessionView,
    type ProcessModel
} from "../types";

const API_BASE =
    "http://localhost:3001";

type CreateSessionResponse = {
    session: EmployeeSessionView;
};

type GetSessionResponse = {
    session: EmployeeSessionView;
};

type PostMessageResponse = {
    assistantMessage: string;
    process: EmployeeProcessView;
    bpmnXml: string;
};

type UpdateProcessResponse = {
    process: EmployeeProcessView;
    bpmnXml: string;
};

// ======================================================
// ROUTE
// ======================================================

function getSessionIdFromPath():
    string | undefined {
    const parts =
        window.location.pathname
            .split("/")
            .filter(Boolean);

    if (
        parts[0] !==
        "employee"
    ) {
        return undefined;
    }

    return parts[1];
}

// ======================================================
// EMPLOYEE PROCESS -> EDITOR PROCESS
// ======================================================
//
// BpmnEditor currently works with ProcessModel.
//
// The employee API intentionally does NOT return
// workaround information.
//
// Therefore we create a safe local ProcessModel with
// an empty workaround collection.
// ======================================================

function toEditorProcess(
    process: EmployeeProcessView
): ProcessModel {
    return {
        id:
            process.id,

        name:
            process.name,

        status:
            process.status ===
                "complete"
                ? "confirmed"
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

        elements:
            process.elements.map(
                (element) => ({
                    ...element
                })
            ) as ProcessModel["elements"],

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

        /**
         * Employee must not know about these.
         */
        workarounds: [],

        updatedAt:
            process.updatedAt
    };
}

// ======================================================
// EDITOR PROCESS -> EMPLOYEE PROCESS
// ======================================================
//
// A manually edited BPMN must be sent back using the
// employee-facing shape.
//
// Never send workarounds back from the browser.
// ======================================================

function fromEditorProcess(
    process: ProcessModel
): EmployeeProcessView {
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

        elements:
            process.elements.map(
                (element) => {
                    if (
                        element.type !==
                        "task"
                    ) {
                        return {
                            ...element
                        };
                    }

                    const {
                        workaroundCandidate: _candidate,
                        workaroundConfirmed: _confirmed,
                        workaroundReason: _reason,
                        workaroundCategory: _category,
                        ...employeeTask
                    } = element;

                    return employeeTask;
                }
            ),

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
// COMPONENT
// ======================================================

export function EmployeeView():
    JSX.Element {
    const [
        sessionId,
        setSessionId
    ] =
        useState<
            string | undefined
        >(
            getSessionIdFromPath()
        );

    const [
        messages,
        setMessages
    ] =
        useState<ChatMessage[]>(
            []
        );

    const [
        process,
        setProcess
    ] =
        useState<
            EmployeeProcessView |
            undefined
        >(undefined);

    const [
        bpmnXml,
        setBpmnXml
    ] =
        useState("");

    const [
        input,
        setInput
    ] =
        useState("");

    const [
        loading,
        setLoading
    ] =
        useState(true);

    const [
        sending,
        setSending
    ] =
        useState(false);

    const [
        error,
        setError
    ] =
        useState<
            string | undefined
        >(undefined);

    /**
     * Prevent the initialization effect from being
     * executed twice by React StrictMode development
     * checks.
     */
    const initializedRef =
        useRef(false);

    // ====================================================
    // EDITOR PROCESS
    // ====================================================

    const editorProcess =
        useMemo(
            () =>
                process
                    ? toEditorProcess(
                        process
                    )
                    : undefined,
            [process]
        );

    // ====================================================
    // INITIALIZE / LOAD SESSION
    // ====================================================

    useEffect(() => {
        if (
            initializedRef.current
        ) {
            return;
        }

        initializedRef.current =
            true;

        const initialize =
            async (): Promise<void> => {
                setLoading(true);
                setError(undefined);

                try {
                    // --------------------------------------------
                    // LOAD EXISTING SESSION
                    // --------------------------------------------

                    if (sessionId) {
                        const response =
                            await fetch(
                                `${API_BASE}/api/employee/sessions/${encodeURIComponent(
                                    sessionId
                                )}`
                            );

                        if (!response.ok) {
                            throw new Error(
                                `Could not load session (${response.status})`
                            );
                        }

                        const data =
                            await response.json() as
                            GetSessionResponse;

                        setMessages(
                            data.session.messages
                        );

                        setProcess(
                            data.session.process
                        );

                        setBpmnXml(
                            data.session.bpmnXml
                        );

                        return;
                    }

                    // --------------------------------------------
                    // CREATE NEW SESSION
                    // --------------------------------------------

                    const response =
                        await fetch(
                            `${API_BASE}/api/employee/sessions`,
                            {
                                method: "POST"
                            }
                        );

                    if (!response.ok) {
                        throw new Error(
                            `Could not create session (${response.status})`
                        );
                    }

                    const data =
                        await response.json() as
                        CreateSessionResponse;

                    const newSessionId =
                        data.session.sessionId;

                    setSessionId(
                        newSessionId
                    );

                    setMessages(
                        data.session.messages
                    );

                    setProcess(
                        data.session.process
                    );

                    setBpmnXml(
                        data.session.bpmnXml
                    );

                    window.history.replaceState(
                        {},
                        "",
                        `/employee/${encodeURIComponent(
                            newSessionId
                        )}`
                    );
                } catch (
                initializationError
                ) {
                    setError(
                        initializationError instanceof
                            Error
                            ? initializationError.message
                            : "The session could not be initialized."
                    );
                } finally {
                    setLoading(false);
                }
            };

        void initialize();
    }, [sessionId]);

    // ====================================================
    // SEND CHAT MESSAGE
    // ====================================================

    const handleSend =
        async (): Promise<void> => {
            if (
                !sessionId ||
                !input.trim() ||
                sending
            ) {
                return;
            }

            const text =
                input.trim();

            setInput("");
            setSending(true);
            setError(undefined);

            const localEmployeeMessage:
                ChatMessage = {
                id:
                    crypto.randomUUID(),

                role:
                    "employee",

                content:
                    text,

                timestamp:
                    new Date()
                        .toISOString()
            };

            setMessages(
                (current) => [
                    ...current,
                    localEmployeeMessage
                ]
            );

            try {
                const response =
                    await fetch(
                        `${API_BASE}/api/employee/sessions/${encodeURIComponent(
                            sessionId
                        )}/message`,
                        {
                            method:
                                "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({
                                    message:
                                        text
                                })
                        }
                    );

                const data =
                    await response.json() as
                    PostMessageResponse & {
                        error?: string;
                        details?: string;
                    };

                if (!response.ok) {
                    throw new Error(
                        data.details ??
                        data.error ??
                        "The message could not be processed."
                    );
                }

                const localAssistantMessage:
                    ChatMessage = {
                    id:
                        crypto.randomUUID(),

                    role:
                        "assistant",

                    content:
                        data.assistantMessage,

                    timestamp:
                        new Date()
                            .toISOString()
                };

                setMessages(
                    (current) => [
                        ...current,
                        localAssistantMessage
                    ]
                );

                setProcess(
                    data.process
                );

                setBpmnXml(
                    data.bpmnXml
                );
            } catch (
            sendError
            ) {
                setError(
                    sendError instanceof
                        Error
                        ? sendError.message
                        : "The message could not be sent."
                );
            } finally {
                setSending(false);
            }
        };

    // ====================================================
    // MANUAL BPMN CHANGE
    // ====================================================

    const handleManualProcessChange =
        async (
            editedProcess: ProcessModel
        ): Promise<void> => {
            if (
                !sessionId
            ) {
                return;
            }

            try {
                const employeeProcess =
                    fromEditorProcess(
                        editedProcess
                    );

                const response =
                    await fetch(
                        `${API_BASE}/api/employee/sessions/${encodeURIComponent(
                            sessionId
                        )}/process`,
                        {
                            method:
                                "PUT",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({
                                    process:
                                        employeeProcess
                                })
                        }
                    );

                const data =
                    await response.json() as
                    UpdateProcessResponse & {
                        error?: string;
                    };

                if (!response.ok) {
                    throw new Error(
                        data.error ??
                        "The process change could not be saved."
                    );
                }

                setProcess(
                    data.process
                );

                setBpmnXml(
                    data.bpmnXml
                );
            } catch (
            updateError
            ) {
                console.error(
                    "[EmployeeView] Failed to save BPMN edit",
                    updateError
                );

                setError(
                    updateError instanceof
                        Error
                        ? updateError.message
                        : "The process change could not be saved."
                );
            }
        };

    // ====================================================
    // LOADING
    // ====================================================

    if (loading) {
        return (
            <main className="app-loading">
                Loading session…
            </main>
        );
    }

    // ====================================================
    // VIEW
    // ====================================================

    return (
        <div className="app-shell">
            <header className="topbar">
                <div>
                    <h1>Process Interview</h1>
                    <p>
                        Describe how you actually perform the process.
                    </p>
                </div>

                {sessionId && (
                    <div className="session-info">
                        Session: {sessionId}
                    </div>
                )}
            </header>

            {error && (
                <div
                    className="error-banner"
                    role="alert"
                >
                    {error}
                </div>
            )}

            <main className="main-layout">
                {/* ============================================ */}
                {/* LEFT: CHAT */}
                {/* ============================================ */}

                <section className="chat-section">
                    <div className="panel-header">
                        <div>
                            <h2>Process capture</h2>
                            <p>
                                Describe the actual workflow.
                            </p>
                        </div>
                    </div>

                    <div className="chat-scroll">
                        {messages.map(
                            (message) => (
                                <div
                                    key={message.id}
                                    className={
                                        message.role === "employee"
                                            ? "message-row employee-message"
                                            : "message-row assistant-message"
                                    }
                                >
                                    <div className="message-author">
                                        {message.role === "employee"
                                            ? "You"
                                            : "Assistant"}
                                    </div>

                                    <div className="message-bubble">
                                        {message.content}
                                    </div>
                                </div>
                            )
                        )}
                    </div>

                    <form
                        className="chat-composer"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleSend();
                        }}
                    >
                        <textarea
                            value={input}
                            disabled={sending}
                            placeholder="Describe the next step…"
                            onChange={(event) =>
                                setInput(
                                    event.target.value
                                )
                            }
                        />

                        <button
                            type="submit"
                            disabled={
                                sending ||
                                !input.trim()
                            }
                        >
                            {sending
                                ? "Processing…"
                                : "Send"}
                        </button>
                    </form>
                </section>

                {/* ============================================ */}
                {/* RIGHT: BPMN */}
                {/* ============================================ */}

                <section className="bpmn-section">
                    <div className="panel-header">
                        <div>
                            <h2>Current process</h2>
                            <p>
                                The model is continuously updated during the interview.
                            </p>
                        </div>
                    </div>

                    <div className="bpmn-wrapper">
                        {editorProcess && bpmnXml ? (
                            <BpmnEditor
                                xml={bpmnXml}
                                process={editorProcess}
                                mode="employee"
                                highlights={
                                    []
                                }
                                onProcessChange={
                                    handleManualProcessChange
                                }
                            />
                        ) : (
                            <div className="empty-state">
                                BPMN model is loading…
                            </div>
                        )}
                    </div>
                </section>
            </main>
        </div>
    );
}