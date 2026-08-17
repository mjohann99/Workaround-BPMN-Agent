import { describe, expect, it } from "vitest";
import { applyProcessChanges, createInitialProcess, ProcessValidationError } from "../src/process.js";
import { fallbackResponse } from "../src/openai.js";

describe("semantic pipeline — process mutation", () => {
  it("TEST 1: multiple atomic tasks and flows connected via tempRef", () => {
    const process = createInitialProcess();

    const result = applyProcessChanges(
      process,
      {
        addElements: [
          { tempRef: "t1", type: "task", name: "Bestellung öffnen", system: "SAP", workaroundCandidate: false },
          { tempRef: "t2", type: "task", name: "Kundendaten prüfen", system: "SAP", workaroundCandidate: false },
          { tempRef: "t3", type: "task", name: "Daten nach Excel exportieren", system: "Excel", workaroundCandidate: true },
          { tempRef: "t4", type: "task", name: "Preise manuell korrigieren", system: "Excel", workaroundCandidate: true },
          { tempRef: "t5", type: "task", name: "Daten in SAP übertragen", system: "SAP", workaroundCandidate: true }
        ],
        updateElements: [{ id: "start_1", name: "Bestellung eingegangen" }],
        removeElementIds: [],
        addFlows: [
          { fromRef: "start_1", toRef: "t1", condition: "" },
          { fromRef: "t1", toRef: "t2", condition: "" },
          { fromRef: "t2", toRef: "t3", condition: "" },
          { fromRef: "t3", toRef: "t4", condition: "" },
          { fromRef: "t4", toRef: "t5", condition: "" }
        ],
        removeFlowIds: [],
        addWorkarounds: [
          {
            tempRef: "wa1",
            relatedActivityRefs: ["t3", "t4", "t5"],
            actualPractice: "Preise außerhalb von SAP in Excel korrigieren",
            obstacleOrMisfit: "Preise können in SAP nicht direkt geändert werden",
            category: "missing_authorization"
          }
        ],
        updateWorkarounds: []
      },
      "Wenn eine Bestellung per E-Mail kommt..."
    );

    // 5 tasks + 1 start = 6 elements
    expect(result.process.elements).toHaveLength(6);
    expect(result.process.flows).toHaveLength(5);

    const start = result.process.elements.find((e) => e.id === "start_1");
    expect(start?.name).toBe("Bestellung eingegangen");

    const t3 = result.process.elements.find((e) => e.type === "task" && e.name === "Daten nach Excel exportieren");
    expect(t3).toBeTruthy();
    expect(t3?.type === "task" ? t3.system : undefined).toBe("Excel");

    // Workaround candidate created with resolved activity IDs
    expect(result.process.workarounds).toHaveLength(1);
    const wc = result.process.workarounds[0];
    expect(wc.status).toBe("suspected");
    expect(wc.relatedActivityIds).toHaveLength(3);
    expect(wc.obstacleOrMisfit).toBe("Preise können in SAP nicht direkt geändert werden");
  });

  it("TEST 2: trigger updates start event, no duplicate task", () => {
    const process = createInitialProcess();

    const result = applyProcessChanges(
      process,
      {
        addElements: [],
        updateElements: [{ id: "start_1", name: "Bestellung eingegangen" }],
        removeElementIds: [],
        addFlows: [],
        removeFlowIds: [],
        addWorkarounds: [],
        updateWorkarounds: []
      },
      "Der Prozess beginnt, wenn eine Bestellung per E-Mail eingeht."
    );

    expect(result.process.elements).toHaveLength(1); // only the updated start
    expect(result.process.elements[0].name).toBe("Bestellung eingegangen");
    expect(result.process.elements[0].type).toBe("start");
  });

  it("TEST 4: exclusive gateway with branches", () => {
    const process = createInitialProcess();

    const result = applyProcessChanges(
      process,
      {
        addElements: [
          { tempRef: "gw1", type: "exclusiveGateway", name: "Kunde vorhanden?", system: "", workaroundCandidate: false },
          { tempRef: "t_create", type: "task", name: "Kunden anlegen", system: "", workaroundCandidate: false }
        ],
        updateElements: [],
        removeElementIds: [],
        addFlows: [
          { fromRef: "start_1", toRef: "gw1", condition: "" },
          { fromRef: "gw1", toRef: "t_create", condition: "Nein" }
        ],
        removeFlowIds: [],
        addWorkarounds: [],
        updateWorkarounds: []
      },
      "Wenn der Kunde nicht existiert, lege ich ihn zuerst an."
    );

    const gateway = result.process.elements.find((e) => e.type === "exclusiveGateway");
    expect(gateway).toBeTruthy();
    expect(gateway?.name).toBe("Kunde vorhanden?");

    const condFlow = result.process.flows.find((f) => f.condition === "Nein");
    expect(condFlow).toBeTruthy();
  });

  it("TEST 5: confirmation via fallbackResponse does not create a task", () => {
    const process = applyProcessChanges(
      createInitialProcess(),
      {
        addElements: [
          {
            id: "task_1",
            type: "task",
            name: "Daten exportieren",
            workaroundCandidate: true
          }
        ],
        updateElements: [],
        removeElementIds: [],
        addFlows: [{ id: "flow_1", from: "start_1", to: "task_1" }],
        removeFlowIds: []
      },
      "export"
    ).process;

    const response = fallbackResponse("Yes", process);
    expect(response.changes.addElements).toHaveLength(0);
    expect(response.changes.updateElements).toHaveLength(1);
    expect(response.changes.updateElements[0].workaroundConfirmed).toBe(true);
  });

  it("TEST 6: rejection via fallbackResponse marks workaround rejected", () => {
    const process = applyProcessChanges(
      createInitialProcess(),
      {
        addElements: [
          {
            id: "task_1",
            type: "task",
            name: "Daten exportieren",
            workaroundCandidate: true
          }
        ],
        updateElements: [],
        removeElementIds: [],
        addFlows: [{ id: "flow_1", from: "start_1", to: "task_1" }],
        removeFlowIds: []
      },
      "export"
    ).process;

    const response = fallbackResponse("no", process);
    expect(response.changes.addElements).toHaveLength(0);
    const upd = response.changes.updateElements[0];
    expect(upd.workaroundCandidate).toBe(false);
    expect(upd.workaroundConfirmed).toBe(false);
  });

  it("TEST 8: metadata enrichment via updateElements does not create duplicate", () => {
    const process = applyProcessChanges(
      createInitialProcess(),
      {
        addElements: [{ id: "task_1", type: "task", name: "Kundendaten prüfen" }],
        updateElements: [],
        removeElementIds: [],
        addFlows: [{ id: "flow_1", from: "start_1", to: "task_1" }],
        removeFlowIds: []
      },
      "prüfe"
    ).process;

    const result = applyProcessChanges(
      process,
      {
        addElements: [],
        updateElements: [{ id: "task_1", system: "SAP" }],
        removeElementIds: [],
        addFlows: [],
        removeFlowIds: []
      },
      "Das mache ich in SAP."
    );

    expect(result.process.elements).toHaveLength(2); // start + task_1 unchanged
    const task = result.process.elements.find((e) => e.id === "task_1");
    expect(task?.type === "task" ? task.system : undefined).toBe("SAP");
  });

  it("TEST 9: end event added without creating a full-sentence task", () => {
    const process = createInitialProcess();

    const result = applyProcessChanges(
      process,
      {
        addElements: [{ tempRef: "end1", type: "end", name: "Bestellung freigegeben", system: "", workaroundCandidate: false }],
        updateElements: [],
        removeElementIds: [],
        addFlows: [{ fromRef: "start_1", toRef: "end1", condition: "" }],
        removeFlowIds: [],
        addWorkarounds: [],
        updateWorkarounds: []
      },
      "Danach ist die Bestellung freigegeben und der Prozess abgeschlossen."
    );

    const end = result.process.elements.find((e) => e.type === "end");
    expect(end).toBeTruthy();
    expect(end?.name).toBe("Bestellung freigegeben");
    const tasks = result.process.elements.filter((e) => e.type === "task");
    expect(tasks).toHaveLength(0);
  });

  it("TEST 10: ambiguous message via fallbackResponse returns safe clarification without mutation", () => {
    const process = createInitialProcess();
    const response = fallbackResponse("Das mache ich dann anders.", process);

    // No activity should be created
    expect(response.changes.addElements).toHaveLength(0);
    expect(response.changes.updateElements).toHaveLength(0);
    expect(response.intent).toBe("unclear");
    expect(response.nextQuestion.required).toBe(true);
  });

  it("TEST 11: fromRef resolves existing element ID (prevents duplication)", () => {
    const process = applyProcessChanges(
      createInitialProcess(),
      {
        addElements: [{ id: "task_1", type: "task", name: "Kunden suchen" }],
        updateElements: [],
        removeElementIds: [],
        addFlows: [{ id: "flow_1", from: "start_1", to: "task_1" }],
        removeFlowIds: []
      },
      "Ich suche den Kunden"
    ).process;

    // New task connecting FROM existing task_1 via fromRef
    const result = applyProcessChanges(
      process,
      {
        addElements: [{ tempRef: "t2", type: "task", name: "Adresse prüfen", system: "SAP", workaroundCandidate: false }],
        updateElements: [{ id: "task_1", system: "SAP" }], // enrich existing instead of duplicate
        removeElementIds: [],
        addFlows: [{ fromRef: "task_1", toRef: "t2", condition: "" }],
        removeFlowIds: [],
        addWorkarounds: [],
        updateWorkarounds: []
      },
      "Danach suche ich den Kunden in SAP und prüfe die Adresse."
    );

    expect(result.process.elements.filter((e) => e.type === "task")).toHaveLength(2);
    expect(result.process.flows).toHaveLength(2);
    const enriched = result.process.elements.find((e) => e.id === "task_1");
    expect(enriched?.type === "task" ? enriched.system : undefined).toBe("SAP");
  });
});
