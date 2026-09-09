# Tadoru （辿る）

Self-hosted web analytics without cookies, without a consent banner, and without sending anything
to anyone else. One Node process and one SQLite file on your own server.

*Tadoru* is Japanese for following a trail — which is what analytics should do to pages, not to
people.

---

## Why no consent banner

Not because it avoids cookies. Removing cookies is not enough on its own: [EDPB Guidelines
2/2023][edpb] extended ePrivacy Art. 5(3) to tracking pixels, tracking links, fingerprinting and
certain IP-based tracking. What actually removes the banner is the audience-measurement
exemption, and Tadoru is built to satisfy it by construction rather than by configuration.

- Visitors are counted with a hash of a **salt that is destroyed every 24 hours**, so nothing links
  one day to the next.
- The site's domain is part of that hash, so the same person on two sites is two unrelated
  visitors. Cross-site tracking is not disabled; it is impossible.
- **IP addresses and user-agents are never written to disk.** They are used in memory to derive
  the hash and to look up a country, then discarded.
- **No fingerprinting.** No canvas, no WebGL, no font list, no exact timezone, no exact
  resolution, no plugin list. The tracker payload is a closed allow-list guarded by a test.
- **Do Not Track and Global Privacy Control are honoured** before any request is sent.
- Raw events expire after 25 months by default.

The full reasoning, condition by condition, is in [`docs/compliance.md`](docs/compliance.md). A
paste-ready privacy notice is in [`docs/privacy-policy-template.md`](docs/privacy-policy-template.md).

You remain the data controller for your installation. This is engineering documentation, not
legal advice.

---

## Install

You need a server with Node 22 or newer and a domain pointing at it. Node 20 reached the end of
its maintenance window in April 2026, so it receives no security updates and is not supported.

```bash
sudo npm install -g tadoru
tadoru init                  # asks for your domains, generates an admin password
sudo tadoru install-service  # creates the user and the systemd unit
```

Then put a reverse proxy in front for TLS. With [Caddy][caddy] that is two lines:

```caddy
tadoru.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Finally, add the snippet to each measured site:

```html
<script defer src="https://tadoru.example.com/t.js"></script>
```

That is the whole installation. No database to provision, no cache, no queue.

### Visitors without JavaScript

Add the pixel fallback. It records the page, referrer, country and device without any script:

```html
<noscript><img src="https://tadoru.example.com/t.gif" alt="" width="1" height="1"></noscript>
```

### Custom events and goals

```js
tadoru('signup', { plan: 'pro' })
```

---

## Operating it

```bash
systemctl status tadoru      # is it running
journalctl -u tadoru -f      # what is it doing
curl localhost:3000/health   # database and scheduled jobs
tadoru backup                # a consistent copy of the whole database
sudo npm update -g tadoru && sudo systemctl restart tadoru
```

Salt rotation, nightly rollups and retention purging run inside the process. There is no crontab
to configure.

**Backups are one file.** `tadoru backup` writes a dated, consistent copy; restoring is copying it
back. That simplicity is the direct payoff of choosing SQLite.

**A note on hardening.** Running natively means there is no container isolating the process, so
the shipped systemd unit does that work instead: dedicated unprivileged user, no capabilities,
`ProtectSystem=strict`, a restricted syscall filter. Check it with
`systemd-analyze security tadoru`.

### Docker, if you prefer it

A single-service `docker-compose.yml` lives in [`docker/`](docker/). There is no database
container because there is no database server.

---

## What it collects

| Without JavaScript | Additionally, with the script |
|---|---|
| Page, referrer, campaign | SPA route changes |
| Country | Time actually visible on the page |
| Browser, OS and device family | Scroll depth milestones |
| Language | Outbound clicks and file downloads |
| | Custom events and goals |
| | Core Web Vitals (LCP, CLS, INP) |
| | Colour scheme, screen size bucket |

Behavioural depth, no identity depth. That trade is the entire design, and
[`docs/adr/`](docs/adr/) records why each part of it was chosen and what it costs.

### What it will never do

Returning visitors, retention curves, cohort analysis and cross-site attribution are all
impossible here, by construction. Anyone who needs those needs consent, and therefore a banner,
and therefore a different tool.

---

## Development

```bash
npm install
npm test                # the full suite
npm run typecheck       # server and tracker, separate configs
npm run dev             # run with --watch
npm run build:tracker   # bundle the browser script, enforcing its size budget
```

Node 22.18 or newer is required to develop, because the server runs TypeScript directly with no
build step. The published package is compiled, so installing it works on any Node 22, which is
supported until April 2027.

Start with [`AGENTS.md`](AGENTS.md) — it holds the invariants, the non-obvious toolchain rules and
the working method. Behaviour is specified in [`specs/`](specs/); every requirement there names
the test that enforces it.

---

## Licence

[AGPL-3.0-only](LICENSE). You may run it, modify it and redistribute it freely. If you offer a
modified version to other people over a network, section 13 requires you to offer them its source
too — which is why every dashboard page links back to the repository and the running version.

That is the whole intent: improvements to a privacy tool should stay available to the people whose
privacy it protects. See [`docs/adr/0006-agpl-and-the-network-clause.md`](docs/adr/0006-agpl-and-the-network-clause.md).

[edpb]: https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf
[caddy]: https://caddyserver.com
