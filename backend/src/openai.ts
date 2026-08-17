import OpenAI from "openai";
import { detectWorkaroundSignal, isExplicitConfirmation } from "./process.js";
import { llmProcessResponseSchema } from "./schemas.js";
import { type ChatMessage, type LlmProcessResponse, type ProcessModel, type ProcessChanges } from "./types.js";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

export const SYSTEM_PROMPT = `
You are Workaround Check, a conversational process-elicitation assistant.

Your goal is to reconstruct the employee's actual AS-IS business process through structured conversation.

The ProcessModel is the source of truth.

You must incrementally maintain:

- participants / BPMN pools
- lanes / organizational responsibilities
- process elements
- sequence flows
- message flows
- systems and performers
- workaround candidates

Do not invent organizational information that the employee has not provided.

// ======================================================
// LANGUAGE
// ======================================================

LANGUAGE RULE:

Detect the employee's language.

Always respond in the same language.

Normalize all BPMN activity labels in the employee's language.

NEVER translate German process descriptions into English.

Examples:

German input
→ German activity names
→ German gateway names
→ German participant names where appropriate
→ German lane names where appropriate

English input
→ English model labels.

// ======================================================
// CORE INTERPRETATION PRINCIPLE
// ======================================================

CORE PRINCIPLE — A USER MESSAGE IS NOT AUTOMATICALLY A PROCESS ACTIVITY:

Semantically interpret every message.

One employee message may produce:

- zero activities
- one activity
- multiple activities
- participant information
- lane information
- responsibility information
- system information
- message flows
- sequence flows
- workaround evidence
- corrections
- confirmations
- process completion

Never convert conversational filler into BPMN activities.

// ======================================================
// ACTIVITY EXTRACTION
// ======================================================

ACTIVITY EXTRACTION — CRITICAL:

- Extract ALL activities from one message, not just the first one.
- Split compound sentences into individual atomic activities.
- One task = one meaningful business action.
- Split coordinated verbs:
  "X, then Y and Z"
  → three separate tasks.
- Normalize labels to short verb-object phrases in the employee's language.
- Remove filler words such as:
  dann,
  danach,
  anschließend,
  zuerst,
  wieder,
  first,
  then,
  next.
- The used system/tool is SEPARATE metadata and is normally NOT part of the activity name.
- The performer/role is SEPARATE metadata and is normally NOT part of the activity name.
- The lane assignment is SEPARATE metadata.

German normalization examples:

"öffne ich sie in SAP"
→ name:"Bestellung öffnen"
→ system:"SAP"

"prüfe die Kundendaten"
→ name:"Kundendaten prüfen"

"exportiere danach die Daten nach Excel"
→ name:"Daten nach Excel exportieren"
→ system:"Excel"

"korrigiere die Preise dort manuell"
→ name:"Preise manuell korrigieren"
→ system:"Excel"

"übertrage die korrigierten Daten zurück"
→ name:"Daten in SAP übertragen"
→ system:"SAP"

// ======================================================
// PARTICIPANTS / BPMN POOLS
// ======================================================

PARTICIPANT RULES:

A participant represents an organizationally independent BPMN participant / pool.

For this prototype there is exactly ONE internally modeled white-box participant.

The existing internal participant is normally:

participant_internal

Read the current ProcessModel and use its actual participant ID.

DO NOT create another internal participant when the employee mentions:

- a department
- a role
- a team
- a colleague
- a manager
- another internal organizational unit

These normally become LANES inside the existing internal participant.

Examples:

"Buchhaltung"
→ normally a lane

"Vertrieb"
→ normally a lane

"Einkauf"
→ normally a lane

"Kundenservice"
→ normally a lane

"Teamleiter"
→ normally a lane or role information

External organizationally independent actors normally become separate participants.

Examples:

"Kunde"
→ external participant

"Lieferant"
→ external participant

"Behörde"
→ external participant

"Bank"
→ external participant

"externer Dienstleister"
→ external participant

External participants should normally be:

type:"external"
processVisibility:"black_box"

unless the current ProcessModel already defines them differently.

Do not model the internal process of a black-box participant.

// ======================================================
// PARTICIPANT DEDUPLICATION
// ======================================================

PARTICIPANT DEDUPLICATION:

Before creating a participant:

- inspect participants already present in the ProcessModel
- do not create duplicates
- reuse an existing participant if it represents the same actor

Examples:

"Kunde"
and later
"der Kunde"

→ same participant

"Lieferant"
and later
"unser Lieferant"

→ same participant unless the employee clearly distinguishes different suppliers.

// ======================================================
// LANES
// ======================================================

LANE RULES:

A lane represents responsibility inside a modeled participant.

A lane may represent:

- role
- department
- team
- system only when autonomous system responsibility is intentionally modeled

Typical lane types:

role
department
team

Examples:

"Danach übernimmt die Buchhaltung."
→ create or reuse lane "Buchhaltung"
→ type:"department"

"Das prüft unser Vertrieb."
→ create or reuse lane "Vertrieb"
→ type:"department"

"Danach bearbeitet der Sachbearbeiter den Auftrag."
→ potentially create/reuse lane "Sachbearbeitung"
  or a role lane if the organizational role is explicit.

Never create a lane merely called:

- Ich
- I
- Me
- Mitarbeiter
- Employee
- User

when the employee says:

"Ich mache ..."

"I do ..."

The word "I" only identifies the current employee as performer.

If the employee's actual role or department is still unknown:

- do NOT invent a lane
- leave lane assignment unresolved
- ask for the role/department later only if it is relevant.

// ======================================================
// PERFORMER VS LANE
// ======================================================

PERFORMER AND RESPONSIBILITY ARE DIFFERENT:

performer
= the concrete role or actor executing a task

lane
= the organizational responsibility represented in BPMN

Example:

"Als Sachbearbeiter prüfe ich die Kundendaten."

Possible interpretation:

performer:"Sachbearbeiter"
lane:"Auftragssachbearbeitung"

Do not invent "Auftragssachbearbeitung" unless that department or lane is actually known.

If only the role is known:

performer:"Sachbearbeiter"

and lane may remain unknown.

// ======================================================
// SYSTEMS ARE NOT AUTOMATICALLY LANES
// ======================================================

SYSTEM VS ACTOR — CRITICAL:

A software system used by an employee is a TOOL, not automatically a BPMN participant or lane.

Example:

"Ich öffne die Bestellung in SAP."

means:

name:"Bestellung öffnen"
system:"SAP"
executionType:"human"

It does NOT mean:

lane:"SAP"

and does NOT mean:

participant:"SAP"

Another example:

"Ich korrigiere die Preise in Excel."

means:

system:"Excel"
executionType:"human"

Do NOT create an Excel lane.

If a system autonomously performs an activity:

"SAP erstellt automatisch die Rechnung."

then:

system:"SAP"
executionType:"automated"

The task may remain inside the relevant internal participant.

Do not create a separate SAP participant merely because SAP performs an automated step.

For this prototype, only create a system participant when the employee clearly describes communication with an organizationally separate external system and modeling it as an independent black-box participant is necessary.

Otherwise prefer task metadata:

system
executionType.

// ======================================================
// EXECUTION TYPE
// ======================================================

EXECUTION TYPE:

Use:

"human"
when a person performs the activity.

"automated"
when a system performs the activity autonomously.

"mixed"
only when both human and automated execution are materially part of the same atomic activity.

Examples:

"Ich prüfe die Bestellung in SAP."
→ executionType:"human"

"SAP prüft automatisch die Kreditwürdigkeit."
→ executionType:"automated"

// ======================================================
// LANE ASSIGNMENT
// ======================================================

LANE ASSIGNMENT:

When an employee clearly states who performs an existing activity, update the existing activity rather than duplicating it.

Example:

Existing task:
"Kundendaten prüfen"

Employee:
"Das macht die Buchhaltung."

→ create/reuse lane "Buchhaltung"
→ updateElements for the existing activity
→ assign laneRef or laneId
→ do NOT create another task "Kundendaten prüfen"

When assigning an activity to a lane created in the SAME response:

use laneRef with the new lane's tempRef.

Example:

addLanes:
tempRef:"lane1"

updateElements:
laneRef:"lane1"

// ======================================================
// HANDOFFS
// ======================================================

HANDOFF DETECTION — IMPORTANT:

Detect changes of responsibility.

Examples:

"Danach übernimmt die Buchhaltung."

"Anschließend gebe ich den Vorgang an den Vertrieb weiter."

"Dann geht der Fall an meinen Vorgesetzten."

These statements may indicate a lane handoff.

A handoff between two lanes of the SAME participant:

→ keep SequenceFlow
→ change lane assignment between activities

Example:

Lane Vertrieb
Task A
   ↓ SequenceFlow
Lane Buchhaltung
Task B

A lane boundary does NOT require a MessageFlow.

// ======================================================
// EXTERNAL COMMUNICATION
// ======================================================

EXTERNAL COMMUNICATION:

Communication between different participants / pools must be represented using MessageFlow.

Examples:

"Der Kunde schickt uns eine Bestellung."

Possible interpretation:

external participant:
"Kunde"

internal participant:
existing internal participant

message:
"Bestellung"

→ MessageFlow from Kunde to internal participant

"Ich sende die Bestellung an den Lieferanten."

Possible interpretation:

task:
"Bestellung senden"

external participant:
"Lieferant"

message flow:
internal participant → Lieferant

Do NOT create a SequenceFlow across participant boundaries.

// ======================================================
// SEQUENCE FLOW VS MESSAGE FLOW
// ======================================================

FLOW RULE — CRITICAL:

SequenceFlow:
- connects BPMN flow nodes inside the SAME participant
- may cross lanes
- must NOT cross participant / pool boundaries

MessageFlow:
- represents communication between DIFFERENT participants
- must NOT connect a participant to itself

Examples:

Sales → Accounting
inside the same organization
→ SequenceFlow

Company → Customer
→ MessageFlow

Company → Supplier
→ MessageFlow

Never use SequenceFlow to connect activities that belong to different participants.

// ======================================================
// BLACK-BOX PARTICIPANTS
// ======================================================

BLACK-BOX PARTICIPANT RULE:

External black-box participants do not contain:

- tasks
- gateways
- start events
- end events
- lanes

Only model:

- the participant itself
- relevant MessageFlows to/from it

Example:

Customer
→ black-box participant

Do NOT invent:

Customer:
  Receive invoice
  Read invoice
  Pay invoice

unless the employee is explicitly describing and the system is intended to model that participant's process, which is outside the normal scope of this prototype.

// ======================================================
// ORGANIZATIONAL UNCERTAINTY
// ======================================================

ORGANIZATIONAL UNCERTAINTY:

Do not guess whether an actor is internal or external when the employee's statement is ambiguous.

Example:

"Danach geht es an die Buchhaltung."

Usually this can reasonably be interpreted as an internal lane.

But:

"Danach geht es an unseren Buchhaltungsdienstleister."

→ external participant.

If the organizational boundary is genuinely unclear:

- create an uncertainty with type:"participant"
  or type:"lane"
- use nextQuestion.kind:"participant_boundary"
  when clarification is necessary.

Example question in German:

"Ist die Buchhaltung Teil Ihres Unternehmens oder ein externer Dienstleister?"

Ask only when the distinction materially affects the BPMN model.

// ======================================================
// TRIGGER DETECTION
// ======================================================

TRIGGER DETECTION:

A process trigger updates the existing start event.

Do NOT create a separate trigger task.

German:

"Wenn eine Bestellung per E-Mail kommt"

→ update existing start event name:
"Bestellung eingegangen"

Use the start event ID from the current ProcessModel.

Example:

updateElements:
id:"start_1"
name:"Bestellung eingegangen"

Do NOT create a gateway for process-start conditions.

The start event should normally remain assigned to the existing internal participant.

If a lane is clearly responsible for receiving/handling the trigger, lane assignment may be added.

A message from an external participant may additionally be represented through MessageFlow.

Example:

"Kunde sendet Bestellung per E-Mail."

may result in:

- external participant "Kunde"
- start event "Bestellung eingegangen"
- MessageFlow Kunde → start event/internal participant

Do not create a separate internal task merely to represent the arrival of the message unless an actual employee action is described.

// ======================================================
// GATEWAYS
// ======================================================

GATEWAY RULES:

Only create an exclusiveGateway when describing a REAL alternative branch.

Example:

"Wenn der Kunde nicht existiert, lege ich ihn an."

Possible gateway:

"Kunde vorhanden?"

with alternative branches.

Do NOT create a gateway for:

- process triggers
- temporal phrases
- simple sequencing
- lane changes
- participant changes
- external messages alone.

// ======================================================
// TEMPREF RULES
// ======================================================

TEMPREF RULES — CRITICAL:

Every NEW participant in addParticipants MUST have a unique tempRef.

Examples:

"p1"
"customer1"
"supplier1"

Every NEW lane in addLanes MUST have a unique tempRef.

Examples:

"lane1"
"accounting1"
"sales1"

Every NEW element in addElements MUST have a unique tempRef.

Examples:

"t1"
"t2"
"gw1"
"end1"

Do NOT use the id field for new elements when a tempRef can be used.

New elements may reference:

participantRef:
- an existing participant ID
- OR a participant tempRef created in THIS response

laneRef:
- an existing lane ID
- OR a lane tempRef created in THIS response

Every sequence flow in addFlows uses fromRef and toRef.

fromRef/toRef may be:

- a tempRef of a new element in THIS response
- OR an existing element ID from the ProcessModel

Every MessageFlow uses:

fromParticipantRef
toParticipantRef

These may be:

- participant tempRefs created in THIS response
- OR existing participant IDs

MessageFlows may additionally use:

sourceElementRef
targetElementRef

These may reference:

- new element tempRefs
- existing element IDs.

// ======================================================
// INCREMENTAL MODELING
// ======================================================

INCREMENTAL MODELING:

Read the complete ProcessModel from context before proposing changes.

Always inspect:

- participants
- lanes
- elements
- flows
- messageFlows
- workarounds

Do NOT duplicate:

- participants
- lanes
- activities
- gateways
- start/end events
- message flows

If an existing object only needs additional information:

→ use the corresponding update operation.

Examples:

existing task needs system
→ updateElements

existing task gets lane
→ updateElements

existing lane is renamed
→ updateLanes

existing participant classification changes
→ updateParticipants

Preserve all model content not affected by the current employee message.

// ======================================================
// CORRECTIONS
// ======================================================

CORRECTIONS:

Employee corrections override previous interpretation.

Examples:

"Nein, das macht nicht der Vertrieb, sondern die Buchhaltung."

→ intent:"correction"
→ reuse/create Buchhaltung lane
→ update the affected task's lane
→ do NOT create a duplicate task.

"Der Lieferant ist eigentlich intern."

If this conflicts with the prototype's participant model or existing semantics, clarify before producing an invalid model.

"Excel kommt vor SAP."

→ modify sequence relationships
→ do NOT create duplicate tasks.

// ======================================================
// CONFIRMATIONS AND REJECTIONS
// ======================================================

CONFIRMATIONS AND REJECTIONS:

Read the pending question from context.

"Ja" / "Yes"
→ confirm the pending interpretation
→ ZERO new tasks unless confirmation explicitly contains new process information
→ intent:"confirmation"

"Nein" / "No"
→ reject the pending interpretation
→ ZERO new tasks unless the employee also provides a correction
→ intent:"rejection"

NEVER create activities named:

"Ja"
"Nein"
"Yes"
"No"

// ======================================================
// PROCESS COMPLETION
// ======================================================

PROCESS COMPLETION:

If the employee explicitly indicates that the process is finished:

intent:"process_completion"

Examples:

"End"
"Done"
"That's it"
"Finished"
"Ende"
"Das war's"
"Fertig"

Do NOT update the start event when the employee indicates process completion.

If the current modeled internal process has no end event yet:

- create exactly one end element
- connect the last logical activity to the new end event
- use a unique tempRef such as "end1"

The end event is NOT a task.

The end event should belong to the same participant as the preceding internal activity.

If the preceding activity has a lane and the process semantics support it, the end event may use the same lane.

Do not set task-specific metadata on:

- start events
- gateways
- end events

Task-specific metadata includes:

- performer
- system
- executionType
- employeeConfirmed
- workaroundCandidate
- workaroundConfirmed
- workaroundReason
- workaroundCategory.

// ======================================================
// WORKAROUND DETECTION
// ======================================================

WORKAROUND DETECTION:

Only create a workaround candidate when there is evidence of deviation, system misfit, organizational misfit, policy deviation, manual rework, missing functionality, missing authorization, or another explicit workaround signal.

Signals include:

"weil [system] das nicht kann"

"weil das in SAP nicht möglich ist"

"fehlende Berechtigung"

"eigentlich sollte"

"normalerweise"

"ich mache das trotzdem"

"sonst dauert es zu lange"

"deshalb mache ich es selbst"

Do NOT classify Excel use or manual work as a workaround merely because it is manual.

One workaround may span multiple related activities.

List ALL affected activities in relatedActivityRefs.

A workaround is created as suspected.

NEVER auto-confirm a workaround.

// ======================================================
// ORGANIZATIONAL WORKAROUNDS
// ======================================================

WORKAROUNDS MAY INVOLVE RESPONSIBILITY:

A workaround may involve a deviation from the expected organizational responsibility.

Example:

"Eigentlich müsste die Buchhaltung die Preise korrigieren,
aber weil das immer zwei Tage dauert, mache ich es selbst in Excel."

Interpret the actual process first:

- actual performer / lane executes the activity
- preserve the actual AS-IS sequence

Then create a workaround candidate.

Possible workaround evidence:

actualPractice:
employee corrects prices personally in Excel

expectedPractice:
accounting should correct prices

obstacleOrMisfit:
handoff to accounting takes too long

Do NOT change the AS-IS BPMN model to the expected process.

The BPMN model represents actual practice.

Expected practice belongs in workaround metadata.

// ======================================================
// WORKAROUND CONFIRMATION
// ======================================================

WORKAROUND CONFIRMATION:

A suspected workaround is not confirmed merely because it was detected.

Ask for validation when appropriate.

Example:

"Verstehe ich richtig, dass die Preise im vorgesehenen Ablauf eigentlich direkt in SAP bzw. durch eine andere Stelle geändert werden sollten?"

Only change workaround status to "confirmed" when the employee explicitly confirms the interpretation.

If rejected:

status:"rejected"

// ======================================================
// STRUCTURED OUTPUT / PATCH SEMANTICS
// ======================================================

STRUCTURED OUTPUT RULES — CRITICAL:

Always return the complete changes object required by the response schema.

The changes object contains:

- addParticipants
- updateParticipants
- removeParticipantIds
- addLanes
- updateLanes
- removeLaneIds
- addElements
- updateElements
- removeElementIds
- addFlows
- removeFlowIds
- addMessageFlows
- removeMessageFlowIds
- addWorkarounds
- updateWorkarounds

If there are no changes of a given type:

return an empty array [].

Never omit required arrays.

For PATCH/update objects:

- null means "do not update this property"
- false is a real boolean value
- "" should not be used to represent unknown optional metadata unless the JSON schema explicitly requires an empty string
- do not invent values merely to avoid null

For contextPatch:

- use null for unknown values
- never use an empty string for unknown context values

contextPatch may contain:

- name
- goal
- trigger
- outcome.

// ======================================================
// RESPONSE BEHAVIOR
// ======================================================

RESPONSE:

assistantMessage must be in the employee's language.

Keep the assistant message concise.

It should normally contain:

1. a brief confirmation of what was understood
2. at most one focused next question

Do not ask unnecessary organizational questions after every activity.

Prefer passive extraction first.

Only ask about:

- role
- lane
- participant boundary
- handoff
- workaround interpretation

when the missing information materially affects the process model.

If the employee's message contains five activities:

→ put all five activities in addElements or update existing activities as necessary.

NEVER stop after the first activity identified.

If the employee describes multiple organizational facts in one message:

→ capture all of them in the same response.

If the employee describes a lane, external participant, multiple tasks, and a message flow in one message:

→ model all of them in the same response when sufficiently clear.

// ======================================================
// FINAL MODELING PRINCIPLE
// ======================================================

FINAL PRINCIPLE:

Model what actually happens in the AS-IS process.

Do not replace actual practice with:

- expected process
- official procedure
- ideal process
- system documentation

Actual employee behavior belongs in the ProcessModel.

Differences between actual and expected practice belong in workaround metadata.
`;

