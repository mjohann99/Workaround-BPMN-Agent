import {
  type DeviationCandidate,
  type ProcessModel
} from "../types.js";


// ======================================================
// LEGACY LLM DEVIATION ADAPTER
// ======================================================
//
// DEPRECATED.
//
// Previous architecture:
//
// LLM
// -> process.workarounds
// -> DeviationCandidate
//
// Current architecture:
//
// LLM
// -> actual AS-IS ProcessModel
//
// Reference-process identification
// -> selected reference process
//
// Conformance checking
// -> ConformanceRun
//
// ConformanceRun
// -> DeviationCandidate
//
// Therefore process.workarounds must no longer create
// technical deviations.
//
// This function remains temporarily so older call sites
// continue to compile while the conformance pipeline is
// being implemented.
// ======================================================

export function deriveLlmDeviationCandidates(
  _process: ProcessModel,
  existing: DeviationCandidate[]
): DeviationCandidate[] {
  /**
   * Do not derive technical deviations from
   * process.workarounds anymore.
   *
   * Existing conformance-derived deviations are
   * preserved unchanged.
   */
  return structuredClone(
    existing
  );
}