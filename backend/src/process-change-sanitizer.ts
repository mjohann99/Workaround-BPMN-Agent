import {
    normalizeOrganizationName
} from "./process.js";

import {
    type MessageFlowDraft,
    type ProcessChanges,
    type ProcessModel,
    type ProcessVisibility,
    type ResponsibilityHint
} from "./types.js";


// ======================================================
// INTERNAL TYPES
// ======================================================

type ParticipantInfo = {
    processVisibility:
    ProcessVisibility;
};


export type ResponsibilityContext = {
    actor?:
        ResponsibilityHint["actor"];

    intervieweeLaneId?:
        string;
};

export type IntervieweeRoleRepairResult = {
    changes:
    ProcessChanges;

    applied:
    boolean;

    roleName?:
    string;

    rejectedRoleName?:
    string;

    assignedElementIds:
    string[];
};


// ======================================================
// NORMALIZATION
// ======================================================

function deduplicateLaneDrafts(
    currentProcess:
        ProcessModel,

    changes:
        ProcessChanges
): void {
    const laneRefAliases =
        new Map<string, string>();

    const uniqueLanes =
        [] as ProcessChanges["addLanes"];

    for (const lane of changes.addLanes) {
        const normalizedName =
            normalizeOrganizationName(lane.name);

        const existingLane =
            currentProcess.lanes.find(
                (candidate) =>
                    candidate.participantId === lane.participantRef &&
                    normalizeOrganizationName(candidate.name) === normalizedName
            );

        const existingDraft =
            uniqueLanes.find(
                (candidate) =>
                    candidate.participantRef === lane.participantRef &&
                    normalizeOrganizationName(candidate.name) === normalizedName
            );

        const canonicalLaneRef =
            existingLane?.id ?? existingDraft?.tempRef;

        if (canonicalLaneRef) {
            laneRefAliases.set(
                lane.tempRef,
                canonicalLaneRef
            );
        } else {
            uniqueLanes.push(lane);
        }
    }

    changes.addLanes = uniqueLanes;

    if (laneRefAliases.size === 0) {
        return;
    }

    const canonicalizeLaneRef =
        (laneRef: string): string =>
            laneRefAliases.get(laneRef) ?? laneRef;

    changes.addElements =
        changes.addElements.map(
            (element) => element.laneRef
                ? {
                    ...element,
                    laneRef: canonicalizeLaneRef(element.laneRef)
                }
                : element
        );

    changes.updateElements =
        changes.updateElements.map(
            (element) => ({
                ...element,
                ...(element.laneRef
                    ? { laneRef: canonicalizeLaneRef(element.laneRef) }
                    : {}),
                ...(element.laneId
                    ? { laneId: canonicalizeLaneRef(element.laneId) }
                    : {})
            })
        );

    changes.updateLanes =
        changes.updateLanes.map(
            (lane) => ({
                ...lane,
                id: canonicalizeLaneRef(lane.id)
            })
        );

    changes.removeLaneIds =
        changes.removeLaneIds.map(
            canonicalizeLaneRef
        );
}


// ======================================================
// TOOLS ARE NOT PERFORMERS
// ======================================================
//
// A lane named after a system used in the same response is a
// tool mention, not a responsibility, unless the system is
// described as performing automated work.
// ======================================================

function dropToolLaneDrafts(
    changes:
        ProcessChanges
): void {
    const tools =
        new Set(
            [
                ...changes.addElements,
                ...changes.updateElements
            ]
                .map(
                    (element) =>
                        element.system
                )
                .filter(
                    (system): system is string =>
                        Boolean(system)
                )
                .map(
                    normalizeOrganizationName
                )
        );

    const dropped =
        new Set<string>();

    for (const lane of changes.addLanes) {
        if (
            !tools.has(
                normalizeOrganizationName(
                    lane.name
                )
            )
        ) {
            continue;
        }

        const performedByTool =
            [
                ...changes.addElements,
                ...changes.updateElements
            ].some(
                (element) =>
                    element.laneRef ===
                    lane.tempRef &&
                    element.executionType ===
                    "automated"
            );

        if (!performedByTool) {
            dropped.add(
                lane.tempRef
            );
        }
    }

    if (dropped.size === 0) {
        return;
    }

    changes.addLanes =
        changes.addLanes.filter(
            (lane) =>
                !dropped.has(
                    lane.tempRef
                )
        );

    for (
        const element of
        [
            ...changes.addElements,
            ...changes.updateElements
        ]
    ) {
        if (
            element.laneRef &&
            dropped.has(
                element.laneRef
            )
        ) {
            delete element.laneRef;
        }
    }
}


