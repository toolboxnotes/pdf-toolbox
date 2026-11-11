// ================= Word / Excel to PDF =================
// Parses .docx / .xlsx in the browser and lays them out as HTML pages (previewable), then:
//   - Print / Save as PDF: the browser's own print, with selectable text (recommended)
//   - Download PDF directly: each page is drawn as an image via SVG foreignObject and assembled into a PDF
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PX = 96 / 72; // pt → px

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const kids = (el, name) => el ? [...el.children].filter(c => !name || c.localName === name) : [];
const kid = (el, name) => kids(el, name)[0] || null;
const wAttr = (el, name) => el ? (el.getAttributeNS(NS_W, name) ?? el.getAttribute('w:' + name)) : null;
const anyAttr = (el, local) => {
  if (!el) return null;
  for (const a of el.attributes) if (a.localName === local) return a.value;
  return null;
};
const deep = (el, name) => el ? [...el.getElementsByTagNameNS('*', name)] : [];
async function zipText(zip, path) { const f = zip.file(path); return f ? f.async('string') : null; }
function relsMap(xml, base) {
  const m = {};
  if (!xml) return m;
  for (const r of parseXml(xml).getElementsByTagName('Relationship')) {
    let t = r.getAttribute('Target');
    if (r.getAttribute('TargetMode') === 'External') { m[r.getAttribute('Id')] = { external: t }; continue; }
    t = t.startsWith('/') ? t.slice(1) : base + t;
    // Resolve ../
    const parts = [];
    for (const p of t.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
    m[r.getAttribute('Id')] = { path: parts.join('/') };
  }
  return m;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
async function zipDataUrl(zip, path) {
  const f = zip.file(path);
  const ext = path.split('.').pop().toLowerCase();
  if (!f || !MIME[ext]) return null;
  return `data:${MIME[ext]};base64,` + await f.async('base64');
}

// ---------- Word: styles ----------
function onOff(el) { if (!el) return undefined; const v = wAttr(el, 'val'); return !(v === '0' || v === 'false' || v === 'off' || v === 'none'); }
function readRPr(rPr) {
  const o = {};
  if (!rPr) return o;
  for (const [k, n] of [['b', 'b'], ['i', 'i'], ['strike', 'strike'], ['caps', 'caps'], ['vanish', 'vanish']]) { const v = onOff(kid(rPr, n)); if (v !== undefined) o[k] = v; }
  const u = kid(rPr, 'u'); if (u) o.u = wAttr(u, 'val') !== 'none';
  const sz = kid(rPr, 'sz'); if (sz) o.sz = +wAttr(sz, 'val') / 2;
  const c = kid(rPr, 'color'); if (c && wAttr(c, 'val') && wAttr(c, 'val') !== 'auto') o.color = '#' + wAttr(c, 'val');
  const hl = kid(rPr, 'highlight'); if (hl && wAttr(hl, 'val') !== 'none') o.bg = wAttr(hl, 'val');
  const shd = kid(rPr, 'shd'); if (shd && wAttr(shd, 'fill') && !/auto/i.test(wAttr(shd, 'fill'))) o.bg = '#' + wAttr(shd, 'fill');
  const va = kid(rPr, 'vertAlign'); if (va) o.va = wAttr(va, 'val');
  const f = kid(rPr, 'rFonts');
  if (f) { const a = wAttr(f, 'ascii') || wAttr(f, 'hAnsi'), e = wAttr(f, 'eastAsia'); if (a) o.font = a; if (e) o.eaFont = e; }
  const rs = kid(rPr, 'rStyle'); if (rs) o.rStyle = wAttr(rs, 'val');
  return o;
}
function readPPr(pPr) {
  const o = {};
  if (!pPr) return o;
  const jc = kid(pPr, 'jc'); if (jc) o.jc = wAttr(jc, 'val');
  const sp = kid(pPr, 'spacing');
  if (sp) {
    if (wAttr(sp, 'before') != null) o.before = +wAttr(sp, 'before') / 20;
    if (wAttr(sp, 'after') != null) o.after = +wAttr(sp, 'after') / 20;
    if (wAttr(sp, 'line') != null) { const r = wAttr(sp, 'lineRule') || 'auto'; o.line = r === 'auto' ? { mult: +wAttr(sp, 'line') / 240 } : { pt: +wAttr(sp, 'line') / 20 }; }
  }
  const ind = kid(pPr, 'ind');
  if (ind) {
    const g = (a, b) => wAttr(ind, a) ?? wAttr(ind, b);
    if (g('left', 'start') != null) o.left = +g('left', 'start') / 20;
    if (g('right', 'end') != null) o.right = +g('right', 'end') / 20;
    if (wAttr(ind, 'firstLine') != null) o.first = +wAttr(ind, 'firstLine') / 20;
    if (wAttr(ind, 'hanging') != null) o.first = -wAttr(ind, 'hanging') / 20;
  }
  const num = kid(pPr, 'numPr');
  if (num) { const id = kid(num, 'numId'), lv = kid(num, 'ilvl'); o.num = { id: id ? wAttr(id, 'val') : null, lvl: lv ? +wAttr(lv, 'val') : 0 }; }
  const pb = onOff(kid(pPr, 'pageBreakBefore')); if (pb !== undefined) o.pageBreak = pb;
  const shd = kid(pPr, 'shd'); if (shd && wAttr(shd, 'fill') && !/auto/i.test(wAttr(shd, 'fill'))) o.bg = '#' + wAttr(shd, 'fill');
  const ps = kid(pPr, 'pStyle'); if (ps) o.pStyle = wAttr(ps, 'val');
  return o;
}
function parseStyles(xml) {
  const S = { styles: {}, defR: {}, defP: {}, defaultPara: null, defaultTable: null };
  if (!xml) return S;
  const doc = parseXml(xml).documentElement;
  const dd = kid(doc, 'docDefaults');
  S.defR = readRPr(kid(kid(dd, 'rPrDefault'), 'rPr'));
  S.defP = readPPr(kid(kid(dd, 'pPrDefault'), 'pPr'));
  for (const st of kids(doc, 'style')) {
    const id = wAttr(st, 'styleId'), type = wAttr(st, 'type');
    const based = kid(st, 'basedOn');
    const tblPr = kid(st, 'tblPr');
    S.styles[id] = { type, name: (wAttr(kid(st, 'name'), 'val') || '').toLowerCase(), basedOn: based ? wAttr(based, 'val') : null, p: readPPr(kid(st, 'pPr')), r: readRPr(kid(st, 'rPr')), borders: tblPr ? tableHasBorders(kid(tblPr, 'tblBorders')) : undefined };
    if (wAttr(st, 'default') === '1' && type === 'paragraph') S.defaultPara = id;
    if (wAttr(st, 'default') === '1' && type === 'table') S.defaultTable = id;
  }
  return S;
}
function styleChain(S, id) {
  const out = [];
  const seen = new Set();
  while (id && S.styles[id] && !seen.has(id)) { seen.add(id); out.unshift(S.styles[id]); id = S.styles[id].basedOn; }
  return out;
}
function tableHasBorders(b) {
  if (!b) return undefined;
  return kids(b).some(e => !['nil', 'none'].includes(wAttr(e, 'val')));
}

// ---------- Word: numbering ----------
function parseNumbering(xml) {
  const N = { abs: {}, nums: {} };
  if (!xml) return N;
  const doc = parseXml(xml).documentElement;
  for (const a of kids(doc, 'abstractNum')) {
    const lv = {};
    for (const l of kids(a, 'lvl')) {
      lv[+wAttr(l, 'ilvl')] = {
        fmt: wAttr(kid(l, 'numFmt'), 'val') || 'decimal', text: wAttr(kid(l, 'lvlText'), 'val') ?? '%1.',
        start: +(wAttr(kid(l, 'start'), 'val') || 1), p: readPPr(kid(l, 'pPr')), r: readRPr(kid(l, 'rPr')),
      };
    }
    N.abs[wAttr(a, 'abstractNumId')] = lv;
  }
  for (const n of kids(doc, 'num')) N.nums[wAttr(n, 'numId')] = wAttr(kid(n, 'abstractNumId'), 'val');
  return N;
}
function fmtNumber(n, fmt) {
  const roman = (x) => { let r = ''; for (const [v, s] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) while (x >= v) { r += s; x -= v; } return r; };
  const letter = (x) => { let s = ''; while (x > 0) { s = String.fromCharCode(97 + (x - 1) % 26) + s; x = Math.floor((x - 1) / 26); } return s; };
  switch (fmt) {
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'lowerLetter': return letter(n);
    case 'upperLetter': return letter(n).toUpperCase();
    case 'decimalZero': return String(n).padStart(2, '0');
    case 'ganada': return '가나다라마바사아자차카타파하'[(n - 1) % 14];
    case 'chineseCounting': case 'ideographTraditional': case 'chineseCountingThousand': case 'taiwaneseCounting': return '一二三四五六七八九十'[(n - 1) % 10] || String(n);
    default: return String(n);
  }
}

// ---------- Word → HTML ----------
async function docxToHtml(bytes) {
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error(T('无法打开这个文件。只支持 .docx（Word 2007 以后的格式），旧的 .doc 请先在 Word 里另存为 .docx')); }
  const docXml = await zipText(zip, 'word/document.xml');
  if (!docXml) throw new Error(T('无法打开这个文件。只支持 .docx（Word 2007 以后的格式），旧的 .doc 请先在 Word 里另存为 .docx'));
  const S = parseStyles(await zipText(zip, 'word/styles.xml'));
  const N = parseNumbering(await zipText(zip, 'word/numbering.xml'));
  const rels = relsMap(await zipText(zip, 'word/_rels/document.xml.rels'), 'word/');
  const body = kid(parseXml(docXml).documentElement, 'body');
  const sect = kid(body, 'sectPr') || deep(body, 'sectPr').pop();
  const pgSz = kid(sect, 'pgSz'), pgMar = kid(sect, 'pgMar');
  const tw = (el, a, d) => (el && wAttr(el, a) != null ? +wAttr(el, a) / 20 : d);
  const page = {
    w: tw(pgSz, 'w', 595.3), h: tw(pgSz, 'h', 841.9),
    top: Math.abs(tw(pgMar, 'top', 72)), bottom: Math.abs(tw(pgMar, 'bottom', 72)), left: tw(pgMar, 'left', 72), right: tw(pgMar, 'right', 72),
  };
  const counters = {};
  const images = new Map();
  let warnings = new Set();
  const imgUrl = async (rid) => {
    const r = rels[rid];
    if (!r || !r.path) return null;
    if (!images.has(r.path)) images.set(r.path, await zipDataUrl(zip, r.path));
    if (!images.get(r.path)) warnings.add('img');
    return images.get(r.path);
  };

  const paraStyle = (pPr) => {
    const own = readPPr(pPr);
    const id = own.pStyle || S.defaultPara;
    const chain = styleChain(S, id);
    const p = Object.assign({}, S.defP, ...chain.map(s => s.p), own);
    const r = Object.assign({}, S.defR, ...chain.map(s => s.r));
    return { p, r, styleName: chain.length ? chain[chain.length - 1].name : '' };
  };
  const runStyle = (base, rPr) => {
    const own = readRPr(rPr);
    const chain = own.rStyle ? styleChain(S, own.rStyle) : [];
    return Object.assign({}, base, ...chain.map(s => s.r), own);
  };
  const applyRun = (el, r) => {
    const st = el.style;
    if (r.b) st.fontWeight = '700';
    if (r.i) st.fontStyle = 'italic';
    const deco = [r.u && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) st.textDecoration = deco;
    if (r.sz) st.fontSize = r.sz + 'pt';
    if (r.color) st.color = r.color;
    if (r.bg) st.backgroundColor = r.bg;
    if (r.caps) st.textTransform = 'uppercase';
    const fams = [r.font, r.eaFont].filter(Boolean).map(f => `"${f}"`);
    if (fams.length) st.fontFamily = fams.join(',') + ',' + OFFICE_FONTS;
    if (r.va === 'superscript' || r.va === 'subscript') { st.verticalAlign = r.va === 'superscript' ? 'super' : 'sub'; st.fontSize = (r.sz || 11) * 0.65 + 'pt'; }
  };

  async function runsInto(container, nodes, baseR, state) {
    for (const n of nodes) {
      const name = n.localName;
      if (['hyperlink', 'smartTag', 'customXml', 'ins', 'fldSimple', 'sdtContent', 'dir', 'bdo'].includes(name)) { await runsInto(container, kids(n), baseR, state); continue; }
      if (name === 'sdt') { await runsInto(container, kids(kid(n, 'sdtContent')), baseR, state); continue; }
      if (name !== 'r') continue;
      const r = runStyle(baseR, kid(n, 'rPr'));
      if (r.vanish) continue;
      for (const c of kids(n)) {
        const cn = c.localName;
        if (cn === 'fldChar') {
          const t = wAttr(c, 'fldCharType');
          if (t === 'begin') state.fld.push('code'); else if (t === 'separate') state.fld[state.fld.length - 1] = 'result'; else if (t === 'end') state.fld.pop();
          continue;
        }
        if (state.fld.length && state.fld[state.fld.length - 1] === 'code') continue; // Field codes themselves are not shown
        if (cn === 't') { const sp = h('span', {}, c.textContent); applyRun(sp, r); container.append(sp); }
        else if (cn === 'tab') container.append(h('span', { class: 'tab' }));
        else if (cn === 'br' || cn === 'cr') {
          if (wAttr(c, 'type') === 'page') state.breakAfter = true; else container.append(h('br'));
        }
        else if (cn === 'noBreakHyphen') container.append('‑');
        else if (cn === 'lastRenderedPageBreak') {}
        else if (cn === 'drawing' || cn === 'pict' || cn === 'object') {
          const blip = deep(c, 'blip')[0] || deep(c, 'imagedata')[0];
          const rid = blip ? anyAttr(blip, 'embed') || anyAttr(blip, 'id') : null;
          const ext = deep(c, 'extent')[0];
          let w = ext ? +ext.getAttribute('cx') / 12700 : 0, hh = ext ? +ext.getAttribute('cy') / 12700 : 0;
          if (!ext) {
            const shape = deep(c, 'shape')[0];
            const m = shape && /width:([\d.]+)pt.*height:([\d.]+)pt/.exec(shape.getAttribute('style') || '');
            if (m) { w = +m[1]; hh = +m[2]; }
          }
          const url = rid ? await imgUrl(rid) : null;
          if (url) container.append(h('img', { src: url, style: { width: w ? w + 'pt' : 'auto', height: hh ? hh + 'pt' : 'auto', maxWidth: '100%', verticalAlign: 'bottom' } }));
          else if (w && hh) { warnings.add('shape'); container.append(h('span', { style: { display: 'inline-block', width: Math.min(w, page.w - page.left - page.right) + 'pt', height: hh + 'pt', border: '1px dashed #bbb' } })); }
        }
        else if (cn === 'sym') { const sp = h('span', {}, '•'); applyRun(sp, r); container.append(sp); } // Symbol fonts (Wingdings etc.) can't be displayed; use a bullet instead
      }
    }
  }

  async function paragraph(p) {
    const { p: pp, r: pr, styleName } = paraStyle(kid(p, 'pPr'));
    const el = h('p', { class: 'w-p' });
    const st = el.style;
    st.marginTop = (pp.before ?? 0) + 'pt';
    st.marginBottom = (pp.after ?? 0) + 'pt';
    if (pp.line) st.lineHeight = pp.line.mult ? (pp.line.mult * 1.17).toFixed(3) : pp.line.pt + 'pt';
    if (pp.left) st.marginLeft = pp.left + 'pt';
    if (pp.right) st.marginRight = pp.right + 'pt';
    if (pp.first) st.textIndent = pp.first + 'pt';
    if (pp.jc) st.textAlign = { both: 'justify', distribute: 'justify', center: 'center', right: 'right', end: 'right', left: 'left', start: 'left' }[pp.jc] || 'left';
    if (pp.bg) st.backgroundColor = pp.bg;
    applyRun(el, pr);
    // Numbering / bullets
    if (pp.num && pp.num.id && pp.num.id !== '0') {
      const lvls = N.abs[N.nums[pp.num.id]];
      const L = lvls && lvls[pp.num.lvl];
      if (L) {
        const c = counters[pp.num.id] = counters[pp.num.id] || {};
        c[pp.num.lvl] = (c[pp.num.lvl] ?? (L.start - 1)) + 1;
        for (const k of Object.keys(c)) if (+k > pp.num.lvl) delete c[k];
        let text = L.fmt === 'bullet' ? (L.text && L.text.charCodeAt(0) < 0xF000 ? L.text : '•') : L.text.replace(/%(\d)/g, (m, d) => fmtNumber(c[d - 1] ?? lvls[d - 1]?.start ?? 1, lvls[d - 1]?.fmt || 'decimal'));
        if (L.fmt === 'none') text = '';
        const left = pp.left ?? L.p.left ?? 0, first = pp.first ?? L.p.first ?? 0;
        st.marginLeft = left + 'pt';
        st.textIndent = first + 'pt';
        const mk = h('span', { class: 'num', style: { display: 'inline-block', minWidth: Math.max(0, -first) + 'pt' } }, text + ' ');
        applyRun(mk, Object.assign({}, pr, L.r));
        el.append(mk);
      }
    }
    const state = { fld: [], breakAfter: false };
    await runsInto(el, kids(p), pr, state);
    if (!el.textContent && !el.querySelector('img,span[style*="dashed"]')) el.append(h('br'));
    if (/^heading [1-9]$|^title$/.test(styleName)) el.dataset.keepNext = '1';
    return { el, breakBefore: !!pp.pageBreak, breakAfter: state.breakAfter };
  }

  async function table(tbl) {
    const tblPr = kid(tbl, 'tblPr');
    const styleId = wAttr(kid(tblPr, 'tblStyle'), 'val') || S.defaultTable;
    const chain = styleChain(S, styleId);
    let borders = tableHasBorders(kid(tblPr, 'tblBorders'));
    if (borders === undefined) for (const s of chain) if (s.borders !== undefined) borders = s.borders;
    const t = h('table', { class: 'w-tbl' + (borders ? ' bordered' : '') });
    const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map(g => +wAttr(g, 'w') / 20);
    if (grid.length) t.append(h('colgroup', {}, grid.map(w => h('col', { style: { width: w + 'pt' } }))));
    const jc = wAttr(kid(tblPr, 'jc'), 'val');
    if (jc === 'center') { t.style.marginLeft = 'auto'; t.style.marginRight = 'auto'; }
    const rows = kids(tbl, 'tr');
    const vm = []; // Vertical merge: track the cell being merged in each column
    for (const tr of rows) {
      const row = h('tr');
      if (kid(kid(tr, 'trPr'), 'tblHeader')) row.dataset.header = '1';
      let col = 0;
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const span = +(wAttr(kid(tcPr, 'gridSpan'), 'val') || 1);
        const vMerge = kid(tcPr, 'vMerge');
        const vmv = vMerge ? (wAttr(vMerge, 'val') || 'continue') : null;
        if (vmv === 'continue' && vm[col]) { vm[col].rowSpan++; col += span; continue; }
        const td = h('td', { colspan: span > 1 ? span : null });
        const shd = kid(tcPr, 'shd');
        if (shd && wAttr(shd, 'fill') && !/auto/i.test(wAttr(shd, 'fill'))) td.style.backgroundColor = '#' + wAttr(shd, 'fill');
        const va = wAttr(kid(tcPr, 'vAlign'), 'val');
        if (va) td.style.verticalAlign = va === 'center' ? 'middle' : va;
        for (const b of await blocks(kids(tc))) td.append(b.el);
        if (!td.childNodes.length) td.append(h('br'));
        row.append(td);
        for (let k = 0; k < span; k++) vm[col + k] = vmv === 'restart' ? td : null;
        col += span;
      }
      t.append(row);
    }
    return { el: t };
  }

  async function blocks(nodes) {
    const out = [];
    for (const n of nodes) {
      if (n.localName === 'p') out.push(await paragraph(n));
      else if (n.localName === 'tbl') out.push(await table(n));
      else if (n.localName === 'sdt') out.push(...await blocks(kids(kid(n, 'sdtContent'))));
      else if (['customXml', 'ins'].includes(n.localName)) out.push(...await blocks(kids(n)));
    }
    return out;
  }
  const list = await blocks(kids(body));
  const base = Object.assign({}, S.defR, ...styleChain(S, S.defaultPara).map(s => s.r));
  return { page, blocks: list, baseFont: base, warnings };
}
const OFFICE_FONTS = '"Calibri","Carlito","Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Microsoft YaHei","PingFang SC","Noto Sans CJK KR","Noto Sans CJK SC",Arial,sans-serif';

