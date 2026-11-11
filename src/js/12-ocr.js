// ================= OCR (text recognition) =================
// tesseract.js + embedded recognition engine (wasm) and language data (Korean / English / Simplified Chinese), runs offline
const OCR_LANG_NAMES = {
  en: { kor: 'Korean', eng: 'English', chi_sim: 'Chinese (Simplified)' },
  ko: { kor: '한국어', eng: '영어', chi_sim: '중국어 간체' },
  zh: { kor: '韩文', eng: '英文', chi_sim: '简体中文' },
};
const OCR_LANGS = ['kor', 'eng', 'chi_sim'].map(l => [l, (OCR_LANG_NAMES[LANG] || OCR_LANG_NAMES.en)[l]]);
function defaultOcrLangs() {
  try { const s = localStorage.getItem('pdftool.ocrLangs'); if (s) return s.split('+').filter(l => OCR_LANGS.some(o => o[0] === l)); } catch {}
  return LANG === 'ko' ? ['kor', 'eng'] : LANG === 'zh' ? ['chi_sim', 'eng'] : ['eng'];
}
function saveOcrLangs(langs) { try { localStorage.setItem('pdftool.ocrLangs', langs.join('+')); } catch {} }

// Worker script = language data + fetch interception + recognition engine + tesseract worker (all from data embedded in the page)
const TESS_LANG_HOST = 'https://tessdata.local';
let tessWorkerUrl = null;
function buildTessWorkerUrl() {
  if (tessWorkerUrl) return tessWorkerUrl;
  const get = (id) => { const el = document.getElementById(id); if (!el) throw new Error(T('缺少内置资源：') + id); return el.textContent; };
  const parts = ['self.__TESS_LANG__={'];
  OCR_LANGS.forEach(([l], i) => parts.push((i ? ',' : '') + JSON.stringify(l) + ':"', get('tess-lang-' + l).trim(), '"'));
  parts.push(`};
(function () {
  var L = self.__TESS_LANG__, orig = self.fetch;
  self.fetch = function (u) {
    var m = String(u).match(/^${TESS_LANG_HOST.replace(/[./]/g, '\\$&')}\\/(\\w+)\\.traineddata(\\.gz)?$/);
    if (m && L[m[1]]) {
      var b = atob(L[m[1]]), a = new Uint8Array(b.length);
      for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
      return Promise.resolve(new Response(a, { status: 200 }));
    }
    return orig ? orig.apply(self, arguments) : Promise.reject(new Error('offline'));
  };
})();
`, get('tess-core'), '\n;\n', get('tess-worker'));
  tessWorkerUrl = URL.createObjectURL(new Blob(parts, { type: 'text/javascript' }));
  return tessWorkerUrl;
}

let tessWorker = null, tessKey = '', ocrLog = null;
async function getTess(langs) {
  const key = langs.join('+');
  if (tessWorker && tessKey === key) return tessWorker;
  if (tessWorker) { await tessWorker.terminate(); tessWorker = null; }
  busy(true, T('正在加载文字识别引擎…'));
  await nextFrame();
  tessWorker = await Tesseract.createWorker(key, 1, {
    workerPath: buildTessWorkerUrl(), workerBlobURL: false, corePath: 'embedded.js',
    langPath: TESS_LANG_HOST, cacheMethod: 'none', gzip: true,
    logger: (m) => ocrLog && ocrLog(m),
  });
  // Automatic page segmentation; keep word-spacing information
  await tessWorker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
  tessKey = key;
  return tessWorker;
}

// Original resolution of a scanned page: find the largest image on the page and estimate DPI assuming it fills the page width (returns 0 on failure)
async function scanDpi(page) {
  try {
    const vp = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const IMG = [pdfjsLib.OPS.paintImageXObject, pdfjsLib.OPS.paintInlineImageXObject, pdfjsLib.OPS.paintImageXObjectRepeat].filter(x => x != null);
    let best = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (!IMG.includes(ops.fnArray[i])) continue;
      const a = ops.argsArray[i];
      let w = 0, hh = 0;
      if (a && typeof a[0] === 'string') {
        const o = await new Promise(res => { try { page.objs.get(a[0], res); } catch { try { page.commonObjs.get(a[0], res); } catch { res(null); } } });
        if (o) { w = o.width; hh = o.height; }
        if (!w && a[1] && a[2]) { w = a[1]; hh = a[2]; }
      } else if (a && a[0] && a[0].width) { w = a[0].width; hh = a[0].height; }
      const long = Math.max(w, hh), pageLong = Math.max(vp.width, vp.height);
      if (long > 0 && Math.min(w, hh) > 200) best = Math.max(best, long / (pageLong / 72));
    }
    return best;
  } catch { return 0; }
}

