import type { ContactStage } from "@/types";

export const STAGE_LABELS: Record<ContactStage, string> = {
  new: "New",
  engaged: "Engaged",
  qualified: "Qualified",
  appointment: "Appointment",
  active_client: "Active client",
  under_contract: "Under contract",
  closed: "Closed",
  past_client: "Past client",
  archived: "Archived",
};

export const STAGES = Object.keys(STAGE_LABELS) as ContactStage[];
