import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { getApi } from "@/lib/api";
import { STAGE_LABELS, STAGES } from "./stages";
import type { ContactStage } from "@/types";

export default function ContactsPage() {
  const api = getApi();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | ContactStage>("all");
  const { data: contacts, isLoading, error } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => api.listContacts(),
  });
  const { data: members } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.listMembers(),
  });

  const memberName = (id: string | null) =>
    members?.find((m) => m.user_id === id)?.full_name ?? (id ? "Member" : "Unassigned");

  const filtered = (contacts ?? []).filter((c) => {
    if (stageFilter !== "all" && c.stage !== stageFilter) return false;
    const q = search.trim().toLowerCase();
    if (q === "") return true;
    return [c.first_name, c.last_name, c.email ?? "", c.phone ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <Link
          to="/leads/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          New lead
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="contact-search">Search</Label>
          <Input
            id="contact-search"
            type="search"
            placeholder="Name, email, or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="stage-filter">Stage</Label>
          <Select
            id="stage-filter"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as "all" | ContactStage)}
          >
            <option value="all">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading contacts…</p>}
      {error instanceof Error && (
        <p role="alert" className="text-destructive">
          Failed to load contacts: {error.message}
        </p>
      )}
      {contacts && filtered.length === 0 && (
        <p className="text-muted-foreground">No contacts match.</p>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Stage</th>
                <th scope="col" className="px-3 py-2 font-medium">Assigned to</th>
                <th scope="col" className="px-3 py-2 font-medium">Original source</th>
                <th scope="col" className="px-3 py-2 font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <Link to={`/contacts/${c.id}`} className="font-medium text-primary hover:underline">
                      {`${c.first_name} ${c.last_name}`.trim() || c.email || c.phone || "Unnamed"}
                    </Link>
                    <div className="text-xs text-muted-foreground">{c.email ?? c.phone ?? ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={c.stage === "new" ? "primary" : "muted"}>{STAGE_LABELS[c.stage]}</Badge>
                  </td>
                  <td className="px-3 py-2">{memberName(c.assigned_to)}</td>
                  <td className="px-3 py-2">{c.original_source ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{c.lead_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
