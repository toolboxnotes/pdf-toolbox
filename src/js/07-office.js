// ================= PDF to Word / PowerPoint / Excel =================
// Word: docx library; PowerPoint: PptxGenJS; Excel: xlsx written directly with JSZip

// Text runs (visual coordinates: origin at top-left, in pt, y is the baseline)
// Within a line, text separated by more than gapFactor × font size becomes separate runs (for table columns and PPT text boxes)
async function pageSegments(page, vp, { gapFactor = 1.0 } = {}) {
  const tc = await pageTextContent(page); // With auto OCR on, scanned pages are recognized first
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const tr = it.transform;
    const size = Math.hypot(tr[2], tr[3]) || it.height || 10;
    const len = Math.hypot(tr[0], tr[1]) || 1;
    const [x0, y0] = vp.convertToViewportPoint(tr[4], tr[5]);
    const [x1] = vp.convertToViewportPoint(tr[4] + it.width * tr[0] / len, tr[5] + it.width * tr[1] / len);
    items.push({ s: it.str, x: Math.min(x0, x1), end: Math.max(x0, x1), y: y0, size, fontName: it.fontName });
  }
  items.sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.size, b.size) * 0.5 ? a.y - b.y : a.x - b.x));
  const lines = [];
  for (const it of items) {
    const L = lines[lines.length - 1];
    if (L && Math.abs(L.y - it.y) < Math.min(L.size, it.size) * 0.5) { L.items.push(it); L.size = Math.max(L.size, it.size); }
    else lines.push({ y: it.y, size: it.size, items: [it] });
  }
  const cjk = /[　-鿿＀-￯가-힯]/;
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
    L.segs = [];
    for (const it of L.items) {
      const S = L.segs[L.segs.length - 1];
      const gap = S ? it.x - S.end : Infinity;
      if (S && gap < Math.max(S.size, it.size) * gapFactor) {
        const needSpace = gap > it.size * 0.2 && !/\s$/.test(S.text) && !/^\s/.test(it.s) && !(cjk.test(S.text.slice(-1)) && cjk.test(it.s[0]));
        S.text += (needSpace ? ' ' : '') + it.s;
        S.fonts[it.fontName] = (S.fonts[it.fontName] || 0) + it.s.length;
        S.end = Math.max(S.end, it.end);
        S.size = Math.max(S.size, it.size);
      } else {
        L.segs.push({ text: it.s, x: it.x, end: it.end, y: it.y, size: it.size, fontName: it.fontName, fonts: { [it.fontName]: it.s.length } });
      }
    }
    for (const S of L.segs) {
      S.text = cleanXmlText(S.text).replace(/\s+/g, ' ').trim();
      S.fontName = Object.entries(S.fonts).sort((a, b) => b[1] - a[1])[0][0]; // The font with the most characters
    }
    L.segs = L.segs.filter(S => S.text);
  }
  return { lines: lines.filter(L => L.segs.length), styles: tc.styles, ocr: !!tc.ocr };
}

// Office files are XML: remove characters XML doesn't allow (control characters, U+FFFE/FFFF, lone surrogates)
const cleanXmlText = (t) => t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
const hasHangul = (s) => /[가-힯]/.test(s);
const hasHan = (s) => /[一-鿿]/.test(s);
function eastAsiaFont(text) {
  if (hasHangul(text)) return 'Malgun Gothic';
  if (hasHan(text)) return 'Microsoft YaHei';
  return undefined;
}
async function pageJpeg(page, dpi = 150, quality = 0.85) {
  const c = await renderPage(page, dpi / 72);
  const data = await canvasBytes(c, 'image/jpeg', quality);
  c.width = c.height = 0;
  return data;
}
const bytesToB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// ---------- PDF → Word ----------
// Split a page's lines into "body" and "table" blocks: 2+ consecutive lines that each have several short runs count as a table
function splitBlocks(lines) {
  const blocks = [];
  const isRow = (L) => L.segs.length >= 2 && L.segs.reduce((n, S) => n + S.text.length, 0) / L.segs.length < 40;
  for (let i = 0; i < lines.length;) {
    let j = i;
    while (j < lines.length && isRow(lines[j])) j++;
    if (j - i >= 2) { blocks.push({ table: lines.slice(i, j) }); i = j; continue; }
    const last = blocks[blocks.length - 1];
    if (last && last.text) last.text.push(lines[i]); else blocks.push({ text: [lines[i]] });
    i++;
  }
  return blocks;
}
// Convert to the format linesToMarkdown expects (y up)
const blockRect = (lines) => {
  const segs = lines.flatMap(L => L.segs);
  const x = Math.min(...segs.map(S => S.x)), y = lines[0].y - lines[0].size;
  return { x, y, w: Math.max(...segs.map(S => S.end)) - x, h: lines[lines.length - 1].y + lines[lines.length - 1].size * 0.3 - y };
};
const mdLine = (L) => ({ text: L.segs.map(S => S.text).join('  '), y: -L.y, x: L.segs[0].x, end: L.segs[L.segs.length - 1].end, size: L.size });

