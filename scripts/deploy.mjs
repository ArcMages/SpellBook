// Copies the built plugin into the test vault so it can be tried in Obsidian.
//
//   npm run deploy
//
// The vault defaults to ../SpellBookPlugInTest. Set SPELLBOOK_TEST_VAULT to use
// another one. Whatever the vault, this script writes exactly three files
// (main.js, manifest.json, styles.css) into
//   <vault>/.obsidian/plugins/spellbook-novel-writer/
// and refuses to write anywhere else. It never deletes anything.

import { copyFile, lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  DEPLOY_FILES,
  DeployRefused,
  destinationFor,
  isProtectedLocation,
  pluginDirFor,
  resolveVaultRoot,
} from './deployTarget.mjs';

/**
 * lstat that returns null when nothing exists at the path.
 *
 * @param {string} target
 */
async function lstatOrNull(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Throw unless `target` is a real folder (not a link to somewhere else).
 * A folder that does not exist yet is fine when `mayBeMissing` is true.
 *
 * @param {string} target
 * @param {boolean} mayBeMissing
 */
async function assertRealFolder(target, mayBeMissing) {
  const info = await lstatOrNull(target);
  if (info === null) {
    if (mayBeMissing) return;
    throw new DeployRefused(`"${target}" does not exist.`);
  }
  if (info.isSymbolicLink()) {
    throw new DeployRefused(`"${target}" is a link to another place. Refusing to follow it.`);
  }
  if (!info.isDirectory()) {
    throw new DeployRefused(`"${target}" is not a folder.`);
  }
}

async function deploy() {
  // The destination is fixed. Any argument would be an attempt to steer the
  // copy somewhere else, so none are accepted.
  if (process.argv.length > 2) {
    throw new DeployRefused(
      'This script takes no arguments. To use another vault, set SPELLBOOK_TEST_VAULT.',
    );
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const requestedVault = resolveVaultRoot(repoRoot, process.env['SPELLBOOK_TEST_VAULT']);

  if (isProtectedLocation(requestedVault)) {
    throw new DeployRefused(`"${requestedVault}" is in iCloud. Deploying there is not allowed.`);
  }

  // Resolve links in the vault path itself, then check where it really is.
  /** @type {string} */
  let vaultRoot;
  try {
    vaultRoot = await realpath(requestedVault);
  } catch {
    throw new DeployRefused(`The vault "${requestedVault}" does not exist.`);
  }
  if (isProtectedLocation(vaultRoot)) {
    throw new DeployRefused(`"${vaultRoot}" is in iCloud. Deploying there is not allowed.`);
  }

  // It must already be an Obsidian vault: this script never creates one.
  const configDir = path.join(vaultRoot, '.obsidian');
  if ((await lstatOrNull(configDir)) === null) {
    throw new DeployRefused(`"${vaultRoot}" is not an Obsidian vault (it has no .obsidian folder).`);
  }
  await assertRealFolder(configDir, false);

  const pluginDir = pluginDirFor(vaultRoot);
  await assertRealFolder(path.dirname(pluginDir), true);
  await assertRealFolder(pluginDir, true);

  // Check every source file before writing anything, so a deploy is never half done.
  for (const fileName of DEPLOY_FILES) {
    const source = path.join(repoRoot, fileName);
    const info = await lstatOrNull(source);
    if (info === null || !info.isFile()) {
      throw new DeployRefused(`"${fileName}" is missing. Run "npm run build" first.`);
    }
  }

  await mkdir(pluginDir, { recursive: true });

  // After creating it, the folder must be exactly where we meant it to be.
  const realPluginDir = await realpath(pluginDir);
  if (realPluginDir !== pluginDir) {
    throw new DeployRefused(`"${pluginDir}" resolves to "${realPluginDir}". Refusing to write there.`);
  }

  for (const fileName of DEPLOY_FILES) {
    const destination = destinationFor(vaultRoot, fileName);
    const existing = await lstatOrNull(destination);
    if (existing !== null && !existing.isFile()) {
      // A link or a folder here would send the copy somewhere unexpected.
      throw new DeployRefused(`"${destination}" exists and is not a plain file.`);
    }
    await copyFile(path.join(repoRoot, fileName), destination);
  }

  console.log(`Spellbook deployed to ${pluginDir}`);
  for (const fileName of DEPLOY_FILES) console.log(`  ${fileName}`);
  console.log('In Obsidian, turn the plugin off and on again (or reload the app) to load this build.');
}

try {
  await deploy();
} catch (error) {
  if (error instanceof DeployRefused) {
    console.error(`Deploy refused: ${error.message}`);
  } else {
    console.error('Deploy failed:', error);
  }
  process.exitCode = 1;
}
