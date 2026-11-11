// ================= PDF protect / unlock (standard security handler, implemented here with no external library) =================
// Protect: AES-256 (V5 / R6, PDF 2.0 / Acrobat X and later)
// Unlock: RC4 40/128-bit, AES-128, AES-256 (R2–R6)
const { PDFDict, PDFArray, PDFString, PDFRawStream, PDFNumber, PDFRef, PDFParser, PDFObjectStreamParser, PDFWriter, PDFContext } = PDFLib;

const subtle = globalThis.crypto && globalThis.crypto.subtle;
function needSubtle() {
  if (!subtle) throw new Error(T('当前浏览器不支持加密功能，请使用新版 Chrome / Edge / Safari / Firefox'));
}
function concatBytes(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let p = 0;
  for (const a of arrs) { out.set(a, p); p += a.length; }
  return out;
}
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const toHex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const hexStr = (b) => PDFHexString.of(toHex(b));
const PW_PAD = new Uint8Array([0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
  0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A]);

// ---------- MD5 ----------
const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
function md5(data) {
  const len = data.length;
  const total = ((len + 8) >> 6) + 1 << 6;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, (len * 8) >>> 0, true);
  dv.setUint32(total - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v, true));
  return out;
}

// ---------- RC4 ----------
function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 255;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + S[i]) & 255;
    [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
  }
  return out;
}

// ---------- AES (browser built-in WebCrypto) ----------
const keyCache = new Map();
async function aesKey(raw) {
  const id = toHex(raw);
  if (!keyCache.has(id)) {
    if (keyCache.size > 2000) keyCache.clear();
    keyCache.set(id, await subtle.importKey('raw', raw, 'AES-CBC', false, ['encrypt', 'decrypt']));
  }
  return keyCache.get(id);
}
async function aesEncrypt(raw, iv, data) { // PKCS#7 padding
  return new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, await aesKey(raw), data));
}
async function aesEncryptNoPad(raw, iv, data) { // data length must be a multiple of 16
  return (await aesEncrypt(raw, iv, data)).slice(0, data.length);
}
// Unpadded decryption: append a ciphertext block that decrypts to a full padding block, to get past WebCrypto's padding check
async function aesDecryptNoPad(raw, iv, data) {
  data = data.subarray(0, data.length - (data.length % 16));
  if (!data.length) return new Uint8Array(0);
  const key = await aesKey(raw);
  const last = data.subarray(data.length - 16);
  const extra = (await aesEncrypt(raw, last, new Uint8Array(16).fill(16))).slice(0, 16);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv }, key, concatBytes(data, extra)));
}
function stripPadding(b) {
  const n = b[b.length - 1];
  if (n >= 1 && n <= 16 && n <= b.length && b.subarray(b.length - n).every(x => x === n)) return b.subarray(0, b.length - n);
  return b;
}
const sha = async (alg, data) => new Uint8Array(await subtle.digest(alg, data));

// ---------- Passwords ----------
function pwBytesLegacy(pw) { // R2–R4: PDFDocEncoding (Latin letters); characters outside the range fall back to UTF-8
  const s = String(pw || '');
  const b = [...s].every(c => c.charCodeAt(0) < 256) ? Uint8Array.from(s, c => c.charCodeAt(0)) : new TextEncoder().encode(s);
  return b.slice(0, 32);
}
function padPw(pw) { return concatBytes(pw, PW_PAD).slice(0, 32); }
const pwBytesUtf8 = (pw) => new TextEncoder().encode(String(pw || '').normalize('NFKC')).slice(0, 127);

// Algorithm 2.B (password hash for R6)
async function hashR6(pw, salt, udata) {
  let K = await sha('SHA-256', concatBytes(pw, salt, udata));
  let E;
  for (let round = 0; ; ) {
    const one = concatBytes(pw, K, udata);
    const K1 = new Uint8Array(one.length * 64);
    for (let j = 0; j < 64; j++) K1.set(one, j * one.length);
    E = await aesEncryptNoPad(K.slice(0, 16), K.slice(16, 32), K1);
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += E[j];
    K = await sha(['SHA-256', 'SHA-384', 'SHA-512'][sum % 3], E);
    round++;
    if (round >= 64 && E[E.length - 1] <= round - 32) break;
  }
  return K.slice(0, 32);
}
const hashR5 = async (pw, salt, udata) => sha('SHA-256', concatBytes(pw, salt, udata));

