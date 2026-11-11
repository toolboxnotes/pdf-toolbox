// ================= Fill form =================
const NON_LATIN = /[^\x00-\xff]/;
registerTool({
  id: 'forms', group: T('编辑'), name: T('填写表单'), desc: T('读取 PDF 里的表单字段（文本框、勾选框、下拉框、单选），在这里填好后保存。'),
  render(view) {
    let bytes = null, fields = [];
    const box = h('div');
    const flat = optCheck(T('填完后扁平化（锁定，不能再修改）'), false);
    const res = h('div');
    const L = PDFLib;
    const fp = filePicker({ onChange: (fs) => runTask(async () => {
      box.replaceChildren(); fields = [];
      if (!fs.length) return;
      bytes = await readBytes(fs[0]);
      const doc = await loadLib(bytes);
      const all = doc.getForm().getFields();
      const els = [];
      for (const f of all) {
        const name = f.getName();
        let input, get;
        if (f instanceof L.PDFTextField) {
          input = f.isMultiline() ? h('textarea', { rows: 3 }) : h('input', { type: 'text' });
          input.value = f.getText() || '';
          get = () => input.value;
        } else if (f instanceof L.PDFCheckBox) {
          input = h('input', { type: 'checkbox', checked: f.isChecked() });
          get = () => input.checked;
        } else if (f instanceof L.PDFDropdown || f instanceof L.PDFOptionList) {
          const cur = f.getSelected();
          input = h('select', {}, h('option', { value: '' }, T('（不选）')), f.getOptions().map(o => h('option', { value: o, selected: cur.includes(o) }, o)));
          get = () => input.value;
        } else if (f instanceof L.PDFRadioGroup) {
          const cur = f.getSelected();
          input = h('select', {}, h('option', { value: '' }, T('（不选）')), f.getOptions().map(o => h('option', { value: o, selected: o === cur }, o)));
          get = () => input.value;
        } else continue;
        if (f.isReadOnly && f.isReadOnly()) input.disabled = true;
        fields.push({ name, get });
        els.push(h('div', { class: 'opt' }, h('label', {}, name), input));
      }
      if (!fields.length) box.replaceChildren(h('div', { class: 'warn' }, T('这个 PDF 里没有可填写的表单字段。如果只是想在页面上写字，请用“编辑 / 签名”工具。')));
      else box.replaceChildren(h('div', { class: 'note', style: { marginBottom: '12px' } }, T("找到 {0} 个字段", fields.length)), h('div', { class: 'form-fields' }, els));
    }) });
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!bytes || !fields.length) return toast(T('请先选择带表单的 PDF'));
      const doc = await loadLib(bytes);
      const form = doc.getForm();
      const wide = []; // Text fields containing non-Latin characters such as CJK
      for (const { name, get } of fields) {
        const f = form.getField(name), v = get();
        if (f instanceof L.PDFTextField) {
          if (NON_LATIN.test(v)) { f.acroField.setValue(PDFHexString.fromText(v)); wide.push({ f, v }); }
          else f.setText(v);
        } else if (f instanceof L.PDFCheckBox) v ? f.check() : f.uncheck();
        else if (f instanceof L.PDFDropdown || f instanceof L.PDFOptionList) v ? f.select(v) : f.clear();
        else if (f instanceof L.PDFRadioGroup) v ? f.select(v) : f.clear();
      }
      if (flat.value) {
        // CJK content: draw the text as an image at the field position, then remove the field
        const pageOfWidget = new Map();
        doc.getPages().forEach(p => {
          const annots = p.node.Annots();
          if (annots) for (let i = 0; i < annots.size(); i++) pageOfWidget.set(doc.context.lookup(annots.get(i)), p);
        });
        const stamps = [];
        for (const { f, v } of wide) {
          for (const w of f.acroField.getWidgets()) {
            const p = pageOfWidget.get(w.dict);
            if (p && v) stamps.push({ p, r: w.getRectangle(), v });
          }
          f.setText(''); // Clear first, then draw the text after flattening (otherwise the field background covers it)
        }
        form.flatten();
        for (const { p, r, v } of stamps) {
          const size = Math.min(12, r.height * 0.7);
          const { img, w: iw, h: ih } = await embedText(doc, v, { size });
          const s = Math.min(1, (r.width - 4) / iw);
          p.drawImage(img, { x: r.x + 2, y: r.y + (r.height - ih * s) / 2, width: iw * s, height: ih * s });
        }
      } else if (wide.length) {
        // Latin fields get appearances as usual; CJK fields are left for the viewer to render
        try { form.updateFieldAppearances(); } catch (e) { console.warn(e); }
        form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
      }
      let data = await doc.save({ updateFieldAppearances: !wide.length || flat.value });
      if (flat.value) {
        // Flattening removes field objects; copy the pages again to get a clean file structure
        const clean = await PDFDocument.create();
        const src = await loadLib(data);
        for (const pg of src.getPages()) {
          const annots = pg.node.Annots();
          if (!annots) continue;
          const keep = annots.asArray().filter(r => src.context.lookup(r));
          if (keep.length) pg.node.set(PDFName.of('Annots'), src.context.obj(keep));
          else pg.node.delete(PDFName.of('Annots'));
        }
        (await clean.copyPages(src, src.getPageIndices())).forEach(p => clean.addPage(p));
        data = await clean.save();
      }
      await deliver(res, [{ name: baseName(fp.files[0].name) + T('_已填写.pdf'), data }]);
    }) }, T('保存'));
    view.append(...toolHeader(this), card(fp.el), card(box), card(optsGrid(flat), h('div', { class: 'actions' }, run), res));
  },
});

