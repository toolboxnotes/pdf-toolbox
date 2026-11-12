// ================= Compress =================
registerTool({
  id: 'compress', group: T('优化'), name: T('压缩 PDF'), desc: T('减小文件体积。适合扫描件和图片多的 PDF。'),
  render(view) {
    const fp = filePicker({ multiple: true, sortable: false });
    const LV = {
      lossless: { t: T('无损优化'), d: T('重新整理文件结构，不影响画质，文字可选。压缩幅度通常较小。') },
      low: { t: T('轻度'), dpi: 150, q: 0.8, d: T('150 DPI，画质好。页面会转为图片，文字不能再选中。') },
      mid: { t: T('推荐'), dpi: 110, q: 0.65, d: T('110 DPI，屏幕阅读足够清晰。页面会转为图片，文字不能再选中。') },
      high: { t: T('强力'), dpi: 80, q: 0.5, d: T('80 DPI，体积最小，细小文字可能变模糊。页面会转为图片。') },
    };
    const desc = h('div', { class: 'note', style: { marginTop: '10px' } }, LV.mid.d);
    const lv = seg(Object.entries(LV).map(([k, v]) => [k, v.t]), 'mid', k => desc.textContent = LV[k].d);
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!fp.files.length) return toast(T('请先选择 PDF'));
      const L = LV[lv.value];
      const outputs = [], lines = [];
      let before = 0, after = 0;
      for (const f of fp.files) {
        const bytes = await readBytes(f);
        let data;
        if (lv.value === 'lossless') {
          busy(true, T('正在优化 ') + f.name);
          data = await (await loadLib(bytes)).save({ useObjectStreams: true });
        } else {
          data = await rasterizePdf(bytes, { dpi: L.dpi, quality: L.q, format: 'jpg', label: T('正在压缩 ') + f.name });
        }
        const kept = data.length >= bytes.length;
        if (kept) data = bytes;
        before += bytes.length; after += data.length;
        lines.push(T("{0}：{1} → {2}{3}", f.name, fmtSize(bytes.length), fmtSize(data.length), kept ? T('（已经很小，保留原文件）') : ''));
        outputs.push({ name: baseName(f.name) + T('_压缩.pdf'), data });
      }
      const pct = before ? Math.round((1 - after / before) * 100) : 0;
      await deliver(res, outputs, T('压缩.zip'), T("，体积减少 {0}%", Math.max(0, pct)));
      res.append(h('div', { class: 'note', style: { marginTop: '6px' } }, lines.map(l => h('div', {}, l))));
    }) }, T('压缩'));
    view.append(...toolHeader(this), card(fp.el), card(lv.el, desc, h('div', { class: 'actions' }, run), res));
  },
});

// ================= Flatten to image PDF =================
registerTool({
  id: 'flatten', group: T('转换'), name: T('图片化 PDF'), desc: T('把每一页都变成图片，再重新合成 PDF。内容无法再被复制、搜索或编辑，打印和显示效果保持一致。'),
  render(view) {
    const fp = filePicker({ multiple: true, sortable: false });
    const dpi = optSelect(T('清晰度'), [['100', T('100 DPI（体积小）')], ['150', T('150 DPI（屏幕阅读）')], ['200', T('200 DPI（推荐）')], ['300', T('300 DPI（打印）')]], '200');
    const fmt = optSelect(T('图片格式'), [['jpg', T('JPG（体积小）')], ['png', T('PNG（无损，体积大）')]], 'jpg');
    const q = optRange(T('JPG 质量'), 85, { min: 40, max: 100, unit: '%' });
    const range = optText(T('只处理这些页面（留空=全部）'), '', { placeholder: T('例如：1-3'), hint: T('其他页面保持原样') });
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!fp.files.length) return toast(T('请先选择 PDF'));
      const outputs = [];
      for (const f of fp.files) {
        const bytes = await readBytes(f);
        const n = (await loadLib(bytes)).getPageCount();
        const only = range.value.trim() ? rangeIndices(range.value, n) : null;
        const data = await rasterizePdf(bytes, { dpi: +dpi.value, format: fmt.value, quality: q.value / 100, only, label: T('正在图片化 ') + f.name });
        outputs.push({ name: baseName(f.name) + T('_图片化.pdf'), data });
      }
      await deliver(res, outputs, T('图片化.zip'));
    }) }, T('开始转换'));
    view.append(...toolHeader(this), card(fp.el), card(optsGrid(dpi, fmt, q, range), h('div', { class: 'actions' }, run), res));
  },
});

