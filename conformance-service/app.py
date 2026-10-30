from __future__ import annotations

import os
import tempfile
from typing import Any, Literal

import pm4py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pm4py.objects.log.obj import Event, EventLog, Trace


# ======================================================
# APP
# ======================================================

app = FastAPI(
    title="Workaround Check Conformance Service",
    version="0.1.0",
)


# ======================================================
# API MODELS
# ======================================================

class TraceActivity(BaseModel):
    actualActivityId: str
    actualLabel: str
    replayLabel: str


class ConformanceRequest(BaseModel):
    referenceProcessId: str
    referenceProcessVersion: int
    bpmnXml: str
    trace: list[TraceActivity]
    complete: bool


class ConformanceMove(BaseModel):
    type: Literal[
        "synchronous",
        "log_move",
        "model_move",
    ]

    actualActivityId: str | None = None
    actualLabel: str | None = None
    referenceLabel: str | None = None


class ConformanceResponse(BaseModel):
    method: Literal[
        "prefix_tbr",
        "alignment",
    ]

    fitness: float
    conformant: bool
    moves: list[ConformanceMove]


# ======================================================
# HEALTH
# ======================================================

@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
    }


# ======================================================
# BPMN -> PETRI NET
# ======================================================

def load_accepting_petri_net(
    bpmn_xml: str,
):
    """
    Write BPMN XML to a temporary file, load it with PM4Py,
    and convert the BPMN graph to an accepting Petri net.
    """

    path: str | None = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".bpmn",
            encoding="utf-8",
            delete=False,
        ) as temp_file:
            temp_file.write(
                bpmn_xml
            )

            path = temp_file.name

        bpmn_graph = pm4py.read_bpmn(
            path
        )

        net, initial_marking, final_marking = (
            pm4py.convert_to_petri_net(
                bpmn_graph
            )
        )

        return (
            net,
            initial_marking,
            final_marking,
        )

    finally:
        if (
            path is not None
            and os.path.exists(
                path
            )
        ):
            os.remove(
                path
            )


# ======================================================
# EVENT LOG
# ======================================================

def build_event_log(
    activities: list[TraceActivity],
) -> EventLog:
    trace = Trace()

    for activity in activities:
        trace.append(
            Event(
                {
                    "concept:name":
                        activity.replayLabel,
                }
            )
        )

    log = EventLog()

    log.append(
        trace
    )

    return log


# ======================================================
# PREFIX TBR DIAGNOSTICS
# ======================================================

def prefix_is_fit(
    labels: list[str],
    net,
    initial_marking,
    final_marking,
) -> bool:
    """
    Check whether the observed prefix can be replayed
    without interpreting future model behavior as missing.
    """

    trace = Trace()

    for label in labels:
        trace.append(
            Event(
                {
                    "concept:name":
                        label,
                }
            )
        )

    log = EventLog()

    log.append(
        trace
    )

    result = (
        pm4py.conformance_diagnostics_token_based_replay(
            log,
            net,
            initial_marking,
            final_marking,
            return_diagnostics_dataframe=False,
            opt_parameters={
                "consider_remaining_in_fitness":
                    False,

                "try_to_reach_final_marking_through_hidden":
                    False,

                "stop_immediately_unfit":
                    True,

                "walk_through_hidden_trans":
                    True,

                "consider_activities_not_in_model_in_fitness":
                    True,

                "show_progress_bar":
                    False,
            },
        )
    )

    if not result:
        return False

    return bool(
        result[0].get(
            "trace_is_fit",
            False,
        )
    )


# ======================================================
# PREFIX FITNESS
# ======================================================

