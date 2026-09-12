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

export interface UpdateContactRequest {
  contact_type?: import("@/types").ContactType;
  email_consent?: import("@/types").ConsentState;
  sms_consent?: import("@/types").ConsentState;
  call_consent?: import("@/types").ConsentState;
  assigned_to?: string | null;
  first_name?: string;
  last_name?: string;
}

export interface AutomationRunSummary {
  workflowKey: string;
  triggerEvent: string;
  status: "succeeded" | "failed" | "aborted";
  reason: string | null;
  actionCount: number;
  startedAt: string;
}

export interface CreateTransactionRequest {
  contactId?: string | null;
  side: "buyer" | "seller";
  propertyAddress: string;
  price?: number | null;
  gci?: number | null;
}

export interface CreateTaskRequest {
  title: string;
  body?: string;
  contactId?: string | null;
  dueAt?: string | null;
}

export interface CaptureLeadRequest {
  idempotencyKey: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  sourceDetail?: string;
  utm?: Record<string, string>;
  message?: string;
}

/**
 * Thin data-access interface. Two implementations:
 * - SupabaseApi: real backend; RLS + SQL RPCs are the enforcement layer.
 * - DemoApi: in-memory, reusing the same pure domain logic, used until a
 *   Supabase project is connected (docs/OWNER_ACTIONS.md OA-002).
 */
export interface CrmApi {
  readonly mode: "demo" | "supabase";
  currentUser(): Promise<{ id: string; name: string; role: string } | null>;
  listContacts(): Promise<Contact[]>;
  getContact(id: string): Promise<{ contact: Contact; activities: Activity[] } | null>;
  captureLead(req: CaptureLeadRequest): Promise<string>;
  addNote(contactId: string, body: string): Promise<void>;
  updateStage(contactId: string, stage: ContactStage): Promise<void>;
  updateContact(contactId: string, patch: UpdateContactRequest): Promise<void>;
  /** Admin-only: folds duplicate into survivor (children move, fields fill, original attribution preserved). */
  mergeContacts(survivorId: string, duplicateId: string): Promise<void>;
  /** Runs AI lead classification (server-side in production). Fails when the AI kill switch is off. */
  classifyContact(contactId: string): Promise<import("@/lib/ai/types").AiInsight>;
  listInsights(contactId: string): Promise<import("@/lib/ai/types").AiInsight[]>;
  listAutomationRuns(limit?: number): Promise<AutomationRunSummary[]>;
  listTransactions(): Promise<import("@/types").Transaction[]>;
  createTransaction(req: CreateTransactionRequest): Promise<string>;
  updateTransactionStatus(id: string, status: import("@/types").TxnStatus): Promise<void>;
  listTasks(): Promise<TaskItem[]>;
  createTask(req: CreateTaskRequest): Promise<string>;
  setTaskStatus(taskId: string, status: TaskStatus): Promise<void>;
  listMembers(): Promise<OrgMemberInfo[]>;
  getSettings(): Promise<OrgSettings>;
  updateSettings(patch: Partial<OrgSettings>): Promise<OrgSettings>;
  dashboardStats(): Promise<DashboardStats>;
  /** DATA-001: whole-org export. Owner-only (enforced server-side in production). */
  exportOrgData(): Promise<Record<string, unknown>>;
}
