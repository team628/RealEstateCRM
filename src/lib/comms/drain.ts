// COMM-001 outbox drain engine. Pure and host-agnostic: in production a
// scheduled edge function loads queued rows, calls drainOutbox with the real
// adapter, and applies the returned dispositions inside a transaction.
// Guarantees: kill switch re-checked at send time (§17), bounded retries
// (§16), one adapter call per row per run, and an explicit disposition for
// every row — nothing is dropped silently.
import type { MessageAdapter, OutboundMessage } from "./types";

export interface DrainContext {
  /** OPS-001 kill switch for the adapter's channel, evaluated per org at send time */
  channelEnabled(orgId: string): boolean;
  maxRetries: number;
}

export type Disposition =
  | { id: string; outcome: "sent"; providerMessageId: string }
  | { id: string; outcome: "retry"; retryCount: number; reason: string }
  | { id: string; outcome: "failed"; reason: string }
  | { id: string; outcome: "skipped"; reason: string };

export async function drainOutbox(
  rows: OutboundMessage[],
  adapter: MessageAdapter,
  ctx: DrainContext,
): Promise<Disposition[]> {
  const dispositions: Disposition[] = [];
  for (const row of rows) {
    if (row.channel !== adapter.channel) {
      dispositions.push({ id: row.id, outcome: "skipped", reason: "channel mismatch" });
      continue;
    }
    if (!ctx.channelEnabled(row.org_id)) {
      // Not a failure: the org pulled the kill switch after queueing. The row
      // stays queued and sends when (if) the switch comes back on.
      dispositions.push({ id: row.id, outcome: "skipped", reason: "channel disabled by kill switch" });
      continue;
    }
    let result;
    try {
      result = await adapter.send(row);
    } catch (err) {
      result = {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        retryable: true, // an adapter crash is treated as transient
      };
    }
    if (result.ok) {
      dispositions.push({ id: row.id, outcome: "sent", providerMessageId: result.providerMessageId });
    } else if (result.retryable && row.retry_count + 1 <= ctx.maxRetries) {
      dispositions.push({
        id: row.id,
        outcome: "retry",
        retryCount: row.retry_count + 1,
        reason: result.error,
      });
    } else {
      dispositions.push({
        id: row.id,
        outcome: "failed",
        reason: result.retryable
          ? `retries exhausted (${ctx.maxRetries}): ${result.error}`
          : result.error,
      });
    }
  }
  return dispositions;
}
