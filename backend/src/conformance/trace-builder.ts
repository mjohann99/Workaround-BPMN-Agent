import {
    type ProcessModel
} from "../types.js";


// ======================================================
// ELICITED TRACE
// ======================================================
//
// Represents one executable activity sequence extracted
// from the employee's AS-IS ProcessModel.
//
// Version 1 supports the linear main path.
//
// XOR / alternative paths are added later.
// ======================================================

export type ElicitedTraceVariant = {
    id:
    string;

    /**
     * Stable ProcessModel task IDs.
     */
    activityIds:
    string[];

    /**
     * Human-readable activity labels in execution order.
     */
    labels:
    string[];

    /**
     * true only if traversal reaches an end event.
     */
    complete:
    boolean;

    source:
    | "main_path"
    | "alternative_path";
};


// ======================================================
// BUILD MAIN TRACE
// ======================================================
//
// Version 1 assumptions:
//
// - exactly one start event
// - linear sequence flow
// - tasks are collected until an end event is reached
// - traversal stops when branching occurs
// - traversal stops on cycles
// - XOR handling comes later
//
// Important:
//
// SequenceFlow may cross lanes, which is fine.
//
// It must not cross participants; ProcessModel validation
// already enforces that separately.
// ======================================================

export function buildMainTrace(
    process:
        ProcessModel
): ElicitedTraceVariant {
    // ====================================================
    // INDEX ELEMENTS
    // ====================================================

    const elementsById =
        new Map(
            process.elements.map(
                (
                    element
                ) => [
                    element.id,
                    element
                ] as const
            )
        );


    // ====================================================
    // FIND START EVENT
    // ====================================================

    const startEvents =
        process.elements.filter(
            (
                element
            ) =>
                element.type ===
                "start"
        );

    /**
     * Version 1 expects exactly one start event.
     *
     * We deliberately return an incomplete empty trace
     * instead of guessing which start event is correct.
     */
    if (
        startEvents.length !==
        1
    ) {
        return {
            id:
                "main",

            activityIds:
                [],

            labels:
                [],

            complete:
                false,

            source:
                "main_path"
        };
    }

    const start =
        startEvents[0];


    // ====================================================
    // OUTGOING FLOW INDEX
    // ====================================================

    const outgoingBySource =
        new Map<
            string,
            string[]
        >();

    for (
        const flow of
        process.flows
    ) {
        const current =
            outgoingBySource.get(
                flow.from
            ) ?? [];

        current.push(
            flow.to
        );

        outgoingBySource.set(
            flow.from,
            current
        );
    }


    // ====================================================
    // TRACE RESULT
    // ====================================================

    const activityIds:
        string[] =
        [];

    const labels:
        string[] =
        [];

    const visited =
        new Set<
            string
        >();

    let currentId:
        string | undefined =
        start.id;

    let complete =
        false;


    // ====================================================
    // LINEAR TRAVERSAL
    // ====================================================

    while (
        currentId &&
        !visited.has(
            currentId
        )
    ) {
        visited.add(
            currentId
        );

        const element =
            elementsById.get(
                currentId
            );

        if (
            !element
        ) {
            break;
        }


        // --------------------------------------------------
        // TASK
        // --------------------------------------------------

        if (
            element.type ===
            "task"
        ) {
            activityIds.push(
                element.id
            );

            labels.push(
                element.name
            );
        }


        // --------------------------------------------------
        // END EVENT
        // --------------------------------------------------

        if (
            element.type ===
            "end"
        ) {
            complete =
                true;

            break;
        }


        // --------------------------------------------------
        // NEXT ELEMENT
        // --------------------------------------------------
        //
        // Version 1 only follows an unambiguous linear path.
        //
        // 0 outgoing:
        // incomplete process
        //
        // >1 outgoing:
        // branch / XOR not supported yet
        // --------------------------------------------------

        const nextElementIds: string[] =
            outgoingBySource.get(
                currentId
            ) ?? [];

        if (
            nextElementIds.length !==
            1
        ) {
            break;
        }

        currentId =
            nextElementIds[0];
    }

    // ====================================================
    // RESULT
    // ====================================================

    return {
        id:
            "main",

        activityIds,

        labels,

        complete,

        source:
            "main_path"
    };
}