export const responseFormatSchema = {
  type: "object",
  additionalProperties: false,

  properties: {
    // ==================================================
    // LANGUAGE
    // ==================================================

    language: {
      type: "string",
      enum: [
        "de",
        "en"
      ]
    },

    // ==================================================
    // INTENT
    // ==================================================

    intent: {
      type: "string",
      enum: [
        "process_description",
        "answer_to_question",
        "correction",
        "confirmation",
        "rejection",
        "workaround_detail",
        "process_completion",
        "unclear"
      ]
    },

    assistantMessage: {
      type: "string"
    },

    // ==================================================
    // PROCESS CONTEXT
    // ==================================================

    contextPatch: {
      type: "object",
      additionalProperties: false,

      properties: {
        name: {
          type: [
            "string",
            "null"
          ]
        },

        goal: {
          type: [
            "string",
            "null"
          ]
        },

        trigger: {
          type: [
            "string",
            "null"
          ]
        },

        outcome: {
          type: [
            "string",
            "null"
          ]
        }
      },

      required: [
        "name",
        "goal",
        "trigger",
        "outcome"
      ]
    },

    // ==================================================
    // PROCESS CHANGES
    // ==================================================

    changes: {
      type: "object",
      additionalProperties: false,

      properties: {
        // =================================================
        // ADD PARTICIPANTS / POOLS
        // =================================================

        addParticipants: {
          type: "array",

          items: {
            type: "object",
            additionalProperties: false,

            properties: {
              tempRef: {
                type: "string"
              },

              name: {
                type: "string"
              },

              type: {
                type: "string",
                enum: [
                  "internal",
                  "external",
                  "system"
                ]
              },

              processVisibility: {
                type: "string",
                enum: [
                  "white_box",
                  "black_box"
                ]
              }
            },

            required: [
              "tempRef",
              "name",
              "type",
              "processVisibility"
            ]
          }
        },

        // =================================================
        // UPDATE PARTICIPANTS
        // =================================================
        //
        // null = leave property unchanged.
        // =================================================

        updateParticipants: {
          type: "array",

          items: {
            type: "object",
            additionalProperties: false,

            properties: {
              id: {
                type: "string"
              },

              name: {
                type: [
                  "string",
                  "null"
                ]
              },

              type: {
                type: [
                  "string",
                  "null"
                ],
                enum: [
                  "internal",
                  "external",
                  "system",
                  null
                ]
              },

              processVisibility: {
                type: [
                  "string",
                  "null"
                ],
                enum: [
                  "white_box",
                  "black_box",
                  null
                ]
              }
            },

            required: [
              "id",
              "name",
              "type",
              "processVisibility"
            ]
          }
        },

        // =================================================
        // REMOVE PARTICIPANTS
        // =================================================

        removeParticipantIds: {
          type: "array",

          items: {
            type: "string"
          }
        },

        // =================================================
        // ADD LANES
        // =================================================

        addLanes: {
          type: "array",

          items: {
            type: "object",
            additionalProperties: false,

            properties: {
              tempRef: {
                type: "string"
              },

              participantRef: {
                type: "string"
              },

              name: {
                type: "string"
              },

              type: {
                type: "string",
                enum: [
                  "role",
                  "department",
                  "team",
                  "system"
                ]
              }
            },

            required: [
              "tempRef",
              "participantRef",
              "name",
              "type"
            ]
          }
        },

        // =================================================
        // UPDATE LANES
        // =================================================

        updateLanes: {
          type: "array",

          items: {
            type: "object",
            additionalProperties: false,

            properties: {
              id: {
                type: "string"
              },

              name: {
                type: [
                  "string",
                  "null"
                ]
              },

              type: {
                type: [
                  "string",
                  "null"
                ],
                enum: [
                  "role",
                  "department",
                  "team",
                  "system",
                  null
                ]
              },

              participantId: {
                type: [
                  "string",
                  "null"
                ]
              },

              participantRef: {
                type: [
                  "string",
                  "null"
                ]
              }
            },

            required: [
              "id",
              "name",
              "type",
              "participantId",
              "participantRef"
            ]
          }
        },

        // =================================================
        // REMOVE LANES
        // =================================================

        removeLaneIds: {
          type: "array",

          items: {
            type: "string"
          }
        },

        // =================================================
        // ADD PROCESS ELEMENTS
        // =================================================
        //
        // New elements always use tempRef.
        //
        // participantRef/laneRef may reference:
        //
        // - an existing stable ID
        // - a tempRef created in this response
        //
        // Task-only metadata must be null for
        // non-task elements.
        // =================================================

        addElements: {
          type: "array",

          items: {
            type: "object",
            additionalProperties: false,

            properties: {
              tempRef: {
                type: "string"
              },

              type: {
                type: "string",
                enum: [
                  "start",
                  "task",
                  "exclusiveGateway",
                  "end"
                ]
              },

              name: {
                type: "string"
              },

              participantRef: {
                type: [
                  "string",
                  "null"
                ]
              },

              laneRef: {
                type: [
                  "string",
                  "null"
                ]
              },

              performer: {
                type: [
                  "string",
                  "null"
                ]
              },

              system: {
                type: [
                  "string",
                  "null"
                ]
              },

              executionType: {
                type: [
                  "string",
                  "null"
                ],
                enum: [
                  "human",
                  "automated",
                  "mixed",
                  null
                ]
              },

              employeeConfirmed: {
                type: [
                  "boolean",
                  "null"
                ]
              },

              // ------------------------------------------
              // Legacy task-level workaround information
              // ------------------------------------------

              workaroundCandidate: {
                type: [
                  "boolean",
                  "null"
                ]
              },

              workaroundConfirmed: {
                type: [
                  "boolean",
                  "null"
                ]
              },

              workaroundReason: {
                type: [
                  "string",
                  "null"
                ]
              },

              workaroundCategory: {
                type: [
                  "string",
                  "null"
                ],
                enum: [
                  "system_limitation",
                  "missing_functionality",
                  "manual_rework",
                  "data_quality",
                  "missing_authorization",
                  "performance",
                  "policy_deviation",
                  "other",
                  null
                ]
              }
            },

            required: [
              "tempRef",
              "type",
              "name",
              "participantRef",
              "laneRef",
              "performer",
              "system",
              "executionType",
              "employeeConfirmed",
              "workaroundCandidate",
              "workaroundConfirmed",
              "workaroundReason",
              "workaroundCategory"
            ]
          }
        },

        // =================================================
        // UPDATE EXISTING ELEMENTS
        // =================================================
        //
        // null = do not change this property.
        // =================================================

        updateElements: {
          type: "array",

          items: {
            type: "object",
            additionalProperties: false,

            properties: {
              id: {
                type: "string"
              },

              name: {
                type: [
                  "string",
                  "null"
                ]
              },

              participantId: {
                type: [
                  "string",
                  "null"
                ]
              },

              laneId: {
                type: [
                  "string",
                  "null"
                ]
              },

              participantRef: {
                type: [
                  "string",
                  "null"
                ]
              },

              laneRef: {
                type: [
                  "string",
                  "null"
                ]
              },

              performer: {
                type: [
                  "string",
                  "null"
                ]
              },

              system: {
                type: [
                  "string",
                  "null"
                ]
              },

              executionType: {
                type: [
                  "string",
                  "null"
                ],
                enum: [
                  "human",
                  "automated",
                  "mixed",
                  null
                ]
              },

              employeeConfirmed: {
                type: [
                  "boolean",
                  "null"
                ]
              },

              workaroundCandidate: {
                type: [
                  "boolean",
                  "null"
                ]
              },

              workaroundConfirmed: {
                type: [
                  "boolean",
                  "null"
                ]
              },

              workaroundReason: {
                type: [
                  "string",
                  "null"
                ]
              },

              workaroundCategory: {
                type: [
                  "string",
                  "null"
                ],
                enum: [
                  "system_limitation",
                  "missing_functionality",
                  "manual_rework",
                  "data_quality",
                  "missing_authorization",
                  "performance",
                  "policy_deviation",
                  "other",
                  null
                ]
              }
            },

            required: [
              "id",
              "name",
              "participantId",
              "laneId",
              "participantRef",
              "laneRef",
              "performer",
              "system",
              "executionType",
              "employeeConfirmed",
              "workaroundCandidate",
              "workaroundConfirmed",
              "workaroundReason",
              "workaroundCategory"
            ]
          }
        },

        // =================================================
        // REMOVE ELEMENTS
        // =================================================

        removeElementIds: {
          type: "array",

          items: {
            type: "string"
          }
        },

        // =================================================
        // ADD SEQUENCE FLOWS
        // =================================================
        //
        // Sequence Flows remain inside one participant.
        // =================================================

        addFlows: {
          type: "array",

          items: {
            type: "object",
            additionalProperties: false,

            properties: {
              fromRef: {
                type: "string"
              },

              toRef: {
                type: "string"
              },

              condition: {
                type: [
                  "string",
                  "null"
                ]
              }
            },

            required: [
              "fromRef",
              "toRef",
              "condition"
            ]
          }
        },

        // =================================================
        // REMOVE SEQUENCE FLOWS
        // =================================================

        removeFlowIds: {
          type: "array",

          items: {
            type: "string"
          }
        },

        // =================================================
        // ADD MESSAGE FLOWS
        // =================================================
        //
        // Message Flows connect DIFFERENT participants.
        // =================================================

        addMessageFlows: {
          type: "array",

          items: {
            type: "object",
            additionalProperties: false,

            properties: {
              tempRef: {
                type: "string"
              },

              fromParticipantRef: {
                type: "string"
              },

              toParticipantRef: {
                type: "string"
              },

              sourceElementRef: {
                type: [
                  "string",
                  "null"
                ]
              },

              targetElementRef: {
                type: [
                  "string",
                  "null"
                ]
              },

              name: {
                type: [
                  "string",
                  "null"
                ]
              }
            },

            required: [
              "tempRef",
              "fromParticipantRef",
              "toParticipantRef",
              "sourceElementRef",
              "targetElementRef",
              "name"
            ]
          }
        },

        // =================================================
        // REMOVE MESSAGE FLOWS
        // =================================================

        removeMessageFlowIds: {
          type: "array",

          items: {
            type: "string"
          }
        },

        // =================================================
        // ADD WORKAROUND
        // =================================================

        addWorkarounds: {
          type: "array",

          items: {
            type: "object",
            additionalProperties: false,

            properties: {
              tempRef: {
                type: "string"
              },

              relatedActivityRefs: {
                type: "array",

                items: {
                  type: "string"
                }
              },

              actualPractice: {
                type: "string"
              },

              obstacleOrMisfit: {
                type: [
                  "string",
                  "null"
                ]
              },

              category: {
                type: [
                  "string",
                  "null"
                ],

                enum: [
                  "system_limitation",
                  "missing_functionality",
                  "manual_rework",
                  "data_quality",
                  "missing_authorization",
                  "performance",
                  "policy_deviation",
                  "other",
                  null
                ]
              }
            },

            required: [
              "tempRef",
              "relatedActivityRefs",
              "actualPractice",
              "obstacleOrMisfit",
              "category"
            ]
          }
        },

        // =================================================
        // UPDATE WORKAROUND
        // =================================================

        updateWorkarounds: {
          type: "array",

          items: {
            type: "object",
            additionalProperties: false,

            properties: {
              id: {
                type: "string"
              },

              relatedActivityIds: {
                type: [
                  "array",
                  "null"
                ],

                items: {
                  type: "string"
                }
              },

              actualPractice: {
                type: [
                  "string",
                  "null"
                ]
              },

              expectedPractice: {
                type: [
                  "string",
                  "null"
                ]
              },

              obstacleOrMisfit: {
                type: [
                  "string",
                  "null"
                ]
              },

              goalOrMotivation: {
                type: [
                  "string",
                  "null"
                ]
              },

              category: {
                type: [
                  "string",
                  "null"
                ],

                enum: [
                  "system_limitation",
                  "missing_functionality",
                  "manual_rework",
                  "data_quality",
                  "missing_authorization",
                  "performance",
                  "policy_deviation",
                  "other",
                  null
                ]
              },

              frequency: {
                type: [
                  "string",
                  "null"
                ]
              },

              logVisibility: {
                type: [
                  "string",
                  "null"
                ],

                enum: [
                  "logged",
                  "partially_logged",
                  "not_logged",
                  "unknown",
                  null
                ]
              },

              status: {
                type: [
                  "string",
                  "null"
                ],

                enum: [
                  "suspected",
                  "confirmed",
                  "rejected",
                  null
                ]
              },

              evidenceMessageIds: {
                type: [
                  "array",
                  "null"
                ],

                items: {
                  type: "string"
                }
              }
            },

            required: [
              "id",
              "relatedActivityIds",
              "actualPractice",
              "expectedPractice",
              "obstacleOrMisfit",
              "goalOrMotivation",
              "category",
              "frequency",
              "logVisibility",
              "status",
              "evidenceMessageIds"
            ]
          }
        }
      },

      // =================================================
      // ALL CHANGE GROUPS ARE ALWAYS PRESENT
      // =================================================

      required: [
        "addParticipants",
        "updateParticipants",
        "removeParticipantIds",

        "addLanes",
        "updateLanes",
        "removeLaneIds",

        "addElements",
        "updateElements",
        "removeElementIds",

        "addFlows",
        "removeFlowIds",

        "addMessageFlows",
        "removeMessageFlowIds",

        "addWorkarounds",
        "updateWorkarounds"
      ]
    },

    // ==================================================
    // UNCERTAINTIES
    // ==================================================

    uncertainties: {
      type: "array",

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          type: {
            type: "string",

            enum: [
              "sequence",
              "condition",
              "meaning",
              "workaround",
              "reference",

              // Organizational uncertainties
              "participant",
              "lane",
              "handoff"
            ]
          },

          targetRefs: {
            type: "array",

            items: {
              type: "string"
            }
          },

          description: {
            type: "string"
          }
        },

        required: [
          "type",
          "targetRefs",
          "description"
        ]
      }
    },

    // ==================================================
    // NEXT QUESTION
    // ==================================================

    nextQuestion: {
      type: "object",
      additionalProperties: false,

      properties: {
        required: {
          type: "boolean"
        },

        kind: {
          type: "string",

          enum: [
            "clarification",
            "element_confirmation",
            "sequence_confirmation",

            // Organizational elicitation
            "participant_boundary",
            "actor_role",
            "lane_assignment",
            "handoff_target",

            // Workaround elicitation
            "workaround_expected_practice",
            "workaround_obstacle",
            "workaround_goal",
            "workaround_frequency",
            "workaround_log_visibility",
            "workaround_confirmation"
          ]
        },

        targetRefs: {
          type: "array",

          items: {
            type: "string"
          }
        },

        question: {
          type: "string"
        }
      },

      required: [
        "required",
        "kind",
        "targetRefs",
        "question"
      ]
    },

    // ==================================================
    // VALIDATION REQUEST
    // ==================================================

    validationRequest: {
      type: "object",
      additionalProperties: false,

      properties: {
        required: {
          type: "boolean"
        },

        elementIds: {
          type: "array",

          items: {
            type: "string"
          }
        },

        question: {
          type: "string"
        }
      },

      required: [
        "required",
        "elementIds",
        "question"
      ]
    }
  },

  // ====================================================
  // TOP-LEVEL REQUIRED
  // ====================================================

  required: [
    "language",
    "intent",
    "assistantMessage",
    "contextPatch",
    "changes",
    "uncertainties",
    "nextQuestion",
    "validationRequest"
  ]
} as const;

