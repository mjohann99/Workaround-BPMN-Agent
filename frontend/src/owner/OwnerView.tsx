import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  BpmnEditor,
  type BpmnHighlight
} from "../components/BpmnEditor";

import {
  DeviationList
} from "./DeviationList";

import {
  InvestigationPanel,
  type OwnerDecision
} from "./InvestigationPanel";

import {
  ReferenceProcessList
} from "./ReferenceProcessList";

import {
  ReferenceProcessEditor
} from "./ReferenceProcessEditor";

import {
  ReferenceProcessOverview
} from "./ReferenceProcessOverview";

import {
  type OwnerSessionView,
  type ProcessModel
} from "../types";


// ======================================================
// API
// ======================================================

const API_BASE =
  "http://localhost:3001";


// ======================================================
// LOCAL API TYPES
// ======================================================
//
// These can later be moved into frontend/src/types.ts.
//
// Keeping them here for now makes OwnerView independent
// while we build the reference-process frontend.
// ======================================================

type ReferenceProcessSummary = {
  id: string;

  name: string;

  aliases: string[];

  description?: string;

  active: boolean;

  currentVersion: number;

  updatedAt: string;

  assignedSessionCount?:
  number;

  openDeviationCount?:
  number;
};


type ReferenceProcessMetadata = {
  id: string;

  name: string;

  aliases: string[];

  description?: string;

  active: boolean;

  currentVersion: number;

  createdAt: string;

  updatedAt: string;
};


type ReferenceProcessVersion = {
  referenceProcessId:
  string;

  version:
  number;

  modelHash:
  string;

  process:
  ProcessModel;

  bpmnXml:
  string;

  createdAt:
  string;
};


type ReferenceProcessRecord = {
  metadata:
  ReferenceProcessMetadata;

  currentVersion:
  ReferenceProcessVersion;
};


type ReferenceProcessOverviewSession = {
  sessionId: string;

  processName: string;

  referenceProcessVersion?:
  number;

  identificationStatus:
  "unresolved" |
  "probable" |
  "selected";

  identificationConfidence:
  number;

  deviationCount:
  number;

  openDeviationCount:
  number;

  updatedAt:
  string;
};


type ReferenceProcessOverviewData = {
  referenceProcessId:
  string;

  name:
  string;

  currentVersion:
  number;

  active:
  boolean;

  sessionCount:
  number;

  openDeviationCount:
  number;

  sessions:
  ReferenceProcessOverviewSession[];
};


type OwnerSessionSummary = {
  sessionId: string;

  processName: string;

  updatedAt: string;

  identificationStatus:
  "unresolved" |
  "probable" |
  "selected";

  selectedReferenceProcessId?:
  string;

  selectedReferenceProcessVersion?:
  number;

  identificationConfidence:
  number;

  deviationCount:
  number;

  openDeviationCount:
  number;
};


// ======================================================
// API RESPONSE TYPES
// ======================================================

type ReferenceProcessListResponse = {
  processes:
  ReferenceProcessSummary[];
};


type OwnerSessionListResponse = {
  sessions:
  OwnerSessionSummary[];
};


// ======================================================
// OWNER AREA
// ======================================================

type OwnerArea =
  | "references"
  | "sessions";


// ======================================================
// INITIAL ROUTE
// ======================================================
//
// Supported:
//
// /owner
//
// /owner/session/<session-id>
//
// /owner/reference/<reference-process-id>
//
// Legacy:
// /owner/<session-id>
// ======================================================

type InitialRoute = {
  area:
  OwnerArea;

  sessionId?:
  string;

  referenceProcessId?:
  string;
};


function getInitialRoute():
  InitialRoute {
  const parts =
    window.location.pathname
      .split("/")
      .filter(Boolean);

  if (
    parts[0] !==
    "owner"
  ) {
    return {
      area:
        "references"
    };
  }

  if (
    parts[1] ===
    "session" &&
    parts[2]
  ) {
    return {
      area:
        "sessions",

      sessionId:
        parts[2]
    };
  }

  if (
    parts[1] ===
    "reference" &&
    parts[2]
  ) {
    return {
      area:
        "references",

      referenceProcessId:
        parts[2]
    };
  }

  /**
   * Backwards compatibility with the previous route:
   *
   * /owner/<session-id>
   */
  if (
    parts[1]
  ) {
    return {
      area:
        "sessions",

      sessionId:
        parts[1]
    };
  }

  return {
    area:
      "references"
  };
}


// ======================================================
// COMPONENT
// ======================================================

