// Older phones still in use: iOS 12 Safari (iPhone 5s/6), Android 8 phones whose
// built-in browser or WeChat runs an older Chromium. Their JavaScript stops at
// ES2019, so optional chaining (?.), ?? and 1_000 separators would make the whole
// page fail to start. This parses every script as ES2019 to catch that early.
// Needs: npm install acorn. Run with: node tools/old-syntax.mjs
import {readFileSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'assets');
const problems = [];
const names = readdirSync(assets).filter(name => name.endsWith('.js'));
for (const name of names) {
  const source = readFileSync(join(assets, name), 'utf8');
  // old.js runs as a classic script so it can speak up when the modules cannot start.
  const sourceType = name === 'old.js' ? 'script' : 'module';
  const ecmaVersion = name === 'old.js' ? 5 : 2019;
  try {
    parse(source, {ecmaVersion, sourceType});
  } catch (error) {
    problems.push(`${name}: ${error.message} (not supported by older phones)`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`OK: ${names.length} scripts use only syntax that iOS 12 and older Android browsers understand`);
