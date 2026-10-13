// Dependency-free production build: stamps version + content hash, copies to dist/, verifies the result.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const VERSION = process.env.EDITLESS_VERSION || pkg.version;
const OUT = path.resolve(process.env.EDITLESS_OUT || path.join(root, 'dist'));
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)).map(f => path.join(e.name, f)) : [e.name]);
const all = ['index.html', 'manifest.webmanifest', 'sw.js', ...walk(path.join(root, 'icons')).map(f => path.join('icons', f))].sort();
const h = crypto.createHash('sha256'); for (const f of all) { h.update(f); h.update(fs.readFileSync(path.join(root, f))); } h.update(VERSION);
const BUILD = h.digest('hex').slice(0, 8);
fs.rmSync(OUT, { recursive: true, force: true });
for (const f of all) {
  const dst = path.join(OUT, f); fs.mkdirSync(path.dirname(dst), { recursive: true }); let b = fs.readFileSync(path.join(root, f));
  if (f === 'index.html' || f === 'sw.js') {
    let s = b.toString('utf8'); if (!s.includes('__VERSION__') || !s.includes('__BUILD__')) throw new Error(f + ': version placeholders missing');
    b = Buffer.from(s.replaceAll('__VERSION__', VERSION).replaceAll('__BUILD__', BUILD));
  }
  fs.writeFileSync(dst, b);
}
const sw = fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8'), idx = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
for (const a of JSON.parse(sw.match(/ASSETS=(\[[^\]]*\])/)[1].replace(/'/g, '"'))) if (a !== './' && !fs.existsSync(path.join(OUT, a))) throw new Error('precache asset missing: ' + a);
for (const i of JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.webmanifest'), 'utf8')).icons) if (!fs.existsSync(path.join(OUT, i.src))) throw new Error('manifest icon missing: ' + i.src);
if (/__VERSION__|__BUILD__/.test(idx + sw)) throw new Error('placeholder left in build');
console.log(`Built Editless v${VERSION} (build ${BUILD}) -> ${OUT} [${all.length} files]`);
