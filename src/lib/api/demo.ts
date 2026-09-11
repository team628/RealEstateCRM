// In-memory demo backend. Reuses the SAME pure domain logic (planCapture,
// applyAttribution, chooseAssignee, scoreLead) that mirrors the trusted SQL, so
// demo behavior matches production semantics. Data resets on reload.
import type {
  Activity,
  Contact,
  ContactStage,
  DashboardStats,
  OrgMemberInfo,
  OrgSettings,
  TaskItem,
  TaskStatus,
} from "@/types";
import {
  applyAttribution,
  chooseAssignee,
  normalizeEmail,
  planCapture,
  scoreLead,
} from "@/lib/domain/lead";
import { DEFAULT_AUTOMATION_LIMITS } from "@/lib/domain/automation";
import {
  processEvent,
  type EngineEvent,
  type RunRecord,
  type WorkflowDef,
} from "@/lib/domain/workflow";
import { FakeAiProvider } from "@/lib/ai/fake";
import type { AiInsight } from "@/lib/ai/types";
import type {
  AutomationRunSummary,
  CaptureLeadRequest,
  CreateTaskRequest,
  CrmApi,
  UpdateContactRequest,
} from "./types";

// Built-in demo workflows (AUTO-001). In production these live in org config.
const DEMO_WORKFLOWS: WorkflowDef[] = [
  {
    key: "new_lead_followup",
    trigger: "lead.captured",
    enabled: true,
    actions: [
      {
        type: "create_task",
        params: { title: "Follow up with new lead", dueInHours: 24 },
      },
    ],
  },
];

const ORG_ID = "demo-org";
const DEMO_USERS: OrgMemberInfo[] = [
  { user_id: "u-broker", role: "owner", full_name: "Dana Broker", created_at: "2026-01-01T00:00:00Z" },
  { user_id: "u-agent1", role: "agent", full_name: "Alex Agent", created_at: "2026-01-02T00:00:00Z" },
  { user_id: "u-agent2", role: "agent", full_name: "Sam Seller", created_at: "2026-01-03T00:00:00Z" },
];

let contactSeq = 0;
let activitySeq = 0;
let taskSeq = 0;
let eventSeq = 0;

function nowIso(): string {
  return new Date().toISOString();
}

