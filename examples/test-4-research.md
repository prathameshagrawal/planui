## Summary

Two-week spike to evaluate streaming search backends for our document-search product. We need sub-200ms time-to-first-result on 50M docs with incremental indexing (no nightly reindex). The candidates are Tantivy (single-node Rust), Quickwit (Tantivy-as-a-service), and a Postgres `tsvector` + `pg_trgm` baseline. No production code in this spike — only benchmarks, notes, and a recommendation.

## Hypothesis

Tantivy-based options will beat Postgres on cold-search latency by 5-10x, but Postgres will be "good enough" for our top decile of queries if we accept a 300-500ms p95. The interesting question isn't raw speed — it's whether the operational complexity of running a separate index store is justified by the latency improvement our users will actually notice.

## What we'd measure

- p50, p95, p99 latency for three query shapes: short phrase, long phrase, faceted filter.
- Cold-start latency (first query after a 5-minute idle period).
- Index throughput in docs/second under sustained write load.
- Memory footprint at 50M docs, both indexed-resident and disk.
- Time to apply a schema change (add field, reindex implications).

## Out of scope

Anything Elasticsearch-flavored. We've operated ES at two prior companies; the cost-to-staff ratio is well-known and not what we're trying to learn from this spike. Vector search is also out — separate workstream.

## Findings so far

```block:metric
- **240 QPS** — observed throughput on single-node Tantivy, 50M docs, 8-core box
- **18ms** — p50 latency for short-phrase queries on Tantivy
- **310ms** — p95 latency for the same queries on Postgres `tsvector`
- **4.2x** — index size of Tantivy vs Postgres GIN index on the same corpus
```

```block:callout
[!info] Quickwit looks promising as a managed Tantivy: same query engine, object-storage backend, decouples compute from index. Worth a follow-up spike if we choose Tantivy.
```

```block:callout
[!success] Postgres `tsvector` performed better than expected on the warm path — p50 was 45ms, within 2.5x of Tantivy. If we're latency-sensitive only on warm queries, the operational simplicity argument for Postgres is stronger than I thought going in.
```

```block:callout
[!warn] Tantivy's index-merge operation pauses writes for 100-500ms depending on segment size. For our write pattern (bursty ingestion from webhooks) this would manifest as visible lag in the "recently indexed" view. Mitigation paths exist but add complexity.
```

```block:callout
[!danger] Do NOT ship Postgres `pg_trgm` for fuzzy search on a corpus this size — the index doesn't fit in shared_buffers and every fuzzy query hits disk. Observed p99 was 4.8s. This is a dead end, not a candidate.
```

## Open Questions

- [ ] Should we benchmark with our actual production query distribution, or with a synthetic mix? The synthetic mix is easier to share with vendors; the real one is more honest.
- What's our tolerance for a 50-200ms regression on the bottom 10% of queries in exchange for halving operational surface area? Need product input.

## Risks

- [low] Spike could conclude "it depends" and not pick a winner. Mitigation: define a decision rule upfront — "if Tantivy beats Postgres on p95 by more than 3x AND we can prove sub-500ms cold-start, we pick Tantivy; otherwise Postgres wins on simplicity."

```block:tldr
Lean Tantivy (managed via Quickwit). The latency win is real and the index throughput headroom matters for our roadmap. Postgres is the safe fallback if ops bandwidth becomes the constraint — keep it as plan B for one more sprint before committing.
```
