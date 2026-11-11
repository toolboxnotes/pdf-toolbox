// ================= PowerPoint (.pptx) to PDF =================
// Parses slides → masters / layouts / themes and draws them as positioned HTML (one page per slide), then prints or makes an image PDF like Word / Excel
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const EMU = 12700; // EMU → pt
const aAttr = (el, n) => (el ? el.getAttribute(n) : null);
const firstDeep = (el, name) => (el ? el.getElementsByTagNameNS('*', name)[0] || null : null);

// ---------- Colors ----------
function hexToHsl(hex) {
  const n = parseInt(hex, 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh / 6, s, l];
}
function hslToHex([hh, s, l]) {
  const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  let r, g, b;
  if (!s) r = g = b = l;
  else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = f(p, q, hh + 1 / 3); g = f(p, q, hh); b = f(p, q, hh - 1 / 3); }
  return [r, g, b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}
const PRESET_COLORS = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', darkBlue: '00008B', lightGray: 'D3D3D3' };
// Color elements (srgbClr / schemeClr / sysClr / prstClr) → CSS color
function pptColor(el, ctx) {
  if (!el) return null;
  let hex = null;
  const n = el.localName;
  if (n === 'srgbClr') hex = aAttr(el, 'val');
  else if (n === 'sysClr') hex = aAttr(el, 'lastClr') || (aAttr(el, 'val') === 'window' ? 'FFFFFF' : '000000');
  else if (n === 'prstClr') hex = PRESET_COLORS[aAttr(el, 'val')] || '000000';
  else if (n === 'schemeClr') {
    let v = aAttr(el, 'val');
    if (v === 'phClr') return ctx.phClr || null;
    v = ctx.clrMap[v] || v;
    hex = ctx.theme.colors[v] || '000000';
  } else if (n === 'scrgbClr') hex = ['r', 'g', 'b'].map(k => Math.round(+aAttr(el, k) / 100000 * 255).toString(16).padStart(2, '0')).join('');
  else return null;
  let alpha = 1;
  let hsl = null;
  for (const m of el.children) {
    const v = +aAttr(m, 'val') / 100000;
    switch (m.localName) {
      case 'lumMod': hsl = hsl || hexToHsl(hex); hsl[2] *= v; break;
      case 'lumOff': hsl = hsl || hexToHsl(hex); hsl[2] += v; break;
      case 'satMod': hsl = hsl || hexToHsl(hex); hsl[1] *= v; break;
      case 'tint': hsl = hsl || hexToHsl(hex); hsl[2] = hsl[2] + (1 - hsl[2]) * (1 - v); break;
      case 'shade': hsl = hsl || hexToHsl(hex); hsl[2] *= v; break;
      case 'alpha': alpha = v; break;
    }
    if (hsl && m.localName !== 'alpha') { hex = hslToHex(hsl); hsl = null; }
  }
  if (alpha < 1) { const x = parseInt(hex, 16); return `rgba(${x >> 16 & 255},${x >> 8 & 255},${x & 255},${alpha.toFixed(3)})`; }
  return '#' + hex;
}
const colorChild = (fill) => fill ? [...fill.children].find(c => /Clr$/.test(c.localName)) : null;

// ---------- Theme ----------
function parseTheme(xml) {
  const t = { colors: {}, major: 'Calibri Light', minor: 'Calibri', majorEa: '', minorEa: '' };
  if (!xml) return t;
  const d = parseXml(xml).documentElement;
  const cs = firstDeep(d, 'clrScheme');
  if (cs) for (const c of cs.children) { const x = c.firstElementChild; if (x) t.colors[c.localName] = x.localName === 'sysClr' ? (aAttr(x, 'lastClr') || '000000') : aAttr(x, 'val'); }
  const font = (k) => { const f = firstDeep(d, k); return f ? { latin: aAttr(firstDeep(f, 'latin'), 'typeface') || '', ea: aAttr(firstDeep(f, 'ea'), 'typeface') || '' } : null; };
  const mj = font('majorFont'), mn = font('minorFont');
  if (mj) { t.major = mj.latin || t.major; t.majorEa = mj.ea; }
  if (mn) { t.minor = mn.latin || t.minor; t.minorEa = mn.ea; }
  return t;
}
function readClrMap(el) {
  const m = {};
  if (el) for (const a of el.attributes) m[a.name] = a.value;
  return m;
}

