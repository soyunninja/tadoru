# Specifications

One directory per capability, each holding a `spec.md` written as requirements and scenarios.

These are the contract. When code and spec disagree, the code is wrong — unless the spec was
changed first, on purpose. Every requirement here is backed by at least one test; the
`Verified by` line names it, so a reader can go straight from a stated rule to the assertion
that enforces it.

The format is deliberately the one Spec-Driven Development consumes: `SHALL` requirements with
`WHEN`/`THEN` scenarios. Adopting an SDD workflow later means pointing it at this directory,
not rewriting anything. Nothing in here is specific to any particular coding assistant.

## Capabilities

| Capability | What it governs |
|---|---|
| `visitor-identity` | How a visitor is counted without cookies, and the limits on that identity |
| `event-ingestion` | The pipeline from an inbound request to a stored anonymous row |
| `path-sanitisation` | Stripping identifiers and secrets out of URLs |
| `browser-tracker` | What the client script may collect, and what it must refuse to |
| `reporting` | Turning events into numbers, and why unique visitors do not add up |
| `data-retention` | What expires, when, and what happens if that window is widened |
| `installation` | What the service refuses to do when misconfigured on someone's VPS |
| `dashboard` | Rendering attacker-controlled values safely, and reading the numbers correctly |

## Writing a new one

State the rule as an observable behaviour, not as an implementation. `The system SHALL discard
the IP address before persistence` is a requirement. `RecordEvent calls deriveVisitorId` is not
— that is a design note and belongs in `docs/adr/`.
