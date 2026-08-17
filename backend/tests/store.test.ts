import { describe, expect, it, beforeEach } from "vitest";
import { clearSessions, createSession } from "../src/store.js";

describe("session store", () => {
  beforeEach(() => {
    clearSessions();
  });

  it("creates a new interview session with initial assistant question", () => {
    const session = createSession();

    expect(session.id).toBeTruthy();
    expect(session.process.id).toBe("process_main");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe("assistant");
    expect(session.messages[0].content).toContain("What triggers the process?");
  });
});