async function pdfToDocx(bytes, { mode = 'text', images = true, label = '' } = {}) {
  const keepImages = mode === 'text' && images;
  let figureCount = 0;
  const D = window.docx;
  const js = await openJs(bytes);
  const n = js.numPages;
  const pages = [], sizes = {};
  let allText = '';
  if (mode === 'text') {
    for (let i = 1; i <= n; i++) {
      progress(T('正在提取文字') + label, i, n);
      const page = await js.getPage(i);
      const { lines, ocr } = await pageSegments(page, page.getViewport({ scale: 1 }));
      lines.ocr = ocr;
      for (const L of lines) for (const S of L.segs) { const k = Math.round(S.size); sizes[k] = (sizes[k] || 0) + S.text.length; allText += S.text; }
      pages.push(lines);
    }
  }
  const body = +Object.entries(sizes).sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
  const bodyHalf = Math.round(Math.min(Math.max(body, 8), 16) * 2);
  const first = (await js.getPage(1)).getViewport({ scale: 1 });
  const margin = mode === 'image' ? 18 : Math.min(72, Math.round(Math.min(first.width, first.height) * 0.1));
  const maxW = first.width - margin * 2, maxH = first.height - margin * 2;
  const children = [];
  let imagePages = 0;
  const isNum = (t) => /^[-+(]?[\d,.]+%?\)?$/.test(t.trim());
  for (let i = 0; i < n; i++) {
    const lines = mode === 'text' ? pages[i] : [];
    let brk = i > 0;
    const push = (p) => { children.push(p); brk = false; };
    if (!lines.length) {
      progress(T('正在转换页面') + label, i + 1, n);
      const page = await js.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const k = Math.min(maxW / vp.width, maxH / vp.height, 1);
      if (mode === 'text') imagePages++;
      push(new D.Paragraph({
        pageBreakBefore: brk, spacing: { before: 0, after: 0 }, alignment: D.AlignmentType.CENTER,
        children: [new D.ImageRun({ type: 'jpg', data: await pageJpeg(page), transformation: { width: Math.floor(vp.width * k * 96 / 72), height: Math.floor(vp.height * k * 96 / 72) } })],
      }));
      page.cleanup();
      continue;
    }
    // Images / charts: find regions on the text-free background and crop them from the original render; text inside a figure (chart labels) is not output again
    let figs = [], flow = lines;
    if (keepImages && !lines.ocr) { // OCR pages: the text is part of the image itself, so don't look for figures
      progress(T('正在转换页面') + label, i + 1, n);
      const page = await js.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const full = await renderPage(page, 150 / 72);
      const sc = full._scale;
      const tables = splitBlocks(lines).filter(b => b.table).map(b => blockRect(b.table));
      const { bg, bgPx } = await textlessBackground(page, full, lines);
      const boxes = findFigures(bgPx, sc, vp.width, vp.height, tables);
      // Short text next to a figure (axis numbers, legends) counts as part of the figure
      const tableLines = new Set(splitBlocks(lines).filter(b => b.table).flatMap(b => b.table));
      for (const box of boxes) {
        const o = { ...box }; // Compare only with the original bounds so the region doesn't keep growing
        for (const L of lines) {
        if (tableLines.has(L) || L.segs.reduce((n, S) => n + S.text.length, 0) > 16) continue;
        const near = L.segs.every(S => S.x >= o.x - 32 && S.end <= o.x + o.w + 32 && S.y - S.size >= o.y - 12 && S.y <= o.y + o.h + 12 + S.size);
        if (!near) continue;
        for (const S of L.segs) {
          const x0 = Math.min(box.x, S.x - 1), y0 = Math.min(box.y, S.y - S.size - 1);
          box.w = Math.max(box.x + box.w, S.end + 1) - x0; box.h = Math.max(box.y + box.h, S.y + S.size * 0.3 + 1) - y0;
          box.x = x0; box.y = y0;
        }
        }
      }
      for (const box of boxes) figs.push({ box, img: await cropCanvas(full, box, sc), center: Math.abs(box.x + box.w / 2 - vp.width / 2) < vp.width * 0.08 });
      if (bg !== full) bg.width = bg.height = 0;
      full.width = full.height = 0;
      page.cleanup();
      const inside = (S, f) => S.x >= f.box.x - 2 && S.end <= f.box.x + f.box.w + 2 && S.y - S.size * 0.8 >= f.box.y - 2 && S.y <= f.box.y + f.box.h + 2;
      flow = lines.filter(L => !L.segs.every(S => figs.some(f => inside(S, f))));
      figureCount += figs.length;
    }
    // Output text blocks and images interleaved from top to bottom
    const items = [...flow.map(L => ({ y: L.y - L.size, line: L })), ...figs.map(f => ({ y: f.box.y, fig: f }))].sort((a, b) => a.y - b.y);
    let chunk = [];
    const flush = () => { if (chunk.length) emitLines(chunk); chunk = []; };
    for (const it of items) {
      if (it.line) { chunk.push(it.line); continue; }
      flush();
      const { box, img, center } = it.fig;
      const k = Math.min(maxW / box.w, maxH / box.h, 1);
      push(new D.Paragraph({
        pageBreakBefore: brk, spacing: { before: 60, after: 120 }, alignment: center ? D.AlignmentType.CENTER : D.AlignmentType.LEFT,
        children: [new D.ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(box.w * k * 96 / 72), height: Math.round(box.h * k * 96 / 72) } })],
      }));
    }
    flush();
    function emitLines(lines) {
    for (const blk of splitBlocks(lines)) {
      if (blk.table) {
        const rows = linesToTable(blk.table);
        const ncol = Math.max(...rows.map(r => r.length));
        if (brk) push(new D.Paragraph({ pageBreakBefore: true, spacing: { after: 0 }, children: [] }));
        children.push(new D.Table({
          width: { size: 100, type: D.WidthType.PERCENTAGE },
          rows: rows.filter(r => r.some(c => c)).map(r => new D.TableRow({ children: Array.from({ length: ncol }, (_, c) => new D.TableCell({
            children: [new D.Paragraph({ alignment: isNum(r[c] || '') ? D.AlignmentType.RIGHT : D.AlignmentType.LEFT, spacing: { after: 0 }, children: [new D.TextRun(r[c] || '')] })],
            margins: { top: 40, bottom: 40, left: 80, right: 80 },
          })) })),
        }));
        children.push(new D.Paragraph({ spacing: { after: 120 }, children: [] }));
        continue;
      }
      const md = linesToMarkdown(blk.text.map(mdLine), body, true).trim();
      for (const line of md.split(/\n+/)) {
        const t = line.trim();
        if (!t) continue;
        const hm = t.match(/^(#{1,3}) (.*)$/);
        const opts = { pageBreakBefore: brk, spacing: { after: 120 } };
        if (hm) {
          const lv = hm[1].length;
          push(new D.Paragraph({ ...opts, heading: [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3][lv - 1], spacing: { before: 240, after: 120 },
            children: [new D.TextRun({ text: hm[2], bold: true, color: '000000', size: Math.round(bodyHalf * [1.8, 1.45, 1.2][lv - 1]) })] }));
        } else if (/^[•·▪●◦■\-–] /.test(t)) {
          push(new D.Paragraph({ ...opts, bullet: { level: 0 }, spacing: { after: 60 }, children: [new D.TextRun(t.replace(/^[•·▪●◦■\-–] /, ''))] }));
        } else {
          push(new D.Paragraph({ ...opts, children: [new D.TextRun(t)] }));
        }
      }
    }
    }
  }
  await js.loadingTask.destroy();
  const ea = eastAsiaFont(allText);
  const doc = new D.Document({
    creator: 'PDF Toolbox',
    styles: { default: { document: { run: { size: bodyHalf, font: { ascii: 'Calibri', hAnsi: 'Calibri', cs: 'Calibri', eastAsia: ea || 'Calibri' } } } } },
    sections: [{
      properties: { page: { size: { width: Math.round(first.width * 20), height: Math.round(first.height * 20) }, margin: { top: margin * 20, bottom: margin * 20, left: margin * 20, right: margin * 20, header: 0, footer: 0 } } },
      children: children.length ? children : [new D.Paragraph('')],
    }],
  });
  busy(true, T('正在生成文件…'));
  return { data: await D.Packer.toBlob(doc), imagePages, figureCount };
}