def calculate_prefix_fitness(
    labels: list[str],
    net,
    initial_marking,
    final_marking,
) -> tuple[
    float,
    bool,
]:
    """
    Version-1 prefix fitness:

        longest fitting prefix
        ----------------------
        observed prefix length

    This is an interview-time screening metric,
    not final alignment fitness.
    """

    if not labels:
        return (
            1.0,
            True,
        )

    longest_fitting_prefix = 0

    for index in range(
        1,
        len(labels) + 1,
    ):
        current_prefix = (
            labels[:index]
        )

        if not prefix_is_fit(
            current_prefix,
            net,
            initial_marking,
            final_marking,
        ):
            break

        longest_fitting_prefix = (
            index
        )

    fitness = (
        longest_fitting_prefix
        / len(labels)
    )

    conformant = (
        longest_fitting_prefix
        == len(labels)
    )

    return (
        float(
            fitness
        ),
        conformant,
    )


# ======================================================
# PREFIX TOKEN-BASED REPLAY
# ======================================================

def run_prefix_tbr(
    request: ConformanceRequest,
    net,
    initial_marking,
    final_marking,
) -> ConformanceResponse:
    """
    Conservative interview-time prefix replay.

    Each observed activity is tested against the currently
    fitting prefix.

    If adding the activity keeps the prefix fitting:
        -> synchronous move

    If adding the activity makes the prefix unfit:
        -> log move

    The rejected activity is NOT added to the fitting
    prefix, so later activities can still be checked.

    IMPORTANT:
    We never create model moves here.
    """

    accepted_labels: list[str] = []

    moves: list[ConformanceMove] = []

    for activity in request.trace:
        candidate_prefix = [
            *accepted_labels,
            activity.replayLabel,
        ]

        fits = prefix_is_fit(
            candidate_prefix,
            net,
            initial_marking,
            final_marking,
        )

        if fits:
            accepted_labels.append(
                activity.replayLabel
            )

            moves.append(
                ConformanceMove(
                    type="synchronous",

                    actualActivityId=
                        activity.actualActivityId,

                    actualLabel=
                        activity.actualLabel,

                    referenceLabel=
                        activity.replayLabel,
                )
            )

            continue

        # --------------------------------------------------
        # CURRENT ACTIVITY DOES NOT FIT THE CURRENT PREFIX
        # --------------------------------------------------
        #
        # During an unfinished interview we interpret this
        # only as:
        #
        # "unexpected actual activity at this point"
        #
        # NOT:
        # "some future reference activity is missing"
        # --------------------------------------------------

        moves.append(
            ConformanceMove(
                type="log_move",

                actualActivityId=
                    activity.actualActivityId,

                actualLabel=
                    activity.actualLabel,
            )
        )

    # ------------------------------------------------------
    # Replay the accepted prefix once more using PM4Py's
    # dedicated prefix replay function.
    # ------------------------------------------------------

    if accepted_labels:
        pm4py.replay_prefix_tbr(
            accepted_labels,
            net,
            initial_marking,
            final_marking,
            activity_key="concept:name",
        )

    if not request.trace:
        fitness = 1.0
    else:
        fitness = (
            len(accepted_labels)
            / len(request.trace)
        )

    conformant = not any(
        move.type == "log_move"
        for move in moves
    )

    return ConformanceResponse(
        method="prefix_tbr",
        fitness=float(fitness),
        conformant=conformant,
        moves=moves,
    )

    # --------------------------------------------------
    # IMPORTANT
    #
    # During an unfinished interview we do NOT emit
    # model_move entries for future reference activities.
    #
    # The employee may simply not have described them yet.
    # --------------------------------------------------

    return ConformanceResponse(
        method=
            "prefix_tbr",

        fitness=
            fitness,

        conformant=
            conformant,

        moves=
            [],
    )


# ======================================================
# ALIGNMENT HELPERS
# ======================================================

SKIP_SYMBOLS = {
    ">>",
    "»",
}


def normalize_alignment_side(
    value: Any,
) -> str | None:
    if value is None:
        return None

    if isinstance(
        value,
        (
            tuple,
            list,
        ),
    ):
        if not value:
            return None

        value = (
            value[-1]
        )

    if value is None:
        return None

    text = str(
        value
    )

    if text in SKIP_SYMBOLS:
        return None

    return text


# ======================================================
# ALIGNMENT MOVES
# ======================================================

