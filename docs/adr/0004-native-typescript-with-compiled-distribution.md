# 0004 — Run TypeScript natively, ship compiled JavaScript

Status: accepted

## Context

Node 24 executes `.ts` files directly through type stripping. Verified in this project: both
`node file.ts` and `node --test 'src/**/*.test.ts'` work with no `ts-node`, no `tsx` and no
loader.

That removes an entire tooling layer from development. But the published package cannot assume
a recent Node on someone else's VPS, and after ADR 0003 there is no image pinning the version.

## Decision

Two different targets on purpose.

- **Development** requires Node >= 22.18 (`devEngines`) and runs TypeScript natively. No build.
- **Distribution** declares `engines: node >= 22.0.0` and compiles to `dist/` on
  `prepack` (not `prepublishOnly`, which never runs for `npm pack` and so would let the tarball
  you test differ from the one you publish), using `rewriteRelativeImportExtensions` so the `.ts` import
  extensions are rewritten to `.js` on emit. Verified: the output runs on plain Node without
  type stripping.

## Consequences

- Contributors get instant feedback with no build watcher; installers get broad compatibility.
- **Every relative import must carry an explicit `.ts` extension.** This is a hard requirement
  of native type stripping, not a style choice.
- **`erasableSyntaxOnly` is enabled**, which forbids `enum`, `namespace`, constructor parameter
  properties and decorators. The codebase uses `const` tuples plus derived union types instead.
  The compiler enforces this rather than relying on reviewer discipline.
- The tracker still needs esbuild, since browsers do not strip types.

## Correction, after actually installing the package

The floor was first written as Node 20.19, on the assumption that compiled output would run
anywhere. Packing the tarball and installing it under Node 20 disproved that: `better-sqlite3` v13
declares `engines: node >= 22`, and `new Database()` **segfaults** on Node 20. `engines` is
advisory, so npm installed it without complaint and the crash arrived later — the worst possible
failure mode for someone setting up a server.

The floor is now Node 22. Downgrading `better-sqlite3` to keep Node 20 was rejected: Node 20's
maintenance window ended on 2026-04-30, so it receives no security updates, and shipping a
privacy tool that encourages an unpatched runtime is worse than dropping it.

Two lessons worth keeping:

- A compatibility claim that was never tested against a real installation is a guess. `npm pack`,
  install the tarball on the oldest supported runtime, and run the binary.
- `engines` does not enforce anything by default. It documents intent; it does not protect anyone.
