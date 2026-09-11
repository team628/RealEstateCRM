// Domain types mirroring supabase/migrations. Keep in sync with the schema.

export type OrgRole = "owner" | "admin" | "agent" | "assistant";

export type ContactStage =
  | "new"
  | "engaged"
  | "qualified"
  | "appointment"
  | "active_client"
  | "under_contract"
  | "closed"
  | "past_client"
  | "archived";

export type ContactType =
  | "unknown"
  | "buyer"
  | "seller"
  | "buyer_seller"
  | "renter"
  | "agent_recruit"
  | "vendor"
  | "other";

export type ConsentState = "unknown" | "granted" | "revoked";
export type ActorType = "human" | "system" | "ai";

export type ActivityType =
  | "capture"
  | "note"
  | "call"
  | "email"
  | "sms"
  | "meeting"
  | "stage_change"
  | "assignment"
  | "task"
  | "system";

export interface Contact {
  id: string;
  org_id: string;
  assigned_to: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  stage: ContactStage;
  contact_type: ContactType;
  email_consent: ConsentState;
  sms_consent: ConsentState;
  call_consent: ConsentState;
  original_source: string | null;
  original_source_detail: string | null;
  original_utm: Record<string, string>;
  latest_source: string | null;
  latest_source_detail: string | null;
  latest_utm: Record<string, string>;
  latest_touch_at: string | null;
  captured_at: string | null;
  lead_score: number;
  created_at: string;
}

export interface Activity {
  id: string;
  org_id: string;
  contact_id: string;
  actor_type: ActorType;
  actor_user_id: string | null;
  activity_type: ActivityType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export type TxnStatus = "pending" | "active" | "under_contract" | "closed" | "cancelled";

export interface Transaction {
  id: string;
  org_id: string;
  contact_id: string | null;
  agent_user_id: string | null;
  side: "buyer" | "seller";
  status: TxnStatus;
  property_address: string | null;
  price: number | null;
  gci: number | null;
  key_dates: Record<string, string>;
  created_at: string;
}

export type TaskStatus = "open" | "completed" | "cancelled";

export interface TaskItem {
  id: string;
  org_id: string;
  contact_id: string | null;
  created_by: string | null;
  assigned_to: string | null;
  title: string;
  body: string | null;
  status: TaskStatus;
  due_at: string | null;
  created_at: string;
}

export interface OrgSettings {
  org_id: string;
  ai_enabled: boolean;
  automations_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  voice_enabled: boolean;
  integration_overrides: Record<string, boolean>;
  workflow_overrides: Record<string, boolean>;
  agent_overrides: Record<string, boolean>;
  automation_limits: AutomationLimits;
}

export interface AutomationLimits {
  max_depth: number;
  max_actions_per_run: number;
  max_retries: number;
  dedup_window_seconds: number;
  execution_timeout_seconds: number;
}

export interface OrgMemberInfo {
  user_id: string;
  role: OrgRole;
  full_name: string;
  created_at: string;
}

export interface DashboardStats {
  totalContacts: number;
  newThisWeek: number;
  byStage: Partial<Record<ContactStage, number>>;
}
