// Pure path rules for the deploy script. Nothing in this file touches the
// disk, so the rules can be unit-tested (see tests/deployTarget.test.ts).
//
// The one promise this file keeps: a deploy can only ever write the three
// plugin files, directly inside
//   <vault>/.obsidian/plugins/spellbook-novel-writer/
// and nowhere else.

import path from 'node:path';

/** The plugin id; also the name of the plugin's folder inside a vault. */
export const PLUGIN_ID = 'spellbook-novel-writer';

/** The only files a deploy is allowed to copy. */
export const DEPLOY_FILES = Object.freeze(['main.js', 'manifest.json', 'styles.css']);

/** The test vault, relative to the repository root. */
export const DEFAULT_VAULT = '../SpellBookPlugInTest';

/** Thrown whenever the deploy script declines to write somewhere. */
export class DeployRefused extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'DeployRefused';
  }
}

/**
 * Work out which vault to deploy to.
 *
 * @param {string} repoRoot absolute path of the plugin repository
 * @param {string | undefined} override value of SPELLBOOK_TEST_VAULT, if set
 * @returns {string} absolute path of the vault root
 */
export function resolveVaultRoot(repoRoot, override) {
  if (!path.isAbsolute(repoRoot)) {
    throw new DeployRefused(`The repository path must be absolute, got "${repoRoot}".`);
  }
  const chosen = override !== undefined && override.trim() !== '' ? override.trim() : DEFAULT_VAULT;
  return path.resolve(repoRoot, chosen);
}

/**
 * True for folders that a deploy must never write into: anything in iCloud,
 * which is where the owner's real notes live.
 *
 * @param {string} absolutePath
 * @returns {boolean}
 */
export function isProtectedLocation(absolutePath) {
  const parts = path
    .resolve(absolutePath)
    .split(path.sep)
    .map((part) => part.toLowerCase());
  for (let i = 0; i + 1 < parts.length; i += 1) {
    if (parts[i] === 'library' && parts[i + 1] === 'mobile documents') return true;
  }
  // iCloud app containers are named like "iCloud~md~obsidian".
  return parts.some((part) => part.startsWith('icloud~'));
}

/**
 * The plugin folder inside a vault.
 *
 * @param {string} vaultRoot absolute path of the vault root
 * @returns {string}
 */
export function pluginDirFor(vaultRoot) {
  if (typeof vaultRoot !== 'string' || vaultRoot.trim() === '') {
    throw new DeployRefused('No vault path was given.');
  }
  if (!path.isAbsolute(vaultRoot)) {
    throw new DeployRefused(`The vault path must be absolute, got "${vaultRoot}".`);
  }
  const root = path.resolve(vaultRoot);
  if (root === path.parse(root).root) {
    throw new DeployRefused('The vault path cannot be the root of the disk.');
  }
  if (isProtectedLocation(root)) {
    throw new DeployRefused(`"${root}" is in iCloud. Deploying there is not allowed.`);
  }
  return path.join(root, '.obsidian', 'plugins', PLUGIN_ID);
}

/**
 * Where one plugin file is copied to. Refuses anything that is not one of the
 * three plugin files, and anything that would land outside the plugin folder.
 *
 * @param {string} vaultRoot absolute path of the vault root
 * @param {string} fileName one of DEPLOY_FILES
 * @returns {string} absolute destination path
 */
export function destinationFor(vaultRoot, fileName) {
  if (!DEPLOY_FILES.includes(fileName)) {
    throw new DeployRefused(`"${fileName}" is not a plugin file and will not be copied.`);
  }
  const destination = path.join(pluginDirFor(vaultRoot), fileName);
  assertInsidePluginDir(vaultRoot, destination);
  return destination;
}

/**
 * Throw unless `candidate` sits directly inside the vault's plugin folder.
 *
 * @param {string} vaultRoot absolute path of the vault root
 * @param {string} candidate absolute path about to be written
 * @returns {void}
 */
export function assertInsidePluginDir(vaultRoot, candidate) {
  const pluginDir = pluginDirFor(vaultRoot);
  if (!path.isAbsolute(candidate) || path.dirname(path.resolve(candidate)) !== pluginDir) {
    throw new DeployRefused(`Refusing to write "${candidate}": it is outside "${pluginDir}".`);
  }
}
