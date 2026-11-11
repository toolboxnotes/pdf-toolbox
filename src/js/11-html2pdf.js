// ================= HTML to PDF =================
// Choose an .html file (optionally with the images / CSS it uses) and show it in a sandbox (scripts don't run),
// then print to PDF with the browser (selectable text) or generate an image PDF directly
const HTML_MARGINS = { none: 0, narrow: 10, normal: 20 }; // mm
async function fileDataUrl(f) {
  const b = await readBytes(f);
  const ext = f.name.split('.').pop().toLowerCase();
  const type = f.type || MIME[ext] || (ext === 'css' ? 'text/css' : 'application/octet-stream');
  return `data:${type};base64,` + bytesToB64(b);
}
// Replace references in the HTML to the files chosen alongside it with data URLs
async function prepareHtml(files) {
  const main = files.find(f => /\.html?$/i.test(f.name));
  if (!main) throw new Error(T('请选择一个 .html 文件'));
  const assets = new Map();
  for (const f of files) if (f !== main) assets.set(f.name.toLowerCase(), f);
  const urls = new Map();
  const urlFor = async (ref) => {
    if (!ref || /^(data:|https?:|#|mailto:|javascript:)/i.test(ref.trim())) return null;
    const name = decodeURIComponent(ref.trim().split(/[?#]/)[0].split('/').pop()).toLowerCase();
    const f = assets.get(name);
    if (!f) return null;
    if (!urls.has(name)) urls.set(name, await fileDataUrl(f));
    return urls.get(name);
  };
  const fixCss = async (css) => {
    const parts = [];
    let last = 0;
    for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      const u = await urlFor(m[2]);
      parts.push(css.slice(last, m.index), u ? `url("${u}")` : m[0]);
      last = m.index + m[0].length;
    }
    return parts.join('') + css.slice(last);
  };
  const text = new TextDecoder().decode(await readBytes(main));
  const doc = new DOMParser().parseFromString(text, 'text/html');
  doc.querySelectorAll('script, noscript, iframe, object, embed, base').forEach(e => e.remove());
  for (const l of [...doc.querySelectorAll('link[rel~="stylesheet"]')]) {
    const name = decodeURIComponent((l.getAttribute('href') || '').split(/[?#]/)[0].split('/').pop()).toLowerCase();
    const f = assets.get(name);
    if (f) { const st = doc.createElement('style'); st.textContent = await fixCss(new TextDecoder().decode(await readBytes(f))); l.replaceWith(st); }
  }
  for (const el of doc.querySelectorAll('[src]')) { const u = await urlFor(el.getAttribute('src')); if (u) el.setAttribute('src', u); }
  for (const el of doc.querySelectorAll('image[href], use[href]')) { const u = await urlFor(el.getAttribute('href')); if (u) el.setAttribute('href', u); }
  for (const el of doc.querySelectorAll('[srcset]')) el.removeAttribute('srcset');
  for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', await fixCss(el.getAttribute('style')));
  for (const st of doc.querySelectorAll('style')) st.textContent = await fixCss(st.textContent);
  // External images (URLs) may not show offline or in the image version
  const external = [...doc.querySelectorAll('img[src], link[rel~="stylesheet"]')].some(e => /^https?:/i.test(e.getAttribute('src') || e.getAttribute('href') || ''));
  const missing = [...doc.querySelectorAll('img[src]')].filter(e => !/^(data:|https?:)/i.test(e.getAttribute('src'))).map(e => e.getAttribute('src').split('/').pop());
  return { doc, title: doc.title || baseName(main.name), name: main.name, external, missing: [...new Set(missing)] };
}
function htmlPageSpec(size, orient, margin) {
  const [a, b] = PAGE_SIZES[size] || PAGE_SIZES.a4;
  const m = HTML_MARGINS[margin] ?? 20;
  const mPt = m * 72 / 25.4;
  return orient === 'landscape' ? { w: b, h: a, m: mPt, mm: m } : { w: a, h: b, m: mPt, mm: m };
}
function htmlWithPageCss(doc, spec, bg) {
  const d = doc.cloneNode(true);
  const st = d.createElement('style');
  st.textContent = `@page{size:${spec.w}pt ${spec.h}pt;margin:${spec.mm}mm}` + (bg ? 'html,body,*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}' : '');
  d.head.append(st);
  return '<!DOCTYPE html>\n' + d.documentElement.outerHTML;
}
// Image version: draw the whole page into an SVG foreignObject and slice it by page height
async function htmlToImagePdf(frame, spec, label) {
  const d = frame.contentDocument;
  const W = (spec.w - spec.m * 2) * PX, PH = (spec.h - spec.m * 2) * PX;
  const total = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0);
  // Page breaks: prefer positions between elements (don't cut a line of text in half)
  const edges = [...d.body.querySelectorAll('*')].map(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < PH ? r.bottom + d.documentElement.scrollTop : null; }).filter(v => v != null).sort((a, b) => a - b);
  const starts = [0];
  while (starts[starts.length - 1] + PH < total - 1) {
    const s0 = starts[starts.length - 1];
    let cut = s0 + PH;
    for (const e of edges) if (e > s0 + PH * 0.5 && e <= s0 + PH) cut = Math.ceil(e) + 1;
    starts.push(Math.min(cut, s0 + PH));
  }
  const n = starts.length;
  const clone = d.documentElement.cloneNode(true);
  clone.querySelectorAll('script').forEach(e => e.remove());
  // Background color: the body background is drawn across the whole page
  const bodyBg = d.body ? getComputedStyle(d.body).backgroundColor : '';
  const xhtml = new XMLSerializer().serializeToString(clone);
  const out = await PDFDocument.create();
  const scale = 2;
  for (let i = 0; i < n; i++) {
    progress(T('正在生成 PDF') + label, i + 1, n);
    const sliceH = (i + 1 < n ? starts[i + 1] : total) - starts[i];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${PH * scale}" viewBox="0 ${starts[i]} ${W} ${PH}"><defs><clipPath id="c"><rect x="0" y="${starts[i]}" width="${W}" height="${sliceH}"/></clipPath></defs><g clip-path="url(#c)"><foreignObject x="0" y="0" width="${W}" height="${total}">${xhtml}</foreignObject></g></svg>`;
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(T('页面生成图片失败'))); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const c = document.createElement('canvas');
    const mpx = spec.m * PX * scale;
    c.width = Math.round(spec.w * PX * scale); c.height = Math.round(spec.h * PX * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    if (bodyBg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bodyBg)) { ctx.fillStyle = bodyBg; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(img, mpx, mpx, W * scale, PH * scale);
    const jpg = await out.embedJpg(await canvasBytes(c, 'image/jpeg', 0.85));
    const p = out.addPage([spec.w, spec.h]);
    p.drawImage(jpg, { x: 0, y: 0, width: spec.w, height: spec.h });
    c.width = c.height = 0;
  }
  return out.save();
}

registerTool({
  id: 'html2pdf', group: T('转换'), name: T('HTML 转 PDF'), desc: T('把网页文件（.html）转成 PDF。可以同时选择它用到的图片和 CSS 文件。'),
  render(view) {
    let prepared = null;
    const frame = h('iframe', { sandbox: 'allow-same-origin allow-modals', style: { width: '100%', height: '70vh', border: '0', background: '#fff', display: 'block', margin: '0 auto', boxShadow: '0 1px 4px rgba(0,0,0,.25)' } });
    const wrap = h('div', { hidden: true, style: { background: '#e9e9ec', borderRadius: '10px', padding: '16px' } }, frame);
    const size = optSelect(T('纸张'), [['a4', 'A4'], ['letter', 'Letter']], 'a4');
    const orient = optSelect(T('方向'), [['portrait', T('纵向')], ['landscape', T('横向')]], 'portrait');
    const margin = optSelect(T('页边距'), [['normal', T('普通（20 mm）')], ['narrow', T('窄（10 mm）')], ['none', T('无')]], 'normal');
    const bg = optCheck(T('打印背景颜色和图片'), true);
    const info = h('div', { class: 'note', style: { marginTop: '8px' } });
    const res = h('div');
    const spec = () => htmlPageSpec(size.value, orient.value, margin.value);
    async function show() {
      if (!prepared) return;
      const s = spec();
      frame.style.width = (s.w - s.m * 2) * PX + 'px';
      frame.srcdoc = htmlWithPageCss(prepared.doc, s, bg.value);
      wrap.hidden = false;
      await new Promise(r => { frame.onload = r; });
      const msgs = [];
      if (prepared.missing.length) msgs.push(T('找不到这些文件，请一起选择：{0}', prepared.missing.slice(0, 6).join(', ') + (prepared.missing.length > 6 ? '…' : '')));
      if (prepared.external) msgs.push(T('网页引用了网上的图片或样式：打印版需要联网才能显示，图片版不会显示'));
      info.textContent = msgs.join(T('；'));
    }
    const fp = filePicker({ multiple: true, sortable: false, accept: '.html,.htm,.css,.svg,image/*', hint: T('选择 .html 文件，以及它用到的图片和 CSS（可选）'), onChange: async (files) => {
      prepared = null;
      wrap.hidden = true;
      if (!files.length) return;
      await runTask(async () => { prepared = await prepareHtml(files); await show(); });
    } });
    for (const o of [size, orient, margin]) o.input.addEventListener('change', () => show());
    bg.input.addEventListener('change', () => show());
    const printBtn = h('button', { class: 'btn primary', onclick: () => {
      if (!prepared) return toast(T('请先选择文件'));
      try { frame.contentDocument.title = prepared.title; } catch {}
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } }, T('打印 / 另存为 PDF'));
    const dlBtn = h('button', { class: 'btn', onclick: () => runTask(async () => {
      if (!prepared) return toast(T('请先选择文件'));
      const data = await htmlToImagePdf(frame, spec(), '');
      await deliver(res, [{ name: baseName(prepared.name) + '.pdf', data }]);
    }) }, T('直接下载 PDF（图片版）'));
    view.append(...toolHeader(this), card(fp.el),
      card(optsGrid(size, orient, margin, bg),
        h('div', { class: 'note', style: { marginTop: '10px' } }, T('推荐“打印 / 另存为 PDF”：分页和文字都由浏览器处理，效果最好。网页里的脚本不会运行。“直接下载”每页是图片，分页位置是自动选的。')),
        h('div', { class: 'actions' }, printBtn, dlBtn), res, info),
      wrap);
  },
});
