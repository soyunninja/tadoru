# Dashboard

## Purpose

The administrator's window onto the data. It is also the most attractive target in the system:
the session cookie it issues is the keys to the installation.

## Requirements

### Requirement: Stored values are never rendered unescaped

Values read from the database SHALL be HTML-escaped before rendering, in text nodes, in attribute
values and in SVG text alike.

Escaping SHALL be the default: rendering happens through a tagged template that escapes every
interpolated value, and skipping it SHALL require an explicit marker used only for fixed, literal
fragments.

Paths, custom event names and event properties are chosen by whoever visits a measured site, so
they are attacker-controlled input.

#### Scenario: A script payload stored as a page path is neutralised
- **GIVEN** a visitor is recorded with the path `/x"><script>alert(1)</script>`
- **WHEN** the administrator opens that site's overview
- **THEN** the page contains no `<script` tag originating from that value
- **AND** the fully escaped form of the payload is present instead
- Verified by: `src/analytics/infrastructure/http/views/escapeHtml.test.ts`

### Requirement: The dashboard runs without JavaScript

The system SHALL send `Content-Security-Policy: default-src 'none'` with no script source, plus
`X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`, and every page SHALL be
fully usable with scripting disabled.

#### Scenario: The policy forbids scripts outright
- **WHEN** any dashboard page is served
- **THEN** the content security policy permits no script source
- Verified by: `src/analytics/infrastructure/http/dashboardRoutes.test.ts`

### Requirement: Authentication precedes site lookup

The system SHALL require a valid session for every page except the login form, and SHALL redirect
rather than reveal anything. An unconfigured site SHALL return 404 without disclosing which sites
exist.

#### Scenario: An anonymous visitor learns nothing
- **WHEN** `/dashboard` is requested without a session
- **THEN** the response redirects to the login page
- Verified by: `src/analytics/infrastructure/http/server.test.ts`

### Requirement: The dashboard is registered on the running server

The routes SHALL be reachable from the server the CLI actually starts.

#### Scenario: The login page answers on a built server
- **WHEN** the server is built from configuration and `/login` is requested
- **THEN** the response is 200 HTML
- Verified by: `src/analytics/infrastructure/http/server.test.ts`

### Requirement: Headline totals are exact, not summed from an unsafe dimension

Headline visitor and session totals SHALL be derived from a dimension that is constant per visitor
for the day — device, country, browser or operating system — because those are functions of the
IP and user-agent that already feed the visitor hash. Totals SHALL NOT be summed from the path,
referrer or campaign dimensions, where one visitor legitimately appears in several rows.

This is exact rather than approximate: a visitor id hashes the user agent, and the device is a
function of that same string, so one id can never span two device rows.

**That guarantee is enforced, not merely documented.** If device resolution ever took an input the
hash does not — client hints, most likely — two events could share an id and land in different
rows, and the headline would inflate with nothing failing. A test asserts the resolver is called
with the user agent and nothing else.

#### Scenario: the device resolver sees only hashed inputs
- **WHEN** an event is recorded
- **THEN** the device resolver is called with the user agent alone
- Verified by: `src/analytics/application/RecordEvent.test.ts`

### Requirement: The page explains why breakdowns do not add up

The overview SHALL carry a plain-language note stating that visitor counts do not sum across a
breakdown, because one person visiting two pages is one visitor and two rows.

#### Scenario: The explanation is present
- **WHEN** the overview renders a breakdown table
- **THEN** it includes a note that the column will not match the headline total
- Verified by: `src/analytics/infrastructure/http/views/components.test.ts`

### Requirement: The corresponding source is offered

Every page SHALL link to the project repository and state the exact running version, as AGPL
section 13 requires of a program users interact with over a network.

#### Scenario: The footer carries the link and version
- **WHEN** any page renders
- **THEN** its footer links to the repository and names the running version
- Verified by: `src/analytics/infrastructure/http/views/layout.test.ts`
