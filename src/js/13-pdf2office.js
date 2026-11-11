// ================= PDF to Office (Word / PowerPoint / Excel combined into one tool) =================
// Reuse the UI of the original three tools: when the format changes, carry the chosen files over
const PDF2OFFICE = [['pdf2word', 'Word (.docx)'], ['pdf2ppt', 'PowerPoint (.pptx)'], ['pdf2excel', 'Excel (.xlsx)']];
registerTool({
  id: 'pdf2office', group: T('转换'), name: T('PDF 转 Office'), desc: T('把 PDF 转成可以编辑的 Word、PowerPoint 或 Excel 文件。扫描件会自动识别文字（OCR）。'),
  render(view) {
    let fmt = 'pdf2word';
    try { fmt = localStorage.getItem('pdftool.pdf2office') || fmt; } catch {}
    if (!PDF2OFFICE.some(o => o[0] === fmt)) fmt = 'pdf2word';
    const sub = h('div', { class: 'tool-view sub-tool' });
    function show(id, files) {
      fmt = id;
      try { localStorage.setItem('pdftool.pdf2office', id); } catch {}
      const t = TOOLS.find(x => x.id === id);
      sub.replaceChildren();
      sub.classList.remove('has-file');
      PENDING_FILES = files && files.length ? [...files] : PENDING_FILES;
      t.render(sub);
      PENDING_FILES = null;
      // Remove the sub-tool's own heading and keep only its content
      sub.querySelectorAll(':scope > .back, :scope > .tool-head').forEach(e => e.remove());
      const main = sub.querySelector('.picker');
      if (main) main.closest('.card')?.classList.add('main-card');
    }
    const pick = seg(PDF2OFFICE.map(([id, label]) => [id, label]), fmt, (id) => {
      const cur = sub.querySelector('.picker')?.__api?.files || [];
      show(id, cur);
    });
    view.append(...toolHeader(this),
      h('div', { class: 'format-pick' }, h('span', {}, T('转换成')), pick.el),
      sub);
    show(fmt, null);
  },
});