// ======================================================
// NEW ACTIVITY AFTER THE OPEN END OF THE PROCESS
// ======================================================
//
// A single new flow node without any incoming flow continues
// the process after the one element that has no outgoing flow.
// Nothing is guessed when the tail is ambiguous.
// ======================================================

function connectNewActivity(
    currentProcess:
        ProcessModel,

    changes:
        ProcessChanges
): void {
    const newNodes =
        changes.addElements.filter(
            (element) =>
                element.type !==
                "start" &&
                element.type !==
                "boundaryEvent"
        );

    if (newNodes.length !== 1) {
        return;
    }

    const node = newNodes[0];

    const reference =
        node.tempRef ??
        node.id;

    if (!reference) {
        return;
    }

    const hasIncoming =
        changes.addFlows.some(
            (flow) =>
                (flow.to ?? flow.toRef) ===
                reference
        );

    if (hasIncoming) {
        return;
    }

    const removedElements =
        new Set(
            changes.removeElementIds
        );

    const removedFlows =
        new Set(
            changes.removeFlowIds
        );

    const sources =
        new Set([
            ...currentProcess.flows
                .filter(
                    (flow) =>
                        !removedFlows.has(
                            flow.id
                        )
                )
                .map(
                    (flow) =>
                        flow.from
                ),
            ...changes.addFlows.map(
                (flow) =>
                    flow.from ??
                    flow.fromRef
            )
        ]);

    const tails =
        currentProcess.elements.filter(
            (element) =>
                element.type !== "end" &&
                element.type !== "boundaryEvent" &&
                !removedElements.has(
                    element.id
                ) &&
                !sources.has(
                    element.id
                )
        );

    if (tails.length !== 1) {
        return;
    }

    changes.addFlows.push({
        fromRef:
            tails[0].id,

        toRef:
            reference
    });
}


// ======================================================
// RESPONSIBILITY CONTEXT
// ======================================================
//
// A new element without an explicit lane takes the lane of
// the element it follows. An explicit lane in the response
// always wins, so an actor change updates the context for
// everything after it.
// ======================================================

function inheritResponsibilityContext(
    currentProcess:
        ProcessModel,

    changes:
        ProcessChanges,

    context?:
        ResponsibilityContext
): void {
    if (
        currentProcess.lanes.length === 0 &&
        changes.addLanes.length === 0
    ) {
        return;
    }

    // First-person references mean the interviewee's own lane.
    if (
        context?.actor === "interviewee" &&
        context.intervieweeLaneId &&
        currentProcess.lanes.some(
            (lane) =>
                lane.id === context.intervieweeLaneId
        )
    ) {
        for (const element of changes.addElements) {
            if (
                !element.laneRef &&
                element.type !== "boundaryEvent"
            ) {
                element.laneRef =
                    context.intervieweeLaneId;
            }
        }
    }

    const existingLane =
        (id: string): string | undefined => {
            const update =
                changes.updateElements.find(
                    (candidate) =>
                        candidate.id === id
                );

            return (
                update?.laneId ??
                update?.laneRef ??
                currentProcess.elements.find(
                    (element) =>
                        element.id === id
                )?.laneId
            );
        };

    const draftByRef =
        new Map(
            changes.addElements.map(
                (element) => [
                    element.tempRef ?? element.id ?? "",
                    element
                ] as const
            )
        );

    const laneOf =
        (reference: string): string | undefined => {
            const draft =
                draftByRef.get(reference);

            return draft
                ? draft.laneRef
                : existingLane(reference);
        };

    const predecessorOf =
        (
            element: ProcessChanges["addElements"][number]
        ): string | undefined => {
            if (element.type === "boundaryEvent") {
                return element.attachedToRef ?? undefined;
            }

            const reference =
                element.tempRef ??
                element.id;

            const incoming =
                changes.addFlows.find(
                    (flow) =>
                        (flow.to ?? flow.toRef) ===
                        reference
                );

            return (
                incoming?.from ??
                incoming?.fromRef
            );
        };

    for (
        let pass = 0;
        pass < changes.addElements.length;
        pass++
    ) {
        for (const element of changes.addElements) {
            if (element.laneRef) {
                continue;
            }

            const predecessor =
                predecessorOf(element);

            const lane =
                predecessor
                    ? laneOf(predecessor)
                    : undefined;

            if (lane) {
                element.laneRef = lane;
            }
        }
    }
}


