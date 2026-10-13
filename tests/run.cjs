// Regression tests: real Chromium, real video files, production build (dist). Run: npm test
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const ROOT = path.resolve(__dirname, '..'), FX = n => path.join(__dirname, 'fixtures', n), OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const serve = dir => new Promise(res => { const s = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(dir, p);
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=600' }); r.end(b); }); });
  s.listen(0, '127.0.0.1', () => res({ url: 'http://127.0.0.1:' + s.address().port + '/', close: () => s.close() })); });
const build = (dir, ver) => cp.execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env: { ...process.env, EDITLESS_OUT: dir, EDITLESS_VERSION: ver }, stdio: 'pipe' });
let pass = 0, fail = 0; const failures = [];
const FILTER = process.env.TEST_FILTER ? new RegExp(process.env.TEST_FILTER, 'i') : null;
const t = async (name, fn) => { if (FILTER && !FILTER.test(name)) return; try { await fn(); pass++; console.log('  ok    ' + name); } catch (e) { fail++; failures.push(name); console.log('  FAIL  ' + name + '\n        ' + (e && e.message || e)); } };
const ok = (c, m) => { if (!c) throw new Error(m); }, eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m || ''} expected ~${b} (±${tol}), got ${a}`); };
const ready = pg => pg.waitForFunction(() => !document.getElementById('go').disabled || !document.getElementById('lerr').hidden, null, { timeout: 60000 });
const txt = (pg, s) => pg.inner_text ? null : pg.innerText(s);
(async () => {
  const DIST = path.join(ROOT, 'dist'); build(DIST, require('../package.json').version);
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const srv = await serve(DIST), URL0 = srv.url;
  const open = async (ctx, url = URL0, init) => { const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(String(e))); if (init) await pg.addInitScript(init); await pg.goto(url); return pg; };
  const loadVid = async (pg, f) => { await pg.setInputFiles('#f', FX(f)); await ready(pg); };
  const exportOut = async (pg, name) => { await pg.click('#go'); await pg.waitForSelector('#dlb', { timeout: 120000 }); const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#dlb')]); const f = path.join(OUT, name + path.extname(dl.suggestedFilename())); await dl.saveAs(f); return f; };
  const inspect = async (ctx, file) => { const pg = await open(ctx); await pg.setInputFiles('#f', file); await ready(pg); const r = await pg.evaluate(() => ({ err: !document.getElementById('lerr').hidden, dur: dur, w: v.videoWidth, h: v.videoHeight })); await pg.close(); return r; };
  const mk = () => browser.newContext({ viewport: { width: 1100, height: 900 } });

  console.log('\nBuild');
  await t('production build is stamped, consistent and complete', async () => {
    const idx = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
    ok(!/__VERSION__|__BUILD__/.test(idx + sw), 'placeholder left');
    const v1 = idx.match(/APP_VERSION='([^']+)',BUILD_ID='([^']+)'/), v2 = sw.match(/VERSION='([^']+)',BUILD='([^']+)'/);
    ok(v1 && v2, 'version constants missing'); eq(v1[1], v2[1], 'version mismatch page/sw'); eq(v1[2], v2[2], 'build id mismatch page/sw');
    eq(v1[1], require('../package.json').version, 'package.json version');
    const m = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8'));
    ok(m.name && m.short_name && m.start_url && m.scope && m.display === 'standalone', 'manifest fields');
    ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512') && m.icons.some(i => i.purpose === 'maskable'), 'manifest icons');
    ok(/<link rel="manifest"/.test(idx) && /apple-touch-icon/.test(idx) && /theme-color/.test(idx), 'install meta tags');
    ok(!/https?:\/\/(?!www\.w3\.org)[^"'\s)]+/.test(idx.replace(/<!--[\s\S]*?-->/g, '')), 'unexpected external URL (privacy: app must not call out)');
  });

  console.log('\nVideo processing and export');
  await t('talking video: silence found, export succeeds, exported file re-opens (unknown-duration WebM)', async () => {
    const ctx = await mk(), pg = await open(ctx); await loadVid(pg, 'talk.webm');
    const segs = await pg.evaluate(() => segs); eq(segs.length, 3, 'segment count');
    [[0, 2], [5, 7], [10, 12]].forEach((e, i) => { near(segs[i][0], e[0], .5, 'seg start'); near(segs[i][1], e[1], .5, 'seg end'); });
    const f = await exportOut(pg, 'a.out'); const r = await inspect(ctx, f);
    ok(!r.err, 'exported file could not be re-opened'); near(r.dur, 6.4, 1.5, 'exported duration'); eq(r.w, 720, 'width'); eq(r.h, 1280, 'height');
    eq(pg.errs.length, 0, 'page errors: ' + pg.errs); await ctx.close();
  });
  for (const [g, w, h] of [['yt', 1280, 720], ['feed', 720, 900]]) await t(`goal "${g}" exports ${w}x${h}`, async () => {
    const ctx = await mk(), pg = await open(ctx); await loadVid(pg, 'talk.webm'); await pg.click(`#goal button[data-g=${g}]`);
    const r = await inspect(ctx, await exportOut(pg, g + '.out')); eq(r.w, w, 'width'); eq(r.h, h, 'height'); await ctx.close(); });
  await t('portrait source, blurred-bar framing, export works', async () => {
    const ctx = await mk(), pg = await open(ctx); await loadVid(pg, 'portrait.webm'); await pg.click('#fmt button[data-r="16/9"]'); await pg.click('#fit button[data-v="1"]');
    const r = await inspect(ctx, await exportOut(pg, 'fit.out')); eq(r.w, 1280, 'width'); eq(r.h, 720, 'height'); await ctx.close(); });
  await t('video without audio: clear message and export still works', async () => {
    const ctx = await mk(), pg = await open(ctx); await loadVid(pg, 'noaudio.webm');
    ok((await pg.innerText('#msg')).includes('No audio'), 'no-audio message'); const r = await inspect(ctx, await exportOut(pg, 'na.out')); ok(!r.err && r.dur > 3, 'export unusable'); await ctx.close(); });
  await t('tap-to-edit timeline restores/removes sections and never removes the last one', async () => {
    const ctx = await mk(), pg = await open(ctx); await loadVid(pg, 'talk.webm'); await pg.locator('#tl').scrollIntoViewIfNeeded(); const b = await pg.locator('#tl').boundingBox();
    const tap = s => pg.mouse.click(b.x + b.width * s / 12, b.y + b.height / 2); await tap(3.5); eq(await pg.evaluate(() => segs.length), 2, 'gap restore merges');
    await tap(1); await tap(8); await tap(11); eq(await pg.evaluate(() => segs.length), 1, 'last section kept'); await ctx.close(); });

  console.log('\nFailures and unsupported input');
  for (const [f, label] of [['notvideo.txt', 'non-video file'], ['corrupt.webm', 'damaged video'], ['unsupported.avi', 'unsupported format (AVI)']])
    await t(`${label}: friendly inline error, no crash, UI stays usable`, async () => {
      const ctx = await mk(), pg = await open(ctx); await loadVid(pg, f);
      ok(await pg.isVisible('#lerr'), 'error not shown'); ok((await pg.innerText('#lerr')).length > 20, 'error text'); ok(await pg.isVisible('#hero') && !(await pg.isVisible('#ed')), 'must stay on start screen');
      await loadVid(pg, 'talk.webm'); ok(await pg.isVisible('#ed') && !(await pg.isVisible('#lerr')), 'cannot recover with a valid file'); eq(pg.errs.length, 0, 'page errors: ' + pg.errs); await ctx.close(); });
  await t('export failure (recorder throws): message shown, button recovers, session kept', async () => {
    const ctx = await mk(), pg = await open(ctx, URL0, () => { const R = window.MediaRecorder; window.MediaRecorder = class { static isTypeSupported() { return true; } constructor() { throw new Error('boom'); } }; });
    await loadVid(pg, 'talk.webm'); await pg.click('#go'); await pg.waitForFunction(() => document.getElementById('msg').textContent.includes('Export failed'), null, { timeout: 20000 });
    ok(!(await pg.isDisabled('#go')), 'button stuck'); eq(await pg.evaluate(() => exporting), false, 'exporting flag stuck'); ok(await pg.isVisible('#ed'), 'session lost'); await ctx.close(); });
  await t('browser without MediaRecorder: clear message, nothing breaks', async () => {
    const ctx = await mk(), pg = await open(ctx, URL0, () => { window.MediaRecorder = undefined; }); await loadVid(pg, 'talk.webm'); await pg.click('#go');
    ok((await pg.innerText('#msg')).includes('cannot export'), 'message'); ok(!(await pg.isDisabled('#go')), 'button stuck'); await ctx.close(); });
  await t('leaving mid-export is blocked; unload is guarded during a session, not when idle', async () => {
    const ctx = await mk(), pg = await open(ctx); const guard = () => pg.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; });
    eq(await guard(), false, 'idle must not warn'); await loadVid(pg, 'talk.webm'); eq(await guard(), true, 'session must warn');
    await pg.click('#go'); await pg.click('#home'); ok(await pg.isVisible('#ed'), 'reset during export must be blocked'); ok((await pg.innerText('#msg')).includes('Export in progress') || await pg.evaluate(() => exporting), 'blocked msg');
    await pg.waitForSelector('#dlb', { timeout: 120000 }); await ctx.close(); });

  console.log('\nOffline and install');
  await t('installs, caches versioned assets, works fully offline (including editing)', async () => {
    const ctx = await mk(), pg = await open(ctx); await pg.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 }); await pg.waitForSelector('#off:not([hidden])');
    const ver = require('../package.json').version, keys = await pg.evaluate(() => caches.keys()); eq(keys.length, 1, 'cache count'); ok(new RegExp(`^editless-${ver.replace(/\./g, '\\.')}-[0-9a-f]{8}$`).test(keys[0]), 'cache name: ' + keys[0]);
    const cached = await pg.evaluate(async k => (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname), keys[0]); ['/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'].forEach(p => ok(cached.includes(p), 'not cached: ' + p));
    await ctx.setOffline(true); await pg.reload(); ok((await pg.innerText('#ver')).includes('v' + ver), 'offline reload / version'); await loadVid(pg, 'talk.webm'); eq(await pg.evaluate(() => segs.length), 3, 'offline editing'); await ctx.close(); });

  console.log('\nSafe automatic updates');
  const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'editless-up-')); build(UD, '1.0.0'); const us = await serve(UD);
  const upd = pg => pg.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  const verOf = pg => pg.innerText('#ver');
  await t('update never discards an active session; user chooses when to apply', async () => {
    const ctx = await mk(), pg = await open(ctx, us.url); await pg.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
    await loadVid(pg, 'talk.webm'); await pg.evaluate(() => { window.__m = 1; }); const before = await pg.evaluate(() => segs.length);
    build(UD, '1.0.1'); await upd(pg); await pg.waitForFunction(() => !document.getElementById('upd').hidden, null, { timeout: 20000 });
    await pg.waitForFunction(() => document.getElementById('updt').textContent.includes('1.0.1'), null, { timeout: 5000 });
    ok((await verOf(pg)).includes('v1.0.0'), 'visible version must stay the running one'); eq(await pg.evaluate(() => window.__m), 1, 'page was reloaded silently!'); eq(await pg.evaluate(() => segs.length), before, 'edit state lost'); ok(await pg.isVisible('#ed'), 'editor closed');
    await pg.click('#updlater'); ok(!(await pg.isVisible('#upd')), 'banner stays'); await pg.waitForTimeout(1500); eq(await pg.evaluate(() => window.__m), 1, 'reloaded after Later');
    await pg.click('#again'); await pg.waitForFunction(() => document.getElementById('ver').textContent.includes('v1.0.1') && !window.__m, null, { timeout: 20000 });
    const keys = await pg.evaluate(() => caches.keys()); eq(keys.length, 1, 'old caches not removed: ' + keys); ok(keys[0].startsWith('editless-1.0.1-'), 'cache version'); await ctx.close(); });
  await t('"Update now" applies immediately; idle app updates by itself', async () => {
    const ctx = await mk(), pg = await open(ctx, us.url); await pg.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
    await loadVid(pg, 'talk.webm'); await pg.evaluate(() => { window.__m = 1; }); build(UD, '1.0.2'); await upd(pg); await pg.waitForFunction(() => !document.getElementById('upd').hidden, null, { timeout: 20000 });
    await pg.click('#updgo'); await pg.waitForFunction(() => document.getElementById('ver').textContent.includes('v1.0.2') && !window.__m, null, { timeout: 20000 });
    await pg.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 }); build(UD, '1.0.3'); await upd(pg);
    await pg.waitForFunction(() => document.getElementById('ver').textContent.includes('v1.0.3'), null, { timeout: 20000 }); await ctx.close(); });
  await t('update arriving mid-export waits: Update button disabled, export completes, nothing lost', async () => {
    const ctx = await mk(), pg = await open(ctx, us.url); await pg.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
    await loadVid(pg, 'talk.webm'); await pg.click('#go'); await pg.waitForFunction(() => window.exporting === true || exporting === true); build(UD, '1.0.4'); await upd(pg);
    await pg.waitForFunction(() => !document.getElementById('upd').hidden, null, { timeout: 20000 }); ok(await pg.isDisabled('#updgo'), 'must be disabled during export');
    await pg.waitForSelector('#dlb', { timeout: 120000 }); ok(!(await pg.isDisabled('#updgo')), 'must re-enable after export'); ok((await verOf(pg)).includes('v1.0.3'), 'must not have reloaded'); await ctx.close(); });

  await browser.close(); srv.close(); us.close();
  console.log(`\n${pass} passed, ${fail} failed` + (fail ? '\nFailed: ' + failures.join('; ') : '')); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