// ================= Compare =================
function esc(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
registerTool({
  id: 'compare', group: T('安全'), name: T('对比 PDF'), desc: T('比较两个版本的 PDF：逐页找出文字的增删，或用图像对比标出变化的位置。'),
  render(view) {
    const A = filePicker({ label: T('旧版本（A）'), preview: 'row' }), B = filePicker({ label: T('新版本（B）'), preview: 'row' });
    const out = h('div');
    const textBox = h('div'), visBox = h('div');
    const mode = seg([['text', T('文字对比')], ['visual', T('图像对比')]], 'text', m => { textBox.hidden = m !== 'text'; visBox.hidden = m !== 'visual'; });
    visBox.hidden = true;
    // Text comparison
    const ocrCmp = ocrOption();
    const runText = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!A.files[0] || !B.files[0]) return toast(T('请选择两个 PDF'));
      const ba = await readBytes(A.files[0]), bb = await readBytes(B.files[0]);
      const { result: [ta, tb], ocrPages } = await withAutoOcr(ocrCmp.value, async () => [await pdfToText(ba, false, { pageBreak: false }), await pdfToText(bb, false, { pageBreak: false })]);
      const n = Math.max(ta.pages.length, tb.pages.length);
      const blocks = [];
      let changed = 0;
      for (let i = 0; i < n; i++) {
        busy(true, T("正在对比 {0}/{1}", i + 1, n), (i + 1) / n);
        const a = ta.pages[i] ?? '', b = tb.pages[i] ?? '';
        if (a === b) continue;
        changed++;
        const parts = a.length + b.length < 30000 ? Diff.diffChars(a, b) : Diff.diffLines(a, b);
        const left = parts.filter(p => !p.added).map(p => p.removed ? `<del>${esc(p.value)}</del>` : esc(p.value)).join('');
        const right = parts.filter(p => !p.removed).map(p => p.added ? `<ins>${esc(p.value)}</ins>` : esc(p.value)).join('');
        blocks.push(h('h3', {}, T("第 {0} 页", i + 1)), h('div', { class: 'cmp' }, h('pre', { html: left || T('<i>（此页不存在）</i>') }), h('pre', { html: right || T('<i>（此页不存在）</i>') })));
      }
      out.replaceChildren(card(
        h('p', {}, changed ? T("共 {0} 页，其中 {1} 页有文字变化。左边是 A（红色=删除），右边是 B（绿色=新增）。", n, changed) : T("两个文件的文字内容完全相同（共 {0} 页）。", n)),
        ocrPages ? h('div', { class: 'note' }, T('已用 OCR 识别了 {0} 页扫描页。', ocrPages), ' ', T('识别结果可能有错字，请检查。')) : null,
        ta.empty || tb.empty ? h('div', { class: 'warn' }, T('其中一个文件没有可提取的文字（可能是扫描件），请开启 OCR 或改用“图像对比”。')) : null,
        ...blocks));
    }) }, T('开始对比'));
    textBox.append(optsGrid(ocrCmp), h('div', { class: 'actions' }, runText));
    // Image comparison
    let ja = null, jb = null;
    const pageNo = optNumber(T('对比第几页'), 1, { min: 1 });
    const runVis = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!A.files[0] || !B.files[0]) return toast(T('请选择两个 PDF'));
      ja = ja?._name === A.files[0].name ? ja : Object.assign(await openJs(await readBytes(A.files[0])), { _name: A.files[0].name });
      jb = jb?._name === B.files[0].name ? jb : Object.assign(await openJs(await readBytes(B.files[0])), { _name: B.files[0].name });
      const i = Math.round(pageNo.value);
      if (i < 1 || i > Math.min(ja.numPages, jb.numPages)) return toast(T("页码超出范围（A 有 {0} 页，B 有 {1} 页）", ja.numPages, jb.numPages));
      const pa = await ja.getPage(i), pb = await jb.getPage(i);
      const va = pa.getViewport({ scale: 1 });
      const s = 900 / va.width;
      const ca = await renderPage(pa, s);
      const vb = pb.getViewport({ scale: 1 });
      const cb = await renderPage(pb, s * va.width / vb.width);
      const W = Math.min(ca.width, cb.width), H = Math.min(ca.height, cb.height);
      const cd = h('canvas', { width: W, height: H });
      const ctx = cd.getContext('2d');
      const da = ca.getContext('2d').getImageData(0, 0, W, H).data, db = cb.getContext('2d').getImageData(0, 0, W, H).data;
      const img = ctx.createImageData(W, H);
      let diff = 0;
      for (let k = 0; k < da.length; k += 4) {
        const d = Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]);
        if (d > 60) { img.data[k] = 230; img.data[k + 1] = 30; img.data[k + 2] = 30; img.data[k + 3] = 255; diff++; }
        else { const g = 255 - (255 - (da[k] + da[k + 1] + da[k + 2]) / 3) * 0.25; img.data[k] = img.data[k + 1] = img.data[k + 2] = g; img.data[k + 3] = 255; }
      }
      ctx.putImageData(img, 0, 0);
      const pct = (diff / (W * H) * 100);
      out.replaceChildren(card(
        h('p', {}, diff ? T("第 {0} 页有变化，红色是不同的地方（约占页面 {1}%）。", i, pct < 0.01 ? '<0.01' : pct.toFixed(2)) : T("第 {0} 页两边看起来完全一样。", i)),
        ca.width !== cb.width || ca.height !== cb.height ? h('div', { class: 'warn' }, T('两页尺寸不同，只对比了重叠部分。')) : null,
        h('div', { class: 'vis-cmp' }, h('div', {}, h('div', { class: 'cap' }, 'A'), ca), h('div', {}, h('div', { class: 'cap' }, 'B'), cb), h('div', {}, h('div', { class: 'cap' }, T('差异')), cd))));
    }) }, T('对比这一页'));
    visBox.append(optsGrid(pageNo), h('div', { class: 'actions' }, runVis));
    view.append(...toolHeader(this), card(h('div', { class: 'opts', style: { gridTemplateColumns: '1fr 1fr' } }, A.el, B.el)), card(mode.el, h('div', { style: { marginTop: '14px' } }, textBox, visBox)), out);
  },
});
