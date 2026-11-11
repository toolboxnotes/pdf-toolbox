// ================= Watermark =================
function placeCenters(pos, VW, VH, bw, bh, m = 36) {
  if (pos === 'tile') {
    const out = [], sx = bw + 70, sy = bh + 70;
    let row = 0;
    for (let cy = sy / 2; cy < VH + sy / 2; cy += sy, row++)
      for (let cx = (row % 2 ? sx : sx / 2); cx < VW + sx / 2; cx += sx) out.push([cx, cy]);
    return out;
  }
  const xs = { l: m + bw / 2, c: VW / 2, r: VW - m - bw / 2 };
  const ys = { t: VH - m - bh / 2, m: VH / 2, b: m + bh / 2 };
  const [v, hz] = pos === 'center' ? ['m', 'c'] : pos.split('');
  return [[xs[hz], ys[v]]];
}
const POS9 = [['center', T('正中')], ['tile', T('平铺满页')], ['tl', T('左上')], ['tc', T('上方居中')], ['tr', T('右上')], ['ml', T('左侧居中')], ['mr', T('右侧居中')], ['bl', T('左下')], ['bc', T('下方居中')], ['br', T('右下')]]
  .map(([k, t]) => [k === 'tc' ? 'tc' : k, t]);
registerTool({
  id: 'watermark', group: T('编辑'), name: T('添加水印'), desc: T('在页面上盖文字或图片水印，可设置透明度、角度和位置。支持中文。'),
  render(view) {
    const fp = filePicker({ multiple: true, sortable: false });
    const textBox = h('div'), imgBox = h('div');
    const kind = seg([['text', T('文字水印')], ['image', T('图片水印')]], 'text', k => { textBox.hidden = k !== 'text'; imgBox.hidden = k !== 'image'; });
    const text = optText(T('水印文字'), T('内部资料 请勿外传'), { multiline: true });
    const size = optNumber(T('字号'), 48, { min: 6, max: 400 });
    const color = optColor(T('颜色'), '#d6402b');
    const bold = optCheck(T('加粗'), true);
    textBox.append(optsGrid(text, size, color, bold));
    const imgPick = filePicker({ accept: 'image/*,.png,.jpg,.jpeg,.webp', label: T('选择水印图片'), hint: T('建议用透明背景的 PNG') });
    const scale = optRange(T('图片宽度（占页面宽度）'), 40, { min: 5, max: 100, unit: '%' });
    imgBox.append(imgPick.el, h('div', { style: { marginTop: '12px' } }, optsGrid(scale)));
    imgBox.hidden = true;
    const opacity = optRange(T('不透明度'), 30, { min: 5, max: 100, unit: '%' });
    const angle = optNumber(T('旋转角度（逆时针）'), 45, { min: -180, max: 180 });
    const pos = optSelect(T('位置'), POS9, 'center');
    const range = optText(T('页码范围（留空=全部）'), '', { placeholder: T('例如：1-3') });
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!fp.files.length) return toast(T('请先选择 PDF'));
      if (kind.value === 'text' && !text.value.trim()) return toast(T('请填写水印文字'));
      if (kind.value === 'image' && !imgPick.files[0]) return toast(T('请选择水印图片'));
      const outputs = [];
      for (const f of fp.files) {
        busy(true, T('正在添加水印 ') + f.name);
        const doc = await loadLib(await readBytes(f));
        let img, iw, ih;
        if (kind.value === 'text') ({ img, w: iw, h: ih } = await embedText(doc, text.value, { size: size.value, color: color.value, bold: bold.value }));
        else { img = await embedImageFile(doc, imgPick.files[0]); iw = img.width; ih = img.height; }
        const set = rangeIndices(range.value, doc.getPageCount());
        doc.getPages().forEach((p, i) => {
          if (!set.has(i)) return;
          const { VW, VH } = pageGeom(p);
          let w = iw, hh = ih;
          if (kind.value === 'image') { w = VW * scale.value / 100; hh = w * ih / iw; }
          const a = angle.value * Math.PI / 180;
          const bw = Math.abs(w * Math.cos(a)) + Math.abs(hh * Math.sin(a));
          const bh = Math.abs(w * Math.sin(a)) + Math.abs(hh * Math.cos(a));
          for (const [cx, cy] of placeCenters(pos.value, VW, VH, bw, bh))
            drawImageCentered(p, img, { cx, cy, w, h: hh, angle: angle.value, opacity: opacity.value / 100 });
        });
        outputs.push({ name: baseName(f.name) + T('_水印.pdf'), data: await doc.save() });
      }
      await deliver(res, outputs, T('水印.zip'));
    }) }, T('添加水印'));
    view.append(...toolHeader(this), card(fp.el), card(kind.el, h('div', { style: { marginTop: '14px' } }, textBox, imgBox), h('div', { style: { marginTop: '14px' } }, optsGrid(opacity, angle, pos, range)), h('div', { class: 'actions' }, run), res));
  },
});

