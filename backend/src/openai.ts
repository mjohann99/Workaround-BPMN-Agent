import OpenAI from "openai";

import {
  isExplicitConfirmation
} from "./process.js";

import {
  llmProcessResponseSchema
} from "./schemas.js";

import {
  type ChatMessage,
  type LlmProcessResponse,
  type ProcessModel,
  type ProcessChanges
} from "./types.js";

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

Do not invent organizational information that the employee has not provided.

// ======================================================
// LANGUAGE
// ======================================================

LANGUAGE RULE:

Always write assistant messages, explanations, and questions in English,
regardless of the employee's language.

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

RESPONSIBILITY STATEMENTS — classify each one before producing changes:

1. IDENTIFY (retrospective): the employee says which role performs activities already described ("we are <Role>", "that is done by <Role>").
→ create or reuse lane <Role>
→ updateElements with laneRef/laneId ONLY for the activities the statement covers
→ if the statement does not make clear which earlier activities it covers, do NOT guess: set nextQuestion (kind "lane_assignment", targetRefs = the candidate activity IDs) asking one focused question, and leave them unassigned
→ activities that already have a different lane keep it

2. INTRODUCE (subsequent): the employee names a role for what happens next ("then <Role> does ...", "<Role> receives ...").
→ create or reuse lane <Role>
→ addElements for the new activities with laneRef; connect them with addFlows from the previous activity
→ earlier activities are NOT moved into <Role>

3. CORRECT: the employee says an existing assignment is wrong or was not applied.
→ updateElements for the existing activities only (new laneRef/laneId)
→ no new activities, no changed order, no new flows

One message may combine 1 and 2 ("we are <Role A> and then <Role B> receives it"): do both in the same response, with a lane for each role.

Lane rules:
- Reuse an existing lane (its id) whenever the employee refers to a role that already has one, including when returning to it later. Never create a second lane with the same name.
- Create the lane (addLanes) in the same response that assigns elements to it, and reference it with its tempRef.
- Every laneRef/laneId must be an existing lane ID or a tempRef created in the same response. Never invent an ID.
- Never put all activities into the most recently mentioned lane.

Responsibility context:
- Consecutive activities stay with the most recent responsibility the employee explicitly established, until the employee names a different actor. Set laneRef on every new activity once lanes exist.
- An explicit actor change ("then <Role> ...") sets a new current responsibility for the activities that follow it.
- Mentioning a tool or system (ERP, spreadsheet, email client, ...) means the employee USES it: put it in the activity's system field. Do not create a lane for it and do not treat it as the performer unless the employee says the system itself performs the work.
- If it is unclear who performs an activity, ask one focused question (nextQuestion kind "lane_assignment") instead of guessing.
- Only ask who performs an activity when it cannot be resolved from the established responsibility or the stated actor. Never ask merely because an activity was added, and never reconfirm a responsibility that is already clear.
- A department or team is a sufficient responsibility. Do not ask for a person, job title or sub-team unless the employee describes a distinction that matters. If the employee says there is no finer distinction, set responsibility.noFurtherDetail to true and never ask again.
- When the responsibility is resolved, record the activity and put the next process question (what happens next) in nextQuestion in the same response.

Responsibility hint (the "responsibility" field of every response):
- intervieweeRole: the role/department the employee states they belong to ("we are the <Role>"); otherwise null. Do not set it for roles the employee only mentions.
- actor: "interviewee" when the new activities are done by the employee or their team (I/we/us/still us); "previous" when they continue with the actor of the preceding activity; "named" when you assigned them to an explicitly named role via laneRef; otherwise null.
- noFurtherDetail: true only when the employee says no finer role distinction exists.
- After a handoff, first-person references still mean the employee's own role, not the role that was mentioned last. A return to the employee's role ("back to us") uses the employee's existing lane.

Practice hints (the "practiceHints" field; [] when nothing applies):
- Activities are observations. Group them only when the employee says they belong to one way of working: a shared purpose, obstacle or cause stated in the conversation. Never group by order, similar wording, a shared lane or a technical difference.
- relation "same_practice": activityRefs are existing activity IDs or tempRefs created in this response; basis states, in the employee's terms, why they belong together. Set extendsPracticeId when the employee adds to a known practice (see "Known practices").
- relation "independent": the employee says the activities are unrelated or have different reasons.
- When activities merely follow each other, return no hint. Do not guess.
- When the employee describes several steps together as one way of handling something, return a same_practice hint on your own, with their stated reason as basis; do not wait for a confirmation question.

