// Build script: inlines the HTML/CSS/JS in src and all third-party libraries into one offline HTML file
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

// Library location: prefer node_modules in this folder (run npm install first)
const localNM = here('./node_modules/');
const NM = process.env.PDFTOOL_NM || (fs.existsSync(path.join(localNM, 'pdf-lib')) ? localNM : '/opt/npm-tools/node_modules');
const SRC = here('./src/');
const OUT = here('./dist/');
fs.mkdirSync(OUT, { recursive: true });

const read = (p, enc = 'utf8') => fs.readFileSync(p, enc);
const b64 = (p) => fs.readFileSync(p).toString('base64');

function assertNoScriptClose(name, code) {
  if (/<\/script/i.test(code)) throw new Error(name + ' contains </script and cannot be inlined');
  return code;
}

// pdf.js binary assets (CMaps, standard fonts, wasm), served through a custom BinaryDataFactory
const assets = {};
for (const dir of ['cmaps', 'standard_fonts']) {
  for (const f of fs.readdirSync(path.join(NM, 'pdfjs-dist', dir))) {
    if (f.startsWith('LICENSE')) continue;
    assets[dir + '/' + f] = b64(path.join(NM, 'pdfjs-dist', dir, f));
  }
}
for (const f of ['openjpeg.wasm', 'jbig2.wasm', 'qcms_bg.wasm']) {
  assets['wasm/' + f] = b64(path.join(NM, 'pdfjs-dist', 'wasm', f));
}

// docx only ships an unminified IIFE; minify it when esbuild is available (about 1.2 MB → 0.45 MB)
let docxSrc = read(path.join(NM, 'docx/dist/index.iife.js'));
try {
  const { createRequire } = await import('node:module');
  const esbuild = createRequire(path.join(NM, 'x.js'))('esbuild');
  docxSrc = (await esbuild.transform(docxSrc, { minify: true })).code;
} catch { console.log('(esbuild not found, docx is not minified)'); }

const libs = [
  ['pdf-lib', read(path.join(NM, 'pdf-lib/dist/pdf-lib.min.js'))],
  ['jszip', read(path.join(NM, 'jszip/dist/jszip.min.js'))],
  ['diff', read(path.join(NM, 'diff/dist/diff.min.js'))],
  ['docx', docxSrc],
  ['pptxgenjs', read(path.join(NM, 'pptxgenjs/dist/pptxgen.min.js'))],
  ['tesseract.js', read(path.join(NM, 'tesseract.js/dist/tesseract.min.js'))],
].map(([n, c]) => `<script>/* ${n} */\n${assertNoScriptClose(n, c)}\n</script>`).join('\n');

