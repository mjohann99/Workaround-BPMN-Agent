import {
  randomUUID
} from "node:crypto";

import {
  type ConformanceRun,
  type DeviationCandidate,
  type DeviationInvestigation,
  type PendingQuestion,
  type PracticeAnswerHint,
  type PracticeCandidate,
  type PracticeEvidence,
  type PracticeField,
  type PracticeGrouping,
  type PracticeHint,
  type ProcessModel
} from "../types.js";

// ======================================================
// WORKAROUND CANDIDATES (GROUPED PRACTICES)
// ======================================================
//
// Observations (activities, technical deviations) stay as
// they are. A practice groups the ones the employee has
// described as one way of working and owns the shared
// answers. Adjacency, similar wording or a shared lane
// never decide membership: only conversation evidence does.
// ======================================================

export const PRACTICE_FIELDS: PracticeField[] = [
  "reason",
  "sinceWhen",
  "frequency"
];

// A field that stays unanswered after this many asks is given up.
export const MAX_ASKS_PER_FIELD = 2;

const UNKNOWN_ANSWER =
  /\b(?:i\s+(?:do\s*n['\u2019]?t|do\s+not)\s+know|no\s+idea|not\s+sure|can(?:not|['\u2019]?t)\s+(?:say|remember|recall)|have\s+no\s+clue|keine\s+ahnung|wei(?:\u00df|ss)\s+(?:ich\s+)?nicht)\b/i;

const MAX_LISTED = 4;

// ======================================================
// STATE HELPERS
// ======================================================

export function missingPracticeFields(
  practice: PracticeCandidate
): PracticeField[] {
  return PRACTICE_FIELDS.filter(
    (field) =>
      !practice.facts[field] &&
      (practice.asked[field] ?? 0) <
      MAX_ASKS_PER_FIELD
  );
}