// ======================================================
// EMPTY UPDATE DETECTION
// ======================================================
//
// LLMs sometimes return:
//
// {
//   id: "t3"
// }
//
// while claiming in assistantMessage that something was
// changed.
//
// Such an object is not a semantic process update and
// should not be propagated further.
// ======================================================

function removeEmptyElementUpdates(
    changes:
        ProcessChanges
): void {
    changes.updateElements =
        changes
            .updateElements
            .filter(
                (
                    update
                ) =>
                    Object
                        .keys(
                            update
                        )
                        .some(
                            (
                                key
                            ) =>
                                key !==
                                "id"
                        )
            );
}


// ======================================================
// PROCESS CHANGE SANITIZATION
// ======================================================
//
// LLM output is untrusted structured input.
//
// Structured Output guarantees the JSON shape, but not
// BPMN semantics.
//
// In particular:
//
// - MessageFlow connects different participants.
// - sourceElementRef must belong to source participant.
// - targetElementRef must belong to target participant.
// - black-box participants have no internal flow nodes.
//
// Invalid optional element endpoint references are
// removed deterministically.
//
// validateProcessModel() remains the final safety layer.
// ======================================================

export function sanitizeProcessChanges(
    currentProcess:
        ProcessModel,

    changes:
        ProcessChanges,

    context?:
        ResponsibilityContext
): ProcessChanges {
    const sanitized =
        structuredClone(
            changes
        );

    deduplicateLaneDrafts(
        currentProcess,
        sanitized
    );

    dropToolLaneDrafts(
        sanitized
    );

    connectNewActivity(
        currentProcess,
        sanitized
    );

    inheritResponsibilityContext(
        currentProcess,
        sanitized,
        context
    );


    // ====================================================
    // PROJECTED PARTICIPANTS
    // ====================================================
    //
    // Keys may be:
    //
    // - stable participant IDs
    // - tempRefs from the current LLM response
    // ====================================================

    const participants =
        new Map<
            string,
            ParticipantInfo
        >();


    // ----------------------------------------------------
    // Existing participants
    // ----------------------------------------------------

    for (
        const participant of
        currentProcess.participants
    ) {
        participants.set(
            participant.id,
            {
                processVisibility:
                    participant
                        .processVisibility
            }
        );
    }


    // ----------------------------------------------------
    // Participant updates
    // ----------------------------------------------------

    for (
        const update of
        changes.updateParticipants
    ) {
        const existing =
            participants.get(
                update.id
            );

        if (
            !existing
        ) {
            continue;
        }

        participants.set(
            update.id,
            {
                processVisibility:
                    update.processVisibility ??
                    existing.processVisibility
            }
        );
    }


    // ----------------------------------------------------
    // New participants
    // ----------------------------------------------------

    for (
        const participant of
        changes.addParticipants
    ) {
        participants.set(
            participant.tempRef,
            {
                processVisibility:
                    participant
                        .processVisibility
            }
        );
    }


    // ====================================================
    // PROJECTED LANES
    // ====================================================
    //
    // lane ID/tempRef -> participant ID/tempRef
    // ====================================================

    const laneParticipantByRef =
        new Map<
            string,
            string
        >();


    // ----------------------------------------------------
    // Existing lanes
    // ----------------------------------------------------

    for (
        const lane of
        currentProcess.lanes
    ) {
        laneParticipantByRef.set(
            lane.id,
            lane.participantId
        );
    }


    // ----------------------------------------------------
    // Lane updates
    // ----------------------------------------------------

    for (
        const update of
        changes.updateLanes
    ) {
        const currentParticipantRef =
            laneParticipantByRef.get(
                update.id
            );

        const nextParticipantRef =
            update.participantRef ??
            update.participantId ??
            currentParticipantRef;

        if (
            nextParticipantRef
        ) {
            laneParticipantByRef.set(
                update.id,
                nextParticipantRef
            );
        }
    }


    // ----------------------------------------------------
    // New lanes
    // ----------------------------------------------------

    for (
        const lane of
        changes.addLanes
    ) {
        laneParticipantByRef.set(
            lane.tempRef,
            lane.participantRef
        );
    }


    // ====================================================
    // PROJECTED ELEMENT OWNERSHIP
    // ====================================================
    //
    // element ID/tempRef -> participant ID/tempRef
    //
    // This includes changes introduced in the current
    // LLM response.
    // ====================================================

    const elementParticipantByRef =
        new Map<
            string,
            string
        >();


    // ----------------------------------------------------
    // Existing elements
    // ----------------------------------------------------

    for (
        const element of
        currentProcess.elements
    ) {
        let participantRef =
            element.participantId;


        /**
         * Lane ownership is authoritative.
         */
        if (
            element.laneId
        ) {
            participantRef =
                laneParticipantByRef.get(
                    element.laneId
                ) ??
                participantRef;
        }


        if (
            participantRef
        ) {
            elementParticipantByRef.set(
                element.id,
                participantRef
            );
        }
    }


    // ----------------------------------------------------
    // Existing element updates
    // ----------------------------------------------------

    for (
        const update of
        changes.updateElements
    ) {
        let participantRef =
            elementParticipantByRef.get(
                update.id
            );


        const laneRef =
            update.laneRef ??
            update.laneId;


        if (
            laneRef
        ) {
            participantRef =
                laneParticipantByRef.get(
                    laneRef
                ) ??
                participantRef;
        } else {
            participantRef =
                update.participantRef ??
                update.participantId ??
                participantRef;
        }


        if (
            participantRef
        ) {
            elementParticipantByRef.set(
                update.id,
                participantRef
            );
        }
    }


    // ----------------------------------------------------
    // New elements
    // ----------------------------------------------------

    for (
        const element of
        changes.addElements
    ) {
        const laneParticipantRef =
            element.laneRef
                ? laneParticipantByRef.get(
                    element.laneRef
                )
                : undefined;


        const participantRef =
            laneParticipantRef ??
            element.participantRef;


        if (
            !participantRef
        ) {
            continue;
        }


        /**
         * New elements are referenced through tempRef in
         * the same Structured Output response.
         */
        if (
            element.tempRef
        ) {
            elementParticipantByRef.set(
                element.tempRef,
                participantRef
            );
        }
    }


    // ====================================================
    // MESSAGE FLOW SANITIZATION
    // ====================================================

    sanitized.addMessageFlows =
        changes
            .addMessageFlows
            .flatMap(
                (
                    flow
                ): MessageFlowDraft[] => {
                    const fromParticipant =
                        participants.get(
                            flow.fromParticipantRef
                        );


                    const toParticipant =
                        participants.get(
                            flow.toParticipantRef
                        );


                    // ============================================
                    // UNKNOWN PARTICIPANT
                    // ============================================

                    if (
                        !fromParticipant ||
                        !toParticipant
                    ) {
                        warnSanitizedMessageFlow(
                            flow,
                            "unknown participant reference"
                        );

                        return [];
                    }


                    // ============================================
                    // MESSAGE FLOW TO SAME PARTICIPANT
                    // ============================================

                    if (
                        flow.fromParticipantRef ===
                        flow.toParticipantRef
                    ) {
                        warnSanitizedMessageFlow(
                            flow,
                            "source and target participant are identical"
                        );

                        return [];
                    }


                    // ============================================
                    // SOURCE ELEMENT
                    // ============================================

                    let sourceElementRef =
                        flow.sourceElementRef;


                    /**
                     * Black-box pools contain no internal
                     * flow-node elements.
                     */
                    if (
                        fromParticipant
                            .processVisibility ===
                        "black_box"
                    ) {
                        if (
                            sourceElementRef
                        ) {
                            warnRemovedElementRef(
                                flow,
                                "sourceElementRef",
                                sourceElementRef,
                                elementParticipantByRef.get(
                                    sourceElementRef
                                ),
                                flow.fromParticipantRef
                            );
                        }

                        sourceElementRef =
                            undefined;
                    } else if (
                        sourceElementRef
                    ) {
                        const actualParticipantRef =
                            elementParticipantByRef.get(
                                sourceElementRef
                            );


                        if (
                            actualParticipantRef !==
                            flow.fromParticipantRef
                        ) {
                            warnRemovedElementRef(
                                flow,
                                "sourceElementRef",
                                sourceElementRef,
                                actualParticipantRef,
                                flow.fromParticipantRef
                            );

                            sourceElementRef =
                                undefined;
                        }
                    }


                    // ============================================
                    // TARGET ELEMENT
                    // ============================================

                    let targetElementRef =
                        flow.targetElementRef;


                    if (
                        toParticipant
                            .processVisibility ===
                        "black_box"
                    ) {
                        if (
                            targetElementRef
                        ) {
                            warnRemovedElementRef(
                                flow,
                                "targetElementRef",
                                targetElementRef,
                                elementParticipantByRef.get(
                                    targetElementRef
                                ),
                                flow.toParticipantRef
                            );
                        }

                        targetElementRef =
                            undefined;
                    } else if (
                        targetElementRef
                    ) {
                        const actualParticipantRef =
                            elementParticipantByRef.get(
                                targetElementRef
                            );


                        if (
                            actualParticipantRef !==
                            flow.toParticipantRef
                        ) {
                            warnRemovedElementRef(
                                flow,
                                "targetElementRef",
                                targetElementRef,
                                actualParticipantRef,
                                flow.toParticipantRef
                            );

                            targetElementRef =
                                undefined;
                        }
                    }


                    // ============================================
                    // REBUILD FLOW
                    // ============================================

                    const {
                        sourceElementRef:
                        _oldSourceElementRef,

                        targetElementRef:
                        _oldTargetElementRef,

                        ...baseFlow
                    } =
                        flow;


                    return [
                        {
                            ...baseFlow,

                            ...(
                                sourceElementRef
                                    ? {
                                        sourceElementRef
                                    }
                                    : {}
                            ),

                            ...(
                                targetElementRef
                                    ? {
                                        targetElementRef
                                    }
                                    : {}
                            )
                        }
                    ];
                }
            );


    // ====================================================
    // REMOVE MEANINGLESS ELEMENT UPDATES
    // ====================================================

    removeEmptyElementUpdates(
        sanitized
    );


    return sanitized;
}


