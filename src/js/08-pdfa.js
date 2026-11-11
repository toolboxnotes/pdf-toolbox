// ================= PDF to PDF/A (PDF/A-2b, long-term archiving format) =================
// What it does: embeds XMP metadata and an sRGB output intent, adds a file ID, and removes disallowed content such as JavaScript, attachments and hidden annotations.
// Pages with non-embedded fonts or CMYK colors can't be fixed in the browser, so those pages are converted to images (or you can convert every page).

// sRGB IEC61966-2.1 color profile (ArgyllCMS, released into the public domain by Graeme W. Gill)
const SRGB_ICC_B64 = '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';

const BAD_ACTIONS = new Set(['JavaScript', 'Launch', 'Sound', 'Movie', 'ResetForm', 'ImportData', 'Hide', 'SetOCGState', 'Rendition', 'Trans', 'GoTo3DView', 'SubmitForm']);
const nameOf = (v) => (v instanceof PDFName ? v.asString().replace(/^\//, '') : '');

// Walk resource dictionaries (including nested resources in Form XObjects and patterns) and call back for each font, image, color space and content stream
function walkResources(ctx, res, cb, seen = new Set()) {
  res = ctx.lookup(res);
  if (!(res instanceof PDFDict) || seen.has(res)) return;
  seen.add(res);
  const sub = (k) => { const d = ctx.lookup(res.get(PDFName.of(k))); return d instanceof PDFDict ? d : null; };
  const fonts = sub('Font');
  if (fonts) for (const [, f] of fonts.entries()) cb.font?.(ctx.lookup(f));
  const cs = sub('ColorSpace');
  if (cs) for (const [, c] of cs.entries()) cb.colorSpace?.(ctx.lookup(c));
  const sh = sub('Shading');
  if (sh) for (const [, c] of sh.entries()) { const d = ctx.lookup(c); const dict = d instanceof PDFRawStream ? d.dict : d; if (dict instanceof PDFDict) cb.colorSpace?.(ctx.lookup(dict.get(PDFName.of('ColorSpace')))); }
  const xo = sub('XObject');
  if (xo) for (const [, x] of xo.entries()) {
    const s = ctx.lookup(x);
    if (!(s instanceof PDFRawStream)) continue;
    const st = nameOf(s.dict.get(PDFName.of('Subtype')));
    if (st === 'Image') cb.colorSpace?.(ctx.lookup(s.dict.get(PDFName.of('ColorSpace'))));
    if (st === 'Form') { cb.content?.(s); walkResources(ctx, s.dict.get(PDFName.of('Resources')), cb, seen); }
  }
  const pat = sub('Pattern');
  if (pat) for (const [, p] of pat.entries()) {
    const s = ctx.lookup(p);
    if (s instanceof PDFRawStream) { cb.content?.(s); walkResources(ctx, s.dict.get(PDFName.of('Resources')), cb, seen); }
  }
}
function fontEmbedded(ctx, f) {
  if (!(f instanceof PDFDict)) return true;
  const st = nameOf(f.get(PDFName.of('Subtype')));
  if (st === 'Type3') return true;
  if (st === 'Type0') {
    const desc = ctx.lookup(f.get(PDFName.of('DescendantFonts')));
    return !(desc instanceof PDFArray) || fontEmbedded(ctx, ctx.lookup(desc.get(0)));
  }
  const fd = ctx.lookup(f.get(PDFName.of('FontDescriptor')));
  if (!(fd instanceof PDFDict)) return false;
  return ['FontFile', 'FontFile2', 'FontFile3'].some(k => fd.has(PDFName.of(k)));
}
function usesCmyk(ctx, c) {
  c = ctx.lookup(c);
  if (c instanceof PDFName) return nameOf(c) === 'DeviceCMYK';
  if (c instanceof PDFArray && c.size()) {
    const kind = nameOf(c.get(0));
    if (kind === 'Indexed') return usesCmyk(ctx, c.get(1));
    if (kind === 'Separation' || kind === 'DeviceN') return usesCmyk(ctx, c.get(2));
    if (kind === 'Pattern' && c.size() > 1) return usesCmyk(ctx, c.get(1));
  }
  return false;
}
function streamText(s) {
  try { return new TextDecoder('latin1').decode(PDFLib.decodePDFRawStream(s).decode()); } catch { return ''; }
}
const CMYK_OP = /(?:^|[\s\]>)])(?:[-+]?(?:\d+\.?\d*|\.\d+)\s+){4}[kK](?=\s|$)|\/DeviceCMYK\b/m;