// Recognize one page: returns word positions (visual coordinates, origin at top-left, in pt; base is the baseline)
async function ocrPage(page, langs, { dpi = 'auto', label = '' } = {}) {
  if (dpi === 'auto') {
    // Recognition works best at the scan's original resolution (upscaling makes it worse); pages without images use 300
    const d = await scanDpi(page);
    dpi = d ? Math.max(150, Math.min(400, Math.round(d))) : 300;
  }
  const canvas = await renderPage(page, dpi / 72);
  const s = canvas._scale;
  const w = await getTess(langs);
  ocrLog = (m) => { if (m.status === 'recognizing text') busy(true, T('正在识别文字（OCR）') + label, m.progress); };
  busy(true, T('正在识别文字（OCR）') + label, 0);
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
  ocrLog = null;
  canvas.width = canvas.height = 0;
  const words = [];
  let li = 0;
  const good = (wd) => { const t = (wd.text || '').trim(); return t && !(wd.confidence < 35 || (wd.confidence < 65 && !/[\p{L}\p{N}]/u.test(t))); };
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    li++;
    const bl = l.baseline && l.baseline.has_baseline !== false ? l.baseline : null;
    const lineTop = l.bbox.y0 / s;
    const rowH = l.rowAttributes && l.rowAttributes.rowHeight;
    // Tesseract often splits one Korean or Chinese word into several "words"; regroup them using the spaces in the full line text
    const groups = groupByLineText(l);
    for (const g of groups) {
      const ws = g.filter(good);
      if (!ws.length) continue;
      const t = ws.map(wd => wd.text.trim()).join('');
      const x0 = Math.min(...ws.map(wd => wd.bbox.x0)) / s, x1 = Math.max(...ws.map(wd => wd.bbox.x1)) / s;
      const top = Math.min(...ws.map(wd => wd.bbox.y0)) / s, bottom = Math.max(...ws.map(wd => wd.bbox.y1)) / s;
      let base = bottom;
      if (bl && bl.x1 > bl.x0) {
        const cx = (x0 + x1) / 2 * s;
        base = (bl.y0 + (bl.y1 - bl.y0) * (cx - bl.x0) / (bl.x1 - bl.x0)) / s;
        if (base < top || base > bottom + (bottom - top)) base = bottom;
      }
      const size = Math.max(3, rowH ? rowH / s * 0.85 : (base - Math.min(lineTop, top)) * 1.15);
      words.push({ text: t, x: x0, end: Math.max(x1, x0 + 1), top, bottom, base, size, line: li });
    }
  }
  return { words: mergeWords(words), text: data.text || '' };
}
// Group Tesseract's words by the full line text (which has correct spaces): each group is one space-separated word
function groupByLineText(l) {
  const ws = l.words || [];
  const tokens = (l.text || '').trim().split(/\s+/).filter(Boolean);
  const groups = [];
  let k = 0;
  for (const tok of tokens) {
    const g = [];
    let acc = '';
    while (k < ws.length && acc.length < tok.length) { const t = (ws[k].text || '').replace(/\s/g, ''); g.push(ws[k++]); acc += t; }
    if (acc !== tok) return ws.map(w => [w]); // If they don't line up, keep the original words
    groups.push(g);
  }
  if (k < ws.length) return ws.map(w => [w]);
  return groups;
}
// Words are already grouped by the line text; here we only mark which words are followed by a space (so copied text has correct spacing)
function mergeWords(words) {
  const out = words.map(w => ({ ...w }));
  out.forEach((w, i) => { const n = out[i + 1]; w.space = !!(n && n.line === w.line); });
  return out;
}

