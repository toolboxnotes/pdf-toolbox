// ---------- Third-party library loading ----------
const { PDFDocument, degrees, rgb, PDFName, PDFBool, PDFHexString } = PDFLib;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const blobUrl = (b64, type) => URL.createObjectURL(new Blob([b64ToBytes(b64)], { type }));
const pdfjsLib = await import(blobUrl(window.__PDFJS_MAIN_B64__, 'text/javascript'));
const workerUrl = blobUrl(window.__PDFJS_WORKER_B64__, 'text/javascript');
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
// Create the worker directly (under file:// pdf.js's own same-origin check fails and it falls back to the slow main-thread mode)
try { pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(workerUrl); }
catch (e) { console.warn(T('PDF worker 不可用，使用主线程模式'), e); }
const ASSETS = window.__PDFJS_ASSETS__;

// Let pdf.js read CMaps / fonts / wasm from the embedded data so it works offline and under file://
class EmbeddedDataFactory {
  constructor() {}
  async fetch({ kind, filename }) {
    const dir = { cMapUrl: 'cmaps/', standardFontDataUrl: 'standard_fonts/', wasmUrl: 'wasm/' }[kind];
    const data = ASSETS[dir + filename];
    if (!data) throw new Error(T('缺少内置资源：') + filename);
    return b64ToBytes(data);
  }
}

