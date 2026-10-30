import {
  randomUUID
} from "node:crypto";

import {
  getReferenceProcess
} from "../reference/repository.js";

import {
  isActivityMappingReliable
} from "../reference/activity-matcher.js";

import {
  addConformanceRun,
  getSession,
  reconcileCurrentDeviations
} from "../store.js";

import {
  type ActivityMapping,
  type ConformanceMove,
  type ConformanceRun,
  type ProcessModel
} from "../types.js";

import {
  type ElicitedTraceVariant
} from "./trace-builder.js";

import {
  runConformance
} from "./client.js";

import {
  mapConformanceRunToDeviations
} from "./deviation-mapper.js";


// ======================================================
// CONFORMANCE REPLAY POLICY
// ======================================================
//
// Mapping confidence needed to use an actual activity as
// a reference activity during replay.
//
// This can be lower than the confidence used for making
// perspective-deviation assertions.
//
// Example:
//
// "Bestellung öffnen"
// ↔
// "Bestellung in SAP öffnen"
//
// may be good enough for replay even if it is below the
// stricter deviation-classification threshold.
// ======================================================

const MINIMUM_REPLAY_MAPPING_CONFIDENCE =
  0.60;


// ======================================================
// UNMATCHED REPLAY LABEL
// ======================================================
//
// An actual activity that has no reference mapping must
// still reach PM4Py.
//
// A guaranteed non-reference label causes PM4Py to treat
// it as an actual-only/log move.
//
// We deliberately do NOT use the actual label directly,
// because a reference model could theoretically contain
// the same visible text.
// ======================================================

function unmatchedReplayLabel(
  actualActivityId:
    string
): string {
  return (
    "__WORKAROUND_CHECK_UNMATCHED__" +
    actualActivityId
  );
}


// ======================================================
// EXPLICITLY UNMATCHED MAPPING
// ======================================================
//
// Important distinction:
//
// method === "unmatched"
//
// means:
//
// "No reference activity was selected."
//
// This is different from:
//
// "We selected a reference activity, but with uncertain
// confidence."
//
// The first case is relevant evidence for a possible
// additional actual activity.
//
// The second remains too ambiguous for conservative
// replay.
// ======================================================

function isExplicitlyUnmatched(
  mapping:
    ActivityMapping
): boolean {
  return (
    mapping.method ===
      "unmatched" &&

    !mapping
      .referenceActivityId &&

    !mapping
      .referenceLabel
  );
}


// ======================================================
// RELIABLE ENOUGH FOR REPLAY
// ======================================================

function isReplayableReferenceMapping(
  mapping:
    ActivityMapping
): boolean {
  return (
    Boolean(
      mapping
        .referenceActivityId
    ) &&

    Boolean(
      mapping
        .referenceLabel
    ) &&

    isActivityMappingReliable(
      mapping,
      MINIMUM_REPLAY_MAPPING_CONFIDENCE
    )
  );
}


// ======================================================
// REFERENCE TASK LOOKUP
// ======================================================

function buildReferenceTaskIdsByLabel(
  processModel:
    ProcessModel
): Map<
  string,
  string | undefined
> {
  const idsByLabel =
    new Map<
      string,
      string[]
    >();


  for (
    const element of
    processModel.elements
  ) {
    if (
      element.type !==
      "task"
    ) {
      continue;
    }


    const current =
      idsByLabel.get(
        element.name
      ) ??
      [];


    current.push(
      element.id
    );


    idsByLabel.set(
      element.name,
      current
    );
  }


  const result =
    new Map<
      string,
      string | undefined
    >();


  for (
    const [
      label,
      ids
    ] of
    idsByLabel
  ) {
    result.set(
      label,

      ids.length ===
        1
        ? ids[0]
        : undefined
    );
  }


  return result;
}


// ======================================================
// ENRICH MOVES WITH REFERENCE IDS
// ======================================================

