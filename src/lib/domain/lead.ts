// Pure lead-capture domain logic (LEAD-001/002). Mirrors the trusted SQL in
// public.capture_lead so the same rules are unit-testable in TS and reused by
// the demo-mode API. The database remains the enforcement layer in production.
import { z } from "zod";

export const leadInputSchema = z
  .object({
    firstName: z.string().trim().max(100).default(""),
    lastName: z.string().trim().max(100).default(""),
    email: z
      .string()
      .trim()
      .email("Enter a valid email address")
      .or(z.literal(""))
      .default(""),
    phone: z.string().trim().max(40).default(""),
    source: z.string().trim().min(1, "Source is required").max(100),
    sourceDetail: z.string().trim().max(200).default(""),
    message: z.string().trim().max(5000).default(""),
    utm: z.record(z.string()).default({}),
  })
  .refine((v) => v.email !== "" || normalizePhone(v.phone) !== null, {
    message: "A lead must include an email address or phone number",
    path: ["email"],
  });

export type LeadInput = z.infer<typeof leadInputSchema>;

export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/** Digits-only projection used for dedupe — same rule as contacts.phone_digits. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits === "" ? null : digits;
}

/**
 * Idempotency key for a form session: generated once when a form mounts, so a
 * double-click or network retry replays as the same capture (§15).
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `web-${crypto.randomUUID()}`;
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface AttributionTouch {
  source: string;
  sourceDetail?: string | null;
  utm?: Record<string, string>;
  at: string; // ISO timestamp
}

export interface Attribution {
  original_source: string | null;
  original_source_detail: string | null;
  original_utm: Record<string, string>;
  captured_at: string | null;
  latest_source: string | null;
  latest_source_detail: string | null;
  latest_utm: Record<string, string>;
  latest_touch_at: string | null;
}

/**
 * §29 attribution integrity: original_* is set exactly once; later touches only
 * ever update latest_*.
 */
export function applyAttribution(existing: Attribution | null, touch: AttributionTouch): Attribution {
  const latest = {
    latest_source: touch.source,
    latest_source_detail: touch.sourceDetail ?? null,
    latest_utm: touch.utm ?? {},
    latest_touch_at: touch.at,
  };
  if (existing && existing.captured_at !== null) {
    return {
      original_source: existing.original_source,
      original_source_detail: existing.original_source_detail,
      original_utm: existing.original_utm,
      captured_at: existing.captured_at,
      ...latest,
    };
  }
  return {
    original_source: touch.source,
    original_source_detail: touch.sourceDetail ?? null,
    original_utm: touch.utm ?? {},
    captured_at: touch.at,
    ...latest,
  };
}

export interface AssignableMember {
  user_id: string;
  role: string;
  created_at: string;
}

/**
 * Round-robin assignment (LEAD-002): the eligible member (owner/admin/agent)
 * with the fewest assigned contacts; ties go to the longest-standing member.
 * Mirrors the ORDER BY in public.capture_lead.
 */
export function chooseAssignee(
  members: AssignableMember[],
  assignedCounts: Record<string, number>,
): string | null {
  const eligible = members.filter((m) => ["owner", "admin", "agent"].includes(m.role));
  if (eligible.length === 0) return null;
  const sorted = [...eligible].sort((a, b) => {
    const diff = (assignedCounts[a.user_id] ?? 0) - (assignedCounts[b.user_id] ?? 0);
    if (diff !== 0) return diff;
    return a.created_at.localeCompare(b.created_at);
  });
  return sorted[0].user_id;
}

/**
 * Deterministic completeness/source heuristic, provenance CALCULATED (§14/§30).
 * Not an AI inference; safe to store on the contact.
 */
export function scoreLead(input: {
  hasEmail: boolean;
  hasPhone: boolean;
  source: string;
  messageLength: number;
}): number {
  let score = 10;
  if (input.hasEmail) score += 20;
  if (input.hasPhone) score += 25;
  const sourceQuality: Record<string, number> = {
    referral: 30,
    sign_call: 25,
    open_house: 20,
    website: 15,
    zillow: 10,
    manual: 5,
  };
  score += sourceQuality[input.source] ?? 5;
  if (input.messageLength > 20) score += 10;
  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Capture planning: decides replay / dedupe / create the same way the SQL does.
// ---------------------------------------------------------------------------
export interface CaptureState {
  /** idempotency key -> contact id */
  requests: ReadonlyMap<string, string>;
  contacts: ReadonlyArray<{
    id: string;
    email: string | null;
    phone: string | null;
    created_at: string;
  }>;
}

export type CapturePlan =
  | { kind: "replay"; contactId: string }
  | { kind: "touch"; contactId: string }
  | { kind: "create" };

export function planCapture(
  input: { idempotencyKey: string; email: string | null; phone: string | null },
  state: CaptureState,
): CapturePlan {
  if (input.idempotencyKey.length < 8) {
    throw new Error("idempotency key of at least 8 characters is required");
  }
  const email = normalizeEmail(input.email);
  const phoneDigits = normalizePhone(input.phone);
  if (email === null && phoneDigits === null) {
    throw new Error("a lead must include an email address or phone number");
  }

  const replayed = state.requests.get(input.idempotencyKey);
  if (replayed !== undefined) return { kind: "replay", contactId: replayed };

  const match = [...state.contacts]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .find(
      (c) =>
        (email !== null && normalizeEmail(c.email) === email) ||
        (phoneDigits !== null && normalizePhone(c.phone) === phoneDigits),
    );
  if (match) return { kind: "touch", contactId: match.id };
  return { kind: "create" };
}
