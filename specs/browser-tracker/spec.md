# Browser tracker

## Purpose

The client script embedded in measured pages. It collects behavioural depth and refuses identity
depth. See `docs/adr/0005-closed-payload-schema-and-client-side-bucketing.md`.

## Requirements

### Requirement: The payload schema is closed

The tracker SHALL emit only keys declared in an explicit allow-list, and SHALL NOT emit any key
absent from it.

#### Scenario: Fingerprinting keys are absent from the schema
- **WHEN** the payload schema is inspected
- **THEN** it contains none of `canvas`, `webgl`, `fonts`, `timezone`, `resolution`, `plugins`,
  `hardwareConcurrency`, `deviceMemory`, `userAgent` or `ip`
- Verified by: `tracker/payload.test.ts`

#### Scenario: No undeclared key can be emitted
- **WHEN** a payload is constructed
- **THEN** every one of its keys appears in the allow-list
- Verified by: `tracker/payload.test.ts`

### Requirement: Opt-out signals are honoured before any request

The tracker SHALL send nothing when Do Not Track is enabled, when Global Privacy Control is set,
when the page is prerendering, when the protocol is `file:`, or when the hostname is local.

#### Scenario: Do Not Track suppresses measurement
- **WHEN** `navigator.doNotTrack` is `1`, `yes` or `true`
- **THEN** no request is made
- Verified by: `tracker/consent.test.ts`

#### Scenario: An unset preference is not an opt-out
- **WHEN** `navigator.doNotTrack` is `0` or `unspecified`
- **THEN** measurement proceeds
- Verified by: `tracker/consent.test.ts`

#### Scenario: Global Privacy Control suppresses measurement
- **WHEN** `navigator.globalPrivacyControl` is `true`
- **THEN** no request is made
- Verified by: `tracker/consent.test.ts`

### Requirement: Screen width is bucketed on the device

The tracker SHALL convert the viewport width to a breakpoint bucket before transmission and
SHALL NOT transmit the exact width.

#### Scenario: The exact width is unrecoverable
- **WHEN** the viewport is 1443 pixels wide
- **THEN** the payload carries the bucket `xl` and the value 1443 appears nowhere in it
- Verified by: `tracker/payload.test.ts`

### Requirement: Engagement counts only visible time

The tracker SHALL accumulate time while the page is visible and SHALL exclude time while it is
hidden.

#### Scenario: A backgrounded tab accrues nothing
- **WHEN** a page is hidden for an hour and never shown again
- **THEN** the reported engagement is zero seconds
- Verified by: `tracker/payload.test.ts`

### Requirement: Scroll milestones are reported once

The tracker SHALL report each of the 25, 50, 75 and 100 percent milestones at most once per page
view, and SHALL NOT re-report a milestone when the visitor scrolls back up.

#### Scenario: Scrolling back up reports nothing
- **WHEN** the deepest point reached is 100 percent and the visitor scrolls back to 40 percent
- **THEN** no milestone is reported
- Verified by: `tracker/payload.test.ts`

### Requirement: The tracker never breaks the host page

The tracker SHALL swallow its own network and observer errors, and SHALL register scroll and
click listeners as passive.

### Requirement: The bundle is actually served

The system SHALL serve the built bundle at `/t.js`, cacheable and readable from any origin, since
every measured site embeds it cross-origin. When the bundle has not been built, the system SHALL
answer 503 with a message naming the build step, and SHALL warn at startup — never a bare 404,
which reads like a typo in the snippet and sends the operator looking in the wrong place.

#### Scenario: The documented snippet works against a built server
- **WHEN** `/t.js` is requested from a running server
- **THEN** the response is 200 JavaScript carrying the licence banner
- Verified by: `src/analytics/infrastructure/http/server.test.ts`

### Requirement: The tracker stays small

The built bundle SHALL remain within a declared byte budget, and the build SHALL fail rather
than silently exceed it.

#### Scenario: Exceeding the budget fails the build
- **WHEN** the bundle grows beyond the declared budget
- **THEN** `npm run build:tracker` exits non-zero
- Verified by: `tracker/build.ts`
