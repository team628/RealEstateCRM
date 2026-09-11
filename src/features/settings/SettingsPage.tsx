import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getApi } from "@/lib/api";
import type { OrgSettings } from "@/types";

const SWITCHES: Array<{ key: keyof OrgSettings & string; label: string; description: string }> = [
  { key: "ai_enabled", label: "AI actions", description: "All AI-proposed actions across the org" },
  { key: "automations_enabled", label: "Automations", description: "All workflow automations" },
  { key: "email_enabled", label: "Outbound email", description: "All outbound email sending" },
  { key: "sms_enabled", label: "Outbound SMS", description: "All outbound text messaging" },
  { key: "voice_enabled", label: "Voice AI", description: "AI voice calling" },
];

export default function SettingsPage() {
  const api = getApi();
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ["orgSettings"],
    queryFn: () => api.getSettings(),
  });
  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: () => api.currentUser() });
  const isAdmin = user?.role === "owner" || user?.role === "admin";

  const mutation = useMutation({
    mutationFn: (patch: Partial<OrgSettings>) => api.updateSettings(patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["orgSettings"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Emergency kill switches</CardTitle>
          <p className="text-sm text-muted-foreground">
            Take effect immediately for the whole organization — no deployment needed.
            {!isAdmin && " Only owners and admins can change these."}
          </p>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-muted-foreground">Loading…</p>}
          {error instanceof Error && (
            <p role="alert" className="text-destructive">
              Failed to load settings: {error.message}
            </p>
          )}
          {settings && (
            <ul className="divide-y divide-border">
              {SWITCHES.map(({ key, label, description }) => {
                const enabled = settings[key] as boolean;
                return (
                  <li key={key} className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <p className="font-medium">{label}</p>
                      <p className="text-sm text-muted-foreground">{description}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${label}: ${enabled ? "enabled" : "disabled"}`}
                      disabled={!isAdmin || mutation.isPending}
                      onClick={() => mutation.mutate({ [key]: !enabled })}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${
                        enabled ? "bg-primary" : "bg-muted-foreground/40"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                          enabled ? "translate-x-[22px]" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {mutation.error instanceof Error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