// Replace CMYK color operators (k / K) in content streams with equivalent RGB (rg / RG), so the page doesn't need to become an image
// Simple lexical scan: skip strings and comments; streams with inline images (BI…EI) are left unchanged
function rewriteCmykOps(src) {
  if (/(^|\s)BI\s/.test(src)) return null;
  const n = src.length, reps = [];
  let nums = [], i = 0;
  const ws = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\0';
  const delim = (c) => '()<>[]{}/%'.includes(c);
  while (i < n) {
    const c = src[i];
    if (ws(c)) { i++; continue; }
    if (c === '%') { while (i < n && src[i] !== '\n' && src[i] !== '\r') i++; nums = []; continue; }
    if (c === '(') { let d = 0; do { if (src[i] === '\\') i++; else if (src[i] === '(') d++; else if (src[i] === ')') d--; i++; } while (i < n && d > 0); nums = []; continue; }
    if (c === '<' && src[i + 1] !== '<') { const e = src.indexOf('>', i); i = e < 0 ? n : e + 1; nums = []; continue; }
    if ('<>[]{}'.includes(c)) { i += (c === '<' || c === '>') && src[i + 1] === c ? 2 : 1; nums = []; continue; }
    let j = i + (c === '/' ? 1 : 0);
    while (j < n && !ws(src[j]) && !delim(src[j])) j++;
    const tok = src.slice(i, j);
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(tok)) { nums.push({ start: i, v: parseFloat(tok) }); if (nums.length > 4) nums.shift(); }
    else {
      if ((tok === 'k' || tok === 'K') && nums.length === 4) {
        const [C, M, Y, K] = nums.map(x => Math.min(1, Math.max(0, x.v)));
        const rgb = [C, M, Y].map(v => +((1 - v) * (1 - K)).toFixed(4));
        reps.push({ from: nums[0].start, to: j, text: `${rgb.join(' ')} ${tok === 'k' ? 'rg' : 'RG'}` });
      }
      nums = [];
    }
    i = j > i ? j : i + 1;
  }
  if (!reps.length) return null;
  let out = '', pos = 0;
  for (const r of reps) { out += src.slice(pos, r.from) + r.text; pos = r.to; }
  return out + src.slice(pos);
}
function convertCmykOperators(doc) {
  const ctx = doc.context;
  const refs = new Set();
  for (const page of doc.getPages()) {
    const c = page.node.get(PDFName.of('Contents'));
    const arr = ctx.lookup(c);
    if (arr instanceof PDFArray) arr.asArray().forEach(r => r instanceof PDFRef && refs.add(r));
    else if (c instanceof PDFRef) refs.add(c);
  }
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const st = nameOf(obj.dict.get(PDFName.of('Subtype')));
      if (st === 'Form' || obj.dict.has(PDFName.of('PatternType'))) refs.add(ref);
    } else if (obj instanceof PDFDict && nameOf(obj.get(PDFName.of('Subtype'))) === 'Type3') {
      const cp = ctx.lookup(obj.get(PDFName.of('CharProcs')));
      if (cp instanceof PDFDict) cp.entries().forEach(([, v]) => v instanceof PDFRef && refs.add(v));
    }
  }
  let count = 0;
  for (const ref of refs) {
    const s = ctx.lookup(ref);
    if (!(s instanceof PDFRawStream)) continue;
    let text;
    try { text = new TextDecoder('latin1').decode(PDFLib.decodePDFRawStream(s).decode()); } catch { continue; }
    if (!/[kK]/.test(text)) continue;
    const out = rewriteCmykOps(text);
    if (out == null) continue;
    const ns = ctx.flateStream(Uint8Array.from(out, ch => ch.charCodeAt(0) & 255));
    for (const [k, v] of s.dict.entries()) if (!['/Filter', '/DecodeParms', '/Length'].includes(k.asString())) ns.dict.set(k, v);
    ctx.assign(ref, ns);
    count++;
  }
  return count;
}

