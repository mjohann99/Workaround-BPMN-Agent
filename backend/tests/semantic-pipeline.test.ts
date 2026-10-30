import {
  describe,
  expect,
  it
} from "vitest";

import {
  applyProcessChanges,
  createInitialProcess
} from "../src/process.js";

import {
  fallbackResponse
} from "../src/openai.js";

import {
  repairIntervieweeRoleStatement,
  sanitizeProcessChanges
} from "../src/process-change-sanitizer.js";

import {
  type ProcessChanges
} from "../src/types.js";


// ======================================================
// PROCESS CHANGES TEST HELPER
// ======================================================
//
// ProcessChanges contains all mutation groups.
//
// Tests normally only need a small subset, therefore
// this helper supplies empty defaults for every group.
// ======================================================

function processChanges(
  overrides:
    Partial<ProcessChanges> = {}
): ProcessChanges {
  return {
    // Participants
    addParticipants:
      [],

    updateParticipants:
      [],

    removeParticipantIds:
      [],

    // Lanes
    addLanes:
      [],

    updateLanes:
      [],

    removeLaneIds:
      [],

    // Elements
    addElements:
      [],

    updateElements:
      [],

    removeElementIds:
      [],

    // Sequence Flows
    addFlows:
      [],

    removeFlowIds:
      [],

    // Message Flows
    addMessageFlows:
      [],

    removeMessageFlowIds:
      [],

    // Legacy Workarounds
    addWorkarounds:
      [],

    updateWorkarounds:
      [],

    // Test-specific overrides
    ...overrides
  };
}


// ======================================================
// SEMANTIC PIPELINE
// ======================================================
//
// These tests cover deterministic ProcessModel mutation
// and safe fallback behavior.
//
// Current architecture:
//
// LLM / fallback
// -> reconstruct actual AS-IS process
//
// LLM / fallback
// X  no workaround classification
// X  no deviation classification
//
// Conformance engine
// -> DeviationCandidate
//
// Process Owner
// -> final classification
// ======================================================

