import {
  type ConformanceMethod,
  type ConformanceMove
} from "../types.js";


// ======================================================
// SERVICE TYPES
// ======================================================

export type ConformanceTraceActivity = {
  actualActivityId:
    string;

  actualLabel:
    string;

  /**
   * Reference-process label obtained from a reliable
   * ActivityMapping.
   */
  replayLabel:
    string;
};


export type RunConformanceInput = {
  referenceProcessId:
    string;

  referenceProcessVersion:
    number;

  bpmnXml:
    string;

  trace:
    ConformanceTraceActivity[];

  complete:
    boolean;
};


export type ConformanceServiceResult = {
  method:
    ConformanceMethod;

  fitness:
    number;

  conformant:
    boolean;

  moves:
    ConformanceMove[];
};


// ======================================================
// CONFIG
// ======================================================

function getConformanceServiceUrl():
  string {
  return (
    process.env
      .CONFORMANCE_SERVICE_URL
      ?.trim() ||
    "http://127.0.0.1:8001"
  );
}


// ======================================================
// VALIDATION
// ======================================================

function isConformanceMethod(
  value:
    unknown
): value is ConformanceMethod {
  return (
    value ===
      "prefix_tbr" ||
    value ===
      "alignment"
  );
}


function isMoveType(
  value:
    unknown
): value is ConformanceMove["type"] {
  return (
    value ===
      "synchronous" ||
    value ===
      "log_move" ||
    value ===
      "model_move"
  );
}


function parseMove(
  value:
    unknown
): ConformanceMove {
  if (
    typeof value !==
      "object" ||
    value ===
      null
  ) {
    throw new Error(
      "Invalid conformance move"
    );
  }

  const raw =
    value as
      Record<
        string,
        unknown
      >;

  if (
    !isMoveType(
      raw.type
    )
  ) {
    throw new Error(
      "Invalid conformance move type"
    );
  }

  const move:
    ConformanceMove = {
    type:
      raw.type
  };

  if (
    typeof raw.actualActivityId ===
      "string"
  ) {
    move.actualActivityId =
      raw.actualActivityId;
  }

  if (
    typeof raw.actualLabel ===
      "string"
  ) {
    move.actualLabel =
      raw.actualLabel;
  }

  if (
    typeof raw.referenceActivityId ===
      "string"
  ) {
    move.referenceActivityId =
      raw.referenceActivityId;
  }

  if (
    typeof raw.referenceLabel ===
      "string"
  ) {
    move.referenceLabel =
      raw.referenceLabel;
  }

  return move;
}


function parseResult(
  value:
    unknown
): ConformanceServiceResult {
  if (
    typeof value !==
      "object" ||
    value ===
      null
  ) {
    throw new Error(
      "Invalid conformance service response"
    );
  }

  const raw =
    value as
      Record<
        string,
        unknown
      >;

  if (
    !isConformanceMethod(
      raw.method
    )
  ) {
    throw new Error(
      "Invalid conformance method"
    );
  }

  if (
    typeof raw.fitness !==
      "number" ||
    !Number.isFinite(
      raw.fitness
    )
  ) {
    throw new Error(
      "Invalid conformance fitness"
    );
  }

  if (
    typeof raw.conformant !==
      "boolean"
  ) {
    throw new Error(
      "Invalid conformance status"
    );
  }

  if (
    !Array.isArray(
      raw.moves
    )
  ) {
    throw new Error(
      "Invalid conformance moves"
    );
  }

  return {
    method:
      raw.method,

    fitness:
      Math.max(
        0,
        Math.min(
          1,
          raw.fitness
        )
      ),

    conformant:
      raw.conformant,

    moves:
      raw.moves.map(
        parseMove
      )
  };
}


// ======================================================
// CALL PM4PY SERVICE
// ======================================================

export async function runConformance(
  input:
    RunConformanceInput
): Promise<
  ConformanceServiceResult
> {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      15_000
    );

  try {
    const response =
      await fetch(
        `${getConformanceServiceUrl()}/conformance`,
        {
          method:
            "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify(
              input
            ),

          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    let body:
      unknown;

    try {
      body =
        text
          ? JSON.parse(
              text
            )
          : undefined;
    } catch {
      body =
        text;
    }

    if (
      !response.ok
    ) {
      throw new Error(
        `Conformance service returned ${response.status}: ${
          typeof body ===
            "string"
            ? body
            : JSON.stringify(
                body
              )
        }`
      );
    }

    return parseResult(
      body
    );
  } catch (
    error:
      unknown
  ) {
    if (
      error instanceof
        Error &&
      error.name ===
        "AbortError"
    ) {
      throw new Error(
        "Conformance service request timed out"
      );
    }

    throw error;
  } finally {
    clearTimeout(
      timeout
    );
  }
}