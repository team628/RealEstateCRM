import { describe, expect, it } from "vitest";
import { drainOutbox } from "./drain";
import type { MessageAdapter, OutboundMessage, SendResult } from "./types";

const row = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  id: "m1",
  org_id: "org-1",
  contact_id: "c1",
  channel: "email",
  to: "jane@example.com",
  subject: "Hello",
  body: "Hi there",
  idempotency_key: "key-00000001",
  retry_count: 0,
  ...overrides,
});

function adapterReturning(result: SendResult | Error): { adapter: MessageAdapter; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    adapter: {
      provider: "fake",
      channel: "email",
      async send(message) {
        calls.push(message.id);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

const ctx = { channelEnabled: () => true, maxRetries: 3 };

describe("drainOutbox (COMM-001)", () => {
  it("marks successful sends with the provider id", async () => {
    const { adapter } = adapterReturning({ ok: true, providerMessageId: "prov-9" });
    const result = await drainOutbox([row()], adapter, ctx);
    expect(result).toEqual([{ id: "m1", outcome: "sent", providerMessageId: "prov-9" }]);
  });

  it("re-checks the kill switch at send time and never calls the adapter (§17)", async () => {
    const { adapter, calls } = adapterReturning({ ok: true, providerMessageId: "x" });
    const result = await drainOutbox([row()], adapter, {
      ...ctx,
      channelEnabled: () => false,
    });
    expect(result[0].outcome).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("schedules bounded retries for transient failures (§16)", async () => {
    const { adapter } = adapterReturning({ ok: false, error: "rate limited", retryable: true });
    const first = await drainOutbox([row()], adapter, ctx);
    expect(first[0]).toEqual({ id: "m1", outcome: "retry", retryCount: 1, reason: "rate limited" });
    const exhausted = await drainOutbox([row({ retry_count: 3 })], adapter, ctx);
    expect(exhausted[0].outcome).toBe("failed");
    if (exhausted[0].outcome === "failed") {
      expect(exhausted[0].reason).toMatch(/retries exhausted/);
    }
  });

  it("fails terminally on non-retryable errors without burning retries", async () => {
    const { adapter } = adapterReturning({ ok: false, error: "invalid address", retryable: false });
    const result = await drainOutbox([row()], adapter, ctx);
    expect(result[0]).toEqual({ id: "m1", outcome: "failed", reason: "invalid address" });
  });

  it("treats adapter crashes as transient and keeps draining other rows", async () => {
    const { adapter } = adapterReturning(new Error("socket hang up"));
    const result = await drainOutbox([row(), row({ id: "m2" })], adapter, ctx);
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.outcome === "retry")).toBe(true);
  });

  it("skips rows for a different channel", async () => {
    const { adapter, calls } = adapterReturning({ ok: true, providerMessageId: "x" });
    const result = await drainOutbox([row({ channel: "sms" })], adapter, ctx);
    expect(result[0].outcome).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("returns a disposition for every row — nothing is dropped", async () => {
    const { adapter } = adapterReturning({ ok: true, providerMessageId: "x" });
    const rows = [row(), row({ id: "m2" }), row({ id: "m3", channel: "sms" })];
    const result = await drainOutbox(rows, adapter, ctx);
    expect(result.map((d) => d.id)).toEqual(["m1", "m2", "m3"]);
  });
});
