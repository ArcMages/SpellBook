import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VAULT,
  DEPLOY_FILES,
  DeployRefused,
  PLUGIN_ID,
  assertInsidePluginDir,
  destinationFor,
  isProtectedLocation,
  pluginDirFor,
  resolveVaultRoot,
} from '../scripts/deployTarget.mjs';

const repo = path.resolve('/work/SpellBook');
const vault = path.resolve('/work/SpellBookPlugInTest');
const pluginDir = path.join(vault, '.obsidian', 'plugins', 'spellbook-novel-writer');

describe('deploy target', () => {
  it('defaults to the test vault next to the repository', () => {
    expect(DEFAULT_VAULT).toBe('../SpellBookPlugInTest');
    expect(resolveVaultRoot(repo, undefined)).toBe(vault);
    expect(resolveVaultRoot(repo, '')).toBe(vault);
    expect(resolveVaultRoot(repo, '   ')).toBe(vault);
  });

  it('uses SPELLBOOK_TEST_VAULT when it is set', () => {
    const other = path.resolve('/somewhere/Other Vault');
    expect(resolveVaultRoot(repo, other)).toBe(other);
    expect(resolveVaultRoot(repo, '../Sibling')).toBe(path.resolve('/work/Sibling'));
  });

  it('copies only the three plugin files, into the plugin folder', () => {
    expect([...DEPLOY_FILES]).toEqual(['main.js', 'manifest.json', 'styles.css']);
    expect(pluginDirFor(vault)).toBe(pluginDir);
    for (const fileName of DEPLOY_FILES) {
      expect(destinationFor(vault, fileName)).toBe(path.join(pluginDir, fileName));
    }
    expect(pluginDir.endsWith(PLUGIN_ID)).toBe(true);
  });

  it('refuses file names that are not plugin files or that escape the folder', () => {
    const rejected = [
      'data.json',
      'workspace.json',
      '../main.js',
      '../../app.json',
      'sub/main.js',
      path.join(vault, 'Welcome.md'),
      '',
    ];
    for (const fileName of rejected) {
      expect(() => destinationFor(vault, fileName)).toThrow(DeployRefused);
    }
  });

  it('refuses any destination outside the plugin folder', () => {
    const rejected = [
      vault,
      path.join(vault, 'Welcome.md'),
      path.join(vault, '.obsidian', 'app.json'),
      path.join(vault, '.obsidian', 'plugins', 'another-plugin', 'main.js'),
      path.join(pluginDir, 'nested', 'main.js'),
      path.join(pluginDir, '..', '..', 'community-plugins.json'),
      pluginDir,
      'main.js',
    ];
    for (const candidate of rejected) {
      expect(() => assertInsidePluginDir(vault, candidate)).toThrow(DeployRefused);
    }
    expect(() => assertInsidePluginDir(vault, path.join(pluginDir, 'main.js'))).not.toThrow();
  });

  it('refuses a vault path that is empty, relative or the disk root', () => {
    expect(() => pluginDirFor('')).toThrow(DeployRefused);
    expect(() => pluginDirFor('relative/vault')).toThrow(DeployRefused);
    expect(() => pluginDirFor(path.parse(vault).root)).toThrow(DeployRefused);
    expect(() => resolveVaultRoot('relative/repo', undefined)).toThrow(DeployRefused);
  });

  it('refuses to deploy into iCloud, where the real notes live', () => {
    const icloud = path.resolve('/Users/someone/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes');
    expect(isProtectedLocation(icloud)).toBe(true);
    expect(isProtectedLocation(path.resolve('/Users/someone/library/mobile documents/x'))).toBe(true);
    expect(isProtectedLocation(vault)).toBe(false);
    expect(() => pluginDirFor(icloud)).toThrow(DeployRefused);
    expect(() => destinationFor(icloud, 'main.js')).toThrow(DeployRefused);
  });
});
