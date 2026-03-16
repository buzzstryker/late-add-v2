# Late Add v2 — Master Spec

Product goals and scope. For status, architecture, UI direction, and terminology see [README.md](./README.md).

---

## Goals

- Provide a **standalone competition and standings engine** for golf that any compliant app can use as a backend.
- Ingest **points and results** from external golf apps via a well-defined API; maintain groups, seasons, events, and results; expose **points-only standings**.
- Support optional **payout configuration** and **round-scoped payment request generation** for settlement workflows, without tracking payment completion in the product.

## Scope

- **In scope:** API-first ingestion; groups, seasons, events (rounds), results; points-only standings; group-level payout config; round-scoped money_delta computation and payment-request generation; Late Add app UI (in progress).
- **Out of scope (current):** Running rounds or capturing scores inside Late Add; settlement ledger or payment-completion tracking; stroke-play or handicap calculation inside the API (sources send points or derived results).

## Success criteria

- External apps can POST event results and read standings and payment requests using the documented API.
- Standings are correct and points-only; payout and payment-request behavior are optional and do not affect standings.
- Late Add app UI supports the core flows (groups, seasons, ingest, standings, rounds, payment requests) using the existing API.

## References

- [README.md](./README.md) — Overview, current architecture, UI starting point, terminology
- [Data Model](./Late_Add_V2_Data_Model.md)
- [API Spec](./Late_Add_V2_API_Spec.md)
- [Screen Map](./Late_Add_V2_Screen_Map.md)
- [Migration Notes](./Late_Add_V2_Migration_Notes.md)
