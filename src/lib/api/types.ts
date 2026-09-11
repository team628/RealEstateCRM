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
  listTasks(): Promise<TaskItem[]>;
  createTask(req: CreateTaskRequest): Promise<string>;
  setTaskStatus(taskId: string, status: TaskStatus): Promise<void>;
  listMembers(): Promise<OrgMemberInfo[]>;
  getSettings(): Promise<OrgSettings>;
  updateSettings(patch: Partial<OrgSettings>): Promise<OrgSettings>;
  dashboardStats(): Promise<DashboardStats>;
}
