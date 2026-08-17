import { describe, expect, it } from "vitest";
import { generateBpmnXml } from "../src/bpmn.js";
import { createInitialProcess } from "../src/process.js";

describe("BPMN generation", () => {
  it("generates BPMN XML for supported subset", () => {
    const process = createInitialProcess();
    process.elements.push({ id: "task_1", type: "task", name: "Receive order" });
    process.elements.push({ id: "end_1", type: "end", name: "Done" });
    process.flows.push({ id: "flow_1", from: "start_1", to: "task_1" });
    process.flows.push({ id: "flow_2", from: "task_1", to: "end_1" });

    const xml = generateBpmnXml(process);

    expect(xml).toContain("<bpmn:startEvent");
    expect(xml).toContain("<bpmn:task");
    expect(xml).toContain("<bpmn:endEvent");
    expect(xml).toContain("<bpmndi:BPMNDiagram");
  });

  it("escapes XML-sensitive characters", () => {
    const process = createInitialProcess();
    process.elements.push({
      id: "task_1",
      type: "task",
      name: "Check <value> & \"price\""
    });
    process.flows.push({ id: "flow_1", from: "start_1", to: "task_1", condition: "x < y & z > 1" });

    const xml = generateBpmnXml(process);

    expect(xml).toContain("Check &lt;value&gt; &amp; &quot;price&quot;");
    expect(xml).toContain("x &lt; y &amp; z &gt; 1");
  });
});
