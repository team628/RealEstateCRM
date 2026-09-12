import { describe, expect, it } from "vitest";
import { FakeMlsProvider } from "./fake";
import { matchInventory, matchListing } from "./match";
import type { BuyerCriteria } from "./types";

describe("FakeMlsProvider (MLS-001 adapter surface)", () => {
  const provider = new FakeMlsProvider();

  it("defaults to active inventory and applies filters conjunctively", async () => {
    const results = await provider.search({ city: "Springfield", maxPrice: 460_000, minBedrooms: 3 });
    expect(results.map((l) => l.id).sort()).toEqual(["fake:1001", "fake:1005"]);
    expect(results.every((l) => l.status === "active")).toBe(true);
  });

  it("supports status and type filters", async () => {
    const pending = await provider.search({ status: "pending" });
    expect(pending.map((l) => l.id)).toEqual(["fake:1003"]);
    const condos = await provider.search({ propertyTypes: ["condo"] });
    expect(condos.map((l) => l.id)).toEqual(["fake:1002"]);
  });

  it("fetches by provider-scoped id and returns null for unknown ids", async () => {
    expect((await provider.getListing("fake:1004"))?.address).toBe("301 Lake Rd");
    expect(await provider.getListing("fake:9999")).toBeNull();
  });
});

describe("matchListing / matchInventory (J02/J08 buyer matching)", () => {
  const criteria: BuyerCriteria = { city: "Springfield", maxPrice: 460_000, minBedrooms: 3 };

  it("matches with explicit reasons for rejections", async () => {
    const provider = new FakeMlsProvider();
    const overBudget = (await provider.getListing("fake:1004"))!;
    const verdict = matchListing(overBudget, criteria);
    expect(verdict.matched).toBe(false);
    expect(verdict.reasons.join(" ")).toMatch(/over budget/);
    expect(verdict.reasons.join(" ")).toMatch(/different city/);
  });

  it("excludes non-active listings even when otherwise matching", async () => {
    const provider = new FakeMlsProvider();
    const pending = (await provider.getListing("fake:1003"))!;
    expect(matchListing(pending, { maxPrice: 600_000 }).matched).toBe(false);
  });

  it("ranks matched inventory by price ascending", async () => {
    const provider = new FakeMlsProvider();
    const all = await provider.search({});
    const matches = matchInventory(all, criteria);
    expect(matches.map((l) => l.id)).toEqual(["fake:1005", "fake:1001"]);
  });
});