// ---------- Text styles (lstStyle / txStyles) ----------
function readLvl(lvlPPr, ctx) {
  if (!lvlPPr) return {};
  const o = {};
  if (aAttr(lvlPPr, 'algn')) o.algn = aAttr(lvlPPr, 'algn');
  if (aAttr(lvlPPr, 'marL') != null) o.marL = +aAttr(lvlPPr, 'marL') / EMU;
  if (aAttr(lvlPPr, 'indent') != null) o.indent = +aAttr(lvlPPr, 'indent') / EMU;
  const ls = firstDeep(kid(lvlPPr, 'lnSpc'), 'spcPct'); if (ls) o.lnSpc = +aAttr(ls, 'val') / 100000;
  const lsp = firstDeep(kid(lvlPPr, 'lnSpc'), 'spcPts'); if (lsp) o.lnPts = +aAttr(lsp, 'val') / 100;
  const sb = firstDeep(kid(lvlPPr, 'spcBef'), 'spcPts'); if (sb) o.spcBef = +aAttr(sb, 'val') / 100;
  const sbp = firstDeep(kid(lvlPPr, 'spcBef'), 'spcPct'); if (sbp) o.spcBefPct = +aAttr(sbp, 'val') / 100000;
  const sa = firstDeep(kid(lvlPPr, 'spcAft'), 'spcPts'); if (sa) o.spcAft = +aAttr(sa, 'val') / 100;
  if (kid(lvlPPr, 'buNone')) o.bu = { none: true };
  const bc = kid(lvlPPr, 'buChar'); if (bc) o.bu = { char: aAttr(bc, 'char') };
  const ba = kid(lvlPPr, 'buAutoNum'); if (ba) o.bu = { auto: aAttr(ba, 'type') || 'arabicPeriod', start: +(aAttr(ba, 'startAt') || 1) };
  const bclr = colorChild(kid(lvlPPr, 'buClr')); if (bclr) o.buColor = pptColor(bclr, ctx);
  const d = kid(lvlPPr, 'defRPr');
  if (d) o.r = readPptRPr(d, ctx);
  return o;
}
function readPptRPr(rPr, ctx) {
  const o = {};
  if (!rPr) return o;
  if (aAttr(rPr, 'sz')) o.sz = +aAttr(rPr, 'sz') / 100;
  if (aAttr(rPr, 'b') != null) o.b = aAttr(rPr, 'b') === '1' || aAttr(rPr, 'b') === 'true';
  if (aAttr(rPr, 'i') != null) o.i = aAttr(rPr, 'i') === '1' || aAttr(rPr, 'i') === 'true';
  if (aAttr(rPr, 'u') && aAttr(rPr, 'u') !== 'none') o.u = true;
  if (aAttr(rPr, 'strike') && aAttr(rPr, 'strike') !== 'noStrike') o.strike = true;
  if (aAttr(rPr, 'cap') === 'all') o.caps = true;
  if (aAttr(rPr, 'baseline')) o.baseline = +aAttr(rPr, 'baseline') / 1000;
  const f = kid(rPr, 'solidFill'); if (f) o.color = pptColor(colorChild(f), ctx);
  const hl = kid(rPr, 'highlight'); if (hl) o.bg = pptColor(colorChild(hl), ctx);
  const lat = kid(rPr, 'latin'), ea = kid(rPr, 'ea');
  if (lat) o.font = aAttr(lat, 'typeface');
  if (ea) o.eaFont = aAttr(ea, 'typeface');
  return o;
}
function readListStyle(lst, ctx) {
  const out = {};
  if (!lst) return out;
  for (const c of lst.children) { const m = /^lvl(\d)pPr$/.exec(c.localName); if (m) out[+m[1] - 1] = readLvl(c, ctx); }
  const def = kid(lst, 'defPPr'); if (def) out.def = readLvl(def, ctx);
  return out;
}
const fontName = (f, ctx) => !f ? '' : f === '+mj-lt' ? ctx.theme.major : f === '+mn-lt' ? ctx.theme.minor : f === '+mj-ea' ? ctx.theme.majorEa : f === '+mn-ea' ? ctx.theme.minorEa : f;

// ---------- Placeholders ----------
function phInfo(sp) {
  const ph = firstDeep(kid(kid(sp, 'nvSpPr') || kid(sp, 'nvPicPr') || kid(sp, 'nvGraphicFramePr'), 'nvPr'), 'ph');
  if (!ph) return null;
  return { type: aAttr(ph, 'type') || 'body', idx: aAttr(ph, 'idx') };
}
function findPh(tree, info) {
  if (!tree || !info) return null;
  const all = [...tree.getElementsByTagNameNS('*', 'sp')];
  const norm = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t);
  return all.find(s => { const p = phInfo(s); return p && info.idx != null && p.idx === info.idx; })
    || all.find(s => { const p = phInfo(s); return p && p.type === info.type; })
    || all.find(s => { const p = phInfo(s); return p && norm(p.type) === norm(info.type); }) || null;
}
function xfrmOf(el) {
  const x = kid(kid(el, 'spPr') || kid(el, 'grpSpPr'), 'xfrm') || kid(el, 'xfrm');
  if (!x) return null;
  const off = kid(x, 'off'), ext = kid(x, 'ext');
  if (!off || !ext) return null;
  return {
    x: +aAttr(off, 'x') / EMU, y: +aAttr(off, 'y') / EMU, w: +aAttr(ext, 'cx') / EMU, h: +aAttr(ext, 'cy') / EMU,
    rot: +(aAttr(x, 'rot') || 0) / 60000, flipH: aAttr(x, 'flipH') === '1', flipV: aAttr(x, 'flipV') === '1',
    chOff: kid(x, 'chOff') ? { x: +aAttr(kid(x, 'chOff'), 'x') / EMU, y: +aAttr(kid(x, 'chOff'), 'y') / EMU } : null,
    chExt: kid(x, 'chExt') ? { w: +aAttr(kid(x, 'chExt'), 'cx') / EMU, h: +aAttr(kid(x, 'chExt'), 'cy') / EMU } : null,
  };
}

