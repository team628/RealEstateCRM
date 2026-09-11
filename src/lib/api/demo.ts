// In-memory demo backend. Reuses the SAME pure domain logic (planCapture,
// applyAttribution, chooseAssignee, scoreLead) that mirrors the trusted SQL, so
// demo behavior matches production semantics. Data resets on reload.
import type { Activity, Contact, ContactStage, DashboardStats, OrgMemberInfo, OrgSettings } from "@/types";
import {
  applyAttribution,
  chooseAssignee,
  normalizeEmail,
  planCapture,
  scoreLead,
} from "@/lib/domain/lead";
import { DEFAULT_AUTOMATION_LIMITS } from "@/lib/domain/automation";
import type { CaptureLeadRequest, CrmApi } from "./types";

const ORG_ID = "demo-org";
const DEMO_USERS: OrgMemberInfo[] = [
  { user_id: "u-broker", role: "owner", full_name: "Dana Broker", created_at: "2026-01-01T00:00:00Z" },
  { user_id: "u-agent1", role: "agent", full_name: "Alex Agent", created_at: "2026-01-02T00:00:00Z" },
  { user_id: "u-agent2", role: "agent", full_name: "Sam Seller", created_at: "2026-01-03T00:00:00Z" },
];

let contactSeq = 0;
let activitySeq = 0;

function nowIso(): string {
  return new Date().toISOString();
}

export class DemoApi implements CrmApi {
  readonly mode = "demo" as const;
  private contacts = new Map<string, Contact>();
  private activities: Activity[] = [];
  private captureRequests = new Map<string, string>();
  private settings: OrgSettings = {
    org_id: ORG_ID,
    ai_enabled: true,
    automations_enabled: true,
    email_enabled: true,
    sms_enabled: true,
    voice_enabled: true,
    integration_overrides: {},
    workflow_overrides: {},
    agent_overrides: {},
    automation_limits: { ...DEFAULT_AUTOMATION_LIMITS },
  };

  constructor() {
    this.seed();
  }

  private seed() {
    const seedLeads: Array<Partial<CaptureLeadRequest> & { source: string }> = [
      { firstName: "Jordan", lastName: "Miles", email: "jordan@example.com", phone: "555-201-3344", source: "website", sourceDetail: "home-valuation", message: "Curious what my townhouse is worth." },
      { firstName: "Priya", lastName: "Shah", email: "priya@example.com", phone: "555-887-2210", source: "referral", message: "Referred by the Nguyens — looking to buy this fall." },
      { firstName: "Marcus", lastName: "Lee", email: "marcus@example.com", phone: "", source: "open_house", sourceDetail: "12 Elm St" },
    ];
    seedLeads.forEach((l, i) =>
      this.doCapture({
        idempotencyKey: `seed-key-${i}-000000`,
        firstName: l.firstName ?? "",
        lastName: l.lastName ?? "",
        email: l.email ?? "",
        phone: l.phone ?? "",
        source: l.source,
        sourceDetail: l.sourceDetail,
        message: l.message,
      }),
    );
  }

  async currentUser() {
    return { id: "u-broker", name: "Dana Broker (demo)", role: "owner" };
  }