// ---------- Excel → HTML ----------
const BUILTIN_FMT = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'yyyy-mm-dd', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'yyyy-mm-dd h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatCell(v, code) {
  if (typeof v !== 'number' || !code || code === 'General') {
    if (typeof v === 'number') return String(+v.toPrecision(11));
    return v;
  }
  const sections = code.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  let sec = sections[0], val = v;
  if (v < 0 && sections[1] != null) { sec = sections[1]; val = -v; }
  else if (v === 0 && sections[2] != null) sec = sections[2];
  let color = null;
  sec = sec.replace(/\[(Red|Blue|Green|Black|White|Yellow|Magenta|Cyan|Color\s*\d+)\]/i, (m, c) => { color = c.toLowerCase(); return ''; }).replace(/\[\$([^\]-]*)(-[^\]]*)?\]/g, '"$1"').replace(/\[[^\]]*\]/g, '');
  const lit = (s) => s.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1').replace(/_./g, ' ').replace(/\*./g, '');
  const raw = sec.replace(/"[^"]*"/g, '');
  if (/[ymdhs]/i.test(raw) && !/[#0]/.test(raw.replace(/\.0+/, ''))) {
    const d = new Date(Math.round((val - 25569) * 86400000));
    const p2 = (x) => String(x).padStart(2, '0');
    const ampm = /AM\/PM/i.test(sec);
    let out = '', i = 0, prevH = false;
    const s = sec;
    while (i < s.length) {
      const rest = s.slice(i);
      let m;
      if ((m = /^"([^"]*)"/.exec(rest))) { out += m[1]; i += m[0].length; continue; }
      if ((m = /^AM\/PM/i.exec(rest))) { out += d.getUTCHours() < 12 ? 'AM' : 'PM'; i += 5; continue; }
      if ((m = /^(y+|m+|d+|h+|s+)/i.exec(rest))) {
        const t = m[1], L = t.length, c = t[0].toLowerCase();
        if (c === 'y') out += L <= 2 ? p2(d.getUTCFullYear() % 100) : d.getUTCFullYear();
        else if (c === 'd') out += L === 1 ? d.getUTCDate() : L === 2 ? p2(d.getUTCDate()) : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
        else if (c === 'h') { const hr = ampm ? (d.getUTCHours() % 12 || 12) : d.getUTCHours(); out += L === 1 ? hr : p2(hr); prevH = true; }
        else if (c === 's') out += p2(d.getUTCSeconds());
        else if (c === 'm') {
          const isMin = prevH || /^m+:?s/i.test(rest) || /^m+\W*s/i.test(rest);
          if (isMin && L <= 2) out += L === 1 ? d.getUTCMinutes() : p2(d.getUTCMinutes());
          else out += L === 1 ? d.getUTCMonth() + 1 : L === 2 ? p2(d.getUTCMonth() + 1) : MONTHS[d.getUTCMonth()];
        }
        if (c !== 'h') prevH = prevH && c === 'm' ? false : prevH && c !== 's';
        i += L; continue;
      }
      if (rest[0] === '\\') { out += rest[1] || ''; i += 2; continue; }
      out += rest[0]; i++;
    }
    return { text: out, color };
  }
  if (/%/.test(raw)) val *= 100;
  const numPart = /[#0?][#0?,]*(\.[#0?]+)?/.exec(raw);
  if (!numPart) return { text: lit(sec), color };
  const dec = numPart[1] ? numPart[1].length - 1 : 0;
  const thousands = /,/.test(numPart[0].split('.')[0]);
  let text;
  if (/E\+/i.test(raw)) text = val.toExponential(dec).toUpperCase().replace('E+', 'E+');
  else {
    text = val.toFixed(dec);
    if (thousands) { const [a, b] = text.split('.'); text = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? '.' + b : ''); }
  }
  const [pre, post] = sec.split(numPart[0]);
  const neg = v < 0 && sections[1] == null ? '-' : '';
  return { text: lit(pre || '') + neg + text + lit(post || '').replace(/%+/, '%'), color };
}
function excelColIndex(ref) { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
async function xlsxToHtml(bytes) {
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error(T('无法打开这个文件。只支持 .xlsx（Excel 2007 以后的格式），旧的 .xls 请先在 Excel 里另存为 .xlsx')); }
  const wbXml = await zipText(zip, 'xl/workbook.xml');
  if (!wbXml) throw new Error(T('无法打开这个文件。只支持 .xlsx（Excel 2007 以后的格式），旧的 .xls 请先在 Excel 里另存为 .xlsx'));
  const wb = parseXml(wbXml).documentElement;
  const date1904 = (kid(wb, 'workbookPr')?.getAttribute('date1904') || '') === '1';
  const rels = relsMap(await zipText(zip, 'xl/_rels/workbook.xml.rels'), 'xl/');
  // Shared strings
  const sst = [];
  const ss = await zipText(zip, 'xl/sharedStrings.xml');
  if (ss) for (const si of kids(parseXml(ss).documentElement, 'si')) sst.push(deep(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join(''));
  // Styles
  const st = { fmts: {}, xfs: [], fonts: [], fills: [], borders: [] };
  const sx = await zipText(zip, 'xl/styles.xml');
  if (sx) {
    const d = parseXml(sx).documentElement;
    for (const f of kids(kid(d, 'numFmts'), 'numFmt')) st.fmts[f.getAttribute('numFmtId')] = f.getAttribute('formatCode');
    const rgb = (el) => { const v = el && el.getAttribute('rgb'); return v ? '#' + v.slice(-6) : null; };
    for (const f of kids(kid(d, 'fonts'), 'font')) st.fonts.push({ b: !!kid(f, 'b') && kid(f, 'b').getAttribute('val') !== '0', i: !!kid(f, 'i'), sz: +(kid(f, 'sz')?.getAttribute('val') || 11), color: rgb(kid(f, 'color')), u: !!kid(f, 'u') });
    for (const f of kids(kid(d, 'fills'), 'fill')) { const p = kid(f, 'patternFill'); st.fills.push(p && p.getAttribute('patternType') === 'solid' ? rgb(kid(p, 'fgColor')) : null); }
    for (const b of kids(kid(d, 'borders'), 'border')) st.borders.push(Object.fromEntries(['left', 'right', 'top', 'bottom'].map(s => [s, !!kid(b, s)?.getAttribute('style')])));
    for (const x of kids(kid(d, 'cellXfs'), 'xf')) {
      const al = kid(x, 'alignment');
      st.xfs.push({ fmt: x.getAttribute('numFmtId') || '0', font: +(x.getAttribute('fontId') || 0), fill: +(x.getAttribute('fillId') || 0), border: +(x.getAttribute('borderId') || 0), h: al?.getAttribute('horizontal'), v: al?.getAttribute('vertical'), wrap: al?.getAttribute('wrapText') === '1' });
    }
  }
  const sheets = [];
  for (const s of kids(kid(wb, 'sheets'), 'sheet')) {
    if (s.getAttribute('state') === 'hidden' || s.getAttribute('state') === 'veryHidden') continue;
    const rid = anyAttr(s, 'id');
    const path = rels[rid]?.path;
    const xml = path && await zipText(zip, path);
    if (!xml) continue;
    const ws = parseXml(xml).documentElement;
    const cells = new Map();
    let maxR = -1, maxC = -1;
    const rowH = {};
    for (const row of kids(kid(ws, 'sheetData'), 'row')) {
      const r = +row.getAttribute('r') - 1;
      if (row.getAttribute('customHeight') === '1') rowH[r] = +row.getAttribute('ht');
      let autoC = 0;
      for (const c of kids(row, 'c')) {
        const ref = c.getAttribute('r');
        const ci = ref ? excelColIndex(ref) : autoC;
        autoC = ci + 1;
        const t = c.getAttribute('t') || 'n', vEl = kid(c, 'v');
        let v = vEl ? vEl.textContent : null;
        if (t === 's') v = sst[+v] ?? '';
        else if (t === 'inlineStr') v = deep(c, 't').map(x => x.textContent).join('');
        else if (t === 'b') v = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'n' && v != null && v !== '') v = +v;
        const xf = st.xfs[+(c.getAttribute('s') || 0)] || {};
        const hasStyle = xf.fill || (st.borders[xf.border] && Object.values(st.borders[xf.border]).some(Boolean));
        if ((v == null || v === '') && !hasStyle) continue;
        cells.set(r + ',' + ci, { v, xf });
        if (v != null && v !== '') { maxR = Math.max(maxR, r); maxC = Math.max(maxC, ci); }
      }
    }
    const merges = kids(kid(ws, 'mergeCells'), 'mergeCell').map(m => {
      const [a, b] = m.getAttribute('ref').split(':');
      return { r0: +a.replace(/\D/g, '') - 1, c0: excelColIndex(a), r1: +(b || a).replace(/\D/g, '') - 1, c1: excelColIndex(b || a) };
    });
    for (const m of merges) if (cells.get(m.r0 + ',' + m.c0)?.v != null) { maxR = Math.max(maxR, m.r1); maxC = Math.max(maxC, m.c1); }
    const widths = [];
    for (const col of kids(kid(ws, 'cols'), 'col')) for (let i = +col.getAttribute('min') - 1; i < +col.getAttribute('max') && i < 512; i++) widths[i] = { w: +col.getAttribute('width'), hidden: col.getAttribute('hidden') === '1' };
    if (maxR < 0) { sheets.push({ name: s.getAttribute('name'), empty: true }); continue; }
    // Start from the first row / column with content or formatting (like Excel printing, without leading empty rows and columns)
    let minR = maxR, minC = maxC;
    for (const k of cells.keys()) { const [r, c] = k.split(',').map(Number); if (r <= maxR && c <= maxC) { minR = Math.min(minR, r); minC = Math.min(minC, c); } }
    const t = h('table', { class: 'x-tbl' });
    const colgroup = h('colgroup');
    let totalW = 0;
    for (let c = minC; c <= maxC; c++) {
      const w = widths[c]?.hidden ? 0 : Math.round(((widths[c]?.w ?? 8.43) * 7 + 5) * 0.75); // Character width → pt
      totalW += w;
      colgroup.append(h('col', { style: { width: w + 'pt' } }));
    }
    t.append(colgroup);
    const covered = new Set();
    for (const m of merges) for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) if (r !== m.r0 || c !== m.c0) covered.add(r + ',' + c);
    for (let r = minR; r <= maxR; r++) {
      const tr = h('tr', { style: rowH[r] ? { height: rowH[r] + 'pt' } : null });
      for (let c = minC; c <= maxC; c++) {
        if (covered.has(r + ',' + c)) continue;
        const cell = cells.get(r + ',' + c);
        const td = h('td');
        const m = merges.find(m => m.r0 === r && m.c0 === c);
        if (m) { if (m.r1 > m.r0) td.rowSpan = m.r1 - m.r0 + 1; if (m.c1 > m.c0) td.colSpan = m.c1 - m.c0 + 1; }
        if (widths[c]?.hidden) td.style.display = 'none';
        if (cell) {
          const xf = cell.xf, font = st.fonts[xf.font] || {};
          let v = cell.v;
          if (typeof v === 'number' && date1904) v += 1462;
          const code = st.fmts[xf.fmt] || BUILTIN_FMT[xf.fmt] || 'General';
          const f = formatCell(v, code);
          const text = f && typeof f === 'object' ? f.text : f; // Empty cells (formatting only) return null
          td.textContent = text ?? '';
          const s2 = td.style;
          if (font.b) s2.fontWeight = '700';
          if (font.i) s2.fontStyle = 'italic';
          if (font.u) s2.textDecoration = 'underline';
          if (font.sz && font.sz !== 11) s2.fontSize = font.sz + 'pt';
          if (font.color && font.color !== '#000000') s2.color = font.color;
          if (f && f.color) s2.color = { red: '#c00', blue: '#00c', green: '#080' }[f.color] || s2.color;
          if (st.fills[xf.fill]) s2.backgroundColor = st.fills[xf.fill];
          const b = st.borders[xf.border];
          if (b) for (const side of ['left', 'right', 'top', 'bottom']) if (b[side]) s2['border' + side[0].toUpperCase() + side.slice(1)] = '0.75pt solid #000';
          s2.textAlign = xf.h && xf.h !== 'general' ? ({ centerContinuous: 'center', fill: 'left', justify: 'justify', distributed: 'center' }[xf.h] || xf.h) : (typeof cell.v === 'number' ? 'right' : 'left');
          if (xf.v) s2.verticalAlign = xf.v === 'center' ? 'middle' : xf.v;
          if (xf.wrap) s2.whiteSpace = 'pre-wrap';
        }
        tr.append(td);
      }
      t.append(tr);
    }
    sheets.push({ name: s.getAttribute('name'), table: t, width: totalW });
  }
  return { sheets };
}