Practice answers (the "practiceAnswers" field; [] when the latest message does not answer a practice question):
- field is reason, sinceWhen or frequency. scope "practice" when the answer holds for the whole practice, "activities" when it holds only for the listed activityRefs (for example one step has an additional reason or a different frequency). practiceId is the practice the answer is about.
- value is the employee's answer in short form. "I do not know", "no idea" and similar are answers: set unknown to true and value to null. Never invent a value, and never turn a model difference into a reason.
- When the pending question asks for purpose, onset and frequency together, return one entry per field the employee actually mentioned; do not invent the others.
- One message may answer several fields or several practices; return one entry each.
- An activity's immediate function ("I call the supplier to get the price") is not the motivation for the whole practice. When the answer explains only some activities, use scope "activities" with those activityRefs; the practice-level question then stays open.
- When the pending question is a grouping question, report a confirmation or separation through practiceHints (same_practice with the shared basis, or independent), not practiceAnswers.

Lane removal:
- "Unassigned" is a visual band for elements without a responsibility. It is NOT a lane: never create a lane with that name and never put it in removeLaneIds. A request to remove it means those elements need a role; assign them if the employee says which, otherwise ask.
- To remove a lane that contains elements, move them with updateElements in the same response when the destination is clear; otherwise ask where they belong.

Activity details:
- Keep meaningful qualifiers in the activity label or its properties: the system used, conditions (gateway or flow condition), and timing ("every Monday", "within two days", waiting steps as timer events).

Cancellation:
- If the employee withdraws a pending question or edit ("never mind") and continues in the same message, drop the withdrawn request and process the continuation: add the new activity after the last activity of the current process unless told otherwise.

Never say an assignment was made or noted unless changes contains the matching updateElements/addLanes entries. An updateLanes entry with all-null fields is not a change.

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
// BPMN EVENTS
// ======================================================

EVENT RULES:

Use the appropriate BPMN event node when the narrative describes an occurrence or something the process waits for, rather than an activity performed by a participant.

- Use start with eventDefinitionType "message", "timer", or "signal" when that event starts the process.
- Use intermediateCatchEvent for an incoming message, timer, signal, condition, or other event that the process waits for.
- Use intermediateThrowEvent for a message, signal, escalation, or other event emitted during the process.
- Use boundaryEvent for an event attached to an activity, such as a timeout or error. Set attachedToRef to that task's ID or tempRef and set cancelActivity to false only when the task continues after the event.
- Use end with the appropriate eventDefinitionType when the process ends by sending a message, raising an error/escalation, terminating, or reaching another defined event outcome.
- Supported eventDefinitionType values are message, timer, error, escalation, conditional, link, signal, cancel, compensation, terminate, multiple, and parallelMultiple.
- Keep an ordinary human or automated action as a task. A messageFlow represents communication between participants; it does not replace an intermediate message event when the internal process explicitly waits for or emits that message.
- Do not invent an event definition if the narrative does not identify one.

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

Example question in English:

"Is accounting part of your company or an external service provider?"

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
// CONFORMANCE AND WORKAROUND CLASSIFICATION
// ======================================================

CONFORMANCE AND WORKAROUND CLASSIFICATION — CRITICAL:

Do not classify process behavior as a workaround.

Do not classify process behavior as a deviation.

Do not infer that an activity is non-conforming merely because it is:

- manual
- performed in Excel
- performed outside the main system
- unusual
- inefficient
- different from an expected practice mentioned by the employee

Your responsibility is to reconstruct the ACTUAL AS-IS process.

Deviation detection is performed separately by a conformance-checking
engine against a Process Owner-managed reference process.

The Process Owner decides whether a detected deviation is:

- a confirmed workaround
- an accepted variant
- caused by an outdated reference model
- not a workaround
- in need of additional information

Never create or update workaround candidates.

Always return:

addWorkarounds: []
updateWorkarounds: []

The legacy task-level workaround fields remain in the JSON schema
temporarily for compatibility.

For every object in addElements and updateElements always return:

workaroundCandidate: null
workaroundConfirmed: null
workaroundReason: null
workaroundCategory: null

Do not use these fields to describe the employee's behavior.

Do not ask whether something is a workaround.

Do not use nextQuestion kinds beginning with:

workaround_

Do not create uncertainties of type:

workaround

If the employee mentions how a process is officially expected to work,
do not replace the actual AS-IS process with that expected behavior.

