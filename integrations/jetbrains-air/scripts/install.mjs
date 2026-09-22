import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildPatch, MARKER } from '../src/patch.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateDir = join(root, '.local');
const home = process.env.DSH_HOME || join(process.env.USERPROFILE, '.dsh');
const target = join(home, 'profiles/web/node_modules/dsh-pet/lib/index.js');
const hash = value => createHash('sha256').update(value).digest('hex');
const manifestPath = join(stateDir, 'installation.json');
const current = readFileSync(target, 'utf8');
const state = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
if (process.argv.includes('--status')) {
  console.log(JSON.stringify({ installed: current.includes(MARKER), matchesInstalledHash: state ? hash(current) === state.installedHash : false, version: state?.version }, null, 2));
  process.exit(0);
}
mkdirSync(stateDir, { recursive: true });
if (process.argv.includes('--undo')) {
  if (!state || state.target !== target || hash(current) !== state.installedHash) throw new Error('Installed file changed; refusing to overwrite it');
  const clean = readFileSync(join(stateDir, state.cleanFile), 'utf8');
  if (hash(clean) !== state.cleanHash) throw new Error('Backup checksum mismatch');
  writeFileSync(target, clean, 'utf8');
  console.log('Restored clean upstream plugin. Restart DSH to apply.');
  process.exit(0);
}
let clean = current;
if (!current.includes(MARKER)) {
  const release = join(root, '.local/upstream-package/package/lib/index.js');
  if (!existsSync(release) || hash(readFileSync(release, 'utf8')) !== hash(current)) throw new Error('Host differs from pinned upstream release; prepare upstream and restore a clean 0.2.11 installation first');
}
if (current.includes(MARKER)) {
  if (!state || state.target !== target || hash(current) !== state.installedHash) throw new Error('Local runtime differs from recorded installation');
  clean = readFileSync(join(stateDir, state.cleanFile), 'utf8');
  if (hash(clean) !== state.cleanHash) throw new Error('Backup checksum mismatch');
} else if (current.includes('// LOCAL PET STAGE')) {
  clean = readFileSync(target + '.before-pet-stage', 'utf8');
}
const version = JSON.parse(readFileSync(join(dirname(dirname(target)), 'package.json'), 'utf8')).version;
if (version !== '0.2.11') throw new Error('Only upstream 0.2.11 is validated; review patch before upgrading');
const runtime = ['theater.mjs', 'visibility.mjs', 'usage-monitor.mjs', 'companion.mjs', 'attention.mjs', 'codex-quota.mjs'].map(file => readFileSync(join(root, 'src', file), 'utf8')).join('\n');
const patched = buildPatch(clean, runtime);
const candidate = join(stateDir, 'candidate.mjs');
writeFileSync(candidate, patched, 'utf8');
const syntax = spawnSync(process.execPath, ['--check', candidate], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr);
if (hash(current) === hash(patched)) { console.log('Already up to date.'); process.exit(0); }
const cleanFile = 'upstream-' + hash(clean).slice(0, 16) + '.js';
const beforeFile = 'before-' + hash(current).slice(0, 16) + '.js';
writeFileSync(join(stateDir, cleanFile), clean, 'utf8');
writeFileSync(join(stateDir, beforeFile), current, 'utf8');
writeFileSync(manifestPath, JSON.stringify({ target, version, cleanFile, beforeFile, cleanHash: hash(clean), installedHash: hash(patched), installedAt: new Date().toISOString() }, null, 2));
const temporary = target + '.fatfish-new';
writeFileSync(temporary, patched, 'utf8');
renameSync(temporary, target);
console.log('Installed model-directed theater. Previous runtime and clean upstream backed up. Restart DSH.');
