import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { getApi } from "@/lib/api";
import { leadInputSchema, newIdempotencyKey } from "@/lib/domain/lead";

const SOURCES = [
  ["website", "Website"],
  ["referral", "Referral"],
  ["open_house", "Open house"],
  ["sign_call", "Sign call"],
  ["zillow", "Zillow"],
  ["manual", "Manual entry"],
] as const;

export default function NewLeadPage() {
  const api = getApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // One key per form session: double-clicks and retries replay idempotently (§15).
  const idempotencyKey = useRef(newIdempotencyKey());
  const [fields, setFields] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    source: "website",
    sourceDetail: "",
    message: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = leadInputSchema.safeParse({ ...fields, utm: {} });
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          errors[String(issue.path[0] ?? "form")] = issue.message;
        }
        setFieldErrors(errors);
        throw new Error("Please fix the highlighted fields.");
      }
      setFieldErrors({});
      return api.captureLead({
        idempotencyKey: idempotencyKey.current,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email: parsed.data.email,
        phone: parsed.data.phone,
        source: parsed.data.source,
        sourceDetail: parsed.data.sourceDetail,
        message: parsed.data.message,
        utm: parsed.data.utm,
      });
    },
    onSuccess: (contactId) => {
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboardStats"] });
      navigate(`/contacts/${contactId}`);
    },
  });

  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  const errFor = (key: string) =>
    fieldErrors[key] ? (
      <p role="alert" className="mt-1 text-xs text-destructive">
        {fieldErrors[key]}
      </p>
    ) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Capture a lead</h1>
      <Card>
        <CardHeader>
          <CardTitle>Lead details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            noValidate
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="lead-first">First name</Label>
                <Input id="lead-first" autoComplete="given-name" value={fields.firstName} onChange={set("firstName")} />
                {errFor("firstName")}
              </div>
              <div>
                <Label htmlFor="lead-last">Last name</Label>
                <Input id="lead-last" autoComplete="family-name" value={fields.lastName} onChange={set("lastName")} />
                {errFor("lastName")}
              </div>
              <div>
                <Label htmlFor="lead-email">Email</Label>
                <Input id="lead-email" type="email" autoComplete="email" value={fields.email} onChange={set("email")} />
                {errFor("email")}
              </div>
              <div>
                <Label htmlFor="lead-phone">Phone</Label>
                <Input id="lead-phone" type="tel" autoComplete="tel" value={fields.phone} onChange={set("phone")} />
                {errFor("phone")}
              </div>
              <div>
                <Label htmlFor="lead-source">Source</Label>
                <Select id="lead-source" value={fields.source} onChange={set("source")}>
                  {SOURCES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                {errFor("source")}
              </div>
              <div>
                <Label htmlFor="lead-source-detail">Source detail (optional)</Label>
                <Input
                  id="lead-source-detail"
                  placeholder="e.g. 12 Elm St open house"
                  value={fields.sourceDetail}
                  onChange={set("sourceDetail")}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="lead-message">Message / notes (optional)</Label>
              <Textarea id="lead-message" value={fields.message} onChange={set("message")} />
            </div>
            <p className="text-xs text-muted-foreground">
              A lead needs at least an email or a phone number. Repeat submissions with the
              same email or phone attach to the existing contact — the original source is
              never overwritten.
            </p>
            {mutation.error instanceof Error && (
              <p role="alert" className="text-sm text-destructive">
                {mutation.error.message}
              </p>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Capturing…" : "Capture lead"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
