import {
  randomUUID
} from "node:crypto";

import {
  isActivityMappingReliable
} from "../reference/activity-matcher.js";

import {
  type ActivityMapping,
  type ConformanceRun,
  type DeviationCandidate,
  type ProcessModel
} from "../types.js";


// ======================================================
// INPUT
// ======================================================

export type MapDeviationsInput = {
  run:
  ConformanceRun;

  actualProcess:
  ProcessModel;

  referenceProcess:
  ProcessModel;

  mappings:
  ActivityMapping[];

  /**
   * Deviations are only investigated when reference
   * identification is considered stable.
   */
  referenceStable:
  boolean;
};


// ======================================================
// HELPERS
// ======================================================

function normalizeValue(
  value:
    string
): string {
  return value
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    );
}


function findTask(
  process:
    ProcessModel,

  id:
    string
):
  | Extract<
    ProcessModel["elements"][number],
    {
      type:
      "task";
    }
  >
  | undefined {
  const element =
    process.elements
      .find(
        (
          candidate
        ) =>
          candidate.id ===
          id
      );

  if (
    !element ||
    element.type !==
    "task"
  ) {
    return undefined;
  }

  return element;
}


function findLaneName(
  process:
    ProcessModel,

  laneId:
    string | undefined
): string | undefined {
  if (
    !laneId
  ) {
    return undefined;
  }

  return process.lanes
    .find(
      (
        lane
      ) =>
        lane.id ===
        laneId
    )
    ?.name;
}


// ======================================================
// DEVIATION FACTORY
// ======================================================

function createDeviation(
  params: {
    run:
    ConformanceRun;

    detectionMethod:
    DeviationCandidate[
    "detectionMethod"
    ];

    provisional:
    boolean;

    dimension:
    DeviationCandidate[
    "dimension"
    ];

    moveType?:
    DeviationCandidate[
    "moveType"
    ];

    actualActivityIds:
    string[];

    expectedReferenceActivityIds:
    string[];

    description:
    string;
  }
): DeviationCandidate {
  return {
    id:
      randomUUID(),

    referenceProcessId:
      params.run
        .referenceProcessId,

    referenceProcessVersion:
      params.run
        .referenceProcessVersion,

    sourceConformanceRunId:
      params.run.id,

    detectionMethod:
      params.detectionMethod,

    provisional:
      params.provisional,

    dimension:
      params.dimension,

    ...(
      params.moveType
        ? {
          moveType:
            params.moveType
        }
        : {}
    ),

    actualActivityIds:
      params.actualActivityIds,

    expectedReferenceActivityIds:
      params
        .expectedReferenceActivityIds,

    description:
      params.description,

    firstDetectedAt:
      new Date()
        .toISOString(),

    status:
      "open"
  };
}


// ======================================================
// DUPLICATE PREVENTION WITHIN ONE RUN
// ======================================================

function deviationKey(
  deviation:
    DeviationCandidate
): string {
  return [
    deviation.dimension,

    deviation.moveType ??
    "-",

    [
      ...deviation
        .actualActivityIds
    ]
      .sort()
      .join(","),

    [
      ...deviation
        .expectedReferenceActivityIds
    ]
      .sort()
      .join(",")
  ].join(
    "|"
  );
}


// ======================================================
// CONTROL-FLOW DEVIATIONS
// ======================================================

