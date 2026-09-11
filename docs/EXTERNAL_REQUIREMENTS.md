# EXTERNAL REQUIREMENTS

Things that cannot be provisioned autonomously. Everything here is behind adapters or
env config; development continues without them.

| Item | Needed for | Blocking? |
|---|---|---|
| Supabase project (staging + prod) + `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` | deploying schema, auth, real data | Not for dev (local PG16 harness verifies schema/RLS) |
| AI provider API key(s) (Anthropic recommended) | AI-001/AI-002 | Yes, for AI features only |
| Email provider (e.g. Resend/SendGrid) | COMM-001 email | Yes, for sending only |
| SMS/voice provider (e.g. Twilio) + A2P 10DLC registration | COMM-001 SMS/voice | Yes; A2P registration has lead time |
| MLS data agreement + provider (RESO Web API / IDX vendor) | MLS-001 | Yes; legal lead time |
| Domain + hosting for public site/forms | website lead capture in prod | No (forms work in-app) |

Integration data contracts (§12) will be documented per provider in
`docs/contracts/<provider>.md` when each integration starts.
