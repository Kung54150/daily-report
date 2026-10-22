/**
 * Daily Report — ระบบรายงานยอดประจำวันแยกตามหน่วยงาน
 * Google Apps Script (ผูกกับ Google Sheets)
 *
 * - หน่วยงานเข้าระบบด้วยชื่อหน่วยงาน + รหัสผ่าน (ไม่ต้องมีบัญชี Google)
 * - ทุกหน่วยงานดูรายงานของกันได้ แก้ไขได้เฉพาะของตนเอง
 * - ADMIN ดูสรุป พิมพ์ A4 และอัปโหลดรายชื่อเจ้าหน้าที่ประจำเดือน
 *
 * ติดตั้งครั้งแรก: เปิดไฟล์นี้ เลือกฟังก์ชัน setup แล้วกด "เรียกใช้" (สร้างชีตและรหัสผ่านเริ่มต้น)
 */

const SH_USERS = 'ผู้ใช้';
const SH_REPORTS = 'รายงาน';
const SH_INCIDENTS = 'เหตุการณ์ผิดปกติ';
const SH_STAFF = 'ทะเบียนเจ้าหน้าที่';
const SH_STATS = 'สถิติ';
const INC_FIELDS = ['type', 'severity', 'patient', 'age', 'hn', 'time', 'doctor', 'bp', 'pr', 'rr', 'temp', 'spo2', 'o2mode', 'o2flow', 'detail', 'action'];
const HEADERS = {
  [SH_USERS]: ['หน่วยงาน', 'รหัสผ่าน'],
  [SH_REPORTS]: ['วันที่', 'หน่วยงาน', 'ผู้รายงาน', 'แก้ไขล่าสุด', 'ข้อมูล (JSON)'],
  [SH_INCIDENTS]: ['วันที่', 'หน่วยงาน', 'ประเภท', 'ระดับความรุนแรง', 'ชื่อ-สกุลผู้ป่วย', 'อายุ', 'HN', 'เวลามารับบริการ', 'แพทย์เจ้าของไข้',
    'BP (mmHg)', 'PR (/min)', 'RR (/min)', 'T (°C)', 'O2 sat (%)', 'O2', 'O2 ที่ให้', 'รายละเอียด', 'การแก้ไขเบื้องต้น', 'ผู้รายงาน'],
  // ยอดมาตรฐานแบบแถวยาว ใช้ทำ Pivot / Looker Studio ภายหลัง
  [SH_STATS]: ['วันที่', 'กลุ่ม', 'หน่วยงาน', 'หมวด', 'รายการ', 'จำนวน'],
  [SH_STAFF]: ['id', 'หน่วยงาน', 'ชื่อ-สกุล', 'ตำแหน่ง', 'ที่มา', 'แก้ไขล่าสุด']
};
const ADMIN = 'ADMIN';
const SESSION_DAYS = 30;
const LOGIN_HINT = ''; // ข้อความใต้ฟอร์มเข้าสู่ระบบ (ถ้ามี)

// ===== ติดตั้งครั้งแรก =====
function setup() {
  Object.keys(HEADERS).forEach(sheet_);
  const sh = sheet_(SH_USERS);
  const have = sh.getDataRange().getValues().slice(1).map(r => r[0]);
  const codes = [ADMIN].concat(GROUPS.flatMap(g => g.units)).filter(c => have.indexOf(c) < 0);
  if (codes.length) {
    sh.getRange(sh.getLastRow() + 1, 1, codes.length, 2)
      .setValues(codes.map(c => [c, String(Math.floor(100000 + Math.random() * 900000))]));
  }
  Logger.log('สร้างชีตแล้ว · เพิ่มผู้ใช้ใหม่ ' + codes.length + ' หน่วยงาน · ดูรหัสผ่านที่ชีต "' + SH_USERS + '"');
  return codes.length;
}

