// Upgrade / update-lifecycle tests: real Chromium, real older releases (tests/fixtures/v1.1.0, legacy-v1.0), production builds.
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures'), VID = path.join(FX, 'talk.webm'), V110 = path.join(FX, 'v1.1.0'), LEGACY = path.join(FX, 'legacy-v1.0');
const NEWVER = require('../package.json').version, NEWERVER = NEWVER + '.1';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const serve = dir => new Promise(res => { const st = { fail: new Set(), drop: new Set(), count: {}, override: {} };
  const s = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; st.count[p] = (st.count[p] || 0) + 1;
    if (st.drop.has(p)) { q.socket.destroy(); return; } if (st.fail.has(p)) { r.writeHead(500); return r.end('boom'); } const f = st.override[p] || path.join(dir, p);
    fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=600' }); r.end(b); }); });
  s.listen(0, '127.0.0.1', () => res({ url: 'http://127.0.0.1:' + s.address().port + '/', close: () => s.close(), st })); });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ed-')), pub = (dir, src) => { fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(src, dir, { recursive: true }); };
const build = (out, ver) => cp.execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], { env: { ...process.env, EDITLESS_OUT: out, EDITLESS_VERSION: ver }, stdio: 'pipe' });
let pass = 0, fail = 0; const failures = []; const FILTER = process.env.TEST_FILTER ? new RegExp(process.env.TEST_FILTER, 'i') : null;
const t = async (name, fn) => { if (FILTER && !FILTER.test(name)) return; try { await fn(); pass++; console.log('  ok    ' + name); } catch (e) { fail++; failures.push(name); console.log('  FAIL  ' + name + '\n        ' + (e && e.message || e)); } };
const ok = (c, m) => { if (!c) throw new Error(m); }, eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ARGS = ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const ctl = pg => pg.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
const check = pg => pg.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()).then(() => 'ok', () => 'err'));
const keys = pg => pg.evaluate(() => caches.keys().then(k => k.sort()));
const verHas = (pg, v, to = 25000) => pg.waitForFunction(v => document.getElementById('ver') && document.getElementById('ver').textContent.includes('v' + v), v, { timeout: to });
const load = async pg => { await pg.setInputFiles('#f', VID); await pg.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 60000 }); };
const banner = pg => pg.waitForFunction(() => !document.getElementById('upd').hidden, null, { timeout: 25000 });
const open = async (ctx, url) => { const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', e => pg.errs.push(String(e))); await pg.goto(url); return pg; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const NEWSITE = tmp(), NEWER = tmp(); build(NEWSITE, NEWVER); build(NEWER, NEWERVER);
  const browser = await chromium.launch({ args: ARGS }), mk = () => browser.newContext({ viewport: { width: 1100, height: 900 } });
  const baseline = async () => { const D = tmp(); pub(D, NEWSITE); const s = await serve(D); const ctx = await mk(), pg = await open(ctx, s.url); await ctl(pg); await verHas(pg, NEWVER); return { D, s, ctx, pg }; };

  console.log('\nUpgrading real older installs');
  await t('v1.1.0 (idle) upgrades itself; stale caches removed, foreign cache kept; footer build == cache build; offline still works', async () => {
    const D = tmp(); pub(D, V110); const s = await serve(D), ctx = await mk(), pg = await open(ctx, s.url); await ctl(pg); await verHas(pg, '1.1.0');
    await pg.evaluate(() => Promise.all([caches.open('editless-0.9.0-deadbeef'), caches.open('other-app')])); pub(D, NEWSITE); await check(pg); await verHas(pg, NEWVER);
    const k = await keys(pg); eq(k.length, 2, 'caches: ' + k); ok(k.includes('other-app'), 'foreign cache must survive'); const mine = k.find(x => x.startsWith('editless-')); ok(mine.startsWith('editless-' + NEWVER + '-'), 'cache ' + mine);
    eq((await pg.innerText('#ver')).match(/build ([0-9a-f]{8})/)[1], mine.slice(-8), 'footer build id must equal running cache build');
    await ctx.setOffline(true); await pg.reload(); await verHas(pg, NEWVER); await load(pg); eq(await pg.evaluate(() => segs.length), 3, 'offline editing'); eq(pg.errs.length, 0, '' + pg.errs); await ctx.close(); s.close(); });
  await t('v1.1.0 with unsaved edit: banner, edit untouched; "Update now" then applies', async () => {
    const D = tmp(); pub(D, V110); const s = await serve(D), ctx = await mk(), pg = await open(ctx, s.url); await ctl(pg); await load(pg); await pg.evaluate(() => { window.__m = 1; });
    pub(D, NEWSITE); await check(pg); await banner(pg); eq(await pg.evaluate(() => window.__m), 1, 'reloaded silently'); eq(await pg.evaluate(() => segs.length), 3, 'edit lost'); await verHas(pg, '1.1.0');
    await pg.click('#updgo'); await verHas(pg, NEWVER); ok(!(await pg.evaluate(() => window.__m)), 'must have reloaded'); await ctx.close(); s.close(); });
  await t('legacy install (before 1.1.0): open window untouched; next launch runs the new version; old cache removed', async () => {
    const prof = tmp(), D = tmp(); pub(D, LEGACY); const s = await serve(D); let ctx = await chromium.launchPersistentContext(prof, { args: ARGS }); let pg = await ctx.newPage(); await pg.goto(s.url); await ctl(pg); await load(pg); await pg.evaluate(() => { window.__m = 1; });
    pub(D, NEWSITE); await check(pg); await sleep(3000); eq(await pg.evaluate(() => window.__m), 1, 'legacy window was reloaded'); eq(await pg.evaluate(() => segs.length), 3, 'legacy edit lost'); await ctx.close();
    ctx = await chromium.launchPersistentContext(prof, { args: ARGS }); pg = await ctx.newPage(); await pg.goto(s.url); await verHas(pg, NEWVER); await ctl(pg); await sleep(1500); const k = await keys(pg); ok(k.length === 1 && k[0].startsWith('editless-' + NEWVER), 'caches: ' + k); await ctx.close(); s.close(); });

  console.log('\nCheck triggers');
  await t('app launch picks up a release published while it was closed; offline launch still works', async () => {
    const prof = tmp(), D = tmp(); pub(D, V110); const s = await serve(D); let ctx = await chromium.launchPersistentContext(prof, { args: ARGS }); let pg = await ctx.newPage(); await pg.goto(s.url); await ctl(pg); await verHas(pg, '1.1.0'); await ctx.close();
    pub(D, NEWSITE); ctx = await chromium.launchPersistentContext(prof, { args: ARGS }); pg = await ctx.newPage(); await pg.goto(s.url); await verHas(pg, NEWVER); await ctl(pg); await ctx.close();
    ctx = await chromium.launchPersistentContext(prof, { args: ARGS }); await ctx.setOffline(true); pg = await ctx.newPage(); await pg.goto(s.url); await verHas(pg, NEWVER, 10000); await load(pg); await ctx.close(); s.close(); });
  await t('returning online triggers a check (and bursts are coalesced)', async () => {
    const { s, pg, ctx } = await baseline(); await sleep(5500); const n0 = s.st.count['/sw.js'] || 0; ok(n0 >= 1, 'no check at launch');
    await pg.evaluate(() => { dispatchEvent(new Event('online')); dispatchEvent(new Event('online')); }); await sleep(1500); eq((s.st.count['/sw.js'] || 0) - n0, 1, 'online must cause exactly one check'); await ctx.close(); s.close(); });

  console.log('\nFailed, mixed and interrupted downloads');
  await t('failed asset download: no banner, no partial cache, app unharmed; retry then succeeds', async () => {
    const { D, s, ctx, pg } = await baseline(); const base = await keys(pg); pub(D, NEWER); s.st.fail.add('/icons/icon-512.png'); await check(pg); await sleep(2500);
    ok(!(await pg.isVisible('#upd')), 'banner for a failed install'); eq(JSON.stringify(await keys(pg)), JSON.stringify(base), 'partial cache left behind'); await verHas(pg, NEWVER, 3000); await load(pg); eq(pg.errs.length, 0, '' + pg.errs);
    s.st.fail.clear(); await pg.evaluate(() => { window.__m = 1; }); await pg.reload(); await verHas(pg, NEWERVER); await ctx.close(); s.close(); });
  await t('mixed deploy (new sw.js with old index.html) is refused, then accepted once consistent', async () => {
    const { D, s, ctx, pg } = await baseline(); const base = await keys(pg); pub(D, NEWER); s.st.override['/index.html'] = path.join(NEWSITE, 'index.html'); await check(pg); await sleep(2500);
    eq(JSON.stringify(await keys(pg)), JSON.stringify(base), 'mixed-build cache kept'); await verHas(pg, NEWVER, 3000); delete s.st.override['/index.html']; await check(pg); await verHas(pg, NEWERVER); await ctx.close(); s.close(); });
  await t('connection dropped during check: quiet, app keeps working; next check (online event) succeeds', async () => {
    const { D, s, ctx, pg } = await baseline(); await load(pg); await sleep(5200); s.st.drop.add('/sw.js'); pub(D, NEWER); eq(await check(pg), 'err', 'update() while the connection drops'); await sleep(500);
    ok(!(await pg.isVisible('#upd')), 'banner while offline'); eq(pg.errs.length, 0, '' + pg.errs); ok(await pg.isVisible('#ed'), 'session lost'); s.st.drop.clear(); await pg.evaluate(() => dispatchEvent(new Event('online'))); await banner(pg); await verHas(pg, NEWVER, 2000); await ctx.close(); s.close(); });

  console.log('\nMultiple tabs and exports');
  await t('tab A editing, tab B idle: B updates, A keeps its edit and is told to reload', async () => {
    const { D, s, ctx, pg: A } = await baseline(); await load(A); await A.evaluate(() => { window.__m = 1; }); const B = await open(ctx, s.url); await ctl(B); pub(D, NEWER); await check(B);
    await verHas(B, NEWERVER); await A.waitForFunction(() => document.getElementById('updgo').textContent === 'Reload now', null, { timeout: 20000 }); eq(await A.evaluate(() => window.__m), 1, 'A reloaded'); eq(await A.evaluate(() => segs.length), 3, 'A edit lost');
    await A.waitForFunction(() => document.getElementById('ver').textContent.includes('is installed: reload'), null, { timeout: 8000 }); await A.click('#updgo'); await verHas(A, NEWERVER); ok(!(await A.evaluate(() => window.__m)), 'A should have reloaded'); await ctx.close(); s.close(); });
  await t('both tabs editing: updating in one never touches the other', async () => {
    const { D, s, ctx, pg: A } = await baseline(); await load(A); const B = await open(ctx, s.url); await ctl(B); await load(B); await B.evaluate(() => { window.__m = 1; }); pub(D, NEWER); await check(A); await banner(A); await banner(B);
    await A.click('#updgo'); await verHas(A, NEWERVER); await B.waitForFunction(() => document.getElementById('updgo').textContent === 'Reload now', null, { timeout: 20000 }); eq(await B.evaluate(() => window.__m), 1, 'B reloaded'); eq(await B.evaluate(() => segs.length), 3, 'B edit lost'); await ctx.close(); s.close(); });
  await t('export running in A while B updates: export finishes, A never reloads, Reload is disabled until done', async () => {
    const { D, s, ctx, pg: A } = await baseline(); await load(A); await A.evaluate(() => { window.__m = 1; }); const B = await open(ctx, s.url); await ctl(B); await A.click('#go'); await A.waitForFunction(() => exporting === true);
    pub(D, NEWER); await check(B); await verHas(B, NEWERVER); await A.waitForFunction(() => document.getElementById('updgo').textContent === 'Reload now' && document.getElementById('updgo').disabled, null, { timeout: 20000 });
    await A.waitForSelector('#dlb', { timeout: 120000 }); eq(await A.evaluate(() => window.__m), 1, 'export tab reloaded'); ok(!(await A.isDisabled('#updgo')), 'Reload must enable after export'); await ctx.close(); s.close(); });

  console.log('\nUnsaved-work guard');
  await t('close/reload warning only while there is unsaved work', async () => {
    const { s, ctx, pg } = await baseline(); const guard = () => pg.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; });
    eq(await guard(), false, 'idle'); await load(pg); eq(await guard(), true, 'after load'); await pg.click('#go'); await pg.waitForSelector('#dlb', { timeout: 120000 }); eq(await guard(), true, 'exported but not saved');
    await Promise.all([pg.waitForEvent('download'), pg.click('#dlb')]); await sleep(300); eq(await guard(), false, 'after saving'); await pg.click('#fit button[data-v="1"]'); eq(await guard(), true, 'edited again'); await ctx.close(); s.close(); });

  await browser.close(); console.log(`\n${pass} passed, ${fail} failed` + (fail ? '\nFailed: ' + failures.join('; ') : '')); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