export function OwnerView():
  JSX.Element {
  const initialRoute =
    useRef(
      getInitialRoute()
    );

  // ====================================================
  // ACTIVE AREA
  // ====================================================

  const [
    activeArea,
    setActiveArea
  ] =
    useState<OwnerArea>(
      initialRoute
        .current
        .area
    );


  // ====================================================
  // REFERENCE PROCESSES
  // ====================================================

  const [
    referenceProcesses,
    setReferenceProcesses
  ] =
    useState<
      ReferenceProcessSummary[]
    >(
      []
    );

  const [
    selectedReferenceProcessId,
    setSelectedReferenceProcessId
  ] =
    useState<
      string | undefined
    >(
      initialRoute
        .current
        .referenceProcessId
    );

  const [
    selectedReferenceProcess,
    setSelectedReferenceProcess
  ] =
    useState<
      ReferenceProcessRecord |
      undefined
    >(
      undefined
    );

  const [
    referenceOverview,
    setReferenceOverview
  ] =
    useState<
      ReferenceProcessOverviewData |
      undefined
    >(
      undefined
    );


  // ====================================================
  // EMPLOYEE SESSIONS
  // ====================================================

  const [
    sessions,
    setSessions
  ] =
    useState<
      OwnerSessionSummary[]
    >(
      []
    );

  const [
    selectedSessionId,
    setSelectedSessionId
  ] =
    useState<
      string | undefined
    >(
      initialRoute
        .current
        .sessionId
    );

  const [
    session,
    setSession
  ] =
    useState<
      OwnerSessionView |
      undefined
    >(
      undefined
    );


  // ====================================================
  // DEVIATION SELECTION
  // ====================================================

  const [
    selectedDeviationId,
    setSelectedDeviationId
  ] =
    useState<
      string | undefined
    >(
      undefined
    );


  // ====================================================
  // UI STATE
  // ====================================================

  const [
    loading,
    setLoading
  ] =
    useState(
      true
    );

  const [
    loadingReference,
    setLoadingReference
  ] =
    useState(
      false
    );

  const [
    loadingSession,
    setLoadingSession
  ] =
    useState(
      false
    );

  const [
    savingReference,
    setSavingReference
  ] =
    useState(
      false
    );

  const [
    deletingReference,
    setDeletingReference
  ] =
    useState(
      false
    );

  const [
    error,
    setError
  ] =
    useState<
      string | undefined
    >(
      undefined
    );

  const initializedRef =
    useRef(
      false
    );


  // ====================================================
  // LOAD REFERENCE PROCESS LIST
  // ====================================================

  const loadReferenceProcesses =
    async (): Promise<
      ReferenceProcessSummary[]
    > => {
      const response =
        await fetch(
          `${API_BASE}/api/owner/reference-processes`
        );

      const data =
        await response.json() as
        ReferenceProcessListResponse & {
          error?: string;
        };

      if (!response.ok) {
        throw new Error(
          data.error ??
          "The reference processes could not be loaded."
        );
      }

      setReferenceProcesses(
        data.processes
      );

      return data.processes;
    };


  // ====================================================
  // LOAD SESSION LIST
  // ====================================================

  const loadSessions =
    async (): Promise<
      OwnerSessionSummary[]
    > => {
      const response =
        await fetch(
          `${API_BASE}/api/owner/sessions`
        );

      const data =
        await response.json() as
        OwnerSessionListResponse & {
          error?: string;
        };

      if (!response.ok) {
        throw new Error(
          data.error ??
          "The employee sessions could not be loaded."
        );
      }

      setSessions(
        data.sessions
      );

      return data.sessions;
    };


  // ====================================================
  // LOAD REFERENCE PROCESS
  // ====================================================

  const loadReferenceProcess =
    async (
      referenceProcessId:
        string
    ): Promise<void> => {
      setLoadingReference(
        true
      );

      setError(
        undefined
      );

      try {
        const [
          processResponse,
          overviewResponse
        ] =
          await Promise.all([
            fetch(
              `${API_BASE}/api/owner/reference-processes/${encodeURIComponent(
                referenceProcessId
              )}`
            ),

            fetch(
              `${API_BASE}/api/owner/reference-processes/${encodeURIComponent(
                referenceProcessId
              )}/overview`
            )
          ]);

        const processData =
          await processResponse
            .json() as
          ReferenceProcessRecord & {
            error?: string;
          };

        const overviewData =
          await overviewResponse
            .json() as
          ReferenceProcessOverviewData & {
            error?: string;
          };

        if (
          !processResponse.ok
        ) {
          throw new Error(
            processData.error ??
            "The reference process could not be loaded."
          );
        }

        if (
          !overviewResponse.ok
        ) {
          throw new Error(
            overviewData.error ??
            "The reference process overview could not be loaded."
          );
        }

        setSelectedReferenceProcess(
          processData
        );

        setReferenceOverview(
          overviewData
        );
      } catch (
      loadError
      ) {
        setError(
          loadError instanceof
            Error
            ? loadError.message
            : "The reference process could not be loaded."
        );
      } finally {
        setLoadingReference(
          false
        );
      }
    };


  // ====================================================
  // LOAD OWNER SESSION
  // ====================================================

  const loadSession =
    async (
      sessionId:
        string
    ): Promise<void> => {
      setLoadingSession(
        true
      );

      setError(
        undefined
      );

      try {
        const response =
          await fetch(
            `${API_BASE}/api/owner/sessions/${encodeURIComponent(
              sessionId
            )}`
          );

        const data =
          await response.json() as
          OwnerSessionView & {
            error?: string;
          };

        if (!response.ok) {
          throw new Error(
            data.error ??
            "The owner session could not be loaded."
          );
        }

        setSession(
          data
        );

        const firstDeviation =
          data.analysis
            .deviations
            .find(
              (
                deviation
              ) =>
                deviation.status !==
                "reviewed"
            ) ??
          data.analysis
            .deviations[0];

        setSelectedDeviationId(
          firstDeviation?.id
        );
      } catch (
      loadError
      ) {
        setError(
          loadError instanceof
            Error
            ? loadError.message
            : "The owner session could not be loaded."
        );
      } finally {
        setLoadingSession(
          false
        );
      }
    };


  // ====================================================
  // INITIALIZE DASHBOARD
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
        setLoading(
          true
        );

        setError(
          undefined
        );

        try {
          const [
            loadedReferences
          ] =
            await Promise.all([
              loadReferenceProcesses(),

              loadSessions()
            ]);

          // --------------------------------------------
          // DIRECT REFERENCE ROUTE
          // --------------------------------------------

          if (
            initialRoute
              .current
              .referenceProcessId
          ) {
            await loadReferenceProcess(
              initialRoute
                .current
                .referenceProcessId
            );
          }

          // --------------------------------------------
          // DIRECT SESSION ROUTE
          // --------------------------------------------

          if (
            initialRoute
              .current
              .sessionId
          ) {
            await loadSession(
              initialRoute
                .current
                .sessionId
            );
          }

          // --------------------------------------------
          // DEFAULT REFERENCE SELECTION
          // --------------------------------------------

          if (
            !initialRoute
              .current
              .referenceProcessId &&
            loadedReferences.length >
            0
          ) {
            const first =
              loadedReferences[0];

            setSelectedReferenceProcessId(
              first.id
            );

            if (
              activeArea ===
              "references"
            ) {
              await loadReferenceProcess(
                first.id
              );
            }
          }
        } catch (
        initializationError
        ) {
          setError(
            initializationError instanceof
              Error
              ? initializationError.message
              : "The owner dashboard could not be loaded."
          );
        } finally {
          setLoading(
            false
          );
        }
      };

    void initialize();
  }, []);


  // ====================================================
  // SELECT REFERENCE PROCESS
  // ====================================================

  const handleSelectReferenceProcess =
    async (
      referenceProcessId:
        string
    ): Promise<void> => {
      setSelectedReferenceProcessId(
        referenceProcessId
      );

      setActiveArea(
        "references"
      );

      window.history.pushState(
        {},
        "",
        `/owner/reference/${encodeURIComponent(
          referenceProcessId
        )}`
      );

      await loadReferenceProcess(
        referenceProcessId
      );
    };


  // ====================================================
  // CREATE REFERENCE PROCESS
  // ====================================================

  const handleCreateReferenceProcess =
    async (
      name:
        string
    ): Promise<void> => {
      const normalizedName =
        name.trim();

      if (!normalizedName) {
        return;
      }

      setError(
        undefined
      );

      const response =
        await fetch(
          `${API_BASE}/api/owner/reference-processes`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                name:
                  normalizedName
              })
          }
        );

      const data =
        await response.json() as
        ReferenceProcessRecord & {
          error?: string;
        };

      if (!response.ok) {
        const message =
          data.error ??
          "The reference process could not be created.";

        setError(
          message
        );

        throw new Error(
          message
        );
      }

      await loadReferenceProcesses();

      setSelectedReferenceProcessId(
        data.metadata.id
      );

      setSelectedReferenceProcess(
        data
      );

      setActiveArea(
        "references"
      );

      window.history.pushState(
        {},
        "",
        `/owner/reference/${encodeURIComponent(
          data.metadata.id
        )}`
      );

      await loadReferenceProcess(
        data.metadata.id
      );
    };


  // ====================================================
  // RENAME REFERENCE PROCESS
  // ====================================================

  const handleRenameReferenceProcess =
    async (
      name:
        string
    ): Promise<void> => {
      if (
        !selectedReferenceProcess
      ) {
        return;
      }

      const normalizedName =
        name.trim();

      if (!normalizedName) {
        return;
      }

      setSavingReference(
        true
      );

      setError(
        undefined
      );

      try {
        const response =
          await fetch(
            `${API_BASE}/api/owner/reference-processes/${encodeURIComponent(
              selectedReferenceProcess
                .metadata.id
            )}`,
            {
              method:
                "PATCH",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  name:
                    normalizedName
                })
            }
          );

        const data =
          await response.json() as
          ReferenceProcessRecord & {
            error?: string;
          };

        if (!response.ok) {
          throw new Error(
            data.error ??
            "The reference process could not be renamed."
          );
        }

        setSelectedReferenceProcess(
          data
        );

        await loadReferenceProcesses();
      } catch (
      renameError
      ) {
        setError(
          renameError instanceof
            Error
            ? renameError.message
            : "The reference process could not be renamed."
        );

        throw renameError;
      } finally {
        setSavingReference(
          false
        );
      }
    };

  // ====================================================
  // DELETE REFERENCE PROCESS
  // ====================================================

  const handleDeleteReferenceProcess =
    async (): Promise<void> => {
      if (
        !selectedReferenceProcess ||
        deletingReference
      ) {
        return;
      }

      const referenceId =
        selectedReferenceProcess
          .metadata
          .id;

      const referenceName =
        selectedReferenceProcess
          .metadata
          .name;


      // --------------------------------------------------
      // DESTRUCTIVE ACTION CONFIRMATION
      // --------------------------------------------------

      const confirmed =
        window.confirm(
          `Are you sure you want to permanently delete the reference process “${referenceName}”?\n\n` +
          "This removes all saved versions and BPMN models. " +
          "This action cannot be undone."
        );

      if (
        !confirmed
      ) {
        return;
      }


      setDeletingReference(
        true
      );

      setError(
        undefined
      );

      try {
        const response =
          await fetch(
            `${API_BASE}/api/owner/reference-processes/${encodeURIComponent(
              referenceId
            )}`,
            {
              method:
                "DELETE"
            }
          );

        const data =
          await response.json() as {
            deletedReferenceProcessId?:
            string;

            error?:
            string;

            assignedSessionCount?:
            number;
          };


        if (
          !response.ok
        ) {
          throw new Error(
            data.error ??
            "The reference process could not be deleted."
          );
        }


        // ------------------------------------------------
        // CLEAR CURRENT SELECTION
        // ------------------------------------------------

        setSelectedReferenceProcess(
          undefined
        );

        setReferenceOverview(
          undefined
        );

        setSelectedReferenceProcessId(
          undefined
        );


        // ------------------------------------------------
        // RELOAD LIST
        // ------------------------------------------------

        const remainingReferences =
          await loadReferenceProcesses();


        // ------------------------------------------------
        // SELECT NEXT AVAILABLE REFERENCE PROCESS
        // ------------------------------------------------

        const nextReference =
          remainingReferences[0];

        if (
          nextReference
        ) {
          setSelectedReferenceProcessId(
            nextReference.id
          );

          window.history.replaceState(
            {},
            "",
            `/owner/reference/${encodeURIComponent(
              nextReference.id
            )}`
          );

          await loadReferenceProcess(
            nextReference.id
          );
        } else {
          window.history.replaceState(
            {},
            "",
            "/owner"
          );
        }
      } catch (
      deleteError
      ) {
        setError(
          deleteError instanceof
            Error
            ? deleteError.message
            : "The reference process could not be deleted."
        );

        throw deleteError;
      } finally {
        setDeletingReference(
          false
        );
      }
    };


  // ====================================================
  // SAVE REFERENCE BPMN
  // ====================================================

  const handleReferenceProcessChange =
    async (
      process:
        ProcessModel
    ): Promise<void> => {
      if (
        !selectedReferenceProcess
      ) {
        return;
      }

      setSavingReference(
        true
      );

      setError(
        undefined
      );

      try {
        const response =
          await fetch(
            `${API_BASE}/api/owner/reference-processes/${encodeURIComponent(
              selectedReferenceProcess
                .metadata.id
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
                  process
                })
            }
          );

        const data =
          await response.json() as
          ReferenceProcessRecord & {
            error?: string;
          };

        if (!response.ok) {
          throw new Error(
            data.error ??
            "The reference model could not be saved."
          );
        }

        setSelectedReferenceProcess(
          data
        );

        await Promise.all([
          loadReferenceProcesses(),

          loadReferenceProcess(
            data.metadata.id
          )
        ]);
      } catch (
      saveError
      ) {
        setError(
          saveError instanceof
            Error
            ? saveError.message
            : "The reference model could not be saved."
        );
      } finally {
        setSavingReference(
          false
        );
      }
    };


  // ====================================================
  // SELECT EMPLOYEE SESSION
  // ====================================================

  const handleSelectSession =
    async (
      sessionId:
        string
    ): Promise<void> => {
      setSelectedSessionId(
        sessionId
      );

      setActiveArea(
        "sessions"
      );

      window.history.pushState(
        {},
        "",
        `/owner/session/${encodeURIComponent(
          sessionId
        )}`
      );

      await loadSession(
        sessionId
      );
    };


  // ====================================================
  // OWNER REFERENCE OVERRIDE
  // ====================================================

  const handleAssignReferenceProcess =
    async (
      referenceProcessId:
        string
    ): Promise<void> => {
      if (
        !selectedSessionId ||
        !referenceProcessId
      ) {
        return;
      }

      setError(
        undefined
      );

      try {
        const response =
          await fetch(
            `${API_BASE}/api/owner/sessions/${encodeURIComponent(
              selectedSessionId
            )}/reference-process`,
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  referenceProcessId
                })
            }
          );

        const data =
          await response.json() as
          OwnerSessionView & {
            error?: string;
          };

        if (!response.ok) {
          throw new Error(
            data.error ??
            "The reference process could not be assigned to the session."
          );
        }

        setSession(
          data
        );

        setSelectedDeviationId(
          data.analysis
            .deviations[0]
            ?.id
        );

        await loadSessions();

        if (
          selectedReferenceProcessId
        ) {
          await loadReferenceProcess(
            selectedReferenceProcessId
          );
        }
      } catch (
      assignmentError
      ) {
        setError(
          assignmentError instanceof
            Error
            ? assignmentError.message
            : "The reference process could not be assigned."
        );
      }
    };


  // ====================================================
  // SELECTED ANALYSIS DATA
  // ====================================================

  const selectedDeviation =
    useMemo(
      () =>
        session?.analysis
          .deviations
          .find(
            (
              deviation
            ) =>
              deviation.id ===
              selectedDeviationId
          ),
      [
        session,
        selectedDeviationId
      ]
    );


  const selectedInvestigation =
    useMemo(
      () =>
        session?.analysis
          .investigations
          .find(
            (
              investigation
            ) =>
              investigation
                .deviationId ===
              selectedDeviationId
          ),
      [
        session,
        selectedDeviationId
      ]
    );


  const selectedReview =
    useMemo(
      () =>
        session?.analysis
          .ownerReviews
          .find(
            (
              review
            ) =>
              review.deviationId ===
              selectedDeviationId
          ),
      [
        session,
        selectedDeviationId
      ]
    );

  // ====================================================
  // BPMN OWNER HIGHLIGHTS
  // ====================================================
  //
  // Source of truth:
  //
  // session.analysis.deviations
  // +
  // session.analysis.ownerReviews
  //
  // IMPORTANT:
  //
  // No marker is derived from:
  //
  // process.workarounds
  // task.workaroundCandidate
  // task.workaroundConfirmed
  //
  // confirmed_workaround
  // -> confirmed
  //
  // everything else
  // -> candidate
  // ====================================================

  const ownerHighlights =
    useMemo<
      BpmnHighlight[]
    >(
      () => {
        if (
          !session
        ) {
          return [];
        }


        // ----------------------------------------------
        // Owner-confirmed workaround deviations
        // ----------------------------------------------

        const confirmedDeviationIds =
          new Set(
            session.analysis
              .ownerReviews
              .filter(
                (
                  review
                ) =>
                  review.decision ===
                  "confirmed_workaround"
              )
              .map(
                (
                  review
                ) =>
                  review.deviationId
              )
          );


        // ----------------------------------------------
        // One final marker status per activity.
        //
        // If several deviations refer to the same
        // activity, "confirmed" wins over "candidate".
        // ----------------------------------------------

        const statusByActivityId =
          new Map<
            string,
            BpmnHighlight["status"]
          >();


        for (
          const deviation of
          session.analysis
            .deviations
        ) {
          const status:
            BpmnHighlight["status"] =
            confirmedDeviationIds.has(
              deviation.id
            )
              ? "confirmed"
              : "candidate";


          for (
            const activityId of
            deviation.actualActivityIds
          ) {
            const currentStatus =
              statusByActivityId.get(
                activityId
              );


            // ------------------------------------------
            // Confirmed always has precedence.
            // ------------------------------------------

            if (
              currentStatus ===
              "confirmed"
            ) {
              continue;
            }

            if (
              status ===
              "confirmed" ||
              currentStatus ===
              undefined
            ) {
              statusByActivityId.set(
                activityId,
                status
              );
            }
          }
        }


        // ----------------------------------------------
        // Convert map to BpmnHighlight[]
        // ----------------------------------------------

        return [
          ...statusByActivityId
            .entries()
        ].map(
          (
            [
              activityId,
              status
            ]
          ) => ({
            activityId,
            status
          })
        );
      },
      [
        session
      ]
    );


  // ====================================================
  // OWNER REVIEW
  // ====================================================

  const handleReview =
    async (
      decision:
        OwnerDecision,

      comment?:
        string
    ): Promise<void> => {
      if (
        !selectedSessionId ||
        !selectedDeviationId
      ) {
        return;
      }

      setError(
        undefined
      );

      const response =
        await fetch(
          `${API_BASE}/api/owner/sessions/${encodeURIComponent(
            selectedSessionId
          )}/deviations/${encodeURIComponent(
            selectedDeviationId
          )}`,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                decision,

                ...(comment
                  ? {
                    comment
                  }
                  : {})
              })
          }
        );

      const data =
        await response.json() as
        OwnerSessionView & {
          error?: string;
        };

      if (!response.ok) {
        const message =
          data.error ??
          "The assessment could not be saved.";

        setError(
          message
        );

        throw new Error(
          message
        );
      }

      setSession(
        data
      );

      await loadSessions();

      if (
        data.analysis
          .processIdentification
          .selectedReferenceProcessId
      ) {
        await loadReferenceProcess(
          data.analysis
            .processIdentification
            .selectedReferenceProcessId
        );
      }
    };


  // ====================================================
  // AS-IS BPMN CHANGE
  // ====================================================
  //
  // Owner currently reviews employee AS-IS models.
  //
  // They are deliberately not persisted from this view.
  // ====================================================

  const handleOwnerAsIsProcessChange =
    (
      _process:
        ProcessModel
    ): void => {
      console.warn(
        "[OwnerView] AS-IS BPMN changes are not persisted."
      );
    };


  // ====================================================
  // ACTIVE REFERENCE PROCESS NAME
  // ====================================================

  const selectedSessionReferenceName =
    useMemo(
      () => {
        const referenceId =
          session?.analysis
            .processIdentification
            .selectedReferenceProcessId;

        if (!referenceId) {
          return undefined;
        }

        return referenceProcesses
          .find(
            (
              reference
            ) =>
              reference.id ===
              referenceId
          )
          ?.name;
      },
      [
        session,
        referenceProcesses
      ]
    );


  // ====================================================
  // LOADING
  // ====================================================

  if (loading) {
    return (
      <main className="app-loading">
        Loading process-owner dashboard…
      </main>
    );
  }


  // ====================================================
  // VIEW
  // ====================================================

  return (
    <main className="owner-view">
      {/* ============================================== */}
      {/* HEADER */}
      {/* ============================================== */}

      <header className="app-header">
        <div>
          <h1>
            Process Owner
          </h1>

          <p>
            Reference processes,
            employee sessions, and
            conformance deviations
          </p>
        </div>
      </header>


      {/* ============================================== */}
      {/* ERROR */}
      {/* ============================================== */}

      {error && (
        <div
          className="error-message"
          role="alert"
        >
          {error}
        </div>
      )}


      {/* ============================================== */}
      {/* MAIN NAVIGATION */}
      {/* ============================================== */}

      <nav className="owner-navigation">
        <button
          type="button"
          className={
            activeArea ===
              "references"
              ? "active"
              : ""
          }
          onClick={
            () => {
              setActiveArea(
                "references"
              );

              window.history.pushState(
                {},
                "",
                "/owner"
              );
            }
          }
        >
          Reference processes
        </button>

        <button
          type="button"
          className={
            activeArea ===
              "sessions"
              ? "active"
              : ""
          }
          onClick={
            () => {
              setActiveArea(
                "sessions"
              );

              window.history.pushState(
                {},
                "",
                "/owner"
              );
            }
          }
        >
          Employee sessions

          {sessions.length >
            0 && (
              <span className="navigation-count">
                {sessions.length}
              </span>
            )}
        </button>
      </nav>


      {/* ============================================== */}
      {/* REFERENCE PROCESS AREA */}
      {/* ============================================== */}

      {activeArea ===
        "references" && (
          <div className="owner-reference-layout">
            {/* ========================================== */}
            {/* LEFT: REFERENCE LIST */}
            {/* ========================================== */}

            <aside className="owner-reference-list">
              <ReferenceProcessList
                processes={
                  referenceProcesses
                }

                selectedId={
                  selectedReferenceProcessId
                }

                onSelect={
                  (
                    id
                  ) => {
                    void handleSelectReferenceProcess(
                      id
                    );
                  }
                }

                onCreate={
                  handleCreateReferenceProcess
                }
              />
            </aside>


            {/* ========================================== */}
            {/* CENTER: REFERENCE BPMN EDITOR */}
            {/* ========================================== */}

            <section className="owner-reference-editor">
              {loadingReference ? (
                <div className="empty">
                  Loading reference process…
                </div>
              ) : selectedReferenceProcess ? (
                <ReferenceProcessEditor
                  referenceProcess={
                    selectedReferenceProcess
                  }

                  saving={
                    savingReference
                  }

                  deleting={
                    deletingReference
                  }

                  onRename={
                    handleRenameReferenceProcess
                  }

                  onProcessChange={
                    handleReferenceProcessChange
                  }

                  onDelete={
                    handleDeleteReferenceProcess
                  }
                />
              ) : (
                <div className="empty">
                  Select a reference process or create a new one.
                </div>
              )}
            </section>


            {/* ========================================== */}
            {/* RIGHT: REFERENCE OVERVIEW */}
            {/* ========================================== */}

            <aside className="owner-reference-overview">
              {referenceOverview ? (
                <ReferenceProcessOverview
                  overview={
                    referenceOverview
                  }

                  selectedSessionId={
                    selectedSessionId
                  }

                  onSelectSession={
                    (
                      sessionId
                    ) => {
                      void handleSelectSession(
                        sessionId
                      );
                    }
                  }
                />
              ) : (
                <div className="empty">
                  No process overview available yet.
                </div>
              )}
            </aside>
          </div>
        )}


      {/* ============================================== */}
      {/* EMPLOYEE SESSION AREA */}
      {/* ============================================== */}

      {activeArea ===
        "sessions" && (
          <div className="owner-session-layout">
            {/* ========================================== */}
            {/* LEFT: SESSION LIST */}
            {/* ========================================== */}

            <aside className="owner-session-list">
              <div className="owner-section-header">
                <h2>
                  Employee sessions
                </h2>

                <span>
                  {sessions.length}
                </span>
              </div>

              {sessions.length ===
                0 ? (
                <div className="empty">
                  No employee sessions available yet.
                </div>
              ) : (
                <div className="session-list">
                  {[...sessions]
                    .sort(
                      (
                        left,
                        right
                      ) =>
                        new Date(
                          right.updatedAt
                        ).getTime() -
                        new Date(
                          left.updatedAt
                        ).getTime()
                    )
                    .map(
                      (
                        item
                      ) => {
                        const referenceName =
                          item
                            .selectedReferenceProcessId
                            ? referenceProcesses
                              .find(
                                (
                                  reference
                                ) =>
                                  reference.id ===
                                  item
                                    .selectedReferenceProcessId
                              )
                              ?.name
                            : undefined;

                        return (
                          <button
                            key={
                              item.sessionId
                            }

                            type="button"

                            className={
                              item.sessionId ===
                                selectedSessionId
                                ? "session-card selected"
                                : "session-card"
                            }

                            onClick={
                              () => {
                                void handleSelectSession(
                                  item.sessionId
                                );
                              }
                            }
                          >
                            <strong>
                              {
                                item.processName
                              }
                            </strong>

                            <span>
                              {referenceName ??
                                "Reference process not yet determined"}
                            </span>

                            <small>
                              {
                                item
                                  .openDeviationCount
                              }{" "}
                              open deviations
                            </small>
                          </button>
                        );
                      }
                    )}
                </div>
              )}
            </aside>


            {/* ========================================== */}
            {/* MAIN SESSION CONTENT */}
            {/* ========================================== */}

            <section className="owner-session-content">
              {loadingSession ? (
                <div className="empty">
                  Loading employee session…
                </div>
              ) : !session ? (
                <div className="empty">
                  Select an employee session.
                </div>
              ) : (
                <>
                  {/* ==================================== */}
                  {/* SESSION HEADER */}
                  {/* ==================================== */}

                  <div className="owner-session-header">
                    <div>
                      <h2>
                        {session.process.name}
                      </h2>

                      <small>
                        Session:{" "}
                        {
                          session.sessionId
                        }
                      </small>
                    </div>


                    {/* ================================== */}
                    {/* REFERENCE PROCESS ASSIGNMENT */}
                    {/* ================================== */}

                    <label className="reference-assignment">
                      Reference process

                      <select
                        value={
                          session.analysis
                            .processIdentification
                            .selectedReferenceProcessId ??
                          ""
                        }

                        onChange={
                          (
                            event
                          ) => {
                            const referenceId =
                              event.target
                                .value;

                            if (
                              referenceId
                            ) {
                              void handleAssignReferenceProcess(
                                referenceId
                              );
                            }
                          }
                        }
                      >
                        <option value="">
                          Not yet determined
                        </option>

                        {referenceProcesses
                          .filter(
                            (
                              reference
                            ) =>
                              reference.active
                          )
                          .map(
                            (
                              reference
                            ) => (
                              <option
                                key={
                                  reference.id
                                }

                                value={
                                  reference.id
                                }
                              >
                                {
                                  reference.name
                                }{" "}
                                · Version{" "}
                                {
                                  reference.currentVersion
                                }
                              </option>
                            )
                          )}
                      </select>
                    </label>
                  </div>


                  {/* ==================================== */}
                  {/* INTERNAL IDENTIFICATION SUMMARY */}
                  {/* ==================================== */}

                  <section className="owner-summary">
                    <div>
                      <strong>
                        Reference process
                      </strong>

                      <p>
                        {selectedSessionReferenceName ??
                          "Not yet determined"}
                      </p>
                    </div>

                    <div>
                      <strong>
                        Status
                      </strong>

                      <p>
                        {
                          session.analysis
                            .processIdentification
                            .status
                        }
                      </p>
                    </div>

                    <div>
                      <strong>
                        Confidence
                      </strong>

                      <p>
                        {Math.round(
                          session.analysis
                            .processIdentification
                            .confidence *
                          100
                        )}
                        %
                      </p>
                    </div>

                    <div>
                      <strong>
                        Reference version
                      </strong>

                      <p>
                        {session.analysis
                          .processIdentification
                          .selectedReferenceProcessVersion ??
                          "–"}
                      </p>
                    </div>

                    <div>
                      <strong>
                        Deviations
                      </strong>

                      <p>
                        {
                          session.analysis
                            .deviations
                            .length
                        }
                      </p>
                    </div>
                  </section>


                  {/* ==================================== */}
                  {/* BPMN + DEVIATIONS */}
                  {/* ==================================== */}

                  <div className="owner-session-workspace">
                    <section className="owner-diagram">
                      <BpmnEditor
                        xml={
                          session.bpmnXml
                        }

                        process={
                          session.process
                        }

                        mode="owner"

                        highlights={
                          ownerHighlights
                        }

                        onProcessChange={
                          handleOwnerAsIsProcessChange
                        }
                      />
                    </section>


                    <aside className="owner-sidebar">
                      <div className="owner-section-header">
                        <h2>
                          Deviations
                        </h2>

                        <span>
                          {
                            session.analysis
                              .deviations
                              .length
                          }
                        </span>
                      </div>

                      <DeviationList
                        deviations={
                          session.analysis
                            .deviations
                        }

                        selectedDeviationId={
                          selectedDeviationId
                        }

                        onSelect={
                          setSelectedDeviationId
                        }
                      />

                      <div className="owner-section-header">
                        <h2>
                          Workaround candidates
                        </h2>

                        <span>
                          {
                            session.analysis
                              .practices
                              .length
                          }
                        </span>
                      </div>

                      <ul className="practice-list">
                        {session.analysis.practices.map(
                          (practice) => (
                            <li key={practice.id}>
                              <strong>
                                {practice.activityIds
                                  .map(
                                    (id) =>
                                      session.process.elements.find(
                                        (element) =>
                                          element.id === id
                                      )?.name ?? id
                                  )
                                  .join(", ")}
                              </strong>

                              <div>
                                {practice.deviationIds.length}{" "}
                                deviation(s)
                              </div>

                              {(
                                [
                                  ["reason", "Reason"],
                                  ["sinceWhen", "Since"],
                                  ["frequency", "Frequency"]
                                ] as const
                              ).map(
                                ([field, label]) => {
                                  const fact =
                                    practice.facts[field];

                                  return (
                                    <div key={field}>
                                      {label}:{" "}
                                      {fact
                                        ? fact.status === "unknown"
                                          ? "Not known"
                                          : fact.value
                                        : "Open"}
                                    </div>
                                  );
                                }
                              )}
                            </li>
                          )
                        )}
                      </ul>
                    </aside>
                  </div>


                  {/* ==================================== */}
                  {/* INVESTIGATION */}
                  {/* ==================================== */}

                  <InvestigationPanel
                    deviation={
                      selectedDeviation
                    }

                    investigation={
                      selectedInvestigation
                    }

                    review={
                      selectedReview
                    }

                    onReview={
                      handleReview
                    }
                  />
                </>
              )}
            </section>
          </div>
        )}
    </main>
  );
}