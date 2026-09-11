import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import type { SupabaseApi } from "@/lib/api/supabase";

export default function OnboardingPage({
  api,
  onCreated,
}: {
  api: SupabaseApi;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createOrganization(name);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set up your brokerage</CardTitle>
          <p className="text-sm text-muted-foreground">
            Create your organization to get started. You will be its owner and can
            invite teammates later. (If you were invited to an existing brokerage,
            ask an admin to add you and refresh.)
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <div>
              <Label htmlFor="org-name">Brokerage name</Label>
              <Input
                id="org-name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Stellar Homes Group"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create organization"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void api.signOut()}>
                Sign out
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
