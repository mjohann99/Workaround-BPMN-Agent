import {
  type ProcessCandidate,
  type ProcessCandidateScore,
  type ProcessModel
} from "../types.js";

import {
  type ReferenceProcessRecord
} from "./types.js";


// ======================================================
// IDENTIFICATION POLICY
// ======================================================
//
// Reference-process identification is NOT conformance
// checking.
//
// Additional actual activities are expected:
// they may be deviations and are exactly what the later
// conformance stage is supposed to detect.
//
// Therefore identification should primarily use positive
// evidence:
//
// - declared process name
// - strongest matching actual activities
//
// An additional AS-IS activity must not make the correct
// reference process impossible to identify.
// ======================================================

const ACTIVITY_EVIDENCE_COUNT =
  2;


// ======================================================
// NORMALIZATION
// ======================================================

function normalize(
  value:
    string
): string[] {
  return value
    .toLowerCase()
    .replace(
      /[^a-zäöüß0-9]+/gi,
      " "
    )
    .split(
      /\s+/
    )
    .filter(
      Boolean
    );
}


// ======================================================
// JACCARD TOKEN SIMILARITY
// ======================================================

function jaccard(
  left:
    string[],

  right:
    string[]
): number {
  const a =
    new Set(
      left
    );

  const b =
    new Set(
      right
    );

  const intersection =
    [...a]
      .filter(
        (
          token
        ) =>
          b.has(
            token
          )
      )
      .length;

  const union =
    new Set([
      ...a,
      ...b
    ])
      .size;

  return union ===
    0
    ? 0
    : intersection /
      union;
}


// ======================================================
// TASK LABELS
// ======================================================

function taskLabels(
  process:
    ProcessModel
): string[] {
  return process
    .elements
    .filter(
      (
        element
      ): element is Extract<
        ProcessModel["elements"][number],
        {
          type:
            "task";
        }
      > =>
        element.type ===
        "task"
    )
    .map(
      (
        task
      ) =>
        task.name
    );
}


// ======================================================
// BEST REFERENCE SIMILARITY FOR ONE ACTUAL ACTIVITY
// ======================================================

function bestReferenceActivitySimilarity(
  actualLabel:
    string,

  referenceLabels:
    string[]
): number {
  if (
    referenceLabels.length ===
    0
  ) {
    return 0;
  }

  return Math.max(
    ...referenceLabels.map(
      (
        referenceLabel
      ) =>
        jaccard(
          normalize(
            actualLabel
          ),

          normalize(
            referenceLabel
          )
        )
    )
  );
}


// ======================================================
// IDENTIFICATION ACTIVITY SIMILARITY
// ======================================================
//
// Important:
//
// Do NOT average over all actual activities.
//
// Example:
//
// Reference:
//   Bestellung öffnen
//   Kundendaten prüfen
//   Preise korrigieren
//
// Actual:
//   Bestellung öffnen
//   Kundendaten prüfen
//   Daten nach Excel exportieren
//
// "Daten nach Excel exportieren" may be exactly the
// deviation we want to discover.
//
// Penalising the reference-process identification for
// that additional activity would be circular:
//
// deviation
//   -> identification score drops
//   -> reference not selected
//   -> deviation can never be detected
//
// Instead we use the strongest two activity anchors.
// ======================================================

function identificationActivitySimilarity(
  actualLabels:
    string[],

  referenceLabels:
    string[]
): number {
  if (
    actualLabels.length ===
      0 ||
    referenceLabels.length ===
      0
  ) {
    return 0;
  }


  const similarities =
    actualLabels
      .map(
        (
          actualLabel
        ) =>
          bestReferenceActivitySimilarity(
            actualLabel,
            referenceLabels
          )
      )
      .sort(
        (
          left,
          right
        ) =>
          right -
          left
      );


  const evidenceCount =
    Math.min(
      ACTIVITY_EVIDENCE_COUNT,
      similarities.length
    );


  if (
    evidenceCount ===
    0
  ) {
    return 0;
  }


  const strongestEvidence =
    similarities.slice(
      0,
      evidenceCount
    );


  return (
    strongestEvidence.reduce(
      (
        sum,
        value
      ) =>
        sum +
        value,
      0
    ) /
    strongestEvidence.length
  );
}


