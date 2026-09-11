// Automation loop-protection guardrails (§16). Pure and unit-tested now; the
// workflow engine (AUTO-001) must call checkAutomationRun before every run and
// respect the returned verdict. Limits come from org_settings.automation_limits.
import type { AutomationLimits } from "@/types";

export const DEFAULT_AUTOMATION_LIMITS: AutomationLimits = {
  max_depth: 5,
  max_actions_per_run: 25,
  max_retries: 3,
  dedup_window_seconds: 300,
  execution_timeout_seconds: 120,
};

export interface RunAttempt {
  /** chain depth: 0 for a directly-triggered run, +1 per automation-caused trigger */
  depth: number;
  retryCount: number;
  /** most recent started_at of a run with the same (workflow, dedup key), if any */
  lastDuplicateStartedAt: string | null;
  now: string;
}

export type RunVerdict = { allowed: true } | { allowed: false; reason: string };

export function checkAutomationRun(limits: AutomationLimits, attempt: RunAttempt): RunVerdict {
  if (attempt.depth > limits.max_depth) {
    return {
      allowed: false,
      reason: `max execution depth exceeded (${attempt.depth} > ${limits.max_depth}) — possible automation loop`,
    };
  }
  if (attempt.retryCount > limits.max_retries) {
    return {
      allowed: false,
      reason: `max retries exceeded (${attempt.retryCount} > ${limits.max_retries})`,
    };
  }
  if (attempt.lastDuplicateStartedAt !== null) {
    const elapsedSeconds =
      (Date.parse(attempt.now) - Date.parse(attempt.lastDuplicateStartedAt)) / 1000;
    if (elapsedSeconds >= 0 && elapsedSeconds < limits.dedup_window_seconds) {
      return {
        allowed: false,
        reason: `duplicate run within dedup window (${Math.round(elapsedSeconds)}s < ${limits.dedup_window_seconds}s)`,
      };
    }
  }
  return { allowed: true };
}

/** Called by the engine before each action within a run. */
export function checkActionBudget(limits: AutomationLimits, actionCount: number): RunVerdict {
  if (actionCount >= limits.max_actions_per_run) {
    return {
      allowed: false,
      reason: `action budget exhausted (${actionCount} >= ${limits.max_actions_per_run})`,
    };
  }
  return { allowed: true };
}