// Find the pages (0-based) that need to become images, and why
function pdfaProblemPages(doc) {
  const ctx = doc.context;
  const bad = new Map();
  doc.getPages().forEach((page, i) => {
    const why = new Set();
    const cb = {
      font: (f) => { if (!fontEmbedded(ctx, f)) why.add('font'); },
      colorSpace: (c) => { if (usesCmyk(ctx, c)) why.add('cmyk'); },
      content: (s) => { if (CMYK_OP.test(streamText(s))) why.add('cmyk'); },
    };
    const contents = ctx.lookup(page.node.get(PDFName.of('Contents')));
    for (const c of contents instanceof PDFArray ? contents.asArray().map(x => ctx.lookup(x)) : [contents]) if (c instanceof PDFRawStream) cb.content(c);
    walkResources(ctx, page.node.Resources(), cb);
    // Annotation appearance streams
    const annots = ctx.lookup(page.node.get(PDFName.of('Annots')));
    if (annots instanceof PDFArray) for (const a of annots.asArray().map(x => ctx.lookup(x))) {
      const ap = a instanceof PDFDict ? ctx.lookup(a.get(PDFName.of('AP'))) : null;
      const n = ap instanceof PDFDict ? ctx.lookup(ap.get(PDFName.of('N'))) : null;
      const streams = n instanceof PDFRawStream ? [n] : n instanceof PDFDict ? n.entries().map(([, v]) => ctx.lookup(v)).filter(v => v instanceof PDFRawStream) : [];
      for (const s of streams) { cb.content(s); walkResources(ctx, s.dict.get(PDFName.of('Resources')), cb); }
    }
    if (why.size) bad.set(i, why);
  });
  return bad;
}

const xmlText = (s) => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const isoDate = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

// Remove content PDF/A doesn't allow from the document; returns the changes made
function pdfaClean(doc) {
  const ctx = doc.context, cat = doc.catalog;
  const done = new Set();
  const isBadAction = (a) => { a = ctx.lookup(a); return a instanceof PDFDict && BAD_ACTIONS.has(nameOf(a.get(PDFName.of('S')))); };
  if (cat.has(PDFName.of('AA'))) { cat.delete(PDFName.of('AA')); done.add('js'); }
  if (cat.has(PDFName.of('OpenAction'))) { if (isBadAction(cat.get(PDFName.of('OpenAction')))) done.add('js'); cat.delete(PDFName.of('OpenAction')); }
  for (const k of ['MarkInfo', 'ViewerPreferences']) { const d = ctx.lookup(cat.get(PDFName.of(k))); if (d instanceof PDFDict) d.delete(PDFName.of('Type')); }
  const names = ctx.lookup(cat.get(PDFName.of('Names')));
  if (names instanceof PDFDict) {
    if (names.has(PDFName.of('JavaScript'))) { names.delete(PDFName.of('JavaScript')); done.add('js'); }
    if (names.has(PDFName.of('EmbeddedFiles'))) { names.delete(PDFName.of('EmbeddedFiles')); done.add('attach'); }
  }
  const form = ctx.lookup(cat.get(PDFName.of('AcroForm')));
  if (form instanceof PDFDict) {
    if (form.has(PDFName.of('XFA'))) { form.delete(PDFName.of('XFA')); done.add('xfa'); }
    form.delete(PDFName.of('NeedAppearances'));
  }
  cat.delete(PDFName.of('NeedsRendering'));
  // Optional content (layers): the default config must have a name and no AS
  const oc = ctx.lookup(cat.get(PDFName.of('OCProperties')));
  if (oc instanceof PDFDict) {
    const cfgs = [ctx.lookup(oc.get(PDFName.of('D')))];
    const more = ctx.lookup(oc.get(PDFName.of('Configs')));
    if (more instanceof PDFArray) cfgs.push(...more.asArray().map(x => ctx.lookup(x)));
    cfgs.forEach((c, i) => {
      if (!(c instanceof PDFDict)) return;
      if (!c.has(PDFName.of('Name'))) c.set(PDFName.of('Name'), PDFHexString.fromText(i ? 'Config ' + i : 'Default'));
      c.delete(PDFName.of('AS'));
    });
  }
  // Pages and annotations
  for (const page of doc.getPages()) {
    const node = page.node;
    if (node.has(PDFName.of('AA'))) { node.delete(PDFName.of('AA')); done.add('js'); }
    const annots = ctx.lookup(node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    const keep = [];
    for (const ref of annots.asArray()) {
      const a = ctx.lookup(ref);
      if (!(a instanceof PDFDict)) continue;
      const st = nameOf(a.get(PDFName.of('Subtype')));
      if (['Sound', 'Movie', 'Screen', '3D', 'RichMedia', 'FileAttachment'].includes(st)) { done.add('annot'); continue; }
      const ap = ctx.lookup(a.get(PDFName.of('AP')));
      if (!(ap instanceof PDFDict) && !['Link', 'Popup'].includes(st)) { done.add('annot'); continue; } // Annotations without an appearance
      if (ap instanceof PDFDict) { ap.delete(PDFName.of('D')); ap.delete(PDFName.of('R')); }
      if (st !== 'Popup') {
        const f = ctx.lookup(a.get(PDFName.of('F')));
        const flags = f instanceof PDFNumber ? f.asNumber() : 0;
        a.set(PDFName.of('F'), PDFNumber.of((flags | 4) & ~(1 | 2 | 32)));
      }
      if (a.has(PDFName.of('AA'))) { a.delete(PDFName.of('AA')); done.add('js'); }
      if (a.has(PDFName.of('A')) && isBadAction(a.get(PDFName.of('A')))) { a.delete(PDFName.of('A')); done.add('js'); }
      keep.push(ref);
    }
    if (keep.length !== annots.size()) node.set(PDFName.of('Annots'), ctx.obj(keep));
  }
  // Images, forms, graphics states
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    const d = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (!d) continue;
    const type = nameOf(d.get(PDFName.of('Type'))), st = nameOf(d.get(PDFName.of('Subtype')));
    if (st === 'Image') { d.delete(PDFName.of('Interpolate')); d.delete(PDFName.of('Alternates')); d.delete(PDFName.of('OPI')); }
    if (st === 'Form') { d.delete(PDFName.of('OPI')); }
    if (type === 'ExtGState' || d.has(PDFName.of('TR')) || d.has(PDFName.of('TR2'))) {
      for (const k of ['TR', 'TR2']) { const v = d.get(PDFName.of(k)); if (v && nameOf(v) !== 'Default') d.delete(PDFName.of(k)); }
      d.delete(PDFName.of('HTP'));
    }
    if (type === 'Action' && nameOf(d.get(PDFName.of('S'))) === 'JavaScript') done.add('js');
  }
  return done;
}

