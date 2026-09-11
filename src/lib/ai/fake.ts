// Deterministic heuristic provider used in demo mode and tests. Exercises the
// full AI pipeline (input minimization → provider → schema validation →
// provenance-tagged insight) without an external call. NOT a substitute for
// real-model evaluation (docs/AI_EVALUATIONS.md).
import { leadClassificationSchema, type AiProvider, type ClassifyLeadInput, type LeadClassification } from "./types";

const SELL_WORDS = ["sell", "selling", "valuation", "worth", "cma", "listing", "list my"];
const BUY_WORDS = ["buy", "buying", "purchase", "looking for", "showing", "3br", "bedroom", "preapproved"];
const RENT_WORDS = ["rent", "renting", "lease"];
const SPAM_WORDS = ["seo services", "crypto", "click here", "guaranteed ranking"];

export class FakeAiProvider implements AiProvider {
  readonly name = "fake";
  readonly model = "fake-heuristic-v1";

  async classifyLead(input: ClassifyLeadInput): Promise<LeadClassification> {
    const text = `${input.sourceDetail ?? ""} ${input.message ?? ""}`.toLowerCase();
    const hits = (words: string[]) => words.filter((w) => text.includes(w)).length;

    const sell = hits(SELL_WORDS);
    const buy = hits(BUY_WORDS);
    const rent = hits(RENT_WORDS);
    const spam = hits(SPAM_WORDS);

    let intent: LeadClassification["intent"] = "unclear";
    let contactType: LeadClassification["contact_type"] = "unknown";
    if (spam > 0) {
      intent = "spam";
      contactType = "other";
    } else if (sell > 0 && sell >= buy) {
      intent = "sell";
      contactType = buy > 0 ? "buyer_seller" : "seller";
    } else if (buy > 0) {
      intent = "buy";
      contactType = "buyer";
    } else if (rent > 0) {
      intent = "rent";
      contactType = "renter";
    } else if (input.source === "open_house" || input.source === "sign_call") {
      intent = "buy";
      contactType = "buyer";
    }

    const signalStrength = Math.min(1, (sell + buy + rent + spam) * 0.25 + (input.message ? 0.2 : 0));
    const sellerProbability =
      intent === "sell" ? Math.min(0.95, 0.5 + sell * 0.15) : intent === "buy" ? 0.1 : 0.25;
    const urgency: LeadClassification["urgency"] =
      text.includes("asap") || text.includes("this week") ? "high" : signalStrength > 0.5 ? "medium" : "low";

    const result: LeadClassification = {
      contact_type: contactType,
      intent,
      urgency,
      seller_probability: Number(sellerProbability.toFixed(2)),
      confidence: Number(Math.max(0.3, signalStrength).toFixed(2)),
      reasoning:
        intent === "unclear"
          ? "No clear buying or selling signals in the available data."
          : `Detected ${intent} intent from source and message keywords.`,
    };
    // Providers must return schema-valid output — the fake holds itself to that.
    return leadClassificationSchema.parse(result);
  }
}