registerTool({
  id: 'pdf2word', group: T('转换'), name: T('PDF 转 Word'), desc: T('把 PDF 转成可编辑的 Word 文档（.docx），自动识别标题、段落、列表和表格。'),
  render(view) {
    const fp = filePicker({ multiple: true, sortable: false });
    const descs = {
      text: T('提取文字，生成可以直接编辑的标题、段落、列表和表格，图片和图表按原来的位置放回。排版会简化；没有文字的页面（扫描件）用 OCR 识别成文字，关闭 OCR 时以整页图片放入。'),
      image: T('每页作为一张图片放进 Word，外观和原文件完全一样，但文字不能编辑。'),
    };
    const desc = h('div', { class: 'note', style: { marginTop: '10px' } }, descs.text);
    const imgs = optCheck(T('保留图片和图表'), true);
    const ocr = ocrOption();
    const mode = seg([['text', T('可编辑文字（推荐）')], ['image', T('保持原样（页面图片）')]], 'text', v => { desc.textContent = descs[v]; imgs.el.hidden = ocr.el.hidden = v !== 'text'; });
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!fp.files.length) return toast(T('请先选择 PDF'));
      const outputs = [];
      let img = 0, ocrTotal = 0;
      for (const f of fp.files) {
        const bytes = await readBytes(f);
        const { result: r, ocrPages } = await withAutoOcr(mode.value === 'text' && ocr.value, () => pdfToDocx(bytes, { mode: mode.value, images: imgs.value, label: fp.files.length > 1 ? ' ' + f.name : '' }));
        img += r.imagePages; ocrTotal += ocrPages;
        outputs.push({ name: baseName(f.name) + '.docx', data: r.data });
      }
      await deliver(res, outputs, T('Word.zip'));
      if (ocrTotal) res.append(h('div', { class: 'note', style: { marginTop: '6px' } }, T('已用 OCR 识别了 {0} 页扫描页。', ocrTotal), ' ', T('识别结果可能有错字，请检查。')));
      if (img) res.append(h('div', { class: 'warn' }, T('有 {0} 页没有可提取的文字，这些页面以图片形式放入。可以开启“扫描页自动识别文字（OCR）”。', img)));
    }) }, T('转换'));
    view.append(...toolHeader(this), card(fp.el), card(mode.el, desc, optsGrid(imgs, ocr), h('div', { class: 'actions' }, run), res));
  },
});

