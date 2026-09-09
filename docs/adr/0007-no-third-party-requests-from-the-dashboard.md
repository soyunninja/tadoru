# 0007 — The dashboard makes no third-party requests

Status: accepted

## Context

The country and operating-system breakdowns gained small visual markers, and the obvious next
step was a favicon beside each row of the pages and referrers tables. Favicons are the standard
decoration in every analytics dashboard on the market.

Fetching one means the administrator's browser requests `https://<domain>/favicon.ico`. That has
three costs, and they compound:

- The dashboard's content security policy is `img-src 'self' data:`, so the request is blocked.
  Loosening the policy to allow it would also re-open the page to remote image loading in general.
- Every fetched favicon tells that domain someone is looking at analytics, and from which IP. For
  a referrer table, those domains are arbitrary third parties nobody chose to talk to.
- A product whose entire argument is that it sends nothing to anyone cannot quietly make outbound
  requests in its own interface. The claim would become conditional, and a conditional privacy
  claim is worth very little.

## Decision

The dashboard makes no network request to any origin but its own. No favicons, no icon CDNs, no
web fonts, no analytics-on-the-analytics, no remote images of any kind.

Where a visual marker genuinely helps, it is derived locally or not shown at all:

- Country flags come from arithmetic on the ISO code — regional indicator symbols — not from an
  image or a lookup table.
- Operating-system icons are emoji, chosen over vendor logos because the logos are trademarks
  whose redistribution inside an AGPL project carries conditions of its own.
- An unrecognised value shows no marker. Nothing is better than a wrong guess.

## Consequences

- Pages and referrers stay plain text. The tables are less decorated than a commercial dashboard,
  and that is the accepted cost.
- The content security policy stays strict enough to be a real control rather than a formality.
- The privacy claim stays unconditional and easy to verify: open the network tab and there is
  nothing to explain.
- **The pressure to add favicons will recur**, because they look good and every competitor has
  them. Anyone reversing this should first re-read the second and third bullets above, and record
  a new ADR rather than editing this one.