// ---------- General utilities ----------
const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function busy(on, text = T('处理中…'), progress = null) {
  $('#busy').hidden = !on;
  $('#busy-text').textContent = text;
  $('#busy-bar').style.width = progress == null ? '0' : Math.round(progress * 100) + '%';
}
const progress = (text, done, total) => busy(true, `${text} ${done}/${total}`, total ? done / total : null);

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
const baseName = (name) => name.replace(/\.[^.]+$/, '');
const readBytes = async (file) => new Uint8Array(await file.arrayBuffer());

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const mimeOf = (name) => ({ pdf: 'application/pdf', zip: 'application/zip', jpg: 'image/jpeg', png: 'image/png', md: 'text/markdown', txt: 'text/plain', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[name.split('.').pop().toLowerCase()] || 'application/octet-stream');

// Output: a single file is downloaded directly, multiple files are zipped
async function deliver(container, outputs, zipName, extraText = '') {
  let file;
  if (outputs.length === 1) {
    file = { name: outputs[0].name, blob: new Blob([outputs[0].data], { type: mimeOf(outputs[0].name) }) };
  } else {
    busy(true, T('正在打包 ZIP…'));
    const zip = new JSZip();
    const used = new Set();
    for (const o of outputs) {
      let n = o.name, k = 2;
      while (used.has(n)) n = baseName(o.name) + `(${k++}).` + o.name.split('.').pop();
      used.add(n);
      zip.file(n, o.data);
    }
    file = { name: zipName, blob: await zip.generateAsync({ type: 'blob' }) };
  }
  busy(false);
  downloadBlob(file.blob, file.name);
  const box = h('div', { class: 'result' },
    h('span', {}, T("✓ 完成：{0}（{1}）{2}", file.name, fmtSize(file.blob.size), extraText)),
    h('a', { href: '#', onclick: (e) => { e.preventDefault(); downloadBlob(file.blob, file.name); } }, T('重新下载')));
  container.replaceChildren(box);
  return file;
}

// Shared "run" wrapper: shows progress and catches errors
async function runTask(fn) {
  try {
    busy(true);
    await nextFrame();
    await fn();
  } catch (err) {
    console.error(err);
    toast(T('出错了：') + friendlyError(err), 6000);
  } finally {
    busy(false);
  }
}
function friendlyError(err) {
  const m = String(err && (err.message || err));
  if (/ignoreEncryption|is encrypted/i.test(m) || err?.name === 'PasswordException') return T('这个 PDF 有密码保护，请先用“解密 PDF”去掉密码');
  if (/Invalid PDF|No PDF header|Failed to parse/i.test(m)) return T('文件不是有效的 PDF，或已损坏');
  return m;
}

// ---------- Page ranges ----------
// "1-3, 5, 8-" → [[0,2],[4,4],[7,total-1]] (0-based)
function parseRanges(str, total) {
  const s = String(str || '').replace(/[，、；;]/g, ',').replace(/[－—–~～]/g, '-').trim();
  if (!s) return [[0, total - 1]];
  const out = [];
  for (const part of s.split(',').map(x => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
    else if (/^\d+$/.test(part)) { a = b = +part; }
    else throw new Error(T("页码格式不对：“{0}”，示例：1-3, 5, 8-", part));
    if (a < 1 || b > total || a > b) throw new Error(T("页码超出范围：“{0}”（共 {1} 页）", part, total));
    out.push([a - 1, b - 1]);
  }
  return out;
}
function rangeIndices(str, total) {
  const set = new Set();
  for (const [a, b] of parseRanges(str, total)) for (let i = a; i <= b; i++) set.add(i);
  return set;
}

// ---------- PDF loading / rendering ----------
async function loadLib(bytes) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}
async function openJs(bytes) {
  return pdfjsLib.getDocument({
    data: bytes.slice(),
    BinaryDataFactory: EmbeddedDataFactory,
    cMapUrl: 'cmaps/', cMapPacked: true,
    standardFontDataUrl: 'standard_fonts/', wasmUrl: 'wasm/',
    useWorkerFetch: false, isEvalSupported: false,
  }).promise;
}
const MAX_PIXELS = 36e6;
async function renderPage(page, scale, { background = '#fff' } = {}) {
  let vp = page.getViewport({ scale });
  if (vp.width * vp.height > MAX_PIXELS) {
    scale *= Math.sqrt(MAX_PIXELS / (vp.width * vp.height));
    vp = page.getViewport({ scale });
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(vp.width));
  c.height = Math.max(1, Math.floor(vp.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
  c._scale = scale;
  return c;
}
async function renderThumb(page, maxH = 150, maxW = 120) {
  const vp = page.getViewport({ scale: 1 });
  const s = Math.min(maxH / vp.height, maxW / vp.width) * (window.devicePixelRatio || 1);
  return renderPage(page, s);
}
function canvasBytes(canvas, type = 'image/png', quality) {
  return new Promise((res, rej) => canvas.toBlob(async b => b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error(T('图片生成失败'))), type, quality));
}
function copyCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// Rasterize: turn the given pages into images (shared by compress / flatten / redact)
async function rasterizePdf(bytes, { dpi = 150, format = 'jpg', quality = 0.8, only = null, paint = null, label = T('正在处理页面') } = {}) {
  const js = await openJs(bytes);
  const src = only ? await loadLib(bytes) : null;
  const out = await PDFDocument.create();
  for (let i = 0; i < js.numPages; i++) {
    progress(label, i + 1, js.numPages);
    if (only && !only.has(i)) {
      const [p] = await out.copyPages(src, [i]);
      out.addPage(p);
      continue;
    }
    const page = await js.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const canvas = await renderPage(page, dpi / 72);
    if (paint) paint(canvas.getContext('2d'), i, canvas._scale);
    const img = format === 'png'
      ? await out.embedPng(await canvasBytes(canvas, 'image/png'))
      : await out.embedJpg(await canvasBytes(canvas, 'image/jpeg', quality));
    const p = out.addPage([base.width, base.height]);
    p.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
    page.cleanup();
    canvas.width = canvas.height = 0;
  }
  await js.loadingTask.destroy();
  return out.save();
}

// ---------- Visual coordinates ↔ PDF coordinates (handles page rotation and crop box) ----------
// Visual coordinates: origin at the bottom-left of the page as the user sees it, in pt
function pageGeom(page) {
  const box = page.getCropBox();
  const R = ((page.getRotation().angle % 360) + 360) % 360;
  const swap = R === 90 || R === 270;
  return { box, R, VW: swap ? box.height : box.width, VH: swap ? box.width : box.height };
}
function toUser(g, vx, vy) {
  const { box: { x, y, width: W, height: H }, R } = g;
  let ux, uy;
  if (R === 0) { ux = vx; uy = vy; }
  else if (R === 90) { ux = W - vy; uy = vx; }
  else if (R === 180) { ux = W - vx; uy = H - vy; }
  else { ux = vy; uy = H - vx; }
  return [ux + x, uy + y];
}
// Draw an image at visual coordinates (x, y, bottom-left); angle is the visual counter-clockwise angle
function drawImageVisual(page, img, { x, y, w, h, angle = 0, opacity = 1 }) {
  const g = pageGeom(page);
  const [ux, uy] = toUser(g, x, y);
  page.drawImage(img, { x: ux, y: uy, width: w, height: h, rotate: degrees(angle + g.R), opacity });
}
// Place around the center point and rotate
function drawImageCentered(page, img, { cx, cy, w, h, angle = 0, opacity = 1 }) {
  const a = angle * Math.PI / 180;
  const x = cx - (w / 2 * Math.cos(a) - h / 2 * Math.sin(a));
  const y = cy - (w / 2 * Math.sin(a) + h / 2 * Math.cos(a));
  drawImageVisual(page, img, { x, y, w, h, angle, opacity });
}
function drawRectVisual(page, { x, y, w, h, color, opacity = 1 }) {
  const g = pageGeom(page);
  const [x1, y1] = toUser(g, x, y), [x2, y2] = toUser(g, x + w, y + h);
  page.drawRectangle({ x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), color, opacity, borderWidth: 0 });
}
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Text → transparent PNG (uses system fonts, so any language including CJK works). Returns the image and its size in pt
const TEXT_SCALE = 4;
const FONT_STACK = LANG === 'ko'
  ? '"Apple SD Gothic Neo","Malgun Gothic","맑은 고딕","Noto Sans CJK KR","PingFang SC","Microsoft YaHei",Arial,sans-serif'
  : '"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei","Apple SD Gothic Neo","Malgun Gothic","Noto Sans CJK SC",sans-serif';
function textCanvas(text, { size = 24, color = '#000', bold = false, family = FONT_STACK, lineHeight = 1.25 } = {}) {
  const lines = String(text).split('\n');
  const px = size * TEXT_SCALE;
  const font = `${bold ? '700' : '400'} ${px}px ${family}`;
  const m = document.createElement('canvas').getContext('2d');
  m.font = font;
  const w = Math.max(1, ...lines.map(l => m.measureText(l || ' ').width));
  const lh = px * lineHeight;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w + px * 0.1);
  c.height = Math.ceil(lh * lines.length);
  const ctx = c.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, px * 0.05, lh * (i + 0.5)));
  return { canvas: c, w: c.width / TEXT_SCALE, h: c.height / TEXT_SCALE };
}
async function embedText(doc, text, opts) {
  const t = textCanvas(text, opts);
  const img = await doc.embedPng(await canvasBytes(t.canvas));
  return { img, w: t.w, h: t.h };
}
async function embedImageFile(doc, file) {
  const bytes = await readBytes(file);
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (isPng) return doc.embedPng(bytes);
  if (isJpg) return doc.embedJpg(await canvasBytes(await imageToCanvas(file), 'image/jpeg', 0.92));
  return doc.embedPng(await canvasBytes(await imageToCanvas(file)));
}
// Read an image and orient it according to EXIF
async function imageToCanvas(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    bmp = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error(T('无法读取图片：') + file.name + T('（支持 JPG / PNG / WebP / GIF / BMP）')));
      im.src = URL.createObjectURL(file);
    });
  }
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return c;
}