// ---------- PDF → PowerPoint ----------
// Suppress text while rendering to get a "background without text".
// pdf.js draws text either with fillText (system fonts) or fill(glyph path); glyph paths come from the font's getPathGenerator, so record and skip them
async function renderWithoutText(page, scale, fontNames) {
  const glyphs = new WeakSet();
  const restore = [];
  const patch = (obj, m, wrap) => { const o = obj[m]; obj[m] = wrap(o); restore.push(() => { obj[m] = o; }); };
  const protos = new Set();
  for (const n of fontNames) {
    try { const f = page.commonObjs.get(n); if (f && typeof f.getPathGenerator === 'function') protos.add(Object.getPrototypeOf(f)); } catch {}
  }
  for (const pr of protos) patch(pr, 'getPathGenerator', o => function (...a) { const p = o.apply(this, a); if (p && typeof p === 'object') glyphs.add(p); return p; });
  const P = CanvasRenderingContext2D.prototype;
  patch(P, 'fillText', () => function () {});
  patch(P, 'strokeText', () => function () {});
  patch(P, 'fill', o => function (...a) { if (a[0] && typeof a[0] === 'object' && glyphs.has(a[0])) return; return o.apply(this, a); });
  patch(P, 'stroke', o => function (...a) { if (a[0] && typeof a[0] === 'object' && glyphs.has(a[0])) return; return o.apply(this, a); });
  try { return await renderPage(page, scale); }
  finally { restore.reverse().forEach(f => f()); }
}
// Compare the renders with and without text and take the average color of the text pixels
function sampleTextColor(full, bg, S, s) { // full / bg: ImageData
  const x0 = Math.max(0, Math.floor(S.x * s)), x1 = Math.min(full.width, Math.ceil(S.end * s));
  const y0 = Math.max(0, Math.floor((S.y - S.size * 0.9) * s)), y1 = Math.min(full.height, Math.ceil((S.y + S.size * 0.25) * s));
  const w = x1 - x0, hh = y1 - y0;
  if (w <= 0 || hh <= 0) return '000000';
  const a = full.data, b = bg.data, W = full.width;
  let r = 0, g = 0, bl = 0, wt = 0;
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
    const i = (yy * W + xx) * 4;
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d < 90) continue;
    const q = d * d;
    r += a[i] * q; g += a[i + 1] * q; bl += a[i + 2] * q; wt += q;
  }
  if (!wt) return '000000';
  const c = [r, g, bl].map(v => Math.round(v / wt));
  if (Math.max(...c) < 56) return '000000'; // Anti-aliasing makes black text greyish; treat near-black as black
  if (Math.min(...c) > 235) return 'FFFFFF';
  return c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}
// Render with text (full) → background with text removed (same size), plus the pixels of both
async function textlessBackground(page, full, lines) {
  const s = full._scale;
  const fullPx = full.getContext('2d').getImageData(0, 0, full.width, full.height);
  if (!lines.length) return { bg: full, fullPx, bgPx: fullPx };
  const fontNames = [...new Set(lines.flatMap(L => L.segs.map(S => S.fontName)))];
  const bg = await renderWithoutText(page, s, fontNames);
  let bgPx = bg.getContext('2d').getImageData(0, 0, bg.width, bg.height);
  const left = lines.flatMap(L => L.segs).filter(S => !textGone(fullPx, bgPx, S, s));
  if (left.length) {
    const ctx = bg.getContext('2d');
    for (const S of left) coverText(ctx, bgPx, S, s);
    bgPx = ctx.getImageData(0, 0, bg.width, bg.height);
  }
  return { bg, fullPx, bgPx };
}

