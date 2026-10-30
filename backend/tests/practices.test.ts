import request from "supertest";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/openai.js", () => ({
  proposeProcessChanges: vi.fn()
}));

vi.mock("../src/logging.js", () => ({
  logInteraction: vi.fn()
}));

import { app } from "../src/app.js";
import {
  applyPracticeHints,
  choosePracticeQuestion,
  createEvidence,
  groupingHintsForAnswer,
  isDeviationEligible,
  isPracticeComplete,
  isUnknownAnswer,
  practiceInvestigations,
  recordPracticeAnswers,
  syncPractices
} from "../src/analysis/practices.js";
import { proposeProcessChanges } from "../src/openai.js";
import {
  createSession,
  getSession,
  replaceDeviations,
  replacePractices,
  updateSessionProcess,
  updateSessionState
} from "../src/store.js";
import { toOwnerSessionView } from "../src/view.js";
import {
  type DeviationCandidate,
  type LlmProcessResponse,
  type PracticeCandidate,
  type PracticeGrouping,
  type PracticeHint
} from "../src/types.js";
import {
  changes,
  linearProcess
} from "./helpers/process-fixtures.js";

// ======================================================
// FIXTURES
// ======================================================

// task_0 .. task_5 in sequence, so every activity has a successor.
const process =
  linearProcess([
    "Receive order",
    "Check stock",
    "Phone supplier",
    "Note price in sheet",
    "Send quote",
    "Archive"
  ]);

function deviation(
  id: string,
  activityId: string
): DeviationCandidate {
  return {
    id,
    referenceProcessId: "ref",
    referenceProcessVersion: 1,
    sourceConformanceRunId: "run",
    detectionMethod: "prefix_tbr",
    provisional: true,
    dimension: "control_flow",
    moveType: "log_move",
    actualActivityIds: [activityId],
    expectedReferenceActivityIds: [],
    description: `Actual activity ${activityId} has no matching activity.`,
    firstDetectedAt: new Date().toISOString(),
    status: "open"
  } as DeviationCandidate;
}

const EMPTY_GROUPING: PracticeGrouping = {
  askedSets: [],
  independentPairs: [],
  redirects: {}
};

const devs = [
  deviation("dev_a", "task_2"),
  deviation("dev_b", "task_3")
];

function sync(
  existing: PracticeCandidate[],
  deviations: DeviationCandidate[]
) {
  return syncPractices(
    existing,
    deviations,
    new Set(deviations.map((item) => item.id))
  );
}

let messageCounter = 0;

function evidence(text: string) {
  return createEvidence(text, `msg_${messageCounter++}`);
}

function context(
  deviations: DeviationCandidate[],
  text = "employee statement"
) {
  return {
    process,
    refToId: {},
    deviations,
    evidence: evidence(text)
  };
}

function group(
  practices: PracticeCandidate[],
  hints: PracticeHint[],
  deviations: DeviationCandidate[] = devs,
  grouping: PracticeGrouping = EMPTY_GROUPING
) {
  return applyPracticeHints(
    practices,
    grouping,
    hints,
    context(deviations)
  );
}

const sharedPurpose: PracticeHint = {
  activityRefs: ["task_2", "task_3"],
  relation: "same_practice",
  basis: "Both steps exist because the ERP has no supplier prices"
};

function answer(
  practices: PracticeCandidate[],
  practiceId: string,
  field: "reason" | "sinceWhen" | "frequency",
  value: string | null,
  options: {
    unknown?: boolean;
    scope?: "practice" | "activities";
    activityRefs?: string[];
  } = {}
) {
  return recordPracticeAnswers(
    practices,
    [
      {
        practiceId,
        field,
        scope: options.scope ?? "practice",
        activityRefs: options.activityRefs ?? [],
        unknown: options.unknown ?? false,
        value
      }
    ],
    context(devs, String(value ?? "unknown"))
  );
}

function next(
  practices: PracticeCandidate[],
  grouping: PracticeGrouping = EMPTY_GROUPING,
  deviations: DeviationCandidate[] = devs
) {
  return choosePracticeQuestion({
    practices,
    grouping,
    deviations,
    process
  });
}

function reloaded<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ======================================================
// GROUPING
// ======================================================

