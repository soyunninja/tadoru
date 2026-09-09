# Why Tadoru needs no consent banner

This document is the reasoning behind Tadoru's design, so that whoever installs it can
justify the choice to their own DPO or auditor. It is engineering documentation, not legal
advice — you are the data controller for your installation and the final assessment is yours.

## Removing cookies is not, by itself, enough

A common and wrong assumption is that a cookieless analytics tool falls outside EU tracking
rules. It does not.

[EDPB Guidelines 2/2023 on the Technical Scope of Art. 5(3) ePrivacy][edpb], adopted in
October 2024, deliberately widened the article beyond cookies. It now reaches tracking
pixels, tracking links, device fingerprinting, local processing whose result is sent off the
device, IoT reporting, and certain forms of IP-based tracking. The Guidelines are explicit
that gaining access and storing information are separate concepts, and that either one is
enough to bring a technique into scope.

So Tadoru is in scope. What keeps it banner-free is not the absence of cookies — it is that
it qualifies for the **audience-measurement exemption**.

## The exemption, condition by condition

The [CNIL's conditions for audience-measurement tools][cnil] are the most concrete published
statement of that exemption. Tadoru is built to satisfy each one by construction rather than
by configuration, so an installation cannot accidentally drift out of compliance.

| Condition | How Tadoru satisfies it |
|---|---|
| Purpose strictly limited to audience measurement | The only outputs are traffic, source, engagement and performance reports. There is no ad targeting, no profiling, no segment export. |
| Data must be anonymous | Stored rows carry a `visitor_id` derived from a salt that is destroyed every 24 hours. Once the salt is gone the value cannot be reversed or re-linked to a person. IP addresses and raw user-agents are never written to disk. |
| For the exclusive account of the publisher | Each installation is single-organisation and self-hosted. Data never leaves the operator's own server. There is no vendor endpoint to phone home to. |
| No cross-site tracking, no shared identifiers | The site domain is one of the hash inputs, so the same visitor on two different sites produces two unrelated identifiers. This is enforced by a unit test. |
| No global navigation tracking | The identifier changes daily and cannot span domains, so no cross-domain journey can be reconstructed. |
| No recoupling with other processing, no transmission of non-anonymous data | There is no third-party integration and no export of raw identifiers. |
| Identifier lifespan capped at 13 months | Not applicable in the usual sense — Tadoru's identifier lifespan is 24 hours, far below the cap. |
| Raw data retention capped at 25 months | The default is 25 months and a daily job enforces it. Configuring a longer window makes the server warn on boot that the exemption no longer applies. |

## What Tadoru deliberately refuses to collect

Each of the following is a recognised fingerprinting signal. Collecting any of them would
place the tool squarely in consent territory, so none is implemented, and a test asserts the
tracker payload schema stays closed against them:

- Canvas and WebGL rendering output
- Font enumeration
- Exact timezone
- Exact screen resolution — only a breakpoint bucket is kept
- Plugin and MIME type lists
- `navigator.hardwareConcurrency` and `navigator.deviceMemory`
- Any identifier that survives the daily salt rotation

## Two honest caveats

**A session that crosses midnight UTC is split in two.** The previous salt is destroyed rather
than retained, which is precisely what prevents day-to-day correlation. The cost is a small
discontinuity in session counts at the rollover. Plausible behaves the same way. Accuracy was
traded for unlinkability on purpose.

**IP addresses are processed, briefly.** Resolving a country requires the IP. It is used in
memory, in-process, against a local database that never makes a network call, and is discarded
before anything is persisted. That transient processing is still processing, and your privacy
notice should say so rather than claim the IP is never seen at all.

## On claiming compliance

The CNIL is explicit that a supplier may not describe its tool as CNIL-certified or
CNIL-validated. The wording it permits is that a solution *complies with CNIL criteria and can
be implemented without user consent if properly configured*. Tadoru's documentation stays
inside that wording, and you should too.

[edpb]: https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf
[cnil]: https://www.cnil.fr/fr/cookies-solutions-pour-les-outils-de-mesure-daudience
