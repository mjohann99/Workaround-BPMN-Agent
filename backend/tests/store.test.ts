import {
  describe,
  expect,
  it
} from "vitest";

import {
  createSession
} from "../src/store.js";


// ======================================================
// SESSION STORE
// ======================================================

describe(
  "session store",
  () => {
    it(
      "creates a new interview session with initial process-scope question",
      () => {
        const session =
          createSession();


        // ----------------------------------------------
        // INITIAL ASSISTANT MESSAGE
        // ----------------------------------------------

        expect(
          session.messages
        ).toHaveLength(
          1
        );

        expect(
          session.messages[0]?.role
        ).toBe(
          "assistant"
        );

        expect(
          session.messages[0]?.content
        ).toBe(
          "Which process would you like to describe?"
        );


        // ----------------------------------------------
        // INITIAL PENDING QUESTION
        // ----------------------------------------------

        expect(
          session.pendingQuestion
        ).toBeDefined();

        expect(
          session.pendingQuestion?.kind
        ).toBe(
          "process_scope"
        );

        expect(
          session.pendingQuestion?.field
        ).toBe(
          "declaredProcessName"
        );

        expect(
          session.pendingQuestion?.question
        ).toBe(
          "Which process would you like to describe?"
        );


        // ----------------------------------------------
        // PROCESS IDENTIFICATION
        // ----------------------------------------------

        expect(
          session.analysis
            .processIdentification
            .status
        ).toBe(
          "unresolved"
        );

        expect(
          session.analysis
            .processIdentification
            .declaredProcessName
        ).toBeUndefined();

        expect(
          session.analysis
            .processIdentification
            .candidates
        ).toEqual(
          []
        );

        expect(
          session.analysis
            .processIdentification
            .selectedReferenceProcessId
        ).toBeUndefined();

        expect(
          session.analysis
            .processIdentification
            .selectedReferenceProcessVersion
        ).toBeUndefined();

        expect(
          session.analysis
            .processIdentification
            .lockedByOwner
        ).toBe(
          false
        );

        expect(
          session.analysis
            .processIdentification
            .stable
        ).toBe(
          false
        );

        expect(
          session.analysis
            .processIdentification
            .confidence
        ).toBe(
          0
        );

        expect(
          session.analysis
            .processIdentification
            .marginToSecondCandidate
        ).toBe(
          0
        );

        expect(
          session.analysis
            .processIdentification
            .revisionCount
        ).toBe(
          0
        );

        expect(
          session.analysis
            .processIdentification
            .history
        ).toEqual(
          []
        );


        // ----------------------------------------------
        // CONFORMANCE ANALYSIS STARTS EMPTY
        // ----------------------------------------------

        expect(
          session.analysis
            .activityMappings
        ).toEqual(
          []
        );

        expect(
          session.analysis
            .conformanceRuns
        ).toEqual(
          []
        );

        expect(
          session.analysis
            .deviations
        ).toEqual(
          []
        );

        expect(
          session.analysis
            .investigations
        ).toEqual(
          []
        );

        expect(
          session.analysis
            .ownerReviews
        ).toEqual(
          []
        );


        // ----------------------------------------------
        // INITIAL ELICITATION STATE
        // ----------------------------------------------

        expect(
          session.elicitationPhase
        ).toBe(
          "scope"
        );

        expect(
          session.lastFocusedElementIds
        ).toEqual(
          []
        );

        expect(
          session.unresolvedProcessItems
        ).toContain(
          "reference_process"
        );

        expect(
          session.unresolvedProcessItems
        ).toContain(
          "process_trigger"
        );


        // ----------------------------------------------
        // INITIAL PROCESS
        // ----------------------------------------------

        expect(
          session.process.elements
            .some(
              (
                element
              ) =>
                element.id ===
                  "start_1" &&
                element.type ===
                  "start"
            )
        ).toBe(
          true
        );

        expect(
          session.process.participants
            .some(
              (
                participant
              ) =>
                participant.id ===
                  "participant_internal" &&
                participant.type ===
                  "internal" &&
                participant.processVisibility ===
                  "white_box"
            )
        ).toBe(
          true
        );
      }
    );
  }
);