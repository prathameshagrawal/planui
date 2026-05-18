## Summary

Migrate the `orders` table primary key from auto-incrementing `BIGINT` to `UUID v7`. Driver is sharding readiness — the current integer PK is a single point of contention for the planned tenant-shard rollout, and our analytics pipeline keeps tripping over ID collisions when we replay events across environments. Cutover targets a 3-hour low-traffic window on a Sunday with feature-flagged read switching so we can roll back in under 30s.

## Preconditions

- `[tool:pgbouncer]` connection pool drained of long-running transactions (we'll briefly run with `pool_mode = transaction` during cutover).
- All downstream consumers (warehouse ETL, ML training jobs, webhook delivery) have been audited and confirmed to treat `order_id` as opaque — no parsing, no math.
- The `uuid-ossp` extension is enabled in production; pre-verified with a dry run on the staging replica two weeks ago.

## Schema delta

```block:table
| Column | Old type | New type |
| id | BIGINT (identity) | UUID (v7, default `uuidv7()`) |
| customer_id | BIGINT | BIGINT (unchanged this migration) |
| total_cents | INT | BIGINT (widened, in scope) |
| created_at | TIMESTAMP | TIMESTAMPTZ (UTC-explicit) |
| legacy_id | — | BIGINT (NEW — preserves old integer ID for back-compat) |
| status | VARCHAR(32) | order_status (NEW enum type) |
```

## Cutover phases

```block:sequence
1. Shadow write — every INSERT/UPDATE writes both `id` (BIGINT) and `id_v2` (UUID) for 7 days
2. Backfill — fill `id_v2` for historical rows in 50k-row batches, ~6M rows total, ~2 hours of background work
3. Read switch — flip readers to `id_v2` behind a per-route feature flag, monitor for 48 hours
4. Drop legacy — rename `id_v2` → `id`, drop the old BIGINT column, drop the shadow-write triggers
```

## Steps

1. **Add `id_v2` UUID column with default** — non-blocking ADD COLUMN with `DEFAULT uuidv7()`; new rows get a UUID immediately, existing rows are NULL until backfill.
2. **Install shadow-write trigger** — `BEFORE INSERT OR UPDATE` trigger that ensures `id_v2` is populated for every write going forward.
3. **Add `legacy_id` column and backfill** — copy the existing `id` value into `legacy_id` for every existing row. This is what gives us a clean rollback path: every old integer ID is preserved.
4. **Backfill `id_v2` for historical rows** (depends on 1) — script runs in 50k-row batches with a 200ms sleep between batches to keep replica lag under 5s. Restartable; tracks progress in a `_migration_state` table.
5. **Add UUID indexes and foreign-key shadows** (depends on 4) — every table that references `orders.id` gets a parallel `order_uuid` FK column, populated via JOIN-backfill.
6. **Application code: dual-read with UUID-preferred lookup** — change every `findOrder(id)` to try UUID first, fall back to BIGINT if not found. Feature-flagged per route.
7. **Read-path cutover** (depends on 5, 6) — flip the feature flag globally, monitor error rate and p99 latency for 48 hours. Rollback is one flag flip.
8. **Drop legacy column and triggers** (depends on 7) — rename `id_v2` → `id`, drop the old `id` (now `legacy_id` is the historical reference), remove shadow-write triggers. This is the only step that's irreversible — we wait two full weeks of clean dual-read before scheduling it.

## Files

- `migrations/2026_05_18_orders_uuid_add_v2.sql`
- `migrations/2026_05_19_orders_uuid_shadow_trigger.sql`
- `migrations/2026_05_25_orders_uuid_backfill.sql`
- `migrations/2026_06_08_orders_uuid_drop_legacy.sql`
- `src/db/orders.ts`
- `src/db/orders-dual-read.ts`
- `scripts/backfill-orders-uuid.ts`

## Risks

- [high] An incorrect FK shadow could corrupt referential integrity in `order_items` or `payments`. Mitigation: every FK shadow is verified by a row-count + checksum query before the read switch, and we keep the BIGINT FK column alive through phase 4.
- [med] Replica lag spikes during backfill could degrade read latency. Mitigation: batches are sized to keep `pg_stat_replication.replay_lag` under 5s; the backfill script auto-pauses if lag exceeds 10s.
- [low] UUID v7 is technically newer than UUID v4 and a couple of our older client SDKs may sniff for v4-specific bit patterns. Mitigation: audited all SDKs in scope two weeks ago; none assume a specific version.

## Stack Changes

- Add: `uuid-ossp` extension (already enabled in staging, pending prod approval).
- Add: `_migration_state` table — tracks long-running backfill progress so we can restart safely.
- Remove: the `orders_id_seq` sequence, dropped in phase 4 after the BIGINT column is gone.
