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

`prepublishOnly` runs the typecheck and the full suite, so a broken tree cannot be published.
`prepack` runs the build. That split matters: `prepublishOnly` fires only on `npm publish`, so a
build placed there let `npm pack` produce a tarball containing whatever stale `dist/` happened to
be on disk. Every "test the tarball" check below was then testing the previous release. `prepack`
fires for both, so a locally packed tarball is what publishing would upload.

```bash
npm version minor
npm publish
git push --follow-tags
```

## Test the tarball on the minimum supported Node — do not skip this

Three defects reached the packaged artefact and none was visible in development or in the test
suite, because they only exist in the published layout: `/t.js` was not served at all, the
dashboard footer reported version `0.0.0`, and the CLI exited 0 having printed nothing when run
through npm's bin symlink — which is to say, `sudo npm install -g tadoru` installed a command
that did nothing at all. Only installing the tarball found them.

That last one is worth dwelling on, because the probe below already existed and still missed it.
A command that prints nothing and exits 0 looks like a command that worked. Read the output of
every probe, not just its exit code.

```bash
npm pack
mkdir /tmp/tadoru-probe && cd /tmp/tadoru-probe
npm init -y && npm install /path/to/tadoru-<version>.tgz

# Run it through node_modules/.bin, NOT the file it points at. npm installs a CLI as a
# symlink, and that is the only form `sudo npm install -g tadoru` ever produces.
node_modules/.bin/tadoru --version                       # the real version, not 0.0.0
node_modules/.bin/tadoru --help                          # must print the command list
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
