// COMM-001 provider adapter contract (§12). Adapters are the ONLY place
// provider-specific logic may live; the rest of the system speaks this
// interface. Consent and kill switches are enforced upstream in SQL
// (public.queue_message) — an adapter never sees a message the org wasn't
// allowed to send when it was queued, and the drain engine re-checks the kill
// switch at send time.

export type OutboxChannel = "email" | "sms";

export interface OutboundMessage {
  id: string;
  org_id: string;
  contact_id: string;
  channel: OutboxChannel;
  /** destination resolved at drain time from the contact record */
  to: string;
  subject: string | null;
  body: string;
  idempotency_key: string;
  retry_count: number;
}

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean };

export interface MessageAdapter {
  readonly provider: string;
  readonly channel: OutboxChannel;
  /**
   * Sends one message. MUST be idempotent per idempotency_key where the
   * provider supports it, and must classify failures as retryable
   * (rate limit, timeout) or terminal (invalid destination, rejected content).
   */
  send(message: OutboundMessage): Promise<SendResult>;
}