// ======================================================
// INTERVIEWEE ROLE STATEMENT
// ======================================================
//
// Important semantic distinction:
//
// Employee:
//
//   "Wir sind die Auftragserfassung,
//    nicht die Buchhaltung."
//
// means:
//
//   "The interviewee belongs to Auftragserfassung."
//
// It does NOT mean:
//
//   "Move the last discussed Buchhaltung task into
//    Auftragserfassung."
//
// Therefore:
//
// - create/find lane "Auftragserfassung"
// - assign previously unassigned internal activities
//   to that lane
// - preserve activities already explicitly assigned
//   to another lane such as "Buchhaltung"
// ======================================================

export function repairIntervieweeRoleStatement(
    currentProcess:
        ProcessModel,

    changes:
        ProcessChanges,

    userMessage:
        string
): IntervieweeRoleRepairResult {
    const result =
        structuredClone(
            changes
        );


    // ====================================================
    // MATCH INTERVIEWEE IDENTITY STATEMENT
    // ====================================================
    //
    // Examples:
    //
    // "Wir sind die Auftragserfassung, nicht die
    //  Buchhaltung"
    //
    // "Ich bin die Auftragssachbearbeitung und nicht
    //  die Buchhaltung"
    // ====================================================

    const trimmedMessage =
        userMessage.trim();

    const englishIdentity =
        trimmedMessage.match(
            /^(?:no[,\s]+)?(?:we\s+are|we're|i\s+am|i'm)\s+(?:in\s+)?(?:the\s+)?(\p{L}[\p{L}-]*(?:\s+\p{L}[\p{L}-]*){0,3})[.!?]*$/iu
        );

    const match =
        trimmedMessage.match(
            /^(?:wir\s+sind|ich\s+bin)\s+(?:die|der|das)?\s*(.+?)\s*,?\s*(?:und\s+)?nicht\s+(?:die|der|das)?\s*(.+?)[.!?]*$/i
        ) ??
        (
            englishIdentity &&
            !/\b(?:done|finished|not|sure|ready|going|using|doing)\b/i.test(
                englishIdentity[1] ?? ""
            )
                ? englishIdentity
                : null
        );


    if (
        !match
    ) {
        return {
            changes:
                result,

            applied:
                false,

            assignedElementIds:
                []
        };
    }


    const roleName =
        match[1]
            ?.trim();


    const rejectedRoleName =
        match[2]
            ?.trim();


    if (
        !roleName
    ) {
        return {
            changes:
                result,

            applied:
                false,

            assignedElementIds:
                []
        };
    }


    // ====================================================
    // DO NOT APPLY TO EXPLICIT ACTIVITY CORRECTIONS
    // ====================================================
    //
    // Example:
    //
    // "Die Aktivität Preise manuell korrigieren macht
    //  die Buchhaltung."
    //
    // That is a task assignment, not a statement about the
    // interviewee's organizational identity.
    // ====================================================

    const normalizedMessage =
        normalizeOrganizationName(
            userMessage
        );


    const containsExplicitTaskKeyword =
        /\b(aktivitat|aufgabe|tatigkeit|schritt|task)\b/
            .test(
                normalizedMessage
            );


    const containsKnownTaskName =
        currentProcess
            .elements
            .filter(
                (
                    element
                ) =>
                    element.type ===
                    "task"
            )
            .some(
                (
                    task
                ) => {
                    const normalizedTaskName =
                        normalizeOrganizationName(
                            task.name
                        );

                    return (
                        normalizedTaskName.length >=
                        6 &&
                        normalizedMessage.includes(
                            normalizedTaskName
                        )
                    );
                }
            );


    if (
        containsExplicitTaskKeyword ||
        containsKnownTaskName
    ) {
        return {
            changes:
                result,

            applied:
                false,

            assignedElementIds:
                []
        };
    }


    return assignIntervieweeRole(
        currentProcess,
        result,
        roleName,
        rejectedRoleName
    );
}