describe(
  "semantic pipeline — process mutation",
  () => {
    it(
      "assigns unassigned tasks to the lane named in 'We are the production'",
      () => {
        const process =
          createInitialProcess();

        process.lanes.push({
          id: "lane_order_management",
          participantId: "participant_internal",
          name: "Order management and planning",
          type: "department"
        });

        process.elements.push(
          {
            id: "t1",
            type: "task",
            name: "Produce semi-finished products",
            participantId: "participant_internal"
          },
          {
            id: "t2",
            type: "task",
            name: "Receive matching customer order",
            participantId: "participant_internal",
            laneId: "lane_order_management"
          }
        );

        process.flows.push(
          { id: "f1", from: "start_1", to: "t1" },
          { id: "f2", from: "t1", to: "t2" }
        );

        const repaired =
          repairIntervieweeRoleStatement(
            process,
            processChanges(),
            "We are the production"
          );

        const applied =
          applyProcessChanges(
            process,
            repaired.changes,
            "We are the production"
          ).process;

        const lane =
          applied.lanes.find(
            (candidate) =>
              candidate.name === "production"
          );

        expect(lane).toBeDefined();

        expect(
          applied.elements.find(
            (element) => element.id === "t1"
          )?.laneId
        ).toBe(lane?.id);

        expect(
          applied.elements.find(
            (element) => element.id === "t2"
          )?.laneId
        ).toBe("lane_order_management");
      }
    );

    it(
      "resolves a boundary event attachment to a new task tempRef",
      () => {
        const process =
          createInitialProcess();

        const updated =
          applyProcessChanges(
            process,
            processChanges({
              addElements: [
                {
                  tempRef: "prepare_order",
                  type: "task",
                  name: "Prepare order"
                },
                {
                  tempRef: "order_timeout",
                  type: "boundaryEvent",
                  name: "Order preparation timeout",
                  eventDefinitionType: "timer",
                  attachedToRef: "prepare_order",
                  cancelActivity: false
                }
              ],
              addFlows: [
                {
                  id: "flow_prepare_order",
                  from: "start_1",
                  to: "prepare_order"
                }
              ]
            }),
            "prepare order"
          ).process;

        const task =
          updated.elements.find(
            (element) => element.type === "task"
          );

        const boundaryEvent =
          updated.elements.find(
            (element) => element.type === "boundaryEvent"
          );

        expect(task).toBeDefined();
        expect(boundaryEvent).toMatchObject({
          type: "boundaryEvent",
          attachedToRef: task?.id,
          cancelActivity: false,
          eventDefinitionType: "timer"
        });
      }
    );

    it(
      "reuses an existing lane when a duplicate lane is proposed",
      () => {
        const process =
          createInitialProcess();

        process.lanes.push({
          id: "lane_order_management",
          participantId: "participant_internal",
          name: "Order management and planning",
          type: "department"
        });

        const sanitized =
          sanitizeProcessChanges(
            process,
            processChanges({
              addLanes: [
                {
                  tempRef: "lane_duplicate",
                  participantRef: "participant_internal",
                  name: "Order management and planning",
                  type: "department"
                }
              ],
              addElements: [
                {
                  tempRef: "receive_order",
                  type: "task",
                  name: "Receive customer order",
                  laneRef: "lane_duplicate"
                }
              ],
              addFlows: [
                {
                  id: "flow_receive_order",
                  from: "start_1",
                  to: "receive_order"
                }
              ]
            })
          );

        const applied =
          applyProcessChanges(
            process,
            sanitized,
            "receive order"
          ).process;

        expect(
          sanitized.addLanes
        ).toHaveLength(0);

        expect(
          applied.lanes
        ).toHaveLength(1);

        expect(
          applied.elements.find(
            (element) => element.name === "Receive customer order"
          )?.laneId
        ).toBe("lane_order_management");
      }
    );

    // ==================================================
    // TEST 1
    // ==================================================

    it(
      "TEST 1: multiple atomic AS-IS tasks and flows connected via tempRef",
      () => {
        const process =
          createInitialProcess();

        const result =
          applyProcessChanges(
            process,

            processChanges({
              addElements: [
                {
                  tempRef:
                    "t1",

                  type:
                    "task",

                  name:
                    "Bestellung öffnen",

                  system:
                    "SAP"
                },

                {
                  tempRef:
                    "t2",

                  type:
                    "task",

                  name:
                    "Kundendaten prüfen",

                  system:
                    "SAP"
                },

                {
                  tempRef:
                    "t3",

                  type:
                    "task",

                  name:
                    "Daten nach Excel exportieren",

                  system:
                    "Excel"
                },

                {
                  tempRef:
                    "t4",

                  type:
                    "task",

                  name:
                    "Preise manuell korrigieren",

                  system:
                    "Excel"
                },

                {
                  tempRef:
                    "t5",

                  type:
                    "task",

                  name:
                    "Daten in SAP übertragen",

                  system:
                    "SAP"
                }
              ],

              updateElements: [
                {
                  id:
                    "start_1",

                  name:
                    "Bestellung eingegangen"
                }
              ],

              addFlows: [
                {
                  fromRef:
                    "start_1",

                  toRef:
                    "t1",

                  condition:
                    ""
                },

                {
                  fromRef:
                    "t1",

                  toRef:
                    "t2",

                  condition:
                    ""
                },

                {
                  fromRef:
                    "t2",

                  toRef:
                    "t3",

                  condition:
                    ""
                },

                {
                  fromRef:
                    "t3",

                  toRef:
                    "t4",

                  condition:
                    ""
                },

                {
                  fromRef:
                    "t4",

                  toRef:
                    "t5",

                  condition:
                    ""
                }
              ]
            }),

            "Wenn eine Bestellung per E-Mail kommt..."
          );


        // ----------------------------------------------
        // 5 tasks + 1 start
        // ----------------------------------------------

        expect(
          result.process.elements
        ).toHaveLength(
          6
        );

        expect(
          result.process.flows
        ).toHaveLength(
          5
        );


        // ----------------------------------------------
        // Trigger updates existing start event
        // ----------------------------------------------

        const start =
          result.process.elements.find(
            (
              element
            ) =>
              element.id ===
              "start_1"
          );

        expect(
          start?.name
        ).toBe(
          "Bestellung eingegangen"
        );


        // ----------------------------------------------
        // System metadata
        // ----------------------------------------------

        const exportTask =
          result.process.elements.find(
            (
              element
            ) =>
              element.type ===
                "task" &&
              element.name ===
                "Daten nach Excel exportieren"
          );

        expect(
          exportTask
        ).toBeTruthy();

        expect(
          exportTask?.type ===
            "task"
            ? exportTask.system
            : undefined
        ).toBe(
          "Excel"
        );


        // ----------------------------------------------
        // Ordinary extraction does not create workaround
        // classifications.
        // ----------------------------------------------

        expect(
          result.process.workarounds
        ).toHaveLength(
          0
        );
      }
    );


    // ==================================================
    // TEST 2
    // ==================================================

    it(
      "TEST 2: trigger updates start event, no duplicate task",
      () => {
        const process =
          createInitialProcess();

        const result =
          applyProcessChanges(
            process,

            processChanges({
              updateElements: [
                {
                  id:
                    "start_1",

                  name:
                    "Bestellung eingegangen"
                }
              ]
            }),

            "Der Prozess beginnt, wenn eine Bestellung per E-Mail eingeht."
          );

        expect(
          result.process.elements
        ).toHaveLength(
          1
        );

        expect(
          result.process.elements[0]
            ?.name
        ).toBe(
          "Bestellung eingegangen"
        );

        expect(
          result.process.elements[0]
            ?.type
        ).toBe(
          "start"
        );
      }
    );


    // ==================================================
    // TEST 4
    // ==================================================

    it(
      "TEST 4: exclusive gateway with branches",
      () => {
        const process =
          createInitialProcess();

        const result =
          applyProcessChanges(
            process,

            processChanges({
              addElements: [
                {
                  tempRef:
                    "gw1",

                  type:
                    "exclusiveGateway",

                  name:
                    "Kunde vorhanden?"
                },

                {
                  tempRef:
                    "t_create",

                  type:
                    "task",

                  name:
                    "Kunden anlegen"
                }
              ],

              addFlows: [
                {
                  fromRef:
                    "start_1",

                  toRef:
                    "gw1",

                  condition:
                    ""
                },

                {
                  fromRef:
                    "gw1",

                  toRef:
                    "t_create",

                  condition:
                    "Nein"
                }
              ]
            }),

            "Wenn der Kunde nicht existiert, lege ich ihn zuerst an."
          );

        const gateway =
          result.process.elements.find(
            (
              element
            ) =>
              element.type ===
              "exclusiveGateway"
          );

        expect(
          gateway
        ).toBeTruthy();

        expect(
          gateway?.name
        ).toBe(
          "Kunde vorhanden?"
        );

        const conditionalFlow =
          result.process.flows.find(
            (
              flow
            ) =>
              flow.condition ===
              "Nein"
          );

        expect(
          conditionalFlow
        ).toBeTruthy();
      }
    );


    // ==================================================
    // TEST 5
    // ==================================================
    //
    // Confirmation must no longer confirm or mutate
    // workaround classifications.
    // ==================================================

    it(
      "TEST 5: confirmation via fallbackResponse does not create tasks or classify workarounds",
      () => {
        const process =
          applyProcessChanges(
            createInitialProcess(),

            processChanges({
              addElements: [
                {
                  id:
                    "task_1",

                  type:
                    "task",

                  name:
                    "Daten exportieren"
                }
              ],

              addFlows: [
                {
                  id:
                    "flow_1",

                  from:
                    "start_1",

                  to:
                    "task_1"
                }
              ]
            }),

            "export"
          ).process;

        const response =
          fallbackResponse(
            "Yes",
            process
          );


        // ----------------------------------------------
        // No activity is invented
        // ----------------------------------------------

        expect(
          response.changes
            .addElements
        ).toHaveLength(
          0
        );


        // ----------------------------------------------
        // No task-level workaround mutation
        // ----------------------------------------------

        expect(
          response.changes
            .updateElements
        ).toHaveLength(
          0
        );


        // ----------------------------------------------
        // No structured workaround mutation
        // ----------------------------------------------

        expect(
          response.changes
            .addWorkarounds
        ).toHaveLength(
          0
        );

        expect(
          response.changes
            .updateWorkarounds
        ).toHaveLength(
          0
        );
      }
    );


    // ==================================================
    // TEST 6
    // ==================================================
    //
    // Rejection must no longer reject or mutate
    // workaround classifications.
    // ==================================================

    it(
      "TEST 6: rejection via fallbackResponse does not classify or mutate workaround state",
      () => {
        const process =
          applyProcessChanges(
            createInitialProcess(),

            processChanges({
              addElements: [
                {
                  id:
                    "task_1",

                  type:
                    "task",

                  name:
                    "Daten exportieren"
                }
              ],

              addFlows: [
                {
                  id:
                    "flow_1",

                  from:
                    "start_1",

                  to:
                    "task_1"
                }
              ]
            }),

            "export"
          ).process;

        const response =
          fallbackResponse(
            "No",
            process
          );


        // ----------------------------------------------
        // No new process activity
        // ----------------------------------------------

        expect(
          response.changes
            .addElements
        ).toHaveLength(
          0
        );


        // ----------------------------------------------
        // No task-level workaround state
        // ----------------------------------------------

        expect(
          response.changes
            .updateElements
        ).toHaveLength(
          0
        );


        // ----------------------------------------------
        // No structured workaround state
        // ----------------------------------------------

        expect(
          response.changes
            .addWorkarounds
        ).toHaveLength(
          0
        );

        expect(
          response.changes
            .updateWorkarounds
        ).toHaveLength(
          0
        );
      }
    );


    // ==================================================
    // TEST 8
    // ==================================================

    it(
      "TEST 8: metadata enrichment via updateElements does not create duplicate",
      () => {
        const process =
          applyProcessChanges(
            createInitialProcess(),

            processChanges({
              addElements: [
                {
                  id:
                    "task_1",

                  type:
                    "task",

                  name:
                    "Kundendaten prüfen"
                }
              ],

              addFlows: [
                {
                  id:
                    "flow_1",

                  from:
                    "start_1",

                  to:
                    "task_1"
                }
              ]
            }),

            "prüfe"
          ).process;

        const result =
          applyProcessChanges(
            process,

            processChanges({
              updateElements: [
                {
                  id:
                    "task_1",

                  system:
                    "SAP"
                }
              ]
            }),

            "Das mache ich in SAP."
          );


        // ----------------------------------------------
        // Start + task_1
        // ----------------------------------------------

        expect(
          result.process.elements
        ).toHaveLength(
          2
        );

        const task =
          result.process.elements.find(
            (
              element
            ) =>
              element.id ===
              "task_1"
          );

        expect(
          task?.type ===
            "task"
            ? task.system
            : undefined
        ).toBe(
          "SAP"
        );
      }
    );


    // ==================================================
    // TEST 9
    // ==================================================

    it(
      "TEST 9: end event added without creating a full-sentence task",
      () => {
        const process =
          createInitialProcess();

        const result =
          applyProcessChanges(
            process,

            processChanges({
              addElements: [
                {
                  tempRef:
                    "end1",

                  type:
                    "end",

                  name:
                    "Bestellung freigegeben"
                }
              ],

              addFlows: [
                {
                  fromRef:
                    "start_1",

                  toRef:
                    "end1",

                  condition:
                    ""
                }
              ]
            }),

            "Danach ist die Bestellung freigegeben und der Prozess abgeschlossen."
          );

        const end =
          result.process.elements.find(
            (
              element
            ) =>
              element.type ===
              "end"
          );

        expect(
          end
        ).toBeTruthy();

        expect(
          end?.name
        ).toBe(
          "Bestellung freigegeben"
        );

        const tasks =
          result.process.elements.filter(
            (
              element
            ) =>
              element.type ===
              "task"
          );

        expect(
          tasks
        ).toHaveLength(
          0
        );
      }
    );


    // ==================================================
    // TEST 10
    // ==================================================

    it(
      "TEST 10: ambiguous message via fallbackResponse returns safe clarification without mutation",
      () => {
        const process =
          createInitialProcess();

        const response =
          fallbackResponse(
            "Das mache ich dann anders.",
            process
          );


        // ----------------------------------------------
        // No process mutation
        // ----------------------------------------------

        expect(
          response.changes
            .addElements
        ).toHaveLength(
          0
        );

        expect(
          response.changes
            .updateElements
        ).toHaveLength(
          0
        );


        // ----------------------------------------------
        // No workaround classification
        // ----------------------------------------------

        expect(
          response.changes
            .addWorkarounds
        ).toHaveLength(
          0
        );

        expect(
          response.changes
            .updateWorkarounds
        ).toHaveLength(
          0
        );


        // ----------------------------------------------
        // Safe clarification
        // ----------------------------------------------

        expect(
          response.intent
        ).toBe(
          "unclear"
        );

        expect(
          response.nextQuestion
            .required
        ).toBe(
          true
        );
      }
    );


    // ==================================================
    // TEST 11
    // ==================================================

    it(
      "TEST 11: fromRef resolves existing element ID and prevents duplication",
      () => {
        const process =
          applyProcessChanges(
            createInitialProcess(),

            processChanges({
              addElements: [
                {
                  id:
                    "task_1",

                  type:
                    "task",

                  name:
                    "Kunden suchen"
                }
              ],

              addFlows: [
                {
                  id:
                    "flow_1",

                  from:
                    "start_1",

                  to:
                    "task_1"
                }
              ]
            }),

            "Ich suche den Kunden"
          ).process;


        // ----------------------------------------------
        // Add one new task after existing task_1.
        //
        // At the same time enrich task_1 instead of
        // duplicating it.
        // ----------------------------------------------

        const result =
          applyProcessChanges(
            process,

            processChanges({
              addElements: [
                {
                  tempRef:
                    "t2",

                  type:
                    "task",

                  name:
                    "Adresse prüfen",

                  system:
                    "SAP"
                }
              ],

              updateElements: [
                {
                  id:
                    "task_1",

                  system:
                    "SAP"
                }
              ],

              addFlows: [
                {
                  fromRef:
                    "task_1",

                  toRef:
                    "t2",

                  condition:
                    ""
                }
              ]
            }),

            "Danach suche ich den Kunden in SAP und prüfe die Adresse."
          );


        // ----------------------------------------------
        // Exactly two tasks
        // ----------------------------------------------

        expect(
          result.process.elements.filter(
            (
              element
            ) =>
              element.type ===
              "task"
          )
        ).toHaveLength(
          2
        );


        // ----------------------------------------------
        // start -> task_1 -> t2
        // ----------------------------------------------

        expect(
          result.process.flows
        ).toHaveLength(
          2
        );


        // ----------------------------------------------
        // Existing task enriched rather than duplicated
        // ----------------------------------------------

        const enriched =
          result.process.elements.find(
            (
              element
            ) =>
              element.id ===
              "task_1"
          );

        expect(
          enriched?.type ===
            "task"
            ? enriched.system
            : undefined
        ).toBe(
          "SAP"
        );


        // ----------------------------------------------
        // No workaround generated
        // ----------------------------------------------

        expect(
          result.process.workarounds
        ).toHaveLength(
          0
        );
      }
    );
  }
);