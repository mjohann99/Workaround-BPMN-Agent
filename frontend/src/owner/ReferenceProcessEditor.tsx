import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  BpmnEditor
} from "../components/BpmnEditor";

import {
  type ProcessModel
} from "../types";


// ======================================================
// REFERENCE PROCESS TYPES
// ======================================================

export type ReferenceProcessMetadata = {
  id: string;

  name: string;

  aliases: string[];

  description?: string;

  active: boolean;

  currentVersion: number;

  createdAt: string;

  updatedAt: string;
};


export type ReferenceProcessVersion = {
  referenceProcessId:
  string;

  version:
  number;

  modelHash:
  string;

  process:
  ProcessModel;

  bpmnXml:
  string;

  createdAt:
  string;
};


export type ReferenceProcessRecord = {
  metadata:
  ReferenceProcessMetadata;

  currentVersion:
  ReferenceProcessVersion;
};


// ======================================================
// PROPS
// ======================================================

type Props = {
  referenceProcess:
  ReferenceProcessRecord;

  saving:
  boolean;

  deleting:
  boolean;

  onRename: (
    name:
      string
  ) => Promise<void>;

  onProcessChange: (
    process:
      ProcessModel
  ) => Promise<void>;

  onDelete:
  () => Promise<void>;
};


// ======================================================
// PROCESS SIGNATURE
// ======================================================

function processSignature(
  process:
    ProcessModel
): string {
  return JSON.stringify({
    name:
      process.name,

    status:
      process.status,

    participants:
      process.participants,

    lanes:
      process.lanes,

    elements:
      process.elements,

    flows:
      process.flows,

    messageFlows:
      process.messageFlows
  });
}


// ======================================================
// COMPONENT
// ======================================================