function enrichMoves(
  moves:
    ConformanceMove[],

  mappings:
    ActivityMapping[],

  referenceProcess:
    ProcessModel
): ConformanceMove[] {
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


  const referenceTaskIdsByLabel =
    buildReferenceTaskIdsByLabel(
      referenceProcess
    );


  return moves.map(
    (
      move
    ) => {
      // ==================================================
      // ACTUAL ACTIVITY MAPPING
      // ==================================================

      if (
        move.actualActivityId
      ) {
        const mapping =
          mappingByActualId.get(
            move.actualActivityId
          );


        if (
          mapping
            ?.referenceActivityId
        ) {
          return {
            ...move,

            referenceActivityId:
              mapping
                .referenceActivityId,

            referenceLabel:
              move.referenceLabel ??
              mapping.referenceLabel
          };
        }
      }


      // ==================================================
      // MODEL MOVE
      // ==================================================

      if (
        move.referenceLabel
      ) {
        const referenceActivityId =
          referenceTaskIdsByLabel
            .get(
              move.referenceLabel
            );


        if (
          referenceActivityId
        ) {
          return {
            ...move,

            referenceActivityId
          };
        }
      }


      return move;
    }
  );
}


// ======================================================
// REFRESH CONFORMANCE
// ======================================================

export async function refreshConformanceForSession(
  sessionId:
    string,

  trace:
    ElicitedTraceVariant
): Promise<
  ConformanceRun | undefined