// ======================================================
// ASSIGN INTERVIEWEE ROLE
// ======================================================
//
// The interviewee's role/department gets one lane; activities
// that have no responsibility yet are assigned to it. Existing
// assignments are never changed.
// ======================================================

export function assignIntervieweeRole(
    currentProcess:
        ProcessModel,

    result:
        ProcessChanges,

    roleName:
        string,

    rejectedRoleName?:
        string
): IntervieweeRoleRepairResult {
    // ====================================================
    // FIND INTERNAL WHITE-BOX PARTICIPANT
    // ====================================================

    const internalParticipant =
        currentProcess
            .participants
            .find(
                (
                    participant
                ) =>
                    participant.type ===
                    "internal" &&
                    participant
                        .processVisibility ===
                    "white_box"
            );


    if (
        !internalParticipant
    ) {
        return {
            changes:
                result,

            applied:
                false,

            assignedElementIds:
                []
        };
    }


    // ====================================================
    // FIND OR CREATE INTERVIEWEE LANE
    // ====================================================

    const normalizedRoleName =
        normalizeOrganizationName(
            roleName
        );


    // ----------------------------------------------------
    // Existing lane
    // ----------------------------------------------------

    const existingLane =
        currentProcess
            .lanes
            .find(
                (
                    lane
                ) =>
                    lane.participantId ===
                    internalParticipant.id &&

                    normalizeOrganizationName(
                        lane.name
                    ) ===
                    normalizedRoleName
            );


    let targetLaneId:
        string |
        undefined;


    let targetLaneRef:
        string |
        undefined;


    if (
        existingLane
    ) {
        targetLaneId =
            existingLane.id;
    } else {
        // --------------------------------------------------
        // Lane already being added in this response
        // --------------------------------------------------

        const existingDraftLane =
            result
                .addLanes
                .find(
                    (
                        lane
                    ) =>
                        lane.participantRef ===
                        internalParticipant.id &&

                        normalizeOrganizationName(
                            lane.name
                        ) ===
                        normalizedRoleName
                );


        if (
            existingDraftLane
        ) {
            targetLaneRef =
                existingDraftLane
                    .tempRef;
        } else {
            // ------------------------------------------------
            // Create new lane
            // ------------------------------------------------

            targetLaneRef =
                createAutomaticLaneRef(
                    roleName,
                    currentProcess,
                    result
                );


            result
                .addLanes
                .push({
                    tempRef:
                        targetLaneRef,

                    participantRef:
                        internalParticipant.id,

                    name:
                        roleName,

                    type:
                        "department"
                });
        }
    }


    // ====================================================
    // ASSIGN CURRENTLY UNASSIGNED EXISTING ELEMENTS
    // ====================================================
    //
    // This is the critical rule:
    //
    // t1 no lane
    // -> Auftragserfassung
    //
    // t2 no lane
    // -> Auftragserfassung
    //
    // t3 already Buchhaltung
    // -> remains Buchhaltung
    // ====================================================

    const assignedElementIds:
        string[] =
        [];


    for (
        const element of
        currentProcess.elements
    ) {
        if (
            element.participantId !==
            internalParticipant.id
        ) {
            continue;
        }


        // --------------------------------------------------
        // Existing explicit lane assignment wins
        // --------------------------------------------------

        if (
            element.laneId
        ) {
            continue;
        }


        let update =
            result
                .updateElements
                .find(
                    (
                        candidate
                    ) =>
                        candidate.id ===
                        element.id
                );


        // --------------------------------------------------
        // The LLM may already have explicitly assigned this
        // element in the same response.
        // --------------------------------------------------

        if (
            update
        ) {
            if (
                update.laneId ||
                update.laneRef
            ) {
                continue;
            }


            const effectiveParticipantRef =
                update.participantRef ??
                update.participantId ??
                element.participantId;


            if (
                effectiveParticipantRef !==
                internalParticipant.id
            ) {
                continue;
            }
        }


        // --------------------------------------------------
        // Create update if needed
        // --------------------------------------------------

        if (
            !update
        ) {
            const newUpdate:
                ProcessChanges["updateElements"][number] = {
                id:
                    element.id
            };


            result
                .updateElements
                .push(
                    newUpdate
                );


            update =
                newUpdate;
        }


        // --------------------------------------------------
        // Assign lane
        // --------------------------------------------------

        if (
            targetLaneId
        ) {
            update.laneId =
                targetLaneId;

            delete update.laneRef;
        } else if (
            targetLaneRef
        ) {
            update.laneRef =
                targetLaneRef;

            delete update.laneId;
        }


        // --------------------------------------------------
        // Performer metadata for actual tasks
        // --------------------------------------------------

        if (
            element.type ===
            "task" &&
            !update.performer
        ) {
            update.performer =
                roleName;
        }


        assignedElementIds.push(
            element.id
        );
    }


    // ====================================================
    // ASSIGN NEW UNASSIGNED ELEMENTS FROM SAME RESPONSE
    // ====================================================

    for (
        const element of
        result.addElements
    ) {
        // Drafts without a participant belong to the internal pool.
        if (
            element.participantRef &&
            element.participantRef !==
            internalParticipant.id
        ) {
            continue;
        }


        if (
            element.laneRef
        ) {
            continue;
        }


        if (
            targetLaneRef
        ) {
            element.laneRef =
                targetLaneRef;
        } else if (
            targetLaneId
        ) {
            /**
             * New ProcessElement drafts reference lanes through
             * laneRef.
             *
             * A stable lane ID may also be used as the
             * resolution reference by applyProcessChanges().
             */
            element.laneRef =
                targetLaneId;
        }


        if (
            element.type ===
            "task" &&
            !element.performer
        ) {
            element.performer =
                roleName;
        }


        if (
            element.tempRef
        ) {
            assignedElementIds.push(
                element.tempRef
            );
        } else if (
            element.id
        ) {
            assignedElementIds.push(
                element.id
            );
        }
    }


    // ====================================================
    // REMOVE EMPTY LLM UPDATES
    // ====================================================

    removeEmptyElementUpdates(
        result
    );


    // ====================================================
    // DEBUG
    // ====================================================

    if (
        process.env.NODE_ENV !==
        "production"
    ) {
        console.info(
            "[workaround-check] interviewee role statement repaired:",
            {
                roleName,

                rejectedRoleName,

                assignedElementIds,

                targetLaneId,

                targetLaneRef
            }
        );
    }


    return {
        changes:
            result,

        applied:
            true,

        roleName,

        ...(rejectedRoleName
            ? {
                rejectedRoleName
            }
            : {}),

        assignedElementIds
    };
}


