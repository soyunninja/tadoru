# 0001 — Identify visitors with a daily rotating salted hash

Status: accepted

## Context

The product must count unique visitors and sessions without cookies, without a consent banner,
and while remaining lawful in the EU.

Removing cookies is not sufficient on its own. [EDPB Guidelines 2/2023][edpb], adopted October
2024, extended ePrivacy Art. 5(3) beyond cookies to tracking pixels, tracking links, device
fingerprinting, local processing whose result leaves the device, and certain forms of IP-based
tracking. What removes the banner is the audience-measurement exemption, which requires
anonymous output, no cross-site tracking and bounded retention.

Three options were considered:

1. **Aggregate counters only**, as LibreCounter does. Legally the safest, but it cannot produce
   unique visitors, sessions, bounce rate or funnels at all.
2. **A daily rotating salted hash**, as Plausible and Umami do.
3. **Persistent fingerprinting.** Maximum analytical power, but Art. 5(3) names fingerprinting
   explicitly, so it would require the consent banner the product exists to avoid.

## Decision

Option 2. `visitor_id = blake2b(daily_salt + site_id + ip + user_agent)`, truncated to 16 bytes.
The salt is 32 random bytes, replaced every 24 hours, and only the current value is ever stored.
IP and user-agent are used in memory and never persisted.

The site domain is a hash input specifically so that the same person visiting two measured sites
produces two unrelated identifiers.

## Consequences

- Unique visitors per day, sessions, bounce rate, entry and exit pages, and same-day funnels all
  become available.
- Nothing can be correlated across days or across sites, by construction rather than by policy.
- **A session that crosses midnight UTC is split in two.** The previous salt is destroyed rather
  than retained, which is exactly what prevents day-to-day correlation. Plausible behaves the
  same way. Accuracy was traded for unlinkability deliberately.
- IP addresses are still processed transiently, in memory, to derive the hash and resolve a
  country. The privacy notice must say so rather than claim the IP is never seen.
- Returning visitors, retention and cohort analysis are permanently out of scope. Anyone who
  needs those needs consent, and therefore a different product.

[edpb]: https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf
