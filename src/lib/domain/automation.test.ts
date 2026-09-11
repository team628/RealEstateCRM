import { describe, expect, it } from "vitest";
import {
  checkActionBudget,
  checkAutomationRun,
  DEFAULT_AUTOMATION_LIMITS,
} from "./automation";

const limits = DEFAULT_AUTOMATION_LIMITS;
const base = {
  depth: 0,
  retryCount: 0,
  lastDuplicateStartedAt: null,
  now: "2026-09-11T12:00:00Z",
};

describe("checkAutomationRun (§16 loop protection)", () => {
  it("allows a normal run", () => {
    expect(checkAutomationRun(limits, base)).toEqual({ allowed: true });
  });
  it("blocks runaway chain depth (automation triggering automation)", () => {
    const verdict = checkAutomationRun(limits, { ...base, depth: limits.max_depth + 1 });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/depth/);
  });
  it("blocks infinite retries", () => {
    const verdict = checkAutomationRun(limits, { ...base, retryCount: limits.max_retries + 1 });
    expect(verdict.allowed).toBe(false);
  });
  it("blocks duplicate runs inside the dedup window", () => {
    const verdict = checkAutomationRun(limits, {
      ...base,
      lastDuplicateStartedAt: "2026-09-11T11:59:00Z", // 60s ago < 300s window
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/dedup/);
  });
  it("allows duplicate runs after the dedup window", () => {
    const verdict = checkAutomationRun(limits, {
      ...base,
      lastDuplicateStartedAt: "2026-09-11T11:00:00Z", // 1h ago
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe("checkActionBudget", () => {
  it("allows actions under the budget and blocks at the cap", () => {
    expect(checkActionBudget(limits, 0).allowed).toBe(true);
    expect(checkActionBudget(limits, limits.max_actions_per_run - 1).allowed).toBe(true);
    expect(checkActionBudget(limits, limits.max_actions_per_run).allowed).toBe(false);
  });
});
