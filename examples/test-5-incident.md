## Summary

47-minute partial outage of the document API on 2026-05-12, affecting roughly 38% of paid traffic. Triggered by a misconfigured `[tool:datadog]` log pipeline that began rate-limiting our application logs, which caused our load-balancer health check (which scrapes a logged endpoint) to flap. Customers saw intermittent 502s on `app.api/documents/*` between 14:03 and 14:50 UTC. No data loss. Pager fired at 14:07, sev-2 declared at 14:12.

```block:tldr
A telemetry config change in `[tool:datadog]` silently throttled our health-check log line, causing the LB to mark healthy pods as unhealthy. We restored by reverting the pipeline; durable fix is to decouple health checks from log inspection.
```

## Root cause

The health check on our document-API pods was implemented as "tail the access log via `[tool:datadog]` and alert if no log line has appeared in 30 seconds." A teammate enabled a new log-volume control rule earlier that morning intending to dampen a noisy debug log — the rule's filter was over-broad and matched every log emitted by the service. Log shipping dropped to ~1% of normal volume, the synthetic health-check saw silence, and the LB began evicting pods that were in fact healthy.

This is a classic two-system coupling we should not have had: the observability stack should never be load-bearing for liveness.

## Timeline

```block:sequence
1. 13:42 UTC — log-volume rule deployed in `[tool:datadog]`; filter is over-broad
2. 14:03 UTC — first 502s observed by external monitoring; error rate climbs from 0.1% to 14%
3. 14:07 UTC — pager fires; on-call acks within 90s
4. 14:18 UTC — sev-2 declared in `[mcp:linear]`; incident channel opened; comms drafted
5. 14:34 UTC — root cause identified by correlating LB eviction events with `[tool:datadog]` audit log
6. 14:50 UTC — `[tool:datadog]` rule reverted; LB stops evicting within 90s; error rate returns to baseline
```

## Impact

```block:table
| Service | Downtime (min) | Affected requests |
| document-api | 47 | ~412,000 |
| webhook-delivery | 12 | ~9,800 (retries succeeded) |
| search-api | 0 | none — separate LB pool |
| billing-api | 0 | none — separate LB pool |
```

## Action items

All tracked in `[mcp:linear]` under the INCIDENT-2026-05-12 epic, owners assigned, with due dates inside one sprint:

1. Replace the log-tail health check with a direct HTTP `/healthz` probe — owner: platform team, due Friday.
2. Add a circuit breaker in our LB controller so that if more than 30% of pods are evicted in under 60 seconds, the controller pauses evictions and pages instead of continuing — owner: SRE, due next sprint.
3. Audit every other "synthetic health check via logs" pattern in our infra — there are at least two more we know about. Owner: platform, due two sprints.
4. Add a `[tool:datadog]` audit-log alert that fires when any log-volume rule is enabled on a service tagged `tier=critical` — owner: observability, due Friday. Pair this with `[tool:pagerduty]` low-urgency for review-not-page.

## Files

- `infra/k8s/document-api/healthcheck.yaml`
- `infra/lb-controller/eviction-policy.ts`
- `infra/datadog/log-pipelines.tf`
- `runbooks/document-api-incident-response.md`

## Risks

- [high] The same coupling exists for at least two other services — until we land action item 3, we're one bad telemetry change away from a similar outage.
- [med] Our incident-comms turnaround was 11 minutes from pager to customer-facing status update. Target is 5 minutes for sev-2. Mitigation: pre-draft status templates and give on-call direct publish access in `[tool:pagerduty]`.
- [med] We don't currently alert on log-volume drops — only spikes. A "sudden silence" detector would have caught this in under 2 minutes.
- [low] The `[tool:datadog]` pipeline change had no peer review. Mitigation: GitOps the pipeline configs so they go through the same PR process as code. Lower severity because the action-item-4 audit alert is the faster fix.