// Find image / chart regions on the text-free background (returns visual coordinates in pt)
// Mark grid cells that have content → dilate and merge → connected regions; exclude table frames, solid backing boxes and full-page backgrounds
function findFigures(bgPx, s, pageW, pageH, avoid = []) {
  const W = bgPx.width, H = bgPx.height, d = bgPx.data;
  const bucket = (i) => (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
  // Page background color: the most common color in the sample
  const cnt = new Map();
  for (let i = 0; i < d.length; i += 4 * 97) { const k = bucket(i); cnt.set(k, (cnt.get(k) || 0) + 1); }
  const pageBucket = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const br = ((pageBucket >> 8) & 15) * 16 + 8, bgG = ((pageBucket >> 4) & 15) * 16 + 8, bb = (pageBucket & 15) * 16 + 8;
  const cell = Math.max(2, Math.round(4 * s));
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
  const ink = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let hit = false;
    for (let y = gy * cell; y < Math.min(H, gy * cell + cell) && !hit; y += 2) for (let x = gx * cell; x < Math.min(W, gx * cell + cell); x += 2) {
      const i = (y * W + x) * 4;
      if (Math.abs(d[i] - br) + Math.abs(d[i + 1] - bgG) + Math.abs(d[i + 2] - bb) > 60) { hit = true; break; }
    }
    ink[gy * gw + gx] = hit ? 1 : 0;
  }
  // Table areas don't count (table lines would connect to nearby figures)
  for (const a of avoid) {
    for (let gy = Math.max(0, Math.floor((a.y - 8) * s / cell)); gy <= Math.min(gh - 1, Math.ceil((a.y + a.h + 8) * s / cell)); gy++)
      for (let gx = Math.max(0, Math.floor((a.x - 14) * s / cell)); gx <= Math.min(gw - 1, Math.ceil((a.x + a.w + 14) * s / cell)); gx++) ink[gy * gw + gx] = 0;
  }
  const R = 2; // Dilate by 2 cells (about 8 pt) to connect the parts of a chart
  const dil = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) if (ink[gy * gw + gx])
    for (let y = Math.max(0, gy - R); y <= Math.min(gh - 1, gy + R); y++) for (let x = Math.max(0, gx - R); x <= Math.min(gw - 1, gx + R); x++) dil[y * gw + x] = 1;
  const seen = new Uint8Array(gw * gh), out = [];
  for (let start = 0; start < gw * gh; start++) {
    if (!dil[start] || seen[start]) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, inkCells = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop(), cx = c % gw, cy = (c - cx) / gw;
      if (ink[c]) { inkCells++; x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy); }
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const ni = ny * gw + nx;
        if (dil[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
      }
    }
    if (x1 < 0) continue;
    const box = { x: x0 * cell / s, y: y0 * cell / s, w: (x1 - x0 + 1) * cell / s, h: (y1 - y0 + 1) * cell / s };
    if (box.w < 24 || box.h < 24) continue;                       // Lines, small icons
    if (box.w * box.h > pageW * pageH * 0.8) continue;            // Full-page background
    if (inkCells / ((x1 - x0 + 1) * (y1 - y0 + 1)) < 0.04) continue; // A box made only of thin lines
    const overlap = avoid.some(a => {
      const ix = Math.max(0, Math.min(a.x + a.w, box.x + box.w) - Math.max(a.x, box.x));
      const iy = Math.max(0, Math.min(a.y + a.h, box.y + box.h) - Math.max(a.y, box.y));
      return ix * iy > box.w * box.h * 0.5;
    });
    if (overlap) continue;                                         // Table
    // Solid backing box (a colored block behind text): one non-background color covers more than 90%
    const bc = new Map();
    let tot = 0;
    for (let y = Math.floor(box.y * s); y < Math.min(H, (box.y + box.h) * s); y += 3) for (let x = Math.floor(box.x * s); x < Math.min(W, (box.x + box.w) * s); x += 3) {
      const k = bucket((y * W + x) * 4);
      bc.set(k, (bc.get(k) || 0) + 1); tot++;
    }
    bc.delete(pageBucket);
    const rest = [...bc.values()].reduce((a, b) => a + b, 0);
    if (rest && Math.max(...bc.values()) / rest > 0.9) continue;
    out.push(box);
  }
  return out.sort((a, b) => a.y - b.y);
}
async function cropCanvas(src, box, s) {
  const x = Math.max(0, Math.floor(box.x * s)), y = Math.max(0, Math.floor(box.y * s));
  const w = Math.min(src.width - x, Math.ceil(box.w * s)), hh = Math.min(src.height - y, Math.ceil(box.h * s));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, hh);
  c.getContext('2d').drawImage(src, x, y, w, hh, 0, 0, w, hh);
  const png = w * hh < 400000;
  const data = await canvasBytes(c, png ? 'image/png' : 'image/jpeg', 0.9);
  c.width = c.height = 0;
  return { data, type: png ? 'png' : 'jpg' };
}

