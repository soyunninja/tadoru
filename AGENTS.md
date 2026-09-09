# Tadoru — agent brief

Read this file before touching anything. It is deliberately agent-agnostic: no Claude-,
Codex- or Cursor-specific instructions live here, so any assistant can pick the project up
from a cold start.

Authoritative sources, in order:

1. **This file** — invariants, toolchain constraints, how to run things.
2. **`specs/`** — capability specifications in requirement/scenario form. These are the
   contract. Code that disagrees with a spec is a bug in the code, unless the spec is
   changed first and deliberately.
3. **`docs/adr/`** — why each significant decision was made, and what it costs.
4. **`docs/compliance.md`** — the legal reasoning the whole design rests on.

## What this is

A cookieless, self-hosted web analytics service. You install it on your own VPS, list the
domains you want to measure, and paste a snippet. It needs no consent banner because it
qualifies for the EU audience-measurement exemption — not because it avoids cookies.

Single organisation per installation, N sites. No third-party accounts, no multi-tenancy.

## Invariants — breaking any of these breaks the product's reason to exist

These are enforced by tests. If a change makes one of these tests fail, the change is wrong,
not the test.

1. **No IP address or raw user-agent is ever persisted.** They are used in memory to derive a
   visitor id and to look up a country, then discarded. `TrackedEvent` has no field for either,
   and `createTrackedEvent` names every field explicitly so a caller cannot smuggle one in.
2. **The visitor id is unlinkable across days.** It is `blake2b(daily_salt + site + ip + ua)`
   truncated to 16 bytes. Only the current salt is stored; rotation overwrites it and the old
   value must be unrecoverable.
3. **The visitor id is unlinkable across sites.** The site domain is a hash input, so the same
   person on two sites yields two unrelated ids.
4. **No fingerprinting signal is ever collected.** Not canvas, WebGL, font enumeration, exact
   timezone, exact screen resolution, plugin list, `hardwareConcurrency` or `deviceMemory`.
   The tracker payload schema is a closed allow-list in `tracker/payload.ts`; a test asserts
   the forbidden keys are absent.
5. **Screen width is bucketed in the browser.** The exact value never leaves the device.
6. **Do Not Track and Global Privacy Control are honoured** before any request is sent. The
   shipped privacy notice promises this, so it must remain true.
7. **Raw event retention defaults to 25 months.** Beyond that the consent exemption no longer
   applies, so a longer setting must warn loudly on boot.
8. **Unique visitors are never summed across rollup dimensions.** Each dimension's `visitors`
   column is an independent `COUNT(DISTINCT visitor_id)` computed from raw events.
9. **The dashboard makes no third-party requests.** No favicons, no icon CDNs, no remote images,
   and no font CDN — only its own origin. The web font is a subset bundled in `assets/fonts/` and
   served from `self`. Its icon glyphs are Font Awesome under CC BY 4.0, which requires the
   attribution kept in `assets/fonts/NOTICE.md` — do not drop that file from the package. Only
   `U+F000`–`U+F2FF` is attributed; Font Logos is unlicensed and a test enforces the boundary.
   `scripts/build-font.ts` derives the subset from the view modules' exported glyph lists, so an
   icon added to the interface reaches the font without a second list to keep in step. Markers are derived locally (country flags from the
   ISO code, OS icons as emoji) or omitted. Favicons will be proposed again because every
   competitor has them; see `docs/adr/0007-no-third-party-requests-from-the-dashboard.md` first.
10. **The corresponding source is offered over the network.** The project is AGPL-3.0-only, and
   section 13 applies to programs users interact with remotely. Every dashboard page must link to
   the repository and the running version, and the tracker bundle must keep its `@license`
   banner. This is a licence obligation, not decoration — do not remove either.

## Architecture

Hexagonal, with the domain named after what the product does rather than after layers.

- `src/analytics/domain/` — value objects and ports. Pure. **Must not import `fastify`,
  `better-sqlite3`, `geoip-lite` or `node-device-detector`.** `node:crypto` is allowed.
- `src/analytics/application/` — use cases. Same import restriction.
- `src/analytics/infrastructure/` — adapters that implement the ports.
- `tracker/` — the browser script, bundled to `public/t.js` by esbuild.
- `bin/tadoru.ts` — the CLI (`init`, `start`, `install-service`, `status`, `backup`, `restore`,
  `reset-password`, `update-geoip`).

Check the rule holds with:

```bash
grep -rE "fastify|better-sqlite3|geoip-lite|node-device-detector" src/analytics/domain src/analytics/application
```

It must print nothing.

## Toolchain — non-obvious and non-negotiable

- **Node 24 runs TypeScript directly** via type stripping. There is no build step for the
  server, and no `ts-node`, `tsx` or bundler. Development requires Node >= 22.18.
- **Every relative import carries an explicit `.ts` extension.** `import { X } from './X.ts'`.
  This is required by native type stripping, not a style preference.
- **`erasableSyntaxOnly` is on**, so `enum`, `namespace`, constructor parameter properties and
  decorators are all unavailable. Use a `const` tuple plus a derived union type instead of an
  enum — see `EventType.ts` for the pattern.
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`
  are on. Type-only imports must use `import type`.
- **Two TypeScript configs on purpose.** The root one covers `src/`, `bin/` and `scripts/` with no
  DOM lib, so server code cannot reach for a browser global by accident. `tracker/tsconfig.json`
  adds the DOM lib for the browser script. `npm run typecheck` runs both. A new top-level directory
  must be added to one of them deliberately — code checked by neither config is the easiest place
  for a break to hide.
- The **published** package is different: `npm run build` compiles to `dist/` with
  `rewriteRelativeImportExtensions`, which rewrites `.ts` imports to `.js`, so installs run on
  any Node >= 22 without type stripping, which is only unflagged from 22.18. Development stays
  build-free; distribution stays installable on the whole supported Node 22 line.

## Working method

**Strict TDD.** Write the failing test, run it and watch it fail, write the minimum code, run
it again. Tests are colocated as `*.test.ts` next to the file under test, using `node:test` and
`node:assert/strict`. Persistence tests use a real in-memory SQLite database rather than mocks.

## Commands

```bash
npm test                # every test
npm run typecheck       # server and tracker are checked under separate configs
npm run build:tracker   # bundle the browser script, enforcing its size budget
npm run dev             # run the server with --watch
npm run build           # compile dist/ for publishing
```

## Licence

AGPL-3.0-only. Contributions are accepted under it. See
`docs/adr/0006-agpl-and-the-network-clause.md` for what its network clause requires the code to
do, not merely to declare.

## Language

Code, comments, identifiers, test names, specs and documentation are in **English**.
Conversation with the maintainer happens in Spanish; that never leaks into artifacts.
