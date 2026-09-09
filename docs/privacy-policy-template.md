# Privacy notice template

Paste this into the privacy policy of every site you measure, adjusting the bracketed parts.
It is written to be honest rather than reassuring: it says plainly that an IP address is
processed in transit, because claiming otherwise would be false and is the kind of detail an
auditor checks first.

Translate it into the language of your site. Keep the substance intact.

---

## Analytics

We measure how this site is used with [Tadoru](https://github.com/[owner]/tadoru), a
self-hosted, open-source analytics tool that runs on our own server at `[analytics.example.com]`.
No analytics data is sent to any third party, and nothing is shared with advertisers.

**We do not use tracking cookies.** Nothing is stored on your device, and no identifier of
yours survives beyond the same day.

### What we record

Each page view stores: the page address, the site that referred you, the marketing campaign
that brought you here if any, your country, your browser and operating system family, your
device category, your language, and a coarse screen-size category. We also record how long a
page stayed visible, how far down it was scrolled, clicks on links leading off this site, and
page loading speed measurements.

### How visits are counted without cookies

To tell one visit apart from another we compute a one-way fingerprint-free hash from a
rotating secret, this site's domain, your IP address and your browser's user-agent string.

- The rotating secret is **destroyed and replaced every 24 hours**, which makes it impossible
  to recognise you tomorrow or to connect today's visit to any earlier one.
- The site's domain is part of the hash, so the same person visiting a different site produces
  a completely unrelated value. We cannot follow anyone across the web.
- **Your IP address and user-agent are used only to compute that hash and to look up your
  country, both in memory on our own server. Neither is ever written to disk.** The country
  lookup uses a local database and makes no outside request.

### What we deliberately do not collect

We do not use browser fingerprinting of any kind. Specifically, we do not read canvas or WebGL
output, your installed fonts, your exact timezone, your exact screen resolution, your plugin
list, or your device's memory and processor count.

### How long we keep it

Individual event records are deleted after [25] months. Aggregate statistics, which contain no
identifiers at all, are kept indefinitely.

### Your rights

Because the data is anonymous by design, we hold nothing that we could link back to you, which
means we are genuinely unable to look up, export or delete "your" data on request — there is no
key to search by. If you would prefer not to be counted at all, enabling any standard content
blocker, or your browser's Do Not Track setting, will prevent this measurement.

**Contact:** [privacy@example.com]
