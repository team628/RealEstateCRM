import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getApi } from "@/lib/api";
import { STAGE_LABELS } from "@/features/contacts/stages";
import type { ContactStage } from "@/types";

export default function DashboardPage() {
  const api = getApi();
  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboardStats"],
    queryFn: () => api.dashboardStats(),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      {isLoading || !stats ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Total contacts</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">{stats.totalContacts}</p>
                <p className="text-sm text-muted-foreground">
                  Actual count of contact records (not estimated)
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>New this week</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">{stats.newThisWeek}</p>
                <p className="text-sm text-muted-foreground">Contacts created in the last 7 days</p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Pipeline by stage</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(stats.byStage).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No contacts yet. <Link className="text-primary underline" to="/leads/new">Capture your first lead</Link>.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-3">
                  {(Object.entries(stats.byStage) as [ContactStage, number][]).map(([stage, n]) => (
                    <li key={stage} className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
                      <span>{STAGE_LABELS[stage]}</span>
                      <span className="font-semibold">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Leads by original source</CardTitle>
              <p className="text-sm text-muted-foreground">
                Actual contact counts by immutable first-touch source — later
                inquiries never re-attribute a lead.
              </p>
            </CardHeader>
            <CardContent>
              {Object.keys(stats.bySource).length === 0 ? (
                <p className="text-sm text-muted-foreground">No contacts yet.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-3">
                  {Object.entries(stats.bySource)
                    .sort((a, b) => b[1] - a[1])
                    .map(([source, n]) => (
                      <li
                        key={source}
                        className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm"
                      >
                        <span>{source}</span>
                        <span className="font-semibold tabular-nums">{n}</span>
                      </li>
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