def convert_alignment_moves(
    alignment: list[Any],
    activities: list[TraceActivity],
) -> list[ConformanceMove]:
    moves: list[
        ConformanceMove
    ] = []

    actual_index = 0

    for raw_move in alignment:
        if (
            not isinstance(
                raw_move,
                (
                    tuple,
                    list,
                ),
            )
            or len(
                raw_move
            ) != 2
        ):
            continue

        raw_log_side = (
            raw_move[0]
        )

        raw_model_side = (
            raw_move[1]
        )

        log_label = (
            normalize_alignment_side(
                raw_log_side
            )
        )

        model_label = (
            normalize_alignment_side(
                raw_model_side
            )
        )

        # ----------------------------------------------
        # SYNCHRONOUS MOVE
        # ----------------------------------------------

        if (
            log_label is not None
            and model_label is not None
        ):
            activity = (
                activities[
                    actual_index
                ]
                if actual_index
                < len(
                    activities
                )
                else None
            )

            moves.append(
                ConformanceMove(
                    type=
                        "synchronous",

                    actualActivityId=
                        (
                            activity.actualActivityId
                            if activity
                            else None
                        ),

                    actualLabel=
                        (
                            activity.actualLabel
                            if activity
                            else log_label
                        ),

                    referenceLabel=
                        model_label,
                )
            )

            actual_index += 1

            continue

        # ----------------------------------------------
        # MOVE ON LOG
        # ----------------------------------------------

        if (
            log_label is not None
            and model_label is None
        ):
            activity = (
                activities[
                    actual_index
                ]
                if actual_index
                < len(
                    activities
                )
                else None
            )

            moves.append(
                ConformanceMove(
                    type=
                        "log_move",

                    actualActivityId=
                        (
                            activity.actualActivityId
                            if activity
                            else None
                        ),

                    actualLabel=
                        (
                            activity.actualLabel
                            if activity
                            else log_label
                        ),
                )
            )

            actual_index += 1

            continue

        # ----------------------------------------------
        # MOVE ON MODEL
        # ----------------------------------------------

        if (
            log_label is None
            and model_label is not None
        ):
            moves.append(
                ConformanceMove(
                    type=
                        "model_move",

                    referenceLabel=
                        model_label,
                )
            )

    return moves


# ======================================================
# FINAL ALIGNMENT
# ======================================================

def run_alignment(
    request: ConformanceRequest,
    net,
    initial_marking,
    final_marking,
) -> ConformanceResponse:
    log = build_event_log(
        request.trace
    )

    results = (
        pm4py.conformance_diagnostics_alignments(
            log,
            net,
            initial_marking,
            final_marking,
            activity_key="concept:name",
            return_diagnostics_dataframe=False,
        )
    )

    if not results:
        raise RuntimeError(
            "PM4Py returned no alignment result"
        )

    result = (
        results[0]
    )

    raw_alignment = (
        result.get(
            "alignment",
            [],
        )
    )

    moves = (
        convert_alignment_moves(
            raw_alignment,
            request.trace,
        )
    )

    fitness = float(
        result.get(
            "fitness",
            0.0,
        )
    )

    has_deviation = any(
        move.type
        in {
            "log_move",
            "model_move",
        }
        for move in moves
    )

    return ConformanceResponse(
        method=
            "alignment",

        fitness=
            fitness,

        conformant=
            not has_deviation,

        moves=
            moves,
    )


# ======================================================
# CONFORMANCE ENDPOINT
# ======================================================

@app.post(
    "/conformance",
    response_model=
        ConformanceResponse,
)
def conformance(
    request: ConformanceRequest,
) -> ConformanceResponse:
    try:
        (
            net,
            initial_marking,
            final_marking,
        ) = load_accepting_petri_net(
            request.bpmnXml
        )

        if request.complete:
            return run_alignment(
                request,
                net,
                initial_marking,
                final_marking,
            )

        return run_prefix_tbr(
            request,
            net,
            initial_marking,
            final_marking,
        )

    except Exception as error:
        raise HTTPException(
            status_code=
                422,

            detail=
                (
                    "Conformance checking failed: "
                    f"{error}"
                ),
        ) from error