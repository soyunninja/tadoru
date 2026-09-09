# 0006 — AGPL-3.0-only, and what its network clause obliges us to build

Status: accepted

## Context

Tadoru is software people run on their own servers. The licence decides whether someone may take
it, improve it, and offer the result as a closed hosted service without giving anything back.

- **MIT** permits exactly that. A company could run a proprietary fork as a SaaS and never
  publish a line.
- **GPL-3.0** closes that for distributed software, but running a service is not distribution, so
  the hosted-fork route stays open.
- **AGPL-3.0** closes it: section 13 extends the source-offer obligation to users who interact
  with the program *over a network*. It is what Plausible and Umami use, for the same reason.

## Decision

AGPL-3.0-only. The canonical text is in `LICENSE`, downloaded verbatim from gnu.org.

## Consequences

- A hosted fork must publish its modified source to the people using it. Improvements come back.
- Some companies forbid AGPL dependencies outright. That is a deliberate trade: this is a product
  to run, not a library to embed, so the cost is small and the protection is the point.
- **Section 13 is a build obligation, not a formality.** The dashboard is the network interface
  through which an operator interacts with the program, so it must offer the corresponding
  source: a visible link to the repository, and to the exact version running, in the footer of
  every dashboard page. A licence file alone does not discharge this.
- The tracker script served to visitors is also delivered over a network. Its bundle carries a
  `@license AGPL-3.0-only` banner with a source URL, which is why `legalComments` must not strip
  it from the build output.
- Contributors keep their own copyright; the project claims none of it.