// ================= PDF to images =================
registerTool({
  id: 'pdf2img', group: T('转换'), name: T('PDF 转图片'), desc: T('把每一页导出成 JPG 或 PNG 图片，多页时打包成 ZIP。'),
  render(view) {
    const fp = filePicker();
    const fmt = optSelect(T('格式'), [['jpg', 'JPG'], ['png', 'PNG']], 'jpg');
    const dpi = optSelect(T('清晰度'), [['72', T('72 DPI（小图）')], ['150', T('150 DPI（推荐）')], ['300', T('300 DPI（高清）')]], '150');
    const range = optText(T('页码范围（留空=全部）'), '', { placeholder: T('例如：1-3, 5') });
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      const f = fp.files[0];
      if (!f) return toast(T('请先选择 PDF'));
      const js = await openJs(await readBytes(f));
      const set = rangeIndices(range.value, js.numPages);
      const outputs = [], b = baseName(f.name), idx = [...set].sort((a, z) => a - z);
      const pad = String(js.numPages).length;
      for (let k = 0; k < idx.length; k++) {
        progress(T('正在导出'), k + 1, idx.length);
        const page = await js.getPage(idx[k] + 1);
        const c = await renderPage(page, +dpi.value / 72);
        const type = fmt.value === 'png' ? 'image/png' : 'image/jpeg';
        outputs.push({ name: `${b}_${String(idx[k] + 1).padStart(pad, '0')}.${fmt.value}`, data: await canvasBytes(c, type, 0.9) });
        c.width = c.height = 0;
      }
      await js.loadingTask.destroy();
      await deliver(res, outputs, T("{0}_图片.zip", b));
    }) }, T('导出图片'));
    view.append(...toolHeader(this), card(fp.el), card(optsGrid(fmt, dpi, range), h('div', { class: 'actions' }, run), res));
  },
});

// ================= Images to PDF =================
const PAPER = { a4: [595.28, 841.89], letter: [612, 792], a3: [841.89, 1190.55] };
registerTool({
  id: 'img2pdf', group: T('转换'), name: T('图片转 PDF'), desc: T('把多张图片按顺序合成一个 PDF，每张图片一页。'),
  render(view) {
    const fp = filePicker({ multiple: true, sortByName: true, accept: 'image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp', label: T('点击选择或拖入图片（可多选）') });
    const size = optSelect(T('页面大小'), [['fit', T('和图片一样大')], ['a4', 'A4'], ['letter', 'Letter'], ['a3', 'A3']], 'a4');
    const orient = optSelect(T('页面方向'), [['auto', T('自动（跟随图片）')], ['p', T('纵向')], ['l', T('横向')]], 'auto');
    const margin = optSelect(T('页边距'), [['0', T('无')], ['20', T('小')], ['40', T('大')]], '20');
    const name = optText(T('输出文件名'), T('图片.pdf'));
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      const files = fp.files;
      if (!files.length) return toast(T('请先选择图片'));
      const out = await PDFDocument.create();
      const m = +margin.value;
      for (let i = 0; i < files.length; i++) {
        progress(T('正在添加图片'), i + 1, files.length);
        const img = await embedImageFile(out, files[i]);
        const iw = img.width * 0.75, ih = img.height * 0.75; // 96 DPI → pt
        let pw, ph;
        if (size.value === 'fit') { pw = iw + 2 * m; ph = ih + 2 * m; }
        else {
          [pw, ph] = PAPER[size.value];
          const land = orient.value === 'l' || (orient.value === 'auto' && iw > ih);
          if (land) [pw, ph] = [ph, pw];
        }
        const s = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih, size.value === 'fit' ? 1 : Infinity);
        const w = iw * s, hh = ih * s;
        out.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
      }
      await deliver(res, [{ name: ensureExt(name.value, 'pdf'), data: await out.save() }]);
    }) }, T('生成 PDF'));
    view.append(...toolHeader(this), card(fp.el), card(optsGrid(size, orient, margin, name), h('div', { class: 'actions' }, run), res));
  },
});