// ---------- Shapes ----------
function fillCss(spPr, ctx) {
  if (!spPr) return undefined;
  if (kid(spPr, 'noFill')) return 'transparent';
  const sf = kid(spPr, 'solidFill'); if (sf) return pptColor(colorChild(sf), ctx);
  const gf = kid(spPr, 'gradFill');
  if (gf) {
    const stops = [...gf.getElementsByTagNameNS('*', 'gs')].map(g => `${pptColor(colorChild(g), ctx)} ${+aAttr(g, 'pos') / 1000}%`);
    const lin = kid(gf, 'lin');
    const ang = lin ? +aAttr(lin, 'ang') / 60000 + 90 : 180;
    if (stops.length) return `linear-gradient(${ang}deg, ${stops.join(', ')})`;
  }
  return undefined;
}
function lineCss(spPr, ctx) {
  const ln = kid(spPr, 'ln');
  if (!ln) return undefined;
  if (kid(ln, 'noFill')) return 'none';
  const sf = kid(ln, 'solidFill');
  if (!sf) return undefined;
  const w = Math.max(0.5, +(aAttr(ln, 'w') || 12700) / EMU);
  const dash = aAttr(kid(ln, 'prstDash'), 'val');
  return `${w}pt ${dash && dash !== 'solid' ? 'dashed' : 'solid'} ${pptColor(colorChild(sf), ctx)}`;
}
// Shapes referencing theme styles (fillRef / lnRef / fontRef in p:style)
function styleRefs(sp, ctx) {
  const st = kid(sp, 'style');
  if (!st) return {};
  const ref = (n) => { const r = kid(st, n); return r && +aAttr(r, 'idx') > 0 ? pptColor(colorChild(r), ctx) : null; };
  const fr = kid(st, 'fontRef');
  return { fill: ref('fillRef'), line: ref('lnRef'), font: fr ? pptColor(colorChild(fr), ctx) : null };
}
const GEOM_RADIUS = { ellipse: '50%', roundRect: '12%', flowChartTerminator: '50%', snip1Rect: '0', round2SameRect: '12% 12% 0 0', flowChartAlternateProcess: '12%' };
function pptPlace(el, b) {
  Object.assign(el.style, { position: 'absolute', left: b.x + 'pt', top: b.y + 'pt', width: Math.max(0, b.w) + 'pt', height: Math.max(0, b.h) + 'pt', boxSizing: 'border-box' });
  const tf = [];
  if (b.rot) tf.push(`rotate(${b.rot}deg)`);
  if (b.flipH) tf.push('scaleX(-1)');
  if (b.flipV) tf.push('scaleY(-1)');
  if (tf.length) el.style.transform = tf.join(' ');
}
const AUTO_NUM = (type, n) => {
  const base = type.replace(/(Period|ParenR|ParenBoth|Plain|Minus)$/, '');
  const suf = /ParenBoth$/.test(type) ? ')' : /ParenR$/.test(type) ? ')' : /Period$/.test(type) ? '.' : '';
  const pre = /ParenBoth$/.test(type) ? '(' : '';
  const v = { arabic: String(n), alphaLc: fmtNumber(n, 'lowerLetter'), alphaUc: fmtNumber(n, 'upperLetter'), romanLc: fmtNumber(n, 'lowerRoman'), romanUc: fmtNumber(n, 'upperRoman'), circleNumDbPlain: String.fromCharCode(0x2460 + n - 1) }[base] || String(n);
  return pre + v + suf;
};

