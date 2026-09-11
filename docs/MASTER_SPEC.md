# MASTER SPEC — RealEstateCRM

> **PROVENANCE NOTICE (read first):** The repository was empty when autonomous
> development began (2026-09-11). The original product specification referenced by the
> V2 Execution Directive ("the product specification defines WHAT must ultimately
> exist") was **not present** in the repository or task description. This MASTER_SPEC
> is therefore **DERIVED** from the requirements embedded in the directive itself
> (requirements ledger IDs, user journeys, security/AI constraints, Lovable
> compatibility requirements). Owner review of this derivation is queued in
> `OWNER_ACTIONS.md` (REQUIRED BEFORE PRODUCTION, non-blocking for foundation work).

## 1. Product

A **multi-tenant real-estate brokerage CRM platform** ("RealEstateCRM") for
brokerages and their agents, combining:

1. **CRM core** — unified contact records, activity timelines, tasks, notes.
2. **Lead management** — capture, attribution, scoring, routing/assignment, reactivation.
3. **AI layer** — provider-abstracted AI for classification, extraction,
   next-best-action, seller-probability, conversation summarization, and an AI Sales
   Agent that *requests* actions which trusted code validates and executes.
4. **Automations** — workflow engine with loop protection, idempotency, kill switches.
5. **Communications** — email/SMS/voice via external providers, consent-aware.
6. **MLS integration** — provider-interface (adapter) based property data/search/alerts.
7. **Transactions** — contract-to-closing pipeline.
8. **Reporting** — executive dashboards, ROI, money metrics with labeled
   ACTUAL/ESTIMATED/PROJECTED figures and visible formulas.
9. **Website/lead capture** — public forms feeding the CRM with attribution integrity.

## 2. Tenancy & security model

- Tenant = **organization** (brokerage). All business data rows carry `org_id`.
- **Postgres Row-Level Security enforces tenant isolation at the database layer**
  (SEC-001). Application code is not trusted to filter tenants.
- Roles within an org: `owner`, `admin`, `agent`, `assistant` (extensible).
- AI output is **untrusted input**: AI requests actions; trusted application code
  validates authorization, consent, limits, and org boundaries before execution.
- All AI actions and automations are auditable (audit log + AI action log with
  idempotency keys).
- Admin kill switches (org-level, no deploy required): all AI, all automations,
  outbound email, outbound SMS, voice AI, per-integration, per-workflow, per-agent.

## 3. Technology stack (see DECISIONS.md D-001..D-004)

- **Frontend:** Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui-style
  components. Must remain **Lovable-compatible** (§35 of directive): conventional
  file layout, no exotic frontend abstractions.
- **Backend:** Supabase (Postgres 15+/16, Auth, RLS, Edge Functions). Business rules
  that must be trusted live in SQL (RLS, constraints, triggers, RPC functions) or
  edge functions — never only in the browser.
- **Migrations:** SQL files in `supabase/migrations/`, additive/backwards-compatible
  by preference (§21).
- **Local verification:** migrations + RLS are tested against a real local Postgres 16
  with a faithful `auth.*` stub (JWT-claim GUCs identical to Supabase's mechanism).

## 4. Major requirements (authoritative tracker: REQUIREMENTS_LEDGER.md)

SEC-001 tenant isolation; CRM-001 unified contact record; CRM-002 activity timeline;
LEAD-001 capture+attribution; LEAD-002 routing/assignment; AI-001 provider
abstraction; AI-002 sales agent; AUTO-001 workflow engine; COMM-001 communications;
MLS-001 provider interface; TXN-001 transaction pipeline; RPT-001 reporting;
OPS-001 kill switches; OPS-002 audit/observability; DATA-001 exportability.

## 5. Critical user journeys

Tracked in `USER_JOURNEYS.md` (J01–J10), from "Internet Lead → Appointment" through
"Broker → Executive Dashboard → ROI".

## 6. External dependencies (not buildable autonomously)

Supabase project provisioning, AI provider API keys, email/SMS/voice providers, MLS
data agreements, domain/hosting. Tracked in `EXTERNAL_REQUIREMENTS.md` and
`OWNER_ACTIONS.md`. Everything else is built and verified independently of these,
behind adapters (§12).

## 7. Completion standard

Every ledger requirement ends in exactly one state: PRODUCTION READY /
FUNCTIONALLY COMPLETE — EXTERNAL CONNECTION REQUIRED / BLOCKED — OWNER ACTION
REQUIRED / DEFERRED — DOCUMENTED TECHNICAL REASON / REJECTED. "VERIFIED" is used
only after validation has actually executed (tests run, not assumed).
