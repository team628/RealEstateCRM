# Integration contract — MLS / IDX (MLS-001)

Status: adapter interface, canonical listing model, and buyer-matching logic
implemented and unit-verified against a deterministic fake provider. No live
provider connected (OA-005 — data agreement required first). Fill provider
rows when the vendor is chosen (RESO Web API preferred).

| Aspect | Contract |
|---|---|
| Provider | TBD (RESO Web API / IDX vendor per MLS board agreement) |
| Authentication | provider credentials via edge-function secrets; never client-side |
| Incoming data | listings normalized into `PropertyListing` (`src/lib/mls/types.ts`); provider-scoped ids (`vendor:mls#`); canonical copies synced into Postgres before display (CRM is system of record) |
| Outgoing data | search parameters only; never contact PII (§26) |
| Webhooks / sync | incremental sync on `updatedAt`; `updatedAt` drives the §22 "MLS sync freshness" SLO and the §23 `MLS SYNC DELAYED` health state |
| Rate limits | respected inside the vendor adapter; adapter classifies transient vs terminal errors like the comms adapters |
| Failure behavior | stale-but-served: last-synced Postgres copies remain available, flagged stale |
| Idempotency | upsert by provider-scoped id |
| Data ownership | listing display rules follow the MLS agreement (compliance text, attribution); brokerage's own data never leaves via this integration |
| Tenant mapping | listings are market data (org-neutral); saved searches/alerts are tenant rows keyed by `org_id` + contact |
| Matching | `matchListing`/`matchInventory` (`src/lib/mls/match.ts`) — pure, CALCULATED provenance, reasons attached to every rejection |
