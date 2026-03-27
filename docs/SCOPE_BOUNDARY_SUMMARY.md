# Late Add v2 — Scope Boundary Summary

**Date:** Applied per scope correction: Late Add v2 is **not** a competition rules engine.

## Architectural boundary

- **Late Add v2** ingests or accepts **final point totals per player** (from external apps, manual admin entry, or admin override). It **stores, maps, attributes, corrects, audits, and aggregates** those points into standings.
- **Late Add v2 does NOT** build or plan internal scoring logic for Stableford, match play, best ball, skins, or any other golf format. External systems or human admins determine the points; Late Add does not compute them.

## Docs and code comments updated

| Location | What implied internal format logic | Change made |
|----------|-----------------------------------|-------------|
| **README.md** (root) | "Standalone competition and standings engine"; "derives standings"; "Competition/standings engine" | Replaced with "points-ingestion and standings platform"; "aggregates them into standings"; "Standings/aggregation platform". Added sentence that Late Add does not compute golf formats (Stableford, match play, best ball, skins). Core product table: "Late Add" row now describes it as points-ingestion platform and states it does not compute golf formats. "Standings / competition logic" → "Standings aggregation". |
| **Late_Add_V2_Master_Spec.md** | "Competition and standings engine"; scope not explicit | Goals: "competition and standings engine" → "points-ingestion and standings platform". Scope: added that Late Add is a points-ingestion platform, standings/aggregation engine, and admin correction/attribution system—not a competition rules engine. Out of scope: added "any internal scoring logic for golf formats (Stableford, match play, best ball, skins, etc.)" and "Do not add rules-engine or format-calculation roadmap items for v2." |
| **late-add-api/docs/api.md** | "Points are derived by the system"; "The system derives points internally" for win_loss_override | Added **Architectural boundary** paragraph at top: Late Add ingests/accepts final point totals; does not compute golf formats. win_loss_override: "points are derived by the system" → "the API accepts this input and stores equivalent points (1/0/0.5) for aggregation; the outcome is determined by the source or admin, not by Late Add." Domain rules: "derives points internally" → "Accepts result_type and stores equivalent points...; no golf-format calculation." Standings: "derive" → "aggregate". Integration test bullet: "system derives points" → "accepts result_type and stores equivalent points". |
| **late-add-api/docs/architecture-review.md** | "System derives points" for win_loss; "win_loss derives points"; "win_loss point mapping hardcoded" | win_loss_override: "System derives points" → "API accepts this input and stores equivalent points... Outcome is determined by the source or admin; Late Add does not compute match-play or other format logic." Domain table: "derivation" → "validation; win_loss stores equivalent points from result_type". Gaps: "win_loss point mapping" → "win_loss input mapping (result_type → 1/0/0.5)... input normalization only—Late Add does not compute golf format logic." |
| **Late_Add_V2_Data_Model.md** | Group as "League/competition unit"; scoring_mode without boundary; result_type as neutral | Group: "League/competition unit" → "League unit (group of players)"; scoring_mode clarified as "accepts numeric points or win_loss_override input; no internal format calculation". League score: result_type described as "input format, stored as points for aggregation." |
| **Late_Add_V2_API_Spec.md** | Ingest types only | Ingest line: added "Points are determined by the source or admin; Late Add stores and aggregates them and does not compute golf competition formats." |
| **late-add-api/README.md** | None explicit | Added one sentence: "Late Add does not compute golf competition formats; it accepts final point totals and stores/aggregates them." |
| **late-add-api/supabase/functions/ingest-event-results/index.ts** | Domain rules comment | Comment updated: "Late Add does not compute golf formats; it accepts final point totals (or win/loss/tie as input) and stores/aggregates them. Domain rules: scoring_mode (points vs win_loss_override input)..." |
| **late-add-api/tests/domain-rules.mjs** | "system derives points"; "Derived points" | Console log: "system derives points" → "result_type win/loss/tie accepted and stored as points". Assertion: "Derived points" → "Stored points". |
| **late-add-admin/IMPLEMENTATION_REPORT.md** | "All competition logic remains in the backend" | Replaced with "Late Add v2 is a points-ingestion and standings platform; aggregation and validation remain in the backend (no golf-format calculation in the product)." |
| **Late_Add_V2_UI_Architecture.md** | "league/competition admins"; "recalculates standings"; "Standings are always derived" | "league/competition admins" → "league admins who manage... (points ingestion, attribution, correction, aggregation)". "recalculates standings" → "aggregates standings from stored points". "Standings are always derived" → "computed on the backend from stored event results"; added "Late Add does not compute golf competition formats (e.g. Stableford, match play); it stores and aggregates point totals." |
| **Late_Add_V2_Screen_Map.md** | "recalculation remain backend"; "standings and recalculation" | Core product rule: "recalculation" → "Standings aggregation... correction"; added "Late Add does not compute golf competition formats (e.g. Stableford, match play); it ingests and aggregates point totals." Round edit row: "standings and recalculation" → "standings aggregation". |

## What was not changed

- **Data model and API contract:** No schema or request/response changes. `scoring_mode` (points vs win_loss_override), `result_type`, points range validation, and win/loss/tie → 1/0/0.5 storage behavior are unchanged.
- **Backlog:** No rules-engine or format-calculation roadmap items were present; none added. BACKLOG.md unchanged.
- **Mobile app (Expo):** Late Add v2 Expo app is at `late-add-expo/`. Scorekeeper is a separate project.

## Consistency

- Late Add v2 is now described consistently as: **points-ingestion platform**, **standings/aggregation engine**, and **admin correction and attribution system**. External systems or human admins determine points; Late Add does not compute golf competition formats.
