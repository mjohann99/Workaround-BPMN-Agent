import {
  type ActivityMapping,
  type ProcessModel
} from "../types.js";

import {
  type ElicitedTraceVariant
} from "../conformance/trace-builder.js";

import {
  type ReferenceProcessVersion
} from "./types.js";


// ======================================================
// TYPES
// ======================================================

type ReferenceTask =
  Extract<
    ProcessModel["elements"][number],
    {
      type:
        "task";
    }
  >;

type ActivityMatchCandidate = {
  task:
    ReferenceTask;

  confidence:
    number;

  method:
    | "exact"
    | "normalized"
    | "token_similarity";
};

export type ActivityMatcherOptions = {
  /**
   * Minimum similarity required before a token-based
   * candidate is accepted as a mapping.
   *
   * Below this threshold the activity remains unmatched.
   */
  minimumTokenSimilarity?:
    number;
};


// ======================================================
// DEFAULTS
// ======================================================

/**
 * Version 1 is deliberately conservative.
 *
 * A low-similarity match should remain unmatched rather
 * than creating a misleading mapping for conformance.
 */
export const DEFAULT_MINIMUM_TOKEN_SIMILARITY =
  0.6;


/**
 * Mapping confidence required before a mapping should be
 * considered reliable enough for later conformance use.
 *
 * IMPORTANT:
 *
 * This threshold does NOT classify deviations or
 * workarounds.
 */
export const DEFAULT_RELIABLE_MAPPING_CONFIDENCE =
  0.75;


// ======================================================
// STOP WORDS
// ======================================================
//
// Task labels are already expected to be concise
// verb-object labels.
//
// We nevertheless remove common grammatical words so
// that:
//
// "Bestellung in SAP prüfen"
//
// and
//
// "Bestellung prüfen"
//
// have a higher semantic token overlap.
//
// Systems should normally already be stored separately
// in ProcessModel task metadata.
// ======================================================

const STOP_WORDS =
  new Set<string>([
    // German
    "der",
    "die",
    "das",
    "den",
    "dem",
    "des",
    "ein",
    "eine",
    "einen",
    "einem",
    "einer",
    "und",
    "oder",
    "in",
    "im",
    "an",
    "am",
    "auf",
    "mit",
    "zu",
    "zur",
    "zum",
    "von",
    "vom",
    "für",

    // English
    "the",
    "a",
    "an",
    "and",
    "or",
    "in",
    "on",
    "with",
    "to",
    "of",
    "for"
  ]);


// ======================================================
// NORMALIZATION
// ======================================================