Expected behavior is handled separately through the reference process
and deviation-investigation mechanisms.

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

Write assistantMessage and all questions in English, regardless of the employee's language.

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
- ambiguous process structure
- missing information required to model the actual AS-IS process

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

Do not store differences between actual and expected practice as
workaround metadata.

Differences between the actual process and the Process Owner-managed
reference process are determined separately through conformance checking.
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
                  "intermediateCatchEvent",
                  "intermediateThrowEvent",
                  "boundaryEvent",
                  "end"
                ]
              },

              name: {
                type: "string"
              },

              eventDefinitionType: {
                type: [
                  "string",
                  "null"
                ],
                enum: [
                  "message",
                  "timer",
                  "error",
                  "escalation",
                  "conditional",
                  "link",
                  "signal",
                  "cancel",
                  "compensation",
                  "terminate",
                  "multiple",
                  "parallelMultiple",
                  null
                ]
              },

              attachedToRef: {
                type: [
                  "string",
                  "null"
                ]
              },

              cancelActivity: {
                type: [
                  "boolean",
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
              "eventDefinitionType",
              "attachedToRef",
              "cancelActivity",
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

              eventDefinitionType: {
                type: [
                  "string",
                  "null"
                ],
                enum: [
                  "message",
                  "timer",
                  "error",
                  "escalation",
                  "conditional",
                  "link",
                  "signal",
                  "cancel",
                  "compensation",
                  "terminate",
                  "multiple",
                  "parallelMultiple",
                  null
                ]
              },

              attachedToRef: {
                type: [
                  "string",
                  "null"
                ]
              },

              cancelActivity: {
                type: [
                  "boolean",
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
              "eventDefinitionType",
              "attachedToRef",
              "cancelActivity",
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
    },

    // ==================================================
    // RESPONSIBILITY HINT
    // ==================================================

    responsibility: {
      type: "object",
      additionalProperties: false,

      properties: {
        intervieweeRole: {
          type: [
            "string",
            "null"
          ]
        },

        actor: {
          type: [
            "string",
            "null"
          ],
          enum: [
            "interviewee",
            "previous",
            "named",
            null
          ]
        },

        noFurtherDetail: {
          type: [
            "boolean",
            "null"
          ]
        }
      },

      required: [
        "intervieweeRole",
        "actor",
        "noFurtherDetail"
      ]
    },

    // ==================================================
    // PRACTICE GROUPING AND ANSWERS
    // ==================================================

    practiceHints: {
      type: "array",

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          activityRefs: {
            type: "array",
            items: { type: "string" }
          },

          relation: {
            type: "string",
            enum: ["same_practice", "independent"]
          },

          extendsPracticeId: {
            type: ["string", "null"]
          },

          basis: {
            type: ["string", "null"]
          }
        },

        required: [
          "activityRefs",
          "relation",
          "extendsPracticeId",
          "basis"
        ]
      }
    },

    practiceAnswers: {
      type: "array",

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          practiceId: {
            type: ["string", "null"]
          },

          field: {
            type: "string",
            enum: ["reason", "sinceWhen", "frequency"]
          },

          scope: {
            type: "string",
            enum: ["practice", "activities"]
          },

          activityRefs: {
            type: "array",
            items: { type: "string" }
          },

          unknown: {
            type: ["boolean", "null"]
          },

          value: {
            type: ["string", "null"]
          }
        },

        required: [
          "practiceId",
          "field",
          "scope",
          "activityRefs",
          "unknown",
          "value"
        ]
      }
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
    "validationRequest",
    "responsibility",
    "practiceHints",
    "practiceAnswers"
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

