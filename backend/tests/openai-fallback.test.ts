import {
  describe,
  expect,
  it
} from "vitest";

import {
  decomposeEmployeeMessage,
  extractCorrectionDirective,
  fallbackResponse,
  responseFormatSchema
} from "../src/openai.js";

import {
  applyProcessChanges,
  createInitialProcess,
  detectWorkaroundSignal
} from "../src/process.js";

import {
  type ProcessChanges
} from "../src/types.js";

type ResponseSchemaNode = {
  type?: string;
  properties?: Record<string, ResponseSchemaNode>;
  required?: string[];
  items?: ResponseSchemaNode;
};

function expectStrictSchemaRequiredKeys(
  schema: ResponseSchemaNode
): void {
  if (
    schema.type === "object" &&
    schema.properties
  ) {
    const propertyNames =
      Object.keys(schema.properties);

    expect(
      schema.required
    ).toEqual(
      expect.arrayContaining(propertyNames)
    );

    expect(
      schema.required
    ).toHaveLength(
      propertyNames.length
    );

    Object.values(
      schema.properties
    ).forEach(
      expectStrictSchemaRequiredKeys
    );
  }

  if (schema.items) {
    expectStrictSchemaRequiredKeys(
      schema.items
    );
  }
}

describe("OpenAI response schema", () => {
  it("requires every property for strict structured outputs", () => {
    expectStrictSchemaRequiredKeys(
      responseFormatSchema as unknown as ResponseSchemaNode
    );
  });
});


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
// FALLBACK DECOMPOSITION
// ======================================================

describe(
  "fallback decomposition",
  () => {
    it(
      "responds in English when fallback receives German input",
      () => {
        const response =
          fallbackResponse(
            "Ich weiß nicht, was ich dazu sagen soll.",
            createInitialProcess()
          );

        expect(
          response.language
        ).toBe("de");

        expect(
          response.assistantMessage
        ).toBe(
          "I was unable to process the input automatically. Please try again."
        );

        expect(
          response.nextQuestion.question
        ).toBe(
          "Could you please describe the process information again?"
        );
      }
    );

    it(
      "extracts multiple normalized activities from one message",
      () => {
        const facts =
          decomposeEmployeeMessage(
            "Then I open SAP and search for the customer."
          );

        expect(
          facts.activities.map(
            (activity) =>
              activity.label
          )
        ).toEqual([
          "Open order",
          "Search customer"
        ]);

        expect(
          facts.activities[0].system
        ).toBe("SAP");
      }
    );

    it(
      "extracts trigger and avoids treating trigger text as full task sentence",
      () => {
        const facts =
          decomposeEmployeeMessage(
            "When an order arrives by email, I start processing it."
          );

        expect(
          facts.trigger
        ).toBe(
          "An order arrives by email"
        );

        expect(
          facts.activities.every(
            (activity) =>
              activity.label.length < 40
          )
        ).toBe(true);
      }
    );

    it(
      "extracts conditional structure metadata",
      () => {
        const facts =
          decomposeEmployeeMessage(
            "If the price is wrong, I export the data to Excel."
          );

        expect(
          facts.hasCondition
        ).toBe(true);

        expect(
          facts.conditionText
        ).toBe(
          "the price is wrong"
        );

        expect(
          facts.activities.map(
            (activity) =>
              activity.label
          )
        ).toContain(
          "Export data to Excel"
        );
      }
    );

    it(
      "does not treat plain Excel usage as workaround evidence by itself",
      () => {
        expect(
          detectWorkaroundSignal(
            "I export everything to Excel."
          )
        ).toBe(false);
      }
    );

    it(
      "extracts rename correction directive",
      () => {
        const directive =
          extractCorrectionDirective(
            "Not search customer, actually validate customer"
          );

        expect(
          directive
        ).toEqual({
          type: "rename",
          fromLabel:
            "search customer",
          toLabel:
            "validate customer"
        });
      }
    );

    // ==================================================
    // RENAME CORRECTION
    // ==================================================

    it(
      "applies rename correction to an existing task",
      () => {
        const process =
          applyProcessChanges(
            createInitialProcess(),

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

            "Then I search for the customer"
          ).process;

        const response =
          fallbackResponse(
            "Not search customer, actually validate customer",
            process
          );

        expect(
          response.changes.updateElements
        ).toHaveLength(1);

        expect(
          response.changes
            .updateElements[0].id
        ).toBe("task_1");

        expect(
          response.changes
            .updateElements[0].name
        ).toBe(
          "Validate customer"
        );

        expect(
          response.changes.addElements
        ).toHaveLength(0);
      }
    );

    // ==================================================
    // REMOVE CORRECTION
    // ==================================================

    it(
      "applies remove correction and reconnects sequence",
      () => {
        const process1 =
          applyProcessChanges(
            createInitialProcess(),

            {
              ...emptyProcessChanges(),

              addElements: [
                {
                  id: "task_1",
                  type: "task",
                  name: "Receive order"
                },
                {
                  id: "task_2",
                  type: "task",
                  name: "Search customer"
                },
                {
                  id: "task_3",
                  type: "task",
                  name: "Check credit"
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
                  to: "task_2"
                },
                {
                  id: "flow_3",
                  from: "task_2",
                  to: "task_3"
                }
              ]
            },

            "setup"
          ).process;

        const response =
          fallbackResponse(
            "We do not perform search customer",
            process1
          );

        expect(
          response.changes
            .removeElementIds
        ).toEqual([
          "task_2"
        ]);

        expect(
          [
            ...response.changes
              .removeFlowIds
          ].sort()
        ).toEqual([
          "flow_2",
          "flow_3"
        ]);

        expect(
          response.changes.addFlows
        ).toHaveLength(1);

        expect(
          response.changes
            .addFlows[0].from
        ).toBe("task_1");

        expect(
          response.changes
            .addFlows[0].to
        ).toBe("task_3");
      }
    );

    // ==================================================
    // INITIAL PARTICIPANT
    // ==================================================

    it(
      "creates the initial internal white-box participant",
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

        expect(
          process.messageFlows
        ).toEqual([]);

        expect(
          process.lanes
        ).toEqual([]);
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
  }
);