// Turn OCR results into the same structure as pdf.js getTextContent(), so the existing conversion code can use it directly
function ocrTextContent(page, r) {
  const vp = page.getViewport({ scale: 1 });
  const R = (((page.rotate || 0) % 360) + 360) % 360 * Math.PI / 180;
  const c = Math.cos(R), sn = Math.sin(R);
  const items = r.words.map((w, i) => {
    const [ux, uy] = vp.convertToPdfPoint(w.x, w.base);
    const next = r.words[i + 1];
    return { str: w.text + (w.space ? ' ' : ''), transform: [w.size * c, w.size * sn, -w.size * sn, w.size * c, ux, uy], width: w.end - w.x, height: w.size, fontName: 'OCR', dir: 'ltr', hasEOL: !next || next.line !== w.line };
  });
  return { items, styles: { OCR: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2, vertical: false } }, ocr: true };
}

// Auto OCR: when running inside withAutoOcr, pages without text are OCRed first
let OCR_AUTO = null;
const ocrCache = new WeakMap(); // Don't recognize the same page twice (key: pdf.js page object + languages)
async function pageHasText(page, min = 10) {
  const tc = await page.getTextContent();
  return [tc, tc.items.reduce((n, it) => n + (it.str ? it.str.replace(/\s/g, '').length : 0), 0) >= min];
}
async function pageTextContent(page) {
  const [tc, has] = await pageHasText(page);
  if (!OCR_AUTO || has) return tc;
  const key = OCR_AUTO.langs.join('+');
  const hit = ocrCache.get(page);
  if (hit && hit.key === key) { OCR_AUTO.pages++; return hit.tc; }
  const r = await ocrPage(page, OCR_AUTO.langs, { label: ` ${page.pageNumber}` });
  OCR_AUTO.pages++;
  const out = ocrTextContent(page, r);
  ocrCache.set(page, { key, tc: out });
  return out;
}
async function withAutoOcr(opt, fn) {
  if (!opt || !opt.enabled || !opt.langs.length) return { result: await fn(), ocrPages: 0 };
  OCR_AUTO = { langs: opt.langs, pages: 0 };
  try { const result = await fn(); return { result, ocrPages: OCR_AUTO.pages }; }
  finally { OCR_AUTO = null; }
}

// UI: OCR options (on / off + languages)
function ocrOption({ auto = true, label } = {}) {
  const langs = new Set(defaultOcrLangs());
  const box = h('div', { class: 'ocr-langs' }, OCR_LANGS.map(([v, t]) => {
    const i = h('input', { type: 'checkbox', checked: langs.has(v), onchange: () => { i.checked ? langs.add(v) : langs.delete(v); saveOcrLangs([...langs]); } });
    return h('label', {}, i, t);
  }));
  const en = auto ? h('input', { type: 'checkbox', checked: true, onchange: () => { box.style.opacity = en.checked ? 1 : 0.45; } }) : null;
  const el = h('div', { class: 'opt full ocr-opt' },
    auto ? h('label', { class: 'ocr-main' }, en, label || T('扫描页自动识别文字（OCR）')) : h('label', {}, T('识别语言')),
    box,
    h('div', { class: 'hint' }, auto ? T('只对没有文字的页面（扫描件、照片）识别。语言选得越多越慢，只勾选文件里有的语言。') : T('语言选得越多越慢，只勾选文件里有的语言。')));
  return {
    el,
    get value() {
      const ls = OCR_LANGS.map(o => o[0]).filter(l => langs.has(l));
      return { enabled: (auto ? en.checked : true) && ls.length > 0, langs: ls };
    },
  };
}

