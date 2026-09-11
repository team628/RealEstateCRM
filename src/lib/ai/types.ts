// AI-001 provider abstraction. Providers are swappable; every implementation
// must return output that validates against the schemas here. AI output is
// UNTRUSTED INPUT (§24): callers store it as ai_insights with provenance and
// never overwrite verified contact fields with it.
import { z } from "zod";

export const leadClassificationSchema = z.object({
  contact_type: z.enum([
    "unknown",
    "buyer",
    "seller",
    "buyer_seller",
    "renter",
    "agent_recruit",
    "vendor",
    "other",
  ]),
  intent: z.enum(["buy", "sell", "rent", "browse", "recruit", "vendor", "spam", "unclear"]),
  urgency: z.enum(["low", "medium", "high"]),
  seller_probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(2000),
});

export type LeadClassification = z.infer<typeof leadClassificationSchema>;

/**
 * §26 PII minimization: this is the ONLY contact data an AI provider receives
 * for classification — no ids, no full contact record, no org data.
 */
export interface ClassifyLeadInput {
  firstName: string;
  lastName: string;
  source: string | null;
  sourceDetail: string | null;
  message: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  classifyLead(input: ClassifyLeadInput): Promise<LeadClassification>;
}

export interface AiInsight {
  id: string;
  contact_id: string;
  kind: string;
  value: Record<string, unknown>;
  source: "fact" | "user_provided" | "crm_derived" | "external_provider" | "calculated" | "ai_inferred";
  confidence: number | null;
  model: string | null;
  reasoning: string | null;
  created_at: string;
}