// Pixel bounds of the text box (canvas coordinates)
function segBox(S, s, W, H, pad = 0) {
  return {
    x0: Math.max(0, Math.floor(S.x * s) - pad), x1: Math.min(W, Math.ceil(S.end * s) + pad),
    y0: Math.max(0, Math.floor((S.y - S.size * 1.0) * s) - pad), y1: Math.min(H, Math.ceil((S.y + S.size * 0.3) * s) + pad),
  };
}
// Whether this text was already removed from the background (Type3 and similar fonts can't be suppressed while rendering)
function textGone(full, bg, S, s) {
  const { x0, x1, y0, y1 } = segBox(S, s, full.width, full.height);
  let n = 0, d = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * full.width + x) * 4;
    n++;
    if (Math.abs(full.data[i] - bg.data[i]) + Math.abs(full.data[i + 1] - bg.data[i + 1]) + Math.abs(full.data[i + 2] - bg.data[i + 2]) > 90) d++;
  }
  return !n || d / n > 0.01;
}
// Cover the text with the most common color around the text box
function coverText(ctx, px, S, s) {
  const { x0, x1, y0, y1 } = segBox(S, s, px.width, px.height, 2);
  if (x1 <= x0 || y1 <= y0) return;
  const counts = new Map();
  const add = (x, y) => {
    if (x < 0 || y < 0 || x >= px.width || y >= px.height) return;
    const i = (y * px.width + x) * 4, r = px.data[i], g = px.data[i + 1], b = px.data[i + 2];
    const k = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    const c = counts.get(k) || [0, 0, 0, 0];
    c[0]++; c[1] += r; c[2] += g; c[3] += b;
    counts.set(k, c);
  };
  for (let x = x0 - 1; x <= x1; x++) { add(x, y0 - 1); add(x, y1); }
  for (let y = y0; y < y1; y++) { add(x0 - 1, y); add(x1, y); }
  let best = null;
  for (const c of counts.values()) if (!best || c[0] > best[0]) best = c;
  if (!best) return;
  ctx.fillStyle = `rgb(${Math.round(best[1] / best[0])},${Math.round(best[2] / best[0])},${Math.round(best[3] / best[0])})`;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}
function fontStyle(page, fontName, styles) {
  let name = '', bold = false, italic = false;
  try {
    const f = page.commonObjs.get(fontName);
    name = f.name || '';
    bold = !!(f.bold || f.black);
    italic = !!f.italic;
  } catch {}
  bold = bold || /bold|black|heavy|semibold|demi/i.test(name);
  italic = italic || /italic|oblique/i.test(name);
  const fam = styles?.[fontName]?.fontFamily || '';
  const face = /mono|courier/i.test(fam + name) ? 'Courier New' : /serif/i.test(fam) && !/sans/i.test(fam) || /times|georgia|garamond|minion|serif/i.test(name) && !/sans/i.test(name) ? 'Times New Roman' : 'Arial';
  return { bold, italic, face };
}
async function pdfToPptx(bytes, { editable = true, label = '' } = {}) {
  const js = await openJs(bytes);
  const n = js.numPages;
  const p1 = (await js.getPage(1)).getViewport({ scale: 1 });
  const SW = p1.width, SH = p1.height; // Slide size (pt), taken from the first page
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'PDF', width: SW / 72, height: SH / 72 });
  pptx.layout = 'PDF';
  pptx.author = 'PDF Toolbox';
  let empty = 0;
  const IN = (v) => v / 72;
  for (let i = 1; i <= n; i++) {
    progress(T('正在转换页面') + label, i, n);
    const page = await js.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const k = Math.min(SW / vp.width, SH / vp.height);
    const ox = (SW - vp.width * k) / 2, oy = (SH - vp.height * k) / 2;
    const slide = pptx.addSlide();
    const full = await renderPage(page, 150 / 72);
    const s = full._scale;
    const place = { x: IN(ox), y: IN(oy), w: IN(vp.width * k), h: IN(vp.height * k) };
    if (!editable) {
      slide.addImage({ data: 'data:image/jpeg;base64,' + bytesToB64(await canvasBytes(full, 'image/jpeg', 0.88)), ...place });
    } else {
      const { lines, styles } = await pageSegments(page, vp);
      if (!lines.length) empty++;
      const { bg, fullPx, bgPx } = await textlessBackground(page, full, lines);
      slide.addImage({ data: 'data:image/jpeg;base64,' + bytesToB64(await canvasBytes(bg, 'image/jpeg', 0.88)), ...place });
      for (const L of lines) for (const S of L.segs) {
        const st = fontStyle(page, S.fontName, styles);
        const size = Math.max(1, Math.round(S.size * k * 2) / 2);
        slide.addText(S.text, {
          x: IN(ox + S.x * k), y: IN(oy + (S.y - S.size * 0.95) * k),
          w: IN((S.end - S.x) * k + S.size * k * 0.8), h: IN(S.size * 1.3 * k),
          fontSize: size, fontFace: st.face, bold: st.bold, italic: st.italic, color: sampleTextColor(fullPx, bgPx, S, s),
          margin: 0, valign: 'top', wrap: false, fit: 'none', lang: hasHangul(S.text) ? 'ko-KR' : hasHan(S.text) ? 'zh-CN' : undefined,
        });
      }
      if (bg !== full) bg.width = bg.height = 0;
    }
    full.width = full.height = 0;
    page.cleanup();
  }
  await js.loadingTask.destroy();
  busy(true, T('正在生成文件…'));
  return { data: await pptx.write({ outputType: 'uint8array' }), empty };
}

