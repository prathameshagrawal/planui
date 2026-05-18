## Summary

Replace session-cookie auth with OIDC across the API gateway, web app, and admin service. Driven by SOC2 compliance commitments rather than tech debt. Estimated 2 days of focused work plus a 24h dual-write cutover window.

## Open Questions

1. Auth0 or Clerk as the OIDC provider? (Trade-off: Auth0 cost per MAU and existing ops familiarity vs Clerk DX, built-in UI components, and faster onboarding.)
2. Migrate existing user sessions, or force re-login on cutover? (Trade-off: 24h dual-auth complexity and a session-bridge module vs a clean cut with one-time user friction.)

## Preconditions

- OIDC provider tenant provisioned and verified (Auth0 or Clerk per Q1)
- Staging database snapshot taken and restore tested
- Feature flag `auth_oidc_enabled` created in GrowthBook with staging rollout at 0%
- On-call notified of cutover window and runbook linked

## Steps

1. **Add OIDC SDK + provider config** — installs `openid-client` and wires the chosen provider via env-driven config so the same code path serves dev, staging, and prod. Touches `src/auth/oidc.ts`.
2. **Replace session middleware** — swap `express-session` for OIDC JWT verification, with JWKs caching and clock-skew tolerance. Touches `src/auth/middleware.ts`.
3. **Update login route** (depends on 2) — wire the OIDC redirect flow, the `/callback` handler, and the post-auth redirect map. Touches `src/api/login.ts`.
4. **Migrate session tokens** — dual-write old sessions to OIDC tokens for 24h to enable invisible cutover. Touches `src/auth/session-bridge.ts`.
5. **Update integration tests** — replace mocked session helpers with OIDC fixtures and add a live-provider smoke test gated to CI. Touches `tests/auth.test.ts`.
6. **Deploy and cut over** (depends on 5) — flip the GrowthBook flag in staging, monitor for 1h, then promote to prod in 10% increments. Touches `infra/growthbook/flags.yaml`.

## Files

- `src/auth/oidc.ts`
- `src/auth/middleware.ts`
- `src/auth/session-bridge.ts`
- `src/auth/types.ts`
- `src/api/login.ts`
- `tests/auth.test.ts`
- `tests/fixtures/oidc-tokens.json`
- `infra/growthbook/flags.yaml`
- `infra/terraform/auth-provider.tf`

## Risks

- Session migration may invalidate active users mid-flight [med] — mitigated by the 24h dual-write window and a gradual GrowthBook rollout starting at 10%.
- OIDC provider downtime becomes a hard auth dependency [high] — mitigated by JWKs cached locally for 1h with graceful fallback to existing sessions during the dual-write window.
- Test fixture changes may mask real regressions [low] — caught by keeping a small set of integration tests that exercise the live provider in CI nightly.

## Stack Changes

- + `openid-client`
- + Auth0 SDK (or Clerk SDK per Q1)
- − `express-session` (sunset after migration window closes)
- − `connect-redis` (sunset with sessions)

## Rollback Plan

If anything goes wrong post-cutover, flipping `auth_oidc_enabled` off in GrowthBook restores the session middleware path. The dual-write window keeps both auth stacks live for 24h, so rollback within that window is invisible to users. After 24h the bridge closes; rollback past that point requires reissuing all sessions.