// ---------- Geometry (custom paths and common presets) → SVG ----------
const POLY = { // Polygon vertices in a unit box
  triangle: [[.5, 0], [1, 1], [0, 1]], rtTriangle: [[0, 0], [1, 1], [0, 1]], diamond: [[.5, 0], [1, .5], [.5, 1], [0, .5]],
  hexagon: [[.25, 0], [.75, 0], [1, .5], [.75, 1], [.25, 1], [0, .5]], octagon: [[.29, 0], [.71, 0], [1, .29], [1, .71], [.71, 1], [.29, 1], [0, .71], [0, .29]],
  parallelogram: [[.25, 0], [1, 0], [.75, 1], [0, 1]], trapezoid: [[.25, 0], [.75, 0], [1, 1], [0, 1]], pentagon: [[.5, 0], [1, .38], [.81, 1], [.19, 1], [0, .38]],
  homePlate: [[0, 0], [.8, 0], [1, .5], [.8, 1], [0, 1]], chevron: [[0, 0], [.8, 0], [1, .5], [.8, 1], [0, 1], [.2, .5]],
  rightArrow: [[0, .25], [.7, .25], [.7, 0], [1, .5], [.7, 1], [.7, .75], [0, .75]], leftArrow: [[1, .25], [.3, .25], [.3, 0], [0, .5], [.3, 1], [.3, .75], [1, .75]],
  upArrow: [[.25, 1], [.25, .3], [0, .3], [.5, 0], [1, .3], [.75, .3], [.75, 1]], downArrow: [[.25, 0], [.25, .7], [0, .7], [.5, 1], [1, .7], [.75, .7], [.75, 0]],
  star5: [[.5, 0], [.62, .38], [1, .38], [.69, .62], [.81, 1], [.5, .76], [.19, 1], [.31, .62], [0, .38], [.38, .38]],
  plus: [[.33, 0], [.67, 0], [.67, .33], [1, .33], [1, .67], [.67, .67], [.67, 1], [.33, 1], [.33, .67], [0, .67], [0, .33], [.33, .33]],
  flowChartDecision: [[.5, 0], [1, .5], [.5, 1], [0, .5]], flowChartInputOutput: [[.2, 0], [1, 0], [.8, 1], [0, 1]],
};
const CURVES = { // Presets with curves
  flowChartDocument: (W, H) => `M0 0H${W}V${H * 0.806}C${W * 0.75} ${H * 0.65} ${W * 0.5} ${H * 0.75} ${W * 0.25} ${H * 0.9}C${W * 0.15} ${H * 0.96} ${W * 0.05} ${H} 0 ${H * 0.97}Z`,
  wave: (W, H) => `M0 ${H * 0.1}C${W * 0.33} ${-H * 0.1} ${W * 0.66} ${H * 0.3} ${W} ${H * 0.1}V${H * 0.9}C${W * 0.66} ${H * 1.1} ${W * 0.33} ${H * 0.7} 0 ${H * 0.9}Z`,
  line: (W, H) => `M0 0L${W} ${H}`,
  straightConnector1: (W, H) => `M0 0L${W} ${H}`,
  can: (W, H) => `M0 ${H * 0.1}A${W / 2} ${H * 0.1} 0 0 1 ${W} ${H * 0.1}V${H * 0.9}A${W / 2} ${H * 0.1} 0 0 1 0 ${H * 0.9}Z`,
};
// Shape guides: built-in names + avLst / gdLst formulas
function geomGuides(cg, wE, hE) {
  const v = { w: wE, h: hE, l: 0, t: 0, r: wE, b: hE, hc: wE / 2, vc: hE / 2, ss: Math.min(wE, hE), ls: Math.max(wE, hE),
    cd2: 10800000, cd4: 5400000, cd8: 2700000, '3cd4': 16200000, '3cd8': 8100000, '5cd8': 13500000, '7cd8': 18900000 };
  for (const k of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) { v['wd' + k] = wE / k; v['hd' + k] = hE / k; v['ssd' + k] = v.ss / k; }
  const val = (x) => (x in v ? v[x] : +x);
  const ang = (x) => x / 60000 * Math.PI / 180;
  for (const list of ['avLst', 'gdLst']) for (const gd of kids(kid(cg, list), 'gd')) {
    const [op, ...args] = (aAttr(gd, 'fmla') || '').trim().split(/\s+/);
    const [x, y, z] = args.map(val);
    let r;
    switch (op) {
      case '*/': r = x * y / z; break; case '+-': r = x + y - z; break; case '+/': r = (x + y) / z; break;
      case '?:': r = x > 0 ? y : z; break; case 'abs': r = Math.abs(x); break; case 'at2': r = Math.atan2(y, x) * 180 / Math.PI * 60000; break;
      case 'cat2': r = x * Math.cos(Math.atan2(z, y)); break; case 'sat2': r = x * Math.sin(Math.atan2(z, y)); break;
      case 'cos': r = x * Math.cos(ang(y)); break; case 'sin': r = x * Math.sin(ang(y)); break; case 'tan': r = x * Math.tan(ang(y)); break;
      case 'max': r = Math.max(x, y); break; case 'min': r = Math.min(x, y); break; case 'mod': r = Math.sqrt(x * x + y * y + z * z); break;
      case 'pin': r = y < x ? x : y > z ? z : y; break; case 'sqrt': r = Math.sqrt(x); break; case 'val': r = x; break;
      default: r = 0;
    }
    v[aAttr(gd, 'name')] = isFinite(r) ? r : 0;
  }
  return val;
}
function custGeomPath(cg, W, H) {
  const wE = W * EMU, hE = H * EMU;
  const g = geomGuides(cg, wE, hE);
  let d = '';
  for (const path of [...cg.getElementsByTagNameNS('*', 'path')]) {
    // Path coordinates: in their own coordinate system when w / h are given, otherwise the shape's EMU coordinates
    const pw = +(aAttr(path, 'w') || 0) || wE, ph = +(aAttr(path, 'h') || 0) || hE;
    const sx = W / pw, sy = H / ph;
    let cx = 0, cy = 0;
    const pt = (e) => [g(aAttr(e, 'x')) * sx, g(aAttr(e, 'y')) * sy];
    for (const c of path.children) {
      const pts = [...c.getElementsByTagNameNS('*', 'pt')].map(pt);
      switch (c.localName) {
        case 'moveTo': [cx, cy] = pts[0]; d += `M${cx} ${cy}`; break;
        case 'lnTo': [cx, cy] = pts[0]; d += `L${cx} ${cy}`; break;
        case 'cubicBezTo': d += `C${pts.map(p => p.join(' ')).join(' ')}`; [cx, cy] = pts[2]; break;
        case 'quadBezTo': d += `Q${pts.map(p => p.join(' ')).join(' ')}`; [cx, cy] = pts[1]; break;
        case 'arcTo': {
          const wR = g(aAttr(c, 'wR')) * sx, hR = g(aAttr(c, 'hR')) * sy;
          const st = g(aAttr(c, 'stAng')) / 60000 * Math.PI / 180, sw = g(aAttr(c, 'swAng')) / 60000 * Math.PI / 180;
          const ox = cx - wR * Math.cos(st), oy = cy - hR * Math.sin(st);
          const ex = ox + wR * Math.cos(st + sw), ey = oy + hR * Math.sin(st + sw);
          d += `A${wR} ${hR} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${ex} ${ey}`;
          cx = ex; cy = ey;
          break;
        }
        case 'close': d += 'Z'; break;
      }
    }
  }
  return /NaN|Infinity/.test(d) ? '' : d;
}
function geomSvg(spPr, b, fill, line) {
  const W = Math.max(b.w, 0.5), H = Math.max(b.h, 0.5); // Lines with zero width or height must still be drawn
  const cg = kid(spPr, 'custGeom');
  const prst = aAttr(kid(spPr, 'prstGeom'), 'prst');
  let d = '';
  if (cg) d = custGeomPath(cg, W, H);
  else if (POLY[prst]) d = 'M' + POLY[prst].map(([x, y]) => `${x * W} ${y * H}`).join('L') + 'Z';
  else if (CURVES[prst]) d = CURVES[prst](W, H);
  if (!d) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: W + 'pt', height: H + 'pt', overflow: 'visible' });
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  let f = fill && fill !== 'transparent' && !['line', 'straightConnector1'].includes(prst) ? fill : 'none';
  const g = /^linear-gradient\((\d+(?:\.\d+)?)deg, (.*)\)$/.exec(f);
  if (g) {
    const id = 'g' + Math.random().toString(36).slice(2);
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const lg = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    lg.setAttribute('id', id);
    lg.setAttribute('gradientTransform', `rotate(${+g[1] - 90} .5 .5)`);
    for (const st of g[2].split(/,\s(?=[#r])/)) {
      const m = /^(.*) ([\d.]+)%$/.exec(st.trim());
      if (!m) continue;
      const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop.setAttribute('offset', m[2] + '%');
      stop.setAttribute('stop-color', m[1]);
      lg.append(stop);
    }
    defs.append(lg);
    svg.append(defs);
    f = `url(#${id})`;
  }
  path.setAttribute('fill', f);
  if (line && line !== 'none') {
    const [w, , ...c] = line.split(' ');
    path.setAttribute('stroke', c.join(' '));
    path.setAttribute('stroke-width', parseFloat(w));
  }
  svg.append(path);
  return svg;
}

// Text box content
function renderTxBody(txBody, ctx, inh) {
  const box = h('div', { class: 'p-tx' });
  const bodyPr = kid(txBody, 'bodyPr');
  const insets = ['lIns', 'tIns', 'rIns', 'bIns'].map((k, i) => (aAttr(bodyPr, k) != null ? +aAttr(bodyPr, k) : [91440, 45720, 91440, 45720][i]) / EMU);
  box.style.padding = `${insets[1]}pt ${insets[2]}pt ${insets[3]}pt ${insets[0]}pt`;
  const anchor = aAttr(bodyPr, 'anchor') || inh.anchor || 't';
  box.style.justifyContent = { t: 'flex-start', ctr: 'center', b: 'flex-end', just: 'flex-start', dist: 'space-between' }[anchor] || 'flex-start';
  if (aAttr(bodyPr, 'wrap') === 'none') box.style.whiteSpace = 'nowrap';
  const na = kid(bodyPr, 'normAutofit');
  const fontScale = na && aAttr(na, 'fontScale') ? +aAttr(na, 'fontScale') / 100000 : 1;
  const lnRed = na && aAttr(na, 'lnSpcReduction') ? +aAttr(na, 'lnSpcReduction') / 100000 : 0;
  if (aAttr(bodyPr, 'vert') === 'vert' || aAttr(bodyPr, 'vert') === 'eaVert') box.style.writingMode = 'vertical-rl';
  const own = readListStyle(kid(txBody, 'lstStyle'), ctx);
  const counters = {};
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const lvl = +(aAttr(pPr, 'lvl') || 0);
    const L = Object.assign({}, ...inh.levels.map(ls => ls[lvl] || {}), own[lvl] || {}, readLvl(pPr, ctx));
    // Text color from the shape style (fontRef) beats the master's default style but not the text box's own settings
    const rBase = Object.assign({}, ...inh.levels.map(ls => (ls[lvl] || {}).r || {}), inh.fontColor ? { color: inh.fontColor } : {}, (own[lvl] || {}).r || {}, pPr ? readPptRPr(kid(pPr, 'defRPr'), ctx) : {});
    const para = h('div', { class: 'p-p' });
    const ps = para.style;
    ps.textAlign = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[L.algn || 'l'] || 'left';
    const sz0 = (rBase.sz || 18) * fontScale;
    if (L.lnPts) ps.lineHeight = L.lnPts + 'pt';
    else ps.lineHeight = ((L.lnSpc || 1) * (1 - lnRed) * 1.2).toFixed(3);
    if (L.spcBef) ps.marginTop = L.spcBef + 'pt'; else if (L.spcBefPct) ps.marginTop = sz0 * L.spcBefPct * 1.2 + 'pt';
    if (L.spcAft) ps.marginBottom = L.spcAft + 'pt';
    const marL = L.marL || 0, indent = L.indent || 0;
    ps.paddingLeft = marL + 'pt';
    ps.textIndent = indent + 'pt';
    const runs = kids(p).filter(c => ['r', 'br', 'fld'].includes(c.localName));
    const hasText = runs.some(r => r.localName !== 'br' && (kid(r, 't')?.textContent || '').length);
    // Bullets
    if (L.bu && !L.bu.none && hasText) {
      let txt = '';
      if (L.bu.char) txt = L.bu.char;
      else if (L.bu.auto) { counters[lvl] = (counters[lvl] ?? (L.bu.start - 1)) + 1; txt = AUTO_NUM(L.bu.auto, counters[lvl]); }
      for (const k of Object.keys(counters)) if (+k > lvl) delete counters[k];
      const b = h('span', { class: 'p-bu', style: { display: 'inline-block', minWidth: Math.max(0, -indent) + 'pt', textIndent: '0', fontSize: sz0 + 'pt', color: L.buColor || rBase.color || '' } }, txt);
      para.append(b);
    } else if (!L.bu || L.bu.none) { for (const k of Object.keys(counters)) delete counters[k]; }
    for (const r of runs) {
      if (r.localName === 'br') { para.append(h('br')); continue; }
      const rp = Object.assign({}, rBase, readPptRPr(kid(r, 'rPr'), ctx));
      const sp = h('span', {}, kid(r, 't')?.textContent || '');
      const st = sp.style;
      st.fontSize = (rp.sz || 18) * fontScale + 'pt';
      if (rp.b) st.fontWeight = '700';
      if (rp.i) st.fontStyle = 'italic';
      const deco = [rp.u && 'underline', rp.strike && 'line-through'].filter(Boolean).join(' ');
      if (deco) st.textDecoration = deco;
      if (rp.color) st.color = rp.color;
      if (rp.bg) st.backgroundColor = rp.bg;
      if (rp.caps) st.textTransform = 'uppercase';
      if (rp.baseline) { st.verticalAlign = rp.baseline > 0 ? 'super' : 'sub'; st.fontSize = (rp.sz || 18) * fontScale * 0.7 + 'pt'; }
      const fams = [fontName(rp.font, ctx) || inh.font, fontName(rp.eaFont, ctx) || inh.eaFont].filter(Boolean).map(f => `"${f}"`);
      st.fontFamily = (fams.length ? fams.join(',') + ',' : '') + OFFICE_FONTS;
      para.append(sp);
    }
    if (!runs.length || !para.textContent) {
      const end = readPptRPr(kid(p, 'endParaRPr'), ctx);
      para.style.fontSize = ((end.sz || rBase.sz || 18) * fontScale) + 'pt';
      para.append(h('br'));
    }
    box.append(para);
  }
  return box;
}

// Render the shape tree (spTree / grpSp) into a container; map converts child coordinates to slide coordinates
async function renderTree(tree, container, ctx, opts) {
  for (const el of kids(tree)) {
    const n = el.localName;
    if (n === 'grpSp') {
      const x = xfrmOf(el);
      if (!x) { await renderTree(el, container, ctx, opts); continue; }
      const sx = x.chExt && x.chExt.w ? x.w / x.chExt.w : 1, sy = x.chExt && x.chExt.h ? x.h / x.chExt.h : 1;
      const prev = ctx.map;
      ctx.map = (b) => { const p = prev({ x: x.x + (b.x - (x.chOff?.x || 0)) * sx, y: x.y + (b.y - (x.chOff?.y || 0)) * sy, w: b.w * sx, h: b.h * sy, rot: b.rot, flipH: b.flipH, flipV: b.flipV }); return p; };
      await renderTree(el, container, ctx, opts);
      ctx.map = prev;
      continue;
    }
    if (!['sp', 'pic', 'graphicFrame', 'cxnSp'].includes(n)) continue;
    const ph = phInfo(el);
    if (opts.skipPh && ph) continue; // Placeholders on masters / layouts are not drawn (they are only hint text)
    const lay = ph ? findPh(ctx.layoutTree, ph) : null, mas = ph ? findPh(ctx.masterTree, ph) : null;
    let b = xfrmOf(el) || (lay && xfrmOf(lay)) || (mas && xfrmOf(mas));
    if (!b) continue;
    b = ctx.map(b);
    const spPr = kid(el, 'spPr');
    if (n === 'pic') {
      const blip = firstDeep(kid(el, 'blipFill'), 'blip');
      const url = blip ? await ctx.img(anyAttr(blip, 'embed')) : null;
      const d = h('div');
      pptPlace(d, b);
      if (url) {
        const src = kid(kid(el, 'blipFill'), 'srcRect');
        const img = h('img', { src: url, style: { width: '100%', height: '100%', objectFit: 'fill', display: 'block' } });
        if (src) {
          // Cropping: scale the image up and clip it with the container
          const l = +(aAttr(src, 'l') || 0) / 100000, t = +(aAttr(src, 't') || 0) / 100000, r = +(aAttr(src, 'r') || 0) / 100000, bb = +(aAttr(src, 'b') || 0) / 100000;
          Object.assign(img.style, { position: 'absolute', width: 100 / (1 - l - r) + '%', height: 100 / (1 - t - bb) + '%', left: -l / (1 - l - r) * 100 + '%', top: -t / (1 - t - bb) * 100 + '%' });
          d.style.overflow = 'hidden';
        }
        d.append(img);
      } else { ctx.warn.add('img'); d.style.border = '1px dashed #bbb'; }
      container.append(d);
      continue;
    }
    if (n === 'graphicFrame') {
      const tbl = firstDeep(el, 'tbl');
      const d = h('div');
      pptPlace(d, b);
      d.style.height = 'auto';
      if (tbl) d.append(renderPptTable(tbl, ctx));
      else { ctx.warn.add('chart'); Object.assign(d.style, { height: b.h + 'pt', border: '1px dashed #bbb' }); }
      container.append(d);
      continue;
    }
    if (n === 'cxnSp') {
      const ln = lineCss(spPr, ctx) || `1pt solid ${styleRefs(el, ctx).line || '#000'}`;
      if (ln === 'none') continue;
      const [w, , ...c] = ln.split(' ');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      Object.assign(svg.style, { position: 'absolute', left: b.x + 'pt', top: b.y + 'pt', width: Math.max(1, b.w) + 'pt', height: Math.max(1, b.h) + 'pt', overflow: 'visible' });
      if (b.rot) svg.style.transform = `rotate(${b.rot}deg)`;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const [x1, x2] = b.flipH ? ['100%', '0'] : ['0', '100%'], [y1, y2] = b.flipV ? ['100%', '0'] : ['0', '100%'];
      for (const [k, v] of Object.entries({ x1, y1, x2, y2, stroke: c.join(' '), 'stroke-width': w })) line.setAttribute(k, v);
      svg.append(line);
      container.append(svg);
      continue;
    }
    // Regular shapes / text boxes / placeholders
    const refs = styleRefs(el, ctx);
    const d = h('div', { class: 'p-sp' });
    pptPlace(d, b);
    const layPr = lay && kid(lay, 'spPr'), masPr = mas && kid(mas, 'spPr');
    const fill = fillCss(spPr, ctx) ?? fillCss(layPr, ctx) ?? fillCss(masPr, ctx) ?? refs.fill;
    const line = lineCss(spPr, ctx) ?? lineCss(layPr, ctx) ?? (refs.line ? `0.75pt solid ${refs.line}` : undefined);
    const geom = aAttr(kid(spPr, 'prstGeom'), 'prst');
    const svg = (fill || line) && geomSvg(spPr, b, fill, line);
    if (svg) d.append(svg);
    else {
      if (fill) d.style.background = fill;
      if (line && line !== 'none') d.style.border = line;
      if (geom && GEOM_RADIUS[geom]) d.style.borderRadius = GEOM_RADIUS[geom];
      else if (geom && !['rect', 'line'].includes(geom) && (fill || line)) ctx.warn.add('geom');
    }
    const tx = kid(el, 'txBody');
    if (tx && tx.textContent.trim()) {
      // Text style inheritance: layout placeholder → master placeholder → master txStyles
      const t = ph ? (ph.type === 'ctrTitle' || ph.type === 'title' ? 'title' : ['body', 'obj', 'subTitle'].includes(ph.type) || ph.idx ? 'body' : 'other') : 'other';
      const levels = [ctx.txStyles[t] || {}, mas ? readListStyle(kid(kid(mas, 'txBody'), 'lstStyle'), ctx) : {}, lay ? readListStyle(kid(kid(lay, 'txBody'), 'lstStyle'), ctx) : {}];
      if (!ph) levels.splice(0, 1, ctx.defaultText);
      const anchor = aAttr(kid(kid(lay, 'txBody'), 'bodyPr'), 'anchor') || aAttr(kid(kid(mas, 'txBody'), 'bodyPr'), 'anchor') || (t === 'title' ? 'ctr' : null);
      const font = t === 'title' ? ctx.theme.major : ctx.theme.minor, eaFont = t === 'title' ? ctx.theme.majorEa : ctx.theme.minorEa;
      d.append(renderTxBody(tx, ctx, { levels, anchor, font, eaFont, fontColor: refs.font }));
    }
    container.append(d);
  }
}
function renderPptTable(tbl, ctx) {
  const t = h('table', { class: 'p-tbl' });
  const cg = h('colgroup', {}, kids(kid(tbl, 'tblGrid'), 'gridCol').map(g => h('col', { style: { width: +aAttr(g, 'w') / EMU + 'pt' } })));
  t.append(cg);
  const tblPr = kid(tbl, 'tblPr');
  const firstRow = aAttr(tblPr, 'firstRow') === '1', band = aAttr(tblPr, 'bandRow') === '1';
  kids(tbl, 'tr').forEach((tr, ri) => {
    const row = h('tr', { style: { height: +aAttr(tr, 'h') / EMU + 'pt' } });
    for (const tc of kids(tr, 'tc')) {
      if (aAttr(tc, 'hMerge') === '1' || aAttr(tc, 'vMerge') === '1') continue;
      const td = h('td', { colspan: aAttr(tc, 'gridSpan'), rowspan: aAttr(tc, 'rowSpan') });
      const tcPr = kid(tc, 'tcPr');
      let bg = fillCss(tcPr, ctx);
      // With no explicit style, use a common default table style: dark header row, banded rows
      if (bg === undefined) bg = firstRow && ri === 0 ? '#' + (ctx.theme.colors.accent1 || '4472C4') : band && ri % 2 === 1 ? '#e9edf4' : '#cfd5ea';
      td.style.background = bg;
      const tx = kid(tc, 'txBody');
      if (tx) td.append(renderTxBody(tx, ctx, { levels: [ctx.defaultText], font: ctx.theme.minor, eaFont: ctx.theme.minorEa, fontColor: firstRow && ri === 0 && !fillCss(tcPr, ctx) ? '#FFFFFF' : null }));
      row.append(td);
    }
    t.append(row);
  });
  return t;
}
function backgroundCss(cSld, ctx) {
  const bg = kid(cSld, 'bg');
  if (!bg) return null;
  const pr = kid(bg, 'bgPr');
  if (pr) {
    const blip = firstDeep(kid(pr, 'blipFill'), 'blip');
    if (blip) return { image: anyAttr(blip, 'embed') };
    return { css: fillCss(pr, ctx) };
  }
  const ref = kid(bg, 'bgRef');
  if (ref) return { css: pptColor(colorChild(ref), ctx) };
  return null;
}

async function pptxToPages(bytes, host) {
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error(T('无法打开这个文件。只支持 .pptx（PowerPoint 2007 以后的格式），旧的 .ppt 请先另存为 .pptx')); }
  const presXml = await zipText(zip, 'ppt/presentation.xml');
  if (!presXml) throw new Error(T('无法打开这个文件。只支持 .pptx（PowerPoint 2007 以后的格式），旧的 .ppt 请先另存为 .pptx'));
  const pres = parseXml(presXml).documentElement;
  const sz = kid(pres, 'sldSz');
  const spec = { w: +aAttr(sz, 'cx') / EMU || 720, h: +aAttr(sz, 'cy') / EMU || 540, top: 0, bottom: 0, left: 0, right: 0 };
  const presRels = relsMap(await zipText(zip, 'ppt/_rels/presentation.xml.rels'), 'ppt/');
  const dir = (p) => p.slice(0, p.lastIndexOf('/') + 1);
  const relsOf = async (p) => relsMap(await zipText(zip, dir(p) + '_rels/' + p.split('/').pop() + '.rels'), dir(p));
  const byType = (rels, kind) => Object.values(rels).find(r => r.path && r.path.includes(kind))?.path;
  const cache = new Map();
  const load = async (p) => { if (!cache.has(p)) cache.set(p, { doc: parseXml(await zipText(zip, p)).documentElement, rels: await relsOf(p) }); return cache.get(p); };
  const warn = new Set();
  const pages = [];
  const sldIds = kids(kid(pres, 'sldIdLst'), 'sldId');
  let index = 0;
  for (const sid of sldIds) {
    index++;
    progress(T('正在排版幻灯片'), index, sldIds.length);
    const path = presRels[sid.getAttributeNS(NS_R, 'id')]?.path;
    if (!path || !zip.file(path)) continue;
    const slide = await load(path);
    if (aAttr(slide.doc, 'show') === '0') continue; // Hidden slides
    const layoutPath = byType(slide.rels, 'slideLayout');
    const layout = layoutPath ? await load(layoutPath) : null;
    const masterPath = layout ? byType(layout.rels, 'slideMaster') : null;
    const master = masterPath ? await load(masterPath) : null;
    const themePath = master ? byType(master.rels, 'theme') : null;
    if (themePath && !cache.has('theme:' + themePath)) cache.set('theme:' + themePath, parseTheme(await zipText(zip, themePath)));
    const theme = themePath ? cache.get('theme:' + themePath) : parseTheme(null);
    const clrMap = Object.assign(readClrMap(kid(master?.doc, 'clrMap')), readClrMap(firstDeep(kid(slide.doc, 'clrMapOvr'), 'overrideClrMapping')));
    const ctx = { theme, clrMap, map: (b) => b, warn, layoutTree: firstDeep(layout?.doc, 'spTree'), masterTree: firstDeep(master?.doc, 'spTree'), img: null };
    const txStyles = kid(master?.doc, 'txStyles');
    ctx.txStyles = { title: readListStyle(kid(txStyles, 'titleStyle'), ctx), body: readListStyle(kid(txStyles, 'bodyStyle'), ctx), other: readListStyle(kid(txStyles, 'otherStyle'), ctx) };
    ctx.defaultText = ctx.txStyles.other;
    const pg = newPage(spec);
    pg._spec = spec;
    host.append(pg);
    const body = pg._body;
    body.style.height = spec.h + 'pt';
    // Background: slide → layout → master
    const bgSrc = [slide, layout, master].find(x => x && backgroundCss(kid(x.doc, 'cSld'), ctx));
    if (bgSrc) {
      const bg = backgroundCss(kid(bgSrc.doc, 'cSld'), ctx);
      if (bg.image) {
        const p = bgSrc.rels[bg.image]?.path;
        const url = p && await zipDataUrl(zip, p);
        if (url) Object.assign(body.style, { backgroundImage: `url("${url}")`, backgroundSize: '100% 100%' });
      } else if (bg.css) body.style.background = bg.css;
    } else body.style.background = '#' + (theme.colors[clrMap.bg1 || 'lt1'] || 'FFFFFF');
    const imgFor = (part) => async (rid) => { const p = part.rels[rid]?.path; if (!p) return null; const u = await zipDataUrl(zip, p); if (!u) warn.add('img'); return u; };
    const showMaster = aAttr(slide.doc, 'showMasterSp') !== '0' && aAttr(layout?.doc, 'showMasterSp') !== '0';
    if (master && showMaster) { ctx.img = imgFor(master); await renderTree(ctx.masterTree, body, ctx, { skipPh: true }); }
    if (layout) { ctx.img = imgFor(layout); await renderTree(ctx.layoutTree, body, ctx, { skipPh: true }); }
    ctx.img = imgFor(slide);
    await renderTree(firstDeep(slide.doc, 'spTree'), body, ctx, { skipPh: false });
    pages.push(pg);
  }
  if (!pages.length) throw new Error(T('这个演示文稿没有可显示的幻灯片'));
  return { pages, spec, warnings: warn };
}
