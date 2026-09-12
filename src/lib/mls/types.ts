// MLS-001 provider contract (§12). All MLS/IDX vendor specifics live behind
// this interface; application code never imports a vendor SDK directly.
// Canonical listing data synced into the CRM must land in Postgres (the CRM is
// the system of record for anything shown to clients — DATA-001).

export type ListingStatus = "active" | "pending" | "sold" | "withdrawn";

export interface PropertyListing {
  /** provider-scoped id, prefixed by provider key, e.g. "fake:12345" */
  id: string;
  provider: string;
  mlsNumber: string;
  status: ListingStatus;
  address: string;
  city: string;
  postalCode: string;
  listPrice: number;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number | null;
  propertyType: "single_family" | "condo" | "townhouse" | "multi_family" | "land" | "other";
  listedAt: string; // ISO
  /** freshness marker for §22 sync-staleness monitoring */
  updatedAt: string;
}

export interface ListingSearch {
  city?: string;
  postalCode?: string;
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
  minBathrooms?: number;
  propertyTypes?: PropertyListing["propertyType"][];
  status?: ListingStatus;
  limit?: number;
}

export interface MlsProvider {
  readonly key: string;
  /** search active inventory; MUST apply all given filters server-side or locally */
  search(params: ListingSearch): Promise<PropertyListing[]>;
  /** fetch one listing by provider-scoped id; null when gone */
  getListing(id: string): Promise<PropertyListing | null>;
}

/** Buyer criteria stored on a contact (future: contacts.search_criteria) */
export interface BuyerCriteria {
  city?: string;
  maxPrice: number;
  minBedrooms?: number;
  minBathrooms?: number;
  propertyTypes?: PropertyListing["propertyType"][];
}