const pdfjsMain = b64(path.join(NM, 'pdfjs-dist/build/pdf.min.mjs'));
// Browsers don't allow blob module workers under file://, so turn the worker into a classic script
let workerSrc = read(path.join(NM, 'pdfjs-dist/build/pdf.worker.min.mjs'));
workerSrc = workerSrc.replaceAll('import.meta.url', 'self.location.href').replace(/export\s*\{\s*WorkerMessageHandler\s*\};?\s*$/, '');
if (/\bexport\s*\{|import\.meta/.test(workerSrc)) throw new Error('worker conversion failed');
const pdfjsWorker = Buffer.from(workerSrc).toString('base64');

// ---------- OCR: recognition engine and language data (stored in text/plain scripts, assembled into a worker at runtime) ----------
const tessCore = read(path.join(NM, 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js'));
const tessWorker = read(path.join(NM, 'tesseract.js/dist/worker.min.js'));
const OCR_LANGS = ['kor', 'eng', 'chi_sim'];
const ocrBlocks = [
  `<script type="text/plain" id="tess-core">${assertNoScriptClose('tesseract core', tessCore)}</script>`,
  `<script type="text/plain" id="tess-worker">${assertNoScriptClose('tesseract worker', tessWorker)}</script>`,
  ...OCR_LANGS.map(l => `<script type="text/plain" id="tess-lang-${l}">${b64(path.join(NM, '@tesseract.js-data', l, '4.0.0_best_int', l + '.traineddata.gz'))}</script>`),
].join('\n');

// ---------- Third-party licenses ----------
const ver = (p) => JSON.parse(read(path.join(NM, p, 'package.json'))).version;
const LIC = [
  ['PDF.js', 'pdfjs-dist', 'Apache-2.0', 'pdfjs-dist/LICENSE', 'Modified: pdf.worker.min.mjs is converted to a classic script (import.meta.url replaced, export removed) so it can run from file://.'],
  ['pdf-lib', 'pdf-lib', 'MIT', 'pdf-lib/LICENSE.md'],
  ['@pdf-lib/standard-fonts', '@pdf-lib/standard-fonts', 'MIT', '@pdf-lib/standard-fonts/LICENSE.md'],
  ['@pdf-lib/upng', '@pdf-lib/upng', 'MIT', '@pdf-lib/upng/LICENSE'],
  ['pako', 'pako', 'MIT AND Zlib', 'pako/LICENSE'],
  ['tslib', 'tslib', '0BSD', 'tslib/LICENSE.txt'],
  ['JSZip', 'jszip', 'MIT (chosen from MIT OR GPL-3.0-or-later)', 'jszip/LICENSE.markdown'],
  ['jsdiff', 'diff', 'BSD-3-Clause', 'diff/LICENSE'],
  ['docx', 'docx', 'MIT', 'docx/LICENSE', 'Minified with esbuild when bundled.'],
  ['PptxGenJS', 'pptxgenjs', 'MIT', 'pptxgenjs/LICENSE'],
  ['Tesseract.js', 'tesseract.js', 'Apache-2.0', 'tesseract.js/LICENSE.md', 'worker.min.js is combined at runtime with the core and language data into one worker script; fetch() is wrapped to serve the embedded language data.', 'tesseract.js/dist/worker.min.js.LICENSE.txt'],
  ['Tesseract.js-core (Tesseract OCR engine, WebAssembly build)', 'tesseract.js-core', 'Apache-2.0', 'tesseract.js-core/LICENSE'],
  ['Tesseract trained data: kor, eng, chi_sim (tessdata_best, integerized; via @tesseract.js-data)', '@tesseract.js-data/kor', 'Apache-2.0 (data) / MIT (npm packaging)', null, 'Language models from the tesseract-ocr/tessdata_best project, Copyright Google / Tesseract contributors, licensed under the Apache License 2.0 (text above, under PDF.js).'],
  ['GlyphLessFont (pdf.ttf from Tesseract OCR, invisible OCR text layer)', null, 'Apache-2.0', null, 'Copyright Google / Tesseract contributors. Apache License 2.0 (text above, under PDF.js).'],
  ['Adobe CMap resources (bundled with PDF.js)', null, 'BSD-3-Clause', 'pdfjs-dist/cmaps/LICENSE'],
  ['Foxit standard fonts (bundled with PDF.js)', null, 'BSD-3-Clause', 'pdfjs-dist/standard_fonts/LICENSE_FOXIT'],
  ['Liberation Sans fonts (bundled with PDF.js)', null, 'SIL Open Font License 1.1', 'pdfjs-dist/standard_fonts/LICENSE_LIBERATION'],
  ['OpenJPEG decoder (wasm, bundled with PDF.js)', null, 'BSD-2-Clause', 'pdfjs-dist/wasm/LICENSE_OPENJPEG', null, 'pdfjs-dist/wasm/LICENSE_PDFJS_OPENJPEG'],
  ['JBIG2 decoder from PDFium (wasm, bundled with PDF.js)', null, 'BSD-3-Clause / Apache-2.0', 'pdfjs-dist/wasm/LICENSE_JBIG2', null, 'pdfjs-dist/wasm/LICENSE_PDFJS_JBIG2'],
  ['qcms color management (wasm, bundled with PDF.js)', null, 'MIT / BSD', 'pdfjs-dist/wasm/LICENSE_QCMS', null, 'pdfjs-dist/wasm/LICENSE_PDFJS_QCMS'],
  ['sRGB ICC profile (ArgyllCMS, used for PDF/A output intent)', null, 'Public domain', null, 'The sRGB profile shipped with ArgyllCMS (sRGB.icm) is placed in the public domain by its author, Graeme W. Gill.'],
];
const bar = '='.repeat(78);
const licText = [
  'PDF Toolbox — third-party software notices',
  'This application bundles the following open-source components. Each is used under the license shown;',
  'the full license texts follow.',
  '',
  ...LIC.map(([name, pkg, lic]) => `- ${name}${pkg ? ' ' + ver(pkg) : ''} — ${lic}`),
  '',
  ...LIC.flatMap(([name, pkg, lic, file, note, extra]) => [
    bar, `${name}${pkg ? ' ' + ver(pkg) : ''}  (${lic})`, note ? 'Note: ' + note : null, bar, '',
    file ? read(path.join(NM, file)).trim() : null, extra ? '\n' + read(path.join(NM, extra)).trim() : null, '',
  ].filter(x => x !== null)),
].join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'THIRD-PARTY-LICENSES.txt'), licText);
const licSummary = LIC.map(([name, pkg, lic]) => ({ name, version: pkg ? ver(pkg) : '', license: lic }));

const embedded = `<script>
window.__PDFJS_MAIN_B64__ = "${pdfjsMain}";
window.__PDFJS_WORKER_B64__ = "${pdfjsWorker}";
window.__PDFJS_ASSETS__ = ${JSON.stringify(assets)};
window.__LICENSES__ = ${JSON.stringify(licSummary).replace(/</g, '\\u003c')};
window.__LICENSE_TEXT__ = ${JSON.stringify(licText).replace(/</g, '\\u003c')};
</script>`;

let html = read(path.join(SRC, 'index.html'));
const css = read(path.join(SRC, 'style.css'));
const jsDir = path.join(SRC, 'js');
const js = assertNoScriptClose('app js', fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort()
  .map(f => `// ===== ${f} =====\n` + read(path.join(jsDir, f))).join('\n'));
html = html
  .replace('/*__CSS__*/', () => css)
  .replace('<!--__LIBS__-->', () => libs + '\n' + embedded + '\n' + ocrBlocks)
  .replace('/*__APP__*/', () => js);

const outFile = path.join(OUT, 'PDF-Toolbox.html');
fs.writeFileSync(outFile, html);
console.log('Built', outFile, (fs.statSync(outFile).size / 1024 / 1024).toFixed(1) + ' MB');

// ---------- Desktop launchers ----------
// Windows: prebuilt launcher (launcher/windows/build-windows.sh), placed next to PDF-Toolbox.html
const winExe = here('./launcher/windows/PDF Toolbox.exe');
if (fs.existsSync(winExe)) fs.copyFileSync(winExe, path.join(OUT, 'PDF Toolbox.exe'));
// Mac: PDF Toolbox.app (the app itself lives inside the bundle), zipped to keep the executable bit
{
  const { createRequire } = await import('node:module');
  const JSZip = createRequire(path.join(NM, 'x.js'))('jszip');
  const zip = new JSZip();
  const app = 'PDF Toolbox.app/Contents/';
  const opt = (mode) => ({ unixPermissions: mode, date: new Date() });
  zip.file(app + 'Info.plist', read(here('./launcher/mac/Info.plist')), opt(0o100644));
  zip.file(app + 'MacOS/PDFToolbox', read(here('./launcher/mac/PDFToolbox.sh')), opt(0o100755));
  zip.file(app + 'Resources/AppIcon.icns', fs.readFileSync(here('./launcher/mac/AppIcon.icns')), opt(0o100644));
  zip.file(app + 'Resources/PDF-Toolbox.html', fs.readFileSync(outFile), opt(0o100644));
  zip.file(app + 'Resources/THIRD-PARTY-LICENSES.txt', licText, opt(0o100644));
  const buf = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  fs.writeFileSync(path.join(OUT, 'PDF-Toolbox-Mac.zip'), buf);
  console.log('Built Mac app', (buf.length / 1024 / 1024).toFixed(1) + ' MB');
}