function pdfaMetadata(doc, title) {
  const ctx = doc.context;
  const now = new Date();
  const created = (() => { try { return doc.getCreationDate(); } catch { return undefined; } })() || now;
  const info = {
    title: (() => { try { return doc.getTitle(); } catch { return ''; } })() || title,
    author: (() => { try { return doc.getAuthor(); } catch { return ''; } })() || '',
    subject: (() => { try { return doc.getSubject(); } catch { return ''; } })() || '',
    keywords: (() => { try { return doc.getKeywords(); } catch { return ''; } })() || '',
    creator: (() => { try { return doc.getCreator(); } catch { return ''; } })() || 'PDF Toolbox',
  };
  // The Info dictionary and XMP must match: rewrite both with the same values
  const infoDict = ctx.obj({});
  ctx.trailerInfo.Info = ctx.register(infoDict);
  doc.setTitle(info.title);
  if (info.author) doc.setAuthor(info.author);
  if (info.subject) doc.setSubject(info.subject);
  if (info.keywords) infoDict.set(PDFName.of('Keywords'), PDFHexString.fromText(info.keywords));
  doc.setCreator(info.creator);
  doc.setProducer('PDF Toolbox');
  doc.setCreationDate(created);
  doc.setModificationDate(now);
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(info.title)}</rdf:li></rdf:Alt></dc:title>
${info.author ? `   <dc:creator><rdf:Seq><rdf:li>${xmlText(info.author)}</rdf:li></rdf:Seq></dc:creator>\n` : ''}${info.subject ? `   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(info.subject)}</rdf:li></rdf:Alt></dc:description>\n` : ''}${info.keywords ? `   <pdf:Keywords>${xmlText(info.keywords)}</pdf:Keywords>\n` : ''}   <xmp:CreatorTool>${xmlText(info.creator)}</xmp:CreatorTool>
   <xmp:CreateDate>${isoDate(created)}</xmp:CreateDate>
   <xmp:ModifyDate>${isoDate(now)}</xmp:ModifyDate>
   <xmp:MetadataDate>${isoDate(now)}</xmp:MetadataDate>
   <pdf:Producer>PDF Toolbox</pdf:Producer>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