// ======================================================
// SCORE ONE REFERENCE PROCESS
// ======================================================

export function scoreReferenceProcess(
  actualProcess:
    ProcessModel,

  declaredProcessName:
    string | undefined,

  reference:
    ReferenceProcessRecord
): ProcessCandidateScore {
  const actualTasks =
    taskLabels(
      actualProcess
    );


  const referenceTasks =
    taskLabels(
      reference
        .currentVersion
        .process
    );


  const nameCandidates = [
    reference
      .metadata
      .name,

    ...reference
      .metadata
      .aliases
  ];


  // ====================================================
  // NAME SIMILARITY
  // ====================================================

  const nameSimilarity =
    declaredProcessName
      ? Math.max(
          ...nameCandidates.map(
            (
              candidate
            ) =>
              jaccard(
                normalize(
                  declaredProcessName
                ),

                normalize(
                  candidate
                )
              )
          )
        )
      : 0;


  // ====================================================
  // ACTIVITY SIMILARITY
  // ====================================================

  const activitySimilarity =
    identificationActivitySimilarity(
      actualTasks,
      referenceTasks
    );


  // ====================================================
  // DYNAMIC WEIGHTS
  // ====================================================
  //
  // Only implemented dimensions receive weight.
  //
  // Previously part of the score was reserved for:
  //
  // - systemSimilarity
  // - laneSimilarity
  // - structureSimilarity
  //
  // although all three were hardcoded to zero.
  //
  // That artificially capped the maximum score.
  // ====================================================

  const taskCount =
    actualTasks.length;


  let nameWeight:
    number;


  let activityWeight:
    number;


  if (
    taskCount ===
    0
  ) {
    nameWeight =
      1;

    activityWeight =
      0;
  } else if (
    taskCount <
    3
  ) {
    nameWeight =
      0.45;

    activityWeight =
      0.55;
  } else {
    nameWeight =
      0.35;

    activityWeight =
      0.65;
  }


  // ====================================================
  // FUTURE PERSPECTIVES
  // ====================================================

  const systemSimilarity =
    0;

  const laneSimilarity =
    0;

  const structureSimilarity =
    0;


  // ====================================================
  // COMBINED SCORE
  // ====================================================

  const combinedScore =
    nameSimilarity *
      nameWeight +

    activitySimilarity *
      activityWeight;


  return {
    nameSimilarity,

    activitySimilarity,

    systemSimilarity,

    laneSimilarity,

    structureSimilarity,

    combinedScore
  };
}


// ======================================================
// BUILD AND RANK CANDIDATES
// ======================================================

export function rankReferenceProcesses(
  actualProcess:
    ProcessModel,

  declaredProcessName:
    string | undefined,

  references:
    ReferenceProcessRecord[]
): ProcessCandidate[] {
  return references
    .map(
      (
        reference
      ): ProcessCandidate => ({
        referenceProcessId:
          reference
            .metadata
            .id,

        referenceProcessVersion:
          reference
            .currentVersion
            .version,

        name:
          reference
            .metadata
            .name,

        score:
          scoreReferenceProcess(
            actualProcess,
            declaredProcessName,
            reference
          )
      })
    )
    .sort(
      (
        left,
        right
      ) => {
        const scoreDifference =
          right
            .score
            .combinedScore -
          left
            .score
            .combinedScore;


        if (
          scoreDifference !==
          0
        ) {
          return scoreDifference;
        }


        return left
          .referenceProcessId
          .localeCompare(
            right
              .referenceProcessId
          );
      }
    );
}