function sanitizeLlmClassification(
  response:
    LlmProcessResponse
): LlmProcessResponse {
  // ==================================================
  // REMOVE LEGACY WORKAROUND FIELDS FROM NEW ELEMENTS
  // ==================================================

  const addElements:
    ProcessChanges["addElements"] =
    response.changes
      .addElements
      .map(
        (
          element
        ) => {
          const {
            workaroundCandidate:
            _workaroundCandidate,

            workaroundConfirmed:
            _workaroundConfirmed,

            workaroundReason:
            _workaroundReason,

            workaroundCategory:
            _workaroundCategory,

            ...cleanElement
          } =
            element;

          return cleanElement;
        }
      );


  // ==================================================
  // REMOVE LEGACY WORKAROUND FIELDS FROM UPDATES
  // ==================================================

  const updateElements:
    ProcessChanges["updateElements"] =
    response.changes
      .updateElements
      .map(
        (
          element
        ) => {
          const {
            workaroundCandidate:
            _workaroundCandidate,

            workaroundConfirmed:
            _workaroundConfirmed,

            workaroundReason:
            _workaroundReason,

            workaroundCategory:
            _workaroundCategory,

            ...cleanElement
          } =
            element;

          return cleanElement;
        }
      );


  // ==================================================
  // REMOVE LEGACY WORKAROUND QUESTIONS
  // ==================================================

  const hasLegacyWorkaroundQuestion =
    response
      .nextQuestion
      .kind
      .startsWith(
        "workaround_"
      );

  const nextQuestion =
    hasLegacyWorkaroundQuestion
      ? {
        required:
          false,

        kind:
          "clarification" as const,

        targetRefs:
          [],

        question:
          ""
      }
      : response.nextQuestion;


  // ==================================================
  // REMOVE LEGACY WORKAROUND UNCERTAINTIES
  // ==================================================

  const uncertainties =
    response.uncertainties
      .filter(
        (
          uncertainty
        ) =>
          uncertainty.type !==
          "workaround"
      );


  // ==================================================
  // LEGACY INTENT NORMALIZATION
  // ==================================================

  const intent =
    response.intent ===
      "workaround_detail"
      ? "answer_to_question"
      : response.intent;


  // ==================================================
  // RETURN SAFE PROCESS-EXTRACTION RESULT
  // ==================================================

  return {
    ...response,

    intent,

    changes: {
      ...response.changes,

      addElements,

      updateElements,

      /**
       * Hard guarantee:
       *
       * LLM output can never change workaround state.
       */
      addWorkarounds:
        [],

      updateWorkarounds:
        []
    },

    uncertainties,

    nextQuestion
  };
}