> {
  try {
    const session =
      getSession(
        sessionId
      );


    if (
      !session
    ) {
      throw new Error(
        "Session not found while running conformance"
      );
    }


    // ==================================================
    // SELECTED REFERENCE
    // ==================================================

    const identification =
      session.analysis
        .processIdentification;


    const referenceProcessId =
      identification
        .selectedReferenceProcessId;


    const referenceProcessVersion =
      identification
        .selectedReferenceProcessVersion;


    if (
      !referenceProcessId ||
      referenceProcessVersion ===
        undefined
    ) {
      if (
        process.env.NODE_ENV !==
        "production"
      ) {
        console.info(
          "[workaround-check] conformance skipped: no selected reference process"
        );
      }

      return undefined;
    }


    // ==================================================
    // EMPTY TRACE
    // ==================================================

    if (
      trace.activityIds.length ===
      0
    ) {
      return undefined;
    }


    // ==================================================
    // MAPPINGS FOR EXACT REFERENCE VERSION
    // ==================================================

    const mappings =
      session.analysis
        .activityMappings
        .filter(
          (
            mapping
          ) =>
            mapping
              .referenceProcessId ===
              referenceProcessId &&

            mapping
              .referenceProcessVersion ===
              referenceProcessVersion
        );


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


    // ==================================================
    // FIND ACTUALLY BLOCKING MAPPINGS
    // ==================================================
    //
    // DO NOT block on:
    //
    // method === "unmatched"
    //
    // because an unmatched actual activity is exactly a
    // candidate for a PM4Py log move.
    //
    //
    // DO block when:
    //
    // - no ActivityMapping exists at all
    // - a reference activity was proposed, but confidence
    //   is too low for replay
    // ==================================================

    const blockingActivityIds =
      trace.activityIds
        .filter(
          (
            actualActivityId
          ) => {
            const mapping =
              mappingByActualId.get(
                actualActivityId
              );


            if (
              !mapping
            ) {
              return true;
            }


            if (
              isExplicitlyUnmatched(
                mapping
              )
            ) {
              return false;
            }


            return (
              !isReplayableReferenceMapping(
                mapping
              )
            );
          }
        );


    if (
      blockingActivityIds.length >
      0
    ) {
      if (
        process.env.NODE_ENV !==
        "production"
      ) {
        console.info(
          "[workaround-check] conformance skipped because mapped activities are too uncertain for replay:",
          blockingActivityIds
        );
      }


      return undefined;
    }


    // ==================================================
    // LOAD IMMUTABLE REFERENCE VERSION
    // ==================================================

    const reference =
      await getReferenceProcess(
        referenceProcessId,
        referenceProcessVersion
      );


    if (
      !reference
    ) {
      throw new Error(
        `Reference process ${referenceProcessId} version ${referenceProcessVersion} not found`
      );
    }


    // ==================================================
    // BUILD REPLAY TRACE
    // ==================================================
    //
    // Two cases:
    //
    // 1. Reliably mapped actual activity
    //
    //    actual:
    //      Kundendaten prüfen
    //
    //    replay:
    //      Kundendaten prüfen
    //
    //
    // 2. Explicitly unmatched actual activity
    //
    //    actual:
    //      Daten nach Excel exportieren
    //
    //    replay:
    //      __WORKAROUND_CHECK_UNMATCHED__t3
    //
    // The second label cannot occur in the reference
    // process and therefore becomes a log move.
    // ==================================================

    const replayTrace =
      trace.activityIds.map(
        (
          actualActivityId,
          index
        ) => {
          const mapping =
            mappingByActualId.get(
              actualActivityId
            );


          if (
            !mapping
          ) {
            throw new Error(
              `Missing activity mapping for ${actualActivityId}`
            );
          }


          const actualLabel =
            trace.labels[
              index
            ] ??
            mapping.actualLabel;


          // ============================================
          // UNMATCHED ACTUAL ACTIVITY
          // ============================================

          if (
            isExplicitlyUnmatched(
              mapping
            )
          ) {
            return {
              actualActivityId,

              actualLabel,

              replayLabel:
                unmatchedReplayLabel(
                  actualActivityId
                )
            };
          }


          // ============================================
          // MAPPED ACTUAL ACTIVITY
          // ============================================

          if (
            !isReplayableReferenceMapping(
              mapping
            ) ||
            !mapping.referenceLabel
          ) {
            throw new Error(
              `Activity mapping for ${actualActivityId} is too uncertain for conformance replay`
            );
          }


          return {
            actualActivityId,

            actualLabel,

            replayLabel:
              mapping
                .referenceLabel
          };
        }
      );


    // ==================================================
    // DEBUG REPLAY TRACE
    // ==================================================

    if (
      process.env.NODE_ENV !==
      "production"
    ) {
      console.info(
        "[workaround-check] conformance replay trace:",
        JSON.stringify(
          replayTrace,
          null,
          2
        )
      );
    }


    // ==================================================
    // CALL PM4PY
    // ==================================================

    const result =
      await runConformance({
        referenceProcessId,

        referenceProcessVersion,

        bpmnXml:
          reference
            .currentVersion
            .bpmnXml,

        trace:
          replayTrace,

        complete:
          trace.complete
      });


    // ==================================================
    // ENRICH MOVES
    // ==================================================

    const moves =
      enrichMoves(
        result.moves,
        mappings,
        reference
          .currentVersion
          .process
      );


    // ==================================================
    // CREATE IMMUTABLE RUN
    // ==================================================

    const run:
      ConformanceRun = {
      id:
        randomUUID(),

      referenceProcessId,

      referenceProcessVersion,

      traceActivityIds:
        [
          ...trace.activityIds
        ],

      method:
        result.method,

      complete:
        trace.complete,

      fitness:
        result.fitness,

      conformant:
        result.conformant,

      moves,

      createdAt:
        new Date()
          .toISOString()
    };


    // ==================================================
    // STORE RUN
    // ==================================================

    addConformanceRun(
      sessionId,
      run
    );


    // ==================================================
    // MAP TECHNICAL DEVIATIONS
    // ==================================================

    const deviations =
      mapConformanceRunToDeviations({
        run,

        actualProcess:
          session.process,

        referenceProcess:
          reference
            .currentVersion
            .process,

        mappings,

        referenceStable:
          identification.stable
      });


    // ==================================================
    // RECONCILE CURRENT DEVIATIONS
    // ==================================================

    reconcileCurrentDeviations(
      sessionId,
      referenceProcessId,
      referenceProcessVersion,
      deviations
    );


    // ==================================================
    // DEBUG
    // ==================================================

    if (
      process.env.NODE_ENV !==
      "production"
    ) {
      console.info(
        "[workaround-check] conformance run:",
        JSON.stringify(
          run,
          null,
          2
        )
      );


      console.info(
        "[workaround-check] detected deviations:",
        JSON.stringify(
          deviations,
          null,
          2
        )
      );
    }


    return run;
  } catch (
    error:
      unknown
  ) {
    // ==================================================
    // CONFORMANCE FAILURE MUST NOT BREAK INTERVIEW
    // ==================================================
    //
    // Do not delete historical runs here.
    //
    // A temporary PM4Py outage must not destroy audit
    // evidence from previous successful runs.
    // ==================================================

    console.error(
      "[workaround-check] conformance failed:",
      error
    );


    return undefined;
  }
}