import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { getApi } from "@/lib/api";
import type { TxnStatus } from "@/types";

const STATUS_LABELS: Record<TxnStatus, string> = {
  pending: "Pending",
  active: "Active",
  under_contract: "Under contract",
  closed: "Closed",
  cancelled: "Cancelled",
};
const STATUSES = Object.keys(STATUS_LABELS) as TxnStatus[];

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function TransactionsPage() {
  const api = getApi();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    contactId: "",
    side: "buyer" as "buyer" | "seller",
    propertyAddress: "",
    price: "",
    gci: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const { data: txns, isLoading, error } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => api.listTransactions(),
  });
  const { data: contacts } = useQuery({ queryKey: ["contacts"], queryFn: () => api.listContacts() });

  const createMutation = useMutation({
    mutationFn: () => {
      if (form.propertyAddress.trim() === "") {
        setFormError("Property address is required.");
        return Promise.reject(new Error("validation"));
      }
      const price = form.price === "" ? null : Number(form.price);
      const gci = form.gci === "" ? null : Number(form.gci);
      if ((price !== null && (Number.isNaN(price) || price < 0)) ||
          (gci !== null && (Number.isNaN(gci) || gci < 0))) {
        setFormError("Price and GCI must be non-negative numbers.");
        return Promise.reject(new Error("validation"));
      }
      setFormError(null);
      return api.createTransaction({
        contactId: form.contactId || null,
        side: form.side,
        propertyAddress: form.propertyAddress,
        price,
        gci,
      });
    },
    onSuccess: () => {
      setForm({ contactId: "", side: "buyer", propertyAddress: "", price: "", gci: "" });
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TxnStatus }) =>
      api.updateTransactionStatus(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  });

  const contactName = (id: string | null) => {
    const c = contacts?.find((x) => x.id === id);
    return c ? `${c.first_name} ${c.last_name}`.trim() || c.email || "Contact" : null;
  };

  const closed = (txns ?? []).filter((t) => t.status === "closed");
  const closedGci = closed.reduce((sum, t) => sum + (t.gci ?? 0), 0);
  const pipeline = (txns ?? []).filter((t) => !["closed", "cancelled"].includes(t.status));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Transactions</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Closed GCI (actual)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{money(closedGci)}</p>
            <p className="text-sm text-muted-foreground">
              Formula: sum of GCI across {closed.length} closed transaction
              {closed.length === 1 ? "" : "s"}. Actual recorded values — not estimated.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Open pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{pipeline.length}</p>
            <p className="text-sm text-muted-foreground">
              Pending, active, or under-contract transactions
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New transaction</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            noValidate
          >
            <div className="lg:col-span-2">
              <Label htmlFor="txn-address">Property address</Label>
              <Input
                id="txn-address"
                value={form.propertyAddress}
                onChange={(e) => setForm((f) => ({ ...f, propertyAddress: e.target.value }))}
                placeholder="12 Elm St, Springfield"
              />
            </div>
            <div>
              <Label htmlFor="txn-side">Side</Label>
              <Select
                id="txn-side"
                value={form.side}
                onChange={(e) => setForm((f) => ({ ...f, side: e.target.value as "buyer" | "seller" }))}
              >
                <option value="buyer">Buyer</option>
                <option value="seller">Seller</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="txn-contact">Contact</Label>
              <Select
                id="txn-contact"
                value={form.contactId}
                onChange={(e) => setForm((f) => ({ ...f, contactId: e.target.value }))}
              >
                <option value="">None</option>
                {contacts?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {`${c.first_name} ${c.last_name}`.trim() || c.email || c.id}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="txn-price">Price ($)</Label>
              <Input
                id="txn-price"
                inputMode="numeric"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="txn-gci">GCI ($)</Label>
                <Input
                  id="txn-gci"
                  inputMode="numeric"
                  value={form.gci}
                  onChange={(e) => setForm((f) => ({ ...f, gci: e.target.value }))}
                />
              </div>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding…" : "Add"}
              </Button>
            </div>
          </form>
          {formError && (
            <p role="alert" className="mt-2 text-sm text-destructive">{formError}</p>
          )}
          {createMutation.error instanceof Error && createMutation.error.message !== "validation" && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {createMutation.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      {isLoading && <p className="text-muted-foreground">Loading transactions…</p>}
      {error instanceof Error && (
        <p role="alert" className="text-destructive">Failed to load transactions: {error.message}</p>
      )}
      {txns && txns.length === 0 && <p className="text-muted-foreground">No transactions yet.</p>}

      {txns && txns.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th scope="col" className="px-3 py-2 font-medium">Property</th>
                <th scope="col" className="px-3 py-2 font-medium">Side</th>
                <th scope="col" className="px-3 py-2 font-medium">Contact</th>
                <th scope="col" className="px-3 py-2 font-medium">Price</th>
                <th scope="col" className="px-3 py-2 font-medium">GCI</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{t.property_address ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge>{t.side}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {t.contact_id && contactName(t.contact_id) ? (
                      <Link className="text-primary hover:underline" to={`/contacts/${t.contact_id}`}>
                        {contactName(t.contact_id)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{t.price != null ? money(t.price) : "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{t.gci != null ? money(t.gci) : "—"}</td>
                  <td className="px-3 py-2">
                    <Select
                      aria-label={`Status for ${t.property_address ?? t.id}`}
                      className="h-8 w-40"
                      value={t.status}
                      disabled={statusMutation.isPending}
                      onChange={(e) =>
                        statusMutation.mutate({ id: t.id, status: e.target.value as TxnStatus })
                      }
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