export function ReferenceProcessEditor({
  referenceProcess,
  saving,
  deleting,
  onRename,
  onProcessChange,
  onDelete
}: Props): JSX.Element {
  // ====================================================
  // FILE INPUT
  // ====================================================

  const fileInputRef =
    useRef<
      HTMLInputElement |
      null
    >(
      null
    );


  // ====================================================
  // LOCAL METADATA DRAFT
  // ====================================================

  const [
    name,
    setName
  ] =
    useState(
      referenceProcess
        .metadata
        .name
    );


  // ====================================================
  // LOCAL PROCESS DRAFT
  // ====================================================

  const [
    draftProcess,
    setDraftProcess
  ] =
    useState<
      ProcessModel
    >(
      () =>
        structuredClone(
          referenceProcess
            .currentVersion
            .process
        )
    );


  // ====================================================
  // LOCAL BPMN XML DRAFT
  // ====================================================
  //
  // Normally this is the BPMN XML belonging to the
  // currently persisted reference-process version.
  //
  // After an upload it contains the uploaded BPMN XML.
  // ====================================================

  const [
    draftBpmnXml,
    setDraftBpmnXml
  ] =
    useState(
      referenceProcess
        .currentVersion
        .bpmnXml
    );


  // ====================================================
  // UPLOAD INFORMATION
  // ====================================================

  const [
    uploadedFileName,
    setUploadedFileName
  ] =
    useState<
      string |
      undefined
    >(
      undefined
    );


  // ====================================================
  // UI STATE
  // ====================================================

  const [
    renaming,
    setRenaming
  ] =
    useState(
      false
    );

  const [
    localError,
    setLocalError
  ] =
    useState<
      string |
      undefined
    >(
      undefined
    );


  // ====================================================
  // SYNCHRONIZE REFERENCE PROCESS / VERSION
  // ====================================================

  useEffect(
    () => {
      setName(
        referenceProcess
          .metadata
          .name
      );

      setDraftProcess(
        structuredClone(
          referenceProcess
            .currentVersion
            .process
        )
      );

      setDraftBpmnXml(
        referenceProcess
          .currentVersion
          .bpmnXml
      );

      setUploadedFileName(
        undefined
      );

      setLocalError(
        undefined
      );

      if (
        fileInputRef.current
      ) {
        fileInputRef.current.value =
          "";
      }
    },
    [
      referenceProcess
        .metadata
        .id,

      referenceProcess
        .metadata
        .name,

      referenceProcess
        .currentVersion
        .version,

      referenceProcess
        .currentVersion
        .modelHash
    ]
  );


  // ====================================================
  // DIRTY STATE
  // ====================================================

  const processChanged =
    useMemo(
      () =>
        processSignature(
          draftProcess
        ) !==
        processSignature(
          referenceProcess
            .currentVersion
            .process
        ),
      [
        draftProcess,
        referenceProcess
      ]
    );


  const nameChanged =
    name.trim() !==
    referenceProcess
      .metadata
      .name &&
    Boolean(
      name.trim()
    );


  // ====================================================
  // BPMN EDITOR CHANGE
  // ====================================================

  const handleDraftProcessChange =
    (
      process:
        ProcessModel
    ): void => {
      setDraftProcess(
        process
      );

      setLocalError(
        undefined
      );
    };


  // ====================================================
  // BPMN FILE UPLOAD
  // ====================================================

  const handleBpmnUpload =
    async (
      file:
        File
    ): Promise<void> => {
      const fileName =
        file.name
          .toLowerCase();

      if (
        !fileName.endsWith(
          ".bpmn"
        ) &&
        !fileName.endsWith(
          ".xml"
        )
      ) {
        setLocalError(
          "Please choose a BPMN file with the extension .bpmn or .xml."
        );

        return;
      }

      setLocalError(
        undefined
      );

      try {
        const xml =
          await file.text();

        if (
          !xml.trim()
        ) {
          throw new Error(
            "The selected BPMN file is empty."
          );
        }


        // ----------------------------------------------
        // Very lightweight XML/BPMN sanity check.
        //
        // The real validation happens through bpmn-js.
        // ----------------------------------------------

        if (
          !/<(?:[\w-]+:)?definitions\b/i
            .test(
              xml
            )
        ) {
          throw new Error(
            "The file does not contain a valid BPMN definitions element."
          );
        }


        // ----------------------------------------------
        // Setting this XML causes BpmnEditor to import it.
        // ----------------------------------------------

        setUploadedFileName(
          file.name
        );

        setDraftBpmnXml(
          xml
        );
      } catch (
      error
      ) {
        setUploadedFileName(
          undefined
        );

        setLocalError(
          error instanceof
            Error
            ? error.message
            : "The BPMN file could not be read."
        );
      }
    };


  // ====================================================
  // BPMN IMPORT ERROR
  // ====================================================

  const handleBpmnImportError =
    (
      error:
        Error
    ): void => {
      setLocalError(
        `The BPMN file could not be imported: ${error.message}`
      );

      setUploadedFileName(
        undefined
      );

      setDraftBpmnXml(
        referenceProcess
          .currentVersion
          .bpmnXml
      );

      setDraftProcess(
        structuredClone(
          referenceProcess
            .currentVersion
            .process
        )
      );
    };


  // ====================================================
  // RENAME
  // ====================================================

  const handleRename =
    async (): Promise<void> => {
      const normalizedName =
        name.trim();

      if (
        !normalizedName ||
        !nameChanged ||
        renaming
      ) {
        return;
      }

      setRenaming(
        true
      );

      setLocalError(
        undefined
      );

      try {
        await onRename(
          normalizedName
        );
      } catch (
      error
      ) {
        setLocalError(
          error instanceof
            Error
            ? error.message
            : "The reference process could not be renamed."
        );
      } finally {
        setRenaming(
          false
        );
      }
    };


  // ====================================================
  // SAVE NEW MODEL VERSION
  // ====================================================

  const handleSaveVersion =
    async (): Promise<void> => {
      if (
        saving ||
        !processChanged
      ) {
        return;
      }

      setLocalError(
        undefined
      );

      try {
        const cleanProcess:
          ProcessModel = {
          ...structuredClone(
            draftProcess
          ),

          name:
            referenceProcess
              .metadata
              .name,

          workarounds:
            [],

          elements:
            draftProcess
              .elements
              .map(
                (
                  element
                ) => {
                  if (
                    element.type !==
                    "task"
                  ) {
                    return {
                      ...element
                    };
                  }

                  const {
                    workaroundCandidate:
                    _candidate,

                    workaroundConfirmed:
                    _confirmed,

                    workaroundReason:
                    _reason,

                    workaroundCategory:
                    _category,

                    ...cleanTask
                  } =
                    element;

                  return cleanTask;
                }
              ),

          updatedAt:
            new Date()
              .toISOString()
        };

        await onProcessChange(
          cleanProcess
        );
      } catch (
      error
      ) {
        setLocalError(
          error instanceof
            Error
            ? error.message
            : "The new reference process version could not be saved."
        );
      }
    };


  // ====================================================
  // DISCARD LOCAL CHANGES
  // ====================================================

  const handleDiscardChanges =
    (): void => {
      setDraftProcess(
        structuredClone(
          referenceProcess
            .currentVersion
            .process
        )
      );

      setDraftBpmnXml(
        referenceProcess
          .currentVersion
          .bpmnXml
      );

      setUploadedFileName(
        undefined
      );

      setLocalError(
        undefined
      );

      if (
        fileInputRef.current
      ) {
        fileInputRef.current.value =
          "";
      }
    };
  // ======================================================
  // DELETE REFERENCE PROCESS
  // ======================================================

  const handleDeleteClick =
    async (): Promise<void> => {
      if (
        saving ||
        renaming ||
        deleting
      ) {
        return;
      }

      await onDelete();
    };

  // ====================================================
  // VIEW
  // ====================================================

  return (
    <section className="reference-process-editor">
      {/* ============================================== */}
      {/* HEADER */}
      {/* ============================================== */}

      <header className="reference-process-editor-header">
        <div>
          <h2>
            Reference process
          </h2>

          <p>
            Target process model for
            process identification and
            conformance checking
          </p>
        </div>

        <div className="reference-version-badge">
          Version{" "}
          {
            referenceProcess
              .metadata
              .currentVersion
          }
        </div>
      </header>


      {/* ============================================== */}
      {/* METADATA */}
      {/* ============================================== */}

      <section className="reference-process-metadata">
        <div className="reference-name-editor">
          <label>
            Process name

            <input
              type="text"

              value={
                name
              }

              disabled={
                renaming ||
                saving
              }

              onChange={
                (
                  event
                ) =>
                  setName(
                    event
                      .target
                      .value
                  )
              }

              onKeyDown={
                (
                  event
                ) => {
                  if (
                    event.key ===
                    "Enter"
                  ) {
                    event.preventDefault();

                    void handleRename();
                  }
                }
              }
            />
          </label>

          <button
            type="button"

            disabled={
              renaming ||
              saving ||
              !nameChanged
            }

            onClick={
              () =>
                void handleRename()
            }
          >
            {renaming
              ? "Saving…"
              : "Save name"}
          </button>
        </div>


        {/* ============================================ */}
        {/* PROCESS INFORMATION */}
        {/* ============================================ */}

        <div className="reference-process-info">
          <div>
            <span>
              Status
            </span>

            <strong>
              {referenceProcess
                .metadata
                .active
                ? "Active"
                : "Inactive"}
            </strong>
          </div>

          <div>
            <span>
              Current version
            </span>

            <strong>
              {
                referenceProcess
                  .metadata
                  .currentVersion
              }
            </strong>
          </div>

          <div>
            <span>
              Model status
            </span>

            <strong>
              {processChanged
                ? "Unsaved changes"
                : "Saved"}
            </strong>
          </div>
        </div>


        {referenceProcess
          .metadata
          .description && (
            <p className="reference-process-description">
              {
                referenceProcess
                  .metadata
                  .description
              }
            </p>
          )}


        {referenceProcess
          .metadata
          .aliases
          .length > 0 && (
            <div className="reference-process-aliases">
              <strong>
                Alternative names
              </strong>

              <div>
                {referenceProcess
                  .metadata
                  .aliases
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
              </div>
            </div>
          )}
      </section>


      {/* ============================================== */}
      {/* BPMN UPLOAD */}
      {/* ============================================== */}

      <section className="reference-process-upload">
        <div className="reference-process-upload-copy">
          <strong>
            BPMN process model
          </strong>

          <p>
            Upload an existing BPMN model or edit the current model
            directly in the editor.
          </p>
        </div>

        <div className="reference-process-upload-actions">
          <input
            ref={
              fileInputRef
            }

            type="file"

            accept=".bpmn,.xml,application/xml,text/xml"

            hidden

            onChange={
              (
                event
              ) => {
                const file =
                  event
                    .target
                    .files
                  ?.[0];

                if (
                  file
                ) {
                  void handleBpmnUpload(
                    file
                  );
                }

                /**
                 * Allows selecting the same file again.
                 */
                event.currentTarget.value =
                  "";
              }
            }
          />

          <button
            type="button"

            disabled={
              saving
            }

            onClick={
              () =>
                fileInputRef
                  .current
                  ?.click()
            }
          >
            Upload BPMN file
          </button>

          {uploadedFileName && (
            <span className="reference-process-uploaded-file">
              {uploadedFileName}
            </span>
          )}
        </div>
      </section>


      {/* ============================================== */}
      {/* LOCAL ERROR */}
      {/* ============================================== */}

      {localError && (
        <div
          className="error-message"
          role="alert"
        >
          {localError}
        </div>
      )}


      {/* ============================================== */}
      {/* TOOLBAR */}
      {/* ============================================== */}

      <div className="reference-process-toolbar">
        <div className="reference-process-dirty-state">
          {processChanged ? (
            <strong>
              There are unsaved changes.
            </strong>
          ) : (
            <span>
              No unsaved changes.
            </span>
          )}
        </div>

        <div className="reference-process-toolbar-actions">
          <button
            type="button"

            disabled={
              saving ||
              !processChanged
            }

            onClick={
              handleDiscardChanges
            }
          >
            Discard changes
          </button>

          <button
            type="button"

            disabled={
              saving ||
              !processChanged
            }

            onClick={
              () =>
                void handleSaveVersion()
            }
          >
            {saving
              ? "Saving version…"
              : "Save new version"}
          </button>
        </div>
      </div>


      {/* ============================================== */}
      {/* BPMN EDITOR */}
      {/* ============================================== */}

      <div className="reference-process-bpmn">
        <BpmnEditor
          xml={
            draftBpmnXml
          }

          process={
            draftProcess
          }

          mode="owner"

          highlights={
            []
          }

          xmlImportMode={
            uploadedFileName
              ? "draft"
              : "display"
          }

          onImportError={
            handleBpmnImportError
          }

          onProcessChange={
            handleDraftProcessChange
          }
        />
      </div>


      {/* ============================================== */}
      {/* VERSION INFORMATION */}
      {/* ============================================== */}

      <footer className="reference-process-editor-footer">
        <small>
          Model hash:{" "}

          <code>
            {
              referenceProcess
                .currentVersion
                .modelHash
            }
          </code>
        </small>

        <small>
          Version created:{" "}

          {new Date(
            referenceProcess
              .currentVersion
              .createdAt
          ).toLocaleString(
            "en-US"
          )}
        </small>
      </footer>
      {/* ============================================== */}
      {/* DANGER ZONE */}
      {/* ============================================== */}

      <section className="reference-process-danger-zone">
        <div>
          <strong>
            Delete reference process
          </strong>

          <p>
            Permanently deletes this reference process including
            all saved versions.
          </p>
        </div>

        <button
          type="button"

          className="danger-button"

          disabled={
            saving ||
            renaming ||
            deleting
          }

          onClick={
            () =>
              void onDelete()
          }
        >
          {deleting
            ? "Deleting…"
            : "Delete reference process"}
        </button>
      </section>
    </section>
  );
}