import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type ProcessChanges, type ProcessModel } from "./types.js";

type ResearchLogRecord = {
  timestamp: string;
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
  processBefore: ProcessModel;
  proposedChanges: ProcessChanges;
  processAfter: ProcessModel;
};

const logEnabled = (process.env.ENABLE_RESEARCH_LOG ?? "false").toLowerCase() === "true";
const logFile = resolve(process.cwd(), "research-log.jsonl");

export async function logInteraction(record: ResearchLogRecord): Promise<void> {
  if (!logEnabled) {
    return;
  }

  await appendFile(logFile, `${JSON.stringify(record)}\n`, "utf8");
}