// ================= Page numbers =================
registerTool({
  id: 'pagenum', group: T('编辑'), name: T('添加页码'), desc: T('给 PDF 加页码，可选位置、格式、起始数字和字号。'),
  render(view) {
    const fp = filePicker({ multiple: true, sortable: false });
    const pos = optSelect(T('位置'), [['bc', T('底部居中')], ['br', T('右下')], ['bl', T('左下')], ['tc', T('顶部居中')], ['tr', T('右上')], ['tl', T('左上')]], 'bc');
    const fmt = optSelect(T('格式'), [['{n}', '1'], ['{n} / {total}', '1 / 10'], [T('第 {n} 页'), T('第 1 页')], [T('第 {n} 页 / 共 {total} 页'), T('第 1 页 / 共 10 页')], ['- {n} -', '- 1 -'], ['Page {n} of {total}', 'Page 1 of 10']], '{n}');
    const start = optNumber(T('起始数字'), 1, { min: 0 });
    const size = optNumber(T('字号'), 11, { min: 5, max: 72 });
    const margin = optNumber(T('距页边（毫米）'), 10, { min: 2, max: 60 });
    const color = optColor(T('颜色'), '#333333');
    const range = optText(T('哪些页加页码（留空=全部）'), '', { placeholder: T('例如：2-（封面不加）'), hint: T('数字从这个范围的第一页开始计') });
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!fp.files.length) return toast(T('请先选择 PDF'));
      const outputs = [];
      for (const f of fp.files) {
        busy(true, T('正在添加页码 ') + f.name);
        const doc = await loadLib(await readBytes(f));
        const set = [...rangeIndices(range.value, doc.getPageCount())].sort((a, b) => a - b);
        const total = start.value + set.length - 1;
        const m = margin.value * 72 / 25.4;
        const pages = doc.getPages();
        for (let k = 0; k < set.length; k++) {
          const p = pages[set[k]];
          const label = fmt.value.replace('{n}', start.value + k).replace('{total}', total);
          const { img, w, h: hh } = await embedText(doc, label, { size: size.value, color: color.value });
          const { VW, VH } = pageGeom(p);
          const [v, hz] = pos.value.split('');
          const cx = hz === 'c' ? VW / 2 : hz === 'l' ? m + w / 2 : VW - m - w / 2;
          const cy = v === 'b' ? m + hh / 2 : VH - m - hh / 2;
          drawImageCentered(p, img, { cx, cy, w, h: hh });
        }
        outputs.push({ name: baseName(f.name) + T('_页码.pdf'), data: await doc.save() });
      }
      await deliver(res, outputs, T('页码.zip'));
    }) }, T('添加页码'));
    view.append(...toolHeader(this), card(fp.el), card(optsGrid(pos, fmt, start, size, margin, color, range), h('div', { class: 'actions' }, run), res));
  },
});

