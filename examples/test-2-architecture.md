## Summary

Design a multi-tenant key vault that isolates customer data at the cryptographic layer, not just the row level. Each tenant gets their own data-encryption keys (DEKs), wrapped by a tenant-scoped key-encryption key (KEK), wrapped by a single root KEK we control. The goal is "delete a tenant's KEK and their data is cryptographically gone" — useful for GDPR right-to-erasure and for blast-radius containment.

```block:tldr
Recommend HashiCorp Vault in Transit mode with per-tenant KEKs, root KEK in AWS KMS, and `[tool:terraform]`-managed enrollment. Self-hosting envelope encryption is technically appealing but adds an auditable surface we don't have headcount to own. Decision deadline: end of Q3.
```

## Open Questions

- ( ) Which root-of-trust do we anchor on? Pick one: AWS KMS / GCP KMS / on-prem HSM.
- [ ] Do we need FIPS 140-2 Level 3 attestation in year one, or is Level 2 acceptable for the GA tier?
- What's the right rotation cadence for tenant KEKs — 90 days, 180 days, or event-driven only? Open to data.

## Architecture

```block:layers
1. Root KEK — single key in AWS KMS, rotated yearly, accessed only by the vault service role
2. Workspace KEKs — one per tenant, stored encrypted-at-rest in `[mcp:postgres-mcp]`, rotated 90d
3. Tenant DEKs — generated per-object, cached in-memory for 60s, never written to disk unencrypted
```

## Trade-off

```block:compare
- HashiCorp Vault (Transit secrets engine)
  - Battle-tested, large operator community
  - Native multi-tenant namespaces
  - Operational cost: one more stateful service to run
- AWS KMS only (no vault layer)
  - Zero ops — fully managed
  - Hard cap of ~10k keys per region; we'd hit it at ~3k tenants
  - No support for our hybrid on-prem deployment SKU
- Self-host envelope encryption
  - Maximum control, no third-party trust
  - We own the key-management code path — auditors will need to review it annually
  - Estimated 6 engineer-weeks to harden vs <1 week for Vault
```

## Steps

1. **Spike Vault Transit in staging** — stand up a single-node cluster behind our existing VPC, prove tenant-namespaced encrypt/decrypt round-trips at p99 < 30ms.
2. **Schema for KEK metadata** — add `tenant_keks` table with `kek_id`, `tenant_id`, `created_at`, `rotated_at`, `status`. Postgres-side via `[mcp:postgres-mcp]`.
3. **Wire envelope encryption into the storage layer** (depends on 2) — wrap every existing `storage.put` / `storage.get` to call vault.encrypt / vault.decrypt with the right tenant KEK.
4. **Migration plan for existing data** — backfill encryption for the ~14M existing objects in batches, with a feature flag to flip read paths per-tenant.

## Risks

- [high] If the root KEK is ever compromised, every tenant's data is at risk. Mitigation: root KEK is in AWS KMS with grant-based access, rotated yearly, and every access is logged to a separate audit account. No human ever sees the raw key.
- [med] Tenant KEK rotation is a write storm if we naively re-encrypt all DEKs. Mitigation: re-wrap-only rotation (the DEKs themselves don't change, just the KEK that wraps them) — bounded to ~1 write per tenant per rotation.

```block:callout
[!warn] SOC2 Type II auditors will want documentation of the key-rotation procedure AND evidence it has actually executed on schedule. Build the rotation runbook and the audit-log query the same week — don't defer the latter.
```
