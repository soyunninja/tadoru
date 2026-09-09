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

## Try it on your own computer first

Before touching a server, run it locally. Nothing is installed system-wide and you can delete it
afterwards by deleting one folder. You need [Node.js](https://nodejs.org) 22 or newer — check with
`node -v`.

```bash
npm install -g tadoru

TADORU_ADMIN_PASSWORD=test1234 \
TADORU_SITES=example.com \
TADORU_DATA_DIR=./tadoru-data \
  tadoru start
```

Open <http://127.0.0.1:3000> and log in with `test1234`. The dashboard will be empty, which is
correct — nothing has visited yet.

*If something else on your machine already has port 3000 — a development server, usually —
Tadoru notices and tries 3001, 3002, and so on up to 3009 until it finds a free one. The startup
line printed in your terminal always names the port it actually bound, e.g. `listening on
127.0.0.1:3001 (3000 was busy; set TADORU_PORT to pin it)` — use that number below instead of
3000 if it differs.*

To see it record something, leave that running and in another terminal:

```bash
curl -H 'Referer: https://example.com/hello' http://127.0.0.1:3000/t.gif
```

Reload the dashboard and there is your first visit. Press `Ctrl+C` in the first terminal to stop,
then `rm -rf ./tadoru-data` to remove everything it wrote.

---

## Install on a server

If you already run servers, this is the whole thing:

```bash
sudo npm install -g tadoru
sudo tadoru install-service --sites example.com,other.dev
sudo systemctl enable --now tadoru
```

`install-service` creates the `tadoru` system user, writes `/etc/tadoru/tadoru.env` with a freshly
generated admin password (printed once — write it down), writes the systemd unit, and reloads
systemd. It never starts or enables the service itself: that stays a separate, explicit step, which
is what `systemctl enable --now` above is. Re-running `install-service` is safe — it never
overwrites an existing `tadoru.env`, so your admin password never changes underneath you.

Then a reverse proxy for HTTPS, and the snippet on your site. Both are in the walkthrough below.

---

## Step by step, assuming nothing

This section explains every step and every word. Skip it if the three commands above were enough.

### What you need before starting

**A server that stays on.** A cheap VPS is fine — Tadoru uses about 100 MB of memory and one small
file for storage, so the smallest plan any provider sells will do. Hetzner, DigitalOcean, OVH and
Scaleway all rent one for a few euros a month. When you create it, choose **Ubuntu** or **Debian**
if you are unsure; the commands below assume one of those.

**A domain name.** You will point a subdomain like `stats.yoursite.com` at the server, so the
dashboard has an address. If your site already has a domain, you can use a subdomain of it and pay
nothing extra.

**A way to connect to the server.** Your provider gives you an IP address and a password or key.
You connect from your own terminal with `ssh root@THE-IP-ADDRESS`. Everything below is typed in
that connection, not on your own computer.

### 1. Install Node.js

Tadoru is a Node.js program, so the server needs Node 22 or newer. Check what is there:

```bash
node -v
```

If that prints nothing, or a number below `v22`, install it:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Run `node -v` again. You want to see `v22` or higher.

*Node 20 and older are not supported. Node 20 stopped receiving security updates in April 2026, and
running a public service on an unpatched runtime is a bad trade.*

### 2. Install Tadoru

```bash
sudo npm install -g tadoru
```

`npm` is Node's package installer. `-g` means "install it for the whole machine", so the `tadoru`
command works anywhere. Check it landed:

```bash
tadoru --version
```

### 3. Set it up

Replace `example.com` with the domain of the site you want to measure. You can list several,
separated by commas and no spaces.

```bash
sudo tadoru install-service --sites example.com
```

This prints a list of what it did, ending with a password. **Copy that password somewhere safe
now** — it is shown once and never again. It is how you log into the dashboard.

If you want to see what it would do without doing it, add `--dry-run` first.

### 4. Start it

```bash
sudo systemctl enable --now tadoru
```

`systemctl` manages background programs on Linux. `enable` means "start this automatically whenever
the server reboots" and `--now` means "and also start it right now". Check it is running:

```bash
sudo systemctl status tadoru
```

You want a line saying `active (running)`. Press `q` to get out of that screen.

### 5. Point your domain at the server

In whoever manages your domain — your registrar or DNS provider — add an **A record**:

| Field | Value |
|---|---|
| Type | `A` |
| Name | `stats` |
| Value | your server's IP address |

An A record is simply the line that tells the internet "this name lives at this IP address". After
adding it, `stats.yoursite.com` points at your server. It usually works within minutes, though it
can take longer.

### 6. Put HTTPS in front

Right now Tadoru only listens on the server's own internal address, so nothing outside can reach
it. That is deliberate: it should not face the internet directly. You put a **reverse proxy** in
front — a small program that receives visitors, handles the HTTPS padlock, and passes requests
inward.

[Caddy](https://caddyserver.com) does this and obtains the certificate for you:

```bash
sudo apt install -y caddy
```

Then replace its configuration:

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
stats.yoursite.com {
	reverse_proxy 127.0.0.1:3000
}
EOF

sudo systemctl reload caddy
```

Use your real subdomain in place of `stats.yoursite.com`. Caddy gets a certificate automatically the
first time someone visits, which takes a few seconds.

Now open `https://stats.yoursite.com` in a browser. You should see the login page. Enter the
password from step 3.

### 7. Add the snippet to your site

In the HTML of the site you are measuring, just before `</head>`:

```html
<script defer src="https://stats.yoursite.com/t.js"></script>
```

For visitors with JavaScript turned off, add this too:

```html
<noscript><img src="https://stats.yoursite.com/t.gif" alt="" width="1" height="1"></noscript>
```

### 8. Check that it works

This is the step people skip and then wonder whether they finished.

1. Open your site in a browser and click through a couple of pages.
2. Go back to `https://stats.yoursite.com` and reload.
3. You should see those visits.

If you see them, you are done.

---

## When it does not work

**The dashboard says nothing was recorded.** Check that the domain in `--sites` is exactly the one
your visitors use. Tadoru silently ignores traffic from any domain not on that list, including
`www.` differences.

**`systemctl status tadoru` says `failed`.** Read the reason:

```bash
sudo journalctl -u tadoru -n 30
```

The most common cause is a missing admin password — Tadoru refuses to start rather than run with no
credentials, and says so plainly.

**The browser cannot reach the address.** The DNS record has probably not taken effect yet. Check
what the world sees:

```bash
dig +short stats.yoursite.com
```

It should print your server's IP. If it prints nothing, wait and try again.

**HTTPS shows a certificate warning.** Caddy could not get a certificate — almost always because the
DNS record is not pointing at this server yet, or because ports 80 and 443 are blocked by a
firewall. `sudo journalctl -u caddy -n 30` says which.

**You lost the admin password.** `/etc/tadoru/tadoru.env` stores only a scrypt hash and its salt
(`TADORU_ADMIN_PASSWORD_HASH` / `TADORU_ADMIN_PASSWORD_SALT`), never the plaintext. A hash cannot
be turned back into the password, so losing it is genuinely unrecoverable rather than merely
inconvenient — reset it instead:

```bash
sudo tadoru reset-password
sudo systemctl restart tadoru
```

This backs up the existing env file to a dated copy alongside it, generates a new password,
prints it once, and rewrites only the credential lines — every other line in the file (comments,
sites, host, port) is left untouched.

---

## Measuring more than page views

The snippet already records pages, referrers, campaigns, countries, devices, engagement time,
scroll depth and outbound clicks without any configuration. Two things you can add.

**Goals and custom events.** Call `tadoru` with a name wherever something happens that matters —
a signup, a purchase, a form sent:

```js
tadoru('signup', { plan: 'pro' })
```

The name appears in the dashboard; the properties are stored alongside it.

**Visitors with JavaScript disabled.** The `<noscript>` pixel from step 7 covers them. It records
the page, referrer, country and device, but not engagement, scroll or clicks — those need a script
running in the page.

---

## Operating it

```bash
systemctl status tadoru      # is it running
journalctl -u tadoru -f      # what is it doing
curl localhost:3000/health   # database and scheduled jobs
tadoru status                # one command answering "is Tadoru working?"
tadoru backup                # a consistent copy of the whole database
sudo npm update -g tadoru && sudo systemctl restart tadoru
```

**One command, one answer.** `tadoru status` checks whether a server is answering, opens the
database read-only to report its size and per-site event counts, and shows each scheduled job's
health — without you having to chain `systemctl`, `curl` and `sqlite3` by hand. It exits non-zero
if the server isn't answering or the database can't be read, so it doubles as a monitoring check.
Add `--json` for scripting:

```bash
tadoru status --json | jq .server
```

Salt rotation, nightly rollups and retention purging run inside the process. There is no crontab
to configure.

**Backups are one file.** `tadoru backup` writes a dated, consistent copy; restoring is copying it
back. That simplicity is the direct payoff of choosing SQLite.

**Restoring is a command, not "copy the file back".** `tadoru restore <backup-file>` does the copy
for you, at the moment an operator is most likely to destroy the data they meant to save:

```bash
tadoru restore /var/lib/tadoru/tadoru-backup-2026-09-08T12-34-56.sqlite
```

It refuses to run while the server is answering — restoring into a database a live process is
writing to can corrupt both files, and this is the one guard that isn't recoverable, so `--force`
is required to skip it. It refuses any file that isn't actually a Tadoru database, checking that it
opens as SQLite *and* carries the tables Tadoru expects, so a mistyped path can't silently clobber
your installation with an unrelated `.db` file. Before touching anything it moves the database
currently in place to a dated file next to it — so restoring the wrong backup still leaves you a
way back — and only then replaces it, removing any stale `-wal`/`-shm` files so the restored
database never starts from an inconsistent journal. `--dry-run` runs every one of those checks for
real and prints the plan without changing anything on disk.

**Lost the admin password? `tadoru reset-password`.** It backs up the env file, generates a new
password, prints it once, and rewrites only the credential lines — see "When it does not work"
above for the full walkthrough.

**A note on hardening.** Running natively means there is no container isolating the process, so
the shipped systemd unit does that work instead: dedicated unprivileged user, no capabilities,
`ProtectSystem=strict`, a restricted syscall filter. Check it with
`systemd-analyze security tadoru`.

**Dashboard language.** The dashboard is available in English, Spanish and Japanese. It follows
your browser's `Accept-Language` by default; set `TADORU_LANG` (to `en`, `es` or `ja`) to fix it
to one language for every visitor instead:

```bash
sudo systemctl set-environment TADORU_LANG=es
sudo systemctl restart tadoru
```

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