// ================= Page viewer (shared by edit, redact and crop) =================
function pageViewer(js, { maxWidth = 820, onRender } = {}) {
  const wrap = h('div', { class: 'page-wrap' });
  const overlay = h('div', { class: 'overlay' });
  const label = h('span', { class: 'note' });
  const prev = h('button', { class: 'btn small', onclick: () => go(state.index - 1) }, T('‹ 上一页'));
  const next = h('button', { class: 'btn small', onclick: () => go(state.index + 1) }, T('下一页 ›'));
  const state = { index: 0, scale: 1, VW: 0, VH: 0, wrap, overlay, el: null, go, n: js.numPages };
  state.el = h('div', { class: 'editor-stage' }, h('div', { class: 'pager' }, prev, label, next), wrap);
  let token = 0;
  async function go(i) {
    if (i < 0 || i >= js.numPages) return;
    const my = ++token;
    state.index = i;
    const page = await js.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const avail = Math.min(maxWidth, (state.el.clientWidth || maxWidth) - 32);
    const s = Math.min(avail / base.width, 1100 / base.height, 2);
    const dpr = window.devicePixelRatio || 1;
    const c = await renderPage(page, s * dpr);
    if (my !== token) return;
    c.style.width = base.width * s + 'px';
    c.style.height = base.height * s + 'px';
    Object.assign(state, { scale: s, VW: base.width, VH: base.height, viewport: base, page });
    wrap.replaceChildren(c, overlay);
    label.textContent = T("第 {0} / {1} 页", i + 1, js.numPages);
    prev.disabled = i === 0; next.disabled = i === js.numPages - 1;
    onRender && onRender(state);
  }
  return state;
}
// Drag out a rectangle on the overlay (in pt, origin at top-left)
function dragRect(viewer, e, onDone, onMove) {
  const r = viewer.overlay.getBoundingClientRect();
  const s = viewer.scale;
  const x0 = (e.clientX - r.left) / s, y0 = (e.clientY - r.top) / s;
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const move = (ev) => {
    const x1 = clamp((ev.clientX - r.left) / s, viewer.VW), y1 = clamp((ev.clientY - r.top) / s, viewer.VH);
    onMove && onMove({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const x1 = clamp((ev.clientX - r.left) / s, viewer.VW), y1 = clamp((ev.clientY - r.top) / s, viewer.VH);
    onDone({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
const placeBox = (el, b, s) => Object.assign(el.style, { left: b.x * s + 'px', top: b.y * s + 'px', width: b.w * s + 'px', height: b.h * s + 'px' });

// ================= Crop =================
registerTool({
  id: 'crop', group: T('编辑'), name: T('裁剪 PDF'), desc: T('裁掉页面四周的空白。可直接在预览图上拖出要保留的区域，也可以输入边距。'),
  render(view) {
    const MM = 72 / 25.4;
    let viewer = null, bytes = null;
    const stageBox = h('div');
    const box = h('div', { class: 'cropbox' });
    const mT = optNumber(T('上（毫米）'), 10, { min: 0, onInput: () => drawBox() });
    const mR = optNumber(T('右（毫米）'), 10, { min: 0, onInput: () => drawBox() });
    const mB = optNumber(T('下（毫米）'), 10, { min: 0, onInput: () => drawBox() });
    const mL = optNumber(T('左（毫米）'), 10, { min: 0, onInput: () => drawBox() });
    const range = optText(T('应用到哪些页（留空=全部）'), '', { placeholder: T('例如：1-5') });
    function drawBox() {
      if (!viewer) return;
      const b = { x: mL.value * MM, y: mT.value * MM, w: viewer.VW - (mL.value + mR.value) * MM, h: viewer.VH - (mT.value + mB.value) * MM };
      placeBox(box, b, viewer.scale);
    }
    const fp = filePicker({ preview: false, onChange: (fs) => runTask(async () => {
      if (!fs.length) return;
      bytes = await readBytes(fs[0]);
      viewer = pageViewer(await openJs(bytes), { onRender: () => { viewer.overlay.replaceChildren(box); drawBox(); } });
      viewer.overlay.style.cursor = 'crosshair';
      viewer.overlay.addEventListener('pointerdown', (e) => dragRect(viewer, e, (r) => {
        if (r.w < 5 || r.h < 5) return;
        const f = (v) => Math.round(v / MM * 10) / 10;
        mL.value = f(r.x); mT.value = f(r.y); mR.value = f(viewer.VW - r.x - r.w); mB.value = f(viewer.VH - r.y - r.h);
        drawBox();
      }, (r) => placeBox(box, r, viewer.scale)));
      stageBox.replaceChildren(h('p', { class: 'note' }, T('在页面上按住鼠标拖动，框出要保留的区域：')), viewer.el);
      await viewer.go(0);
    }) });
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!bytes) return toast(T('请先选择 PDF'));
      const doc = await loadLib(bytes);
      const set = rangeIndices(range.value, doc.getPageCount());
      const m = { t: mT.value * MM, r: mR.value * MM, b: mB.value * MM, l: mL.value * MM };
      doc.getPages().forEach((p, i) => {
        if (!set.has(i)) return;
        const g = pageGeom(p);
        if (m.l + m.r >= g.VW - 10 || m.t + m.b >= g.VH - 10) throw new Error(T("第 {0} 页裁剪边距太大", i + 1));
        const [x1, y1] = toUser(g, m.l, m.b), [x2, y2] = toUser(g, g.VW - m.r, g.VH - m.t);
        const nb = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
        p.setMediaBox(...nb);
        p.setCropBox(...nb);
      });
      await deliver(res, [{ name: baseName(fp.files[0].name) + T('_裁剪.pdf'), data: await doc.save() }]);
    }) }, T('裁剪'));
    view.append(...toolHeader(this), card(fp.el), card(optsGrid(mT, mR, mB, mL, range), h('div', { class: 'actions' }, run), res), stageBox);
  },
});

// ================= Signature pad =================
function trimCanvas(c, pad = 6) {
  const ctx = c.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
function signatureDialog() {
  return new Promise((resolve) => {
    const pad = h('canvas', { class: 'sigpad', width: 1040, height: 360, style: { height: '180px' } });
    const ctx = pad.getContext('2d');
    const color = optColor(T('颜色'), '#1a237e');
    const width = optRange(T('笔画粗细'), 5, { min: 2, max: 14 });
    let drawing = false, last = null;
    const pt = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
    pad.addEventListener('pointerdown', e => { drawing = true; last = pt(e); pad.setPointerCapture(e.pointerId); });
    pad.addEventListener('pointermove', e => {
      if (!drawing) return;
      const p = pt(e);
      ctx.strokeStyle = color.value; ctx.lineWidth = width.value * 2; ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
      last = p;
    });
    pad.addEventListener('pointerup', () => drawing = false);
    const typed = optText(T('输入姓名'), '', { placeholder: T('例如：张三') });
    const SIG_FONTS = [
      ['"Nanum Pen Script","NanumPen","Gungsuh","궁서","GungSeo",cursive', T('韩文手写体')],
      ['"Snell Roundhand","Segoe Script","Brush Script MT",cursive', T('英文手写体')],
      ['"Kaiti SC","STKaiti","KaiTi","楷体",serif', T('楷体')],
      ['"AppleMyungjo","Batang","바탕","Songti SC","STSong","SimSun",serif', T('宋体')],
    ];
    if (LANG === 'zh') SIG_FONTS.unshift(SIG_FONTS.splice(2, 1)[0]);
    if (LANG === 'en') SIG_FONTS.unshift(SIG_FONTS.splice(1, 1)[0]);
    const typedFont = optSelect(T('字体'), SIG_FONTS, SIG_FONTS[0][0]);
    const up = filePicker({ accept: 'image/*,.png,.jpg,.jpeg', label: T('选择签名图片'), hint: T('透明背景的 PNG 效果最好') });
    const panes = { draw: h('div', {}, pad, h('div', { class: 'row', style: { marginTop: '8px' } }, color.el, width.el, h('button', { class: 'btn small', onclick: () => ctx.clearRect(0, 0, pad.width, pad.height) }, T('清空')))),
      type: optsGrid(typed, typedFont), upload: up.el };
    const body = h('div', { style: { margin: '12px 0' } }, panes.draw);
    const tab = seg([['draw', T('手写')], ['type', T('打字')], ['upload', T('上传图片')]], 'draw', k => body.replaceChildren(panes[k]));
    const close = (v) => { bg.remove(); resolve(v); };
    const ok = h('button', { class: 'btn primary', onclick: async () => {
      let c = null;
      if (tab.value === 'draw') c = trimCanvas(pad);
      else if (tab.value === 'type') { if (typed.value.trim()) c = textCanvas(typed.value, { size: 40, color: color.value, family: typedFont.value }).canvas; }
      else if (up.files[0]) c = await imageToCanvas(up.files[0]);
      if (!c) return toast(T('请先签名'));
      close(c);
    } }, T('使用这个签名'));
    const bg = h('div', { class: 'modal-bg' }, h('div', { class: 'modal' }, h('h3', {}, T('创建签名')), tab.el, body,
      h('div', { class: 'actions' }, ok, h('button', { class: 'btn', onclick: () => close(null) }, T('取消')))));
    document.body.append(bg);
  });
}

// ================= Edit / Sign =================
function downscale(c, max = 2000) {
  const s = Math.min(1, max / Math.max(c.width, c.height));
  if (s === 1) return c;
  const o = document.createElement('canvas');
  o.width = Math.round(c.width * s); o.height = Math.round(c.height * s);
  o.getContext('2d').drawImage(c, 0, 0, o.width, o.height);
  return o;
}
registerTool({
  id: 'edit', group: T('编辑'), name: T('编辑 / 签名'), desc: T('在 PDF 上添加文字、图片、手写签名、画笔、矩形、高亮或白色遮盖。拖动可移动，拖右下角可缩放。'),
  render(view) {
    let viewer = null, bytes = null, objs = [], sel = null, mode = null, nextId = 1;
    const side = h('div', { class: 'editor-side' });
    const stageBox = h('div', { style: { flex: 1, minWidth: 0 } });
    const props = h('div', { style: { marginTop: '14px' } });
    const res = h('div');
    const color = optColor(T('颜色'), '#d6402b');
    const penW = optRange(T('画笔粗细'), 3, { min: 1, max: 20 });
    const center = (w, hh) => {
      const k = objs.filter(o => o.page === viewer.index).length % 8; // Offset each one so they don't stack on top of each other
      return { x: (viewer.VW - w) / 2 + k * 14, y: Math.max(10, (viewer.VH - hh) / 3) + k * 22 };
    };

    function textMeasure(o) { const t = textCanvas(o.text, { size: o.size, color: o.color, bold: o.bold }); o.w = t.w; o.h = t.h; o.canvas = t.canvas; }
    function add(o) { o.id = nextId++; o.page = viewer.index; objs.push(o); sel = o; drawObjs(); }
    const tools = [
      [T('文字'), () => { const o = { type: 'text', text: T('在左侧修改文字'), size: 16, color: color.value, bold: false }; textMeasure(o); Object.assign(o, center(o.w, o.h)); add(o); }],
      [T('图片'), async () => {
        const inp = h('input', { type: 'file', accept: 'image/*' });
        inp.onchange = async () => {
          const f = inp.files[0]; if (!f) return;
          const c = downscale(await imageToCanvas(f));
          let w = Math.min(viewer.VW * 0.4, c.width * 0.75), hh = w * c.height / c.width;
          add({ type: 'image', canvas: c, jpg: /jpe?g$/i.test(f.type), w, h: hh, ...center(w, hh) });
        };
        inp.click();
      }],
      [T('签名'), async () => {
        const c = await signatureDialog(); if (!c) return;
        const w = Math.min(160, viewer.VW * 0.35), hh = w * c.height / c.width;
        add({ type: 'image', canvas: c, w, h: hh, ...center(w, hh) });
      }],
      [T('画笔'), () => { mode = mode === 'pen' ? null : 'pen'; refreshTools(); }],
      [T('矩形'), () => { mode = mode === 'rect' ? null : 'rect'; refreshTools(); }],
      [T('高亮'), () => { mode = mode === 'hl' ? null : 'hl'; refreshTools(); }],
      [T('白色遮盖'), () => { mode = mode === 'white' ? null : 'white'; refreshTools(); }],
    ];
    const toolModes = [null, null, null, 'pen', 'rect', 'hl', 'white'];
    const toolBtns = tools.map(([t, fn]) => h('button', { class: 'btn small', onclick: () => { if (!viewer) return toast(T('请先选择 PDF')); fn(); } }, t));
    const modeHint = h('div', { class: 'note', style: { marginTop: '8px' } });
    function refreshTools() {
      toolBtns.forEach((b, i) => b.classList.toggle('on', !!toolModes[i] && toolModes[i] === mode));
      modeHint.textContent = { pen: T('在页面上按住鼠标画。再点一次“画笔”结束。'), rect: T('在页面上拖出矩形。'), hl: T('在页面上拖出要高亮的区域。'), white: T('拖出区域，用白色盖住原内容（原文字仍在文件里，要彻底删除请用“涂黑”）。') }[mode] || '';
      if (viewer) viewer.overlay.style.cursor = mode ? 'crosshair' : 'default';
    }

    function drawProps() {
      props.replaceChildren();
      if (!sel) return props.append(h('div', { class: 'note' }, T('点选页面上的对象可修改属性。')));
      const o = sel;
      const del = h('button', { class: 'btn small', onclick: () => { objs = objs.filter(x => x !== o); sel = null; drawObjs(); } }, T('删除'));
      if (o.type === 'text') {
        const t = optText(T('文字内容'), o.text, { multiline: true, onInput: v => { o.text = v || ' '; textMeasure(o); drawObjs(false); } });
        const sz = optNumber(T('字号'), o.size, { min: 4, max: 200, onInput: v => { o.size = v || 12; textMeasure(o); drawObjs(false); } });
        const c = optColor(T('颜色'), o.color); c.input.oninput = () => { o.color = c.value; textMeasure(o); drawObjs(false); };
        const b = optCheck(T('加粗'), o.bold); b.input.onchange = () => { o.bold = b.value; textMeasure(o); drawObjs(false); };
        props.append(h('div', { style: { display: 'grid', gap: '10px' } }, t.el, sz.el, c.el, b.el, del));
        setTimeout(() => t.input.focus(), 0);
      } else if (o.type === 'rect') {
        const c = optColor(T('颜色'), o.color); c.input.oninput = () => { o.color = c.value; drawObjs(false); };
        const op = optRange(T('不透明度'), Math.round(o.opacity * 100), { min: 5, max: 100, unit: '%' }); op.input.addEventListener('input', () => { o.opacity = op.value / 100; drawObjs(false); });
        props.append(h('div', { style: { display: 'grid', gap: '10px' } }, c.el, op.el, del));
      } else props.append(del);
    }

    function objEl(o) {
      const s = viewer.scale;
      const el = h('div', { class: 'obj' + (o === sel ? ' sel' : '') });
      placeBox(el, o, s);
      if (o.type === 'rect') Object.assign(el.style, { background: o.color, opacity: o.opacity });
      else el.append(h('img', { src: o.canvas.toDataURL() }));
      const handle = h('div', { class: 'h' }), x = h('div', { class: 'x', title: T('删除') }, '✕');
      el.append(handle, x);
      x.addEventListener('pointerdown', e => { e.stopPropagation(); objs = objs.filter(q => q !== o); sel = null; drawObjs(); });
      el.addEventListener('pointerdown', e => {
        e.stopPropagation();
        if (sel !== o) { sel = o; drawObjs(); }
        const resize = e.target === handle;
        const sx = e.clientX, sy = e.clientY, o0 = { ...o };
        const move = ev => {
          const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s;
          if (resize) {
            const w = Math.max(8, o0.w + dx);
            if (o.type === 'rect') { o.w = w; o.h = Math.max(4, o0.h + dy); }
            else if (o.type === 'text') { o.size = Math.max(4, o0.size * w / o0.w); textMeasure(o); }
            else { o.w = w; o.h = w * o0.h / o0.w; }
          } else { o.x = o0.x + dx; o.y = o0.y + dy; }
          const cur = viewer.overlay.querySelector('.obj.sel');
          if (cur) placeBox(cur, o, s);
          if (resize && o.type === 'text' && cur) cur.querySelector('img').src = o.canvas.toDataURL();
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); drawProps(); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      return el;
    }
    function drawObjs(withProps = true) {
      if (!viewer) return;
      viewer.overlay.replaceChildren(...objs.filter(o => o.page === viewer.index).map(objEl));
      if (withProps) drawProps();
    }
    function onOverlayDown(e) {
      if (e.target !== viewer.overlay) return;
      if (!mode) { sel = null; drawObjs(); return; }
      if (mode === 'pen') return penStroke(e);
      const ghost = h('div', { class: 'obj sel', style: { background: mode === 'white' ? '#fff' : mode === 'hl' ? '#ffeb3b' : color.value, opacity: mode === 'hl' ? 0.4 : 1, outline: '1px dashed #999' } });
      viewer.overlay.append(ghost);
      dragRect(viewer, e, (r) => {
        ghost.remove();
        if (r.w < 3 || r.h < 3) return;
        add({ type: 'rect', ...r, color: mode === 'white' ? '#ffffff' : mode === 'hl' ? '#ffeb3b' : color.value, opacity: mode === 'hl' ? 0.4 : 1 });
      }, (r) => placeBox(ghost, r, viewer.scale));
    }
    function penStroke(e) {
      const s = viewer.scale, r = viewer.overlay.getBoundingClientRect();
      const K = 3; // Canvas resolution multiplier
      const c = h('canvas', { width: Math.round(viewer.VW * K), height: Math.round(viewer.VH * K), style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } });
      const ctx = c.getContext('2d');
      Object.assign(ctx, { strokeStyle: color.value, lineWidth: penW.value * K, lineCap: 'round', lineJoin: 'round' });
      viewer.overlay.append(c);
      let last = [(e.clientX - r.left) / s * K, (e.clientY - r.top) / s * K];
      ctx.beginPath(); ctx.arc(last[0], last[1], ctx.lineWidth / 2, 0, 7); ctx.fillStyle = color.value; ctx.fill();
      const move = ev => {
        const p = [(ev.clientX - r.left) / s * K, (ev.clientY - r.top) / s * K];
        ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p;
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const full = trimCanvasWithBox(c);
        c.remove();
        if (!full) return;
        add({ type: 'image', canvas: full.canvas, x: full.x / K, y: full.y / K, w: full.canvas.width / K, h: full.canvas.height / K });
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }
    function trimCanvasWithBox(c) {
      const ctx = c.getContext('2d');
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
      let x0 = width, y0 = height, x1 = -1, y1 = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) return null;
      const o = document.createElement('canvas');
      o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
      o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
      return { canvas: o, x: x0, y: y0 };
    }

    const fp = filePicker({ preview: false, onChange: (fs) => runTask(async () => {
      if (!fs.length) return;
      bytes = await readBytes(fs[0]); objs = []; sel = null;
      viewer = pageViewer(await openJs(bytes), { onRender: () => drawObjs() });
      viewer.overlay.addEventListener('pointerdown', onOverlayDown);
      stageBox.replaceChildren(viewer.el);
      await viewer.go(0);
      refreshTools();
    }) });
    document.addEventListener('keydown', function onKey(e) {
      if (!document.body.contains(stageBox)) return document.removeEventListener('keydown', onKey);
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        objs = objs.filter(o => o !== sel); sel = null; drawObjs();
      }
    });
    const save = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!bytes) return toast(T('请先选择 PDF'));
      if (!objs.length) return toast(T('还没有添加任何内容'));
      const doc = await loadLib(bytes);
      const pages = doc.getPages();
      for (let i = 0; i < objs.length; i++) {
        progress(T('正在写入'), i + 1, objs.length);
        const o = objs[i], p = pages[o.page], { VH } = pageGeom(p);
        const vy = VH - o.y - o.h;
        if (o.type === 'rect') drawRectVisual(p, { x: o.x, y: vy, w: o.w, h: o.h, color: hexToRgb(o.color), opacity: o.opacity });
        else {
          const img = o.jpg ? await doc.embedJpg(await canvasBytes(o.canvas, 'image/jpeg', 0.92)) : await doc.embedPng(await canvasBytes(o.canvas));
          drawImageVisual(p, img, { x: o.x, y: vy, w: o.w, h: o.h });
        }
      }
      await deliver(res, [{ name: baseName(fp.files[0].name) + T('_已编辑.pdf'), data: await doc.save() }]);
    }) }, T('保存 PDF'));
    side.append(card(h('div', { class: 'row' }, toolBtns), modeHint, h('div', { style: { display: 'grid', gap: '10px', marginTop: '12px' } }, color.el, penW.el), props), card(save, res));
    drawProps();
    view.append(...toolHeader(this), card(fp.el), h('div', { class: 'editor' }, side, stageBox));
  },
});