// ---------- Pagination ----------
const PAGE_SIZES = { a4: [595.3, 841.9], letter: [612, 792] };
const OFFICE_CSS = `
.o-page{position:relative;background:#fff;color:#000;box-sizing:border-box;overflow:hidden;font-family:${OFFICE_FONTS};font-size:11pt;line-height:1.17}
.o-page .o-body{position:absolute;overflow:visible;display:flow-root}
.o-page p{margin:0;white-space:pre-wrap;overflow-wrap:break-word}
.o-page .tab{display:inline-block;width:36pt}
.o-page table{border-collapse:collapse;table-layout:fixed}
.o-page .w-tbl td{padding:0 5.4pt;vertical-align:top}
.o-page .w-tbl.bordered td{border:0.75pt solid #000}
.o-page .x-tbl td{padding:1pt 3pt;font-size:10pt;white-space:nowrap;overflow:hidden;border:0.5pt solid #d9d9d9;vertical-align:bottom}
.o-page .x-title{font:600 11pt ${OFFICE_FONTS};margin:0 0 6pt}
.o-page img{display:inline-block}
.o-page .p-sp{overflow:visible}
.o-page .p-tx{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;box-sizing:border-box;overflow-wrap:break-word;line-height:1.2}
.o-page .p-p{margin:0;white-space:pre-wrap}
.o-page .p-tbl{border-collapse:collapse;table-layout:fixed}
.o-page .p-tbl td{border:1pt solid #fff;padding:0;vertical-align:top}
.o-page .p-tbl .p-tx{position:static}
`;
function newPage(spec) {
  const pg = h('div', { class: 'o-page', style: { width: spec.w * PX + 'px', height: spec.h * PX + 'px' } });
  const bodyEl = h('div', { class: 'o-body', style: { left: spec.left * PX + 'px', top: spec.top * PX + 'px', width: (spec.w - spec.left - spec.right) * PX + 'px' } });
  pg.append(bodyEl);
  pg._body = bodyEl;
  pg._limit = (spec.h - spec.top - spec.bottom) * PX;
  return pg;
}
const overflows = (pg) => pg._body.scrollHeight > pg._limit + 1;
// Place blocks on pages in order and start a new page when one doesn't fit; tables are split by row (repeating header rows)
function paginate(host, spec, items) {
  const pages = [];
  let pg = null;
  const fresh = () => { pg = newPage(spec); host.append(pg); pages.push(pg); return pg; };
  fresh();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.breakBefore && pg._body.childNodes.length) fresh();
    pg._body.append(it.el);
    if (overflows(pg)) {
      if (it.el.tagName === 'TABLE') splitTable(it.el);
      else if (pg._body.childNodes.length > 1) {
        // Don't leave a heading at the bottom of a page: move it together with the preceding "keepNext" paragraphs
        const moving = [it.el];
        while (moving[0].previousSibling && moving[0].previousSibling.dataset?.keepNext && pg._body.childNodes.length > moving.length) moving.unshift(moving[0].previousSibling);
        fresh();
        pg._body.append(...moving);
      }
    }
    if (it.breakAfter) fresh();
  }
  function splitTable(t) {
    const rows = [...t.rows];
    const head = rows.filter(r => r.dataset.header);
    const cg = t.querySelector('colgroup');
    for (const r of rows) r.remove();
    let cur = t;
    for (const r of rows) {
      cur.append(r);
      if (!overflows(pg)) continue;
      const own = cur.rows.length - (cur === t ? 0 : head.length);
      if (own <= 1) {
        // Even the first row doesn't fit: start the whole table on the next page (a row taller than a page has to overflow)
        if (cur === t && pg._body.childNodes.length > 1) { t.remove(); fresh(); pg._body.append(t); }
        continue;
      }
      r.remove();
      fresh();
      cur = t.cloneNode(false);
      if (cg) cur.append(cg.cloneNode(true));
      for (const hr of head) cur.append(hr.cloneNode(true));
      pg._body.append(cur);
      cur.append(r);
    }
  }
  return pages;
}

