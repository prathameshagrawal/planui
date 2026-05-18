## Summary

Session refresh fails intermittently — about 12% of `/v2/refresh` calls return 401 even with a valid refresh token. Root cause is a race between the token-rotation write and the read-replica lookup that validates the next refresh. We'll add an idempotency key and read-your-writes on the rotation path.

```block:callout
[!info] This bug is the top driver of unexpected logouts this quarter — it triples support volume on Mondays after long weekends, when tokens are most likely to refresh near their TTL boundary.
```

## Steps

1. **Add idempotency key to `/v2/refresh`** — accept `Idempotency-Key` header; cache the rotated token pair in Redis for 60s so retries return the same result instead of a 401.
2. **Force primary read on rotation lookup** — bypass the read replica in `src/auth/refresh-token.ts` for the validation query that immediately follows a rotation write.
3. **Add regression test** — reproduce the race with a 50ms-delayed replica fixture; assert the retried refresh succeeds.

## Risks

- [low] The idempotency cache adds a Redis write per refresh; throughput is well under our current headroom (refreshes peak at ~80 rps, Redis handles 10k+).