export function isPracticeComplete(
  practice: PracticeCandidate
): boolean {
  return missingPracticeFields(practice).length === 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

function pairKey(
  a: string,
  b: string
): string {
  return [a, b].sort().join("|");
}

function setKey(
  ids: string[]
): string {
  return [...new Set(ids)].sort().join("|");
}

function newPractice(
  activityIds: string[],
  deviationIds: string[]
): PracticeCandidate {
  const timestamp = nowIso();

  return {
    id: randomUUID(),
    deviationIds: [...deviationIds],
    activityIds: [...new Set(activityIds)],
    facts: {},
    activityFacts: [],
    evidence: [],
    groupingBasis: [],
    asked: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createEvidence(
  excerpt: string,
  messageId?: string
): PracticeEvidence {
  return {
    // One record per chat message, so reprocessing never duplicates it.
    id: messageId ? `ev_${messageId}` : randomUUID(),
    ...(messageId ? { messageId } : {}),
    excerpt,
    recordedAt: nowIso()
  };
}

function addEvidence(
  list: PracticeEvidence[],
  evidence: PracticeEvidence
): void {
  if (!list.some((item) => item.id === evidence.id)) {
    list.push(evidence);
  }
}

// ======================================================
// DEVIATION ELIGIBILITY (EXISTING POLICY)
// ======================================================
//
// - the reference process selection must be stable
// - reviewed deviations are finished
// - a missing reference activity only counts after a complete
//   alignment
// ======================================================

export function isDeviationEligible(
  deviation: DeviationCandidate,
  conformanceRuns: ConformanceRun[],
  referenceStable: boolean
): boolean {
  if (
    !referenceStable ||
    deviation.status === "reviewed"
  ) {
    return false;
  }

  if (deviation.moveType === "model_move") {
    const sourceRun =
      conformanceRuns.find(
        (run) =>
          run.id === deviation.sourceConformanceRunId
      );

    return (
      sourceRun?.complete === true &&
      sourceRun.method === "alignment"
    );
  }

  return true;
}

// ======================================================
// SYNC WITH TECHNICAL DEVIATIONS
// ======================================================
//
// Every eligible deviation belongs to exactly one practice.
// A deviation joins the practice that already contains one of
// its activities, otherwise it starts a candidate. A candidate
// is only a container: it does not claim a purpose.
// ======================================================

export function syncPractices(
  practices: PracticeCandidate[],
  deviations: DeviationCandidate[],
  eligibleDeviationIds: Set<string>
): PracticeCandidate[] {
  const result = structuredClone(practices);
  const known = new Set(deviations.map((deviation) => deviation.id));

  for (const practice of result) {
    practice.deviationIds =
      practice.deviationIds.filter((id) => known.has(id));
  }

  for (const deviation of deviations) {
    if (
      !eligibleDeviationIds.has(deviation.id) ||
      result.some((practice) =>
        practice.deviationIds.includes(deviation.id)
      )
    ) {
      continue;
    }

    const target =
      result.find((practice) =>
        deviation.actualActivityIds.some((id) =>
          practice.activityIds.includes(id)
        )
      );

    if (target) {
      target.deviationIds.push(deviation.id);
      target.activityIds = [
        ...new Set([
          ...target.activityIds,
          ...deviation.actualActivityIds
        ])
      ];
      target.updatedAt = nowIso();
    } else {
      result.push(
        newPractice(
          deviation.actualActivityIds,
          [deviation.id]
        )
      );
    }
  }

  return result.filter(
    (practice) =>
      practice.deviationIds.length > 0 ||
      Object.keys(practice.facts).length > 0 ||
      practice.activityFacts.length > 0 ||
      practice.groupingBasis.length > 0
  );
}

// ======================================================
// MERGE / SPLIT (EVIDENCE IS NEVER DROPPED)
// ======================================================

function mergePractices(
  keep: PracticeCandidate,
  other: PracticeCandidate
): void {
  keep.deviationIds = [
    ...new Set([...keep.deviationIds, ...other.deviationIds])
  ];
  keep.activityIds = [
    ...new Set([...keep.activityIds, ...other.activityIds])
  ];

  for (const field of PRACTICE_FIELDS) {
    keep.asked[field] = Math.max(
      keep.asked[field] ?? 0,
      other.asked[field] ?? 0
    );

    const fact = other.facts[field];

    if (!fact) {
      continue;
    }

    if (!keep.facts[field]) {
      keep.facts[field] = fact;
    } else {
      keep.activityFacts.push({ ...fact, field, scope: "activities" });
    }
  }

  keep.activityFacts.push(...other.activityFacts);

  for (const evidence of [...other.evidence]) {
    addEvidence(keep.evidence, evidence);
  }

  for (const evidence of other.groupingBasis) {
    addEvidence(keep.groupingBasis, evidence);
  }

  keep.updatedAt = nowIso();
}

function splitActivity(
  practices: PracticeCandidate[],
  practice: PracticeCandidate,
  activityId: string,
  deviations: DeviationCandidate[]
): PracticeCandidate {
  const moved =
    deviations
      .filter(
        (deviation) =>
          practice.deviationIds.includes(deviation.id) &&
          deviation.actualActivityIds.length > 0 &&
          deviation.actualActivityIds.every(
            (id) => id === activityId
          )
      )
      .map((deviation) => deviation.id);

  practice.activityIds =
    practice.activityIds.filter((id) => id !== activityId);
  practice.deviationIds =
    practice.deviationIds.filter((id) => !moved.includes(id));
  practice.updatedAt = nowIso();

  const split = newPractice([activityId], moved);

  // Limited-scope answers and their evidence follow the activity.
  for (const fact of practice.activityFacts) {
    if (
      fact.activityIds.length === 1 &&
      fact.activityIds[0] === activityId
    ) {
      split.activityFacts.push(structuredClone(fact));

      const evidence =
        practice.evidence.find(
          (item) => item.id === fact.evidenceId
        );

      if (evidence) {
        addEvidence(split.evidence, evidence);
      }
    }
  }

  practices.push(split);

  return split;
}

// ======================================================
// CONVERSATION HINTS
// ======================================================

export type HintContext = {
  process: ProcessModel;

  /** tempRefs created in the same turn -> final element IDs. */
  refToId: Record<string, string>;

  deviations: DeviationCandidate[];

  evidence: PracticeEvidence;
};

function resolveActivities(
  refs: string[],
  context: Pick<HintContext, "process" | "refToId">
): string[] {
  const tasks =
    new Set(
      context.process.elements
        .filter((element) => element.type === "task")
        .map((element) => element.id)
    );

  return [
    ...new Set(
      refs
        .map((ref) => context.refToId[ref] ?? ref)
        .filter((id) => tasks.has(id))
    )
  ];
}

function findPractice(
  practices: PracticeCandidate[],
  id: string | undefined,
  redirects: Record<string, string>,
  activityIds: string[]
): PracticeCandidate | undefined {
  let resolved = id;
  const seen = new Set<string>();

  while (resolved && redirects[resolved] && !seen.has(resolved)) {
    seen.add(resolved);
    resolved = redirects[resolved];
  }

  return (
    practices.find((practice) => practice.id === resolved) ??
    practices.find((practice) =>
      activityIds.some((activity) =>
        practice.activityIds.includes(activity)
      )
    )
  );
}

export function applyPracticeHints(
  practices: PracticeCandidate[],
  grouping: PracticeGrouping,
  hints: PracticeHint[],
  context: HintContext
): { practices: PracticeCandidate[]; grouping: PracticeGrouping } {
  let result = structuredClone(practices);
  const decisions = structuredClone(grouping);
  decisions.redirects ??= {};

  for (const hint of hints) {
    const ids = resolveActivities(hint.activityRefs, context);

    if (hint.relation === "independent") {
      for (const id of ids) {
        const owner =
          result.find(
            (practice) =>
              practice.activityIds.includes(id) &&
              practice.activityIds.length > 1
          );

        if (owner) {
          splitActivity(result, owner, id, context.deviations);
        }
      }

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = pairKey(ids[i], ids[j]);

          if (!decisions.independentPairs.includes(key)) {
            decisions.independentPairs.push(key);
          }
        }
      }

      continue;
    }

    // A grouping needs the shared purpose, obstacle or cause behind it.
    if (!hint.basis?.trim()) {
      continue;
    }

    const requested =
      hint.extendsPracticeId
        ? findPractice(
          result,
          hint.extendsPracticeId,
          decisions.redirects,
          []
        )
        : undefined;

    const holders =
      result.filter((practice) =>
        ids.some((id) => practice.activityIds.includes(id))
      );

    // The most established candidate survives so its identity stays stable.
    let target =
      requested ??
      [...holders].sort(
        (a, b) =>
          Object.keys(b.facts).length -
          Object.keys(a.facts).length ||
          a.createdAt.localeCompare(b.createdAt)
      )[0];

    if (!target && ids.length >= 2) {
      target = newPractice(ids, []);
      result.push(target);
    }

    if (!target) {
      continue;
    }

    for (const holder of holders) {
      if (holder.id !== target.id) {
        mergePractices(target, holder);
        decisions.redirects[holder.id] = target.id;
        result = result.filter((practice) => practice.id !== holder.id);
      }
    }

    target.activityIds = [
      ...new Set([...target.activityIds, ...ids])
    ];

    // Deviations of the newly joined activities belong here too.
    for (const deviation of context.deviations) {
      if (
        !target.deviationIds.includes(deviation.id) &&
        deviation.actualActivityIds.some((id) => ids.includes(id)) &&
        !result.some(
          (practice) =>
            practice.id !== target.id &&
            practice.deviationIds.includes(deviation.id)
        )
      ) {
        target.deviationIds.push(deviation.id);
      }
    }

    addEvidence(target.groupingBasis, {
      ...context.evidence,
      excerpt: `${hint.basis.trim()} \u2014 "${context.evidence.excerpt}"`
    });
    target.updatedAt = nowIso();

    decisions.independentPairs =
      decisions.independentPairs.filter((pair) => {
        const [a, b] = pair.split("|");

        return !(
          target.activityIds.includes(a) &&
          target.activityIds.includes(b)
        );
      });
  }

  return { practices: result, grouping: decisions };
}

// ======================================================
// ANSWERS WITH EVIDENCE AND SCOPE
// ======================================================

export function isUnknownAnswer(
  message: string
): boolean {
  return (
    UNKNOWN_ANSWER.test(message) &&
    message.trim().split(/\s+/).length <= 8
  );
}

/** Whole message as the answer, used when the model returned none. */
export function fallbackPracticeAnswer(
  message: string,
  pending: Pick<PendingQuestion, "practiceId" | "practiceField">
): PracticeAnswerHint | undefined {
  if (
    !pending.practiceId ||
    !pending.practiceField ||
    pending.practiceField === "grouping"
  ) {
    return undefined;
  }

  return {
    practiceId: pending.practiceId,
    // A combined answer is stored as the purpose; the model reports finer fields.
    field:
      pending.practiceField === "combined"
        ? "reason"
        : pending.practiceField,
    scope: "practice",
    activityRefs: [],
    unknown: isUnknownAnswer(message),
    value: message
  };
}

const AFFIRMATIVE =
  /^(?:yes|yeah|yep|correct|exactly|right|sure|that'?s right|ja|stimmt|genau|richtig)\b/i;

const NEGATIVE =
  /^(?:no|nope|nein|they are separate|they're separate|separate)\b/i;

/**
 * The employee's reply to the grouping question decides membership for
 * the whole proposed set. The model's own hints win when they carry a
 * stated basis or an explicit separation.
 */
export function groupingHintsForAnswer(
  hints: PracticeHint[],
  message: string,
  pending: Pick<PendingQuestion, "kind" | "targetIds"> | undefined
): PracticeHint[] {
  if (pending?.kind !== "practice_grouping") {
    return hints;
  }

  const stated =
    hints.filter(
      (hint) =>
        hint.relation === "independent" || hint.basis?.trim()
    );

  if (stated.length > 0 || pending.targetIds.length < 2) {
    return stated;
  }

  const text = message.trim();

  if (AFFIRMATIVE.test(text)) {
    return [
      {
        activityRefs: pending.targetIds,
        relation: "same_practice",
        basis: "Employee confirmed the proposed grouping"
      }
    ];
  }

  if (NEGATIVE.test(text)) {
    return [
      {
        activityRefs: pending.targetIds,
        relation: "independent"
      }
    ];
  }

  return [];
}

export function recordPracticeAnswers(
  practices: PracticeCandidate[],
  answers: PracticeAnswerHint[],
  context: Pick<HintContext, "process" | "refToId" | "evidence">,
  pending?: Pick<
    PendingQuestion,
    "practiceId" | "practiceField" | "targetIds"
  >,
  options: {
    redirects?: Record<string, string>;

    /** Skip answers scoped to activities that do not exist yet. */
    deferUnresolved?: boolean;
  } = {}
): PracticeCandidate[] {
  const result = structuredClone(practices);

  for (const answer of answers) {
    const activityIds =
      resolveActivities(answer.activityRefs ?? [], context);

    if (
      options.deferUnresolved &&
      answer.scope === "activities" &&
      activityIds.length < (answer.activityRefs ?? []).length
    ) {
      continue;
    }

    // Pending question first: the model's practiceId may be stale after a merge.
    const practice =
      findPractice(
        result,
        answer.practiceId ?? pending?.practiceId ?? undefined,
        options.redirects ?? {},
        [...activityIds, ...(pending?.targetIds ?? [])]
      );

    const unknown = answer.unknown === true;
    const value = answer.value?.trim();

    if (!practice || (!unknown && !value)) {
      continue;
    }

    const status = unknown ? "unknown" : "answered";
    const timestamp = nowIso();

    addEvidence(practice.evidence, context.evidence);

    if (answer.scope === "activities") {
      // Unresolvable activities keep the answer as a partial explanation.
      const covered =
        activityIds.filter((id) => practice.activityIds.includes(id));

      const key = setKey(covered);

      practice.activityFacts =
        practice.activityFacts.filter(
          (fact) =>
            !(
              fact.field === answer.field &&
              setKey(fact.activityIds) === key
            )
        );

      practice.activityFacts.push({
        field: answer.field,
        status,
        ...(value && !unknown ? { value } : {}),
        scope: "activities",
        activityIds: covered,
        evidenceId: context.evidence.id,
        recordedAt: timestamp
      });
    } else {
      const existing = practice.facts[answer.field];

      // "I don't know" never overwrites a real answer.
      if (unknown && existing?.status === "answered") {
        continue;
      }

      practice.facts[answer.field] = {
        status,
        ...(value && !unknown ? { value } : {}),
        scope: "practice",
        activityIds: [...practice.activityIds],
        evidenceId: context.evidence.id,
        recordedAt: timestamp
      };
    }

    practice.updatedAt = timestamp;
  }

  return result;
}

// ======================================================
// SEQUENCE TEXT
// ======================================================

function elementOrder(
  process: ProcessModel,
  id: string
): number {
  const index =
    process.elements.findIndex((element) => element.id === id);

  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function nameOf(
  process: ProcessModel,
  id: string
): string {
  return (
    process.elements.find((element) => element.id === id)?.name ??
    id
  );
}

function listNames(
  ids: string[],
  process: ProcessModel
): string {
  const names =
    [...ids]
      .sort(
        (a, b) =>
          elementOrder(process, a) - elementOrder(process, b)
      )
      .map((id) => `"${nameOf(process, id)}"`);

  const shown = names.slice(0, MAX_LISTED);
  const rest = names.length - shown.length;

  if (shown.length === 0) {
    return "";
  }

  const list =
    shown.length === 1
      ? shown[0]
      : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;

  return rest > 0 ? `${list} and ${rest} more` : list;
}

export function sequenceText(
  practice: PracticeCandidate,
  process: ProcessModel
): string {
  return (
    listNames(practice.activityIds, process) ||
    "this part of the process"
  );
}

// ======================================================
// FOLLOW-UP SCHEDULING
// ======================================================

export type PracticeQuestion = {
  kind: PendingQuestion["kind"];

  practiceId: string;

  field: PracticeField | "grouping" | "combined";

  question: string;

  targetIds: string[];
};

const FIELD_KIND: Record<
  PracticeField,
  PendingQuestion["kind"]
> = {
  reason: "practice_reason",
  sinceWhen: "practice_since",
  frequency: "practice_frequency"
};

function questionFor(
  field: PracticeField,
  practice: PracticeCandidate,
  process: ProcessModel
): string {
  const steps = sequenceText(practice, process);
  const attempt = practice.asked[field] ?? 0;

  // An answer that explained only some activities is acknowledged, not re-asked.
  const partial =
    practice.activityFacts.filter(
      (fact) =>
        fact.field === field && fact.status === "answered"
    );

  if (partial.length > 0 && field === "reason") {
    const explained =
      listNames(
        [...new Set(partial.flatMap((fact) => fact.activityIds))],
        process
      );

    const lead =
      explained
        ? `Thanks, that explains ${explained}.`
        : "Thanks, that helps.";

    return `${lead} What is the shared purpose behind ${steps} together?`;
  }

  // A repeated ask is worded differently from the first.
  if (attempt > 0) {
    switch (field) {
      case "reason":
        return `To understand the context of ${steps}: what led to handling it this way?`;

      case "sinceWhen":
        return `Roughly when did ${steps} start to be handled this way?`;

      case "frequency":
        return `About how often does ${steps} come up?`;
    }
  }

  switch (field) {
    case "reason":
      return `Regarding ${steps}: what is the purpose of doing it this way?`;

    case "sinceWhen":
      return `Regarding ${steps}: since when has it been done this way?`;

    case "frequency":
      return `Regarding ${steps}: how often does this happen?`;
  }
}

// Enough surrounding context exists once something follows the practice.
function contextReady(
  practice: PracticeCandidate,
  process: ProcessModel
): boolean {
  if (
    Object.keys(practice.facts).length > 0 ||
    process.status !== "eliciting" ||
    practice.activityIds.length === 0
  ) {
    return true;
  }

  return practice.activityIds.every(
    (id) =>
      process.flows.some((flow) => flow.from === id)
  );
}

function connected(
  a: PracticeCandidate,
  b: PracticeCandidate,
  process: ProcessModel
): boolean {
  return process.flows.some(
    (flow) =>
      (a.activityIds.includes(flow.from) &&
        b.activityIds.includes(flow.to)) ||
      (b.activityIds.includes(flow.from) &&
        a.activityIds.includes(flow.to))
  );
}

function firstIndex(
  practice: PracticeCandidate,
  process: ProcessModel
): number {
  return Math.min(
    ...practice.activityIds.map((id) => elementOrder(process, id)),
    Number.MAX_SAFE_INTEGER
  );
}

export type ScheduleInput = {
  practices: PracticeCandidate[];
  grouping: PracticeGrouping;
  deviations: DeviationCandidate[];
  process: ProcessModel;
};

export type ScheduleResult = {
  question?: PracticeQuestion;
  practices: PracticeCandidate[];
  grouping: PracticeGrouping;
};

/**
 * Chooses the next question about a shared practice. Answers
 * already on record are never asked again, and a newly added
 * activity does not restart the questionnaire.
 */
export function choosePracticeQuestion(
  input: ScheduleInput
): ScheduleResult {
  const practices = structuredClone(input.practices);
  const grouping = structuredClone(input.grouping);
  const { process, deviations } = input;

  const open =
    new Set(
      deviations
        .filter((deviation) => deviation.status !== "reviewed")
        .map((deviation) => deviation.id)
    );

  const active =
    practices
      .filter((practice) =>
        practice.deviationIds.some((id) => open.has(id))
      )
      .sort(
        (a, b) =>
          firstIndex(a, process) - firstIndex(b, process)
      );

  const ready =
    active.filter((practice) => contextReady(practice, process));

  // ----------------------------------------------------
  // GROUP MEMBERSHIP: one question per connected set of
  // observations, never per pair
  // ----------------------------------------------------

  const parent = ready.map((_, index) => index);

  const root = (index: number): number => {
    while (parent[index] !== index) {
      index = parent[index];
    }

    return index;
  };

  const crossIndependent = (
    a: PracticeCandidate,
    b: PracticeCandidate
  ) =>
    a.activityIds.some((x) =>
      b.activityIds.some((y) =>
        grouping.independentPairs.includes(pairKey(x, y))
      )
    );

  for (let i = 0; i < ready.length; i++) {
    for (let j = i + 1; j < ready.length; j++) {
      if (
        connected(ready[i], ready[j], process) &&
        !crossIndependent(ready[i], ready[j])
      ) {
        parent[root(j)] = root(i);
      }
    }
  }

  const components = new Map<number, PracticeCandidate[]>();

  ready.forEach((practice, index) => {
    const key = root(index);

    components.set(key, [...(components.get(key) ?? []), practice]);
  });

  for (const members of components.values()) {
    if (
      members.length < 2 ||
      members.every((member) => isPracticeComplete(member))
    ) {
      continue;
    }

    const union = [
      ...new Set(members.flatMap((member) => member.activityIds))
    ];

    const asked =
      grouping.askedSets.some((key) =>
        union.every((id) => key.split("|").includes(id))
      );

    if (asked) {
      continue;
    }

    grouping.askedSets.push(setKey(union));

    return {
      question: {
        kind: "practice_grouping",
        practiceId: members[0].id,
        field: "grouping",
        question:
          `${listNames(union, process)} seem to be connected. Do they belong together as one way of working with a shared purpose? If some of them are separate, please tell me which.`,
        targetIds: union
      },
      practices,
      grouping
    };
  }

  // ----------------------------------------------------
  // SHARED FOLLOW-UPS: only what is still missing
  // ----------------------------------------------------

  for (const practice of ready) {
    const missing = missingPracticeFields(practice);
    const field = missing[0];

    if (!field) {
      continue;
    }

    // Nothing asked yet: one question covers purpose, onset and frequency.
    if (
      missing.length === PRACTICE_FIELDS.length &&
      PRACTICE_FIELDS.every((name) => !practice.asked[name])
    ) {
      practice.asked.reason = 1;
      practice.asked.sinceWhen = MAX_ASKS_PER_FIELD;
      practice.asked.frequency = MAX_ASKS_PER_FIELD;

      return {
        question: {
          kind: FIELD_KIND.reason,
          practiceId: practice.id,
          field: "combined",
          question:
            `Regarding ${sequenceText(practice, process)}: what is the purpose of handling it this way, since when has it been done like this, and how often does it happen?`,
          targetIds: [...practice.activityIds]
        },
        practices,
        grouping
      };
    }

    // The question is built before the counter moves so wording follows the attempt.
    const question = questionFor(field, practice, process);

    practice.asked[field] = (practice.asked[field] ?? 0) + 1;

    return {
      question: {
        kind: FIELD_KIND[field],
        practiceId: practice.id,
        field,
        question,
        targetIds: [...practice.activityIds]
      },
      practices,
      grouping
    };
  }

  return { practices, grouping };
}

// ======================================================
// CONTEXT FOR THE MODEL
// ======================================================

export function describePracticesForModel(
  practices: PracticeCandidate[],
  process: ProcessModel
): string | undefined {
  const lines =
    practices
      .filter((practice) => practice.activityIds.length > 0)
      .map((practice) => {
        const missing = missingPracticeFields(practice);

        return `- practice ${practice.id}: activities ${practice.activityIds
          .map((id) => `${id} ("${nameOf(process, id)}")`)
          .join(", ")}; still missing: ${missing.length > 0 ? missing.join(", ") : "nothing"}`;
      });

  return lines.length > 0
    ? `Known practices (groups of activities that belong together):\n${lines.join("\n")}`
    : undefined;
}

// ======================================================
// OWNER VIEW: SHARED ANSWERS PER DEVIATION
// ======================================================
//
// The existing owner screen shows one "investigation" per
// deviation. It is derived from the practice so every deviation
// of a practice shows the same shared answers.
// ======================================================

export function practiceInvestigations(
  practices: PracticeCandidate[],
  deviations: DeviationCandidate[]
): DeviationInvestigation[] {
  return practices.flatMap((practice) =>
    practice.deviationIds
      .filter((id) =>
        deviations.some((deviation) => deviation.id === id)
      )
      .map((deviationId) => {
        const text = (field: PracticeField) => {
          const fact = practice.facts[field];

          return fact
            ? fact.status === "unknown"
              ? "Not known"
              : fact.value
            : undefined;
        };

        return {
          id: `${practice.id}:${deviationId}`,
          deviationId,
          facts: {
            reason: text("reason"),
            sinceWhen: text("sinceWhen"),
            frequency: text("frequency")
          },
          missingFields: missingPracticeFields(practice),
          status:
            isPracticeComplete(practice)
              ? "complete"
              : "open"
        } satisfies DeviationInvestigation;
      })
  );
}