// ================= PDF to Markdown / text =================
async function extractPageLines(page) {
  const tc = await pageTextContent(page); // With auto OCR on, scanned pages are recognized first
  // Use the direction the page is viewed in (handles pages with /Rotate): x to the right, y up
  const vp = page.getViewport({ scale: 1 });
  const items = tc.items.filter(it => it.str !== undefined && (it.str.trim() || it.hasEOL)).map(it => {
    const [vx, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    return { s: it.str, x: vx, y: vp.height - vy, size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10, w: it.width };
  }).filter(it => it.s.trim());
  items.sort((a, b) => (Math.abs(b.y - a.y) > Math.min(a.size, b.size) * 0.5 ? b.y - a.y : a.x - b.x));
  const lines = [];
  for (const it of items) {
    const L = lines[lines.length - 1];
    if (L && Math.abs(L.y - it.y) < Math.min(L.size, it.size) * 0.5) {
      const gap = it.x - L.end;
      const needSpace = gap > it.size * 0.2 && !/\s$/.test(L.text) && !/[　-鿿＀-￯]$/.test(L.text) && !/^[　-鿿＀-￯]/.test(it.s);
      L.text += (needSpace ? ' ' : (gap > it.size * 1.5 ? '  ' : '')) + it.s;
      L.end = it.x + it.w;
      L.size = Math.max(L.size, it.size);
    } else {
      lines.push({ text: it.s, y: it.y, x: it.x, end: it.x + it.w, size: it.size });
    }
  }
  return lines;
}
function linesToMarkdown(lines, bodySize, md) {
  let out = '', prev = null;
  // Typical line spacing and right margin: used to tell a line wrap from a new paragraph
  const gaps = lines.slice(1).map((L, i) => lines[i].y - L.y).filter(g => g > 0).sort((a, b) => a - b);
  const lineGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : bodySize * 1.4;
  const ends = lines.map(L => L.end).sort((a, b) => a - b);
  const rightEdge = ends.length ? ends[Math.floor(ends.length * 0.9)] : 0;
  for (const L of lines) {
    const t = L.text.trim();
    if (!t) continue;
    const gap = prev ? prev.y - L.y : 0;
    const shortPrev = prev && prev.end < rightEdge - Math.max(prev.size, bodySize) * 3;
    const newPara = prev && (gap > lineGap * 1.35 || gap > Math.max(prev.size, L.size) * 2.2 || gap < 0 || shortPrev || /[。！？!?:：]$/.test(prev.text.trim()) && prev.end < rightEdge - prev.size);
    let line = t;
    let block = false;
    if (md) {
      const r = L.size / bodySize;
      if (t.length < 80 && r >= 1.6) { line = '# ' + t; block = true; }
      else if (t.length < 80 && r >= 1.3) { line = '## ' + t; block = true; }
      else if (t.length < 80 && r >= 1.12) { line = '### ' + t; block = true; }
      else if (/^[•·▪●◦■\-–]\s*/.test(t)) { line = '- ' + t.replace(/^[•·▪●◦■\-–]\s*/, ''); }
      else if (/^\d+[.)、]\s*/.test(t)) { line = t.replace(/^(\d+)[.)、]\s*/, '$1. '); }
    }
    if (!prev) out += line;
    else if (block || newPara || prev.block) out += '\n\n' + line;
    else if (md && /^(- |\d+\. )/.test(line)) out += '\n' + line;
    else {
      // Same paragraph: join CJK text directly, add a space for Latin text
      const cjk = /[　-鿿＀-￯]$/.test(out) || /^[　-鿿＀-￯]/.test(line);
      // Hyphenated line breaks (transforma- tion): drop the hyphen and join
      if (md && /[a-z]-$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line;
      else out += md ? (cjk ? '' : ' ') + line : '\n' + line;
    }
    prev = { ...L, block };
  }
  return out;
}
async function pdfToText(bytes, md, { pageBreak = true } = {}) {
  const js = await openJs(bytes);
  const pages = [];
  const sizes = {};
  for (let i = 1; i <= js.numPages; i++) {
    progress(T('正在提取文字'), i, js.numPages);
    const lines = await extractPageLines(await js.getPage(i));
    lines.forEach(L => { const k = Math.round(L.size); sizes[k] = (sizes[k] || 0) + L.text.length; });
    pages.push(lines);
  }
  await js.loadingTask.destroy();
  const body = +Object.entries(sizes).sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const parts = pages.map(lines => linesToMarkdown(lines, body, md));
  const sep = pageBreak ? (md ? '\n\n---\n\n' : '\n\n\f\n') : '\n\n';
  return { text: parts.join(sep).trim() + '\n', pages: parts, empty: parts.every(p => !p.trim()) };
}
registerTool({
  id: 'pdf2md', group: T('转换'), name: T('PDF 转 Markdown'), desc: T('提取 PDF 里的文字，自动识别标题、列表和段落，导出为 Markdown 或纯文本。'),
  render(view) {
    const fp = filePicker();
    const fmt = optSelect(T('导出格式'), [['md', 'Markdown (.md)'], ['txt', T('纯文本 (.txt)')]], 'md');
    const brk = optCheck(T('在页与页之间加分隔线'), true);
    const ocr = ocrOption();
    const pre = h('textarea', { class: 'preview', readonly: true, placeholder: T('转换结果会显示在这里') });
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      const f = fp.files[0];
      if (!f) return toast(T('请先选择 PDF'));
      const bytes = await readBytes(f);
      const { result: r, ocrPages } = await withAutoOcr(ocr.value, () => pdfToText(bytes, fmt.value === 'md', { pageBreak: brk.value }));
      pre.value = r.text;
      await deliver(res, [{ name: `${baseName(f.name)}.${fmt.value}`, data: new TextEncoder().encode(r.text) }]);
      if (ocrPages) res.append(h('div', { class: 'note', style: { marginTop: '6px' } }, T('已用 OCR 识别了 {0} 页扫描页。', ocrPages), ' ', T('识别结果可能有错字，请检查。')));
      if (r.empty) res.append(h('div', { class: 'warn' }, T('没有提取到文字。如果是扫描件，请开启“扫描页自动识别文字（OCR）”并选对语言。')));
    }) }, T('转换'));
    view.append(...toolHeader(this), card(fp.el), card(optsGrid(fmt, brk, ocr), h('div', { class: 'actions' }, run), res), card(pre));
  },
});