// ---------- UI components ----------
// File picker (drag and drop + list + reordering)
// Files dropped on the home screen: handed to the file pickers created on the tool page when it opens
let PENDING_FILES = null;
// Preview thumbnails: each file is rendered once (cached per File object)
const THUMB_CACHE = new WeakMap();
function pdfThumbs(file, max = 40) {
  let c = THUMB_CACHE.get(file);
  if (c && c.max >= max) return c.p;
  const p = (async () => {
    const js = await openJs(await readBytes(file));
    const n = js.numPages, out = [];
    for (let i = 1; i <= Math.min(n, max); i++) {
      const page = await js.getPage(i);
      out.push(await renderThumb(page, 150, 116));
      page.cleanup();
    }
    js.loadingTask.destroy();
    return { n, canvases: out };
  })();
  p.catch(() => {});
  THUMB_CACHE.set(file, { max, p });
  return p;
}
const isPdfFile = (f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
const isImgFile = (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);
function thumbImg(c) {
  const k = copyCanvas(c);
  k.style.width = c.width / (window.devicePixelRatio || 1) + 'px';
  return k;
}
function filePicker({ accept = '.pdf,application/pdf', multiple = false, label, hint, onChange, sortable = multiple, preview = 'auto' } = {}) {
  let files = [];
  const input = h('input', { type: 'file', accept, multiple, hidden: true });
  const list = h('ul', { class: 'files' });
  const drop = h('div', { class: 'drop', onclick: () => input.click() },
    h('b', {}, label || (multiple ? T('点击选择或拖入文件（可多选）') : T('点击选择或拖入文件'))),
    h('p', {}, hint || (accept.includes('pdf') ? T('支持 PDF 文件') : T('支持 JPG / PNG / WebP 等图片'))));
  const accepts = (f) => accept.split(',').some(a => {
    a = a.trim();
    if (a.startsWith('.')) return f.name.toLowerCase().endsWith(a);
    if (a.endsWith('/*')) return f.type.startsWith(a.slice(0, -1));
    return f.type === a;
  });
  function add(list) {
    const ok = [...list].filter(accepts);
    if (ok.length < list.length) toast(T('已忽略不支持的文件'));
    if (!ok.length) return;
    files = multiple ? files.concat(ok) : [ok[0]];
    render();
    onChange && onChange(files);
  }
  if (PENDING_FILES && PENDING_FILES.length) {
    const mine = PENDING_FILES.filter(accepts);
    const take = multiple ? mine : mine.slice(0, 1);
    PENDING_FILES = PENDING_FILES.filter(f => !take.includes(f));
    if (take.length) setTimeout(() => add(take), 0);
  }
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files); });
  let dragIdx = -1;
  let render = function () {
    const card = list.closest('.main-card'), view = list.closest('.tool-view');
    if (card && view) view.classList.toggle('has-file', files.length > 0);
    list.replaceChildren(...files.map((f, i) => {
      const th = preview ? h('span', { class: 'fthumb' }) : null;
      if (th && isPdfFile(f)) pdfThumbs(f, 1).then(r => { if (r.canvases[0]) th.replaceChildren(h('img', { src: r.canvases[0].toDataURL() })); th.title = T('共 {0} 页', r.n); }).catch(() => th.classList.add('bad'));
      else if (th && isImgFile(f)) { const im = h('img', { src: URL.createObjectURL(f) }); th.append(im); }
      const li = h('li', { draggable: sortable }, th,
        sortable ? h('span', { class: 'meta' }, i + 1) : null,
        h('span', { class: 'name', title: f.name }, f.name),
        h('span', { class: 'meta' }, fmtSize(f.size)),
        sortable ? h('button', { class: 'icon-btn', title: T('上移'), onclick: () => move(i, i - 1) }, '↑') : null,
        sortable ? h('button', { class: 'icon-btn', title: T('下移'), onclick: () => move(i, i + 1) }, '↓') : null,
        h('button', { class: 'icon-btn', title: T('移除'), onclick: () => { files.splice(i, 1); render(); onChange && onChange(files); } }, '✕'));
      if (sortable) {
        li.addEventListener('dragstart', (e) => { dragIdx = i; e.dataTransfer.setData('text/plain', String(i)); li.classList.add('dragging'); });
        li.addEventListener('dragend', () => li.classList.remove('dragging'));
        li.addEventListener('dragover', e => e.preventDefault());
        li.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); move(dragIdx, i); });
      }
      return li;
    }));
  }
  function move(a, b) {
    if (b < 0 || b >= files.length || a === b) return;
    const [f] = files.splice(a, 1);
    files.splice(b, 0, f);
    render();
    onChange && onChange(files);
  }
  // With a single PDF, show thumbnails of all pages
  const strip = h('div', { class: 'page-strip' });
  const _render = render;
  render = function () {
    _render();
    strip.replaceChildren();
    const f = files[0];
    if (preview !== 'auto' || multiple || !f || !isPdfFile(f)) return;
    const MAX = 40;
    strip.append(h('div', { class: 'note' }, T('正在生成预览…')));
    pdfThumbs(f, MAX).then(r => {
      if (files[0] !== f) return;
      strip.replaceChildren(...r.canvases.map((c, i) => h('div', { class: 'pthumb' }, h('div', { class: 'pimg' }, h('img', { src: c.toDataURL() })), h('div', { class: 'pno' }, i + 1))),
        ...(r.n > MAX ? [h('div', { class: 'pmore' }, T('还有 {0} 页', r.n - MAX))] : []));
    }).catch(e => strip.replaceChildren(h('div', { class: 'warn' }, friendlyError(e))));
  };
  const wrap = h('div', { class: 'picker' }, drop, input, list, strip);
  const api = { el: wrap, get files() { return files; }, set(fs) { files = fs; render(); } };
  wrap.__api = api;
  return api;
}