registerTool({
  id: 'pdf2ppt', group: T('转换'), name: T('PDF 转 PPT'), desc: T('把每一页变成一张幻灯片（.pptx），文字可以直接在 PowerPoint 里修改。'),
  render(view) {
    const fp = filePicker({ multiple: true, sortable: false });
    const descs = {
      text: T('页面背景（图形、照片）保留为图片，文字变成可编辑的文本框，尽量保持原来的位置、大小和颜色。'),
      image: T('每页作为一张图片放进幻灯片，外观完全一样，但文字不能编辑。'),
    };
    const desc = h('div', { class: 'note', style: { marginTop: '10px' } }, descs.text);
    const mode = seg([['text', T('可编辑文字（推荐）')], ['image', T('保持原样（页面图片）')]], 'text', v => desc.textContent = descs[v]);
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!fp.files.length) return toast(T('请先选择 PDF'));
      const outputs = [];
      let empty = 0;
      for (const f of fp.files) {
        const r = await pdfToPptx(await readBytes(f), { editable: mode.value === 'text', label: fp.files.length > 1 ? ' ' + f.name : '' });
        empty += r.empty;
        outputs.push({ name: baseName(f.name) + '.pptx', data: r.data });
      }
      await deliver(res, outputs, T('PowerPoint.zip'));
      if (empty) res.append(h('div', { class: 'warn' }, T('有 {0} 页没有可提取的文字（可能是扫描件），这些页面只有图片。文字识别（OCR）将在之后的版本支持。', empty)));
    }) }, T('转换'));
    view.append(...toolHeader(this), card(fp.el), card(mode.el, desc, h('div', { class: 'actions' }, run), res));
  },
});

