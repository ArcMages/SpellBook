// Packs a release of the plugin as one file that people can download and
// unzip, with no git and no build tools:
//
//   release/spellbook-novel-writer-<version>.zip
//     spellbook-novel-writer/
//       main.js  manifest.json  styles.css
//
// Unzipped into a vault's .obsidian/plugins folder, that is an installed
// plugin. The same three files are also copied loose into release/, because a
// GitHub release for Obsidian (and for BRAT) needs them attached one by one.
//
//   npm run package        builds first, then packs
//
// Uses the "zip" program that macOS and Linux bring with them.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILES = ['main.js', 'manifest.json', 'styles.css'];

const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));
const releaseDir = path.join(repoRoot, 'release');
const pluginDir = path.join(releaseDir, manifest.id);
const zipName = `${manifest.id}-${manifest.version}.zip`;

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(pluginDir, { recursive: true });
for (const file of FILES) {
  copyFileSync(path.join(repoRoot, file), path.join(pluginDir, file));
  copyFileSync(path.join(repoRoot, file), path.join(releaseDir, file));
}
execFileSync('zip', ['-r', '-q', '-X', zipName, manifest.id], { cwd: releaseDir });
rmSync(pluginDir, { recursive: true, force: true });

console.log(`release/${zipName}`);
for (const file of FILES) console.log(`release/${file}`);
