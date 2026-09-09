# Path sanitisation

## Purpose

A URL is the most common place for personal data to leak into analytics: reset tokens, email
addresses in query strings, account identifiers in path segments. Sanitisation runs in the
browser before transmission and again on the server before persistence.

## Requirements

### Requirement: Only campaign parameters survive the query string

The system SHALL retain only `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
`utm_term` and `ref`, and SHALL discard every other query parameter.

#### Scenario: A secret is stripped
- **WHEN** the path is `/blog/post?utm_source=news&secret=abc`
- **THEN** the sanitised path is `/blog/post?utm_source=news`
- Verified by: `src/analytics/domain/event/PagePath.test.ts`

### Requirement: Identifier-shaped path segments are redacted

The system SHALL replace a path segment that looks like an email address with `:email`, a UUID
with `:uuid`, a run of six or more digits with `:id`, and a token of twenty or more
hexadecimal or base64 characters with `:token`.

#### Scenario: A user id is redacted
- **WHEN** the path is `/order/1234567/receipt`
- **THEN** the sanitised path is `/order/:id/receipt`
- Verified by: `src/analytics/domain/event/PagePath.test.ts`

#### Scenario: A UUID is redacted
- **WHEN** the path contains `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
- **THEN** that segment becomes `:uuid`
- Verified by: `src/analytics/domain/event/PagePath.test.ts`

### Requirement: Fragments are discarded

The system SHALL remove the URL fragment, which never reaches a server in normal browsing and
frequently carries application state.

### Requirement: Sanitisation never fails

The system SHALL NOT throw on malformed input, and SHALL yield `/` when no meaningful path can
be recovered. The system SHALL truncate the result to 1024 characters.

#### Scenario: Garbage input degrades safely
- **WHEN** the input is not a parseable URL or path
- **THEN** the result is `/` and no error is raised
- Verified by: `src/analytics/domain/event/PagePath.test.ts`

### Requirement: The browser sanitises before transmitting

The tracker SHALL apply the same sanitisation before sending, using the same implementation as
the server, so that discarded parameters never cross the network.

#### Scenario: Shared implementation
- **WHEN** the tracker bundle is built
- **THEN** it inlines the server's `sanitizePagePath` rather than reimplementing it
- Verified by: `tracker/payload.test.ts`
