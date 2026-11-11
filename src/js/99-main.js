// ================= Home, navigation and routing =================
const APP_VERSION = '2.5.1';

// ---------- Icons (24×24 line icons, drawn by hand) ----------
const GROUP_COLOR = { [T('整理')]: '#e5603f', [T('优化')]: '#1f9d6b', [T('转换')]: '#2f6fde', [T('编辑')]: '#8a4fd8', [T('安全')]: '#3d4a5c' };
const DOC = 'M6 3h9l4 4v14H6z M15 3v4h4';
const ICONS = {
  merge: { p: 'M3 5h7v14H3z M14 5h7v14h-7z M10 12h4 M12 10v4' },
  split: { p: 'M4 4h7v16H4z M13 4h7v16h-7z M12 2v20', dash: true },
  organize: { p: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z' },
  rotate: { p: 'M20 12a8 8 0 1 1-2.34-5.66 M20 4v5h-5' },
  compress: { p: 'M4 4l6 6 M10 5v5H5 M20 20l-6-6 M14 19v-5h5 M20 4l-6 6 M14 5v5h5 M4 20l6-6 M10 19v-5H5' },
  ocr: { p: 'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M8 9h8 M12 9v7' },
  flatten: { p: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15.5 9.5h.01' },
  pdf2img: { p: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15.5 9.5h.01' },
  img2pdf: { p: DOC + ' M8 18l3-3 2 2 3-3' },
  pdf2md: { p: 'M3 6h18v12H3z M6 15V9l3 3 3-3v6 M17 9v6 M15 13l2 2 2-2' },
  pdf2word: { p: DOC, t: 'W' },
  pdf2ppt: { p: DOC, t: 'P' },
  pdf2excel: { p: DOC, t: 'X' },
  pdfa: { p: DOC, t: 'A' },
  office2pdf: { p: 'M3 5h9v14H3z M12 9h3 M13 6l3 3-3 3 M15 5h6v14h-6', t: '' },
  pdf2office: { p: 'M15 5h6v14h-6z M12 9H9 M11 6L8 9l3 3 M3 5h6v14H3', t: '' },
  html2pdf: { p: 'M8 8l-4 4 4 4 M16 8l4 4-4 4 M14 5l-4 14' },
  watermark: { p: 'M12 3c-4 5-6 8-6 11a6 6 0 0 0 12 0c0-3-2-6-6-11z' },
  pagenum: { p: DOC, t: '1' },
  crop: { p: 'M6 2v16h16 M2 6h16v16' },
  edit: { p: 'M4 20h4L20 8l-4-4L4 16z M13.5 6.5l4 4' },
  forms: { p: 'M4 4h16v16H4z M8 12l3 3 5-6' },
  redact: { p: 'M5 3h14v18H5z M8 9h8v3H8z', fillRect: true },
  compare: { p: 'M3 4h8v16H3z M13 4h8v16h-8z M6 9h2 M16 9h2 M6 13h2 M16 13h2' },
  protect: { p: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3' },
  unlock: { p: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 7.5-2' },
};
// Old tools merged into "PDF to Office": hidden from the home screen, but their addresses (#pdf2word etc.) still work
const HIDDEN_TOOLS = new Set(['pdf2word', 'pdf2ppt', 'pdf2excel']);
function toolIcon(t) {
  const ic = ICONS[t.id] || { p: DOC };
  const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${ic.dash ? ' stroke-dasharray="0"' : ''}>`
    + `<path d="${ic.p}"/>`
    + (ic.fillRect ? '<rect x="8" y="9" width="8" height="3" fill="currentColor" stroke="none"/>' : '')
    + (ic.t ? `<text x="12.5" y="17.2" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none" font-family="Arial,sans-serif">${ic.t}</text>` : '')
    + '</svg>';
  return h('span', { class: 'ti', style: { background: GROUP_COLOR[t.group] || '#666' }, html: svg });
}

// ---------- Home ----------
let homeTab = 'all';
let homeQuery = '';
// Common order: listed first when suggesting tools for dropped files
const POPULAR = ['merge', 'compress', 'pdf2office', 'ocr', 'edit', 'split', 'organize', 'pdf2img', 'protect', 'unlock', 'watermark', 'rotate', 'redact', 'pagenum', 'crop', 'flatten', 'pdf2md', 'forms', 'pdfa', 'compare'];
function fileKind(f) {
  const n = f.name.toLowerCase();
  if (n.endsWith('.pdf') || f.type === 'application/pdf') return 'pdf';
  if (/\.(docx|xlsx|pptx)$/.test(n)) return 'office';
  if (/\.(html?|css|svg)$/.test(n)) return 'html';
  if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/.test(n)) return 'image';
  return 'other';
}
function suggestTools(files) {
  const kinds = new Set(files.map(fileKind));
  const pdfs = files.filter(f => fileKind(f) === 'pdf').length;
  const ids = [];
  if (kinds.has('office')) ids.push('office2pdf');
  if (kinds.has('html')) ids.push('html2pdf');
  if (kinds.has('image')) ids.push('img2pdf');
  if (pdfs) {
    let list = POPULAR.slice();
    if (pdfs < 2) list = list.filter(id => id !== 'merge');
    if (pdfs === 2) list.unshift('compare');
    else list = list.filter(id => id !== 'compare');
    if (pdfs >= 2) list = ['merge', ...list.filter(id => id !== 'merge')];
    ids.push(...list);
  }
  return [...new Set(ids)].map(id => TOOLS.find(t => t.id === id)).filter(Boolean);
}
function openTool(id, files) {
  PENDING_FILES = files ? [...files] : null;
  if (location.hash === '#' + id) route(); else location.hash = id;
}
function renderHome(view) {
  const suggestBox = h('div');
  const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { showSuggest([...input.files]); input.value = ''; } });
  const drop = h('div', { class: 'big-drop', onclick: () => input.click() },
    h('div', { class: 'big-icon', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4 M7 9l5-5 5 5 M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>' }),
    h('b', {}, T('把文件拖到这里，或点击选择')),
    h('p', {}, T('会自动列出可以用的工具。支持 PDF、图片、Word / Excel / PowerPoint、HTML')),
    input);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); showSuggest([...e.dataTransfer.files]); });
  function showSuggest(files) {
    if (!files.length) return;
    const tools = suggestTools(files);
    const names = files.length === 1 ? files[0].name : T('{0} 个文件', files.length);
    if (!tools.length) { toast(T('不支持这种文件')); return; }
    suggestBox.replaceChildren(h('div', { class: 'suggest' },
      h('div', { class: 'suggest-head' }, h('b', { title: files.map(f => f.name).join('\n') }, names), h('span', { class: 'note' }, T('要做什么？')),
        h('button', { class: 'btn small', onclick: () => { suggestBox.replaceChildren(); drop.hidden = false; } }, T('取消'))),
      h('div', { class: 'suggest-grid' }, tools.map(t => h('button', { class: 'chip', onclick: () => openTool(t.id, files) }, toolIcon(t), h('span', {}, t.name))))));
    drop.hidden = true;
  }
  const grid = h('div', { class: 'tool-grid' });
  const tabs = h('div', { class: 'tabs' });
  function drawGrid() {
    const q = homeQuery.trim().toLowerCase();
    const list = TOOLS.slice().sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)).filter(t => !HIDDEN_TOOLS.has(t.id) && (homeTab === 'all' || t.group === homeTab) && (!q || (t.name + ' ' + t.desc + ' ' + t.id).toLowerCase().includes(q)));
    grid.replaceChildren(...list.map(t => h('button', { class: 'tcard', title: t.desc, onclick: () => openTool(t.id) }, toolIcon(t), h('div', {}, h('b', {}, t.name), h('span', { class: 'td' }, t.desc)))));
    if (!list.length) grid.replaceChildren(h('div', { class: 'empty-search' }, T('没有找到相关工具')));
    tabs.replaceChildren(...[['all', T('全部')], ...GROUPS.map(g => [g, g])].map(([v, label]) =>
      h('button', { class: homeTab === v ? 'on' : '', onclick: () => { homeTab = v; drawGrid(); } }, label)));
  }
  view.__redraw = drawGrid;
  drawGrid();
  view.append(
    h('div', { class: 'hero' }, h('h1', {}, T('PDF 工具箱')), h('p', {}, T('离线运行，文件只在你的电脑上处理，不会上传到任何服务器。'))),
    drop, suggestBox, tabs, grid);
}

