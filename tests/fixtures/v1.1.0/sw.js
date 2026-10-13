// Editless service worker. VERSION/BUILD are stamped by scripts/build.mjs.
const VERSION='1.1.0',BUILD='bf3a24a8',CACHE='editless-'+VERSION+'-'+BUILD,
ASSETS=['./','index.html','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','icons/apple-touch-icon.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(a=>new Request(a,{cache:'reload'}))))));
// No automatic skipWaiting: a new version waits until the page says it is safe, so an open edit is never interrupted.
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('editless-')&&x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('message',e=>{const d=e.data||{};
 if(d.type==='SKIP_WAITING')self.skipWaiting();
 if(d.type==='GET_VERSION'&&e.source)e.source.postMessage({type:'VERSION',version:VERSION,build:BUILD})});
// Network-first (4s timeout) so updates arrive; cache is the offline fallback.
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==location.origin)return;
 e.respondWith((async()=>{const c=await caches.open(CACHE);
  try{const res=await Promise.race([fetch(r,{cache:'no-cache'}),new Promise((_,j)=>setTimeout(j,4000))]);
   if(res.ok&&res.status===200&&res.type==='basic')c.put(r,res.clone());return res}
  catch(_){const hit=await c.match(r,{ignoreSearch:true})||(r.mode==='navigate'?await c.match('index.html'):null);return hit||Response.error()}})())});