// Option controls: all return { el, value }
function optSelect(label, options, value, onChange) {
  const s = h('select', { onchange: () => onChange && onChange(s.value) }, options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  return { el: h('div', { class: 'opt' }, h('label', {}, label), s), get value() { return s.value; }, set value(v) { s.value = v; }, input: s };
}
function optText(label, value = '', { placeholder, hint, full, multiline, onInput } = {}) {
  const i = multiline ? h('textarea', { rows: 3, placeholder }) : h('input', { type: 'text', placeholder });
  i.value = value;
  if (onInput) i.addEventListener('input', () => onInput(i.value));
  return { el: h('div', { class: 'opt' + (full ? ' full' : '') }, h('label', {}, label), i, hint ? h('div', { class: 'hint' }, hint) : null), get value() { return i.value; }, set value(v) { i.value = v; }, input: i };
}
function optNumber(label, value, { min, max, step = 1, hint, onInput } = {}) {
  const i = h('input', { type: 'number', min, max, step });
  i.value = value;
  if (onInput) i.addEventListener('input', () => onInput(+i.value));
  return { el: h('div', { class: 'opt' }, h('label', {}, label), i, hint ? h('div', { class: 'hint' }, hint) : null), get value() { const v = parseFloat(i.value); return isNaN(v) ? value : v; }, set value(v) { i.value = v; }, input: i };
}
function optRange(label, value, { min = 0, max = 100, step = 1, unit = '' } = {}) {
  const out = h('span', {}, value + unit);
  const i = h('input', { type: 'range', min, max, step, oninput: () => out.textContent = i.value + unit });
  i.value = value;
  return { el: h('div', { class: 'opt' }, h('label', {}, label, T('：'), out), i), get value() { return +i.value; }, input: i };
}
function optColor(label, value = '#000000') {
  const i = h('input', { type: 'color' });
  i.value = value;
  return { el: h('div', { class: 'opt' }, h('label', {}, label), i), get value() { return i.value; }, input: i };
}
function optCheck(label, checked = false, hint) {
  const i = h('input', { type: 'checkbox', checked });
  return { el: h('div', { class: 'opt' }, h('label', { style: { color: 'inherit', fontSize: '14px', display: 'flex', gap: '6px', alignItems: 'center', marginTop: '22px' } }, i, label), hint ? h('div', { class: 'hint' }, hint) : null), get value() { return i.checked; }, input: i };
}
function seg(options, value, onChange) {
  let cur = value;
  const btns = options.map(([v, t]) => h('button', { class: v === value ? 'on' : '', onclick: () => set(v) }, t));
  function set(v) {
    cur = v;
    btns.forEach((b, i) => b.classList.toggle('on', options[i][0] === v));
    onChange && onChange(v);
  }
  return { el: h('div', { class: 'seg' }, btns), get value() { return cur; }, set };
}
const card = (...kids) => h('div', { class: 'card' }, ...kids);
const optsGrid = (...items) => h('div', { class: 'opts' }, items.filter(Boolean).map(i => i.el || i));

// ---------- Tool registry ----------
const TOOLS = [];
const GROUPS = [T('整理'), T('优化'), T('转换'), T('编辑'), T('安全')];
function registerTool(t) { TOOLS.push(t); }
function toolHeader(t) {
  return [
    h('a', { class: 'back', href: '#' }, '← ', T('全部工具')),
    h('div', { class: 'tool-head' }, toolIcon(t), h('div', {}, h('h1', {}, t.name), h('p', {}, t.desc))),
  ];
}