// ---------- Invisible text layer (GlyphLessFont, the same approach as Tesseract's searchable PDFs) ----------
// Font: every character maps to the same blank glyph, CID = Unicode code point, ToUnicode maps back to the original text
const GLYPHLESS_TTF = 'AAEAAAAKAIAAAwAgT1MvMlbeyJQAAAEoAAAAYGNtYXAACgA0AAABkAAAAB5nbHlmFSJBJAAAAbgAAAAYaGVhZAt48WUAAACsAAAANmhoZWEMAgQCAAAA5AAAACRobXR4BAAAAAAAAYgAAAAIbG9jYQAMAAAAAAGwAAAABm1heHAABAAFAAABCAAAACBuYW1l8usW2gAAAdAAAABLcG9zdAABAAEAAAIcAAAAIAABAAAAAQAAsJRxEF8PPPUEBwgAAAAAAM+a/G4AAAAA1MOn8gAAAAAEAAgAAAAAEAACAAAAAAAAAAEAAAgA//8AAAQAAAAAAAQAAAEAAAAAAAAAAAAAAAAAAAACAAEAAAACAAQAAQAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAwAAAZAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAR09PRwBAAAAAAAAB//8AAAABAAGAAAAAAAAAAAAAAAAAAAABAAAAAAAABAAAAAAAAAIAAQAAAAAAFAADAAAAAAAUAAYACgAAAAAAAAAAAAAAAAAMAAAAAQAAAAAEAAgAAAMAADEhESEEAPwACAAAAAADACoAAAADAAAABQAWAAAAAQAAAAAABQALABYAAwABBAkABQAWAAAAVgBlAHIAcwBpAG8AbgAgADEALgAwVmVyc2lvbiAxLjAAAAEAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAA=';
function glyphlessFont(doc) {
  if (doc.__ocrFont) return doc.__ocrFont;
  const ctx = doc.context;
  const N = PDFLib.PDFName.of, num = (n) => PDFLib.PDFNumber.of(n);
  const ttf = b64ToBytes(GLYPHLESS_TTF);
  const fontFile = ctx.flateStream(ttf, { Length1: ttf.length });
  const gidMap = new Uint8Array(65536 * 2);
  for (let i = 0; i < 65536; i++) gidMap[i * 2 + 1] = 1; // Every CID → GID 1
  const cidToGid = ctx.flateStream(gidMap);
  // ToUnicode: CIDs map one-to-one to Unicode (a range can't cross its first byte; at most 100 ranges per block)
  let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
  for (let blk = 0; blk < 256; blk += 100) {
    const n = Math.min(100, 256 - blk);
    cmap += `${n} beginbfrange\n`;
    for (let k = blk; k < blk + n; k++) { const hh = k.toString(16).padStart(2, '0').toUpperCase(); cmap += `<${hh}00> <${hh}FF> <${hh}00>\n`; }
    cmap += 'endbfrange\n';
  }
  cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
  const toUnicode = ctx.flateStream(new TextEncoder().encode(cmap));
  const descriptor = ctx.obj({ Type: 'FontDescriptor', FontName: 'GlyphLessFont', Flags: 5, FontBBox: [0, 0, 500, 1000], ItalicAngle: 0, Ascent: 1000, Descent: 0, CapHeight: 1000, StemV: 80, FontFile2: ctx.register(fontFile) });
  const cidFont = ctx.obj({
    Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'GlyphLessFont',
    CIDSystemInfo: ctx.obj({ Registry: PDFLib.PDFString.of('Adobe'), Ordering: PDFLib.PDFString.of('Identity'), Supplement: 0 }),
    FontDescriptor: ctx.register(descriptor), DW: 500, CIDToGIDMap: ctx.register(cidToGid),
  });
  const font = ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'GlyphLessFont', Encoding: 'Identity-H', DescendantFonts: [ctx.register(cidFont)], ToUnicode: ctx.register(toUnicode) });
  doc.__ocrFont = ctx.register(font);
  void N; void num;
  return doc.__ocrFont;
}
function utf16Hex(s) {
  let out = '';
  for (const ch of s) { const c = ch.codePointAt(0); if (c > 0xffff) continue; out += c.toString(16).padStart(4, '0'); }
  return out;
}
// Add an invisible text layer to a pdf-lib page (coordinates from ocrPage)
function addInvisibleText(doc, page, r) {
  const L = PDFLib;
  const fontName = page.node.newFontDictionary('OCRText', glyphlessFont(doc));
  const g = pageGeom(page);
  const a = g.R * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const ops = [L.pushGraphicsState(), L.beginText(), L.setTextRenderingMode(L.TextRenderingMode.Invisible)];
  let n = 0;
  for (const w of r.words) {
    const hex = utf16Hex(w.text + (w.space ? ' ' : ''));
    if (!hex) continue;
    const chars = hex.length / 4;
    const fs = w.size;
    const nx = w.space ? r.words[r.words.indexOf(w) + 1] : null;
    const width = (nx ? nx.x : w.end) - w.x; // The added space extends to where the next word starts
    const tz = Math.max(1, Math.min(1000, 100 * width / (chars * 0.5 * fs)));
    const [ux, uy] = toUser(g, w.x, g.VH - w.base);
    ops.push(L.setFontAndSize(fontName, fs), L.setCharacterSqueeze(tz),
      L.setTextMatrix(c, sn, -sn, c, ux, uy), L.showText(L.PDFHexString.of(hex)));
    n++;
  }
  ops.push(L.endText(), L.popGraphicsState());
  if (n) page.pushOperators(...ops);
  return n;
}