// Read the parameters of the Encrypt dictionary
function readEncryptParams(ctx, enc) {
  const num = (k, d) => { const v = enc.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : d; };
  const str = (k) => { const v = enc.lookup(PDFName.of(k)); return v && v.asBytes ? v.asBytes() : new Uint8Array(0); };
  const filter = enc.lookup(PDFName.of('Filter'));
  const em = enc.lookup(PDFName.of('EncryptMetadata'));
  const V = num('V', 0), R = num('R', 2);
  let idArr = ctx.lookup(ctx.trailerInfo.ID);
  const id0 = idArr instanceof PDFArray && idArr.size() ? (idArr.lookup(0)?.asBytes?.() || new Uint8Array(0)) : new Uint8Array(0);
  // Cipher: V<4 is RC4 throughout; V≥4 depends on CF / StmF / StrF
  const method = (which) => {
    if (V < 4) return 'RC4';
    const name = enc.lookup(PDFName.of(which));
    const nm = name ? name.asString().replace('/', '') : 'Identity';
    if (nm === 'Identity') return 'none';
    const cf = enc.lookup(PDFName.of('CF'));
    const sub = cf instanceof PDFDict ? cf.lookup(PDFName.of(nm)) : null;
    const cfm = sub instanceof PDFDict ? sub.lookup(PDFName.of('CFM')) : null;
    const m = cfm ? cfm.asString().replace('/', '') : 'None';
    return { V2: 'RC4', AESV2: 'AES128', AESV3: 'AES256', None: 'none' }[m] || (() => { throw new Error(T('不支持的加密方式：') + m); })();
  };
  return {
    filter: filter ? filter.asString().replace('/', '') : '', V, R,
    lengthBytes: R === 2 ? 5 : Math.max(5, Math.min(16, num('Length', 40) / 8)),
    O: str('O'), U: str('U'), OE: str('OE'), UE: str('UE'), P: num('P', -4) | 0,
    encryptMetadata: !(em && em.asBoolean && em.asBoolean() === false),
    id0, stm: method('StmF'), str: method('StrF'),
  };
}

// Derive the file key from the password; returns null for a wrong password
async function computeFileKey(p, password) {
  if (p.R >= 5) {
    const pw = pwBytesUtf8(password);
    const H = p.R === 5 ? hashR5 : hashR6;
    const U48 = p.U.slice(0, 48);
    if (bytesEqual(await H(pw, p.O.slice(32, 40), U48), p.O.slice(0, 32))) {
      return { key: await aesDecryptNoPad(await H(pw, p.O.slice(40, 48), U48), new Uint8Array(16), p.OE.slice(0, 32)), owner: true };
    }
    if (bytesEqual(await H(pw, p.U.slice(32, 40), new Uint8Array(0)), p.U.slice(0, 32))) {
      return { key: await aesDecryptNoPad(await H(pw, p.U.slice(40, 48), new Uint8Array(0)), new Uint8Array(16), p.UE.slice(0, 32)), owner: false };
    }
    return null;
  }
  const n = p.lengthBytes;
  const P4 = new Uint8Array(4);
  new DataView(P4.buffer).setInt32(0, p.P, true);
  const alg2 = (pw) => {
    let h = md5(concatBytes(padPw(pw), p.O.slice(0, 32), P4, p.id0, p.R >= 4 && !p.encryptMetadata ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0)));
    if (p.R >= 3) for (let i = 0; i < 50; i++) h = md5(h.slice(0, n));
    return h.slice(0, n);
  };
  const checkUser = (key) => {
    if (p.R === 2) return bytesEqual(rc4(key, PW_PAD), p.U.slice(0, 32));
    let x = rc4(key, md5(concatBytes(PW_PAD, p.id0)));
    for (let i = 1; i <= 19; i++) x = rc4(key.map(b => b ^ i), x);
    return bytesEqual(x.slice(0, 16), p.U.slice(0, 16));
  };
  const pw = pwBytesLegacy(password);
  // Treat it as the permissions (owner) password: recover the user password first
  let ok = md5(padPw(pw));
  if (p.R >= 3) for (let i = 0; i < 50; i++) ok = md5(ok);
  ok = ok.slice(0, n);
  let userPw = p.O.slice(0, 32);
  if (p.R === 2) userPw = rc4(ok, userPw);
  else for (let i = 19; i >= 0; i--) userPw = rc4(ok.map(b => b ^ i), userPw);
  let key = alg2(userPw);
  if (checkUser(key)) return { key, owner: true };
  key = alg2(pw);
  if (checkUser(key)) return { key, owner: false };
  return null;
}

