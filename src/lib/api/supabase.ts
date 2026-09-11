// Real backend implementation. Authorization and integrity are enforced by RLS
// and SQL RPCs (see supabase/migrations) — this layer is convenience only.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Activity, Contact, ContactStage, DashboardStats, OrgMemberInfo, OrgSettings } from "@/types";
import type { CaptureLeadRequest, CrmApi } from "./types";

export function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export class SupabaseApi implements CrmApi {
  readonly mode = "supabase" as const;
  readonly client: SupabaseClient;
  private orgId: string | null = null;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey);
  }

  private async requireOrgId(): Promise<string> {
    if (this.orgId) return this.orgId;
    const { data, error } = await this.client
      .from("org_members")
      .select("org_id")
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new Error("You are not a member of any organization yet.");
    }
    this.orgId = data[0].org_id as string;
    return this.orgId;
  }

  private async requireUserId(): Promise<string> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) throw new Error("authentication required");
    return data.user.id;
  }

  async currentUser() {
    const { data } = await this.client.auth.getUser();
    if (!data.user) return null;
    const orgId = await this.requireOrgId();
    const { data: member } = await this.client
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", data.user.id)
      .maybeSingle();
    return {
      id: data.user.id,
      name: (data.user.user_metadata?.full_name as string) || data.user.email || "User",
      role: (member?.role as string) ?? "agent",
    };
  }

  async listContacts(): Promise<Contact[]> {
    const orgId = await this.requireOrgId();
    const { data, error } = await this.client
      .from("contacts")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as Contact[];
  }

  async getContact(id: string) {
    const { data: contact, error } = await this.client
      .from("contacts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!contact) return null;
    const { data: activities, error: aErr } = await this.client
      .from("activities")
      .select("*")
      .eq("contact_id", id)
      .order("occurred_at", { ascending: false })
      .limit(200);
    if (aErr) throw new Error(aErr.message);
    return { contact: contact as Contact, activities: (activities ?? []) as Activity[] };
  }

  async captureLead(req: CaptureLeadRequest): Promise<string> {
    const orgId = await this.requireOrgId();
    const { data, error } = await this.client.rpc("capture_lead", {
      p_org_id: orgId,
      p_idempotency_key: req.idempotencyKey,
      p_first_name: req.firstName,
      p_last_name: req.lastName,
      p_email: req.email || null,
      p_phone: req.phone || null,
      p_source: req.source,
      p_source_detail: req.sourceDetail ?? null,
      p_utm: req.utm ?? {},
      p_message: req.message ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async addNote(contactId: string, body: string): Promise<void> {
    if (body.trim() === "") throw new Error("note body is required");
    const orgId = await this.requireOrgId();
    const userId = await this.requireUserId();
    const { error } = await this.client.from("activities").insert({
      org_id: orgId,
      contact_id: contactId,
      actor_type: "human",
      actor_user_id: userId,
      activity_type: "note",
      title: "Note",
      body: body.trim(),
    });
    if (error) throw new Error(error.message);
  }

  async updateStage(contactId: string, stage: ContactStage): Promise<void> {
    const orgId = await this.requireOrgId();
    const userId = await this.requireUserId();
    const { data: existing, error: readErr } = await this.client
      .from("contacts")
      .select("stage")
      .eq("id", contactId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing || existing.stage === stage) return;
    const { error } = await this.client
      .from("contacts")
      .update({ stage })
      .eq("id", contactId);
    if (error) throw new Error(error.message);
    const { error: actErr } = await this.client.from("activities").insert({
      org_id: orgId,
      contact_id: contactId,
      actor_type: "human",
      actor_user_id: userId,
      activity_type: "stage_change",
      title: `Stage: ${existing.stage} → ${stage}`,
      metadata: { from: existing.stage, to: stage },
    });
    if (actErr) throw new Error(actErr.message);
  }

  async listMembers(): Promise<OrgMemberInfo[]> {
    const orgId = await this.requireOrgId();
    const { data, error } = await this.client
      .from("org_members")
      .select("user_id, role, created_at, profiles:user_id (full_name)")
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((m) => ({
      user_id: m.user_id as string,
      role: m.role as OrgMemberInfo["role"],
      created_at: m.created_at as string,
      full_name:
        ((m as Record<string, unknown>).profiles as { full_name?: string } | null)?.full_name ??
        "Member",
    }));
  }

  async getSettings(): Promise<OrgSettings> {
    const orgId = await this.requireOrgId();
    const { data, error } = await this.client
      .from("org_settings")
      .select("*")
      .eq("org_id", orgId)
      .single();
    if (error) throw new Error(error.message);
    return data as OrgSettings;
  }

  async updateSettings(patch: Partial<OrgSettings>): Promise<OrgSettings> {
    const orgId = await this.requireOrgId();
    const { org_id: _ignored, ...rest } = patch;
    const { data, error } = await this.client
      .from("org_settings")
      .update(rest)
      .eq("org_id", orgId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as OrgSettings;
  }

  async dashboardStats(): Promise<DashboardStats> {
    const contacts = await this.listContacts();
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