  async listContacts(): Promise<Contact[]> {
    return [...this.contacts.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getContact(id: string) {
    const contact = this.contacts.get(id);
    if (!contact) return null;
    const activities = this.activities
      .filter((a) => a.contact_id === id)
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    return { contact: { ...contact }, activities };
  }

  async captureLead(req: CaptureLeadRequest): Promise<string> {
    return this.doCapture(req);
  }

  private doCapture(req: CaptureLeadRequest): string {
    const plan = planCapture(
      { idempotencyKey: req.idempotencyKey, email: req.email, phone: req.phone },
      {
        requests: this.captureRequests,
        contacts: [...this.contacts.values()],
      },
    );
    const at = nowIso();

    if (plan.kind === "replay") return plan.contactId;

    if (plan.kind === "touch") {
      const existing = this.contacts.get(plan.contactId)!;
      const attribution = applyAttribution(existing, {
        source: req.source,
        sourceDetail: req.sourceDetail,
        utm: req.utm,
        at,
      });
      Object.assign(existing, attribution);
      this.pushActivity(existing.id, "system", "capture", "Repeat inquiry", req.message ?? null, {
        source: req.source,
      });
      this.captureRequests.set(req.idempotencyKey, existing.id);
      return existing.id;
    }

    const assignedCounts: Record<string, number> = {};
    for (const c of this.contacts.values()) {
      if (c.assigned_to) assignedCounts[c.assigned_to] = (assignedCounts[c.assigned_to] ?? 0) + 1;
    }
    const assignee = chooseAssignee(DEMO_USERS, assignedCounts);
    const attribution = applyAttribution(null, {
      source: req.source,
      sourceDetail: req.sourceDetail,
      utm: req.utm,
      at,
    });
    const id = `c-${++contactSeq}`;
    const contact: Contact = {
      id,
      org_id: ORG_ID,
      assigned_to: assignee,
      first_name: req.firstName.trim(),
      last_name: req.lastName.trim(),
      email: normalizeEmail(req.email),
      phone: req.phone.trim() === "" ? null : req.phone.trim(),
      stage: "new",
      contact_type: "unknown",
      email_consent: "unknown",
      sms_consent: "unknown",
      call_consent: "unknown",
      ...attribution,
      lead_score: scoreLead({
        hasEmail: normalizeEmail(req.email) !== null,
        hasPhone: (req.phone ?? "").replace(/\D/g, "") !== "",
        source: req.source,
        messageLength: (req.message ?? "").length,
      }),
      created_at: at,
    };
    this.contacts.set(id, contact);
    this.pushActivity(id, "system", "capture", "Lead captured", req.message ?? null, {
      source: req.source,
      source_detail: req.sourceDetail ?? null,
      utm: req.utm ?? {},
    });
    if (assignee) {
      this.pushActivity(id, "system", "assignment", "Lead assigned", null, {
        assigned_to: assignee,
        strategy: "round_robin",
      });
    }
    this.captureRequests.set(req.idempotencyKey, id);
    return id;
  }

  private pushActivity(
    contactId: string,
    actorType: Activity["actor_type"],
    activityType: Activity["activity_type"],
    title: string,
    body: string | null,
    metadata: Record<string, unknown>,
    actorUserId: string | null = null,
  ) {
    this.activities.push({
      id: `a-${++activitySeq}`,
      org_id: ORG_ID,
      contact_id: contactId,
      actor_type: actorType,
      actor_user_id: actorUserId,
      activity_type: activityType,
      title,
      body,
      metadata,
      occurred_at: nowIso(),
    });
  }

  async addNote(contactId: string, body: string): Promise<void> {
    if (!this.contacts.has(contactId)) throw new Error("contact not found");
    if (body.trim() === "") throw new Error("note body is required");
    this.pushActivity(contactId, "human", "note", "Note", body.trim(), {}, "u-broker");
  }

  async updateStage(contactId: string, stage: ContactStage): Promise<void> {
    const contact = this.contacts.get(contactId);
    if (!contact) throw new Error("contact not found");
    const from = contact.stage;
    if (from === stage) return;
    contact.stage = stage;
    this.pushActivity(contactId, "human", "stage_change", `Stage: ${from} → ${stage}`, null, { from, to: stage }, "u-broker");
  }

  async listMembers(): Promise<OrgMemberInfo[]> {
    return DEMO_USERS.map((u) => ({ ...u }));
  }

  async getSettings(): Promise<OrgSettings> {
    return structuredClone(this.settings);
  }

  async updateSettings(patch: Partial<OrgSettings>): Promise<OrgSettings> {
    this.settings = { ...this.settings, ...patch, org_id: ORG_ID };
    return structuredClone(this.settings);
  }

  async dashboardStats(): Promise<DashboardStats> {
    const contacts = [...this.contacts.values()];
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const byStage: DashboardStats["byStage"] = {};
    for (const c of contacts) byStage[c.stage] = (byStage[c.stage] ?? 0) + 1;
    return {
      totalContacts: contacts.length,
      newThisWeek: contacts.filter((c) => Date.parse(c.created_at) > weekAgo).length,
      byStage,
    };
  }
}
