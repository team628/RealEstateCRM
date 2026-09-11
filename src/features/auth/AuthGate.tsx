import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getApi } from "@/lib/api";
import { SupabaseApi } from "@/lib/api/supabase";
import SignInPage from "./SignInPage";
import OnboardingPage from "./OnboardingPage";

/**
 * Demo mode passes straight through. In Supabase mode: unauthenticated users
 * see sign-in; authenticated users without an org membership see onboarding.
 * (RLS enforces all of this server-side regardless — this is UX, not security.)
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const api = getApi();
  const queryClient = useQueryClient();
  const supabaseApi = api instanceof SupabaseApi ? api : null;
  const [authVersion, setAuthVersion] = useState(0);

  useEffect(() => {
    if (!supabaseApi) return;
    return supabaseApi.onAuthChange(() => {
      setAuthVersion((v) => v + 1);
      void queryClient.invalidateQueries();
    });
  }, [supabaseApi, queryClient]);

  const { data: userId, isLoading: sessionLoading } = useQuery({
    queryKey: ["authSession", authVersion],
    queryFn: () => supabaseApi!.getSessionUserId(),
    enabled: supabaseApi !== null,
  });
  const { data: hasOrg, isLoading: orgLoading } = useQuery({
    queryKey: ["hasOrgMembership", authVersion, userId],
    queryFn: () => supabaseApi!.hasOrgMembership(),
    enabled: supabaseApi !== null && !!userId,
  });

  if (!supabaseApi) return <>{children}</>;
  if (sessionLoading || (userId && orgLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!userId) return <SignInPage api={supabaseApi} />;
  if (!hasOrg)
    return (
      <OnboardingPage
        api={supabaseApi}
        onCreated={() => {
          setAuthVersion((v) => v + 1);
          void queryClient.invalidateQueries();
        }}
      />
    );
  return <>{children}</>;
}