function mapControlFlowDeviations(
  run:
    ConformanceRun,

  mappings:
    ActivityMapping[]
): DeviationCandidate[] {
  const result:
    DeviationCandidate[] =
    [];

  const mappingByActualId =
    new Map(
      mappings.map(
        (
          mapping
        ) => [
          mapping.actualActivityId,
          mapping
        ] as const
      )
    );


  for (
    const move of
    run.moves
  ) {
    // --------------------------------------------------
    // SYNCHRONOUS MOVE
    // --------------------------------------------------
    //
    // Explicitly NOT a deviation.
    // --------------------------------------------------

    if (
      move.type ===
      "synchronous"
    ) {
      continue;
    }


// --------------------------------------------------
// MOVE ON LOG
// --------------------------------------------------
//
// Unexpected actual activity.
//
// During an unfinished interview this may already
// produce a PROVISIONAL deviation.
//
// Two cases are admissible:
//
// 1. The actual activity has a reliable mapping to a
//    reference activity, but occurs at a position where
//    the reference process does not accept it.
//
// 2. The actual activity is explicitly UNMATCHED.
//    This means no suitable reference activity exists.
//    If PM4Py reports it as a log_move, this is precisely
//    evidence for an additional actual activity.
//
// An uncertain mapping to a concrete reference activity
// must NOT become a deviation.
// --------------------------------------------------

if (
  move.type ===
  "log_move"
) {
  // ==================================================
  // ACTUAL ACTIVITY REQUIRED
  // ==================================================

  if (
    !move.actualActivityId
  ) {
    continue;
  }


  // ==================================================
  // ACTIVITY MAPPING REQUIRED
  // ==================================================

  const mapping =
    mappingByActualId.get(
      move.actualActivityId
    );


  if (
    !mapping
  ) {
    /**
     * No mapping record at all means that the activity
     * mapping pipeline is incomplete.
     *
     * Do not infer a deviation from missing analysis
     * data.
     */
    continue;
  }


  // ==================================================
  // RELIABLE REFERENCE MAPPING
  // ==================================================
  //
  // Example:
  //
  // Actual activity maps confidently to reference task,
  // but PM4Py still reports a log move at this position.
  // ==================================================

  const reliableReferenceMapping =
    isActivityMappingReliable(
      mapping
    ) &&
    Boolean(
      mapping.referenceActivityId
    ) &&
    Boolean(
      mapping.referenceLabel
    );


  // ==================================================
  // EXPLICITLY UNMATCHED ACTUAL ACTIVITY
  // ==================================================
  //
  // Example:
  //
  // Actual:
  //   "Daten nach Excel exportieren"
  //
  // Reference:
  //   no corresponding task
  //
  // Mapping:
  //   method = "unmatched"
  //   confidence = 0
  //
  // This does NOT mean "uncertain".
  //
  // It means:
  // "No reference activity was selected."
  //
  // If PM4Py additionally reports this as a log_move,
  // we have technical evidence for an additional
  // actual activity.
  // ==================================================

  const explicitlyUnmatched =
    mapping.method ===
      "unmatched" &&
    !mapping.referenceActivityId &&
    !mapping.referenceLabel;


  // ==================================================
  // UNCERTAIN CONCRETE MAPPING
  // ==================================================
  //
  // Example:
  //
  // method = token_similarity
  // confidence = 0.42
  //
  // That is ambiguous mapping evidence and must not be
  // promoted to a deviation.
  // ==================================================

  if (
    !reliableReferenceMapping &&
    !explicitlyUnmatched
  ) {
    continue;
  }


  // ==================================================
  // EXPECTED REFERENCE ACTIVITIES
  // ==================================================
  //
  // For an explicitly unmatched activity there is no
  // expected reference activity to attach.
  // ==================================================

  const expectedReferenceActivityIds =
    reliableReferenceMapping &&
    mapping.referenceActivityId
      ? [
          mapping.referenceActivityId
        ]
      : [];


  // ==================================================
  // DESCRIPTION
  // ==================================================

  const actualLabel =
    move.actualLabel ??
    mapping.actualLabel;


  const description =
    explicitlyUnmatched
      ? (
          `Actual activity "${actualLabel}" has no matching activity ` +
          "in the selected reference process and was observed as an " +
          "additional log move."
        )
      : (
          `Actual activity "${actualLabel}" occurred at a point where ` +
          "the selected reference process did not accept it."
        );


  // ==================================================
  // CREATE DEVIATION
  // ==================================================

  result.push(
    createDeviation({
      run,

      detectionMethod:
        run.method,

      provisional:
        !run.complete,

      dimension:
        "control_flow",

      moveType:
        "log_move",

      actualActivityIds: [
        move.actualActivityId
      ],

      expectedReferenceActivityIds,

      description
    })
  );


  continue;
}

    // --------------------------------------------------
    // MOVE ON MODEL
    // --------------------------------------------------
    //
    // CRITICAL:
    //
    // Never interpret model moves from an unfinished
    // interview as missing activities.
    // --------------------------------------------------

    if (
      move.type ===
      "model_move"
    ) {
      if (
        !run.complete ||
        run.method !==
        "alignment"
      ) {
        continue;
      }

      if (
        !move.referenceActivityId
      ) {
        /**
         * Do not create an ambiguous deviation if the
         * expected reference activity cannot be
         * identified.
         */
        continue;
      }

      result.push(
        createDeviation({
          run,

          detectionMethod:
            "alignment",

          provisional:
            false,

          dimension:
            "control_flow",

          moveType:
            "model_move",

          actualActivityIds:
            [],

          expectedReferenceActivityIds: [
            move.referenceActivityId
          ],

          description:
            (
              `Reference activity "${move.referenceLabel ?? move.referenceActivityId}" ` +
              "was expected by the selected reference process but did not " +
              "occur in the completed actual trace."
            )
        })
      );
    }
  }

  return result;
}


// ======================================================
// SYSTEM DEVIATIONS
// ======================================================