function getOpenAIClient(): OpenAI | undefined {
  const apiKey =
    process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return undefined;
  }

  return new OpenAI({
    apiKey
  });
}

function getModel(): string {
  return (
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4.1-mini"
  );
}

function compactConversation(messages: ChatMessage[]): string {
  return messages
    .slice(-14)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");
}

function detectLanguage(text: string): "de" | "en" {
  return /\b(ich|wir|der|die|das|ein|eine|und|oder|nicht|ist|sind|wird|werden|haben|bitte|danke|machen|dann|danach|wenn|falls)\b/i.test(text)
    ? "de"
    : "en";
}

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

function buildClarificationResponse(
  lang: "de" | "en"
): LlmProcessResponse {
  const de = lang === "de";

  return {
    language: lang,
    intent: "unclear",

    assistantMessage: de
      ? "Ich konnte die Eingabe leider nicht automatisch verarbeiten. Bitte versuchen Sie es noch einmal."
      : "I was unable to process the input automatically. Please try again.",

    contextPatch: {},

    changes: emptyProcessChanges(),

    uncertainties: [
      {
        type: "meaning",
        targetRefs: [],
        description: "Input could not be semantically parsed"
      }
    ],

    nextQuestion: {
      required: true,
      kind: "clarification",
      targetRefs: [],
      question: de
        ? "Können Sie die Prozessinformation bitte noch einmal formulieren?"
        : "Could you please describe the process information again?"
    },

    validationRequest: {
      required: false,
      elementIds: [],
      question: ""
    }
  };
}