// ---------- Output ----------
// Page → image: SVG foreignObject
async function pageToCanvas(pg, spec, scale) {
  const W = spec.w * PX, H = spec.h * PX;
  const clone = pg.cloneNode(true);
  const xhtml = new XMLSerializer().serializeToString(h('div', {}, h('style', {}, OFFICE_CSS), clone));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${xhtml}</foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'sync';
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(T('页面生成图片失败'))); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
async function pagesToPdf(pages, spec, label) {
  const out = await PDFDocument.create();
  for (let i = 0; i < pages.length; i++) {
    progress(T('正在生成 PDF') + label, i + 1, pages.length);
    const c = await pageToCanvas(pages[i], pages[i]._spec || spec, 2);
    const img = await out.embedJpg(await canvasBytes(c, 'image/jpeg', 0.82));
    const s = pages[i]._spec || spec;
    const p = out.addPage([s.w, s.h]);
    p.drawImage(img, { x: 0, y: 0, width: s.w, height: s.h });
    c.width = c.height = 0;
  }
  return out.save();
}
// Complete HTML for printing; different paper sizes / orientations use named pages (@page names)
function printDocumentHtml(pages, spec, title) {
  const sizes = new Map();
  const body = pages.map(pg => {
    const s = pg._spec || spec;
    const key = `p${Math.round(s.w)}x${Math.round(s.h)}`;
    sizes.set(key, s);
    const c = pg.cloneNode(true);
    c.style.page = key;
    return c.outerHTML;
  }).join('');
  const rules = [...sizes].map(([k, s]) => `@page ${k}{size:${s.w}pt ${s.h}pt;margin:0}`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title.replace(/[<&]/g, '')}</title><style>${OFFICE_CSS}
@page{margin:0}${rules}html,body{margin:0;padding:0}.o-page{break-after:page}</style></head><body>${body}</body></html>`;
}
function printPages(pages, spec, title) {
  const frame = h('iframe', { style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' } });
  document.body.append(frame);
  const d = frame.contentDocument;
  d.open();
  d.write(printDocumentHtml(pages, spec, title));
  d.close();
  const imgs = [...d.images];
  Promise.all(imgs.map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))).then(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  });
}

async function officeToPages(file, host, { size = 'a4', orient = 'auto', titles = true } = {}) {
  const bytes = await readBytes(file);
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'docx') {
    const r = await docxToHtml(bytes);
    const spec = r.page;
    const pages = paginate(host, spec, r.blocks);
    pages.forEach(p => { p._spec = spec; });
    return { pages, spec, warnings: r.warnings };
  }
  if (ext === 'xlsx') {
    const r = await xlsxToHtml(bytes);
    const all = [];
    let spec0 = null;
    for (const sh of r.sheets) {
      if (sh.empty) continue;
      const [a, b] = PAGE_SIZES[size] || PAGE_SIZES.a4;
      const land = orient === 'landscape' || (orient === 'auto' && sh.width > a - 72);
      const spec = { w: land ? b : a, h: land ? a : b, top: 36, bottom: 36, left: 36, right: 36 };
      spec0 = spec0 || spec;
      const avail = spec.w - spec.left - spec.right;
      if (sh.width > avail) sh.table.style.zoom = String(Math.max(0.3, avail / sh.width)); // Scale down to the page width
      const items = [];
      if (titles && r.sheets.length > 1) items.push({ el: h('div', { class: 'x-title' }, sh.name) });
      items.push({ el: sh.table });
      const pages = paginate(host, spec, items);
      pages.forEach(p => { p._spec = spec; });
      all.push(...pages);
    }
    if (!all.length) throw new Error(T('这个表格是空的'));
    return { pages: all, spec: spec0, warnings: new Set() };
  }
  if (ext === 'pptx') return pptxToPages(bytes, host);
  throw new Error(T('不支持的文件类型：{0}', ext));
}

registerTool({
  id: 'office2pdf', group: T('转换'), name: T('Office 转 PDF'), desc: T('把 Word（.docx）、Excel（.xlsx）或 PowerPoint（.pptx）文件转成 PDF，可以先预览。'),
  render(view) {
    const preview = h('div', { class: 'o-preview' });
    const style = h('style', {}, OFFICE_CSS + `.o-preview{display:flex;flex-direction:column;align-items:center;gap:14px;padding:16px;background:#e9e9ec;border-radius:10px;max-height:70vh;overflow:auto}.o-preview .o-page{box-shadow:0 1px 4px rgba(0,0,0,.25);flex:none}`);
    let current = null;
    const size = optSelect(T('纸张（Excel）'), [['a4', 'A4'], ['letter', 'Letter']], 'a4');
    const orient = optSelect(T('方向（Excel）'), [['auto', T('自动（宽表格用横向）')], ['portrait', T('纵向')], ['landscape', T('横向')]], 'auto');
    const titles = optCheck(T('显示工作表名称'), true);
    const info = h('div', { class: 'note', style: { marginTop: '8px' } });
    const res = h('div');
    async function build() {
      const f = fp.files[0];
      preview.replaceChildren();
      current = null;
      if (!f) return;
      await runTask(async () => {
        busy(true, T('正在排版…'));
        const r = await officeToPages(f, preview, { size: size.value, orient: orient.value, titles: titles.value });
        current = { ...r, file: f };
        const w = [];
        if (r.warnings.has('img')) w.push(T('部分图片格式（EMF/WMF 等）无法显示'));
        if (r.warnings.has('shape')) w.push(T('形状、文本框和图表只显示为空白框'));
        if (r.warnings.has('chart')) w.push(T('图表、SmartArt 只显示为空白框'));
        if (r.warnings.has('geom')) w.push(T('少数特殊形状按矩形显示'));
        info.textContent = T('共 {0} 页', r.pages.length) + (w.length ? T('。') + w.join(T('；')) : '');
      });
    }
    const fp = filePicker({ accept: '.docx,.xlsx,.pptx', hint: T('支持 .docx、.xlsx 和 .pptx'), onChange: build });
    for (const o of [size, orient]) o.input.addEventListener('change', build);
    titles.input.addEventListener('change', build);
    if (new URLSearchParams(location.search).has('test')) window.__office = { html: () => current && printDocumentHtml(current.pages, current.spec, 'test') };
    const printBtn = h('button', { class: 'btn primary', onclick: () => {
      if (!current) return toast(T('请先选择文件'));
      printPages(current.pages, current.spec, baseName(current.file.name));
    } }, T('打印 / 另存为 PDF'));
    const dlBtn = h('button', { class: 'btn', onclick: () => runTask(async () => {
      if (!current) return toast(T('请先选择文件'));
      const data = await pagesToPdf(current.pages, current.spec, '');
      await deliver(res, [{ name: baseName(current.file.name) + '.pdf', data }]);
    }) }, T('直接下载 PDF（图片版）'));
    view.append(style, ...toolHeader(this), card(fp.el),
      card(optsGrid(size, orient, titles),
        h('div', { class: 'note', style: { marginTop: '10px' } }, T('推荐“打印 / 另存为 PDF”：在打印窗口里选择“另存为 PDF”，文字可以选中和搜索。“直接下载”每页是图片。排版是在浏览器里重新做的，复杂文档（文本框、图表、页眉页脚、多栏、特殊形状、动画）会和 Office 有差别。')),
        h('div', { class: 'actions' }, printBtn, dlBtn), res, info),
      preview);
  },
});