${' '.repeat(100).concat('\n').repeat(20)}<?xpacket end="w"?>`;
  const meta = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(meta));
  // Output intent: sRGB
  const icc = ctx.flateStream(b64ToBytes(SRGB_ICC_B64), { N: 3 });
  const oi = ctx.obj({
    Type: 'OutputIntent', S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'), DestOutputProfile: ctx.register(icc),
  });
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(oi)]));
  // File ID
  const id = ctx.lookup(ctx.trailerInfo.ID);
  if (!(id instanceof PDFArray) || id.size() < 2) {
    const r = PDFHexString.of(toHex(crypto.getRandomValues(new Uint8Array(16))));
    ctx.trailerInfo.ID = ctx.obj([r, r]);
  }
}

async function convertToPdfa(bytes, { mode = 'auto', title = '', label = '' } = {}) {
  let doc;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) {
    if (/ignoreEncryption|is encrypted/i.test(String(e && e.message))) throw new Error(T('这个 PDF 有密码保护，请先用“解密 PDF”去掉密码'));
    throw e;
  }
  const n = doc.getPageCount();
  let raster = new Set();
  const reasons = new Set();
  if (mode !== 'image') convertCmykOperators(doc);
  if (mode === 'image') raster = new Set([...Array(n).keys()]);
  else for (const [i, why] of pdfaProblemPages(doc)) { raster.add(i); why.forEach(w => reasons.add(w)); }
  if (raster.size) {
    const src = mode === 'image' ? bytes : await doc.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
    const out = await rasterizePdf(src, { dpi: 200, format: 'jpg', quality: 0.88, only: raster.size === n ? null : raster, label: T('正在转换页面') + label });
    doc = await PDFDocument.load(out, { updateMetadata: false });
  }
  busy(true, T('正在写入 PDF/A 信息…'));
  const done = pdfaClean(doc);
  pdfaMetadata(doc, title);
  const data = await doc.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
  return { data, rasterPages: mode === 'image' ? 0 : raster.size, reasons, done };
}

registerTool({
  id: 'pdfa', group: T('转换'), name: T('PDF 转 PDF/A'), desc: T('转成适合长期存档的 PDF/A-2b 格式（政府、法院、档案提交常用）。'),
  render(view) {
    const fp = filePicker({ multiple: true, sortable: false });
    const descs = {
      auto: T('文字保持可选。CMYK 颜色自动换成 RGB；字体没有嵌入或有 CMYK 图片的页面会转成图片，其余页面不变。'),
      image: T('所有页面都转成图片，最容易通过检查，但文字不能再选中和搜索。'),
    };
    const desc = h('div', { class: 'note', style: { marginTop: '10px' } }, descs.auto);
    const mode = seg([['auto', T('保留文字（推荐）')], ['image', T('全部转为图片')]], 'auto', v => desc.textContent = descs[v]);
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!fp.files.length) return toast(T('请先选择 PDF'));
      const outputs = [], notes = [];
      for (const f of fp.files) {
        const r = await convertToPdfa(await readBytes(f), { mode: mode.value, title: baseName(f.name), label: fp.files.length > 1 ? ' ' + f.name : '' });
        outputs.push({ name: baseName(f.name) + '_PDFA.pdf', data: r.data });
        const parts = [];
        if (r.rasterPages) parts.push(T('{0} 页转成了图片（{1}）', r.rasterPages, [...r.reasons].map(x => ({ font: T('字体没有嵌入'), cmyk: T('使用 CMYK 颜色') }[x])).join(T('、'))));
        const map = { js: T('删除了 JavaScript 和自动动作'), attach: T('删除了附件'), xfa: T('删除了 XFA 动态表单'), annot: T('删除了不能显示的注释') };
        for (const k of r.done) parts.push(map[k]);
        if (parts.length) notes.push(`${f.name}${T('：')}${parts.join(T('；'))}`);
      }
      await deliver(res, outputs, 'PDFA.zip');
      res.append(h('div', { class: 'note', style: { marginTop: '6px' } }, ...notes.map(n => h('div', {}, n)),
        h('div', {}, T('提交前建议用 veraPDF 或 Acrobat 的“印前检查”再确认一次。'))));
    }) }, T('转换'));
    view.append(...toolHeader(this), card(fp.el), card(mode.el, desc, h('div', { class: 'actions' }, run), res));
  },
});
