// ======================================================
// PROCESS IDENTIFICATION POLICY
// ======================================================
//
// These thresholds are prototype design parameters.
//
// They are NOT literature-derived universal constants.
//
// They control when hidden automatic reference-process
// identification may select or revise a candidate.
// ======================================================

export const IDENTIFICATION_POLICY = {
  minimumTasksForAutomaticSelection:
    2,

  strongScore:
    0.75,

  strongMargin:
    0.15,

  relaxedScoreAfterThreeTasks:
    0.65,

  relaxedMarginAfterThreeTasks:
    0.10,

  reevaluateUntilActivityCount:
    5,

  minimumSwitchAdvantage:
    0.20,

  lowConformanceThreshold:
    0.45,

  maximumAutomaticRevisions:
    2
} as const;


// ======================================================
// INITIAL AUTOMATIC SELECTION
// ======================================================

export function shouldSelectCandidate(
  taskCount:
    number,

  topScore:
    number,

  margin:
    number
): boolean {
  // ----------------------------------------------------
  // Never automatically select from process name alone.
  // ----------------------------------------------------

  if (
    taskCount <
    IDENTIFICATION_POLICY
      .minimumTasksForAutomaticSelection
  ) {
    return false;
  }


  // ----------------------------------------------------
  // Strong early evidence
  // ----------------------------------------------------

  if (
    topScore >=
      IDENTIFICATION_POLICY
        .strongScore &&

    margin >=
      IDENTIFICATION_POLICY
        .strongMargin
  ) {
    return true;
  }


  // ----------------------------------------------------
  // Relaxed threshold after at least three tasks
  // ----------------------------------------------------

  return (
    taskCount >=
      3 &&

    topScore >=
      IDENTIFICATION_POLICY
        .relaxedScoreAfterThreeTasks &&

    margin >=
      IDENTIFICATION_POLICY
        .relaxedMarginAfterThreeTasks
  );
}


// ======================================================
// AUTOMATIC REVISION
// ======================================================
//
// An automatically selected reference process may be
// revised while the interview is still young.
//
// An Owner-locked selection must NEVER be changed.
// ======================================================

export function shouldReviseSelection(
  currentScore:
    number,

  newTopScore:
    number,

  taskCount:
    number,

  revisionCount:
    number,

  lockedByOwner:
    boolean
): boolean {
  if (
    lockedByOwner
  ) {
    return false;
  }

  if (
    revisionCount >=
    IDENTIFICATION_POLICY
      .maximumAutomaticRevisions
  ) {
    return false;
  }

  if (
    taskCount >
    IDENTIFICATION_POLICY
      .reevaluateUntilActivityCount
  ) {
    return false;
  }

  return (
    newTopScore -
      currentScore >=
    IDENTIFICATION_POLICY
      .minimumSwitchAdvantage
  );
}


// ======================================================
// STABILITY
// ======================================================
//
// A reference process may be selected before it is
// considered stable.
//
// This distinction allows:
//
// selected
// -> mapping + conformance may already run
//
// stable
// -> neutral deviation investigation may begin
//
// V1:
// selection becomes stable after enough activities have
// been elicited, or when the allowed revision budget is
// exhausted.
// ======================================================

export function isAutomaticSelectionStable(
  taskCount:
    number,

  revisionCount:
    number
): boolean {
  return (
    taskCount >=
      IDENTIFICATION_POLICY
        .reevaluateUntilActivityCount ||

    revisionCount >=
      IDENTIFICATION_POLICY
        .maximumAutomaticRevisions
  );
}