// ===== Web app =====
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('รายงานยอดประจำวัน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ===== เข้าสู่ระบบ =====
function getLoginInfo() {
  return { groups: GROUPS.map(g => ({ name: g.name, units: g.units })), hint: LOGIN_HINT };
}

function login(unit, password) {
  const row = sheet_(SH_USERS).getDataRange().getValues().slice(1)
    .find(r => String(r[0]) === String(unit));
  if (!row || !password || String(row[1]) !== String(password)) throw new Error('หน่วยงานหรือรหัสผ่านไม่ถูกต้อง');

  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  // ล้าง session ที่หมดอายุ
  Object.entries(props.getProperties()).forEach(([k, v]) => {
    if (k.indexOf('tok_') === 0 && JSON.parse(v).exp < now) props.deleteProperty(k);
  });
  const token = Utilities.getUuid();
  props.setProperty('tok_' + token, JSON.stringify({ unit: String(unit), exp: now + SESSION_DAYS * 864e5 }));
  return { token };
}

function logout(token) {
  PropertiesService.getScriptProperties().deleteProperty('tok_' + token);
}

function auth_(token) {
  const raw = token && PropertiesService.getScriptProperties().getProperty('tok_' + token);
  const s = raw && JSON.parse(raw);
  if (!s || s.exp < Date.now()) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  return s.unit === ADMIN ? { unit: null, role: 'admin' } : { unit: s.unit, role: 'unit' };
}

function getBoot(token) {
  return { me: auth_(token), config: buildConfig_() };
}

// ===== รายงาน =====
function getDay(token, date) {
  auth_(token);
  const reports = {};
  sheet_(SH_REPORTS).getDataRange().getValues().slice(1)
    .filter(r => fmtDate_(r[0]) === date)
    .forEach(r => { reports[r[1]] = JSON.parse(r[4]); });
  return { reports };
}

function saveReport(token, rep) {
  const me = auth_(token);
  if (me.role !== 'unit' || rep.unit !== me.unit) throw new Error('แก้ไขได้เฉพาะรายงานของหน่วยงานตนเอง');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rep.date)) throw new Error('วันที่ไม่ถูกต้อง');
  if (!String(rep.reporter || '').trim()) throw new Error('กรุณากรอกชื่อผู้รายงาน');

  const form = buildConfig_().units.find(u => u.code === me.unit).form;
  const keys = form.sections.flatMap(s => s.type === 'grid'
    ? s.rows.flatMap(r => s.cols.map(c => r[0] + '_' + c[0]))
    : s.fields.filter(f => !f.calc).map(f => f.key));
  const values = {};
  keys.forEach(k => { if (rep.values && rep.values[k] !== undefined && rep.values[k] !== '') values[k] = rep.values[k]; });

  const clean = {
    date: rep.date, unit: me.unit, reporter: String(rep.reporter).trim(),
    updatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
    values,
    shift: rep.shift || '',
    staff: (rep.staff || []).filter(s => s && s.name).map(s => ({ name: String(s.name), role: s.role || '', tag: s.tag || '', tagNote: s.tagNote || '' })),
    reduce: rep.reduce || {},
    notes: String(rep.notes || ''),
    incidents: (rep.incidents || []).filter(i => i && String(i.detail || '').trim())
      .map(i => { const o = {}; INC_FIELDS.forEach(k => { o[k] = String(i[k] == null ? '' : i[k]); }); return o; })
  };
  const unitInfo = buildConfig_().units.find(u => u.code === me.unit);
  const stats = statRows_(unitInfo, clean);

  withLock_(() => {
    const sh = sheet_(SH_REPORTS);
    deleteRows_(sh, r => fmtDate_(r[0]) === clean.date && r[1] === clean.unit);
    sh.appendRow([clean.date, clean.unit, clean.reporter, clean.updatedAt, JSON.stringify(clean)]);

    const inc = sheet_(SH_INCIDENTS);
    deleteRows_(inc, r => fmtDate_(r[0]) === clean.date && r[1] === clean.unit);
    if (clean.incidents.length) {
      inc.getRange(inc.getLastRow() + 1, 1, clean.incidents.length, INC_FIELDS.length + 3).setValues(clean.incidents.map(i =>
        [clean.date, clean.unit].concat(INC_FIELDS.map(k => i[k]), [clean.reporter])));
    }

    const st = sheet_(SH_STATS);
    deleteRows_(st, r => fmtDate_(r[0]) === clean.date && r[2] === clean.unit);
    if (stats.length) st.getRange(st.getLastRow() + 1, 1, stats.length, 6).setValues(stats);
  });
  return { ok: true };
}

// ยอดมาตรฐาน + ประเภทผู้ป่วย + อัตรากำลัง ของรายงานหนึ่งฉบับ (แถวละหนึ่งค่า)
function statRows_(u, rep) {
  const g = GROUPS.find(x => x.key === u.group).name;
  const row = (cat, item, n) => [rep.date, g, u.code, cat, item, n];
  const rows = [];
  Object.entries(stdValues_(u.form, rep.values)).forEach(([k, n]) => rows.push(row('ยอดผู้ป่วย', STD_LABELS[k], n)));
  Object.entries(categoryValues_(u.form, rep.values)).forEach(([k, n]) => rows.push(row('ประเภทผู้ป่วย', k, n)));
  ROLES.forEach(r => {
    const n = rep.staff.filter(s => s.role === r && s.tag !== 'ออกหน่วย').length;
    if (n) rows.push(row('อัตรากำลัง', r, n));
  });
  ['RN', 'PN', 'NA'].forEach(r => { if (Number(rep.reduce[r])) rows.push(row('ลดอัตรากำลัง (ชม.)', r, Number(rep.reduce[r]))); });
  rep.incidents.forEach(i => rows.push(row('เหตุการณ์ผิดปกติ', i.type, 1)));
  return rows;
}