function failProcessing(
  lang: "de" | "en",
  code: string,
  details?: unknown
): LlmProcessResponse {
  let detailMessage = "";

  if (details instanceof Error) {
    detailMessage = details.message;
  } else if (typeof details === "string") {
    detailMessage = details;
  } else if (details !== undefined) {
    try {
      detailMessage = JSON.stringify(details);
    } catch {
      detailMessage = String(details);
    }
  }

  console.error(
    `[workaround-check] ${code}`,
    detailMessage || details || ""
  );

  // During development we want the REAL failure,
  // not a seemingly valid clarification response.
  if (process.env.NODE_ENV !== "production") {
    throw new Error(
      detailMessage
        ? `${code}: ${detailMessage}`
        : code
    );
  }

  // Production can still degrade gracefully.
  return buildClarificationResponse(lang);
}

type ExtractedActivity = {
  label: string;
  system?: string;
};

type ExtractedFacts = {
  trigger?: string;
  activities: ExtractedActivity[];
  hasCondition: boolean;
  conditionText?: string;
  confirmation: "confirm" | "reject" | "none";
  workaroundEvidence: boolean;
};

type CorrectionDirective =
  | { type: "rename"; fromLabel: string; toLabel: string }
  | { type: "remove"; targetLabel: string };

function cleanText(value: string): string {
  return value.replace(/[.!?]+$/g, "").trim();
}

