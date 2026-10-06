// Lance tout : contrôle de syntaxe de chaque fichier JavaScript, puis chaque scripts/test-*.mjs.
// Aucune dépendance (Node seul). Usage :  npm test   |   node scripts/run-tests.mjs [--syntaxe] [filtre]
// Code de sortie 0 seulement si TOUT passe : c'est ce que lit le workflow GitHub « Tests ».
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), syntaxOnly = args.includes('--syntaxe'), filter = args.find(a => !a.startsWith('--'));
const list = dir => fs.readdirSync(path.join(root, dir)).map(f => `${dir}/${f}`);
const run = (file, extra = []) => {
  const t0 = Date.now(), r = spawnSync(process.execPath, [...extra, file], { cwd: root, encoding: 'utf8', timeout: 120000 });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`, ms: Date.now() - t0 };
};

const results = [];
const sources = ['sw.js', ...list('js').filter(f => f.endsWith('.js')), ...list('scripts').filter(f => f.endsWith('.mjs'))];
for (const f of sources) { if (filter && !f.includes(filter)) continue; results.push({ name: `syntaxe ${f}`, ...run(f, ['--check']) }); }
const tests = syntaxOnly ? [] : list('scripts').filter(f => /\/test-.*\.mjs$/.test(f)).sort();
for (const f of tests) { if (filter && !f.includes(filter)) continue; results.push({ name: f.replace('scripts/', ''), ...run(f) }); }

const bad = results.filter(r => !r.ok);
for (const r of results.filter(r => !r.name.startsWith('syntaxe'))) console.log(`${r.ok ? 'ok   ' : 'ÉCHEC'} ${r.name.padEnd(28)} ${String(r.ms).padStart(5)} ms   ${r.out.trim().split('\n').pop().slice(0, 60)}`);
const nSyn = results.filter(r => r.name.startsWith('syntaxe')).length, nTests = results.length - nSyn;
console.log(`\n${nSyn} fichiers contrôlés (syntaxe), ${nTests} jeux de tests : ${bad.length ? `${bad.length} en échec` : 'tout passe'}`);
for (const r of bad) console.log(`\n===== ${r.name} =====\n${r.out.trim().split('\n').slice(-25).join('\n')}`);
process.exit(bad.length ? 1 : 0);
