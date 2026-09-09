# 0005 — Closed payload schema, bucketed in the browser

Status: accepted

## Context

The stated goal was to collect as much data as possible. Under ePrivacy Art. 5(3) that goal has
to be split in two: behavioural depth is available, identity depth is not. Every fingerprinting
signal added would move the product into consent territory and destroy its reason to exist.

Boundaries stated only in prose erode. Someone eventually adds a "harmless" field.

## Decision

The tracker payload is a closed allow-list, `PAYLOAD_KEYS` in `tracker/payload.ts`. A test
asserts that known fingerprinting keys are absent from it, and a second test asserts that every
key an actual payload emits is declared in the list.

Screen width is bucketed to a breakpoint **in the browser**, so the exact value never crosses
the network. The bucketing function is imported from the domain and inlined by esbuild, so the
browser and the server share one definition instead of two that drift.

Path sanitisation also runs in the browser, using the same `sanitizePagePath` the server uses,
so a query parameter like `?token=…` is stripped before it is ever transmitted.

## Consequences

- Adding a fingerprinting signal now requires deliberately editing an allow-list that a test
  guards. It cannot happen by accident.
- The exact screen width is unrecoverable, and unsanitised URLs never leave the device.
- Sharing pure domain modules with the browser bundle costs some tracker size, currently well
  inside the 6 KB budget, and is worth it to avoid two diverging implementations.
- Do Not Track and Global Privacy Control are checked before any request, because the shipped
  privacy notice promises it. That promise is what makes the check non-optional.
