// ================= Merge =================
registerTool({
  id: 'merge', group: T('整理'), name: T('合并 PDF'), desc: T('把多个 PDF 按你排好的顺序合成一个文件。可拖动或用箭头调整顺序。'),
  render(view) {
    const fp = filePicker({ multiple: true });
    const name = optText(T('输出文件名'), T('合并.pdf'));
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      const files = fp.files;
      if (files.length < 2) return toast(T('请至少选择 2 个 PDF'));
      const out = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        progress(T('正在合并'), i + 1, files.length);
        const src = await loadLib(await readBytes(files[i]));
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(p => out.addPage(p));
      }
      await deliver(res, [{ name: ensureExt(name.value, 'pdf'), data: await out.save() }]);
    }) }, T('合并'));
    view.append(...toolHeader(this), card(fp.el), card(optsGrid(name), h('div', { class: 'actions' }, run), res));
  },
});
function ensureExt(n, ext) {
  n = (n || '').trim() || T('输出');
  return n.toLowerCase().endsWith('.' + ext) ? n : n + '.' + ext;
}

// ================= Split =================
async function subsetPdf(src, indices) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach(p => out.addPage(p));
  return out.save();
}
registerTool({
  id: 'split', group: T('整理'), name: T('拆分 PDF'), desc: T('按页拆成多个文件，或把指定页面提取出来。'),
  render(view) {
    let total = 0;
    const info = h('div', { class: 'note' });
    const fp = filePicker({ onChange: async (fs) => {
      total = 0; info.textContent = '';
      if (!fs.length) return;
      try { total = (await loadLib(await readBytes(fs[0]))).getPageCount(); info.textContent = T("共 {0} 页", total); }
      catch (e) { toast(friendlyError(e)); }
    } });
    const ranges = optText(T('页码范围'), '', { placeholder: T('例如：1-3, 4-6, 7-'), hint: T('每个范围生成一个文件；“7-” 表示第 7 页到最后') });
    const every = optNumber(T('每几页一个文件'), 2, { min: 1 });
    const extract = optText(T('要提取的页面'), '', { placeholder: T('例如：1, 3, 5-8'), hint: T('这些页面按顺序合成一个新文件') });
    const optBox = h('div');
    const mode = seg([['each', T('每页一个文件')], ['ranges', T('按范围拆分')], ['every', T('每 N 页拆分')], ['extract', T('提取页面')]], 'each', m => {
      optBox.replaceChildren(...({ each: [], ranges: [optsGrid(ranges)], every: [optsGrid(every)], extract: [optsGrid(extract)] }[m]));
    });
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      const f = fp.files[0];
      if (!f) return toast(T('请先选择 PDF'));
      const src = await loadLib(await readBytes(f));
      const n = src.getPageCount(), b = baseName(f.name);
      let groups = [];
      if (mode.value === 'each') groups = Array.from({ length: n }, (_, i) => [i, i]);
      else if (mode.value === 'ranges') groups = parseRanges(ranges.value, n);
      else if (mode.value === 'every') {
        const k = Math.max(1, Math.floor(every.value));
        for (let i = 0; i < n; i += k) groups.push([i, Math.min(n - 1, i + k - 1)]);
      }
      const outputs = [];
      if (mode.value === 'extract') {
        if (!extract.value.trim()) return toast(T('请填写要提取的页面'));
        const idx = parseRanges(extract.value, n).flatMap(([a, z]) => Array.from({ length: z - a + 1 }, (_, i) => a + i));
        outputs.push({ name: T("{0}_提取.pdf", b), data: await subsetPdf(src, idx) });
      } else {
        for (let i = 0; i < groups.length; i++) {
          progress(T('正在拆分'), i + 1, groups.length);
          const [a, z] = groups[i];
          const idx = Array.from({ length: z - a + 1 }, (_, k) => a + k);
          outputs.push({ name: `${b}_${a === z ? a + 1 : `${a + 1}-${z + 1}`}.pdf`, data: await subsetPdf(src, idx) });
        }
      }
      await deliver(res, outputs, T("{0}_拆分.zip", b));
    }) }, T('拆分'));
    view.append(...toolHeader(this), card(fp.el, info), card(mode.el, h('div', { style: { marginTop: '14px' } }, optBox), h('div', { class: 'actions' }, run), res));
  },
});

