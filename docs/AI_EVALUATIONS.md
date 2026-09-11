# AI EVALUATIONS

Status: the lead-classification pipeline exists (AI-001). Its *mechanical*
defenses are covered by executed unit tests (fencing, PII minimization, schema
validity, kill switch) — but no real-model evaluation has run yet because no
API key exists (OA-003). Suite 1 below must be populated with representative
cases and run against the live provider before the classifier is production
ready. The deterministic FakeAiProvider is NOT evidence of model quality.

## Scenario suites (to be populated with representative cases as features land)
1. Lead classification (buyer/seller/renter/agent-recruit/spam)
2. Intent detection in inbound messages
3. Structured extraction (address, price range, timeline, preapproval)
4. Next-best-action recommendation
5. Seller-probability reasoning
6. Conversation summarization
7. Property matching
8. AI Sales Agent responses (tone, accuracy, compliance)
9. Human escalation triggers
10. Unsafe action prevention (prompt injection, consent violation, cross-org reference)

## Measured per suite
accuracy · structured-output validity (schema-parse rate) · tool selection ·
permission adherence · hallucination rate · escalation correctness · cost/case ·
p95 latency

## Gate
An AI agent is not production-ready on generation ability alone; it must pass its
suite thresholds (set per-suite when the suite is populated) and the §24/§25
security boundaries: AI proposes into `ai_actions`; trusted code validates and
executes; external content never redefines permissions.