function mapSystemDeviations(
  run:
    ConformanceRun,

  actualProcess:
    ProcessModel,

  referenceProcess:
    ProcessModel,

  mappings:
    ActivityMapping[]
): DeviationCandidate[] {
  const result:
    DeviationCandidate[] =
    [];

  for (
    const mapping of
    mappings
  ) {
    if (
      !isActivityMappingReliable(
        mapping
      ) ||
      !mapping.referenceActivityId
    ) {
      continue;
    }

    const actualTask =
      findTask(
        actualProcess,
        mapping.actualActivityId
      );

    const referenceTask =
      findTask(
        referenceProcess,
        mapping.referenceActivityId
      );

    if (
      !actualTask ||
      !referenceTask
    ) {
      continue;
    }


    // --------------------------------------------------
    // CONSERVATIVE V1 RULE
    // --------------------------------------------------
    //
    // If one side has no system information, we treat
    // this as missing information rather than deviation.
    // --------------------------------------------------

    if (
      !actualTask.system ||
      !referenceTask.system
    ) {
      continue;
    }

    if (
      normalizeValue(
        actualTask.system
      ) ===
      normalizeValue(
        referenceTask.system
      )
    ) {
      continue;
    }

    result.push(
      createDeviation({
        run,

        detectionMethod:
          "perspective_check",

        provisional:
          !run.complete,

        dimension:
          "system",

        actualActivityIds: [
          actualTask.id
        ],

        expectedReferenceActivityIds: [
          referenceTask.id
        ],

        description:
          (
            `Activity "${actualTask.name}" uses system ` +
            `"${actualTask.system}" in the actual process, while ` +
            `the mapped reference activity uses "${referenceTask.system}".`
          )
      })
    );
  }

  return result;
}


// ======================================================
// LANE DEVIATIONS
// ======================================================

function mapLaneDeviations(
  run:
    ConformanceRun,

  actualProcess:
    ProcessModel,

  referenceProcess:
    ProcessModel,

  mappings:
    ActivityMapping[]
): DeviationCandidate[] {
  const result:
    DeviationCandidate[] =
    [];

  for (
    const mapping of
    mappings
  ) {
    if (
      !isActivityMappingReliable(
        mapping
      ) ||
      !mapping.referenceActivityId
    ) {
      continue;
    }

    const actualTask =
      findTask(
        actualProcess,
        mapping.actualActivityId
      );

    const referenceTask =
      findTask(
        referenceProcess,
        mapping.referenceActivityId
      );

    if (
      !actualTask ||
      !referenceTask
    ) {
      continue;
    }

    const actualLane =
      findLaneName(
        actualProcess,
        actualTask.laneId
      );

    const referenceLane =
      findLaneName(
        referenceProcess,
        referenceTask.laneId
      );


    // --------------------------------------------------
    // UNKNOWN RESPONSIBILITY != DEVIATION
    // --------------------------------------------------

    if (
      !actualLane ||
      !referenceLane
    ) {
      continue;
    }

    if (
      normalizeValue(
        actualLane
      ) ===
      normalizeValue(
        referenceLane
      )
    ) {
      continue;
    }

    result.push(
      createDeviation({
        run,

        detectionMethod:
          "perspective_check",

        provisional:
          !run.complete,

        dimension:
          "lane",

        actualActivityIds: [
          actualTask.id
        ],

        expectedReferenceActivityIds: [
          referenceTask.id
        ],

        description:
          (
            `Activity "${actualTask.name}" is assigned to ` +
            `"${actualLane}" in the actual process, while the ` +
            `mapped reference activity is assigned to "${referenceLane}".`
          )
      })
    );
  }

  return result;
}


// ======================================================
// PUBLIC API
// ======================================================

export function mapConformanceRunToDeviations(
  input:
    MapDeviationsInput
): DeviationCandidate[] {
  const {
    run,
    actualProcess,
    referenceProcess,
    mappings,
    referenceStable
  } =
    input;


  // ====================================================
  // REFERENCE MUST BE STABLE
  // ====================================================
  //
  // A tentative reference-process identification must
  // not trigger an investigation.
  // ====================================================

  if (
    !referenceStable
  ) {
    return [];
  }


  // ====================================================
  // ONLY MAPPINGS FOR THIS REFERENCE VERSION
  // ====================================================

  const currentMappings =
    mappings.filter(
      (
        mapping
      ) =>
        mapping
          .referenceProcessId ===
        run.referenceProcessId &&

        mapping
          .referenceProcessVersion ===
        run.referenceProcessVersion
    );


  // ====================================================
  // COLLECT DEVIATIONS
  // ====================================================

  const candidates = [
    ...mapControlFlowDeviations(
      run,
      currentMappings
    ),

    ...mapSystemDeviations(
      run,
      actualProcess,
      referenceProcess,
      currentMappings
    ),

    ...mapLaneDeviations(
      run,
      actualProcess,
      referenceProcess,
      currentMappings
    )
  ];


  // ====================================================
  // DEDUPLICATE WITHIN CURRENT RUN
  // ====================================================

  const seen =
    new Set<
      string
    >();

  return candidates.filter(
    (
      candidate
    ) => {
      const key =
        deviationKey(
          candidate
        );

      if (
        seen.has(
          key
        )
      ) {
        return false;
      }

      seen.add(
        key
      );

      return true;
    }
  );
}