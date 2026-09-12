// Deterministic in-memory MLS provider for demo mode and tests. Exercises the
// full adapter surface without a data agreement (OA-005). NOT market data.
import type { ListingSearch, MlsProvider, PropertyListing } from "./types";

const now = "2026-09-12T00:00:00Z";

export const FAKE_LISTINGS: PropertyListing[] = [
  { id: "fake:1001", provider: "fake", mlsNumber: "1001", status: "active", address: "12 Elm St", city: "Springfield", postalCode: "01101", listPrice: 450_000, bedrooms: 3, bathrooms: 2, squareFeet: 1800, propertyType: "single_family", listedAt: now, updatedAt: now },
  { id: "fake:1002", provider: "fake", mlsNumber: "1002", status: "active", address: "88 Oak Ave #2", city: "Springfield", postalCode: "01102", listPrice: 315_000, bedrooms: 2, bathrooms: 1, squareFeet: 950, propertyType: "condo", listedAt: now, updatedAt: now },
  { id: "fake:1003", provider: "fake", mlsNumber: "1003", status: "pending", address: "5 Birch Ln", city: "Springfield", postalCode: "01101", listPrice: 520_000, bedrooms: 4, bathrooms: 3, squareFeet: 2400, propertyType: "single_family", listedAt: now, updatedAt: now },
  { id: "fake:1004", provider: "fake", mlsNumber: "1004", status: "active", address: "301 Lake Rd", city: "Shelbyville", postalCode: "01201", listPrice: 749_000, bedrooms: 5, bathrooms: 4, squareFeet: 3200, propertyType: "single_family", listedAt: now, updatedAt: now },
  { id: "fake:1005", provider: "fake", mlsNumber: "1005", status: "active", address: "7 Mill Ct", city: "Springfield", postalCode: "01103", listPrice: 399_000, bedrooms: 3, bathrooms: 2, squareFeet: 1500, propertyType: "townhouse", listedAt: now, updatedAt: now },
];

export class FakeMlsProvider implements MlsProvider {
  readonly key = "fake";
  constructor(private listings: PropertyListing[] = FAKE_LISTINGS) {}

  async search(params: ListingSearch): Promise<PropertyListing[]> {
    const status = params.status ?? "active";
    return this.listings
      .filter((l) => l.status === status)
      .filter((l) => !params.city || l.city.toLowerCase() === params.city.toLowerCase())
      .filter((l) => !params.postalCode || l.postalCode === params.postalCode)
      .filter((l) => params.minPrice === undefined || l.listPrice >= params.minPrice)
      .filter((l) => params.maxPrice === undefined || l.listPrice <= params.maxPrice)
      .filter((l) => params.minBedrooms === undefined || l.bedrooms >= params.minBedrooms)
      .filter((l) => params.minBathrooms === undefined || l.bathrooms >= params.minBathrooms)
      .filter(
        (l) =>
          params.propertyTypes === undefined ||
          params.propertyTypes.length === 0 ||
          params.propertyTypes.includes(l.propertyType),
      )
      .slice(0, params.limit ?? 100);
  }

  async getListing(id: string): Promise<PropertyListing | null> {
    return this.listings.find((l) => l.id === id) ?? null;
  }
}
