// ======================================================
// TYPES
// ======================================================
//
// These types mirror:
//
// GET /api/owner/reference-processes/:id/overview
//
// Later they can be moved into:
//
// frontend/src/types.ts
//
// or a dedicated:
//
// frontend/src/owner/referenceTypes.ts
// ======================================================

export type ReferenceProcessOverviewSession = {
  sessionId:
    string;

  processName:
    string;

  referenceProcessVersion?:
    number;

  identificationStatus:
    | "unresolved"
    | "probable"
    | "selected";

  identificationConfidence:
    number;

  deviationCount:
    number;

  openDeviationCount:
    number;

  updatedAt:
    string;
};


export type ReferenceProcessOverviewData = {
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


// ======================================================
// PROPS
// ======================================================

type Props = {
  overview:
    ReferenceProcessOverviewData;

  selectedSessionId?:
    string;

  onSelectSession: (
    sessionId: string
  ) => void;
};


// ======================================================
// LABEL HELPERS
// ======================================================

function identificationStatusLabel(
  status:
    ReferenceProcessOverviewSession[
      "identificationStatus"
    ]
): string {
  switch (
    status
  ) {
    case "unresolved":
      return "Not yet determined";

    case "probable":
      return "Probable";

    case "selected":
      return "Selected";

    default:
      return status;
  }
}


// ======================================================
// CONFIDENCE
// ======================================================

function formatConfidence(
  confidence: number
): string {
  const normalized =
    Math.max(
      0,
      Math.min(
        1,
        confidence
      )
    );

  return `${Math.round(
    normalized * 100
  )}%`;
}


// ======================================================
// DATE
// ======================================================

function formatDate(
  timestamp: string
): string {
  const date =
    new Date(
      timestamp
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return timestamp;
  }

  return date
    .toLocaleString(
      "en-US"
    );
}


// ======================================================
// COMPONENT
// ======================================================

export function ReferenceProcessOverview({
  overview,
  selectedSessionId,
  onSelectSession
}: Props): JSX.Element {
  // ====================================================
  // SORT SESSIONS
  // ====================================================
  //
  // Sessions with open deviations should be more visible
  // to the Process Owner.
  //
  // Within the same deviation count, show the most
  // recently changed session first.
  // ====================================================

  const sortedSessions =
    [...overview.sessions]
      .sort(
        (
          left,
          right
        ) => {
          const deviationDifference =
            right
              .openDeviationCount -
            left
              .openDeviationCount;

          if (
            deviationDifference !==
            0
          ) {
            return deviationDifference;
          }

          return (
            new Date(
              right.updatedAt
            ).getTime() -
            new Date(
              left.updatedAt
            ).getTime()
          );
        }
      );


  // ====================================================
  // VIEW
  // ====================================================

  return (
    <section className="reference-process-overview">
      {/* ============================================== */}
      {/* HEADER */}
      {/* ============================================== */}

      <header className="reference-overview-header">
        <div>
          <h2>
            Process overview
          </h2>

          <p>
            Assigned employee sessions and
            conformance deviations
          </p>
        </div>

        <span
          className={
            overview.active
              ? "reference-process-status active"
              : "reference-process-status inactive"
          }
        >
          {overview.active
            ? "Active"
            : "Inactive"}
        </span>
      </header>


      {/* ============================================== */}
      {/* PROCESS */}
      {/* ============================================== */}

      <section className="reference-overview-process">
        <h3>
          {overview.name}
        </h3>

        <p>
          Reference version{" "}
          {
            overview
              .currentVersion
          }
        </p>
      </section>


      {/* ============================================== */}
      {/* AGGREGATED METRICS */}
      {/* ============================================== */}

      <div className="reference-overview-metrics">
        <div className="reference-overview-metric">
          <strong>
            {
              overview
                .sessionCount
            }
          </strong>

          <span>
            {overview.sessionCount ===
            1
              ? "assigned session"
              : "assigned sessions"}
          </span>
        </div>


        <div className="reference-overview-metric">
          <strong>
            {
              overview
                .openDeviationCount
            }
          </strong>

          <span>
            {overview.openDeviationCount ===
            1
              ? "open deviation"
              : "open deviations"}
          </span>
        </div>
      </div>


      {/* ============================================== */}
      {/* SESSION LIST HEADER */}
      {/* ============================================== */}

      <div className="owner-section-header">
        <div>
          <h3>
            Employee sessions
          </h3>

          <p>
            Interviews currently assigned to this
            reference process.
          </p>
        </div>

        <span>
          {
            overview
              .sessions
              .length
          }
        </span>
      </div>


      {/* ============================================== */}
      {/* EMPTY STATE */}
      {/* ============================================== */}

      {sortedSessions.length ===
      0 ? (
        <div className="empty">
          No employee session has been assigned to this reference process yet.
        </div>
      ) : (
        <div className="reference-overview-session-list">
          {/* ========================================== */}
          {/* SESSION CARDS */}
          {/* ========================================== */}

          {sortedSessions.map(
            (
              session
            ) => {
              const selected =
                session
                  .sessionId ===
                selectedSessionId;

              return (
                <button
                  key={
                    session
                      .sessionId
                  }

                  type="button"

                  className={
                    selected
                      ? "reference-overview-session-card selected"
                      : "reference-overview-session-card"
                  }

                  onClick={
                    () =>
                      onSelectSession(
                        session
                          .sessionId
                      )
                  }
                >
                  {/* ================================== */}
                  {/* SESSION HEADER */}
                  {/* ================================== */}

                  <div className="reference-overview-session-header">
                    <strong>
                      {
                        session
                          .processName
                      }
                    </strong>

                    {session
                      .openDeviationCount >
                      0 && (
                      <span className="open-deviation-badge">
                        {
                          session
                            .openDeviationCount
                        }{" "}
                        open
                      </span>
                    )}
                  </div>


                  {/* ================================== */}
                  {/* IDENTIFICATION */}
                  {/* ================================== */}

                  <div className="reference-overview-session-identification">
                    <div>
                      <span>
                        Identification
                      </span>

                      <strong>
                        {identificationStatusLabel(
                          session
                            .identificationStatus
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Confidence
                      </span>

                      <strong>
                        {formatConfidence(
                          session
                            .identificationConfidence
                        )}
                      </strong>
                    </div>
                  </div>


                  {/* ================================== */}
                  {/* REFERENCE VERSION */}
                  {/* ================================== */}

                  <div className="reference-overview-session-row">
                    <span>
                      Reference version used
                    </span>

                    <strong>
                      {session
                        .referenceProcessVersion ??
                        "–"}
                    </strong>
                  </div>


                  {/* ================================== */}
                  {/* DEVIATIONS */}
                  {/* ================================== */}

                  <div className="reference-overview-session-deviations">
                    <div>
                      <strong>
                        {
                          session
                            .deviationCount
                        }
                      </strong>

                      <span>
                        {session.deviationCount ===
                        1
                          ? "deviation"
                          : "deviations"}
                      </span>
                    </div>

                    <div>
                      <strong>
                        {
                          session
                            .openDeviationCount
                        }
                      </strong>

                      <span>
                        open
                      </span>
                    </div>
                  </div>


                  {/* ================================== */}
                  {/* UPDATED */}
                  {/* ================================== */}

                  <small className="reference-overview-session-updated">
                    Last changed:{" "}
                    {formatDate(
                      session
                        .updatedAt
                    )}
                  </small>


                  {/* ================================== */}
                  {/* SESSION ID */}
                  {/* ================================== */}

                  <details
                    className="reference-overview-session-details"

                    onClick={
                      (
                        event
                      ) => {
                        /**
                         * Opening technical details should
                         * not automatically navigate into
                         * the session.
                         */
                        event.stopPropagation();
                      }
                    }
                  >
                    <summary>
                      Technical details
                    </summary>

                    <code>
                      {
                        session
                          .sessionId
                      }
                    </code>
                  </details>
                </button>
              );
            }
          )}
        </div>
      )}
    </section>
  );
}