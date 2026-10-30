/**
 * Development-only smoke test for the acceptance scenario.
 * Run with:  npm.cmd run eval:process-input
 * Requires OPENAI_API_KEY in environment.
 */
import { createInitialProcess } from "./process.js";
import { proposeProcessChanges } from "./openai.js";
import type { ChatMessage } from "./types.js";

const ACCEPTANCE_INPUT =
  "Wenn eine Bestellung per E-Mail kommt, öffne ich sie in SAP, prüfe die " +
  "Kundendaten, exportiere danach die Daten nach Excel, korrigiere die Preise " +
  "dort manuell und übertrage die korrigierten Daten wieder zurück nach SAP, " +
  "weil ich die Preise in SAP nicht direkt ändern kann.";

const messages: ChatMessage[] = [
  {
    id: "msg_0",
    role: "assistant",
    content: "What usually triggers this process?",
    timestamp: new Date().toISOString()
  }
];

async function run(): Promise<void> {
  console.log("=== ACCEPTANCE SMOKE TEST ===");
  console.log("Input:", ACCEPTANCE_INPUT);
  console.log("");

  const processModel = createInitialProcess("Bestellungsbearbeitung");

  const result = await proposeProcessChanges({
    userMessage: ACCEPTANCE_INPUT,
    messages,
    processModel,
    elicitationPhase: "main_flow"
  });

  const r = result as any;

  console.log("=== LANGUAGE ===");
  console.log(r.language ?? "(not returned)");

  console.log("\n=== INTENT ===");
  console.log(r.intent ?? "(not returned)");

  console.log("\n=== TRIGGER (contextPatch) ===");
  console.log(r.contextPatch?.trigger ?? "(none)");

  console.log("\n=== ACTIVITIES (addElements) ===");
  const elements: any[] = result.changes.addElements;
  if (!elements.length) {
    console.log("(none)");
  } else {
    elements.forEach((el: any, i: number) => {
      const sys = el.system ? ` [${el.system}]` : "";
      const wc = el.workaroundCandidate ? " [workaround candidate]" : "";
      console.log(`  ${i + 1}. [${el.type}] ${el.name}${sys}${wc}  (tempRef: ${el.tempRef ?? el.id})`);
    });
  }

  console.log("\n=== UPDATE ELEMENTS ===");
  const updates: any[] = result.changes.updateElements;
  if (!updates.length) {
    console.log("(none)");
  } else {
    updates.forEach((u: any) => {
      console.log(`  id:${u.id}  name:${u.name ?? "(unchanged)"}  system:${u.system ?? "(unchanged)"}`);
    });
  }

  console.log("\n=== FLOWS (addFlows) ===");
  const flows: any[] = result.changes.addFlows;
  if (!flows.length) {
    console.log("(none)");
  } else {
    flows.forEach((f: any) => {
      const cond = f.condition ? ` [${f.condition}]` : "";
      console.log(`  ${f.fromRef ?? f.from} → ${f.toRef ?? f.to}${cond}`);
    });
  }

  console.log("\n=== WORKAROUND CANDIDATES (addWorkarounds) ===");
  const workarounds: any[] = result.changes.addWorkarounds;
  if (!workarounds.length) {
    console.log("(none)");
  } else {
    workarounds.forEach((w: any) => {
      console.log(`  tempRef: ${w.tempRef}`);
      console.log(`  actualPractice: ${w.actualPractice}`);
      console.log(`  obstacleOrMisfit: ${w.obstacleOrMisfit ?? "(unknown)"}`);
      console.log(`  category: ${w.category ?? "(unknown)"}`);
      console.log(`  relatedActivityRefs: ${(w.relatedActivityRefs ?? []).join(", ")}`);
    });
  }

  console.log("\n=== UNCERTAINTIES ===");
  if (!result.uncertainties.length) {
    console.log("(none)");
  } else {
    result.uncertainties.forEach((u: any) => {
      console.log(`  [${u.type}] ${u.description}`);
    });
  }

  console.log("\n=== NEXT QUESTION ===");
  console.log(result.nextQuestion);

  console.log("\n=== ASSISTANT MESSAGE ===");
  console.log(result.assistantMessage);
}

run().catch((error) => {
  console.error("Eval failed:", error);
  process.exit(1);
});