// Per-object key (RC4 / AES-128)
function objectKey(fileKey, method, ref) {
  if (method === 'AES256') return fileKey;
  const { objectNumber: n, generationNumber: g } = ref;
  const h = md5(concatBytes(fileKey, new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255]),
    method === 'AES128' ? new Uint8Array([0x73, 0x41, 0x6C, 0x54]) : new Uint8Array(0)));
  return h.slice(0, Math.min(fileKey.length + 5, 16));
}
async function decryptBytes(method, key, data) {
  if (method === 'none') return data;
  if (method === 'RC4') return rc4(key, data);
  if (data.length < 16) return new Uint8Array(0);
  return stripPadding(await aesDecryptNoPad(key, data.subarray(0, 16), data.subarray(16)));
}

// Walk every string in an object (without following references) and transform it with fn
async function mapStrings(obj, fn) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return hexStr(await fn(obj.asBytes()));
  if (obj instanceof PDFDict) {
    const isSig = obj.has(PDFName.of('ByteRange'));
    for (const [k, v] of obj.entries()) {
      if (isSig && k === PDFName.of('Contents')) continue; // Digital signature contents are not encrypted
      const nv = await mapStrings(v, fn);
      if (nv !== v) obj.set(k, nv);
    }
    return obj;
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const v = obj.get(i), nv = await mapStrings(v, fn);
      if (nv !== v) obj.set(i, nv);
    }
    return obj;
  }
  return obj;
}
const isMetadataStream = (s) => s.dict.lookup(PDFName.of('Type')) === PDFName.of('Metadata');
function hasCryptFilter(s) {
  const f = s.dict.lookup(PDFName.of('Filter'));
  const names = f instanceof PDFArray ? f.asArray() : [f];
  return names.some(n => n === PDFName.of('Crypt'));
}

// Parse a (possibly encrypted) PDF: hold back object streams, then decrypt and parse them once the key is known
async function parseRaw(bytes) {
  const captured = [];
  const order = new Map();
  let seq = 0, lastRef = null;
  const P = PDFParser.prototype, C = PDFContext.prototype;
  const origHeader = P.parseIndirectObjectHeader, origFor = PDFObjectStreamParser.forStream, origAssign = C.assign;
  P.parseIndirectObjectHeader = function () { const r = origHeader.call(this); lastRef = r; return r; };
  PDFObjectStreamParser.forStream = (raw) => { captured.push({ ref: lastRef, raw, seq: seq++ }); return { parseIntoContext: async () => {} }; };
  C.assign = function (ref, obj) { order.set(ref.tag, seq++); return origAssign.call(this, ref, obj); };
  try {
    const ctx = await PDFParser.forBytesWithOptions(bytes, 200, false, false).parseDocument();
    return { ctx, captured, order };
  } finally {
    P.parseIndirectObjectHeader = origHeader;
    PDFObjectStreamParser.forStream = origFor;
    C.assign = origAssign;
  }
}
// Put the objects from (decrypted) object streams into the context; later ones (incremental updates) win
async function expandObjectStreams(ctx, captured, order, decrypt) {
  const fromStm = new Set();
  const C = PDFContext.prototype, origAssign = C.assign;
  let cur = 0;
  C.assign = function (ref, obj) {
    const o = order.get(ref.tag);
    if (o !== undefined && o > cur) return;
    order.set(ref.tag, cur);
    fromStm.add(ref.tag);
    return origAssign.call(this, ref, obj);
  };
  try {
    for (const c of captured) {
      cur = c.seq;
      const contents = decrypt ? await decrypt(c) : c.raw.contents;
      try {
        await PDFObjectStreamParser.forStream(PDFRawStream.of(c.raw.dict, contents)).parseIntoContext();
      } catch (e) { console.warn('object stream', c.ref && c.ref.tag, e); }
    }
  } finally { C.assign = origAssign; }
  return fromStm;
}

