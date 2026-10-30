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

  it("generates an intermediate message catch event", () => {
    const process = createInitialProcess();
    process.elements.push({
      id: "event_message_1",
      type: "intermediateCatchEvent",
      eventDefinitionType: "message",
      name: "Customer order received"
    });

    const xml = generateBpmnXml(process);

    expect(xml).toContain(
      '<bpmn:intermediateCatchEvent id="event_message_1" name="Customer order received">'
    );
    expect(xml).toContain(
      '<bpmn:messageEventDefinition id="event_message_1_messageEventDefinition" />'
    );
  });

  it("generates an attached non-interrupting timer boundary event", () => {
    const process = createInitialProcess();
    process.elements.push({
      id: "task_prepare_order",
      type: "task",
      name: "Prepare order"
    });
    process.elements.push({
      id: "event_order_timeout",
      type: "boundaryEvent",
      name: "Order preparation timeout",
      attachedToRef: "task_prepare_order",
      cancelActivity: false,
      eventDefinitionType: "timer"
    });

    const xml = generateBpmnXml(process);

    expect(xml).toContain(
      '<bpmn:boundaryEvent id="event_order_timeout" name="Order preparation timeout" attachedToRef="task_prepare_order" cancelActivity="false">'
    );
    expect(xml).toContain(
      '<bpmn:timerEventDefinition id="event_order_timeout_timerEventDefinition" />'
    );
  });

  it("uses BPMN's compensateEventDefinition tag", () => {
    const process = createInitialProcess();
    process.elements.push({
      id: "event_compensate_1",
      type: "intermediateThrowEvent",
      name: "Compensation triggered",
      eventDefinitionType: "compensation"
    });

    const xml = generateBpmnXml(process);

    expect(xml).toContain(
      '<bpmn:compensateEventDefinition id="event_compensate_1_compensateEventDefinition" />'
    );
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
