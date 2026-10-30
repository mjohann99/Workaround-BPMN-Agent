import {
  useState
} from "react";


// ======================================================
// REFERENCE PROCESS SUMMARY
// ======================================================
//
// This mirrors the summary returned by:
//
// GET /api/owner/reference-processes
//
// Later this type can be moved into ../types.ts.
// ======================================================

export type ReferenceProcessSummary = {
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


// ======================================================
// PROPS
// ======================================================

type Props = {
  processes:
    ReferenceProcessSummary[];

  selectedId?:
    string;

  onSelect: (
    id: string
  ) => void;

  onCreate: (
    name: string
  ) => Promise<void>;
};


// ======================================================
// COMPONENT
// ======================================================

export function ReferenceProcessList({
  processes,
  selectedId,
  onSelect,
  onCreate
}: Props): JSX.Element {
  const [
    newProcessName,
    setNewProcessName
  ] =
    useState("");

  const [
    creating,
    setCreating
  ] =
    useState(false);

  const [
    error,
    setError
  ] =
    useState<
      string | undefined
    >(undefined);


  // ====================================================
  // CREATE PROCESS
  // ====================================================

  const handleCreate =
    async (): Promise<void> => {
      const name =
        newProcessName.trim();

      if (
        !name ||
        creating
      ) {
        return;
      }

      setCreating(
        true
      );

      setError(
        undefined
      );

      try {
        await onCreate(
          name
        );

        setNewProcessName(
          ""
        );
      } catch (
        createError
      ) {
        setError(
          createError instanceof
          Error
            ? createError.message
            : "The reference process could not be created."
        );
      } finally {
        setCreating(
          false
        );
      }
    };


  // ====================================================
  // SORT
  // ====================================================
  //
  // Active processes first.
  //
  // Inside each group sort alphabetically.
  // ====================================================

  const sortedProcesses =
    [...processes]
      .sort(
        (
          left,
          right
        ) => {
          if (
            left.active !==
            right.active
          ) {
            return left.active
              ? -1
              : 1;
          }

          return left.name
            .localeCompare(
              right.name,
              "de"
            );
        }
      );


  // ====================================================
  // VIEW
  // ====================================================

  return (
    <section className="reference-process-list">
      {/* ============================================== */}
      {/* HEADER */}
      {/* ============================================== */}

      <div className="owner-section-header">
        <div>
          <h2>
            Reference processes
          </h2>

          <p>
            Target process models maintained by the process owner
          </p>
        </div>

        <span>
          {processes.length}
        </span>
      </div>


      {/* ============================================== */}
      {/* CREATE PROCESS */}
      {/* ============================================== */}

      <form
        className="reference-process-create"
        onSubmit={
          (
            event
          ) => {
            event.preventDefault();

            void handleCreate();
          }
        }
      >
        <label>
          New reference process

          <input
            type="text"

            value={
              newProcessName
            }

            disabled={
              creating
            }

            placeholder={
              "e.g. Order entry"
            }

            onChange={
              (
                event
              ) =>
                setNewProcessName(
                  event.target.value
                )
            }
          />
        </label>

        <button
          type="submit"

          disabled={
            creating ||
            !newProcessName.trim()
          }
        >
          {creating
            ? "Creating…"
            : "Create"}
        </button>
      </form>


      {/* ============================================== */}
      {/* LOCAL ERROR */}
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
      {/* EMPTY STATE */}
      {/* ============================================== */}

      {sortedProcesses.length ===
      0 ? (
        <div className="empty">
          No reference processes yet.
          Create the first reference process.
        </div>
      ) : (
        <div className="reference-process-cards">
          {/* ========================================== */}
          {/* PROCESS CARDS */}
          {/* ========================================== */}

          {sortedProcesses.map(
            (
              process
            ) => {
              const selected =
                process.id ===
                selectedId;

              const assignedSessionCount =
                process
                  .assignedSessionCount ??
                0;

              const openDeviationCount =
                process
                  .openDeviationCount ??
                0;

              return (
                <button
                  key={
                    process.id
                  }

                  type="button"

                  className={
                    selected
                      ? "reference-process-card selected"
                      : "reference-process-card"
                  }

                  onClick={
                    () =>
                      onSelect(
                        process.id
                      )
                  }
                >
                  {/* ================================== */}
                  {/* NAME + ACTIVE STATUS */}
                  {/* ================================== */}

                  <div className="reference-process-card-header">
                    <strong>
                      {process.name}
                    </strong>

                    <span
                      className={
                        process.active
                          ? "reference-process-status active"
                          : "reference-process-status inactive"
                      }
                    >
                      {process.active
                        ? "Active"
                        : "Inactive"}
                    </span>
                  </div>


                  {/* ================================== */}
                  {/* DESCRIPTION */}
                  {/* ================================== */}

                  {process.description && (
                    <p className="reference-process-description">
                      {
                        process.description
                      }
                    </p>
                  )}


                  {/* ================================== */}
                  {/* VERSION */}
                  {/* ================================== */}

                  <div className="reference-process-version">
                    Version{" "}
                    {
                      process
                        .currentVersion
                    }
                  </div>


                  {/* ================================== */}
                  {/* OWNER METRICS */}
                  {/* ================================== */}

                  <div className="reference-process-metrics">
                    <div>
                      <strong>
                        {
                          assignedSessionCount
                        }
                      </strong>

                      <span>
                        {assignedSessionCount ===
                        1
                          ? "session"
                          : "sessions"}
                      </span>
                    </div>

                    <div>
                      <strong>
                        {
                          openDeviationCount
                        }
                      </strong>

                      <span>
                        {openDeviationCount ===
                        1
                          ? "open deviation"
                          : "open deviations"}
                      </span>
                    </div>
                  </div>


                  {/* ================================== */}
                  {/* ALIASES */}
                  {/* ================================== */}

                  {process.aliases.length >
                    0 && (
                    <div className="reference-process-aliases">
                      {process.aliases
                        .slice(
                          0,
                          3
                        )
                        .map(
                          (
                            alias
                          ) => (
                            <span
                              key={
                                alias
                              }
                            >
                              {alias}
                            </span>
                          )
                        )}

                      {process.aliases.length >
                        3 && (
                        <span>
                          +
                          {
                            process.aliases
                              .length -
                            3
                          }
                        </span>
                      )}
                    </div>
                  )}


                  {/* ================================== */}
                  {/* LAST UPDATE */}
                  {/* ================================== */}

                  <small className="reference-process-updated">
                    Updated:{" "}
                    {new Date(
                      process.updatedAt
                    ).toLocaleString()}
                  </small>
                </button>
              );
            }
          )}
        </div>
      )}
    </section>
  );
}