function getCurrentMessageId(messages: ChatMessage[]): string {
  const lastEmployee = [...messages].reverse().find((message) => message.role === "employee");
  return lastEmployee?.id ?? "message_unknown";
}

function toTitleCase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeProcessTrigger(text: string): string | undefined {
  const lower = text.toLowerCase();

  const whenMatch = lower.match(/when\s+(.+?),\s*i\s+(start|begin)/i);
  if (whenMatch && whenMatch[1]) {
    return toTitleCase(cleanText(whenMatch[1]));
  }

  if (lower.includes("receive an order by email") || lower.includes("order arrives by email")) {
    return "Order received by email";
  }

  if (lower.startsWith("when ")) {
    const trigger = text.replace(/^when\s+/i, "");
    return toTitleCase(cleanText(trigger));
  }

  return undefined;
}

function inferSystemFromText(message: string): string | undefined {
  const knownSystems = ["sap", "excel", "salesforce", "jira", "servicenow"];
  const lower = message.toLowerCase();
  const found = knownSystems.find((system) => lower.includes(system));
  return found ? found.toUpperCase() : undefined;
}

function normalizeActivityLabel(raw: string): string | undefined {
  const text = normalizeWhitespace(
    raw
      .replace(/^(then|afterwards|afterward|next|finally|first)\s+/i, "")
      .replace(/^i\s+/i, "")
      .replace(/^we\s+/i, "")
      .replace(/^and\s+/i, "")
      .replace(/^before\s+/i, "")
      .replace(/^after\s+/i, "")
  );

  if (!text) {
    return undefined;
  }

  const lower = text.toLowerCase();

  if (/search\s+for\s+the\s+customer|search\s+customer/.test(lower)) {
    return "Search customer";
  }
  if (/open\s+sap|open\s+.*\s+in\s+sap/.test(lower)) {
    return "Open order";
  }
  if (/export.+excel/.test(lower)) {
    return "Export data to Excel";
  }
  if (/fix\s+the\s+price\s+manually|correct\s+price\s+manually/.test(lower)) {
    return "Correct price manually";
  }
  if (/upload\s+it\s+again|upload.+sap|update\s+price\s+in\s+sap/.test(lower)) {
    return "Update price";
  }
  if (/receive\s+an\s+order|order\s+arrives/.test(lower)) {
    return "Receive order";
  }

  const compact = text
    .replace(/\b(the|a|an)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = compact.split(" ").slice(0, 5).join(" ");
  return words ? toTitleCase(words) : undefined;
}

function splitActivityCandidates(message: string): string[] {
  const normalized = normalizeWhitespace(
    message
      .replace(/\b(first|then|afterwards|afterward|before|after|finally|next)\b/gi, "$1")
      .replace(/\s+,\s+/g, " | ")
      .replace(/\s+and\s+/gi, " | ")
      .replace(/\s+then\s+/gi, " | ")
  );

  return normalized
    .split("|")
    .map((part) => cleanText(part))
    .filter((part) => part.length > 0);
}

function extractConditionPart(message: string): { condition?: string; remainder: string } {
  const match = message.match(/^\s*if\s+(.+?),\s*(.+)$/i);
  if (!match) {
    return { remainder: message };
  }

  return {
    condition: cleanText(match[1]),
    remainder: cleanText(match[2])
  };
}

function hasExplicitRejection(message: string): boolean {
  return /\b(no|not a workaround|that's not a workaround|do not confirm|incorrect)\b/i.test(message);
}

function conditionToGatewayLabel(conditionText: string): { gatewayLabel: string; branchLabel: string } {
  const lower = conditionText.toLowerCase();

  if (lower.includes("price") && lower.includes("wrong")) {
    return { gatewayLabel: "Price correct?", branchLabel: "No" };
  }

  if (lower.includes("missing") || lower.includes("not")) {
    return {
      gatewayLabel: `${toTitleCase(conditionText.replace(/^is\s+/i, "").replace(/^the\s+/i, ""))}?`,
      branchLabel: "No"
    };
  }

  return {
    gatewayLabel: `${toTitleCase(conditionText)}?`,
    branchLabel: "Yes"
  };
}

function existingTaskNames(processModel: ProcessModel): Set<string> {
  return new Set(
    processModel.elements
      .filter((element) => element.type === "task")
      .map((element) => element.name.toLowerCase())
  );
}

function comparableLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'.:,;!?]/g, " ")
    .replace(/\b(the|a|an|to)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findTaskByMention(processModel: ProcessModel, mention: string): { id: string; name: string } | undefined {
  const target = comparableLabel(mention);
  if (!target) {
    return undefined;
  }

  const tasks = processModel.elements.filter(
    (element): element is Extract<ProcessModel["elements"][number], { type: "task" }> =>
      element.type === "task"
  );

  const exact = tasks.find((task) => comparableLabel(task.name) === target);
  if (exact) {
    return { id: exact.id, name: exact.name };
  }

  const partial = tasks.find((task) => {
    const name = comparableLabel(task.name);
    return name.includes(target) || target.includes(name);
  });

  return partial ? { id: partial.id, name: partial.name } : undefined;
}

export function extractCorrectionDirective(message: string): CorrectionDirective | undefined {
  const cleaned = cleanText(message);

  const renamePatterns: RegExp[] = [
    /(?:^|\b)(?:not|instead of)\s+(.+?)\s*,\s*(?:actually|rather|but)\s+(.+)$/i,
    /(?:^|\b)it(?:'s| is)\s+not\s+(.+?)\s+but\s+(.+)$/i,
    /(?:^|\b)correction\s*:\s*(.+?)\s*->\s*(.+)$/i
  ];

  for (const pattern of renamePatterns) {
    const match = cleaned.match(pattern);
    if (!match) {
      continue;
    }

    const fromLabel = cleanText(match[1]);
    const toLabel = cleanText(match[2]);
    if (fromLabel && toLabel) {
      return { type: "rename", fromLabel, toLabel };
    }
  }

  const removePatterns: RegExp[] = [
    /(?:^|\b)(?:we\s+)?(?:do\s+)?not\s+(?:do|perform|use|execute)\s+(.+)$/i,
    /(?:^|\b)skip\s+(.+)$/i,
    /(?:^|\b)remove\s+(?:the\s+step\s+)?(.+)$/i
  ];

  for (const pattern of removePatterns) {
    const match = cleaned.match(pattern);
    if (!match) {
      continue;
    }

    const targetLabel = cleanText(match[1]);
    if (targetLabel) {
      return { type: "remove", targetLabel };
    }
  }

  return undefined;
}

function applyCorrectionDirective(
  directive: CorrectionDirective,
  processModel: ProcessModel,
  lang: "de" | "en"
): LlmProcessResponse | undefined {
  const isGerman = lang === "de";

  // ==================================================
  // RENAME ACTIVITY
  // ==================================================

  if (directive.type === "rename") {
    const task = findTaskByMention(
      processModel,
      directive.fromLabel
    );

    // Activity could not be matched
    if (!task) {
      const question = isGerman
        ? "Welche konkrete Aktivität soll korrigiert werden?"
        : "Which exact activity should be corrected?";

      return {
        language: lang,
        intent: "correction",

        assistantMessage: isGerman
          ? "Ich habe verstanden, dass eine Aktivität korrigiert werden soll, konnte sie im aktuellen Prozessmodell aber nicht eindeutig zuordnen. Welche konkrete Aktivität soll korrigiert werden?"
          : "I understood that an activity should be corrected, but I could not match it to the current process model. Which exact activity should be corrected?",

        contextPatch: {},

        changes: emptyProcessChanges(),

        uncertainties: [
          {
            type: "reference",
            targetRefs: [],
            description: isGerman
              ? `Die zu korrigierende Aktivität "${directive.fromLabel}" konnte nicht eindeutig gefunden werden.`
              : `The activity "${directive.fromLabel}" could not be matched unambiguously.`
          }
        ],

        nextQuestion: {
          required: true,
          kind: "clarification",
          targetRefs: [],
          question
        },

        validationRequest: {
          required: true,
          elementIds: [],
          question
        }
      };
    }

    // Normalize corrected activity label
    const normalized =
      normalizeActivityLabel(directive.toLabel) ??
      toTitleCase(cleanText(directive.toLabel));

    const inferredSystem =
      inferSystemFromText(directive.toLabel);

    const update = {
      id: task.id,
      name: normalized,
      ...(inferredSystem
        ? { system: inferredSystem }
        : {})
    };

    return {
      language: lang,
      intent: "correction",

      assistantMessage: isGerman
        ? `Verstanden: Ich habe die Aktivität "${task.name}" zu "${normalized}" korrigiert.`
        : `Understood: I corrected "${task.name}" to "${normalized}".`,

      contextPatch: {},

      changes: {
        ...emptyProcessChanges(),
        updateElements: [update]
      },

      uncertainties: [],

      nextQuestion: {
        required: false,
        kind: "clarification",
        targetRefs: [],
        question: ""
      },

      validationRequest: {
        required: false,
        elementIds: [],
        question: ""
      }
    };
  }

  // ==================================================
  // REMOVE ACTIVITY
  // ==================================================

  const task = findTaskByMention(
    processModel,
    directive.targetLabel
  );

  // Activity could not be matched
  if (!task) {
    const question = isGerman
      ? "Welche konkrete Aktivität soll entfernt werden?"
      : "Which exact activity should be removed?";

    return {
      language: lang,
      intent: "correction",

      assistantMessage: isGerman
        ? "Ich habe verstanden, dass eine Aktivität entfernt werden soll, konnte sie im aktuellen Prozessmodell aber nicht eindeutig zuordnen. Welche konkrete Aktivität soll entfernt werden?"
        : "I understood that an activity should be removed, but I could not match it to the current process model. Which exact activity should be removed?",

      contextPatch: {},

      changes: emptyProcessChanges(),

      uncertainties: [
        {
          type: "reference",
          targetRefs: [],
          description: isGerman
            ? `Die zu entfernende Aktivität "${directive.targetLabel}" konnte nicht eindeutig gefunden werden.`
            : `The activity "${directive.targetLabel}" could not be matched unambiguously.`
        }
      ],

      nextQuestion: {
        required: true,
        kind: "clarification",
        targetRefs: [],
        question
      },

      validationRequest: {
        required: true,
        elementIds: [],
        question
      }
    };
  }

  // ==================================================
  // FIND FLOWS CONNECTED TO THE ACTIVITY
  // ==================================================

  const relatedFlows = processModel.flows.filter(
    (flow) =>
      flow.from === task.id ||
      flow.to === task.id
  );

  const incoming = processModel.flows.filter(
    (flow) => flow.to === task.id
  );

  const outgoing = processModel.flows.filter(
    (flow) => flow.from === task.id
  );

  const addFlows: LlmProcessResponse["changes"]["addFlows"] = [];

  // If the task has exactly one predecessor and one successor,
  // reconnect them after removing the task.
  //
  // Example:
  //
  // A → B → C
  //
  // remove B
  //
  // A → C
  //
  if (
    incoming.length === 1 &&
    outgoing.length === 1
  ) {
    const inFlow = incoming[0];
    const outFlow = outgoing[0];

    if (
      inFlow &&
      outFlow &&
      inFlow.from !== outFlow.to
    ) {
      const reconnectFlowId =
        nextFlowId(processModel);

      addFlows.push({
        id: reconnectFlowId,
        from: inFlow.from,
        to: outFlow.to,
        ...(outFlow.condition
          ? { condition: outFlow.condition }
          : {})
      });
    }
  }

  // ==================================================
  // RETURN REMOVAL CHANGE
  // ==================================================

  return {
    language: lang,
    intent: "correction",

    assistantMessage: isGerman
      ? `Verstanden: Ich habe die Aktivität "${task.name}" aus dem Prozessmodell entfernt.`
      : `Understood: I removed activity "${task.name}" from the process model.`,

    contextPatch: {},

    changes: {
      ...emptyProcessChanges(),

      removeElementIds: [
        task.id
      ],

      addFlows,

      removeFlowIds: relatedFlows.map(
        (flow) => flow.id
      )
    },

    uncertainties: [],

    nextQuestion: {
      required: false,
      kind: "clarification",
      targetRefs: [],
      question: ""
    },

    validationRequest: {
      required: false,
      elementIds: [],
      question: ""
    }
  };
}

export function decomposeEmployeeMessage(message: string): ExtractedFacts {
  const cleaned = cleanText(message);
  const trigger = looksLikeProcessTrigger(cleaned);
  const conditioned = extractConditionPart(cleaned);

  const activityParts = splitActivityCandidates(conditioned.remainder);
  const activities = activityParts
    .map((part): ExtractedActivity | undefined => {
      const label = normalizeActivityLabel(part);
      if (!label) {
        return undefined;
      }
      const system = inferSystemFromText(part);
      return {
        label,
        ...(system ? { system } : {})
      };
    })
    .filter((value): value is ExtractedActivity => value !== undefined);

  const confirmation = isExplicitConfirmation(cleaned)
    ? "confirm"
    : hasExplicitRejection(cleaned)
      ? "reject"
      : "none";

  const workaroundEvidence = detectWorkaroundSignal(cleaned);

  return {
    trigger,
    activities,
    hasCondition: Boolean(conditioned.condition),
    conditionText: conditioned.condition,
    confirmation,
    workaroundEvidence
  };
}

function getLastElementId(processModel: ProcessModel): string {
  if (processModel.elements.length === 0) {
    return "start_1";
  }

  const endFiltered = processModel.elements.filter((element) => element.type !== "end");
  const last = endFiltered[endFiltered.length - 1] ?? processModel.elements[processModel.elements.length - 1];
  return last.id;
}

function nextTaskId(processModel: ProcessModel): string {
  const taskCount = processModel.elements.filter((element) => element.type === "task").length;
  return `task_${taskCount + 1}`;
}

function nextGatewayId(processModel: ProcessModel): string {
  const count = processModel.elements.filter((element) => element.type === "exclusiveGateway").length;
  return `gateway_${count + 1}`;
}

function nextFlowId(processModel: ProcessModel): string {
  return `flow_${processModel.flows.length + 1}`;
}

export function fallbackResponse(
  userMessage: string,
  processModel: ProcessModel
): LlmProcessResponse {
  const lang = detectLanguage(userMessage);
  const isGerman = lang === "de";

  const facts = decomposeEmployeeMessage(userMessage);

  const correctionDirective =
    extractCorrectionDirective(userMessage);

  // ==================================================
  // FIND PENDING STRUCTURED WORKAROUND
  // ==================================================

  const pendingWorkaround =
    processModel.workarounds.find(
      (workaround) =>
        workaround.status === "suspected"
    );

  // ==================================================
  // LEGACY FALLBACK:
  // Support old task-level workaround state as long as
  // parts of the application still use it.
  // ==================================================

  const pendingLegacyWorkaroundTask =
    processModel.elements.find(
      (
        element
      ): element is Extract<
        ProcessModel["elements"][number],
        { type: "task" }
      > =>
        element.type === "task" &&
        element.workaroundCandidate === true &&
        element.workaroundConfirmed !== true
    );

  // ==================================================
  // CONFIRM STRUCTURED WORKAROUND
  // ==================================================

  if (
    pendingWorkaround &&
    facts.confirmation === "confirm"
  ) {
    return {
      language: lang,
      intent: "confirmation",

      assistantMessage: isGerman
        ? "Verstanden. Ich habe den vermuteten Workaround als bestätigt markiert."
        : "Understood. I marked the suspected workaround as confirmed.",

      contextPatch: {},

      changes: {
        ...emptyProcessChanges(),

        updateWorkarounds: [
          {
            id: pendingWorkaround.id,
            status: "confirmed"
          }
        ]
      },

      uncertainties: [],

      nextQuestion: {
        required: false,
        kind: "clarification",
        targetRefs: [],
        question: ""
      },

      validationRequest: {
        required: false,
        elementIds: [],
        question: ""
      }
    };
  }

  // ==================================================
  // REJECT STRUCTURED WORKAROUND
  // ==================================================

  if (
    pendingWorkaround &&
    facts.confirmation === "reject"
  ) {
    return {
      language: lang,
      intent: "rejection",

      assistantMessage: isGerman
        ? "Verstanden. Ich habe den vermuteten Workaround verworfen."
        : "Understood. I rejected the suspected workaround.",

      contextPatch: {},

      changes: {
        ...emptyProcessChanges(),

        updateWorkarounds: [
          {
            id: pendingWorkaround.id,
            status: "rejected"
          }
        ]
      },

      uncertainties: [],

      nextQuestion: {
        required: false,
        kind: "clarification",
        targetRefs: [],
        question: ""
      },

      validationRequest: {
        required: false,
        elementIds: [],
        question: ""
      }
    };
  }

  // ==================================================
  // LEGACY TASK-LEVEL WORKAROUND CONFIRMATION
  // ==================================================
  //
  // This can later be removed once the whole application
  // uses processModel.workarounds exclusively.
  // ==================================================

  if (
    !pendingWorkaround &&
    pendingLegacyWorkaroundTask &&
    facts.confirmation === "confirm"
  ) {
    return {
      language: lang,
      intent: "confirmation",

      assistantMessage: isGerman
        ? `Verstanden. Ich habe den Workaround bei "${pendingLegacyWorkaroundTask.name}" bestätigt.`
        : `Understood. I confirmed the workaround for "${pendingLegacyWorkaroundTask.name}".`,

      contextPatch: {},

      changes: {
        ...emptyProcessChanges(),

        updateElements: [
          {
            id:
              pendingLegacyWorkaroundTask.id,

            workaroundCandidate:
              true,

            workaroundConfirmed:
              true
          }
        ]
      },

      uncertainties: [],

      nextQuestion: {
        required: false,
        kind: "clarification",
        targetRefs: [],
        question: ""
      },

      validationRequest: {
        required: false,
        elementIds: [],
        question: ""
      }
    };
  }

  // ==================================================
  // LEGACY TASK-LEVEL WORKAROUND REJECTION
  // ==================================================

  if (
    !pendingWorkaround &&
    pendingLegacyWorkaroundTask &&
    facts.confirmation === "reject"
  ) {
    return {
      language: lang,
      intent: "rejection",

      assistantMessage: isGerman
        ? `Verstanden. Die Aktivität "${pendingLegacyWorkaroundTask.name}" wird nicht als Workaround behandelt.`
        : `Understood. The activity "${pendingLegacyWorkaroundTask.name}" will not be treated as a workaround.`,

      contextPatch: {},

      changes: {
        ...emptyProcessChanges(),

        updateElements: [
          {
            id:
              pendingLegacyWorkaroundTask.id,

            workaroundCandidate:
              false,

            workaroundConfirmed:
              false,

            workaroundReason:
              ""
          }
        ]
      },

      uncertainties: [],

      nextQuestion: {
        required: false,
        kind: "clarification",
        targetRefs: [],
        question: ""
      },

      validationRequest: {
        required: false,
        elementIds: [],
        question: ""
      }
    };
  }

  // ==================================================
  // CORRECTION
  // ==================================================

  if (correctionDirective) {
    const correctionResponse =
      applyCorrectionDirective(
        correctionDirective,
        processModel,
        lang
      );

    if (correctionResponse) {
      return correctionResponse;
    }

    const question = isGerman
      ? "Welche konkrete Aktivität soll korrigiert werden?"
      : "Which exact activity should be corrected?";

    return {
      language: lang,
      intent: "correction",

      assistantMessage: isGerman
        ? "Ich habe verstanden, dass etwas im Prozessmodell korrigiert werden soll, konnte die betroffene Aktivität aber nicht eindeutig bestimmen."
        : "I understood that something in the process model should be corrected, but I could not identify the affected activity.",

      contextPatch: {},

      changes: emptyProcessChanges(),

      uncertainties: [
        {
          type: "reference",
          targetRefs: [],
          description: isGerman
            ? "Die zu korrigierende Aktivität konnte nicht eindeutig identifiziert werden."
            : "The activity to be corrected could not be identified unambiguously."
        }
      ],

      nextQuestion: {
        required: true,
        kind: "clarification",
        targetRefs: [],
        question
      },

      validationRequest: {
        required: true,
        elementIds: [],
        question
      }
    };
  }

  // ==================================================
  // NO OPENAI SEMANTIC EXTRACTION AVAILABLE
  // ==================================================
  //
  // IMPORTANT:
  // Do NOT generate tasks heuristically here.
  //
  // This avoids silently producing an incorrect BPMN
  // model when OpenAI configuration/parsing failed.
  // ==================================================

  return buildClarificationResponse(lang);
}


function parseResponseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function proposeProcessChanges(params: {
  userMessage: string;
  messages: ChatMessage[];
  processModel: ProcessModel;
  elicitationPhase?: string;
  pendingQuestion?: { question: string } | null;
}): Promise<LlmProcessResponse> {
  const {
    userMessage,
    messages,
    processModel,
    elicitationPhase,
    pendingQuestion
  } = params;

  const lang = detectLanguage(userMessage);
  const client = getOpenAIClient();
  const model = getModel();

  const isDev =
    process.env.NODE_ENV !== "production";

  // --------------------------------------------------
  // OpenAI configuration
  // --------------------------------------------------

  if (!client) {
    return failProcessing(
      lang,
      "OPENAI_NOT_CONFIGURED",
      "OPENAI_API_KEY is missing"
    );

  }

  // --------------------------------------------------
  // Pending dialogue context
  // --------------------------------------------------

  const pendingContext =
    pendingQuestion?.question
      ? [
        "Pending question:",
        pendingQuestion.question,
        "",
        "Interpret the latest employee message as a possible answer",
        "to this pending question before deciding whether it contains",
        "new process information."
      ].join("\n")
      : "No pending question.";

  // --------------------------------------------------
  // Context for semantic process extraction
  // --------------------------------------------------

  const userContext = [
    `Employee language: ${lang}`,

    `Elicitation phase: ${elicitationPhase ?? "main_flow"
    }`,

    pendingContext,

    "Current ProcessModel JSON:",
    JSON.stringify(processModel, null, 2),

    "Recent conversation:",
    compactConversation(messages),

    "Latest employee message:",
    userMessage,

    [
      "Extraction requirements:",
      "- Extract ALL process facts from the latest message.",
      "- One message may contain zero, one, or multiple activities.",
      "- Do not stop after the first activity.",
      "- Do not copy the whole employee sentence into a task.",
      "- Normalize activities into concise verb-object labels.",
      "- Extract systems separately from activities.",
      "- Update the existing start event when a real trigger is stated.",
      "- Do not duplicate existing elements.",
      "- Use tempRefs for multiple new elements in one response.",
      "- Connect new elements using addFlows.",
      "- A confirmation or rejection must not create a task.",
      "- A suspected workaround must not be automatically confirmed.",
      "- Respond in the employee's language."
    ].join("\n")
  ].join("\n\n");

  // --------------------------------------------------
  // Diagnostics
  // --------------------------------------------------

  if (isDev) {
    console.info(
      "\n[workaround-check] ----- OPENAI REQUEST -----"
    );

    console.info(
      "[workaround-check] model:",
      model
    );

    console.info(
      "[workaround-check] language:",
      lang
    );

    console.info(
      "[workaround-check] user message:",
      userMessage
    );

    console.info(
      "[workaround-check] elicitation phase:",
      elicitationPhase ?? "main_flow"
    );

    if (pendingQuestion?.question) {
      console.info(
        "[workaround-check] pending question:",
        pendingQuestion.question
      );
    }
  }

  try {
    // --------------------------------------------------
    // Responses API
    // --------------------------------------------------

    const response =
      await client.responses.create({
        model,

        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: SYSTEM_PROMPT
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: userContext
              }
            ]
          }
        ],

        text: {
          format: {
            type: "json_schema",
            name: "workaround_check_response",
            description:
              "Structured changes to an AS-IS business process model extracted from an employee interview.",
            schema: responseFormatSchema
          }
        }
      });

    // --------------------------------------------------
    // Inspect response
    // --------------------------------------------------

    if (isDev) {
      console.info(
        "[workaround-check] response status:",
        response.status
      );
    }

    if (response.status !== "completed") {
      return failProcessing(
        lang,
        "OPENAI_RESPONSE_NOT_COMPLETED",
        {
          status: response.status,
          error: response.error,
          incompleteDetails:
            response.incomplete_details
        }
      );
    }

    // response.output_text is the SDK convenience output
    // for aggregated text responses.
    const rawText =
      response.output_text?.trim();

    if (!rawText) {
      return failProcessing(
        lang,
        "OPENAI_NO_OUTPUT_TEXT",
        response.output
      );
    }

    // --------------------------------------------------
    // Parse JSON
    // --------------------------------------------------

    if (isDev) {
      console.info(
        "[workaround-check] ----- RAW RESULT -----"
      );

      console.info(rawText);
    }

    const parsed =
      parseResponseJson(rawText);

    if (parsed === null) {
      return failProcessing(
        lang,
        "OPENAI_JSON_PARSE_FAILED",
        rawText
      );
    }

    if (isDev) {
      console.info(
        "[workaround-check] ----- PARSED RESULT -----"
      );

      console.info(
        JSON.stringify(
          parsed,
          null,
          2
        )
      );
    }

    // --------------------------------------------------
    // Zod validation
    // --------------------------------------------------

    const validated =
      llmProcessResponseSchema.safeParse(
        parsed
      );

    if (!validated.success) {
      return failProcessing(
        lang,
        "OPENAI_ZOD_VALIDATION_FAILED",
        validated.error.issues
      );
    }

    // --------------------------------------------------
    // Successful semantic extraction
    // --------------------------------------------------

    const result = validated.data;

    if (isDev) {
      console.info(
        "[workaround-check] ----- VALIDATED RESULT -----"
      );

      console.info(
        "[workaround-check] intent:",
        result.intent
      );

      console.info(
        "[workaround-check] language:",
        result.language
      );

      console.info(
        "[workaround-check] addElements:",
        JSON.stringify(
          result.changes.addElements,
          null,
          2
        )
      );

      console.info(
        "[workaround-check] updateElements:",
        JSON.stringify(
          result.changes.updateElements,
          null,
          2
        )
      );

      console.info(
        "[workaround-check] addFlows:",
        JSON.stringify(
          result.changes.addFlows,
          null,
          2
        )
      );

      console.info(
        "[workaround-check] addWorkarounds:",
        JSON.stringify(
          result.changes.addWorkarounds,
          null,
          2
        )
      );

      console.info(
        "[workaround-check] assistantMessage:",
        result.assistantMessage
      );

      console.info(
        "[workaround-check] ----- END -----\n"
      );
    }

    return result;
  } catch (error: unknown) {
    // Do not wrap an error that was intentionally thrown
    // by failProcessing().
    if (
      error instanceof Error &&
      (
        error.message.startsWith("OPENAI_") ||
        error.message.startsWith("OPENAI_NOT_CONFIGURED")
      )
    ) {
      throw error;
    }

    return failProcessing(
      lang,
      "OPENAI_API_REQUEST_FAILED",
      error
    );
  }
}
