// Pure listing↔buyer matching (feeds J02 property alerts and J08 buyer match).
// Deterministic CALCULATED logic (§14) — not AI inference.
import type { BuyerCriteria, PropertyListing } from "./types";

export interface MatchResult {
  listingId: string;
  matched: boolean;
  reasons: string[];
}

export function matchListing(listing: PropertyListing, criteria: BuyerCriteria): MatchResult {
  const reasons: string[] = [];
  if (listing.status !== "active") reasons.push("listing is not active");
  if (listing.listPrice > criteria.maxPrice) {
    reasons.push(`over budget (${listing.listPrice} > ${criteria.maxPrice})`);
  }
  if (criteria.city && listing.city.toLowerCase() !== criteria.city.toLowerCase()) {
    reasons.push("different city");
  }
  if (criteria.minBedrooms !== undefined && listing.bedrooms < criteria.minBedrooms) {
    reasons.push("too few bedrooms");
  }
  if (criteria.minBathrooms !== undefined && listing.bathrooms < criteria.minBathrooms) {
    reasons.push("too few bathrooms");
  }
  if (
    criteria.propertyTypes !== undefined &&
    criteria.propertyTypes.length > 0 &&
    !criteria.propertyTypes.includes(listing.propertyType)
  ) {
    reasons.push("wrong property type");
  }
  return { listingId: listing.id, matched: reasons.length === 0, reasons };
}

export function matchInventory(
  listings: PropertyListing[],
  criteria: BuyerCriteria,
): PropertyListing[] {
  return listings
    .filter((l) => matchListing(l, criteria).matched)
    .sort((a, b) => a.listPrice - b.listPrice);
}