function renderAbout(view) {
  const L = window.__LICENSES__ || [];
  view.append(
    h('h1', {}, T('关于 / 开源许可')),
    h('p', { class: 'sub' }, T('PDF 工具箱'), ' v', APP_VERSION),
    card(h('p', { style: { marginTop: 0 } }, T('离线运行，文件只在你的电脑上处理，不会上传到任何服务器。')),
      h('p', { class: 'note', style: { marginBottom: 0 } }, T('本软件包含以下开源组件，均按各自的许可证使用。'))),
    card(h('table', { class: 'lic' },
      h('thead', {}, h('tr', {}, h('th', {}, T('组件')), h('th', {}, T('版本')), h('th', {}, T('许可证')))),
      h('tbody', {}, L.map(l => h('tr', {}, h('td', {}, l.name), h('td', {}, l.version), h('td', {}, l.license))))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => downloadBlob(new Blob([window.__LICENSE_TEXT__ || ''], { type: 'text/plain' }), 'THIRD-PARTY-LICENSES.txt') }, T('下载完整许可证文本'))),
      h('details', { style: { marginTop: '12px' } }, h('summary', { style: { cursor: 'pointer' } }, T('显示完整许可证文本')),
        h('pre', { class: 'lic-text' }, window.__LICENSE_TEXT__ || ''))));
}

// ---------- Routing ----------
function route() {
  const id = location.hash.slice(1);
  const tool = TOOLS.find(t => t.id === id);
  const view = h('div', { class: tool ? 'tool-view' : '' });
  $('#view').replaceChildren(view);
  if (tool) {
    tool.render(view);
    const main = view.querySelector('.picker');
    if (main) main.closest('.card')?.classList.add('main-card');
  } else if (id === 'about') renderAbout(view);
  else renderHome(view);
  PENDING_FILES = null;
  window.scrollTo(0, 0);
}

// ---------- Top bar ----------
document.title = T('PDF 工具箱');
$('.brand-text').textContent = T('PDF 工具箱');
const search = $('#search');
search.placeholder = T('搜索工具，例如：合并、Word、OCR');
search.addEventListener('input', () => {
  homeQuery = search.value;
  if (location.hash && location.hash !== '#') { location.hash = ''; return; }
  $('#view').firstChild?.__redraw?.();
});
search.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const first = $('#view .tcard');
  if (first) first.click();
});
const langSel = $('#lang-select');
langSel.title = T('语言');
langSel.append(...LANGS.map(([v, t]) => h('option', { value: v, selected: v === LANG }, t)));
langSel.addEventListener('change', () => setLang(langSel.value));
$('#about-link').textContent = T('关于 / 开源许可');
$('#busy-text').textContent = T('处理中…');

window.addEventListener('hashchange', () => { if (location.hash && location.hash !== '#') { search.value = ''; homeQuery = ''; } route(); });
// Stop the browser from opening a file dropped on an empty part of the page
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
route();
window.__APP_READY__ = true;
