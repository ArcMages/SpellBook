import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';
import pkg from '../package.json';
import versions from '../versions.json';
import { PLUGIN_ID } from '../scripts/deployTarget.mjs';

// The only packages this project may depend on (see the safety rules).
const ALLOWED_PACKAGES = [
  'obsidian',
  'typescript',
  'esbuild',
  'tslib',
  'builtin-modules',
  '@types/node',
  'vitest',
];

// Script names npm runs on its own, without being asked.
const LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
  'prepack',
  'postpack',
  'dependencies',
];

describe('plugin manifest', () => {
  it('identifies the plugin as Spellbook', () => {
    expect(manifest.id).toBe('spellbook-novel-writer');
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(manifest.name).toBe('Spellbook');
    expect(manifest.author).toBe('Daniel | DandiMage');
  });

  it('works on phones and tablets as well as desktop', () => {
    expect(manifest.isDesktopOnly).toBe(false);
  });

  it('has the same version everywhere', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version).toBe(manifest.version);
    const byVersion: Record<string, string | undefined> = versions;
    expect(byVersion[manifest.version]).toBe(manifest.minAppVersion);
  });
});

describe('package.json', () => {
  it('is private and named after the plugin', () => {
    expect(pkg.private).toBe(true);
    expect(pkg.name).toBe(PLUGIN_ID);
  });

  it('depends only on allowed packages, pinned to exact versions', () => {
    const declared: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    } = pkg;
    const all = [
      declared.dependencies,
      declared.devDependencies,
      declared.optionalDependencies,
      declared.peerDependencies,
    ].flatMap((group) => Object.entries(group ?? {}));
    expect(all.length).toBeGreaterThan(0);
    for (const [name, version] of all) {
      expect(ALLOWED_PACKAGES, `${name} is not on the allowlist`).toContain(name);
      expect(version, `${name} must be pinned to an exact version`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('has no scripts that run on their own', () => {
    const names = Object.keys(pkg.scripts);
    for (const name of names) {
      expect(LIFECYCLE_SCRIPTS, `"${name}" would run automatically`).not.toContain(name);
      // "pre<x>" and "post<x>" run automatically around the script "<x>".
      const hooked = names.filter((other) => name === `pre${other}` || name === `post${other}`);
      expect(hooked, `"${name}" would run automatically`).toEqual([]);
    }
    expect(names).toEqual(expect.arrayContaining(['build', 'dev', 'test', 'deploy']));
  });
});