export class DemoApi implements CrmApi {
  readonly mode = "demo" as const;
  private contacts = new Map<string, Contact>();
  private activities: Activity[] = [];
  private tasks = new Map<string, TaskItem>();
  readonly automationRuns: RunRecord[] = [];
  private insights: AiInsight[] = [];
  private aiProvider = new FakeAiProvider();
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
    const before = this.contacts.size;
    const contactId = this.doCapture(req);
    if (this.contacts.size > before) {
      await this.fireEvent("lead.captured", { contactId });
    }
    return contactId;
  }

  // AUTO-001: runs the workflow engine with kill switches + guardrails applied.
  private async fireEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    const event: EngineEvent = {
      id: `evt-${++eventSeq}`,
      type,
      orgId: ORG_ID,
      payload,
      depth: 0,
      correlationId: `corr-${eventSeq}`,
      occurredAt: nowIso(),
    };
    await processEvent(event, DEMO_WORKFLOWS, {
      now: nowIso,
      limits: this.settings.automation_limits,
      automationsEnabled: (workflowKey) =>
        this.settings.automations_enabled &&
        this.settings.workflow_overrides[workflowKey] !== false,
      findRecentRun: (workflowKey, dedupKey) =>
        this.automationRuns.find(
          (r) => r.workflowKey === workflowKey && r.dedupKey === dedupKey,
        )?.startedAt ?? null,
      recordRun: (run) => this.automationRuns.push(run),
      executeAction: async (action, event2) => {
        if (action.type === "create_task") {
          const contactId = event2.payload.contactId as string;
          const contact = this.contacts.get(contactId);
          if (!contact) throw new Error("automation target contact not found");
          const dueInHours = Number(action.params.dueInHours ?? 24);
          const id = `t-${++taskSeq}`;
          this.tasks.set(id, {
            id,
            org_id: ORG_ID,
            contact_id: contactId,
            created_by: null,
            assigned_to: contact.assigned_to,
            title: String(action.params.title ?? "Follow up"),
            body: null,
            status: "open",
            due_at: new Date(Date.now() + dueInHours * 3600 * 1000).toISOString(),
            created_at: nowIso(),
          });
          this.pushActivity(
            contactId,
            "system",
            "task",
            `Automation: ${String(action.params.title ?? "task created")}`,
            null,
            { task_id: id, workflow: "new_lead_followup" },
          );
          return;
        }
        throw new Error(`unknown automation action type: ${action.type}`);
      },
    });
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

  async updateContact(contactId: string, patch: UpdateContactRequest): Promise<void> {
    const contact = this.contacts.get(contactId);
    if (!contact) throw new Error("contact not found");
    const previousAssignee = contact.assigned_to;
    Object.assign(contact, patch);
    if ("assigned_to" in patch && patch.assigned_to !== previousAssignee) {
      this.pushActivity(contactId, "human", "assignment", "Reassigned", null, {
        from: previousAssignee,
        to: patch.assigned_to ?? null,
      }, "u-broker");
    }
  }

  async classifyContact(contactId: string): Promise<AiInsight> {
    const contact = this.contacts.get(contactId);
    if (!contact) throw new Error("contact not found");
    // §17: kill switch checked before any AI work, exactly like production.
    if (!this.settings.ai_enabled || this.settings.agent_overrides["lead_classifier"] === false) {
      throw new Error("AI actions are disabled for this organization");
    }
    const capture = [...this.activities]
      .reverse()
      .find((a) => a.contact_id === contactId && a.activity_type === "capture" && a.body);
    // §26 PII minimization: same minimal fields as the production edge function.
    const classification = await this.aiProvider.classifyLead({
      firstName: contact.first_name,
      lastName: contact.last_name,
      source: contact.original_source,
      sourceDetail: contact.original_source_detail,
      message: capture?.body ?? null,
      hasEmail: contact.email !== null,
      hasPhone: contact.phone !== null,
    });
    const insight: AiInsight = {
      id: `i-${this.insights.length + 1}`,
      contact_id: contactId,
      kind: "lead_classification",
      value: classification,
      source: "ai_inferred",
      confidence: classification.confidence,
      model: this.aiProvider.model,
      reasoning: classification.reasoning,
      created_at: nowIso(),
    };
    this.insights.push(insight);
    this.pushActivity(contactId, "ai", "system", "AI classification recorded", null, {
      insight_id: insight.id,
      model: this.aiProvider.model,
    });
    return insight;
  }

  async listInsights(contactId: string): Promise<AiInsight[]> {
    return this.insights
      .filter((i) => i.contact_id === contactId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async listAutomationRuns(limit = 20): Promise<AutomationRunSummary[]> {
    return [...this.automationRuns]
      .reverse()
      .slice(0, limit)
      .map((r) => ({
        workflowKey: r.workflowKey,
        triggerEvent: r.triggerEvent,
        status: r.status,
        reason: r.reason,
        actionCount: r.actionCount,
        startedAt: r.startedAt,
      }));
  }

  async listTasks(): Promise<TaskItem[]> {
    return [...this.tasks.values()].sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999");
    });
  }

  async createTask(req: CreateTaskRequest): Promise<string> {
    const title = req.title.trim();
    if (title === "") throw new Error("task title is required");
    if (req.contactId && !this.contacts.has(req.contactId)) {
      throw new Error("contact not found");
    }
    const id = `t-${++taskSeq}`;
    this.tasks.set(id, {
      id,
      org_id: ORG_ID,
      contact_id: req.contactId ?? null,
      created_by: "u-broker",
      assigned_to: "u-broker",
      title,
      body: req.body?.trim() || null,
      status: "open",
      due_at: req.dueAt ?? null,
      created_at: nowIso(),
    });
    if (req.contactId) {
      this.pushActivity(req.contactId, "human", "task", `Task created: ${title}`, null, { task_id: id }, "u-broker");
    }
    return id;
  }

  async setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("task not found");
    if (task.status === status) return;
    task.status = status;
    if (task.contact_id) {
      this.pushActivity(task.contact_id, "human", "task", `Task ${status}: ${task.title}`, null, { task_id: taskId }, "u-broker");
    }
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

  async exportOrgData(): Promise<Record<string, unknown>> {
    return {
      exported_at: nowIso(),
      organization: { id: ORG_ID, name: "Demo Brokerage" },
      settings: structuredClone(this.settings),
      members: DEMO_USERS,
      contacts: [...this.contacts.values()],
      activities: this.activities,
      tasks: [...this.tasks.values()],
      ai_insights: this.insights,
      automation_runs: this.automationRuns,
    };
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
