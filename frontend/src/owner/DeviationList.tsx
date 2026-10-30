import {
  type DeviationCandidate
} from "../types";

type Props = {
  deviations:
    DeviationCandidate[];

  selectedDeviationId?:
    string;

  onSelect: (
    deviationId: string
  ) => void;
};


// ======================================================
// LABEL HELPERS
// ======================================================

function dimensionLabel(
  dimension:
    DeviationCandidate["dimension"]
): string {
  switch (dimension) {
    case "control_flow":
      return "Control flow";

    case "lane":
      return "Responsibility";

    case "participant":
      return "Participant";

    case "system":
      return "System";

    case "message_flow":
      return "Communication";

    default:
      return dimension;
  }
}


function statusLabel(
  status:
    DeviationCandidate["status"]
): string {
  switch (status) {
    case "open":
      return "Open";

    case "information_complete":
      return "Information complete";

    case "reviewed":
      return "Reviewed";

    default:
      return status;
  }
}


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


function detectionMethodLabel(
  method:
    DeviationCandidate["detectionMethod"]
): string {
  switch (method) {
    case "prefix_tbr":
      return "Prefix token replay";

    case "alignment":
      return "Alignment";

    case "perspective_check":
      return "Perspective check";

    default:
      return method;
  }
}


// ======================================================
// SINGLE DEVIATION CARD
// ======================================================

type DeviationCardProps = {
  deviation:
    DeviationCandidate;

  selected:
    boolean;

  onSelect: () => void;
};


function DeviationCard({
  deviation,
  selected,
  onSelect
}: DeviationCardProps):
  JSX.Element {
  const moveLabel =
    moveTypeLabel(
      deviation.moveType
    );

  const actualActivityCount =
    deviation
      .actualActivityIds
      .length;

  const expectedActivityCount =
    deviation
      .expectedReferenceActivityIds
      .length;

  return (
    <button
      type="button"
      className={
        selected
          ? "deviation-card selected"
          : "deviation-card"
      }
      onClick={
        onSelect
      }
    >
      {/* ============================================ */}
      {/* HEADER */}
      {/* ============================================ */}

      <div className="deviation-card-header">
        <strong>
          {dimensionLabel(
            deviation.dimension
          )}
        </strong>

        <span
          className={`deviation-status deviation-status-${deviation.status}`}
        >
          {statusLabel(
            deviation.status
          )}
        </span>
      </div>


      {/* ============================================ */}
      {/* DESCRIPTION */}
      {/* ============================================ */}

      <p className="deviation-description">
        {deviation.description}
      </p>


      {/* ============================================ */}
      {/* CONFORMANCE MOVE */}
      {/* ============================================ */}

      {moveLabel && (
        <div className="deviation-move">
          {moveLabel}
        </div>
      )}


      {/* ============================================ */}
      {/* ACTIVITY COUNTS */}
      {/* ============================================ */}

      <div className="deviation-activity-summary">
        {actualActivityCount > 0 && (
          <span>
            Actual:{" "}
            {actualActivityCount}{" "}
            {actualActivityCount === 1
              ? "activity"
              : "activities"}
          </span>
        )}

        {expectedActivityCount > 0 && (
          <span>
            Reference:{" "}
            {expectedActivityCount}{" "}
            {expectedActivityCount === 1
              ? "activity"
              : "activities"}
          </span>
        )}
      </div>


      {/* ============================================ */}
      {/* TECHNICAL META */}
      {/* ============================================ */}

      <div className="deviation-card-meta">
        <span>
          Version{" "}
          {
            deviation
              .referenceProcessVersion
          }
        </span>

        <span>
          {detectionMethodLabel(
            deviation.detectionMethod
          )}
        </span>

        {deviation.provisional && (
          <span className="deviation-provisional">
            Provisional
          </span>
        )}
      </div>
    </button>
  );
}


// ======================================================
// COMPONENT
// ======================================================

export function DeviationList({
  deviations,
  selectedDeviationId,
  onSelect
}: Props): JSX.Element {
  // ====================================================
  // EMPTY STATE
  // ====================================================

  if (
    deviations.length === 0
  ) {
    return (
      <div className="empty">
        No conformance deviations detected yet.
      </div>
    );
  }


  // ====================================================
  // SORT
  // ====================================================
  //
  // Open findings first.
  //
  // Then findings with complete employee information.
  //
  // Reviewed findings last.
  // ====================================================

  const statusPriority:
    Record<
      DeviationCandidate["status"],
      number
    > = {
    open:
      0,

    information_complete:
      1,

    reviewed:
      2
  };

  const sortedDeviations =
    [...deviations].sort(
      (
        left,
        right
      ) => {
        const statusDifference =
          statusPriority[
            left.status
          ] -
          statusPriority[
            right.status
          ];

        if (
          statusDifference !==
          0
        ) {
          return statusDifference;
        }

        return (
          new Date(
            right.firstDetectedAt
          ).getTime() -
          new Date(
            left.firstDetectedAt
          ).getTime()
        );
      }
    );


  // ====================================================
  // VIEW
  // ====================================================

  return (
    <div className="deviation-list">
      {sortedDeviations.map(
        (
          deviation
        ) => (
          <DeviationCard
            key={
              deviation.id
            }

            deviation={
              deviation
            }

            selected={
              deviation.id ===
              selectedDeviationId
            }

            onSelect={
              () =>
                onSelect(
                  deviation.id
                )
            }
          />
        )
      )}
    </div>
  );
}