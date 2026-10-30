import {
  useEffect,
  useState
} from "react";

import {
  type DeviationCandidate,
  type DeviationInvestigation,
  type InvestigationFacts,
  type OwnerReview,
  type OwnerReviewDecision
} from "../types";


// ======================================================
// OWNER DECISION
// ======================================================
//
// Keep this export because OwnerView currently imports:
//
// type OwnerDecision
//
// The actual source of truth is OwnerReviewDecision
// from ../types.
// ======================================================

export type OwnerDecision =
  OwnerReviewDecision;


// ======================================================
// PROPS
// ======================================================

type Props = {
  deviation?:
    DeviationCandidate;

  investigation?:
    DeviationInvestigation;

  review?:
    OwnerReview;

  onReview: (
    decision:
      OwnerDecision,

    comment?:
      string
  ) => Promise<void>;
};


// ======================================================
// GENERIC DISPLAY HELPERS
// ======================================================

function displayValue(
  value: unknown
): string {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "Not yet collected";
  }

  if (
    typeof value ===
    "boolean"
  ) {
    return value
      ? "Yes"
      : "No";
  }

  return String(
    value
  );
}


// ======================================================
// DEVIATION DIMENSION
// ======================================================

function dimensionLabel(
  dimension:
    DeviationCandidate["dimension"]
): string {
  switch (
    dimension
  ) {
    case "control_flow":
      return "Control flow";

    case "lane":
      return "Responsibility / lane";

    case "participant":
      return "Participant / pool";

    case "system":
      return "System";

    case "message_flow":
      return "Communication";

    default:
      return dimension;
  }
}


// ======================================================
// DEVIATION STATUS
// ======================================================

function statusLabel(
  status:
    DeviationCandidate["status"]
): string {
  switch (
    status
  ) {
    case "open":
      return "Information is being collected";

    case "information_complete":
      return "Information complete";

    case "reviewed":
      return "Reviewed by the process owner";

    default:
      return status;
  }
}


// ======================================================
// MOVE TYPE
// ======================================================

function moveTypeLabel(
  moveType:
    DeviationCandidate["moveType"]
): string | undefined {
  switch (moveType) {
    case "log_move":
      return "Additional actual activity";

    case "model_move":
      return "Expected activity missing";

    default:
      return undefined;
  }
}


// ======================================================
// DETECTION METHOD
// ======================================================

function detectionMethodLabel(
  method:
    DeviationCandidate["detectionMethod"]
): string {
  switch (
    method
  ) {
    case "prefix_tbr":
      return "Prefix token-based replay";

    case "alignment":
      return "Alignment";

    case "perspective_check":
      return "Perspective check";

    default:
      return method;
  }
}


// ======================================================
// OWNER DECISION LABEL
// ======================================================

function decisionLabel(
  decision:
    OwnerReview["decision"]
): string {
  switch (
    decision
  ) {
    case "confirmed_workaround":
      return "Workaround confirmed";

    case "accepted_variant":
      return "Allowed process variant";

    case "model_outdated":
      return "Reference model outdated";

    case "not_a_workaround":
      return "Not a workaround";

    case "needs_information":
      return "Additional information required";

    default:
      return decision;
  }
}


// ======================================================
// INVESTIGATION FIELD LABEL
// ======================================================

function investigationFieldLabel(
  field:
    keyof InvestigationFacts
): string {
  switch (
    field
  ) {
    case "reason":
      return "Reason for the procedure";

    case "sinceWhen":
      return "Since when";

    case "frequency":
      return "Frequency";

    case "expectedPractice":
      return "Expected practice";

    case "goalOrMotivation":
      return "Goal / motivation";

    case "awareness":
      return "Awareness";

    case "documented":
      return "Documentation";

    case "approved":
      return "Approval";

    case "consequenceWithoutPractice":
      return "Consequence without this procedure";

    default:
      return field;
  }
}


// ======================================================
// COMPONENT
// ======================================================