// ================= Organize pages =================
// Shrink a little when rotated 90/270° so sideways thumbnails aren't clipped
function rotCss(rot, c) {
  if (rot % 180 === 0) return `rotate(${rot}deg)`;
  const r = c ? Math.min(c.width, c.height) / Math.max(c.width, c.height) : 0.7;
  return `rotate(${rot}deg) scale(${Math.max(0.55, Math.min(1, r * 1.05)).toFixed(2)})`;
}
registerTool({
  id: 'organize', group: T('整理'), name: T('整理页面'), desc: T('查看所有页面缩略图，拖动排序、旋转、删除、复制、插入空白页，也可以追加其他 PDF 的页面。'),
  render(view) {
    const sources = []; // {lib, js, thumbs: canvas[], name}
    let items = [];     // {doc, idx, rot} or {blank:true, rot}
    let dragFrom = -1;
    const grid = h('div', { class: 'thumbs' });
    const res = h('div');
    const fp = filePicker({ multiple: true, sortable: false, preview: false, label: T('选择 PDF（可以多个，页面会依次追加）'), onChange: async (fs) => {
      // Only handle newly added files
      await runTask(async () => {
        for (const f of fs.slice(sources.length)) {
          const bytes = await readBytes(f);
          const lib = await loadLib(bytes), js = await openJs(bytes);
          const src = { lib, js, thumbs: [], name: f.name };
          sources.push(src);
          const d = sources.length - 1;
          for (let i = 0; i < js.numPages; i++) {
            progress(T('正在生成缩略图'), i + 1, js.numPages);
            src.thumbs[i] = await renderThumb(await js.getPage(i + 1));
            items.push({ doc: d, idx: i, rot: 0 });
          }
        }
        draw();
      });
    } });
    fp.el.querySelector('.files').hidden = true;
    function thumbEl(it, i) {
      const wrap = h('div', { class: 'imgwrap' });
      if (it.blank) wrap.append(h('div', { class: 'blank', style: { transform: rotCss(it.rot) } }, T('空白页')));
      else {
        const c = copyCanvas(sources[it.doc].thumbs[it.idx]);
        c.style.transform = rotCss(it.rot, c);
        c.style.width = c.width / (window.devicePixelRatio || 1) + 'px';
        wrap.append(c);
      }
      const el = h('div', { class: 'thumb', draggable: true, 'data-key': it.blank ? 'blank' : it.doc + '-' + (it.idx + 1) },
        wrap,
        h('div', { class: 'no' }, `${i + 1}`, sources.length > 1 && !it.blank ? T(" · 文件{0}-p{1}", it.doc + 1, it.idx + 1) : ''),
        h('div', { class: 'tools' },
          h('button', { title: T('前移'), onclick: () => { if (i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } } }, '‹'),
          h('button', { title: T('向左旋转'), onclick: () => { it.rot = (it.rot + 270) % 360; draw(); } }, '⟲'),
          h('button', { title: T('向右旋转'), onclick: () => { it.rot = (it.rot + 90) % 360; draw(); } }, '⟳'),
          h('button', { title: T('复制此页'), onclick: () => { items.splice(i + 1, 0, { ...it }); draw(); } }, '⧉'),
          h('button', { title: T('在后面插入空白页'), onclick: () => { items.splice(i + 1, 0, { blank: true, rot: 0, after: it }); draw(); } }, '+'),
          h('button', { title: T('删除'), onclick: () => { items.splice(i, 1); draw(); } }, '✕'),
          h('button', { title: T('后移'), onclick: () => { if (i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); } } }, '›')));
      el.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop-before'); });
      el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
      el.addEventListener('drop', e => {
        e.preventDefault();
        if (dragFrom < 0 || dragFrom === i) return draw();
        const [m] = items.splice(dragFrom, 1);
        items.splice(dragFrom < i ? i - 1 : i, 0, m);
        dragFrom = -1;
        draw();
      });
      return el;
    }
    function draw() {
      grid.replaceChildren(...items.map(thumbEl));
      count.textContent = items.length ? T("共 {0} 页", items.length) : '';
    }
    const count = h('span', { class: 'note' });
    const bar = h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { items.forEach(it => it.rot = (it.rot + 270) % 360); draw(); } }, T('全部向左转')),
      h('button', { class: 'btn small', onclick: () => { items.forEach(it => it.rot = (it.rot + 90) % 360); draw(); } }, T('全部向右转')),
      h('button', { class: 'btn small', onclick: () => { items.reverse(); draw(); } }, T('倒序')),
      h('button', { class: 'btn small', onclick: () => { items.push({ blank: true, rot: 0 }); draw(); } }, T('末尾加空白页')),
      count);
    const name = optText(T('输出文件名'), T('整理后.pdf'));
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!items.length) return toast(T('没有页面'));
      const out = await PDFDocument.create();
      let lastSize = [595.28, 841.89];
      for (let i = 0; i < items.length; i++) {
        progress(T('正在生成'), i + 1, items.length);
        const it = items[i];
        let p;
        if (it.blank) {
          const ref = it.after && !it.after.blank ? sources[it.after.doc].lib.getPage(it.after.idx) : null;
          const size = ref ? (() => { const g = pageGeom(ref); return [g.VW, g.VH]; })() : lastSize;
          p = out.addPage(size);
        } else {
          [p] = await out.copyPages(sources[it.doc].lib, [it.idx]);
          out.addPage(p);
          const g = pageGeom(p);
          lastSize = [g.VW, g.VH];
        }
        p.setRotation(degrees((p.getRotation().angle + it.rot) % 360));
      }
      await deliver(res, [{ name: ensureExt(name.value, 'pdf'), data: await out.save() }]);
    }) }, T('保存'));
    view.append(...toolHeader(this), card(fp.el), card(bar, grid), card(optsGrid(name), h('div', { class: 'actions' }, run), res));
  },
});

