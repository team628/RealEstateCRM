import { DemoApi } from "./demo";
import { getSupabaseEnv, SupabaseApi } from "./supabase";
import type { CrmApi } from "./types";

let instance: CrmApi | null = null;

/**
 * Demo mode when Supabase env vars are absent (docs/OWNER_ACTIONS.md OA-002);
 * real backend when they are set.
 */
export function getApi(): CrmApi {
  if (instance) return instance;
  const env = getSupabaseEnv();
  instance = env ? new SupabaseApi(env.url, env.anonKey) : new DemoApi();
  return instance;
}

export type { CrmApi } from "./types";