async function inspectEncryption(bytes) {
  const { ctx } = await parseRaw(bytes);
  const enc = ctx.lookup(ctx.trailerInfo.Encrypt);
  if (!(enc instanceof PDFDict)) return null;
  const p = readEncryptParams(ctx, enc);
  let emptyOk = false;
  if (p.filter === 'Standard') { needSubtle(); emptyOk = !!(await computeFileKey(p, '')); }
  return { ...p, emptyOk };
}

class PasswordError extends Error {}

// Unlock: return the PDF bytes without a password
async function decryptPdf(bytes, password) {
  needSubtle();
  const { ctx, captured, order } = await parseRaw(bytes);
  const encRef = ctx.trailerInfo.Encrypt;
  const enc = ctx.lookup(encRef);
  if (!(enc instanceof PDFDict)) return { bytes, wasEncrypted: false };
  const p = readEncryptParams(ctx, enc);
  if (p.filter !== 'Standard') throw new Error(T('这个 PDF 使用证书加密（{0}），无法用密码解除', p.filter || '?'));
  let fk = await computeFileKey(p, '');
  const noOpenPw = !!fk;
  if (!fk && password) fk = await computeFileKey(p, password);
  if (!fk) throw new PasswordError(password ? T('密码不正确') : T('这个 PDF 需要密码才能打开，请输入密码'));
  const key = fk.key;

  const fromStm = await expandObjectStreams(ctx, captured, order, (c) => decryptBytes(p.stm, objectKey(key, p.stm, c.ref), c.raw.contents));
  const encTag = encRef instanceof PDFRef ? encRef.tag : null;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (ref.tag === encTag || fromStm.has(ref.tag)) continue;
    const strFn = (b) => decryptBytes(p.str, objectKey(key, p.str, ref), b);
    if (obj instanceof PDFRawStream) {
      await mapStrings(obj.dict, strFn);
      if (!(isMetadataStream(obj) && !p.encryptMetadata) && !hasCryptFilter(obj)) {
        const plain = await decryptBytes(p.stm, objectKey(key, p.stm, ref), obj.contents);
        ctx.assign(ref, PDFRawStream.of(obj.dict, plain));
      }
    } else {
      const nv = await mapStrings(obj, strFn);
      if (nv !== obj) ctx.assign(ref, nv);
    }
  }
  if (encRef instanceof PDFRef) ctx.delete(encRef);
  ctx.trailerInfo.Encrypt = undefined;
  const raw = await PDFWriter.forContext(ctx, 200).serializeToBuffer();
  let out = raw;
  try { out = await (await PDFDocument.load(raw, { updateMetadata: false })).save({ useObjectStreams: true, updateFieldAppearances: false, addDefaultPage: false }); }
  catch (e) { console.warn('resave failed, keeping raw output', e); }
  return { bytes: out, wasEncrypted: true, noOpenPw, owner: fk.owner, p };
}

// Permission bits (ISO 32000 Table 22)
function permissionValue({ print = true, modify = true, copy = true, annotate = true } = {}) {
  let P = 0xFFFFF0C0;
  if (print) P |= (1 << 2) | (1 << 11);
  if (modify) P |= (1 << 3) | (1 << 10);
  P |= 1 << 9; // Accessibility extraction (screen readers) is always allowed
  if (copy) P |= 1 << 4;
  if (annotate) P |= (1 << 5) | (1 << 8);
  return P | 0;
}

