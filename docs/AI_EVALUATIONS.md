# AI EVALUATIONS

No AI functionality is implemented yet (AI-001 NOT STARTED). This framework is
defined now so the first AI feature lands with evaluations, not after.

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