// ---------- PDF → Excel ----------
// Find vertical gaps from text positions to use as column separators; each line of text becomes a table row
// Only multi-run lines (table rows) define columns; a single-run line goes into the column it falls in, otherwise the first column
function linesToTable(lines) {
  const segs = lines.flatMap(L => L.segs);
  if (!segs.length) return [];
  const minX = Math.min(...segs.map(S => S.x)), maxX = Math.max(...segs.map(S => S.end));
  const cover = new Uint16Array(Math.ceil(maxX - minX) + 2);
  for (const L of lines) {
    if (L.segs.length < 2) continue;
    for (const S of L.segs) for (let x = Math.floor(S.x - minX); x <= Math.ceil(S.end - minX); x++) cover[x]++;
  }
  const bounds = [];
  let first = cover.findIndex(v => v > 0), last = cover.length - 1;
  while (last >= 0 && !cover[last]) last--;
  for (let x = first; first >= 0 && x <= last;) {
    if (cover[x]) { x++; continue; }
    let e = x;
    while (e <= last && !cover[e]) e++;
    bounds.push(minX + (x + e) / 2);
    x = e;
  }
  const colAt = (v) => { let i = 0; while (i < bounds.length && bounds[i] < v) i++; return i; };
  const rows = [];
  let prevY = null, prevSize = 0;
  for (const L of lines) {
    // Leave an empty row where the line gap is unusually large, to keep paragraphs / tables apart
    if (prevY != null && L.y - prevY > Math.max(prevSize, L.size) * 2.4) rows.push([]);
    const row = [];
    if (L.segs.length === 1) {
      const S = L.segs[0];
      const a = colAt(S.x + 0.5), b = colAt(S.end - 0.5);
      row[a === b ? a : 0] = S.text;
    } else {
      for (const S of L.segs) { const c = colAt((S.x + S.end) / 2); row[c] = row[c] ? row[c] + ' ' + S.text : S.text; }
    }
    rows.push(row);
    prevY = L.y; prevSize = L.size;
  }
  // Drop columns that are completely empty
  const ncol = Math.max(0, ...rows.map(r => r.length));
  const keep = [];
  for (let c = 0; c < ncol; c++) if (rows.some(r => r[c] != null && r[c] !== '')) keep.push(c);
  return rows.map(r => keep.map(c => r[c] ?? ''));
}
function cellValue(s) {
  const t = String(s).trim();
  if (/^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(t) && !/^0\d/.test(t)) return { n: parseFloat(t.replace(/,/g, '')) };
  if (/^\(\d{1,3}(,\d{3})*(\.\d+)?\)$/.test(t)) return { n: -parseFloat(t.replace(/[(),]/g, '')) };
  const pm = t.match(/^([-+]?\d+(?:\.(\d+))?)\s?%$/);
  if (pm) return { n: parseFloat(pm[1]) / 100, style: pm[2] ? 2 : 1 }; // Percent: 0% / 0.00%
  return { s: t };
}
const xmlEsc = (s) => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const textWidth = (s) => [...String(s)].reduce((w, c) => w + (/[　-鿿＀-￯가-힯]/.test(c) ? 2 : 1), 0);
async function buildXlsx(sheets) {
  const zip = new JSZip();
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'http://schemas.openxmlformats.org';
  zip.file('[Content_Types].xml', X + `<Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', X + `<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', X + `<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', X + `<Relationships xmlns="${NS}/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', X + `<styleSheet xmlns="${NS}/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((sh, si) => {
    const ncol = Math.max(1, ...sh.rows.map(r => r.length));
    const widths = Array.from({ length: ncol }, (_, c) => Math.min(60, Math.max(8, ...sh.rows.map(r => textWidth(r[c] ?? '') + 2))));
    const rowsXml = sh.rows.map((r, ri) => {
      const cells = r.map((v, ci) => {
        if (v == null || v === '') return '';
        const ref = colName(ci) + (ri + 1);
        const cv = cellValue(v);
        return cv.n != null && isFinite(cv.n) ? `<c r="${ref}"${cv.style ? ` s="${cv.style}"` : ''}><v>${cv.n}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cv.s)}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    zip.file(`xl/worksheets/sheet${si + 1}.xml`, X + `<worksheet xmlns="${NS}/spreadsheetml/2006/main"><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rowsXml}</sheetData></worksheet>`);
  });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
async function pdfToXlsx(bytes, { perPage = true, range = '', label = '' } = {}) {
  const js = await openJs(bytes);
  const n = js.numPages;
  const only = range.trim() ? rangeIndices(range, n) : null;
  const sheets = [];
  let empty = 0;
  for (let i = 0; i < n; i++) {
    if (only && !only.has(i)) continue;
    progress(T('正在识别表格') + label, i + 1, n);
    const page = await js.getPage(i + 1);
    const { lines } = await pageSegments(page, page.getViewport({ scale: 1 }), { gapFactor: 0.9 });
    const rows = linesToTable(lines);
    if (!rows.length) empty++;
    if (perPage) sheets.push({ name: T('第 {0} 页', i + 1).slice(0, 31), rows });
    else {
      if (!sheets.length) sheets.push({ name: 'Sheet1', rows: [] });
      const all = sheets[0].rows;
      if (all.length && rows.length) all.push([]);
      all.push(...rows);
    }
    page.cleanup();
  }
  await js.loadingTask.destroy();
  if (!sheets.length) sheets.push({ name: 'Sheet1', rows: [] });
  busy(true, T('正在生成文件…'));
  return { data: await buildXlsx(sheets), empty };
}

registerTool({
  id: 'pdf2excel', group: T('转换'), name: T('PDF 转 Excel'), desc: T('识别 PDF 里的表格，按行和列放进 Excel（.xlsx），数字自动变成可计算的数值。'),
  render(view) {
    const fp = filePicker({ multiple: true, sortable: false });
    const layout = optSelect(T('工作表'), [['page', T('每页一个工作表')], ['one', T('全部放在一个工作表')]], 'page');
    const range = optText(T('页码范围（留空=全部）'), '', { placeholder: T('例如：1-3, 5') });
    const ocr = ocrOption();
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!fp.files.length) return toast(T('请先选择 PDF'));
      const outputs = [];
      let empty = 0, ocrTotal = 0;
      for (const f of fp.files) {
        const bytes = await readBytes(f);
        const { result: r, ocrPages } = await withAutoOcr(ocr.value, () => pdfToXlsx(bytes, { perPage: layout.value === 'page', range: range.value, label: fp.files.length > 1 ? ' ' + f.name : '' }));
        empty += r.empty; ocrTotal += ocrPages;
        outputs.push({ name: baseName(f.name) + '.xlsx', data: r.data });
      }
      await deliver(res, outputs, T('Excel.zip'));
      if (ocrTotal) res.append(h('div', { class: 'note', style: { marginTop: '6px' } }, T('已用 OCR 识别了 {0} 页扫描页。', ocrTotal), ' ', T('识别结果可能有错字，请检查。')));
      if (empty) res.append(h('div', { class: 'warn' }, T('有 {0} 页没有识别出表格内容，这些工作表是空的。', empty)));
    }) }, T('转换'));
    view.append(...toolHeader(this), card(fp.el),
      card(optsGrid(layout, range, ocr), h('div', { class: 'note', style: { marginTop: '10px' } }, T('适合有文字的电子表格类 PDF（报表、账单、价目表）。列按文字之间的空白自动划分，合并单元格和表格线不会保留。')), h('div', { class: 'actions' }, run), res));
  },
});

// For testing (?test)
if (new URLSearchParams(location.search).has('test')) window.__pdftool = { openJs, pageSegments, linesToTable, renderPage, renderWithoutText, textlessBackground, findFigures };