function normalizeLabel(
  value:
    string
): string {
  return value
    .toLowerCase()
    .replace(
      /[^a-zäöüß0-9]+/gi,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function tokenize(
  value:
    string
): string[] {
  return normalizeLabel(
    value
  )
    .split(
      /\s+/
    )
    .filter(
      Boolean
    )
    .filter(
      (
        token
      ) =>
        !STOP_WORDS.has(
          token
        )
    );
}


// ======================================================
// TOKEN SIMILARITY
// ======================================================

function jaccardSimilarity(
  left:
    string[],

  right:
    string[]
): number {
  const leftSet =
    new Set(
      left
    );

  const rightSet =
    new Set(
      right
    );

  if (
    leftSet.size ===
      0 ||
    rightSet.size ===
      0
  ) {
    return 0;
  }

  let intersection =
    0;

  for (
    const token of
    leftSet
  ) {
    if (
      rightSet.has(
        token
      )
    ) {
      intersection +=
        1;
    }
  }

  const union =
    new Set([
      ...leftSet,
      ...rightSet
    ]).size;

  if (
    union ===
    0
  ) {
    return 0;
  }

  return (
    intersection /
    union
  );
}


// ======================================================
// METHOD PRIORITY
// ======================================================
//
// Used only for deterministic tie-breaking.
// ======================================================

function methodPriority(
  method:
    ActivityMatchCandidate["method"]
): number {
  switch (
    method
  ) {
    case "exact":
      return 3;

    case "normalized":
      return 2;

    case "token_similarity":
      return 1;
  }
}


// ======================================================
// SCORE ONE REFERENCE TASK
// ======================================================

function scoreReferenceTask(
  actualLabel:
    string,

  referenceTask:
    ReferenceTask
): ActivityMatchCandidate {
  const actualTrimmed =
    actualLabel.trim();

  const referenceTrimmed =
    referenceTask
      .name
      .trim();


  // ----------------------------------------------------
  // EXACT
  // ----------------------------------------------------

  if (
    actualTrimmed ===
    referenceTrimmed
  ) {
    return {
      task:
        referenceTask,

      confidence:
        1,

      method:
        "exact"
    };
  }


  // ----------------------------------------------------
  // NORMALIZED
  // ----------------------------------------------------

  const actualNormalized =
    normalizeLabel(
      actualTrimmed
    );

  const referenceNormalized =
    normalizeLabel(
      referenceTrimmed
    );

  if (
    actualNormalized &&
    actualNormalized ===
      referenceNormalized
  ) {
    return {
      task:
        referenceTask,

      confidence:
        0.98,

      method:
        "normalized"
    };
  }


  // ----------------------------------------------------
  // TOKEN SIMILARITY
  // ----------------------------------------------------

  const confidence =
    jaccardSimilarity(
      tokenize(
        actualNormalized
      ),

      tokenize(
        referenceNormalized
      )
    );

  return {
    task:
      referenceTask,

    confidence,

    method:
      "token_similarity"
  };
}


// ======================================================
// FIND BEST REFERENCE TASK
// ======================================================

function findBestReferenceTask(
  actualLabel:
    string,

  referenceTasks:
    ReferenceTask[]
): ActivityMatchCandidate | undefined {
  if (
    referenceTasks.length ===
    0
  ) {
    return undefined;
  }

  const candidates =
    referenceTasks
      .map(
        (
          referenceTask
        ) =>
          scoreReferenceTask(
            actualLabel,
            referenceTask
          )
      )
      .sort(
        (
          left,
          right
        ) => {
          // --------------------------------------------
          // Higher confidence first
          // --------------------------------------------

          const confidenceDifference =
            right.confidence -
            left.confidence;

          if (
            confidenceDifference !==
            0
          ) {
            return confidenceDifference;
          }


          // --------------------------------------------
          // Exact > normalized > token similarity
          // --------------------------------------------

          const methodDifference =
            methodPriority(
              right.method
            ) -
            methodPriority(
              left.method
            );

          if (
            methodDifference !==
            0
          ) {
            return methodDifference;
          }


          // --------------------------------------------
          // Deterministic final tie-break
          // --------------------------------------------

          return left.task.id
            .localeCompare(
              right.task.id
            );
        }
      );

  return candidates[0];
}


// ======================================================
// MAP TRACE ACTIVITIES
// ======================================================
//
// Maps every actual employee activity from the elicited
// trace to at most one reference-process task.
//
// IMPORTANT:
//
// This function ONLY creates ActivityMapping objects.
//
// It does NOT:
// - create deviations
// - create workaround candidates
// - classify anything
// - modify ProcessModel
// ======================================================

export function mapTraceActivities(
  trace:
    ElicitedTraceVariant,

  reference:
    ReferenceProcessVersion,

  options:
    ActivityMatcherOptions = {}
): ActivityMapping[] {
  const minimumTokenSimilarity =
    options
      .minimumTokenSimilarity ??
    DEFAULT_MINIMUM_TOKEN_SIMILARITY;


  // ====================================================
  // REFERENCE TASKS
  // ====================================================

  const referenceTasks =
    reference.process
      .elements
      .filter(
        (
          element
        ): element is ReferenceTask =>
          element.type ===
          "task"
      );


  // ====================================================
  // MAP EVERY ACTUAL TRACE ACTIVITY
  // ====================================================

  return trace.activityIds
    .map(
      (
        actualActivityId,
        index
      ): ActivityMapping => {
        const actualLabel =
          trace.labels[
            index
          ] ??
          "";


        // ----------------------------------------------
        // No actual label
        // ----------------------------------------------

        if (
          !actualLabel.trim()
        ) {
          return {
            actualActivityId,

            actualLabel,

            referenceProcessId:
              reference
                .referenceProcessId,

            referenceProcessVersion:
              reference.version,

            confidence:
              0,

            method:
              "unmatched"
          };
        }


        // ----------------------------------------------
        // Find best reference activity
        // ----------------------------------------------

        const best =
          findBestReferenceTask(
            actualLabel,
            referenceTasks
          );


        // ----------------------------------------------
        // No reference tasks available
        // ----------------------------------------------

        if (
          !best
        ) {
          return {
            actualActivityId,

            actualLabel,

            referenceProcessId:
              reference
                .referenceProcessId,

            referenceProcessVersion:
              reference.version,

            confidence:
              0,

            method:
              "unmatched"
          };
        }


        // ----------------------------------------------
        // Exact / normalized mappings are always accepted
        // ----------------------------------------------

        if (
          best.method ===
            "exact" ||
          best.method ===
            "normalized"
        ) {
          return {
            actualActivityId,

            actualLabel,

            referenceProcessId:
              reference
                .referenceProcessId,

            referenceProcessVersion:
              reference.version,

            referenceActivityId:
              best.task.id,

            referenceLabel:
              best.task.name,

            confidence:
              best.confidence,

            method:
              best.method
          };
        }


        // ----------------------------------------------
        // Token similarity below minimum:
        //
        // explicitly UNMATCHED.
        //
        // We do not guess.
        // ----------------------------------------------

        if (
          best.confidence <
          minimumTokenSimilarity
        ) {
          return {
            actualActivityId,

            actualLabel,

            referenceProcessId:
              reference
                .referenceProcessId,

            referenceProcessVersion:
              reference.version,

            confidence:
              0,

            method:
              "unmatched"
          };
        }


        // ----------------------------------------------
        // Accepted token-similarity mapping
        // ----------------------------------------------

        return {
          actualActivityId,

          actualLabel,

          referenceProcessId:
            reference
              .referenceProcessId,

          referenceProcessVersion:
            reference.version,

          referenceActivityId:
            best.task.id,

          referenceLabel:
            best.task.name,

          confidence:
            best.confidence,

          method:
            "token_similarity"
        };
      }
    );
}


// ======================================================
// RELIABILITY CHECK
// ======================================================
//
// Conformance code can use this helper later.
//
// A mapping can exist while still being uncertain.
//
// Example:
//
// confidence = 0.67
//
// means:
// "best available mapping candidate"
//
// NOT:
// "this is definitely the corresponding reference task"
//
// Most importantly:
// uncertain mapping != deviation != workaround
// ======================================================

export function isActivityMappingReliable(
  mapping:
    ActivityMapping,

  minimumConfidence:
    number =
      DEFAULT_RELIABLE_MAPPING_CONFIDENCE
): boolean {
  return (
    mapping.method !==
      "unmatched" &&

    mapping.referenceActivityId !==
      undefined &&

    mapping.confidence >=
      minimumConfidence
  );
}