function buildClarificationResponse(
  lang: "de" | "en"
): LlmProcessResponse {
  return {
    language: lang,
    intent: "unclear",

    assistantMessage:
      "I was unable to process the input automatically. Please try again.",

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
      question:
        "Could you please describe the process information again?"
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
      const question = "Which exact activity should be corrected?";

      return {
        language: lang,
        intent: "correction",

        assistantMessage:
          "I understood that an activity should be corrected, but I could not match it to the current process model. Which exact activity should be corrected?",

        contextPatch: {},

        changes: emptyProcessChanges(),

        uncertainties: [
          {
            type: "reference",
            targetRefs: [],
            description:
              `The activity "${directive.fromLabel}" could not be matched unambiguously.`
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

      assistantMessage:
        `Understood: I corrected "${task.name}" to "${normalized}".`,

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
    const question = "Which exact activity should be removed?";

    return {
      language: lang,
      intent: "correction",

      assistantMessage:
        "I understood that an activity should be removed, but I could not match it to the current process model. Which exact activity should be removed?",

      contextPatch: {},

      changes: emptyProcessChanges(),

      uncertainties: [
        {
          type: "reference",
          targetRefs: [],
          description:
            `The activity "${directive.targetLabel}" could not be matched unambiguously.`
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

    assistantMessage:
      `Understood: I removed activity "${task.name}" from the process model.`,

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

export function decomposeEmployeeMessage(
  message: string
): ExtractedFacts {
  const cleaned =
    cleanText(
      message
    );

  const trigger =
    looksLikeProcessTrigger(
      cleaned
    );

  const conditioned =
    extractConditionPart(
      cleaned
    );

  const activityParts =
    splitActivityCandidates(
      conditioned.remainder
    );

  const activities =
    activityParts
      .map(
        (
          part
        ):
          ExtractedActivity |
          undefined => {
          const label =
            normalizeActivityLabel(
              part
            );

          if (
            !label
          ) {
            return undefined;
          }

          const system =
            inferSystemFromText(
              part
            );

          return {
            label,

            ...(system
              ? {
                system
              }
              : {})
          };
        }
      )
      .filter(
        (
          value
        ): value is
          ExtractedActivity =>
          value !==
          undefined
      );

  const confirmation =
    isExplicitConfirmation(
      cleaned
    )
      ? "confirm"
      : hasExplicitRejection(
        cleaned
      )
        ? "reject"
        : "none";

  return {
    trigger,

    activities,

    hasCondition:
      Boolean(
        conditioned.condition
      ),

    conditionText:
      conditioned.condition,

    confirmation,

    /**
     * Legacy compatibility.
     *
     * Technical deviations now come exclusively from
     * conformance checking.
     */
    workaroundEvidence:
      false
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
  const lang =
    detectLanguage(
      userMessage
    );

  const correctionDirective =
    extractCorrectionDirective(
      userMessage
    );

  // ==================================================
  // CORRECTION
  // ==================================================
  //
  // The deterministic fallback may still process clear
  // corrections to the AS-IS model.
  //
  // It must NOT detect, confirm or reject workarounds.
  // ==================================================

  if (
    correctionDirective
  ) {
    const correctionResponse =
      applyCorrectionDirective(
        correctionDirective,
        processModel,
        lang
      );

    if (
      correctionResponse
    ) {
      return correctionResponse;
    }

    const question = "Which exact activity should be corrected?";

    return {
      language:
        lang,

      intent:
        "correction",

      assistantMessage:
        "I understood that something in the process model should be corrected, but I could not identify the affected activity.",

      contextPatch:
        {},

      changes:
        emptyProcessChanges(),

      uncertainties: [
        {
          type:
            "reference",

          targetRefs:
            [],

          description:
            "The activity to be corrected could not be identified unambiguously."
        }
      ],

      nextQuestion: {
        required:
          true,

        kind:
          "clarification",

        targetRefs:
          [],

        question
      },

      validationRequest: {
        required:
          true,

        elementIds:
          [],

        question
      }
    };
  }

  // ==================================================
  // NO OPENAI SEMANTIC EXTRACTION AVAILABLE
  // ==================================================
  //
  // Do not create activities heuristically.
  //
  // Do not derive workarounds or deviations here.
  // ==================================================

  return buildClarificationResponse(
    lang
  );
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
  pendingQuestion?: {
    question: string;
    kind?: string;
    targetIds?: string[];
    practiceId?: string;
    practiceField?: string;
  } | null;
  responsibilityContext?: {
    intervieweeRole?: { laneId: string; name: string };
    currentRole?: { laneId: string; name: string };
    distinctionDeclined?: boolean;
  };
  practiceContext?: string;
}): Promise<LlmProcessResponse> {
  const {
    userMessage,
    messages,
    processModel,
    elicitationPhase,
    pendingQuestion,
    responsibilityContext,
    practiceContext
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
        ...(pendingQuestion.targetIds?.length
          ? [
            `The pending question concerns these element IDs: ${pendingQuestion.targetIds.join(", ")}`
          ]
          : []),
        ...(pendingQuestion.practiceId
          ? [
            `The pending question asks for "${pendingQuestion.practiceField}" of practice ${pendingQuestion.practiceId}. Report the answer in practiceAnswers with that practiceId; use scope "activities" if the employee limits it to some steps.`
          ]
          : []),
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

    ...(practiceContext ? [practiceContext] : []),

    ...(
      responsibilityContext?.intervieweeRole
        ? [
          `Established responsibility: the employee belongs to "${responsibilityContext.intervieweeRole.name}" (lane ${responsibilityContext.intervieweeRole.laneId}). "I", "we", "us", "our team" and "still us" refer to this role, not to the most recently mentioned participant.`
        ]
        : []
    ),

    ...(
      responsibilityContext?.currentRole
        ? [
          `Current responsibility (lane of the latest activity): "${responsibilityContext.currentRole.name}" (lane ${responsibilityContext.currentRole.laneId}). Activities that continue without a stated change belong to it.`
        ]
        : []
    ),

    ...(
      responsibilityContext?.distinctionDeclined
        ? [
          "The employee said no finer role distinction exists. Do not ask for a narrower role, team, person or job title."
        ]
        : []
    ),

    ...(
      processModel.lanes.length > 0 &&
        processModel.elements.some((element) => !element.laneId)
        ? [
          `Elements without a responsibility (drawn in the visual "Unassigned" band, which is not a lane): ${processModel.elements
            .filter((element) => !element.laneId)
            .map((element) => `${element.id} (${element.name})`)
            .join(", ")}`
        ]
        : []
    ),

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
      "- Do not classify any behavior as a workaround or deviation.",
      "- Always return addWorkarounds: [] and updateWorkarounds: [].",
      "- Always return null for legacy task-level workaround fields.",
      "- Do not ask whether an activity is a workaround.",
      "- Conformance checking and Process Owner review handle deviation/workaround classification.",
      "- Always write assistantMessage, nextQuestion.question, and validationRequest.question in English, regardless of the employee's language."
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

    const result =
      sanitizeLlmClassification(
        validated.data
      );

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
