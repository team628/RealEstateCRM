import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/input";
import { getApi } from "@/lib/api";
import { STAGE_LABELS, STAGES } from "./stages";
import type { Activity, ConsentState, ContactStage, ContactType } from "@/types";
import type { UpdateContactRequest } from "@/lib/api/types";

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  unknown: "Unknown",
  buyer: "Buyer",
  seller: "Seller",
  buyer_seller: "Buyer + seller",
  renter: "Renter",
  agent_recruit: "Agent recruit",
  vendor: "Vendor",
  other: "Other",
};

const CONSENT_LABELS: Record<ConsentState, string> = {
  unknown: "Unknown",
  granted: "Granted",
  revoked: "Revoked",
};

const CONSENT_FIELDS = [
  ["email_consent", "Email consent"],
  ["sms_consent", "SMS consent"],
  ["call_consent", "Call consent"],
] as const;

function ActivityRow({ activity }: { activity: Activity }) {
  const when = formatDistanceToNow(new Date(activity.occurred_at), { addSuffix: true });
  return (
    <li className="flex gap-3 border-b border-border py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{activity.title}</span>
          <Badge tone={activity.actor_type === "ai" ? "primary" : "muted"}>
            {activity.actor_type}
          </Badge>
          <span className="text-xs text-muted-foreground">{when}</span>
        </div>
        {activity.body && <p className="mt-1 whitespace-pre-wrap text-sm">{activity.body}</p>}
      </div>
    </li>
  );
}

export default function ContactDetailPage() {
  const { id = "" } = useParams();
  const api = getApi();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["contact", id],
    queryFn: () => api.getContact(id),
  });
  const { data: members } = useQuery({ queryKey: ["members"], queryFn: () => api.listMembers() });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["contact", id] });
    void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboardStats"] });
  };

  const stageMutation = useMutation({
    mutationFn: (stage: ContactStage) => api.updateStage(id, stage),
    onSuccess: invalidate,
  });
  const patchMutation = useMutation({
    mutationFn: (patch: UpdateContactRequest) => api.updateContact(id, patch),
    onSuccess: invalidate,
  });
  const noteMutation = useMutation({
    mutationFn: (body: string) => api.addNote(id, body),
    onSuccess: () => {
      setNote("");
      setNoteError(null);
      invalidate();
    },
    onError: (e: Error) => setNoteError(e.message),
  });

  if (isLoading) return <p className="text-muted-foreground">Loading contact…</p>;
  if (error instanceof Error)
    return (
      <p role="alert" className="text-destructive">
        Failed to load contact: {error.message}
      </p>
    );
  if (!data)
    return (
      <p className="text-muted-foreground">
        Contact not found. <Link className="text-primary underline" to="/contacts">Back to contacts</Link>
      </p>
    );

  const { contact, activities } = data;
  const assigneeName =
    members?.find((m) => m.user_id === contact.assigned_to)?.full_name ??
    (contact.assigned_to ? "Member" : "Unassigned");

  return (
    <div className="space-y-6">
      <div>
        <Link to="/contacts" className="text-sm text-primary hover:underline">
          ← Contacts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          {`${contact.first_name} ${contact.last_name}`.trim() || "Unnamed contact"}
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="space-y-2">
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{contact.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{contact.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Assigned to</dt>
                <dd>{assigneeName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Lead score (calculated)</dt>
                <dd className="tabular-nums">{contact.lead_score} / 100</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Original source (immutable)</dt>
                <dd>
                  {contact.original_source ?? "—"}
                  {contact.original_source_detail ? ` · ${contact.original_source_detail}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Latest source</dt>
                <dd>{contact.latest_source ?? "—"}</dd>
              </div>
            </dl>
            <div>
              <Label htmlFor="stage-select">Stage</Label>
              <Select
                id="stage-select"
                value={contact.stage}
                disabled={stageMutation.isPending}
                onChange={(e) => stageMutation.mutate(e.target.value as ContactStage)}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </option>
                ))}
              </Select>
              {stageMutation.error instanceof Error && (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {stageMutation.error.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="type-select">Contact type</Label>
              <Select
                id="type-select"
                value={contact.contact_type}
                disabled={patchMutation.isPending}
                onChange={(e) => patchMutation.mutate({ contact_type: e.target.value as ContactType })}
              >
                {(Object.keys(CONTACT_TYPE_LABELS) as ContactType[]).map((t) => (
                  <option key={t} value={t}>
                    {CONTACT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="assignee-select">Assignee</Label>
              <Select
                id="assignee-select"
                value={contact.assigned_to ?? ""}
                disabled={patchMutation.isPending}
                onChange={(e) => patchMutation.mutate({ assigned_to: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {members?.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name} ({m.role})
                  </option>
                ))}
              </Select>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Communication consent</legend>
              <div className="space-y-2">
                {CONSENT_FIELDS.map(([field, label]) => (
                  <div key={field} className="flex items-center justify-between gap-2">
                    <Label htmlFor={`consent-${field}`} className="mb-0 font-normal text-muted-foreground">
                      {label}
                    </Label>
                    <Select
                      id={`consent-${field}`}
                      className="h-8 w-32"
                      value={contact[field]}
                      disabled={patchMutation.isPending}
                      onChange={(e) =>
                        patchMutation.mutate({ [field]: e.target.value as ConsentState })
                      }
                    >
                      {(Object.keys(CONSENT_LABELS) as ConsentState[]).map((s) => (
                        <option key={s} value={s}>
                          {CONSENT_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Outbound sends are blocked unless consent is granted.
              </p>
            </fieldset>
            {patchMutation.error instanceof Error && (
              <p role="alert" className="text-xs text-destructive">
                {patchMutation.error.message}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="mb-4 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim() === "") {
                  setNoteError("Write a note before saving.");
                  return;
                }
                noteMutation.mutate(note);
              }}
            >
              <Label htmlFor="new-note">Add a note</Label>
              <Textarea
                id="new-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Call summary, next steps…"
                aria-describedby={noteError ? "note-error" : undefined}
              />
              {noteError && (
                <p id="note-error" role="alert" className="text-xs text-destructive">
                  {noteError}
                </p>
              )}
              <Button type="submit" disabled={noteMutation.isPending}>
                {noteMutation.isPending ? "Saving…" : "Save note"}
              </Button>
            </form>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul aria-label="Activity timeline">
                {activities.map((a) => (
                  <ActivityRow key={a.id} activity={a} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
