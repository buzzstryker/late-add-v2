\# Late Add v2 System Architecture



\## Structure



\- `mobile/` — user-facing mobile app

\- `backend/` — Supabase backend, migrations, edge functions, tests

\- `docs/` — architecture and product notes



\## Backend responsibilities



\- ingest event results

\- compute standings

\- support overrides

\- compute money deltas

\- generate payment requests



\## Product rules



\- standings are points-only

\- money is only for settlement/payment request generation

\- Late Add does not track payment completion



\## Core backend flow



1\. ingest event results

2\. compute standings from effective points

3\. compute money deltas for a round

4\. generate payer → payee payment requests



\## Current backend endpoints



\- `ingest-event-results`

\- `get-standings`

\- `compute-money-deltas`

\- `generate-payment-requests`