// ================= Rotate =================
registerTool({
  id: 'rotate', group: T('整理'), name: T('旋转 PDF'), desc: T('点页面缩略图就能旋转这一页，也可以一次旋转全部页面。可同时处理多个文件。'),
  render(view) {
    let docs = []; // {file, thumbs: canvas[], n, rot: number[]}
    const area = h('div');
    const fp = filePicker({ multiple: true, sortable: false, preview: false, onChange: (fs) => runTask(async () => {
      const keep = new Map(docs.map(d => [d.file, d]));
      const next = [];
      for (const f of fs) {
        if (keep.has(f)) { next.push(keep.get(f)); continue; }
        busy(true, T('正在生成预览…') + ' ' + f.name);
        const r = await pdfThumbs(f, 400);
        next.push({ file: f, thumbs: r.canvases, n: r.n, rot: new Array(r.n).fill(0) });
      }
      docs = next;
      draw();
    }) });
    const turnAll = (d) => { docs.forEach(doc => { doc.rot = doc.rot.map(r => (r + d + 360) % 360); }); draw(); };
    const bar = h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => turnAll(270) }, '⟲ ', T('全部向左转')),
      h('button', { class: 'btn', onclick: () => turnAll(90) }, '⟳ ', T('全部向右转')),
      h('button', { class: 'btn', onclick: () => { docs.forEach(d => d.rot.fill(0)); draw(); } }, T('还原')),
      h('span', { class: 'note' }, T('点缩略图旋转单页（每点一次向右转 90°）')));
    function draw() {
      area.replaceChildren(...docs.map(d => h('div', { class: 'rot-doc' },
        docs.length > 1 ? h('div', { class: 'rot-name' }, d.file.name) : null,
        h('div', { class: 'thumbs' }, d.thumbs.map((c, i) => {
          const img = thumbImg(c);
          img.style.transform = rotCss(d.rot[i], c);
          const el = h('div', { class: 'thumb rot-thumb' + (d.rot[i] ? ' sel' : ''), title: T('点击向右旋转 90°') },
            h('div', { class: 'imgwrap' }, img),
            h('div', { class: 'no' }, i + 1, d.rot[i] ? ` · ${d.rot[i]}°` : ''),
            h('div', { class: 'tools' },
              h('button', { title: T('向左旋转'), onclick: (e) => { e.stopPropagation(); d.rot[i] = (d.rot[i] + 270) % 360; draw(); } }, '⟲'),
              h('button', { title: T('向右旋转'), onclick: (e) => { e.stopPropagation(); d.rot[i] = (d.rot[i] + 90) % 360; draw(); } }, '⟳')));
          el.addEventListener('click', () => { d.rot[i] = (d.rot[i] + 90) % 360; draw(); });
          return el;
        }),
        d.n > d.thumbs.length ? h('div', { class: 'note' }, T('还有 {0} 页没有显示，会和第 1 页一样处理', d.n - d.thumbs.length)) : null))));
    }
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!docs.length) return toast(T('请先选择 PDF'));
      if (docs.every(d => d.rot.every(r => !r))) return toast(T('还没有旋转任何页面'));
      const outputs = [];
      for (const d of docs) {
        const doc = await loadLib(await readBytes(d.file));
        doc.getPages().forEach((p, i) => {
          const r = i < d.thumbs.length ? d.rot[i] : d.rot[0];
          if (r) p.setRotation(degrees((p.getRotation().angle + r) % 360));
        });
        outputs.push({ name: baseName(d.file.name) + T('_旋转.pdf'), data: await doc.save() });
      }
      await deliver(res, outputs, T('旋转.zip'));
    }) }, T('旋转'));
    view.append(...toolHeader(this), card(fp.el), card(bar, area), card(h('div', { class: 'actions', style: { marginTop: 0 } }, run), res));
  },
});
