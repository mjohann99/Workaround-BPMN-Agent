import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createInitialProcess
} from "../src/process.js";

import {
  sanitizeProcessChanges
} from "../src/process-change-sanitizer.js";

import {
  type ProcessChanges
} from "../src/types.js";


// ======================================================
// TEST HELPER
// ======================================================

function changes(
  overrides:
    Partial<ProcessChanges> =
    {}
): ProcessChanges {
  return {
    addParticipants:
      [],

    updateParticipants:
      [],

    removeParticipantIds:
      [],

    addLanes:
      [],

    updateLanes:
      [],

    removeLaneIds:
      [],

    addElements:
      [],

    updateElements:
      [],

    removeElementIds:
      [],

    addFlows:
      [],

    removeFlowIds:
      [],

    addMessageFlows:
      [],

    removeMessageFlowIds:
      [],

    addWorkarounds:
      [],

    updateWorkarounds:
      [],

    ...overrides
  };
}


// ======================================================
// BLACK-BOX SOURCE
// ======================================================

test(
  "removes source element reference from black-box participant",
  () => {
    const process =
      createInitialProcess(
        "Auftragserfassung"
      );

    const result =
      sanitizeProcessChanges(
        process,

        changes({
          addParticipants: [
            {
              tempRef:
                "customer1",

              name:
                "Customer",

              type:
                "external",

              processVisibility:
                "black_box"
            }
          ],

          addMessageFlows: [
            {
              tempRef:
                "mf1",

              fromParticipantRef:
                "customer1",

              toParticipantRef:
                "participant_internal",

              sourceElementRef:
                "start_1",

              targetElementRef:
                "start_1",

              name:
                "Order via email"
            }
          ]
        })
      );


    assert.equal(
      result
        .addMessageFlows
        .length,
      1
    );


    const flow =
      result
        .addMessageFlows[0];


    assert.equal(
      flow
        .fromParticipantRef,
      "customer1"
    );


    assert.equal(
      flow
        .toParticipantRef,
      "participant_internal"
    );


    assert.equal(
      flow
        .sourceElementRef,
      undefined
    );


    assert.equal(
      flow
        .targetElementRef,
      "start_1"
    );
  }
);


// ======================================================
// BLACK-BOX TARGET
// ======================================================

test(
  "removes target element reference from black-box participant",
  () => {
    const process =
      createInitialProcess(
        "Auftragserfassung"
      );

    const result =
      sanitizeProcessChanges(
        process,

        changes({
          addParticipants: [
            {
              tempRef:
                "customer1",

              name:
                "Customer",

              type:
                "external",

              processVisibility:
                "black_box"
            }
          ],

          addMessageFlows: [
            {
              tempRef:
                "mf1",

              fromParticipantRef:
                "participant_internal",

              toParticipantRef:
                "customer1",

              sourceElementRef:
                "start_1",

              targetElementRef:
                "start_1",

              name:
                "Confirmation"
            }
          ]
        })
      );


    const flow =
      result
        .addMessageFlows[0];


    assert.equal(
      flow
        .sourceElementRef,
      "start_1"
    );


    assert.equal(
      flow
        .targetElementRef,
      undefined
    );
  }
);