describe("workaround candidates", () => {
  it("keeps one candidate per deviation until the employee relates them", () => {
    const practices = sync([], devs);

    expect(practices).toHaveLength(2);
    expect(practices[0].deviationIds).toEqual(["dev_a"]);
    expect(practices[1].deviationIds).toEqual(["dev_b"]);
    expect(
      practices.every((practice) => !practice.facts.reason)
    ).toBe(true);
  });

  it("asks one neutral grouping question for connected, unrelated observations", () => {
    const result = next(sync([], devs));

    expect(result.question?.kind).toBe("practice_grouping");
    expect(result.question?.question).toContain('"Phone supplier"');
    expect(result.question?.question).toContain('"Note price in sheet"');
    expect(result.question?.question).not.toMatch(
      /workaround|deviation|why/i
    );

    const again = next(result.practices, result.grouping);

    expect(again.question?.kind).not.toBe("practice_grouping");
  });

  it("groups activities only with a stated shared basis", () => {
    const practices = sync([], devs);

    const withoutBasis =
      group(practices, [{ ...sharedPurpose, basis: "  " }]);

    expect(withoutBasis.practices).toHaveLength(2);

    const grouped = group(practices, [sharedPurpose]);

    expect(grouped.practices).toHaveLength(1);
    expect(grouped.practices[0].deviationIds.sort()).toEqual([
      "dev_a",
      "dev_b"
    ]);
    expect(grouped.practices[0].activityIds.sort()).toEqual([
      "task_2",
      "task_3"
    ]);
    expect(grouped.practices[0].groupingBasis[0].excerpt).toContain(
      "supplier prices"
    );
  });

  it("keeps unrelated activities separate and remembers the decision", () => {
    const result =
      group(sync([], devs), [
        { activityRefs: ["task_2", "task_3"], relation: "independent" }
      ]);

    expect(result.practices).toHaveLength(2);
    expect(result.grouping.independentPairs).toEqual(["task_2|task_3"]);
    expect(
      next(result.practices, result.grouping).question?.kind
    ).not.toBe("practice_grouping");
  });

  it("splits an activity out of a candidate when it is called independent", () => {
    const grouped = group(sync([], devs), [sharedPurpose]);

    const result =
      group(
        grouped.practices,
        [{ activityRefs: ["task_3"], relation: "independent" }],
        devs,
        grouped.grouping
      );

    expect(result.practices).toHaveLength(2);
    expect(
      result.practices.find((practice) =>
        practice.activityIds.includes("task_3")
      )!.deviationIds
    ).toEqual(["dev_b"]);
  });

  it("merging keeps answers and evidence of both candidates", () => {
    const separate = sync([], devs);
    const [first, second] = separate;

    let state = answer(separate, first.id, "reason", "ERP lacks prices");
    state = answer(state, second.id, "frequency", "Daily");

    const merged = group(state, [sharedPurpose], devs).practices;

    expect(merged).toHaveLength(1);
    expect(merged[0].facts.reason?.value).toBe("ERP lacks prices");
    expect(merged[0].facts.frequency?.value).toBe("Daily");
    expect(merged[0].evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("extends an existing candidate with a later activity", () => {
    const grouped = group(sync([], devs), [sharedPurpose]);
    const later = [...devs, deviation("dev_c", "task_4")];

    const extended =
      applyPracticeHints(
        sync(grouped.practices, later),
        grouped.grouping,
        [
          {
            activityRefs: ["task_4"],
            relation: "same_practice",
            extendsPracticeId: grouped.practices[0].id,
            basis: "Same supplier price problem"
          }
        ],
        context(later)
      );

    expect(extended.practices).toHaveLength(1);
    expect(extended.practices[0].id).toBe(grouped.practices[0].id);
    expect(extended.practices[0].deviationIds).toHaveLength(3);
  });
});

// ======================================================
// SHARED FOLLOW-UP
// ======================================================

describe("shared follow-up questions", () => {
  const groupedPractice = () =>
    group(sync([], devs), [sharedPurpose]).practices;

  it("asks purpose, onset and frequency once, in one question for the whole group", () => {
    const result = next(groupedPractice());

    expect(result.question?.field).toBe("combined");
    expect(result.question?.question).toContain('"Phone supplier"');
    expect(result.question?.question).toContain('"Note price in sheet"');
    expect(result.question?.question).toMatch(/purpose.*since when.*how often/);

    const answered =
      answer(result.practices, result.question!.practiceId, "reason", "some answer");

    expect(isPracticeComplete(answered[0])).toBe(true);
    expect(next(answered).question).toBeUndefined();
  });

  it("does not restart the questionnaire when an activity is added", () => {
    let practices = groupedPractice();

    for (const field of ["reason", "sinceWhen", "frequency"] as const) {
      practices = answer(practices, practices[0].id, field, "known");
    }

    const later = [...devs, deviation("dev_c", "task_4")];

    const extended =
      applyPracticeHints(
        sync(practices, later),
        EMPTY_GROUPING,
        [
          {
            activityRefs: ["task_4"],
            relation: "same_practice",
            extendsPracticeId: practices[0].id,
            basis: "Same cause"
          }
        ],
        context(later)
      );

    expect(extended.practices).toHaveLength(1);
    expect(
      next(extended.practices, extended.grouping, later).question
    ).toBeUndefined();
  });

  it("assesses independent practices separately", () => {
    const state =
      group(sync([], devs), [
        { activityRefs: ["task_2", "task_3"], relation: "independent" }
      ]);

    const first = next(state.practices, state.grouping);

    expect(first.question?.field).toBe("combined");
    expect(first.question?.question).toContain('"Phone supplier"');
    expect(first.question?.question).not.toContain('"Note price in sheet"');
  });

  it("waits for context before the first question", () => {
    const lastTask = [deviation("dev_last", "task_5")];

    const result =
      choosePracticeQuestion({
        practices: sync([], lastTask),
        grouping: EMPTY_GROUPING,
        deviations: lastTask,
        process
      });

    expect(result.question).toBeUndefined();
  });

  it("never asks about reviewed deviations", () => {
    const reviewed = devs.map((item) => ({
      ...item,
      status: "reviewed" as const
    }));

    expect(
      next(groupedPractice(), EMPTY_GROUPING, reviewed).question
    ).toBeUndefined();
  });

  it("stops asking a field that stays unanswered", () => {
    let practices = groupedPractice();
    let count = 0;

    for (let i = 0; i < 8; i++) {
      const result = next(practices);

      if (!result.question) {
        break;
      }

      count++;
      practices = result.practices;
    }

    expect(count).toBeLessThanOrEqual(3);
  });
});

// ======================================================
// ANSWERS: SCOPE, EVIDENCE, UNKNOWN
// ======================================================

describe("recorded answers", () => {
  const grouped = () =>
    group(sync([], devs), [sharedPurpose]).practices;

  it("keeps the evidence behind a shared answer", () => {
    const practices = grouped();
    const state =
      answer(practices, practices[0].id, "reason", "ERP lacks prices");

    const fact = state[0].facts.reason!;

    expect(fact.scope).toBe("practice");
    expect(fact.activityIds.sort()).toEqual(["task_2", "task_3"]);
    expect(
      state[0].evidence.find((item) => item.id === fact.evidenceId)?.excerpt
    ).toBe("ERP lacks prices");
  });

  it("limits an answer to the named activities", () => {
    const practices = grouped();

    const state =
      answer(practices, practices[0].id, "frequency", "Only for rush orders", {
        scope: "activities",
        activityRefs: ["task_3"]
      });

    expect(state[0].facts.frequency).toBeUndefined();
    expect(state[0].activityFacts[0].activityIds).toEqual(["task_3"]);
  });

  it("treats 'I do not know' as an answer, not as a gap", () => {
    const practices = grouped();

    const state =
      answer(practices, practices[0].id, "sinceWhen", null, { unknown: true });

    expect(state[0].facts.sinceWhen?.status).toBe("unknown");
    expect(next(state).question?.field).not.toBe("sinceWhen");
  });

  it("does not let 'unknown' overwrite a real answer", () => {
    const practices = grouped();

    let state =
      answer(practices, practices[0].id, "reason", "ERP lacks prices");

    state = answer(state, practices[0].id, "reason", null, { unknown: true });

    expect(state[0].facts.reason?.status).toBe("answered");
  });

  it("recognizes short unknown replies only", () => {
    expect(isUnknownAnswer("I don't know")).toBe(true);
    expect(isUnknownAnswer("No idea.")).toBe(true);
    expect(
      isUnknownAnswer(
        "We do it because the ERP system lacks prices and I do not know anything about the older approach that was used before and when it ended"
      )
    ).toBe(false);
  });

  it("answers a partial explanation with a contextual clarification, not the same question", () => {
    const practices = grouped();
    const first = next(practices);

    const partial =
      answer(first.practices, practices[0].id, "reason", "I call to get the price", {
        scope: "activities",
        activityRefs: ["task_2"]
      });

    expect(partial[0].facts.reason).toBeUndefined();

    const second = next(partial);

    expect(second.question?.field).toBe("reason");
    expect(second.question?.question).toContain("Thanks, that explains");
    expect(second.question?.question).toContain('"Phone supplier"');
    expect(second.question?.question).toContain("shared purpose");
    expect(second.question?.question).not.toContain("as a whole");
    expect(second.question?.question).not.toBe(first.question?.question);

    expect(next(second.practices).question).toBeUndefined();
  });

  it("keeps an unscoped partial explanation instead of dropping it", () => {
    const practices = grouped();

    const state =
      answer(practices, practices[0].id, "reason", "Quick fix", {
        scope: "activities",
        activityRefs: ["not_existing"]
      });

    expect(state[0].activityFacts).toHaveLength(1);
    expect(state[0].facts.reason).toBeUndefined();
  });

  it("reprocessing the same message creates no duplicate records", () => {
    const practices = grouped();
    const shared = context(devs, "Because of ERP");

    const hint = {
      practiceId: practices[0].id,
      field: "reason" as const,
      scope: "practice" as const,
      activityRefs: [],
      unknown: false,
      value: "ERP"
    };

    const once = recordPracticeAnswers(practices, [hint], shared);
    const twice = recordPracticeAnswers(once, [hint], shared);

    expect(twice[0].evidence).toHaveLength(1);
    expect(twice[0].activityFacts).toHaveLength(0);
    expect(twice[0].facts.reason?.value).toBe("ERP");
  });

  it("explicit unknown answers stay resolved across reload", () => {
    let practices = grouped();

    practices =
      answer(practices, practices[0].id, "reason", null, { unknown: true });

    const afterReload = reloaded(practices);

    expect(next(afterReload).question?.field).toBe("sinceWhen");
    expect(afterReload[0].facts.reason?.status).toBe("unknown");
  });

  it("keeps resolved answers when practices are merged and resolves the stale ID", () => {
    const separate = sync([], devs);
    const [first, second] = separate;

    const merged =
      group(answer(separate, first.id, "reason", "ERP lacks prices"), [
        sharedPurpose
      ]);

    expect(merged.practices[0].id).toBe(first.id);
    expect(merged.grouping.redirects[second.id]).toBe(first.id);

    const stale =
      recordPracticeAnswers(
        merged.practices,
        [
          {
            practiceId: second.id,
            field: "sinceWhen",
            scope: "practice",
            activityRefs: [],
            unknown: false,
            value: "Since January"
          }
        ],
        context(devs),
        { practiceId: second.id, practiceField: "sinceWhen", targetIds: [] },
        { redirects: merged.grouping.redirects }
      );

    expect(stale[0].facts.sinceWhen?.value).toBe("Since January");
    expect(stale[0].facts.reason?.value).toBe("ERP lacks prices");
  });

  it("falls back to the pending question's activities when the practice ID is gone", () => {
    const state =
      recordPracticeAnswers(
        grouped(),
        [
          {
            practiceId: "vanished",
            field: "reason",
            scope: "practice",
            activityRefs: [],
            unknown: false,
            value: "Reason"
          }
        ],
        context(devs),
        { practiceId: "vanished", practiceField: "reason", targetIds: ["task_2"] }
      );

    expect(state[0].facts.reason?.value).toBe("Reason");
  });
});

// ======================================================
// REPORTING
// ======================================================

describe("practice reporting", () => {
  it("counts practices separately from deviations", () => {
    const practices = group(sync([], devs), [sharedPurpose]).practices;

    expect(practices).toHaveLength(1);
    expect(practices[0].deviationIds).toHaveLength(2);
  });

  it("shows the same shared answers for every deviation of a practice", () => {
    let practices = group(sync([], devs), [sharedPurpose]).practices;

    practices =
      answer(practices, practices[0].id, "reason", "ERP lacks prices");

    const investigations = practiceInvestigations(practices, devs);

    expect(investigations).toHaveLength(2);
    expect(investigations.map((item) => item.facts.reason)).toEqual([
      "ERP lacks prices",
      "ERP lacks prices"
    ]);
  });

  it("only treats complete alignments as grounds for a missing step", () => {
    const missing = {
      ...deviation("dev_m", "task_2"),
      moveType: "model_move",
      actualActivityIds: []
    } as DeviationCandidate;

    expect(isDeviationEligible(missing, [], true)).toBe(false);
    expect(isDeviationEligible(devs[0], [], false)).toBe(false);
    expect(isDeviationEligible(devs[0], [], true)).toBe(true);
  });
});

// ======================================================
// GROUPING CONTROLS FOLLOW-UP QUESTIONS
// ======================================================

describe("confirmed grouping drives the follow-up sequence", () => {
  const chain = [
    deviation("dev_1", "task_1"),
    deviation("dev_2", "task_2"),
    deviation("dev_3", "task_3")
  ];

  const pendingFor = (targetIds: string[]) => ({
    kind: "practice_grouping" as const,
    targetIds
  });

  it("asks one grouping question for a connected chain, not one per pair", () => {
    const first = next(sync([], chain), EMPTY_GROUPING, chain);

    expect(first.question?.kind).toBe("practice_grouping");
    expect(first.question?.targetIds.sort()).toEqual([
      "task_1",
      "task_2",
      "task_3"
    ]);

    expect(
      next(first.practices, first.grouping, chain).question?.kind
    ).not.toBe("practice_grouping");
  });

  it("turns a bare 'yes' into a shared practice with one shared question", () => {
    const asked = next(sync([], chain), EMPTY_GROUPING, chain);

    const grouped =
      applyPracticeHints(
        asked.practices,
        asked.grouping,
        groupingHintsForAnswer([], "Yes.", pendingFor(asked.question!.targetIds)),
        context(chain)
      );

    expect(grouped.practices).toHaveLength(1);
    expect(grouped.practices[0].activityIds).toHaveLength(3);

    const result = next(grouped.practices, grouped.grouping, chain);

    expect(result.question?.field).toBe("combined");
    expect(result.question?.practiceId).toBe(grouped.practices[0].id);

    const practices =
      answer(result.practices, result.question!.practiceId, "reason", "answer");

    expect(next(practices, grouped.grouping, chain).question).toBeUndefined();
  });

  it("maps a bare 'no' to independent practices and keeps their questions apart", () => {
    const asked = next(sync([], chain), EMPTY_GROUPING, chain);

    const separated =
      applyPracticeHints(
        asked.practices,
        asked.grouping,
        groupingHintsForAnswer([], "No", pendingFor(asked.question!.targetIds)),
        context(chain)
      );

    expect(separated.practices).toHaveLength(3);

    const question =
      next(separated.practices, separated.grouping, chain).question;

    expect(question?.kind).toBe("practice_reason");
    expect(question?.targetIds).toHaveLength(1);
  });

  it("prefers the model's stated basis over the bare reply", () => {
    expect(
      groupingHintsForAnswer(
        [sharedPurpose],
        "Yes, but only those two",
        pendingFor(["task_1", "task_2", "task_3"])
      )
    ).toEqual([sharedPurpose]);
  });

  it("does not restart completed questions when a member joins, even after reload", () => {
    let practices = group(sync([], devs), [sharedPurpose]).practices;

    for (const field of ["reason", "sinceWhen", "frequency"] as const) {
      practices = answer(practices, practices[0].id, field, "known");
    }

    const later = [...devs, deviation("dev_c", "task_4")];

    const extended =
      applyPracticeHints(
        sync(reloaded(practices), later),
        reloaded(EMPTY_GROUPING),
        [
          {
            activityRefs: ["task_4"],
            relation: "same_practice",
            extendsPracticeId: practices[0].id,
            basis: "Same cause"
          }
        ],
        context(later)
      );

    expect(extended.practices).toHaveLength(1);
    expect(extended.practices[0].id).toBe(practices[0].id);
    expect(extended.practices[0].facts.reason?.value).toBe("known");
    expect(
      next(reloaded(extended.practices), reloaded(extended.grouping), later)
        .question
    ).toBeUndefined();
  });
});

// ======================================================
// ONE SHARED INQUIRY
// ======================================================

describe("one shared inquiry for closely related activities", () => {
  const related = [
    deviation("dev_1", "task_1"),
    deviation("dev_2", "task_2"),
    deviation("dev_3", "task_3")
  ];

  const hint: PracticeHint = {
    activityRefs: ["task_1", "task_2", "task_3"],
    relation: "same_practice",
    basis: "All three steps work around the missing supplier prices"
  };

  it("asks once for all members and never questions them individually afterwards", () => {
    const grouped =
      applyPracticeHints(
        sync([], related),
        EMPTY_GROUPING,
        [hint],
        context(related)
      );

    expect(grouped.practices).toHaveLength(1);

    const first = next(grouped.practices, grouped.grouping, related);

    expect(first.question?.kind).toBe("practice_reason");
    expect(first.question?.field).toBe("combined");
    expect(first.question?.targetIds.sort()).toEqual([
      "task_1",
      "task_2",
      "task_3"
    ]);

    for (const name of ["Check stock", "Phone supplier", "Note price in sheet"]) {
      expect(first.question?.question).toContain(`"${name}"`);
    }

    const answered =
      recordPracticeAnswers(
        first.practices,
        [
          {
            practiceId: first.question!.practiceId,
            field: "reason",
            scope: "practice",
            activityRefs: [],
            unknown: false,
            value: "ERP lacks prices"
          },
          {
            practiceId: first.question!.practiceId,
            field: "frequency",
            scope: "practice",
            activityRefs: [],
            unknown: false,
            value: "Daily"
          }
        ],
        context(related, "ERP lacks prices, daily")
      );

    expect(answered).toHaveLength(1);
    expect(answered[0].facts.reason?.value).toBe("ERP lacks prices");
    expect(answered[0].facts.frequency?.value).toBe("Daily");

    const after = next(answered, grouped.grouping, related);

    expect(after.question).toBeUndefined();
    expect(after.practices[0].activityIds).toHaveLength(3);
  });

  it("keeps independent activities apart, each with its own question", () => {
    const independent =
      applyPracticeHints(
        sync([], related),
        EMPTY_GROUPING,
        [{ activityRefs: ["task_1", "task_2", "task_3"], relation: "independent" }],
        context(related)
      );

    expect(independent.practices).toHaveLength(3);

    const targets = new Set<string>();
    let practices = independent.practices;

    for (let i = 0; i < 5; i++) {
      const result = next(practices, independent.grouping, related);

      if (!result.question) {
        break;
      }

      expect(result.question.field).toBe("combined");
      expect(result.question.targetIds).toHaveLength(1);
      targets.add(result.question.targetIds[0]);

      practices = answer(
        result.practices,
        result.question.practiceId,
        "reason",
        "own reason"
      );
    }

    expect([...targets].sort()).toEqual(["task_1", "task_2", "task_3"]);
  });
});

// ======================================================
// ROUTE
// ======================================================

describe("practice follow-ups over the message route", () => {
  beforeEach(() => {
    vi.mocked(proposeProcessChanges).mockReset();
  });

  function reply(
    overrides: Partial<LlmProcessResponse> = {}
  ): LlmProcessResponse {
    return {
      language: "en",
      intent: "process_description",
      assistantMessage: "Noted.",
      contextPatch: {},
      changes: changes(),
      uncertainties: [],
      nextQuestion: {
        required: false,
        kind: "clarification",
        targetRefs: [],
        question: ""
      },
      validationRequest: { required: false, elementIds: [], question: "" },
      responsibility: {},
      practiceHints: [],
      practiceAnswers: [],
      ...overrides
    };
  }

  function seeded() {
    const session = createSession();

    updateSessionProcess(session.id, process);
    updateSessionState(session.id, { pendingQuestion: undefined });
    replaceDeviations(session.id, devs);

    const practices = group(sync([], devs), [sharedPurpose]).practices;

    replacePractices(session.id, practices);

    return { id: session.id, practiceId: practices[0].id };
  }

  async function say(id: string, message: string) {
    const response =
      await request(app)
        .post(`/api/employee/sessions/${id}/message`)
        .send({ message });

    expect(response.status).toBe(200);

    return response;
  }

  it("stores a scoped answer with evidence and keeps it after reload", async () => {
    const { id, practiceId } = seeded();

    updateSessionState(id, {
      pendingQuestion: {
        id: "q1",
        kind: "practice_reason",
        targetIds: [],
        question: "Regarding the steps: what is the purpose?",
        practiceId,
        practiceField: "reason"
      }
    });

    vi.mocked(proposeProcessChanges).mockResolvedValueOnce(
      reply({
        practiceAnswers: [
          {
            practiceId,
            field: "reason",
            scope: "practice",
            activityRefs: [],
            unknown: false,
            value: "The ERP has no supplier prices"
          }
        ]
      })
    );

    const response = await say(id, "Because the ERP has no supplier prices.");

    const practice =
      getSession(id)!.analysis.practices.find((item) => item.id === practiceId)!;

    expect(practice.facts.reason?.value).toBe("The ERP has no supplier prices");
    expect(practice.evidence[0].excerpt).toBe(
      "Because the ERP has no supplier prices."
    );
    expect(JSON.stringify(response.body)).not.toContain("practice");

    const owner = toOwnerSessionView(getSession(id)!, "<xml/>");

    expect(
      owner.analysis.investigations.map((item) => item.facts.reason)
    ).toEqual([
      "The ERP has no supplier prices",
      "The ERP has no supplier prices"
    ]);
  });

  it("records 'I do not know' without asking the same field again", async () => {
    const { id, practiceId } = seeded();

    updateSessionState(id, {
      pendingQuestion: {
        id: "q2",
        kind: "practice_since",
        targetIds: [],
        question: "Since when?",
        practiceId,
        practiceField: "sinceWhen"
      }
    });

    vi.mocked(proposeProcessChanges).mockResolvedValueOnce(
      reply({
        practiceAnswers: [
          {
            practiceId,
            field: "sinceWhen",
            scope: "practice",
            activityRefs: [],
            unknown: true,
            value: null
          }
        ]
      })
    );

    await say(id, "I don't know.");

    const session = getSession(id)!;

    expect(
      session.analysis.practices.find((item) => item.id === practiceId)!
        .facts.sinceWhen?.status
    ).toBe("unknown");
    expect(session.pendingQuestion?.practiceField).not.toBe("sinceWhen");
  });

  it("falls back to the whole message when the model reports no answer", async () => {
    const { id, practiceId } = seeded();

    updateSessionState(id, {
      pendingQuestion: {
        id: "q3",
        kind: "practice_frequency",
        targetIds: [],
        question: "How often?",
        practiceId,
        practiceField: "frequency"
      }
    });

    vi.mocked(proposeProcessChanges).mockResolvedValueOnce(reply());

    await say(id, "Every day.");

    expect(
      getSession(id)!.analysis.practices.find((item) => item.id === practiceId)!
        .facts.frequency?.value
    ).toBe("Every day.");
  });

  it("a plain 'Yes' groups the set and the next question is about the shared practice", async () => {
    const chain = [
      deviation("dev_1", "task_1"),
      deviation("dev_2", "task_2"),
      deviation("dev_3", "task_3")
    ];

    const session = createSession();

    updateSessionProcess(session.id, process);
    replaceDeviations(session.id, chain);

    const seededPractices = sync([], chain);

    replacePractices(session.id, seededPractices, {
      askedSets: ["task_1|task_2|task_3"],
      independentPairs: [],
      redirects: {}
    });

    updateSessionState(session.id, {
      pendingQuestion: {
        id: "g1",
        kind: "practice_grouping",
        targetIds: ["task_1", "task_2", "task_3"],
        question: "Do they belong together?",
        practiceId: seededPractices[0].id,
        practiceField: "grouping"
      }
    });

    vi.mocked(proposeProcessChanges).mockResolvedValue(reply());

    await say(session.id, "Yes");

    const afterYes = getSession(session.id)!;

    expect(afterYes.analysis.practices).toHaveLength(1);
    expect(afterYes.analysis.practices[0].activityIds).toHaveLength(3);

    const pending = afterYes.pendingQuestion!;

    expect(pending.kind).toBe("practice_reason");
    expect(pending.practiceField).toBe("combined");
    expect(pending.practiceId).toBe(afterYes.analysis.practices[0].id);
    expect(pending.targetIds.sort()).toEqual(["task_1", "task_2", "task_3"]);

    await say(session.id, "Because the ERP has no supplier prices.");

    const afterAnswer = getSession(session.id)!;

    expect(afterAnswer.analysis.practices[0].facts.reason?.value).toContain(
      "ERP"
    );
    expect(afterAnswer.pendingQuestion?.practiceId).toBeUndefined();
    expect(afterAnswer.analysis.practices).toHaveLength(1);
  });
});
