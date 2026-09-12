import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { getMlsProvider } from "@/lib/mls";
import type { ListingSearch } from "@/lib/mls/types";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function PropertiesPage() {
  const provider = getMlsProvider();
  const [form, setForm] = useState({ city: "", maxPrice: "", minBedrooms: "" });
  const [search, setSearch] = useState<ListingSearch>({});

  const { data: listings, isLoading, error } = useQuery({
    queryKey: ["listings", search],
    queryFn: () => provider.search(search),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Properties</h1>
        {provider.key === "fake" && (
          <Badge>Sample inventory — connect an MLS provider for live data</Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch({
                city: form.city.trim() || undefined,
                maxPrice: form.maxPrice === "" ? undefined : Number(form.maxPrice),
                minBedrooms: form.minBedrooms === "" ? undefined : Number(form.minBedrooms),
              });
            }}
          >
            <div>
              <Label htmlFor="prop-city">City</Label>
              <Input
                id="prop-city"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="Springfield"
              />
            </div>
            <div>
              <Label htmlFor="prop-max">Max price ($)</Label>
              <Input
                id="prop-max"
                inputMode="numeric"
                value={form.maxPrice}
                onChange={(e) => setForm((f) => ({ ...f, maxPrice: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="prop-beds">Min bedrooms</Label>
              <Select
                id="prop-beds"
                value={form.minBedrooms}
                onChange={(e) => setForm((f) => ({ ...f, minBedrooms: e.target.value }))}
              >
                <option value="">Any</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}+
                  </option>
                ))}
              </Select>
            </div>
            <div className="self-end">
              <Button type="submit">Search</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isLoading && <p className="text-muted-foreground">Searching…</p>}
      {error instanceof Error && (
        <p role="alert" className="text-destructive">
          Search failed: {error.message}
        </p>
      )}
      {listings && listings.length === 0 && (
        <p className="text-muted-foreground">No active listings match.</p>
      )}

      {listings && listings.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th scope="col" className="px-3 py-2 font-medium">Address</th>
                <th scope="col" className="px-3 py-2 font-medium">City</th>
                <th scope="col" className="px-3 py-2 font-medium">Price</th>
                <th scope="col" className="px-3 py-2 font-medium">Beds</th>
                <th scope="col" className="px-3 py-2 font-medium">Baths</th>
                <th scope="col" className="px-3 py-2 font-medium">Type</th>
                <th scope="col" className="px-3 py-2 font-medium">MLS #</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-3 py-2 font-medium">{l.address}</td>
                  <td className="px-3 py-2">{l.city}</td>
                  <td className="px-3 py-2 tabular-nums">{money(l.listPrice)}</td>
                  <td className="px-3 py-2 tabular-nums">{l.bedrooms}</td>
                  <td className="px-3 py-2 tabular-nums">{l.bathrooms}</td>
                  <td className="px-3 py-2">{l.propertyType.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2">{l.mlsNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
