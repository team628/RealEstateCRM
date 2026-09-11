import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { getApi } from "@/lib/api";
import type { TaskItem } from "@/types";

function TaskRow({
  task,
  contactName,
  onComplete,
  busy,
}: {
  task: TaskItem;
  contactName: string | null;
  onComplete: (() => void) | null;
  busy: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <p className={task.status === "open" ? "font-medium" : "font-medium line-through opacity-60"}>
          {task.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {task.due_at ? `Due ${format(new Date(task.due_at), "MMM d, yyyy")}` : "No due date"}
          {contactName && task.contact_id && (
            <>
              {" · "}
              <Link className="text-primary hover:underline" to={`/contacts/${task.contact_id}`}>
                {contactName}
              </Link>
            </>
          )}
        </p>
      </div>
      {onComplete ? (
        <Button variant="outline" onClick={onComplete} disabled={busy}>
          Complete
        </Button>
      ) : (
        <Badge>{task.status}</Badge>
      )}
    </li>
  );
}

export default function TasksPage() {
  const api = getApi();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [contactId, setContactId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { data: tasks, isLoading, error } = useQuery({ queryKey: ["tasks"], queryFn: () => api.listTasks() });
  const { data: contacts } = useQuery({ queryKey: ["contacts"], queryFn: () => api.listContacts() });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    if (contactId) void queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
  };

  const createMutation = useMutation({
    mutationFn: () => {
      if (title.trim() === "") {
        setFormError("Task title is required.");
        return Promise.reject(new Error("validation"));
      }
      setFormError(null);
      return api.createTask({
        title,
        contactId: contactId || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
    },
    onSuccess: () => {
      setTitle("");
      setDueAt("");
      setContactId("");
      invalidate();
    },
  });
  const completeMutation = useMutation({
    mutationFn: (id: string) => api.setTaskStatus(id, "completed"),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const contactName = (id: string | null) => {
    if (!id) return null;
    const c = contacts?.find((x) => x.id === id);
    return c ? `${c.first_name} ${c.last_name}`.trim() || c.email || "Contact" : "Contact";
  };

  const open = (tasks ?? []).filter((t) => t.status === "open");
  const done = (tasks ?? []).filter((t) => t.status !== "open");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Tasks</h1>

      <Card>
        <CardHeader>
          <CardTitle>New task</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            noValidate
          >
            <div>
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Call back about the Elm St listing"
              />
            </div>
            <div>
              <Label htmlFor="task-due">Due date</Label>
              <Input id="task-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="task-contact">Contact (optional)</Label>
              <Select id="task-contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">None</option>
                {contacts?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {`${c.first_name} ${c.last_name}`.trim() || c.email || c.id}
                  </option>
                ))}
              </Select>
            </div>
            <div className="self-end">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding…" : "Add task"}
              </Button>
            </div>
          </form>
          {formError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {formError}
            </p>
          )}
          {createMutation.error instanceof Error && createMutation.error.message !== "validation" && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {createMutation.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      {isLoading && <p className="text-muted-foreground">Loading tasks…</p>}
      {error instanceof Error && (
        <p role="alert" className="text-destructive">
          Failed to load tasks: {error.message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Open ({open.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing open. Nice.</p>
          ) : (
            <ul>
              {open.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  contactName={contactName(t.contact_id)}
                  onComplete={() => completeMutation.mutate(t.id)}
                  busy={completeMutation.isPending}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {done.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Done ({done.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {done.map((t) => (
                <TaskRow key={t.id} task={t} contactName={contactName(t.contact_id)} onComplete={null} busy={false} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