// Protect: AES-256 (R6)
async function encryptPdf(bytes, { userPassword = '', ownerPassword = '', perms } = {}) {
  needSubtle();
  let doc;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) {
    if (/encrypt/i.test(String(e && e.message))) throw new Error(T('这个 PDF 已经加密了，请先用“解密 PDF”去掉原密码'));
    throw e;
  }
  const plain = await doc.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
  const { ctx } = await parseRaw(plain);
  const upw = pwBytesUtf8(userPassword);
  const opw = pwBytesUtf8(ownerPassword || userPassword);
  const fileKey = randomBytes(32);
  const zeroIv = new Uint8Array(16), none = new Uint8Array(0);
  const uvs = randomBytes(8), uks = randomBytes(8);
  const U = concatBytes(await hashR6(upw, uvs, none), uvs, uks);
  const UE = await aesEncryptNoPad(await hashR6(upw, uks, none), zeroIv, fileKey);
  const ovs = randomBytes(8), oks = randomBytes(8);
  const O = concatBytes(await hashR6(opw, ovs, U), ovs, oks);
  const OE = await aesEncryptNoPad(await hashR6(opw, oks, U), zeroIv, fileKey);
  const P = permissionValue(perms);
  const permsPlain = new Uint8Array(16);
  new DataView(permsPlain.buffer).setInt32(0, P, true);
  permsPlain.set([0xFF, 0xFF, 0xFF, 0xFF, 0x54, 0x61, 0x64, 0x62], 4); // 'T' = encrypt metadata, 'adb'
  permsPlain.set(randomBytes(4), 12);
  const Perms = await aesEncryptNoPad(fileKey, zeroIv, permsPlain); // Single-block CBC with a zero IV = ECB

  const enc = async (b) => {
    const iv = randomBytes(16);
    return concatBytes(iv, await aesEncrypt(fileKey, iv, b));
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      await mapStrings(obj.dict, enc);
      ctx.assign(ref, PDFRawStream.of(obj.dict, await enc(obj.contents)));
    } else {
      const nv = await mapStrings(obj, enc);
      if (nv !== obj) ctx.assign(ref, nv);
    }
  }
  const encDict = ctx.obj({
    Filter: 'Standard', V: 5, R: 6, Length: 256,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
    StmF: 'StdCF', StrF: 'StdCF',
    O: hexStr(O), U: hexStr(U), OE: hexStr(OE), UE: hexStr(UE), P, Perms: hexStr(Perms),
    EncryptMetadata: true,
  });
  ctx.trailerInfo.Encrypt = ctx.register(encDict);
  const id = ctx.lookup(ctx.trailerInfo.ID);
  if (!(id instanceof PDFArray) || id.size() < 2) {
    const r = hexStr(randomBytes(16));
    ctx.trailerInfo.ID = ctx.obj([r, r]);
  }
  return PDFWriter.forContext(ctx, 200).serializeToBuffer();
}

// ================= UI: protect =================
registerTool({
  id: 'protect', group: T('安全'), name: T('加密 PDF'), desc: T('给 PDF 设置打开密码（AES-256），也可以限制打印、复制和修改。'),
  render(view) {
    const fp = filePicker({ multiple: true, sortable: false });
    const pw1 = optText(T('打开密码'), '', { placeholder: T('打开文件时需要输入') });
    const pw2 = optText(T('再输入一次'), '');
    pw1.input.type = pw2.input.type = 'password';
    const show = optCheck(T('显示密码'), false);
    show.input.addEventListener('change', () => { for (const o of [pw1, pw2, opw]) o.input.type = show.value ? 'text' : 'password'; });
    const restrict = optCheck(T('同时限制权限'), false);
    const opw = optText(T('权限密码'), '', { placeholder: T('修改权限时需要输入'), hint: T('必须和打开密码不同') });
    opw.input.type = 'password';
    const pPrint = optCheck(T('允许打印'), true);
    const pCopy = optCheck(T('允许复制文字和图片'), false);
    const pModify = optCheck(T('允许修改和整理页面'), false);
    const pAnnot = optCheck(T('允许添加注释和填写表单'), true);
    const permBox = h('div', { hidden: true }, optsGrid(opw, pPrint, pCopy, pModify, pAnnot),
      h('div', { class: 'note', style: { marginTop: '8px' } }, T('权限限制由 PDF 阅读器遵守（Acrobat、Chrome、Edge 等都支持），不是绝对的保护。只设权限、不设打开密码时，任何人都能打开文件。')));
    restrict.input.addEventListener('change', () => { permBox.hidden = !restrict.value; });
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!fp.files.length) return toast(T('请先选择 PDF'));
      const u = pw1.value, o = restrict.value ? opw.value : '';
      if (u !== pw2.value) return toast(T('两次输入的密码不一样'));
      if (!u && !restrict.value) return toast(T('请输入打开密码'));
      if (restrict.value && !o) return toast(T('请输入权限密码'));
      if (restrict.value && o === u) return toast(T('权限密码必须和打开密码不同'));
      const perms = restrict.value ? { print: pPrint.value, copy: pCopy.value, modify: pModify.value, annotate: pAnnot.value } : undefined;
      const outputs = [];
      for (const [i, f] of fp.files.entries()) {
        progress(T('正在加密'), i + 1, fp.files.length);
        const data = await encryptPdf(await readBytes(f), { userPassword: u, ownerPassword: o || u, perms });
        outputs.push({ name: baseName(f.name) + T('_加密.pdf'), data });
      }
      await deliver(res, outputs, T('加密.zip'));
      res.append(h('div', { class: 'note', style: { marginTop: '6px' } }, T('请牢记密码：忘记密码后无法找回文件内容。')));
    }) }, T('加密'));
    view.append(...toolHeader(this), card(fp.el),
      card(optsGrid(pw1, pw2, show, restrict), permBox, h('div', { class: 'actions' }, run), res));
  },
});