// ===== ทะเบียนเจ้าหน้าที่ =====
function listStaff(token) {
  auth_(token);
  return sheet_(SH_STAFF).getDataRange().getValues().slice(1)
    .map(r => ({ id: Number(r[0]), unit: r[1], name: r[2], role: r[3], source: r[4] }));
}

function saveStaff(token, s) {
  const me = auth_(token);
  if (me.role !== 'admin' && s.unit !== me.unit) throw new Error('แก้ไขได้เฉพาะทะเบียนของหน่วยงานตนเอง');
  const name = String(s.name || '').trim();
  if (!name) throw new Error('กรุณากรอกชื่อ');
  return withLock_(() => {
    const sh = sheet_(SH_STAFF), data = sh.getDataRange().getValues();
    const now = stamp_();
    if (s.id) {
      const i = data.findIndex((r, k) => k > 0 && Number(r[0]) === Number(s.id));
      if (i < 0) throw new Error('ไม่พบรายชื่อนี้');
      if (me.role !== 'admin' && data[i][1] !== me.unit) throw new Error('แก้ไขได้เฉพาะทะเบียนของหน่วยงานตนเอง');
      sh.getRange(i + 1, 3, 1, 2).setValues([[name, s.role]]);
      sh.getRange(i + 1, 6).setValue(now);
      return { id: Number(s.id) };
    }
    const id = nextId_(data);
    sh.appendRow([id, s.unit, name, s.role, 'manual', now]);
    return { id };
  });
}

function deleteStaff(token, id) {
  const me = auth_(token);
  withLock_(() => {
    const sh = sheet_(SH_STAFF);
    const row = sh.getDataRange().getValues().find(r => Number(r[0]) === Number(id));
    if (!row) return;
    if (me.role !== 'admin' && row[1] !== me.unit) throw new Error('ลบได้เฉพาะทะเบียนของหน่วยงานตนเอง');
    deleteRows_(sh, r => Number(r[0]) === Number(id));
  });
  return { ok: true };
}

/**
 * อัปโหลดรายชื่อประจำเดือน (ADMIN)
 * - รายชื่อ "จากไฟล์" เดิมของหน่วยงานที่อยู่ในไฟล์ถูกแทนที่ทั้งหมด
 * - ชื่อที่หน่วยงาน "เพิ่มเอง" แล้วซ้ำกับไฟล์ → ยึดข้อมูลจากไฟล์
 */
function uploadStaff(token, rows) {
  if (auth_(token).role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบ');
  const codes = buildConfig_().units.map(u => u.code);
  const incoming = (rows || []).filter(r => codes.indexOf(r.unit) >= 0 && String(r.name || '').trim());
  const units = new Set(incoming.map(r => r.unit));
  const names = new Set(incoming.map(r => normName_(r.name)));

  return withLock_(() => {
    const sh = sheet_(SH_STAFF), data = sh.getDataRange().getValues();
    let removed = 0, replaced = 0;
    const keep = data.slice(1).filter(r => {
      if (r[4] === 'upload' && units.has(r[1])) { removed++; return false; }
      if (r[4] !== 'upload' && names.has(normName_(r[2]))) { replaced++; return false; }
      return true;
    });
    let id = nextId_(data);
    const now = stamp_();
    const all = keep.concat(incoming.map(r => [id++, r.unit, String(r.name).trim(), r.role, 'upload', now]));
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 6).clearContent();
    if (all.length) sh.getRange(2, 1, all.length, 6).setValues(all);
    return { added: incoming.length, replaced, removed };
  });
}

// ===== helpers =====
function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(HEADERS[name]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
    if (name !== SH_STAFF) sh.getRange('A:A').setNumberFormat('@'); // วันที่/รหัสหน่วยงานเก็บเป็นข้อความ
    if (name === SH_USERS) sh.getRange('B:B').setNumberFormat('@');
  }
  return sh;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function deleteRows_(sh, match) {
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) if (match(data[i])) sh.deleteRow(i + 1);
}

function nextId_(data) {
  return data.slice(1).reduce((m, r) => Math.max(m, Number(r[0]) || 0), 0) + 1;
}

function normName_(s) {
  return String(s).replace(/^\s*(คุณ|นางสาว|นาง|นาย|น\.ส\.)\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function stamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v);
}
