// DupeSweep – duplicate file finder. Offline: files are read on this PC only, nothing is uploaded.
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function fmtSize(b) { if (b < 1024) return b + ' B'; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1); return (b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)) + ' ' + u[i]; }
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

// ---------- storage ----------
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open('dupesweep', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return dbp;
}
async function dbGet(k) { const d = await db(); return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function dbSet(k, v) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

// ---------- Pro (Microsoft Store add-on via Digital Goods API) + one-time trial ----------
const STORE_BILLING = 'https://store.microsoft.com/billing';
const PRO_SKU = 'dupesweep_pro';
const PRO_IDS = [PRO_SKU];
let STORE_URL = 'https://apps.microsoft.com/detail/9P5LWPHRVRZV';
let proAvailable = false, proSku = PRO_SKU, isPro = false;
try { isPro = localStorage.getItem('dupesweep-pro') === '1'; } catch (_) {}
const TRIAL_DAYS = 7;
let trialStart = 0;
try { trialStart = Number(localStorage.getItem('dupesweep-trial')) || 0; } catch (_) {}
const trialLeft = () => (trialStart ? Math.max(0, Math.ceil((trialStart + TRIAL_DAYS * DAY - Date.now()) / DAY)) : 0);
const trialActive = () => trialLeft() > 0;
const unlocked = () => isPro || !proAvailable || trialActive();
const FREE_DOCS = 1;
async function loadTrial() {
  const t = await dbGet('trial').catch(() => 0);
  trialStart = Math.max(trialStart, Number(t) || 0);
  if (trialStart) { try { localStorage.setItem('dupesweep-trial', String(trialStart)); } catch (_) {} dbSet('trial', trialStart).catch(() => {}); }
}
async function startTrial() {
  if (trialStart) return;
  trialStart = Date.now();
  try { localStorage.setItem('dupesweep-trial', String(trialStart)); } catch (_) {}
  await dbSet('trial', trialStart).catch(() => {});
  setPro(isPro); $('proDialog').close(); toast(`★ Every Pro feature is unlocked for ${TRIAL_DAYS} days. Happy cleaning!`);
}
function proLabel() { return isPro ? '★ Pro' : trialActive() ? `★ Pro trial · ${trialLeft()} day${trialLeft() === 1 ? '' : 's'} left` : '★ Get Pro'; }
async function billing() {
  if (!('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(STORE_BILLING); } catch (_) { return null; }
}
function setPro(v) {
  isPro = v;
  try { localStorage.setItem('dupesweep-pro', v ? '1' : '0'); } catch (_) {}
  const b = $('proBtn');
  b.textContent = proLabel();
  b.classList.toggle('is-pro', v || trialActive());
  b.hidden = !proAvailable && !v;
  if (scanned) renderAll();
}
async function checkPro() {
  const svc = await billing();
  if (!svc) return false;
  try {
    const details = await svc.getDetails(PRO_IDS).catch(() => []);
    proAvailable = details.length > 0;
    if (details[0]) { proSku = details[0].itemId; if (!PRO_IDS.includes(proSku)) PRO_IDS.push(proSku); }
    const list = await svc.listPurchases();
    const owned = list.some((p) => PRO_IDS.includes(p.itemId));
    setPro(owned);
    return owned;
  } catch (_) { return isPro; }
}
function proMessage(text) { const m = $('proMsg'); m.hidden = !text; m.textContent = text || ''; }
async function openPro(reason) {
  if (!reason && !isPro && trialStart && !trialActive()) reason = 'Your free Pro trial has ended. Your scans stay here – unlock Pro to keep using the Pro tools.';
  proMessage(reason || '');
  $('trialBtn').hidden = isPro || !!trialStart;
  $('trialInfo').hidden = !trialActive() || isPro; $('trialInfo').textContent = trialActive() ? `You are trying Pro: ${trialLeft()} day${trialLeft() === 1 ? '' : 's'} left.` : '';
  const svc = await billing();
  if (!svc) { $('buyBtn').textContent = 'Get DupeSweep on Microsoft Store'; $('restoreBtn').hidden = true; }
  else {
    $('restoreBtn').hidden = false;
    try {
      const [d] = await svc.getDetails([proSku]);
      const price = d && d.price ? new Intl.NumberFormat(undefined, { style: 'currency', currency: d.price.currency }).format(Number(d.price.value)) : '';
      $('buyBtn').textContent = price ? `Unlock Pro – ${price}` : 'Unlock Pro';
    } catch (_) { $('buyBtn').textContent = 'Unlock Pro'; }
  }
  if (!$('proDialog').open) $('proDialog').showModal();
}
async function buyPro() {
  const svc = await billing();
  if (!svc) { window.open(STORE_URL, '_blank'); return; }
  const methods = [{ supportedMethods: STORE_BILLING, data: { sku: proSku } }];
  try {
    let req;
    try { req = new PaymentRequest(methods); } catch (_) { req = new PaymentRequest(methods, { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }); }
    const res = await req.show();
    await res.complete('success');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    proMessage('Purchase could not be completed: ' + (e.message || e));
    return;
  }
  if (await checkPro()) { proMessage('Thank you! Pro is unlocked. ★'); setTimeout(() => $('proDialog').close(), 1500); }
}
const needsPro = (why) => { if (unlocked()) return false; openPro(why); return true; };

// ---------- toast ----------
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 4200); }

// ---------- file types ----------
const TYPES = {
  img: { name: 'Photos', ext: 'jpg jpeg png gif webp bmp heic heif tif tiff raw cr2 cr3 nef arw dng orf rw2 svg ico avif' },
  vid: { name: 'Videos', ext: 'mp4 mov avi mkv wmv m4v webm 3gp mts m2ts mpg mpeg flv' },
  aud: { name: 'Music', ext: 'mp3 wav flac m4a aac ogg wma opus aiff' },
  doc: { name: 'Documents', ext: 'pdf doc docx xls xlsx ppt pptx txt rtf odt ods odp csv md epub pages key numbers' },
  arc: { name: 'Archives', ext: 'zip rar 7z tar gz bz2 xz iso dmg cab' },
};
const EXT2TYPE = {};
for (const [k, t] of Object.entries(TYPES)) for (const e of t.ext.split(' ')) EXT2TYPE[e] = k;
const ICON = { img: '🖼', vid: '🎬', aud: '🎵', doc: '📄', arc: '🗜', other: '📦' };
const extOf = (n) => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
const kindOf = (n) => EXT2TYPE[extOf(n)] || 'other';
const PHASH_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif']);
let types = new Set(); // empty = all

// ---------- state ----------
let roots = [];            // {id, name, handle|null, files|null}
let files = [];            // {id, name, path, size, mtime, kind, dir, fh, file, root}
let emptyDirs = [];        // {id, path, name, parent}
let dupGroups = [], simGroups = [];
let selected = new Set(), removed = new Set();
let tab = 'dupes', scanned = false, stopFlag = false, scanning = false;
let cleanedThisScan = 0, freedThisScan = 0;
let shown = 60, largeShown = new Set();
const FREE_CLEAN = 25;
const canWrite = () => 'showDirectoryPicker' in window;

// ---------- folders ----------
async function saveRoots() { await dbSet('roots', roots.filter((r) => r.handle).map((r) => ({ id: r.id, name: r.name, handle: r.handle }))).catch(() => {}); }
function renderFolders() {
  $('folderList').innerHTML = roots.length ? roots.map((r) => `<div class="folder"><span>📁 ${esc(r.name)}${r.handle ? '' : ' <small>(read-only)</small>'}</span><button data-rm="${r.id}" title="Remove from list">✕</button></div>`).join('') : '<p class="hint">No folders yet.</p>';
  $('scanBtn').disabled = !roots.length || scanning;
}
async function addFolder() {
  if (canWrite()) {
    try {
      const h = await window.showDirectoryPicker({ id: 'dupesweep', mode: 'readwrite' });
      for (const r of roots) if (r.handle && (await r.handle.isSameEntry(h))) return toast('That folder is already in the list.');
      roots.push({ id: 'r' + Date.now(), name: h.name, handle: h }); await saveRoots(); renderFolders();
    } catch (e) { if (e.name !== 'AbortError') toast('Could not open that folder: ' + e.message); }
  } else $('dirIn').click();
}

// ---------- scanning ----------
function setProgress(p, text) { $('progress').hidden = false; $('pfill').style.width = Math.round(p * 100) + '%'; $('ptext').textContent = text; }
const skipSet = () => new Set($('skipNames').value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
async function walk(dir, path, root, skip, inclHidden, counter) {
  let fileCount = 0; const sub = [];
  for await (const [name, h] of dir.entries()) {
    if (stopFlag) throw new Error('stopped');
    if (!inclHidden && (name.startsWith('.') || name.startsWith('$') || name.startsWith('~$'))) { fileCount++; continue; }
    if (skip.has(name.toLowerCase()) || (h.kind === 'directory' && name.startsWith('DupeSweep review'))) { fileCount++; continue; }
    if (h.kind === 'directory') sub.push([name, h]);
    else {
      fileCount++;
      try {
        const f = await h.getFile();
        files.push({ id: files.length, name, path: path + '/' + name, folder: path, size: f.size, mtime: f.lastModified, kind: kindOf(name), dir, fh: h, file: f, root });
      } catch (_) { /* locked or unreadable file */ }
      if (++counter.n % 250 === 0) setProgress(0.05, `Looking through folders… ${counter.n.toLocaleString()} files found`);
    }
  }
  for (const [name, h] of sub) {
    const n = await walk(h, path + '/' + name, root, skip, inclHidden, counter);
    if (n === 0) { const pp = path + '/' + name; emptyDirs = emptyDirs.filter((d) => !d.path.startsWith(pp + '/')); emptyDirs.push({ id: 'e' + emptyDirs.length + '_' + Date.now(), path: pp, name, parent: dir, root }); }
    else fileCount += n;
  }
  return fileCount;
}
async function digestBuf(buf) { return new Uint8Array(await crypto.subtle.digest('SHA-256', buf)); }
const hex = (u8) => Array.from(u8.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
async function headHash(f) { const n = Math.min(f.size, 65536); return hex(await digestBuf(await f.file.slice(0, n).arrayBuffer())); }
const CHUNK = 8 * 1024 * 1024;
async function fullHash(f, onBytes) {
  if (f.size <= CHUNK) { onBytes(f.size); return hex(await digestBuf(await f.file.arrayBuffer())); }
  const parts = [];
  for (let off = 0; off < f.size; off += CHUNK) {
    if (stopFlag) throw new Error('stopped');
    parts.push(await digestBuf(await f.file.slice(off, off + CHUNK).arrayBuffer()));
    onBytes(Math.min(CHUNK, f.size - off));
  }
  const all = new Uint8Array(parts.length * 32); parts.forEach((p, i) => all.set(p, i * 32));
  return hex(await digestBuf(all));
}
function groupBy(arr, key) { const m = new Map(); for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }

async function scan() {
  if (scanning) return;
  scanning = true; stopFlag = false; $('scanBtn').hidden = true; $('stopBtn').hidden = false; $('welcome').hidden = true; $('results').hidden = true;
  files = []; emptyDirs = []; dupGroups = []; simGroups = []; selected = new Set(); removed = new Set(); cleanedThisScan = 0; freedThisScan = 0; shown = 60;
  const t0 = Date.now();
  try {
    const skip = skipSet(), inclHidden = $('optHidden').checked, counter = { n: 0 };
    setProgress(0.02, 'Looking through folders…');
    for (const r of roots) {
      if (r.handle) {
        if ((await r.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') await r.handle.requestPermission({ mode: 'readwrite' }).catch(() => {});
        if ((await r.handle.queryPermission({ mode: 'read' })) !== 'granted') { toast(`No permission to read “${r.name}” – skipped.`); continue; }
        await walk(r.handle, r.name, r, skip, inclHidden, counter);
      } else if (r.files) {
        for (const f of r.files) {
          const parts = (f.webkitRelativePath || f.name).split('/');
          if (!inclHidden && parts.some((p) => p.startsWith('.') || p.startsWith('$'))) continue;
          if (parts.slice(0, -1).some((p) => skip.has(p.toLowerCase()))) continue;
          files.push({ id: files.length, name: f.name, path: parts.join('/'), folder: parts.slice(0, -1).join('/'), size: f.size, mtime: f.lastModified, kind: kindOf(f.name), dir: null, fh: null, file: f, root: r });
        }
      }
    }
    const minSize = +$('minSize').value;
    const cand = files.filter((f) => f.size > 0 && f.size >= minSize && (!types.size || types.has(f.kind)));
    // 1) same size
    const bySize = [...groupBy(cand, (f) => f.size).values()].filter((g) => g.length > 1);
    const n1 = bySize.reduce((n, g) => n + g.length, 0);
    let done = 0;
    // 2) same first 64 KB
    const byHead = [];
    for (const g of bySize) {
      for (const f of g) { f.head = await headHash(f).catch(() => null); if (++done % 50 === 0) setProgress(0.1 + 0.2 * (done / n1), `Comparing ${done.toLocaleString()} of ${n1.toLocaleString()} same-size files…`); if (stopFlag) throw new Error('stopped'); }
      for (const h of groupBy(g.filter((f) => f.head), (f) => f.head).values()) if (h.length > 1) byHead.push(h);
    }
    // 3) full content
    const totalBytes = byHead.reduce((n, g) => n + g.reduce((m, f) => m + f.size, 0), 0) || 1;
    let bytes = 0;
    for (const g of byHead) {
      for (const f of g) {
        f.hash = f.size <= 65536 ? f.head : await fullHash(f, (b) => { bytes += b; setProgress(0.3 + 0.5 * (bytes / totalBytes), `Checking contents byte by byte… ${fmtSize(bytes)} of ${fmtSize(totalBytes)}`); }).catch((e) => { if (e.message === 'stopped') throw e; return null; });
        if (f.size <= 65536) bytes += f.size;
      }
      for (const h of groupBy(g.filter((f) => f.hash), (f) => f.hash).values()) if (h.length > 1) dupGroups.push({ id: 'd' + dupGroups.length, size: h[0].size, items: h.map((f) => f.id) });
    }
    dupGroups.sort((a, b) => b.size * (b.items.length - 1) - a.size * (a.items.length - 1));
    // 4) similar photos
    if ($('optSimilar').checked && (!types.size || types.has('img'))) await findSimilar(minSize);
    applyRule('oldest', true);
    scanned = true;
    toast(`Scan finished in ${Math.max(1, Math.round((Date.now() - t0) / 1000))} s.`);
  } catch (e) {
    if (e.message === 'stopped') { toast('Scan stopped. Showing what was found so far.'); scanned = true; }
    else { console.error(e); toast('Scan problem: ' + e.message); }
  }
  scanning = false; $('scanBtn').hidden = false; $('stopBtn').hidden = true; $('progress').hidden = true;
  renderAll();
}

// perceptual hash (difference hash, 64 bits)
async function dhash(f) {
  const bmp = await createImageBitmap(f.file, { resizeWidth: 72, resizeHeight: 64, resizeQuality: 'high' });
  const c0 = new OffscreenCanvas(72, 64), x0 = c0.getContext('2d'); x0.filter = 'blur(2px)'; x0.drawImage(bmp, 0, 0); bmp.close();
  const c = new OffscreenCanvas(9, 8), x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c0, 0, 0, 9, 8);
  const d = x.getImageData(0, 0, 9, 8).data; let a = 0, b = 0;
  for (let y = 0; y < 8; y++) for (let i = 0; i < 8; i++) {
    const p = (y * 9 + i) * 4, q = p + 4;
    const l = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114, r = d[q] * 0.299 + d[q + 1] * 0.587 + d[q + 2] * 0.114;
    const bit = l > r ? 1 : 0, k = y * 8 + i;
    if (k < 32) a |= bit << k; else b |= bit << (k - 32);
  }
  return [a >>> 0, b >>> 0];
}
function pop(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
async function findSimilar(minSize) {
  const dupOf = new Map(); for (const g of dupGroups) g.items.slice(1).forEach((i) => dupOf.set(i, g.items[0]));
  let imgs = files.filter((f) => f.kind === 'img' && PHASH_EXT.has(extOf(f.name)) && f.size >= Math.max(minSize, 20480) && !dupOf.has(f.id));
  const MAX = 8000; if (imgs.length > MAX) { imgs = imgs.slice(0, MAX); toast(`Similar photos: checked the first ${MAX.toLocaleString()} photos.`); }
  const hs = [];
  for (let i = 0; i < imgs.length; i++) {
    if (stopFlag) throw new Error('stopped');
    try { hs.push([imgs[i], await dhash(imgs[i])]); } catch (_) {}
    if (i % 20 === 0) setProgress(0.8 + 0.18 * (i / imgs.length), `Looking for similar photos… ${i.toLocaleString()} of ${imgs.length.toLocaleString()}`);
  }
  const parent = hs.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const T = 10;
  for (let i = 0; i < hs.length; i++) { const [, [a1, b1]] = hs[i]; for (let j = i + 1; j < hs.length; j++) { const [, [a2, b2]] = hs[j]; if (pop(a1 ^ a2) + pop(b1 ^ b2) <= T) parent[find(i)] = find(j); } }
  const m = new Map(); hs.forEach(([f], i) => { const r = find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(f.id); });
  simGroups = [...m.values()].filter((g) => g.length > 1).map((items, i) => ({ id: 's' + i, items, size: items.reduce((n, id) => n + files[id].size, 0) }));
  simGroups.sort((a, b) => b.size - a.size);
}

// ---------- selection rules ----------
const live = (g) => g.items.filter((i) => !removed.has(i));
function curGroups() { return tab === 'similar' ? simGroups : dupGroups; }
let keepFolder = '';
function applyRule(rule, quiet) {
  const gs = curGroups().concat(quiet ? simGroups : []);
  for (const g of (quiet ? dupGroups.concat(simGroups) : gs)) {
    const it = live(g).map((i) => files[i]); if (it.length < 2) continue;
    it.forEach((f) => selected.delete(f.id));
    if (rule === 'none') continue;
    let keep;
    if (rule === 'newest') keep = it.reduce((a, b) => (b.mtime > a.mtime ? b : a));
    else if (rule === 'oldest') keep = it.reduce((a, b) => (b.mtime < a.mtime ? b : a));
    else if (rule === 'shortest') keep = it.reduce((a, b) => (b.path.length < a.path.length ? b : a));
    else if (rule === 'longest') keep = it.reduce((a, b) => (b.path.length > a.path.length ? b : a));
    else if (rule === 'largest') keep = it.reduce((a, b) => (b.size > a.size ? b : a));
    else if (rule === 'folder') keep = it.find((f) => f.folder.toLowerCase().includes(keepFolder)) || null;
    if (!keep) continue;
    if (g.id.startsWith('s') && quiet) continue; // similar photos: nothing pre-selected by default
    it.forEach((f) => { if (f !== keep) selected.add(f.id); });
  }
}

// ---------- rendering ----------
const thumbUrls = new Map();
function thumb(f) {
  if (f.kind === 'img' && PHASH_EXT.has(extOf(f.name))) {
    if (!thumbUrls.has(f.id)) thumbUrls.set(f.id, URL.createObjectURL(f.file));
    return `<img class="th" loading="lazy" src="${thumbUrls.get(f.id)}" alt="">`;
  }
  return `<span class="th ic">${ICON[f.kind]}</span>`;
}
function fileRow(f, g) {
  const sel = selected.has(f.id);
  return `<div class="frow${sel ? ' sel' : ''}" data-f="${f.id}">
    <label class="cb"><input type="checkbox" data-sel="${f.id}"${sel ? ' checked' : ''}></label>
    <button class="thb" data-view="${f.id}" title="Preview">${thumb(f)}</button>
    <div class="fn"><b title="${esc(f.name)}">${esc(f.name)}</b><small title="${esc(f.folder)}">${esc(f.folder)}</small></div>
    <span class="fd">${fmtDate(f.mtime)}</span><span class="fs">${fmtSize(f.size)}</span>
    <span class="tag ${sel ? 'rm' : 'keep'}">${sel ? 'remove' : 'keep'}</span></div>`;
}
function filterMatch(g) { const q = $('filterIn').value.trim().toLowerCase(); return !q || live(g).some((i) => files[i].path.toLowerCase().includes(q)); }
function renderGroups() {
  const box = $('groups'); let html = '';
  if (tab === 'dupes' || tab === 'similar') {
    const gs = curGroups().filter((g) => live(g).length > 1 && filterMatch(g));
    const locked = tab === 'similar' && !unlocked();
    const list = gs.slice(0, locked ? 2 : shown);
    html = list.map((g) => {
      const it = live(g).map((i) => files[i]);
      const head = tab === 'dupes' ? `${it.length} identical copies · ${fmtSize(g.size)} each · <b>${fmtSize(g.size * (it.length - 1))}</b> can be freed` : `${it.length} similar photos · ${fmtSize(it.reduce((n, f) => n + f.size, 0))} in total`;
      return `<div class="group"><div class="gh"><span class="gi">${ICON[it[0].kind]}</span><span>${head}</span></div>${it.map((f) => fileRow(f, g)).join('')}</div>`;
    }).join('');
    if (locked && gs.length > 2) html += `<div class="lockbox">🔒 ${gs.length - 2} more groups of similar photos found. <button class="primary" id="unlockSim">Unlock with Pro</button></div>`;
    if (!gs.length) html = `<div class="empty-msg">${scanned ? (tab === 'dupes' ? '🎉 No duplicate files found.' : $('optSimilar').checked ? '🎉 No similar photos found.' : 'Turn on “Find similar photos” and scan again.') : ''}</div>`;
    $('moreGroups').innerHTML = !locked && gs.length > shown ? `<button class="ghost wide" id="showMore">Show ${Math.min(60, gs.length - shown)} more groups (${gs.length - shown} left)</button>` : '';
  } else if (tab === 'large') {
    const big = files.filter((f) => !removed.has(f.id) && (!types.size || types.has(f.kind))).sort((a, b) => b.size - a.size).slice(0, 200).filter((f) => filterMatch({ items: [f.id] }));
    largeShown = new Set(big.map((f) => f.id));
    html = big.length ? `<div class="group"><div class="gh"><span class="gi">📦</span><span>The ${big.length} largest files – remove only what you no longer need</span></div>${big.map((f) => fileRow(f)).join('')}</div>` : '<div class="empty-msg">No files.</div>';
    $('moreGroups').innerHTML = '';
  } else {
    const ed = emptyDirs.filter((d) => !removed.has(d.id));
    html = ed.length ? `<div class="group"><div class="gh"><span class="gi">📁</span><span>${ed.length} empty folders${unlocked() ? '' : ' · <span class="pro-tag">Pro</span> to remove'}</span></div>${ed.map((d) => `<div class="frow${selected.has(d.id) ? ' sel' : ''}"><label class="cb"><input type="checkbox" data-sel="${d.id}"${selected.has(d.id) ? ' checked' : ''}></label><span class="th ic">📁</span><div class="fn"><b>${esc(d.name)}</b><small>${esc(d.path)}</small></div><span></span><span></span><span class="tag ${selected.has(d.id) ? 'rm' : 'keep'}">${selected.has(d.id) ? 'remove' : 'keep'}</span></div>`).join('')}</div>` : `<div class="empty-msg">${scanned ? '🎉 No empty folders.' : ''}</div>`;
    $('moreGroups').innerHTML = '';
  }
  box.innerHTML = html;
}
function selStats() {
  let n = 0, bytes = 0;
  for (const id of selected) {
    if (typeof id === 'string') { if (tab === 'empty' && !removed.has(id)) n++; continue; }
    if (removed.has(id)) continue;
    const inTab = tab === 'large' ? largeShown.has(id) : (tab === 'dupes' ? dupGroups : simGroups).some((g) => g.items.includes(id));
    if (!inTab) continue;
    n++; bytes += files[id].size;
  }
  return { n, bytes };
}
function renderSel() {
  const { n, bytes } = selStats();
  $('selInfo').innerHTML = n ? `<b>${n.toLocaleString()}</b> ${tab === 'empty' ? 'folder' : 'file'}${n === 1 ? '' : 's'} selected${bytes ? ` · <b>${fmtSize(bytes)}</b>` : ''}` : 'Nothing selected';
  $('moveBtn').disabled = !n || tab === 'empty'; $('delBtn').disabled = !n;
  $('moveBtn').hidden = tab === 'empty';
}
function renderSummary() {
  const dg = dupGroups.filter((g) => live(g).length > 1);
  const waste = dg.reduce((n, g) => n + g.size * (live(g).length - 1), 0);
  const sg = simGroups.filter((g) => live(g).length > 1);
  $('cDupes').textContent = scanned ? dg.length : ''; $('cSimilar').textContent = scanned && sg.length ? sg.length : ''; $('cEmpty').textContent = scanned && emptyDirs.length ? emptyDirs.filter((d) => !removed.has(d.id)).length : ''; $('cLarge').textContent = '';
  $('rSummary').innerHTML = tab === 'dupes' ? `${dg.length.toLocaleString()} groups of duplicates · <b>${fmtSize(waste)}</b> wasted` : tab === 'similar' ? `${sg.length.toLocaleString()} groups of similar photos` : tab === 'large' ? 'Largest files in the scanned folders' : 'Folders that contain no files';
  $('stats').hidden = !scanned;
  $('stats').innerHTML = `Scanned <b>${files.length.toLocaleString()}</b> files (${fmtSize(files.reduce((n, f) => n + f.size, 0))})<br>Duplicates: <b>${fmtSize(waste)}</b> can be freed${freedThisScan ? `<br>Freed so far: <b>${fmtSize(freedThisScan)}</b>` : ''}`;
  $('ruleSel').parentElement.hidden = tab === 'large' || tab === 'empty';
}
function renderAll() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  $('simTag').hidden = unlocked();
  renderFolders();
  if (!scanned) return;
  $('welcome').hidden = true; $('results').hidden = false;
  renderSummary(); renderGroups(); renderSel();
}

// ---------- preview ----------
function preview(id) {
  const f = files[id]; const url = URL.createObjectURL(f.file); let body;
  if (f.kind === 'img' && PHASH_EXT.has(extOf(f.name))) body = `<img src="${url}" class="pv">`;
  else if (f.kind === 'vid') body = `<video src="${url}" class="pv" controls></video>`;
  else if (f.kind === 'aud') body = `<audio src="${url}" controls style="width:100%"></audio>`;
  else if (extOf(f.name) === 'pdf') body = `<iframe src="${url}" class="pv pdf"></iframe>`;
  else body = `<div class="pv-ic">${ICON[f.kind]}</div>`;
  $('viewBody').innerHTML = `<h2 class="pv-t">${esc(f.name)}</h2><p class="hint">${esc(f.path)} · ${fmtSize(f.size)} · modified ${fmtDate(f.mtime)}</p>${body}`;
  $('viewDlg').showModal();
  $('viewDlg').addEventListener('close', () => { URL.revokeObjectURL(url); $('viewBody').innerHTML = ''; }, { once: true });
}

// ---------- cleaning ----------
let pending = null;
function selectedItems() {
  const out = [];
  for (const id of selected) {
    if (tab === 'empty') { if (typeof id === 'string' && !removed.has(id)) out.push(emptyDirs.find((d) => d.id === id)); continue; }
    if (typeof id !== 'number' || removed.has(id)) continue;
    const inTab = tab === 'large' ? largeShown.has(id) : (tab === 'dupes' ? dupGroups : simGroups).some((g) => g.items.includes(id));
    if (inTab) out.push(files[id]);
  }
  return out.filter(Boolean);
}
function allCopiesWarning(items) {
  const ids = new Set(items.map((f) => f.id)); const lost = [];
  for (const g of (tab === 'similar' ? simGroups : dupGroups)) { const l = live(g); if (l.length > 1 && l.every((i) => ids.has(i))) lost.push(files[l[0]].name); }
  return lost;
}
function askClean(mode) {
  const items = selectedItems(); if (!items.length) return;
  if (items.some((f) => !f.dir && !f.parent)) return toast('These files were opened read-only. Use “＋ Add a folder” in the DupeSweep app from Microsoft Store to allow removing files.');
  if (tab === 'empty' && needsPro('Removing empty folders is part of Pro.')) return;
  if (tab !== 'empty' && !unlocked() && cleanedThisScan + items.length > FREE_CLEAN) return openPro(`The free version cleans up to ${FREE_CLEAN} files per scan (${Math.max(0, FREE_CLEAN - cleanedThisScan)} left). Unlock Pro for unlimited cleaning.`);
  const bytes = items.reduce((n, f) => n + (f.size || 0), 0);
  const lost = tab === 'large' || tab === 'empty' ? [] : allCopiesWarning(items);
  pending = { mode, items };
  $('cTitle').textContent = mode === 'move' ? 'Move to review folder?' : tab === 'empty' ? 'Delete empty folders?' : 'Delete files?';
  $('cText').innerHTML = (mode === 'move'
    ? `<b>${items.length}</b> file${items.length === 1 ? '' : 's'} (${fmtSize(bytes)}) will be moved into a folder called <b>“DupeSweep review ${todayStr()}”</b> inside the scanned folder. Check them, then delete that folder yourself to free the space.`
    : `<b>${items.length}</b> ${tab === 'empty' ? 'empty folder' : 'file'}${items.length === 1 ? '' : 's'}${bytes ? ` (${fmtSize(bytes)})` : ''} will be <b>permanently deleted</b>.`)
    + (lost.length ? `<p class="warnbox">⚠ Every copy of ${lost.length} file${lost.length === 1 ? '' : 's'} is selected (for example “${esc(lost[0])}”). Nothing of ${lost.length === 1 ? 'it' : 'them'} would be left.</p>` : '');
  $('cAgreeRow').hidden = mode === 'move'; $('cAgree').checked = false;
  $('cOk').textContent = mode === 'move' ? 'Move' : 'Delete'; $('cOk').className = mode === 'move' ? 'primary' : 'danger-btn';
  $('confirmDlg').showModal();
}
const reviewDirs = new Map();
async function reviewDir(root) {
  if (reviewDirs.has(root.id)) return reviewDirs.get(root.id);
  const d = await root.handle.getDirectoryHandle(`DupeSweep review ${todayStr()}`, { create: true });
  reviewDirs.set(root.id, d); return d;
}
async function freeName(dir, name) {
  const ext = extOf(name), base = ext ? name.slice(0, -(ext.length + 1)) : name;
  for (let i = 0; i < 1000; i++) {
    const n = i ? `${base} (${i})${ext ? '.' + ext : ''}` : name;
    try { await dir.getFileHandle(n); } catch (_) { return n; }
  }
  return `${base} ${Date.now()}${ext ? '.' + ext : ''}`;
}
async function moveOne(f) {
  const dest = await reviewDir(f.root); const name = await freeName(dest, f.name);
  if (f.fh.move) { try { await f.fh.move(dest, name); return; } catch (_) { /* fall back to copy */ } }
  const nh = await dest.getFileHandle(name, { create: true }); const w = await nh.createWritable();
  await f.file.stream().pipeTo(w);
  await f.dir.removeEntry(f.name);
}
async function doClean() {
  const { mode, items } = pending; $('confirmDlg').close();
  for (const r of new Set(items.map((f) => f.root))) if (r.handle && (await r.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') await r.handle.requestPermission({ mode: 'readwrite' }).catch(() => {});
  let ok = 0, bytes = 0; const fails = [], log = [];
  setProgress(0, mode === 'move' ? 'Moving files…' : 'Deleting…');
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      if (tab === 'empty') await it.parent.removeEntry(it.name, { recursive: true });
      else if (mode === 'move') await moveOne(it);
      else await it.dir.removeEntry(it.name);
      removed.add(it.id); selected.delete(it.id); ok++; bytes += it.size || 0; log.push(it.path);
    } catch (e) { fails.push(`${it.name}: ${e.message}`); }
    setProgress((i + 1) / items.length, `${mode === 'move' ? 'Moving' : 'Deleting'} ${i + 1} of ${items.length}…`);
  }
  $('progress').hidden = true;
  if (tab !== 'empty') { cleanedThisScan += ok; freedThisScan += bytes; }
  const hist = (await dbGet('history').catch(() => null)) || [];
  if (ok) { hist.unshift({ date: Date.now(), mode: tab === 'empty' ? 'folders' : mode, count: ok, bytes, files: log.slice(0, 500) }); await dbSet('history', hist.slice(0, 50)).catch(() => {}); }
  renderAll();
  toast(fails.length ? `${ok} done, ${fails.length} could not be ${mode === 'move' ? 'moved' : 'deleted'} (in use or protected).` : `${mode === 'move' ? 'Moved' : 'Deleted'} ${ok} ${tab === 'empty' ? 'folder' : 'file'}${ok === 1 ? '' : 's'}${bytes ? ` – ${fmtSize(bytes)} ${mode === 'move' ? 'ready to review' : 'freed'}` : ''}.`);
}

// ---------- report & history ----------
function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function exportCsv() {
  if (needsPro('Exporting a report is part of Pro.')) return;
  const rows = [['Group', 'Type', 'File', 'Folder', 'Size (bytes)', 'Modified', 'Action']];
  for (const [label, gs] of [['Duplicate', dupGroups], ['Similar', simGroups]]) for (const g of gs) for (const i of g.items) { const f = files[i]; rows.push([g.id, label, f.name, f.folder, f.size, new Date(f.mtime).toISOString(), removed.has(i) ? 'removed' : selected.has(i) ? 'selected' : 'keep']); }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' })); a.download = `DupeSweep report ${todayStr()}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
async function showHistory() {
  const h = (await dbGet('history').catch(() => null)) || [];
  const total = h.reduce((n, x) => n + (x.mode === 'delete' ? x.bytes : 0), 0);
  $('histBody').innerHTML = h.length ? `<p class="hint">Space freed by deleting so far: <b>${fmtSize(total)}</b></p><div class="table-wrap"><table class="guests"><thead><tr><th>Date</th><th>Action</th><th>Items</th><th>Size</th></tr></thead><tbody>${h.map((x) => `<tr title="${esc(x.files.slice(0, 20).join('\n'))}"><td>${new Date(x.date).toLocaleString()}</td><td>${x.mode === 'move' ? '📂 Moved to review' : x.mode === 'folders' ? '📁 Empty folders deleted' : '🗑 Deleted'}</td><td>${x.count}</td><td>${fmtSize(x.bytes)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">Nothing cleaned yet.</p>';
  $('histDlg').showModal();
}

// ---------- events ----------
function bind() {
  $('typeChips').innerHTML = `<button data-ty="" class="on">All files</button>` + Object.entries(TYPES).map(([k, t]) => `<button data-ty="${k}">${ICON[k]} ${t.name}</button>`).join('');
  $('typeChips').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.ty; if (!k) types.clear(); else if (types.has(k)) types.delete(k); else types.add(k);
    $('typeChips').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.ty ? types.has(x.dataset.ty) : !types.size));
  });
  $('addFolder').onclick = addFolder;
  $('dirIn').onchange = () => { const fl = [...$('dirIn').files]; if (!fl.length) return; const name = (fl[0].webkitRelativePath || '').split('/')[0] || 'Folder'; roots.push({ id: 'r' + Date.now(), name, handle: null, files: fl }); renderFolders(); $('dirIn').value = ''; };
  $('folderList').addEventListener('click', async (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; roots = roots.filter((r) => r.id !== b.dataset.rm); await saveRoots(); renderFolders(); });
  $('scanBtn').onclick = scan; $('stopBtn').onclick = () => { stopFlag = true; };
  $('optSimilar').onchange = (e) => { if (e.target.checked && !unlocked()) toast('Free version shows the first 2 groups of similar photos. Pro shows them all.'); };
  document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.t; shown = 60; $('ruleSel').value = ''; renderAll(); }));
  $('groups').addEventListener('change', (e) => {
    const c = e.target.closest('[data-sel]'); if (!c) return;
    const id = /^\d+$/.test(c.dataset.sel) ? +c.dataset.sel : c.dataset.sel;
    if (c.checked) selected.add(id); else selected.delete(id);
    const row = c.closest('.frow'); row.classList.toggle('sel', c.checked); const tg = row.querySelector('.tag'); tg.className = 'tag ' + (c.checked ? 'rm' : 'keep'); tg.textContent = c.checked ? 'remove' : 'keep';
    renderSel();
  });
  $('groups').addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]'); if (v) return preview(+v.dataset.view);
    if (e.target.id === 'unlockSim') openPro('See every group of similar photos with Pro.');
  });
  $('moreGroups').addEventListener('click', (e) => { if (e.target.id === 'showMore') { shown += 60; renderGroups(); } });
  $('filterIn').oninput = () => { renderGroups(); };
  $('ruleSel').onchange = (e) => {
    const r = e.target.value; if (!r) return;
    if (!['oldest', 'newest', 'none'].includes(r) && needsPro('Smart auto-select rules are part of Pro.')) { e.target.value = ''; return; }
    if (r === 'folder') { const f = prompt('Keep the copy whose folder path contains:', keepFolder || 'Pictures'); if (!f) { e.target.value = ''; return; } keepFolder = f.trim().toLowerCase(); }
    applyRule(r); renderGroups(); renderSel(); e.target.value = '';
  };
  $('moveBtn').onclick = () => askClean('move'); $('delBtn').onclick = () => askClean('delete');
  $('cCancel').onclick = () => $('confirmDlg').close();
  $('cOk').onclick = () => { if (pending.mode === 'delete' && !$('cAgree').checked) return toast('Tick the box to confirm permanent deletion.'); doClean(); };
  $('moreBtn').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
  document.addEventListener('click', (e) => { if (!$('menu').hidden && !$('menu').contains(e.target)) $('menu').hidden = true; });
  $('menu').addEventListener('click', (e) => { if (e.target.closest('button,a')) $('menu').hidden = true; });
  $('csvBtn').onclick = exportCsv; $('historyBtn').onclick = showHistory; $('histClose').onclick = () => $('histDlg').close();
  $('viewClose').onclick = () => $('viewDlg').close();
  $('proBtn').onclick = () => { if (!isPro) openPro(); };
  $('buyBtn').onclick = buyPro; $('restoreBtn').onclick = async () => { proMessage((await checkPro()) ? 'Pro restored. ★' : 'No Pro purchase found on this Microsoft account.'); };
  $('closePro').onclick = () => $('proDialog').close(); $('trialBtn').onclick = startTrial;
  window.addEventListener('beforeunload', (e) => { if (scanning) { e.preventDefault(); e.returnValue = ''; } });
}

async function init() {
  bind();
  $('fsHint').textContent = canWrite() ? 'Tip: add Pictures, Downloads or a whole drive. DupeSweep asks Windows for permission to each folder.' : 'This browser can only read folders. Install DupeSweep from Microsoft Store to move or delete duplicates.';
  await loadTrial();
  const saved = (await dbGet('roots').catch(() => null)) || [];
  roots = saved.map((r) => ({ ...r, files: null }));
  renderFolders(); renderAll();
  setPro(isPro);
  checkPro();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