// ================= UI: unlock =================
registerTool({
  id: 'unlock', group: T('安全'), name: T('解密 PDF'), desc: T('去掉 PDF 的打开密码和权限限制，保存成普通 PDF。需要知道打开密码；只有权限限制的文件可以直接解除。'),
  render(view) {
    const info = h('div');
    const fp = filePicker({ multiple: true, sortable: false, onChange: async (files) => {
      info.replaceChildren();
      for (const f of files) {
        try {
          const r = await inspectEncryption(await readBytes(f));
          const msg = !r ? T('{0}：没有加密', f.name)
            : r.filter !== 'Standard' ? T('{0}：证书加密，不支持', f.name)
            : T('{0}：{1}，{2}', f.name, encName(r), r.emptyOk ? T('只有权限限制，可以直接解除') : T('需要打开密码'));
          info.append(h('div', {}, msg));
        } catch (e) { info.append(h('div', {}, f.name + T('：') + friendlyError(e))); }
      }
    } });
    const pw = optText(T('密码'), '', { placeholder: T('打开密码（只有权限限制时可留空）'), hint: T('多个文件会使用同一个密码') });
    pw.input.type = 'password';
    const res = h('div');
    const run = h('button', { class: 'btn primary', onclick: () => runTask(async () => {
      if (!fp.files.length) return toast(T('请先选择 PDF'));
      const outputs = [], notes = [];
      for (const [i, f] of fp.files.entries()) {
        progress(T('正在解密'), i + 1, fp.files.length);
        let r;
        try { r = await decryptPdf(await readBytes(f), pw.value); }
        catch (e) {
          if (e instanceof PasswordError) { notes.push(`${f.name}${T('：')}${e.message}`); continue; }
          throw e;
        }
        if (!r.wasEncrypted) notes.push(T('{0}：没有加密，已原样保留', f.name));
        outputs.push({ name: baseName(f.name) + T('_已解密.pdf'), data: r.bytes });
      }
      if (!outputs.length) { res.replaceChildren(); return toast(notes.join('\n'), 6000); }
      await deliver(res, outputs, T('已解密.zip'));
      if (notes.length) res.append(h('div', { class: 'warn' }, notes.map(n => h('div', {}, n))));
    }) }, T('解密'));
    pw.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run.click(); });
    view.append(...toolHeader(this), card(fp.el, info), card(optsGrid(pw), h('div', { class: 'actions' }, run), res));
  },
});
function encName(p) {
  if (p.R >= 5) return 'AES-256';
  const m = p.stm !== 'none' ? p.stm : p.str;
  if (m === 'AES128') return 'AES-128';
  return `RC4 ${p.lengthBytes * 8}-bit`;
}
