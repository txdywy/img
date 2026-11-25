// Checks that every script and stylesheet the page loads carries the same ?v=
// cache version, that each local import points at a file that exists, and that
// every script parses. Run with: node tools/check-assets.mjs
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const assets = join(docs, 'assets');
const problems = [];
const versions = new Map();

function collect(file, pattern) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(pattern)) {
    const [, path, version] = match;
    const where = `${relative(docs, file)} -> ${path}`;
    if (!existsSync(join(dirname(file), path))) problems.push(`${where}: file not found`);
    if (!version) problems.push(`${where}: missing ?v=`);
    else versions.set(where, version);
  }
}

collect(join(docs, 'index.html'), /(?:src|href)="(\.\/assets\/[^"?]+\.(?:js|css))(?:\?v=(\d+))?"/g);
for (const name of readdirSync(assets).filter(name => name.endsWith('.js'))) {
  const file = join(assets, name);
  collect(file, /\bfrom\s+'(\.\/[^'?]+\.js)(?:\?v=(\d+))?'/g);
  collect(file, /\bimport\(\s*'(\.\/[^'?]+\.js)(?:\?v=(\d+))?'\s*\)/g);
  try {
    execFileSync(process.execPath, ['--check', file], {stdio: 'pipe'});
  } catch (error) {
    problems.push(`${relative(docs, file)}: ${String(error.stderr).trim()}`);
  }
}

const distinct = new Set(versions.values());
if (distinct.size > 1) {
  problems.push('?v= versions differ:\n' + [...versions].map(([where, v]) => `  ${where}?v=${v}`).join('\n'));
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`OK: ${versions.size} asset references, all ?v=${[...distinct][0]}`);
