import {
  type ProcessModel
} from "../types.js";


// ======================================================
// REFERENCE PROCESS METADATA
// ======================================================
//
// Metadata can change without creating a new process
// model version.
//
// Example:
//
// name:
// "Auftragserfassung"
//
// aliases:
// "Bestellannahme"
// "Kundenauftrag anlegen"
// ======================================================

export type ReferenceProcessMetadata = {
  id: string;

  /**
   * Human-readable name maintained by the Process Owner.
   */
  name: string;

  aliases: string[];

  description?: string;

  /**
   * Inactive processes are retained for history but are
   * ignored by automatic process identification.
   */
  active: boolean;

  /**
   * Latest available process-model version.
   */
  currentVersion: number;

  createdAt: string;

  updatedAt: string;
};


// ======================================================
// REFERENCE PROCESS VERSION
// ======================================================
//
// Structural BPMN changes create a new immutable version.
//
// Example:
//
// Auftragserfassung
// Version 1
//
// -> Owner changes activity sequence
//
// Auftragserfassung
// Version 2
// ======================================================

export type ReferenceProcessVersion = {
  referenceProcessId: string;

  version: number;

  /**
   * Semantic hash of the ProcessModel.
   *
   * Used to avoid silently replacing a reference model
   * and to detect no-op saves.
   */
  modelHash: string;

  process: ProcessModel;

  /**
   * Deterministically generated BPMN XML belonging to
   * exactly this process version.
   */
  bpmnXml: string;

  createdAt: string;
};


// ======================================================
// COMPLETE REFERENCE PROCESS RECORD
// ======================================================

export type ReferenceProcessRecord = {
  metadata:
    ReferenceProcessMetadata;

  /**
   * Usually the current version.
   *
   * getReferenceProcess(id, version) may also return an
   * historical version here.
   */
  currentVersion:
    ReferenceProcessVersion;
};


// ======================================================
// REFERENCE PROCESS SUMMARY
// ======================================================
//
// Used for:
//
// GET /api/owner/reference-processes
//
// Session/deviation counters are runtime aggregations and
// are therefore optional.
// ======================================================

export type ReferenceProcessSummary = {
  id: string;

  name: string;

  aliases: string[];

  description?: string;

  active: boolean;

  currentVersion: number;

  updatedAt: string;

  assignedSessionCount?: number;

  openDeviationCount?: number;
};


// ======================================================
// OPTIONAL ACTIVITY DESCRIPTION
// ======================================================
//
// This will later support activity matching.
//
// For now it is not required by repository.ts but keeping
// it here gives us a stable type for aliases and matcher
// metadata.
// ======================================================

export type ReferenceActivity = {
  activityId: string;

  canonicalLabel: string;

  aliases: string[];
};