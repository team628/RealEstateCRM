import { describe, expect, it } from "vitest";
import { DEFAULT_AUTOMATION_LIMITS } from "./automation";
import {
  processEvent,
  type EngineEvent,
  type EnginePorts,
  type RunRecord,
  type WorkflowDef,
} from "./workflow";

function makeEvent(overrides: Partial<EngineEvent> = {}): EngineEvent {
  return {
    id: "evt-1",
    type: "lead.captured",
    orgId: "org-1",
    payload: {},
    depth: 0,
    correlationId: "corr-1",
    occurredAt: "2026-09-11T12:00:00Z",
    ...overrides,
  };
}

function makePorts(overrides: Partial<EnginePorts> = {}) {
  const runs: RunRecord[] = [];
  const executed: string[] = [];
  const ports: EnginePorts = {
    now: () => "2026-09-11T12:00:00Z",
    limits: DEFAULT_AUTOMATION_LIMITS,
    automationsEnabled: () => true,
    findRecentRun: () => null,
    recordRun: (r) => runs.push(r),
    executeAction: async (action) => {
      executed.push(action.type);
    },
    ...overrides,
  };
  return { ports, runs, executed };
}

const followUpWorkflow: WorkflowDef = {
  key: "new_lead_followup",
  trigger: "lead.captured",
  enabled: true,
  actions: [{ type: "create_task", params: { title: "Follow up" } }],
};

describe("processEvent", () => {
  it("runs matching workflows and records success", async () => {
    const { ports, runs, executed } = makePorts();
    const results = await processEvent(makeEvent(), [followUpWorkflow], ports);
    expect(results).toEqual([
      { workflowKey: "new_lead_followup", status: "succeeded", reason: null, actionsExecuted: 1 },
    ]);
    expect(executed).toEqual(["create_task"]);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("succeeded");
  });

  it("ignores non-matching triggers and disabled workflows", async () => {
    const { ports, executed } = makePorts();
    const results = await processEvent(
      makeEvent({ type: "contact.updated" }),
      [followUpWorkflow, { ...followUpWorkflow, key: "disabled", enabled: false }],
      ports,
    );
    expect(results).toEqual([]);
    expect(executed).toEqual([]);
  });

  it("aborts without executing when the kill switch is off (§17)", async () => {
    const { ports, runs, executed } = makePorts({ automationsEnabled: () => false });
    const results = await processEvent(makeEvent(), [followUpWorkflow], ports);
    expect(results[0].status).toBe("aborted");
    expect(results[0].reason).toMatch(/kill switch/);
    expect(executed).toEqual([]);
    expect(runs[0].actionCount).toBe(0);
  });

  it("respects per-workflow overrides", async () => {
    const { ports, executed } = makePorts({
      automationsEnabled: (key) => key !== "new_lead_followup",
    });
    const other: WorkflowDef = { ...followUpWorkflow, key: "other_wf" };
    const results = await processEvent(makeEvent(), [followUpWorkflow, other], ports);
    expect(results.find((r) => r.workflowKey === "new_lead_followup")?.status).toBe("aborted");
    expect(results.find((r) => r.workflowKey === "other_wf")?.status).toBe("succeeded");
    expect(executed).toEqual(["create_task"]);
  });

  it("dedupes replayed events inside the window (§15/§16)", async () => {
    const { ports, executed } = makePorts({
      findRecentRun: () => "2026-09-11T11:59:30Z", // 30s ago < 300s window
    });
    const results = await processEvent(makeEvent(), [followUpWorkflow], ports);
    expect(results[0].status).toBe("aborted");
    expect(results[0].reason).toMatch(/dedup/);
    expect(executed).toEqual([]);
  });

  it("terminates self-triggering workflow chains at max depth (§16 loop protection)", async () => {
    let counter = 0;
    const { ports, runs } = makePorts({
      executeAction: async (_action, event) => {
        counter += 1;
        return [
          {
            id: `evt-loop-${counter}`,
            type: "lead.captured", // emits its own trigger: a deliberate loop
            orgId: event.orgId,
            payload: {},
            depth: 0, // engine overrides with depth+1
            correlationId: event.correlationId,
            occurredAt: "2026-09-11T12:00:00Z",
          },
        ];
      },
    });
    const results = await processEvent(makeEvent(), [followUpWorkflow], ports);
    const aborted = results.filter((r) => r.status === "aborted");
    expect(aborted).toHaveLength(1);
    expect(aborted[0].reason).toMatch(/depth/);
    // runs at depth 0..max_depth execute; the run at max_depth+1 aborts
    expect(runs).toHaveLength(DEFAULT_AUTOMATION_LIMITS.max_depth + 2);
    expect(counter).toBe(DEFAULT_AUTOMATION_LIMITS.max_depth + 1);
  });

  it("stops at the action budget", async () => {
    const manyActions: WorkflowDef = {
      key: "bulk",
      trigger: "lead.captured",
      enabled: true,
      actions: Array.from({ length: 100 }, (_, i) => ({ type: `a${i}`, params: {} })),
    };
    const { ports, executed } = makePorts();
    const results = await processEvent(makeEvent(), [manyActions], ports);
    expect(results[0].status).toBe("failed");
    expect(results[0].reason).toMatch(/budget/);
    expect(executed).toHaveLength(DEFAULT_AUTOMATION_LIMITS.max_actions_per_run);
  });

  it("records a failed run when an action throws, and other workflows still run", async () => {
    const boom: WorkflowDef = {
      key: "boom",
      trigger: "lead.captured",
      enabled: true,
      actions: [{ type: "explode", params: {} }],
    };
    const { ports } = makePorts({
      executeAction: async (action) => {
        if (action.type === "explode") throw new Error("provider unavailable");
      },
    });
    const results = await processEvent(makeEvent(), [boom, followUpWorkflow], ports);
    expect(results.find((r) => r.workflowKey === "boom")?.status).toBe("failed");
    expect(results.find((r) => r.workflowKey === "boom")?.reason).toMatch(/provider unavailable/);
    expect(results.find((r) => r.workflowKey === "new_lead_followup")?.status).toBe("succeeded");
  });
});
