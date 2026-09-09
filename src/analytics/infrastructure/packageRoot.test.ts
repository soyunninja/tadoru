import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findPackageRoot } from './packageRoot.ts';

function withFakeTree(relativeModuleDir: string, fn: (root: string, moduleUrl: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'tadoru-root-test-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'tadoru', version: '9.9.9' }));
    const moduleDir = join(root, relativeModuleDir);
    mkdirSync(moduleDir, { recursive: true });
    const moduleFile = join(moduleDir, 'module.js');
    writeFileSync(moduleFile, '');
    fn(root, pathToFileURL(moduleFile).href);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The development tree and the published tree put the same module at different
// depths, so a fixed number of `..` segments is correct in one and wrong in the
// other. Getting this wrong is invisible until the package is actually installed.
test('finds the package root from the development layout', () => {
  withFakeTree('src/analytics/infrastructure/http', (root, moduleUrl) => {
    assert.equal(findPackageRoot(moduleUrl), root);
  });
});

test('finds the package root from the published dist layout, which is one level deeper', () => {
  withFakeTree('dist/src/analytics/infrastructure/http', (root, moduleUrl) => {
    assert.equal(findPackageRoot(moduleUrl), root);
  });
});

test('ignores a package.json belonging to a different package', () => {
  const root = mkdtempSync(join(tmpdir(), 'tadoru-root-test-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'tadoru', version: '9.9.9' }));
    const nested = join(root, 'dist', 'vendored');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'package.json'), JSON.stringify({ name: 'something-else' }));
    const moduleFile = join(nested, 'module.js');
    writeFileSync(moduleFile, '');
    assert.equal(findPackageRoot(pathToFileURL(moduleFile).href), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns null rather than throwing when there is no package root', () => {
  const root = mkdtempSync(join(tmpdir(), 'tadoru-orphan-'));
  try {
    const moduleFile = join(root, 'module.js');
    writeFileSync(moduleFile, '');
    assert.equal(findPackageRoot(pathToFileURL(moduleFile).href), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
