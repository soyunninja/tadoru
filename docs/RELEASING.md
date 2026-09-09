# Releasing

## Before the first publish — change the repository URL in one place

The repository URL is declared once, in `package.json`. The tracker's licence banner derives from
it at build time.

```bash
npm pkg set repository.url="git+https://github.com/YOUR-USER/tadoru.git"
npm pkg set homepage="https://github.com/YOUR-USER/tadoru"
npm pkg set bugs.url="https://github.com/YOUR-USER/tadoru/issues"
npm run build:tracker    # regenerates the banner from the new value
```

Two files carry the URL literally because nothing can derive it for them. Update both by hand:

- `deploy/tadoru.service` — the `Documentation=` line
- `docker/docker-compose.yml` — the `image:` line, if you publish an image

Then check nothing was missed:

```bash
grep -rn "OWNER" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=public .
```

## Publishing

`prepublishOnly` runs the typecheck, the full suite and the build, so a broken tree cannot be
published.

```bash
npm version minor
npm publish
git push --follow-tags
```

## Test the tarball on the minimum supported Node — do not skip this

Two defects reached the packaged artefact and neither was visible in development or in the test
suite, because both only exist in the published layout: `/t.js` was not served at all, and the
dashboard footer reported version `0.0.0`. Only installing the tarball found them.

```bash
npm pack
mkdir /tmp/tadoru-probe && cd /tmp/tadoru-probe
npm init -y && npm install /path/to/tadoru-<version>.tgz

node_modules/.bin/tadoru --version                       # the real version, not 0.0.0
TADORU_ADMIN_PASSWORD= node_modules/.bin/tadoru start     # must refuse, non-zero exit

TADORU_ADMIN_PASSWORD=probe TADORU_SITES=example.com \
  TADORU_DATA_DIR=./data node_modules/.bin/tadoru start &
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' localhost:3000/t.js   # 200, non-empty
```

Run it under the oldest Node in `engines`, not just your development runtime. `engines` is
advisory: npm installs happily and the failure surfaces later, at the user's server.

## After publishing

Verify the AGPL section 13 obligation still holds on the artefact people actually receive:

```bash
head -1 public/t.js                    # the licence banner must be present
```

The dashboard footer must link to the repository and the running version. If either is missing,
the release does not satisfy the licence — see `docs/adr/0006-agpl-and-the-network-clause.md`.