// ================= Tool: OCR searchable PDF =================
registerTool({
  id: 'ocr', group: T('优化'), name: T('OCR 文字识别'), desc: T('识别扫描件和照片里的文字，生成可以搜索、选中和复制文字的 PDF。页面外观保持不变。支持韩文、英文和简体中文。'),
  render(view) {
    const fp = filePicker({ multiple: true, sortable: false });
    const langs = ocrOption({ auto: false });
    const scope = optSelect(T('识别哪些页面'), [['auto', T('只识别没有文字的页面（推荐）')], ['all', T('所有页面')]], 'auto');
    const range = optText(T('页码范围（留空=全部）'), '', { placeholder: T('例如：1-3, 5') });
    const dpi = optSelect(T('识别精度'), [['auto', T('自动（按扫描分辨率，推荐）')], ['200', T('快速（200 DPI）')], ['300', T('标准（300 DPI）')], ['400', T('精细（400 DPI，适合小字）')]], 'auto');
    const txt = optCheck(T('同时导出识别出的文字（.txt）'), false);
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!fp.files.length) return toast(T('请先选择 PDF'));
      const { langs: ls } = langs.value;
      if (!ls.length) return toast(T('请至少选择一种识别语言'));
      const outputs = [], notes = [];
      let total = 0, skipped = 0, words = 0;
      for (const f of fp.files) {
        const bytes = await readBytes(f);
        const js = await openJs(bytes);
        const doc = await loadLib(bytes);
        const set = rangeIndices(range.value, js.numPages);
        const pages = doc.getPages();
        const texts = [];
        let done = 0;
        for (let i = 0; i < js.numPages; i++) {
          if (!set.has(i)) { texts.push(''); continue; }
          const page = await js.getPage(i + 1);
          const [tc, has] = await pageHasText(page);
          if (scope.value === 'auto' && has) {
            skipped++;
            texts.push(tc.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join(''));
            continue;
          }
          const label = fp.files.length > 1 ? ` ${f.name} ${i + 1}/${js.numPages}` : ` ${i + 1}/${js.numPages}`;
          const r = await ocrPage(page, ls, { dpi: dpi.value === 'auto' ? 'auto' : +dpi.value, label });
          words += addInvisibleText(doc, pages[i], r);
          texts.push(r.text.trim());
          page.cleanup();
          done++;
        }
        await js.loadingTask.destroy();
        total += done;
        busy(true, T('正在保存…'));
        outputs.push({ name: baseName(f.name) + T('_OCR.pdf'), data: done ? await doc.save() : bytes });
        if (txt.value) outputs.push({ name: baseName(f.name) + T('_OCR.txt'), data: new TextEncoder().encode(texts.map((t, i) => t ? `--- ${T('第 {0} 页', i + 1)} ---\n${t}` : '').filter(Boolean).join('\n\n') + '\n') });
        if (!done) notes.push(T('{0}：所有页面本来就有文字，没有需要识别的页面', f.name));
      }
      await deliver(res, outputs, T('OCR.zip'), T('，识别了 {0} 页', total));
      if (skipped) res.append(h('div', { class: 'note', style: { marginTop: '6px' } }, T('有 {0} 页本来就有文字，已跳过。', skipped)));
      notes.forEach(t => res.append(h('div', { class: 'warn' }, t)));
      if (total && !words) res.append(h('div', { class: 'warn' }, T('没有识别出文字。请确认选对了语言，或提高识别精度。')));
    }) }, T('开始识别'));
    view.append(...toolHeader(this), card(fp.el),
      card(optsGrid(langs, scope, range, dpi, txt),
        h('div', { class: 'note', style: { marginTop: '10px' } }, T('识别在你的电脑上进行，每页通常需要几秒到十几秒。识别结果是一层看不见的文字，放在原页面上面，所以外观不变。')),
        h('div', { class: 'actions' }, run), res));
  },
});

if (new URLSearchParams(location.search).has('test')) Object.assign(window.__pdftool ||= {}, { ocrPage, ocrTextContent, getTess, openJs });
