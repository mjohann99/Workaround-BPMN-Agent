import {
  describe,
  expect,
  it
} from "vitest";

import {
  applyProcessChanges,
  createInitialProcess,
  ProcessValidationError
} from "../src/process.js";

import {
  type ProcessChanges
} from "../src/types.js";


// ======================================================
// TEST HELPER
// ======================================================

function emptyProcessChanges(): ProcessChanges {
  return {
    // Participants / Pools
    addParticipants: [],
    updateParticipants: [],
    removeParticipantIds: [],

    // Lanes
    addLanes: [],
    updateLanes: [],
    removeLaneIds: [],

    // Process elements
    addElements: [],
    updateElements: [],
    removeElementIds: [],

    // Sequence flows
    addFlows: [],
    removeFlowIds: [],

    // Message flows
    addMessageFlows: [],
    removeMessageFlowIds: [],

    // Workarounds
    addWorkarounds: [],
    updateWorkarounds: []
  };
}


// ======================================================
// PROCESS CHANGES
// ======================================================

describe(
  "process changes",
  () => {
    it(
      "adds a task and a connecting flow",
      () => {
        const process =
          createInitialProcess();

        const result =
          applyProcessChanges(
            process,

            {
              ...emptyProcessChanges(),

              addElements: [
                {
                  id: "task_1",
                  type: "task",
                  name: "Receive order"
                }
              ],

              addFlows: [
                {
                  id: "flow_1",
                  from: "start_1",
                  to: "task_1"
                }
              ]
            },

            "I receive an order by email"
          );

        expect(
          result.process.elements.find(
            (element) =>
              element.id === "task_1"
          )
        ).toBeTruthy();

        expect(
          result.process.flows
        ).toHaveLength(1);
      }
    );

    // ==================================================
    // UPDATE TASK
    // ==================================================

    it(
      "updates an existing task",
      () => {
        const process =
          createInitialProcess();

        const withTask =
          applyProcessChanges(
            process,

            {
              ...emptyProcessChanges(),

              addElements: [
                {
                  id: "task_1",
                  type: "task",
                  name: "Search customer"
                }
              ],

              addFlows: [
                {
                  id: "flow_1",
                  from: "start_1",
                  to: "task_1"
                }
              ]
            },

            "I search for the customer"
          ).process;

        const updated =
          applyProcessChanges(
            withTask,

            {
              ...emptyProcessChanges(),

              updateElements: [
                {
                  id: "task_1",
                  system: "SAP"
                }
              ]
            },

            "in SAP"
          ).process;

        const task =
          updated.elements.find(
            (element) =>
              element.id === "task_1"
          );

        expect(
          task &&
          task.type === "task"
            ? task.system
            : undefined
        ).toBe("SAP");
      }
    );

    // ==================================================
    // REMOVE TASK
    // ==================================================

    it(
      "removes task when connected flows are removed first",
      () => {
        const process =
          createInitialProcess();

        const withTask =
          applyProcessChanges(
            process,

            {
              ...emptyProcessChanges(),

              addElements: [
                {
                  id: "task_1",
                  type: "task",
                  name: "Receive order"
                }
              ],

              addFlows: [
                {
                  id: "flow_1",
                  from: "start_1",
                  to: "task_1"
                }
              ]
            },

            "receive"
          ).process;

        const removed =
          applyProcessChanges(
            withTask,

            {
              ...emptyProcessChanges(),

              removeElementIds: [
                "task_1"
              ],

              removeFlowIds: [
                "flow_1"
              ]
            },

            "remove"
          ).process;

        expect(
          removed.elements.find(
            (element) =>
              element.id === "task_1"
          )
        ).toBeUndefined();

        expect(
          removed.flows.find(
            (flow) =>
              flow.id === "flow_1"
          )
        ).toBeUndefined();
      }
    );

    // ==================================================
    // INVALID FLOW
    // ==================================================

    it(
      "rejects invalid flow references",
      () => {
        const process =
          createInitialProcess();

        expect(
          () =>
            applyProcessChanges(
              process,

              {
                ...emptyProcessChanges(),

                addFlows: [
                  {
                    id: "flow_invalid",
                    from: "start_1",
                    to: "missing_task"
                  }
                ]
              },

              "invalid"
            )
        ).toThrow(
          ProcessValidationError
        );
      }
    );

    // ==================================================
    // EXCLUSIVE GATEWAY
    // ==================================================

    it(
      "supports exclusive gateway elements",
      () => {
        const process =
          createInitialProcess();

        const withGateway =
          applyProcessChanges(
            process,

            {
              ...emptyProcessChanges(),

              addElements: [
                {
                  id: "task_1",
                  type: "task",
                  name: "Validate order"
                },
                {
                  id: "gateway_1",
                  type: "exclusiveGateway",
                  name: "Order complete?"
                },
                {
                  id: "task_2",
                  type: "task",
                  name: "Request missing data"
                }
              ],

              addFlows: [
                {
                  id: "flow_1",
                  from: "start_1",
                  to: "task_1"
                },
                {
                  id: "flow_2",
                  from: "task_1",
                  to: "gateway_1"
                },
                {
                  id: "flow_3",
                  from: "gateway_1",
                  to: "task_2",
                  condition: "No"
                }
              ]
            },

            "gateway"
          ).process;

        expect(
          withGateway.elements.find(
            (element) =>
              element.id ===
              "gateway_1"
          )
        ).toBeTruthy();

        expect(
          withGateway.flows
        ).toHaveLength(3);
      }
    );

    // ==================================================
    // TEMP REFS
    // ==================================================

    it(
      "resolves temporary references atomically",
      () => {
        const process =
          createInitialProcess();

        const result =
          applyProcessChanges(
            process,

            {
              ...emptyProcessChanges(),

              addElements: [
                {
                  tempRef: "new_task",
                  type: "task",
                  name: "Search customer"
                },
                {
                  tempRef: "new_gateway",
                  type: "exclusiveGateway",
                  name: "Customer exists?"
                }
              ],

              addFlows: [
                {
                  id: "flow_1",
                  fromRef: "new_task",
                  toRef: "new_gateway"
                }
              ]
            },

            "I search for the customer"
          );

        expect(
          result.process.elements
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name:
                "Search customer"
            })
          ])
        );

        expect(
          result.process.flows
        ).toHaveLength(1);
      }
    );

    it(
      "rejects unresolved temporary references without applying partial changes",
      () => {
        const process =
          createInitialProcess();

        expect(
          () =>
            applyProcessChanges(
              process,

              {
                ...emptyProcessChanges(),

                addElements: [
                  {
                    tempRef:
                      "new_task",
                    type:
                      "task",
                    name:
                      "Search customer"
                  }
                ],

                addFlows: [
                  {
                    id:
                      "flow_1",
                    fromRef:
                      "missing_ref",
                    toRef:
                      "new_task"
                  }
                ]
              },

              "I search for the customer"
            )
        ).toThrow(
          ProcessValidationError
        );
      }
    );

    // ==================================================
    // LEGACY WORKAROUND CONFIRMATION
    // ==================================================

    it(
      "keeps workaround unconfirmed until explicit confirmation",
      () => {
        const process =
          createInitialProcess();

        const first =
          applyProcessChanges(
            process,

            {
              ...emptyProcessChanges(),

              addElements: [
                {
                  id:
                    "task_1",

                  type:
                    "task",

                  name:
                    "Export data to Excel",

                  workaroundCandidate:
                    true,

                  workaroundConfirmed:
                    true
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
            },

            "Then I export the data to Excel because SAP does not allow price changes"
          ).process;

        const taskAfterFirst =
          first.elements.find(
            (element) =>
              element.id ===
              "task_1"
          );

        expect(
          taskAfterFirst &&
          taskAfterFirst.type ===
            "task"
            ? taskAfterFirst
                .workaroundConfirmed
            : undefined
        ).toBe(false);

        const second =
          applyProcessChanges(
            first,

            {
              ...emptyProcessChanges(),

              updateElements: [
                {
                  id:
                    "task_1",

                  workaroundConfirmed:
                    true
                }
              ]
            },

            "Yes"
          ).process;

        const taskAfterSecond =
          second.elements.find(
            (element) =>
              element.id ===
              "task_1"
          );

        expect(
          taskAfterSecond &&
          taskAfterSecond.type ===
            "task"
            ? taskAfterSecond
                .workaroundConfirmed
            : undefined
        ).toBe(true);
      }
    );

    // ==================================================
    // INITIAL PARTICIPANT
    // ==================================================

    it(
      "creates one internal white-box participant",
      () => {
        const process =
          createInitialProcess();

        expect(
          process.participants
        ).toHaveLength(1);

        expect(
          process.participants[0]
        ).toEqual({
          id:
            "participant_internal",

          name:
            "Own organization",

          type:
            "internal",

          processVisibility:
            "white_box"
        });
      }
    );

    it(
      "assigns the initial start event to the internal participant",
      () => {
        const process =
          createInitialProcess();

        const start =
          process.elements.find(
            (element) =>
              element.type ===
              "start"
          );

        expect(
          start?.participantId
        ).toBe(
          "participant_internal"
        );
      }
    );

    // ==================================================
    // LANES
    // ==================================================

    it(
      "creates a lane inside the internal participant",
      () => {
        const process =
          createInitialProcess();

        const result =
          applyProcessChanges(
            process,

            {
              ...emptyProcessChanges(),

              addLanes: [
                {
                  tempRef:
                    "accounting",

                  participantRef:
                    "participant_internal",

                  name:
                    "Accounting",

                  type:
                    "department"
                }
              ]
            },

            "Accounting handles this"
          ).process;

        expect(
          result.lanes
        ).toHaveLength(1);

        expect(
          result.lanes[0]
        ).toEqual(
          expect.objectContaining({
            name:
              "Accounting",

            participantId:
              "participant_internal",

            type:
              "department"
          })
        );
      }
    );

    // ==================================================
    // LANE ASSIGNMENT
    // ==================================================

    it(
      "assigns a newly created task to a newly created lane",
      () => {
        const process =
          createInitialProcess();

        const result =
          applyProcessChanges(
            process,

            {
              ...emptyProcessChanges(),

              addLanes: [
                {
                  tempRef:
                    "accounting",

                  participantRef:
                    "participant_internal",

                  name:
                    "Accounting",

                  type:
                    "department"
                }
              ],

              addElements: [
                {
                  tempRef:
                    "check_invoice",

                  type:
                    "task",

                  name:
                    "Check invoice",

                  laneRef:
                    "accounting",

                  executionType:
                    "human"
                }
              ],

              addFlows: [
                {
                  fromRef:
                    "start_1",

                  toRef:
                    "check_invoice"
                }
              ]
            },

            "Accounting checks the invoice"
          ).process;

        const lane =
          result.lanes.find(
            (candidate) =>
              candidate.name ===
              "Accounting"
          );

        const task =
          result.elements.find(
            (element) =>
              element.type ===
                "task" &&
              element.name ===
                "Check invoice"
          );

        expect(
          lane
        ).toBeTruthy();

        expect(
          task?.laneId
        ).toBe(
          lane?.id
        );

        expect(
          task?.participantId
        ).toBe(
          "participant_internal"
        );
      }
    );

    // ==================================================
    // EXTERNAL PARTICIPANT + MESSAGE FLOW
    // ==================================================

    it(
      "creates an external participant and message flow",
      () => {
        const process =
          createInitialProcess();

        const result =
          applyProcessChanges(
            process,

            {
              ...emptyProcessChanges(),

              addParticipants: [
                {
                  tempRef:
                    "customer",

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
                    "message_order",

                  fromParticipantRef:
                    "customer",

                  toParticipantRef:
                    "participant_internal",

                  targetElementRef:
                    "start_1",

                  name:
                    "Order"
                }
              ]
            },

            "The customer sends us an order"
          ).process;

        const customer =
          result.participants.find(
            (participant) =>
              participant.name ===
              "Customer"
          );

        expect(
          customer
        ).toBeTruthy();

        expect(
          customer?.processVisibility
        ).toBe(
          "black_box"
        );

        expect(
          result.messageFlows
        ).toHaveLength(1);

        expect(
          result.messageFlows[0]
            .fromParticipantId
        ).toBe(
          customer?.id
        );

        expect(
          result.messageFlows[0]
            .toParticipantId
        ).toBe(
          "participant_internal"
        );
      }
    );
  }
);