// ======================================================
// AUTOMATIC LANE TEMP REF
// ======================================================

function createAutomaticLaneRef(
    name:
        string,

    currentProcess:
        ProcessModel,

    changes:
        ProcessChanges
): string {
    const normalizedName =
        normalizeOrganizationName(
            name
        );


    const base =
        normalizedName
            .replace(
                /\s+/g,
                "_"
            ) ||
        "organization";


    const occupiedRefs =
        new Set<
            string
        >([
            ...currentProcess
                .lanes
                .map(
                    (
                        lane
                    ) =>
                        lane.id
                ),

            ...changes
                .addLanes
                .map(
                    (
                        lane
                    ) =>
                        lane.tempRef
                )
        ]);


    let candidate =
        `auto_lane_${base}`;


    let counter =
        2;


    while (
        occupiedRefs.has(
            candidate
        )
    ) {
        candidate =
            `auto_lane_${base}_${counter}`;

        counter +=
            1;
    }


    return candidate;
}


// ======================================================
// DEBUG LOGGING
// ======================================================

function warnSanitizedMessageFlow(
    flow:
        MessageFlowDraft,

    reason:
        string
): void {
    if (
        process.env.NODE_ENV ===
        "production"
    ) {
        return;
    }


    console.warn(
        "[workaround-check] Dropping invalid LLM message flow:",
        {
            messageFlow:
                flow.tempRef,

            reason,

            flow
        }
    );
}


function warnRemovedElementRef(
    flow:
        MessageFlowDraft,

    field:
        "sourceElementRef" |
        "targetElementRef",

    elementRef:
        string,

    actualParticipantRef:
        string |
        undefined,

    expectedParticipantRef:
        string
): void {
    if (
        process.env.NODE_ENV ===
        "production"
    ) {
        return;
    }


    console.warn(
        "[workaround-check] Removed invalid MessageFlow element reference:",
        {
            messageFlow:
                flow.tempRef,

            field,

            elementRef,

            actualParticipantRef,

            expectedParticipantRef
        }
    );
}