// ================= Redact =================
registerTool({
  id: 'redact', group: T('安全'), name: T('涂黑 PDF'), desc: T('永久删除敏感内容：框选或搜索文字，被涂黑的页面会转为图片，原文字无法再被复制或找回。'),
  render(view) {
    let viewer = null, bytes = null, js = null, boxes = [];
    const stageBox = h('div', { style: { flex: 1, minWidth: 0 } });
    const count = h('div', { class: 'note' });
    const res = h('div');
    function drawBoxes() {
      if (!viewer) return;
      viewer.overlay.replaceChildren(...boxes.filter(b => b.page === viewer.index).map(b => {
        const el = h('div', { class: 'redbox' }, h('div', { class: 'x', onpointerdown: (e) => { e.stopPropagation(); boxes = boxes.filter(q => q !== b); drawBoxes(); } }, '✕'));
        placeBox(el, b, viewer.scale);
        return el;
      }));
      const pages = new Set(boxes.map(b => b.page)).size;
      count.textContent = boxes.length ? T("已标记 {0} 处，涉及 {1} 页", boxes.length, pages) : T('还没有标记');
    }
    const fp = filePicker({ preview: false, onChange: (fs) => runTask(async () => {
      if (!fs.length) return;
      bytes = await readBytes(fs[0]); boxes = [];
      js = await openJs(bytes);
      viewer = pageViewer(js, { onRender: drawBoxes });
      viewer.overlay.style.cursor = 'crosshair';
      viewer.overlay.addEventListener('pointerdown', (e) => {
        if (e.target !== viewer.overlay) return;
        const ghost = h('div', { class: 'redbox' });
        viewer.overlay.append(ghost);
        dragRect(viewer, e, (r) => { ghost.remove(); if (r.w > 2 && r.h > 2) boxes.push({ ...r, page: viewer.index }); drawBoxes(); }, (r) => placeBox(ghost, r, viewer.scale));
      });
      stageBox.replaceChildren(viewer.el);
      await viewer.go(0);
    }) });
    const kw = optText(T('搜索要涂黑的文字'), '', { placeholder: T('例如：手机号、姓名'), hint: T('会在所有页面里查找并自动标记') });
    const ocrFind = ocrOption({ label: T('也在扫描页里搜索（OCR）') });
    const find = h('button', { class: 'btn', onclick: () => runTask(async () => {
      if (!js) return toast(T('请先选择 PDF'));
      const q = kw.value.trim();
      if (!q) return toast(T('请输入要搜索的文字'));
      const { result: n } = await withAutoOcr(ocrFind.value, async () => { let n = 0;
      for (let i = 1; i <= js.numPages; i++) {
        progress(T('正在搜索'), i, js.numPages);
        const page = await js.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        for (const it of (await pageTextContent(page)).items) {
          if (!it.str) continue;
          let from = 0, k;
          while ((k = it.str.indexOf(q, from)) >= 0) {
            from = k + q.length;
            const [ta, tb, c, d, e, f] = it.transform;
            const fh = Math.hypot(c, d) || it.height;
            const la = Math.hypot(ta, tb) || 1, lc = fh || 1;
            const ux = ta / la, uy = tb / la, vx = c / lc, vy = d / lc; // Text direction and up direction (so rotated text is handled correctly)
            const len = it.str.length;
            const s1 = it.width * k / len, s2 = it.width * (k + q.length) / len;
            const [a1, b1] = vp.convertToViewportPoint(e + ux * s1 - vx * fh * 0.25, f + uy * s1 - vy * fh * 0.25);
            const [a2, b2] = vp.convertToViewportPoint(e + ux * s2 + vx * fh * 0.95, f + uy * s2 + vy * fh * 0.95);
            boxes.push({ page: i - 1, x: Math.min(a1, a2) - 1, y: Math.min(b1, b2) - 1, w: Math.abs(a2 - a1) + 2, h: Math.abs(b2 - b1) + 2 });
            n++;
          }
        }
      }
      return n; });
      drawBoxes();
      toast(n ? T("找到并标记了 {0} 处", n) : T('没有找到。扫描页请开启 OCR，或手动框选。'));
    }) }, T('查找并标记'));
    const dpi = optSelect(T('涂黑页面的清晰度'), [['150', '150 DPI'], ['200', T('200 DPI（推荐）')], ['300', '300 DPI']], '200');
    const all = optCheck(T('整个文件都转为图片'), false, T('默认只把有涂黑的页面转为图片，其他页面保持可选文字'));
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!bytes) return toast(T('请先选择 PDF'));
      if (!boxes.length) return toast(T('还没有标记要涂黑的区域'));
      const only = all.value ? null : new Set(boxes.map(b => b.page));
      const data = await rasterizePdf(bytes, { dpi: +dpi.value, format: 'jpg', quality: 0.9, only, label: T('正在涂黑'), paint: (ctx, i, s) => {
        ctx.fillStyle = '#000';
        boxes.filter(b => b.page === i).forEach(b => ctx.fillRect(b.x * s, b.y * s, b.w * s, b.h * s));
      } });
      await deliver(res, [{ name: baseName(fp.files[0].name) + T('_已涂黑.pdf'), data }]);
    }) }, T('应用涂黑并保存'));
    const side = h('div', { class: 'editor-side' },
      card(h('div', { class: 'note' }, T('在页面上按住鼠标拖动，框出要涂黑的区域；点 ✕ 取消。')), h('div', { style: { margin: '12px 0', display: 'grid', gap: '8px' } }, kw.el, ocrFind.el, find), count),
      card(h('div', { style: { display: 'grid', gap: '10px' } }, dpi.el, all.el), h('div', { class: 'actions' }, run), res));
    view.append(...toolHeader(this), card(fp.el), h('div', { class: 'editor' }, side, stageBox));
  },
});
