import { describe, expect, it } from "vitest";
import {
  applyAttribution,
  chooseAssignee,
  leadInputSchema,
  newIdempotencyKey,
  normalizeEmail,
  normalizePhone,
  planCapture,
  scoreLead,
} from "./lead";

describe("normalizeEmail / normalizePhone", () => {
  it("lowercases and trims email, null for empty", () => {
    expect(normalizeEmail("  John@Example.COM ")).toBe("john@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
  it("keeps digits only for phone, matching the SQL phone_digits rule", () => {
    expect(normalizePhone("+1 (555) 111-2222")).toBe("15551112222");
    expect(normalizePhone("555.111.2222")).toBe("5551112222");
    expect(normalizePhone("no digits")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("leadInputSchema", () => {
  it("requires email or phone", () => {
    const result = leadInputSchema.safeParse({ source: "website" });
    expect(result.success).toBe(false);
  });
  it("accepts phone-only leads", () => {
    const result = leadInputSchema.safeParse({ source: "sign_call", phone: "555-111-2222" });
    expect(result.success).toBe(true);
  });
  it("rejects malformed email", () => {
    const result = leadInputSchema.safeParse({ source: "website", email: "not-an-email" });
    expect(result.success).toBe(false);
  });
});

describe("applyAttribution (§29 attribution integrity)", () => {
  const firstTouch = {
    source: "website",
    sourceDetail: "home-valuation",
    utm: { utm_source: "google" },
    at: "2026-09-01T00:00:00Z",
  };
  it("sets original and latest on first touch", () => {
    const a = applyAttribution(null, firstTouch);
    expect(a.original_source).toBe("website");
    expect(a.latest_source).toBe("website");
    expect(a.captured_at).toBe("2026-09-01T00:00:00Z");
  });
  it("NEVER overwrites original on later touches; updates latest", () => {
    const first = applyAttribution(null, firstTouch);
    const second = applyAttribution(first, {
      source: "zillow",
      utm: { utm_source: "zillow" },
      at: "2026-09-10T00:00:00Z",
    });
    expect(second.original_source).toBe("website");
    expect(second.original_utm).toEqual({ utm_source: "google" });
    expect(second.captured_at).toBe("2026-09-01T00:00:00Z");
    expect(second.latest_source).toBe("zillow");
    expect(second.latest_touch_at).toBe("2026-09-10T00:00:00Z");
  });
});

describe("chooseAssignee (LEAD-002 round-robin)", () => {
  const members = [
    { user_id: "a", role: "owner", created_at: "2026-01-01T00:00:00Z" },
    { user_id: "b", role: "agent", created_at: "2026-01-02T00:00:00Z" },
    { user_id: "c", role: "assistant", created_at: "2026-01-03T00:00:00Z" },
  ];
  it("picks the least-loaded eligible member", () => {
    expect(chooseAssignee(members, { a: 3, b: 1 })).toBe("b");
  });
  it("breaks ties by membership seniority", () => {
    expect(chooseAssignee(members, {})).toBe("a");
  });
  it("excludes assistants", () => {
    expect(chooseAssignee(members, { a: 5, b: 5 })).not.toBe("c");
  });
  it("returns null when no eligible member exists", () => {
    expect(chooseAssignee([{ user_id: "x", role: "assistant", created_at: "" }], {})).toBeNull();
  });
});

describe("planCapture (LEAD-001 idempotency + dedupe)", () => {
  const state = {
    requests: new Map([["known-key-000001", "c-1"]]),
    contacts: [
      { id: "c-1", email: "john@example.com", phone: "+1 (555) 111-2222", created_at: "2026-01-01T00:00:00Z" },
      { id: "c-2", email: null, phone: "555-999-8888", created_at: "2026-01-02T00:00:00Z" },
    ],
  };
  it("replays a known idempotency key without touching contacts", () => {
    expect(
      planCapture({ idempotencyKey: "known-key-000001", email: "different@x.com", phone: null }, state),
    ).toEqual({ kind: "replay", contactId: "c-1" });
  });
  it("dedupes by case-insensitive email", () => {
    expect(
      planCapture({ idempotencyKey: "fresh-key-000001", email: "JOHN@example.com", phone: null }, state),
    ).toEqual({ kind: "touch", contactId: "c-1" });
  });
  it("dedupes by phone digits despite formatting", () => {
    expect(
      planCapture({ idempotencyKey: "fresh-key-000002", email: null, phone: "(555) 999 8888" }, state),
    ).toEqual({ kind: "touch", contactId: "c-2" });
  });
  it("creates when no match", () => {
    expect(
      planCapture({ idempotencyKey: "fresh-key-000003", email: "new@x.com", phone: null }, state),
    ).toEqual({ kind: "create" });
  });
  it("rejects short idempotency keys", () => {
    expect(() => planCapture({ idempotencyKey: "short", email: "a@b.c", phone: null }, state)).toThrow(
      /idempotency/,
    );
  });
  it("rejects leads with neither email nor phone", () => {
    expect(() =>
      planCapture({ idempotencyKey: "fresh-key-000004", email: "", phone: "---" }, state),
    ).toThrow(/email address or phone/);
  });
});

describe("scoreLead", () => {
  it("is deterministic and bounded 0-100", () => {
    const score = scoreLead({ hasEmail: true, hasPhone: true, source: "referral", messageLength: 100 });
    expect(score).toBe(10 + 20 + 25 + 30 + 10);
    expect(score).toBeLessThanOrEqual(100);
  });
  it("scores unknown sources conservatively", () => {
    expect(scoreLead({ hasEmail: false, hasPhone: true, source: "mystery", messageLength: 0 })).toBe(
      10 + 25 + 5,
    );
  });
});

describe("newIdempotencyKey", () => {
  it("produces unique keys of sufficient length", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });
});