export function InvestigationPanel({
  deviation,
  investigation,
  review,
  onReview
}: Props): JSX.Element {
  const [
    comment,
    setComment
  ] =
    useState(
      review?.comment ??
      ""
    );

  const [
    saving,
    setSaving
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


  // ====================================================
  // UPDATE COMMENT WHEN SELECTED REVIEW CHANGES
  // ====================================================

  useEffect(
    () => {
      setComment(
        review?.comment ??
        ""
      );

      setError(
        undefined
      );
    },
    [
      review?.id,
      review?.comment
    ]
  );


  // ====================================================
  // NO DEVIATION SELECTED
  // ====================================================

  if (
    !deviation
  ) {
    return (
      <section className="investigation-panel">
        <div className="empty">
          Select a deviation to review the
          conformance finding, employee context,
          and process-owner assessment.
        </div>
      </section>
    );
  }


  // ====================================================
  // DERIVED DATA
  // ====================================================

  const facts =
    investigation?.facts;

  const moveLabel =
    moveTypeLabel(
      deviation.moveType
    );

  /**
   * During the interview a deviation may still be
   * provisional.
   *
   * Final workaround classification should normally
   * happen after the technical finding has been
   * confirmed by the completed conformance analysis.
   */
  const finalDecisionDisabled =
    saving ||
    deviation.provisional;


  // ====================================================
  // SUBMIT REVIEW
  // ====================================================

  const submitDecision =
    async (
      decision:
        OwnerDecision
    ): Promise<void> => {
      if (
        saving
      ) {
        return;
      }

      setSaving(
        true
      );

      setError(
        undefined
      );

      try {
        await onReview(
          decision,
          comment.trim() ||
            undefined
        );
      } catch (
        reviewError
      ) {
        setError(
          reviewError instanceof
          Error
            ? reviewError.message
            : "The assessment could not be saved."
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  // ====================================================
  // VIEW
  // ====================================================

  return (
    <section className="investigation-panel">
      {/* ============================================== */}
      {/* HEADER */}
      {/* ============================================== */}

      <header className="investigation-header">
        <div>
          <h2>
            Deviation analysis
          </h2>

          <p>
            Technical finding,
            employee context, and
            process-owner assessment
          </p>
        </div>

        <span
          className={`deviation-status deviation-status-${deviation.status}`}
        >
          {statusLabel(
            deviation.status
          )}
        </span>
      </header>


      {/* ============================================== */}
      {/* PROVISIONAL WARNING */}
      {/* ============================================== */}

      {deviation.provisional && (
        <div className="deviation-provisional-notice">
          <strong>
            Provisional finding
          </strong>

          <p>
            This finding was detected while an interview was still in progress
            and may still change as more process information becomes available.
          </p>
        </div>
      )}


      {/* ============================================== */}
      {/* TECHNICAL CONFORMANCE FINDING */}
      {/* ============================================== */}

      <section className="investigation-section">
        <h2>
          Conformance finding
        </h2>

        <div className="detail-group">
          <h3>
            Description
          </h3>

          <p>
            {deviation.description}
          </p>
        </div>


        <div className="investigation-meta-grid">
          <div>
            <strong>
              Dimension
            </strong>

            <p>
              {dimensionLabel(
                deviation.dimension
              )}
            </p>
          </div>


          <div>
            <strong>
              Method
            </strong>

            <p>
              {detectionMethodLabel(
                deviation.detectionMethod
              )}
            </p>
          </div>


          <div>
            <strong>
              Reference version
            </strong>

            <p>
              Version{" "}
              {
                deviation
                  .referenceProcessVersion
              }
            </p>
          </div>


          <div>
            <strong>
              Finding
            </strong>

            <p>
              {deviation.provisional
                ? "Provisional"
                : "Confirmed"}
            </p>
          </div>
        </div>


        {moveLabel && (
          <div className="detail-group">
            <h3>
              Conformance Move
            </h3>

            <p>
              {moveLabel}
            </p>
          </div>
        )}


        {/* ============================================ */}
        {/* ACTUAL ACTIVITIES */}
        {/* ============================================ */}

        <div className="detail-group">
          <h3>
            Actual activities
          </h3>

          {deviation
            .actualActivityIds
            .length === 0 ? (
            <p>
              No actual activity assigned.
            </p>
          ) : (
            <ul>
              {deviation
                .actualActivityIds
                .map(
                  (
                    activityId
                  ) => (
                    <li
                      key={
                        activityId
                      }
                    >
                      {activityId}
                    </li>
                  )
                )}
            </ul>
          )}
        </div>


        {/* ============================================ */}
        {/* EXPECTED ACTIVITIES */}
        {/* ============================================ */}

        <div className="detail-group">
          <h3>
            Expected reference activities
          </h3>

          {deviation
            .expectedReferenceActivityIds
            .length === 0 ? (
            <p>
              No expected reference activity assigned.
            </p>
          ) : (
            <ul>
              {deviation
                .expectedReferenceActivityIds
                .map(
                  (
                    activityId
                  ) => (
                    <li
                      key={
                        activityId
                      }
                    >
                      {activityId}
                    </li>
                  )
                )}
            </ul>
          )}
        </div>


        {/* ============================================ */}
        {/* TECHNICAL IDS */}
        {/* ============================================ */}

        <details className="technical-details">
          <summary>
            Technical details
          </summary>

          <dl>
            <dt>
              Reference process ID
            </dt>

            <dd>
              {
                deviation
                  .referenceProcessId
              }
            </dd>

            <dt>
              Conformance run
            </dt>

            <dd>
              {
                deviation
                  .sourceConformanceRunId
              }
            </dd>

            <dt>
              First detected
            </dt>

            <dd>
              {new Date(
                deviation.firstDetectedAt
              ).toLocaleString()}
            </dd>
          </dl>
        </details>
      </section>


      {/* ============================================== */}
      {/* EMPLOYEE INVESTIGATION */}
      {/* ============================================== */}

      <section className="investigation-section">
        <div className="investigation-section-header">
          <div>
            <h2>
              Employee context
            </h2>

            <p>
              Neutral facts collected during the interview about the
              actual way of working.
            </p>
          </div>

          {investigation && (
            <span>
              {investigation.status ===
              "complete"
                ? "Complete"
                : "In progress"}
            </span>
          )}
        </div>


        {!investigation ? (
          <div className="empty-inline">
            No investigation has been started for this finding yet.
          </div>
        ) : (
          <>
            <dl className="investigation-facts">
              <dt>
                Reason
              </dt>

              <dd>
                {displayValue(
                  facts?.reason
                )}
              </dd>


              <dt>
                Since when
              </dt>

              <dd>
                {displayValue(
                  facts?.sinceWhen
                )}
              </dd>


              <dt>
                Frequency
              </dt>

              <dd>
                {displayValue(
                  facts?.frequency
                )}
              </dd>


              <dt>
                Expected practice
              </dt>

              <dd>
                {displayValue(
                  facts?.expectedPractice
                )}
              </dd>


              <dt>
                Goal / motivation
              </dt>

              <dd>
                {displayValue(
                  facts?.goalOrMotivation
                )}
              </dd>


              <dt>
                Awareness
              </dt>

              <dd>
                {displayValue(
                  facts?.awareness
                )}
              </dd>


              <dt>
                Documented
              </dt>

              <dd>
                {displayValue(
                  facts?.documented
                )}
              </dd>


              <dt>
                Approved
              </dt>

              <dd>
                {displayValue(
                  facts?.approved
                )}
              </dd>


              <dt>
                Consequence without this practice
              </dt>

              <dd>
                {displayValue(
                  facts
                    ?.consequenceWithoutPractice
                )}
              </dd>
            </dl>


            {/* ======================================== */}
            {/* MISSING INFORMATION */}
            {/* ======================================== */}

            {investigation
              .missingFields
              .length > 0 && (
              <div className="missing-information">
                <h3>
                  Still to be collected
                </h3>

                <ul>
                  {investigation
                    .missingFields
                    .map(
                      (
                        field
                      ) => (
                        <li
                          key={
                            field
                          }
                        >
                          {investigationFieldLabel(
                            field
                          )}
                        </li>
                      )
                    )}
                </ul>
              </div>
            )}
          </>
        )}
      </section>


      {/* ============================================== */}
      {/* OWNER REVIEW */}
      {/* ============================================== */}

      <section className="investigation-section owner-review">
        <h2>
          Process-owner assessment
        </h2>

        <p>
          The conformance finding is not automatically a workaround.
          Assess the actual practice based on the finding and the
          information collected in context.
        </p>


        {/* ============================================ */}
        {/* CURRENT REVIEW */}
        {/* ============================================ */}

        {review ? (
          <div className="current-review">
            <span>
              Current decision
            </span>

            <strong>
              {decisionLabel(
                review.decision
              )}
            </strong>

            {review.comment && (
              <p>
                {review.comment}
              </p>
            )}

            <small>
              Reviewed on:{" "}
              {new Date(
                review.reviewedAt
              ).toLocaleString()}
            </small>
          </div>
        ) : (
          <div className="current-review empty-review">
            No process-owner assessment has been made yet.
          </div>
        )}


        {/* ============================================ */}
        {/* COMMENT */}
        {/* ============================================ */}

        <label className="owner-comment">
          Comment

          <textarea
            value={
              comment
            }

            disabled={
              saving
            }

            placeholder={
              "Optional comment on the assessment"
            }

            onChange={
              (
                event
              ) =>
                setComment(
                  event.target.value
                )
            }
          />
        </label>


        {/* ============================================ */}
        {/* ERROR */}
        {/* ============================================ */}

        {error && (
          <div
            className="error-message"
            role="alert"
          >
            {error}
          </div>
        )}


        {/* ============================================ */}
        {/* PROVISIONAL INFO */}
        {/* ============================================ */}

        {deviation.provisional && (
          <p className="owner-review-hint">
            A final classification is disabled while the technical finding
            is still provisional. Additional information can already be requested.
          </p>
        )}


        {/* ============================================ */}
        {/* OWNER ACTIONS */}
        {/* ============================================ */}

        <div className="owner-review-actions">
          <button
            type="button"

            disabled={
              finalDecisionDisabled
            }

            onClick={
              () =>
                void submitDecision(
                  "confirmed_workaround"
                )
            }
          >
            Confirm workaround
          </button>


          <button
            type="button"

            disabled={
              finalDecisionDisabled
            }

            onClick={
              () =>
                void submitDecision(
                  "accepted_variant"
                )
            }
          >
            Accept valid variant
          </button>


          <button
            type="button"

            disabled={
              finalDecisionDisabled
            }

            onClick={
              () =>
                void submitDecision(
                  "model_outdated"
                )
            }
          >
            Reference model outdated
          </button>


          <button
            type="button"

            disabled={
              finalDecisionDisabled
            }

            onClick={
              () =>
                void submitDecision(
                  "not_a_workaround"
                )
            }
          >
            Not a workaround
          </button>


          <button
            type="button"

            disabled={
              saving
            }

            onClick={
              () =>
                void submitDecision(
                  "needs_information"
                )
            }
          >
            Additional information needed
          </button>
        </div>
      </section>
    </section>
  );
}