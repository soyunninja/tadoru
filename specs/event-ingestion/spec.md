# Event ingestion

## Purpose

The pipeline that turns an inbound HTTP request into a stored anonymous row. Its ordering is a
privacy control, not an implementation detail: identifying data must be consumed and discarded
before anything is written.

## Requirements

### Requirement: The site is resolved from request headers alone

The system SHALL determine the measured site from the `Origin` header for beacon requests and
the `Referer` header for pixel requests, and SHALL treat hosts differing only by scheme, port or
a leading `www.` as the same site.

#### Scenario: An unlisted domain is ignored
- **WHEN** a request arrives for a domain that is not in the configured list
- **THEN** the request is rejected, nothing is persisted, and the response reveals nothing about
  why
- Verified by: `src/analytics/application/RecordEvent.test.ts`

### Requirement: Identifying data is discarded before persistence

The system SHALL use the IP address and user-agent only to derive the visitor identifier, to
resolve a country, and to classify a device, and SHALL discard both before constructing the
record to be stored.

The stored record SHALL have no field capable of holding either value.

#### Scenario: Smuggled identifiers are dropped
- **WHEN** an object carrying `ip` and `userAgent` is passed to the record factory
- **THEN** the resulting record has neither property, and neither value appears in its JSON
  serialisation
- Verified by: `src/analytics/domain/event/TrackedEvent.test.ts`

### Requirement: Geolocation is coarse and local

The system SHALL resolve the IP address to an ISO-3166 alpha-2 country code and nothing finer,
using a local database that makes no network request.

### Requirement: Device data is reduced to families

The system SHALL retain only the device type and the browser and operating system families, and
SHALL discard version strings.

#### Scenario: Versions are not retained
- **WHEN** the user-agent identifies `Chrome 131.0.6778.86`
- **THEN** the stored browser value is `Chrome`
- Verified by: `src/analytics/domain/event/DeviceProfile.test.ts`

### Requirement: Ingest responses are fast and uninformative

The system SHALL respond without waiting for persistence: a cached 1×1 GIF for the pixel
endpoint and `204 No Content` for the beacon endpoint. It SHALL respond identically whether the
event was accepted or silently discarded.

### Requirement: Buffered writes do not fragment sessions

The system SHALL consult pending buffered events before the database when resolving a visitor's
previous event.

#### Scenario: Two views inside one flush window are one session
- **WHEN** two page views from the same visitor arrive within a single flush interval
- **THEN** they belong to the same session
- Verified by: the batching repository tests
