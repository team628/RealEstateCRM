// AUTO-001 workflow engine core. Pure and host-agnostic: the same module runs
// in demo mode today and inside a trusted edge function later. Every run passes
// through kill switches (§17) and loop-protection guardrails (§16) BEFORE any
// action executes; every run is recorded (§OPS-002 spirit).
import type { AutomationLimits } from "@/types";
import { checkActionBudget, checkAutomationRun } from "./automation";

export interface WorkflowAction {
  type: string;
  params: Record<string, unknown>;
}

export interface WorkflowDef {
  key: string;
  /** event type that starts this workflow, e.g. 'lead.captured' */
  trigger: string;
  enabled: boolean;
  actions: WorkflowAction[];
}

export interface EngineEvent {
  id: string;
  type: string;
  orgId: string;
  payload: Record<string, unknown>;
  /** 0 for externally-triggered events; +1 each time an automation emits one */
  depth: number;
  correlationId: string;
  occurredAt: string;
}

export interface RunRecord {
  workflowKey: string;
  triggerEvent: string;
  dedupKey: string;
  correlationId: string;
  depth: number;
  actionCount: number;
  status: "succeeded" | "failed" | "aborted";
  reason: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface EnginePorts {
  now(): string;
  limits: AutomationLimits;
  /** OPS-001 kill switches: global automations flag + per-workflow override */
  automationsEnabled(workflowKey: string): boolean;
  /** started_at of the most recent run with this (workflow, dedup key), or null */
  findRecentRun(workflowKey: string, dedupKey: string): string | null;
  recordRun(run: RunRecord): void;
  /**
   * Executes one action. May return follow-up events (depth is assigned by the
   * engine). MUST NOT bypass consent/authorization — in production this is
   * trusted server code.
   */
  executeAction(action: WorkflowAction, event: EngineEvent): Promise<EngineEvent[] | void>;
}

export interface RunResult {
  workflowKey: string;
  status: RunRecord["status"];
  reason: string | null;
  actionsExecuted: number;
}

/**
 * Processes an event through all matching workflows, then recursively processes
 * any events the actions emitted (with depth+1), so runaway chains hit the
 * max_depth guard instead of looping forever.
 */
export async function processEvent(
  event: EngineEvent,
  workflows: WorkflowDef[],
  ports: EnginePorts,
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  const emitted: EngineEvent[] = [];

  for (const workflow of workflows) {
    if (workflow.trigger !== event.type || !workflow.enabled) continue;
    const startedAt = ports.now();
    const dedupKey = `${event.type}:${event.id}`;
    const finish = (status: RunRecord["status"], reason: string | null, actionCount: number) => {
      ports.recordRun({
        workflowKey: workflow.key,
        triggerEvent: event.type,
        dedupKey,
        correlationId: event.correlationId,
        depth: event.depth,
        actionCount,
        status,
        reason,
        startedAt,
        finishedAt: ports.now(),
      });
      results.push({ workflowKey: workflow.key, status, reason, actionsExecuted: actionCount });
    };

    if (!ports.automationsEnabled(workflow.key)) {
      finish("aborted", "automations disabled by kill switch", 0);
      continue;
    }
    const verdict = checkAutomationRun(ports.limits, {
      depth: event.depth,
      retryCount: 0,
      lastDuplicateStartedAt: ports.findRecentRun(workflow.key, dedupKey),
      now: startedAt,
    });
    if (!verdict.allowed) {
      finish("aborted", verdict.reason, 0);
      continue;
    }

    let actionCount = 0;
    let failed: string | null = null;
    for (const action of workflow.actions) {
      const budget = checkActionBudget(ports.limits, actionCount);
      if (!budget.allowed) {
        failed = budget.reason;
        break;
      }
      try {
        const followUps = await ports.executeAction(action, event);
        actionCount += 1;
        if (followUps) {
          for (const f of followUps) {
            emitted.push({ ...f, depth: event.depth + 1, correlationId: event.correlationId });
          }
        }
      } catch (err) {
        failed = err instanceof Error ? err.message : String(err);
        break;
      }
    }
    finish(failed === null ? "succeeded" : "failed", failed, actionCount);
  }

  // Recursively process emitted events; the depth guard terminates cycles.
  for (const next of emitted) {
    results.push(...(await processEvent(next, workflows, ports)));
  }
  return results;
}
