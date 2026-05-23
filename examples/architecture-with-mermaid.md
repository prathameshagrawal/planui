# Event-Driven Order Pipeline

## Summary

Refactor the current monolithic `/checkout` endpoint into an event-driven pipeline. Orders are accepted synchronously, then fanned out to fulfillment, billing, and notification workers via a durable queue. Goal: drop checkout p99 from 1.8s to under 300ms and stop coupling refund retries to live traffic.

## System architecture

```mermaid
flowchart LR
  Client([Web / Mobile Client])
  API[API Gateway]
  Checkout[Checkout Service]
  Queue[(Order Events<br/>SQS)]
  Fulfill[Fulfillment Worker]
  Bill[Billing Worker]
  Notify[Notification Worker]
  DB[(Orders DB)]
  Stripe{{Stripe}}
  Email{{SES}}

  Client --> API
  API --> Checkout
  Checkout -->|order.created| Queue
  Checkout --> DB
  Queue --> Fulfill
  Queue --> Bill
  Queue --> Notify
  Fulfill --> DB
  Bill --> Stripe
  Bill --> DB
  Notify --> Email
```

## Request flow

```mermaid
sequenceDiagram
  participant C as Client
  participant A as API Gateway
  participant S as Checkout Service
  participant Q as SQS
  participant W as Workers
  participant D as Orders DB

  C->>A: POST /checkout
  A->>S: forward (auth'd)
  S->>D: INSERT order (status=pending)
  S->>Q: publish order.created
  S-->>C: 202 Accepted (order_id)
  Note over C,S: Client receives ack in ~150ms

  par fulfillment
    Q->>W: order.created
    W->>D: reserve inventory
  and billing
    Q->>W: order.created
    W->>D: capture payment
  end

  W->>D: UPDATE status=confirmed
```

## Data model

```mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ORDER_ITEM : contains
  ORDER ||--o| PAYMENT : "settled by"
  PRODUCT ||--o{ ORDER_ITEM : "appears in"
  ORDER ||--o{ EVENT : emits

  CUSTOMER {
    uuid id PK
    string email
    string stripe_customer_id
  }
  ORDER {
    uuid id PK
    uuid customer_id FK
    string status
    int amount_cents
    timestamp created_at
  }
  ORDER_ITEM {
    uuid id PK
    uuid order_id FK
    uuid product_id FK
    int quantity
    int unit_price_cents
  }
  PAYMENT {
    uuid id PK
    uuid order_id FK
    string stripe_payment_intent
    string status
  }
  EVENT {
    uuid id PK
    uuid order_id FK
    string type
    jsonb payload
    timestamp emitted_at
  }
```

## Open Questions

- Do we keep `/checkout` returning `202 Accepted`, or block briefly to confirm payment authorization before returning?
  - ( ) Always 202 — workers handle everything async
  - ( ) Block up to 500ms for payment auth, fall back to 202
  - ( ) Keep current synchronous behavior, only fan out non-critical work
- Which queue technology? [tool:sqs] is our default but we've talked about Kafka for replay.
  - ( ) SQS (simpler, already deployed)
  - ( ) Kinesis (replay, but ops overhead)
  - ( ) Kafka via MSK (best replay story, biggest lift)
- Should `EVENT` table be the source of truth, or a side-effect log?

## Preconditions

- Stripe webhook handler already idempotent (verified 2026-04-12)
- SQS dead-letter queue provisioned in staging
- Feature flag `checkout.async_pipeline` available in [mcp:growthbook]

## Steps

1. **Stand up `order.created` event schema** — versioned, with a `schema_version` field. `src/events/order_created.ts`
2. **Wrap checkout writes in transactional outbox** — guarantees event publish iff DB commit succeeds. `src/checkout/handler.ts` `src/db/outbox.ts`
3. **Build fulfillment worker** — consumes from SQS, reserves inventory, writes back. `src/workers/fulfillment.ts`
4. **Build billing worker** (depends on 2) — captures payment, stamps `PAYMENT` row. `src/workers/billing.ts`
5. **Build notification worker** (depends on 2) — sends confirmation email via SES. `src/workers/notification.ts`
6. **Cut over behind flag** — 1% → 10% → 50% → 100% over a week. `config/flags.ts`
7. **Decommission inline fulfillment code path** (depends on 6) — remove the old synchronous handler. `src/checkout/handler.ts`

## Risks

- Outbox table grows unbounded if relay falls behind [high] — add a Cloudwatch alarm on `outbox_lag_seconds > 60`.
- SQS at-least-once delivery means workers must be idempotent [med] — billing worker uses Stripe idempotency keys; fulfillment uses `(order_id, item_id)` unique constraint.
- Client experience regresses if 202 confuses existing clients [low] — coordinate with mobile team; web already handles async.

## Files Touched

- src/checkout/handler.ts
- src/events/order_created.ts
- src/db/outbox.ts
- src/workers/fulfillment.ts
- src/workers/billing.ts
- src/workers/notification.ts
- config/flags.ts
- terraform/sqs.tf

## Changes to Stack

- Add: `@aws-sdk/client-sqs`, `pg-listen` for outbox relay
- Add: SQS queue `order-events` + DLQ
- Remove: inline `await sendConfirmationEmail()` call in checkout handler
