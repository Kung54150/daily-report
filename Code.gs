/**
 * Daily Report — ระบบรายงานยอดประจำวันแยกตามหน่วยงาน
 * Google Apps Script (ผูกกับ Google Sheets)
 *
 * - หน่วยงานเข้าระบบด้วยชื่อหน่วยงาน + รหัสผ่าน (ไม่ต้องมีบัญชี Google)
 * - ทุกหน่วยงานดูรายงานของกันได้ แก้ไขได้เฉพาะของตนเอง
 * - MANAGER (ผู้จัดการ) ดูสรุป ติดตามรายแผนก พิมพ์ A4 · ADMIN ทำได้เหมือนกัน และอัปโหลดรายชื่อเจ้าหน้าที่ประจำเดือน
 *
 * ติดตั้งครั้งแรก: เปิดไฟล์นี้ เลือกฟังก์ชัน setup แล้วกด "เรียกใช้" (สร้างชีตและรหัสผ่านเริ่มต้น)
 */

const SH_USERS = 'ผู้ใช้';
const SH_REPORTS = 'รายงาน';
const SH_INCIDENTS = 'เหตุการณ์ผิดปกติ';
const SH_CASES = 'รายงานเคส';
const SH_PROCS = 'รายการหัตถการ';
const SH_STAFF = 'ทะเบียนเจ้าหน้าที่';
const SH_STATS = 'สถิติ';
const SH_ROOMS = 'ห้อง';
const SH_ALIASES = 'ชื่อแผนกในไฟล์';
const SH_TITLES = 'การจับคู่ตำแหน่ง';
const SH_DOCS = 'ตารางเวรแพทย์';      // ตารางออกตรวจของแพทย์ประจำเดือน (อัปโหลดโดย ADMIN) แถวละแพทย์ 1 ท่าน/วัน
const SH_DOC_BIND = 'ผูกตารางแพทย์';  // ชื่อชีต (สาขา) ในไฟล์ตารางแพทย์ → หน่วยงานผู้ป่วยนอก
const SH_LINE_CASES = 'เคสจาก LINE'; // ร่างเคสที่บอท LINE (ChatBot) แยกจากข้อความในกลุ่ม — ต้องตรงกับ CASE_DRAFT.SHEET ใน ChatBot
const LINE_CASE_UNITS = ['OPD1'];      // หน่วยงานที่ดึงเคสจาก LINE ได้
const ATT_MAX_BYTES = 6 * 1024 * 1024; // ไฟล์แนบสูงสุดต่อไฟล์
const ATT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
const ROOMS_PER_IPD = 25; // ห้องเริ่มต้นของแต่ละตึกผู้ป่วยใน เช่น A401 ถึง A425 (แก้ไขได้ในชีต 'ห้อง')
const INC_FIELDS = ['type', 'severity', 'patient', 'age', 'hn', 'time', 'doctor', 'bp', 'pr', 'rr', 'temp', 'spo2', 'o2mode', 'o2flow', 'detail', 'action'];
const CASE_FIELDS = INC_FIELDS.slice(2); // รายงานเคส = เหมือนเหตุการณ์ผิดปกติ แต่ไม่มีประเภทและระดับความรุนแรง
const HEADERS = {
  [SH_USERS]: ['หน่วยงาน', 'รหัสผ่าน'],
  [SH_REPORTS]: ['วันที่', 'หน่วยงาน', 'ผู้รายงาน', 'แก้ไขล่าสุด', 'ข้อมูล (JSON)', 'เวร'],
  [SH_INCIDENTS]: ['วันที่', 'หน่วยงาน', 'ประเภท', 'ระดับความรุนแรง', 'ชื่อ-สกุลผู้ป่วย', 'อายุ', 'HN', 'เวลามารับบริการ', 'แพทย์เจ้าของไข้',
    'BP (mmHg)', 'PR (/min)', 'RR (/min)', 'T (°C)', 'O2 sat (%)', 'O2', 'O2 ที่ให้', 'รายละเอียด', 'การแก้ไขเบื้องต้น', 'ผู้รายงาน', 'ไฟล์แนบ', 'เวร'],
  [SH_PROCS]: ['หน่วยงาน', 'หมวด', 'ชื่อรายการ', 'จำนวนครั้งที่ใช้', 'ใช้ล่าสุด'],
  [SH_CASES]: ['วันที่', 'หน่วยงาน', 'ชื่อ-สกุลผู้ป่วย', 'อายุ', 'HN', 'เวลามารับบริการ', 'แพทย์เจ้าของไข้',
    'BP (mmHg)', 'PR (/min)', 'RR (/min)', 'T (°C)', 'O2 sat (%)', 'O2', 'O2 ที่ให้', 'รายละเอียด', 'การแก้ไขเบื้องต้น', 'ผู้รายงาน', 'ไฟล์แนบ', 'เวร'],
  // ยอดมาตรฐานแบบแถวยาว ใช้ทำ Pivot / Looker Studio ภายหลัง
  [SH_STATS]: ['วันที่', 'กลุ่ม', 'หน่วยงาน', 'หมวด', 'รายการ', 'จำนวน', 'ตึก', 'เวร'],
  [SH_STAFF]: ['id', 'หน่วยงาน', 'ชื่อ-สกุล', 'ตำแหน่ง', 'ที่มา', 'แก้ไขล่าสุด', 'แผนกในไฟล์', 'ตำแหน่งในไฟล์'],
  [SH_ROOMS]: ['หน่วยงาน', 'เลขห้อง', 'ชื่อ/ประเภทห้อง (ไม่บังคับ)'],
  [SH_ALIASES]: ['ชื่อแผนกที่ใช้ในไฟล์', 'หน่วยงานในระบบ'],
  [SH_TITLES]: ['ตำแหน่งในไฟล์', 'บทบาทในระบบ'],
  [SH_DOCS]: ['เดือน', 'วันที่', 'สาขา (ชื่อชีต)', 'แพทย์', 'เวลาออกตรวจ', 'ข้อความในตาราง', 'งด'],
  [SH_DOC_BIND]: ['สาขา (ชื่อชีต)', 'หน่วยงานในระบบ (คั่นด้วย ,)'],
  // ลำดับคอลัมน์ต้องตรงกับ CASE_SHEET_HEADER ใน ChatBot (บอทเป็นผู้สร้างชีตนี้)
  [SH_LINE_CASES]: ['messageId', 'เวลาส่ง', 'วันที่', 'หน่วยงาน', 'ผู้ส่ง (LINE)', 'ชื่อ-สกุลผู้ป่วย', 'อายุ', 'HN', 'เวลามารับบริการ',
    'แพทย์เจ้าของไข้', 'BP (mmHg)', 'PR (/min)', 'RR (/min)', 'T (°C)', 'O2 sat (%)', 'O2', 'O2 ที่ให้', 'รายละเอียด', 'การแก้ไขเบื้องต้น',
    'ข้อความต้นฉบับ', 'สถานะ', 'นำเข้าเมื่อ']
};
const ADMIN = 'ADMIN'; // ผู้ดูแลระบบ: ทุกอย่างของผู้จัดการ + อัปโหลด/ผูกรายชื่อเจ้าหน้าที่ + แก้ห้องทุกหน่วยงาน
const MANAGER = 'MANAGER'; // ผู้จัดการ: ดูสรุป ติดตามรายแผนก และพิมพ์ A4 (ดูอย่างเดียว)
const SESSION_DAYS = 30;
const LOGIN_HINT = ''; // ข้อความใต้ฟอร์มเข้าสู่ระบบ (ถ้ามี)

// ===== ติดตั้งครั้งแรก =====
function setup() {
  Object.keys(HEADERS).forEach(sheet_);
  const sh = sheet_(SH_USERS);
  const have = sh.getDataRange().getValues().slice(1).map(r => r[0]);
  const codes = [ADMIN, MANAGER].concat(GROUPS.flatMap(g => g.units)).filter(c => have.indexOf(c) < 0);
  if (codes.length) {
    sh.getRange(sh.getLastRow() + 1, 1, codes.length, 2)
      .setValues(codes.map(c => [c, String(Math.floor(100000 + Math.random() * 900000))]));
  }
  seedRooms_();
  Logger.log('สร้างชีตแล้ว · เพิ่มผู้ใช้ใหม่ ' + codes.length + ' หน่วยงาน · ดูรหัสผ่านที่ชีต "' + SH_USERS + '"');
  return codes.length;
}

// เปิดหน้าเว็บครั้งแรกแล้วยังไม่มีชีตผู้ใช้ → ติดตั้งให้เอง (ไม่ต้องกดเรียกใช้ setup)
function ensureSetup_() {
  if (SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_USERS)) return;
  withLock_(() => { if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_USERS)) setup(); });
}

// ระบบเดิมที่ติดตั้งก่อนมี MANAGER หรือหน่วยงานใหม่ → เพิ่มแถวผู้ใช้ที่ขาดให้เอง (ดูรหัสผ่านที่ชีต 'ผู้ใช้')
// หน่วยงานที่ถูกยกเลิก/แยกชื่อ (เช่น LR-NB → LR และ NB): รายชื่อที่ผูกไว้กลับเป็น "ยังไม่ผูกแผนก" และลบการผูกชื่อแผนกที่ชี้ไปหน่วยงานที่ไม่มีแล้ว
function releaseOrphans_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('mig_orphans_v2')) return;
  const codes = allUnitCodes_();
  withLock_(() => {
    const st = staffSheet_(), data = st.getDataRange().getValues();
    const units = data.slice(1).map(r => [r[1] && codes.indexOf(String(r[1])) < 0 ? '' : r[1]]);
    if (units.length) st.getRange(2, 2, units.length, 1).setValues(units);
    const as = sheet_(SH_ALIASES), keep = as.getDataRange().getValues().slice(1).filter(r => codes.indexOf(String(r[1]).trim()) >= 0).map(r => [r[0], r[1]]);
    as.getRange(2, 1, Math.max(as.getLastRow() - 1, 1), 2).clearContent();
    if (keep.length) as.getRange(2, 1, keep.length, 2).setValues(keep);
    props.setProperty('mig_orphans_v2', '1');
  });
}

// ย้ายข้อมูลครั้งเดียว: บทบาท "อื่นๆ" ถูกยกเลิก (กลับเป็นยังไม่กำหนด) และตำแหน่งในไฟล์ที่เป็นหัวหน้าแผนกได้บทบาท "หัวหน้า"
function migrateRoles_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('mig_roles_v1')) return;
  withLock_(() => {
    const st = staffSheet_(), data = st.getDataRange().getValues();
    if (data.length > 1) {
      const roles = data.slice(1).map(r => [/^(รักษาการ)?\s*หัวหน้า/.test(String(r[7] || '').trim()) ? 'หัวหน้า' : (String(r[3]) === 'อื่นๆ' ? '' : r[3])]);
      st.getRange(2, 4, roles.length, 1).setValues(roles);
    }
    const ts = sheet_(SH_TITLES), tv = ts.getDataRange().getValues().slice(1).filter(r => ROLES.indexOf(String(r[1]).trim()) >= 0).map(r => [r[0], r[1]]);
    ts.getRange(2, 1, Math.max(ts.getLastRow() - 1, 1), 2).clearContent();
    if (tv.length) ts.getRange(2, 1, tv.length, 2).setValues(tv);
    props.setProperty('mig_roles_v1', '1');
  });
}

function ensureUsers_() {
  releaseOrphans_();
  migrateRoles_();
  const sh = sheet_(SH_USERS);
  const need = [ADMIN, MANAGER].concat(allUnitCodes_());
  const have0 = sh.getDataRange().getValues().slice(1).map(r => String(r[0]));
  if (!need.some(c => have0.indexOf(c) < 0)) return;
  withLock_(() => {
    const have = sh.getDataRange().getValues().slice(1).map(r => String(r[0]));
    need.filter(c => have.indexOf(c) < 0).forEach(c => sh.appendRow([c, String(Math.floor(100000 + Math.random() * 900000))]));
  });
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
  ensureSetup_();
  ensureUsers_();
  return { groups: GROUPS.map(g => ({ name: g.name, units: g.units, sections: subGroups_(g).map(s => ({ label: s.label, units: s.units })) })), hint: LOGIN_HINT };
}

function login(unit, password) {
  if (unit !== ADMIN && unit !== MANAGER && allUnitCodes_().indexOf(String(unit)) < 0) throw new Error('หน่วยงานหรือรหัสผ่านไม่ถูกต้อง');
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

// เปลี่ยนรหัสผ่านของตนเอง (ทุกบทบาท: หน่วยงาน / MANAGER / ADMIN) — เครื่องอื่นของผู้ใช้นี้ถูกออกจากระบบ
function changePassword(token, oldPw, newPw) {
  auth_(token);
  const code = JSON.parse(PropertiesService.getScriptProperties().getProperty('tok_' + token)).unit;
  const next = String(newPw || '');
  if (next.length < 4) throw new Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร');
  if (next.length > 64 || /\s/.test(next)) throw new Error('รหัสผ่านใหม่ห้ามมีช่องว่าง และยาวไม่เกิน 64 ตัวอักษร');
  if (next === String(oldPw)) throw new Error('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
  withLock_(() => {
    const sh = sheet_(SH_USERS), data = sh.getDataRange().getValues();
    const i = data.findIndex((r, k) => k > 0 && String(r[0]) === code);
    if (i < 0) throw new Error('ไม่พบผู้ใช้');
    if (String(data[i][1]) !== String(oldPw)) throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
    sh.getRange(i + 1, 2).setValue(next);
  });
  const props = PropertiesService.getScriptProperties();
  Object.entries(props.getProperties()).forEach(([k, v]) => {
    if (k.indexOf('tok_') === 0 && k !== 'tok_' + token) { try { if (JSON.parse(v).unit === code) props.deleteProperty(k); } catch (e) {} }
  });
  return { ok: true };
}

// รุ่นของโค้ดฝั่งเซิร์ฟเวอร์ (แสดงในแผงตั้งค่าเทียบกับรุ่นของหน้าเว็บ เพื่อตรวจว่าวางไฟล์/Deploy ครบหรือยัง)
const SERVER_VERSION = '2026.10.29-a';
function getServerVersion() {
  let photos = -1;
  try { photos = Object.keys(THEME_IMAGES).length; } catch (e) { photos = -1; }
  return { version: SERVER_VERSION, photos };
}

// ธีมรูปภาพ (ดู ThemeImages.gs): ภาพตัวอย่างเล็กทั้งหมด และรูปพื้นหลังของธีมที่เลือก (ไม่ต้องเข้าสู่ระบบ ใช้ที่หน้าเข้าสู่ระบบได้)
function getThemeThumbs() {
  const out = {};
  Object.keys(THEME_IMAGES).forEach(k => { out[k] = THEME_IMAGES[k].thumb; });
  return out;
}
function getThemePhoto(key) {
  const t = THEME_IMAGES[String(key)];
  if (!t) throw new Error('ไม่พบธีมรูปภาพนี้');
  return t.photo;
}

// ผู้ดูแลระบบรีเซ็ตรหัสผ่านให้ผู้ใช้อื่น (กรณีลืมรหัส): สุ่มรหัส 6 หลักใหม่ แล้วแจ้งผู้ใช้ — เครื่องเดิมของผู้ใช้นั้นถูกออกจากระบบ
function resetPassword(token, code) {
  if (auth_(token).role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบ');
  code = String(code || '');
  if ([MANAGER].concat(allUnitCodes_()).indexOf(code) < 0) throw new Error('ไม่พบผู้ใช้');
  const pw = String(Math.floor(100000 + Math.random() * 900000));
  withLock_(() => {
    const sh = sheet_(SH_USERS), data = sh.getDataRange().getValues();
    const i = data.findIndex((r, k) => k > 0 && String(r[0]) === code);
    if (i < 0) throw new Error('ไม่พบผู้ใช้');
    sh.getRange(i + 1, 2).setValue(pw);
  });
  const props = PropertiesService.getScriptProperties();
  Object.entries(props.getProperties()).forEach(([k, v]) => { if (k.indexOf('tok_') === 0) { try { if (JSON.parse(v).unit === code) props.deleteProperty(k); } catch (e) {} } });
  return { code, password: pw };
}

function logout(token) {
  PropertiesService.getScriptProperties().deleteProperty('tok_' + token);
}

function auth_(token) {
  const raw = token && PropertiesService.getScriptProperties().getProperty('tok_' + token);
  const s = raw && JSON.parse(raw);
  if (!s || s.exp < Date.now()) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  if (s.unit === ADMIN) return { unit: null, role: 'admin' };
  if (s.unit === MANAGER) return { unit: null, role: 'manager' };
  return { unit: s.unit, role: 'unit' };
}

function getBoot(token) {
  return { me: auth_(token), config: Object.assign(buildConfig_(), { rooms: getRooms_(), procs: getProcs_(), lineCaseUnits: LINE_CASE_UNITS }) };
}

// ===== รายงาน =====
function getDay(token, date) {
  const me = auth_(token);
  const myZone = me.role === 'unit' ? (GROUPS.find(g => g.units.indexOf(me.unit) >= 0) || { units: [me.unit] }).units : [];
  const reports = {};
  sheet_(SH_REPORTS).getDataRange().getValues().slice(1)
    .filter(r => fmtDate_(r[0]) === date)
    .forEach(r => {
      const rep = JSON.parse(r[4]), sh = rowShift_(r[5], rep.shift);
      rep.shift = sh;
      // เหตุการณ์ผิดปกติ / รายงานเคส: หน่วยงานเห็นเฉพาะใน Zone ของตนเอง (OPD / IPD / Special Unit) ผู้จัดการและ Admin เห็นทั้งหมด
      if (me.role === 'unit' && myZone.indexOf(String(r[1])) < 0) { rep.incidents = []; rep.cases = []; }
      (reports[r[1]] = reports[r[1]] || {})[sh] = rep;
    });
  return { reports }; // { หน่วยงาน: { Day: รายงาน, Night: รายงาน } }
}

// รายงานทั้งเดือนของหน่วยงานเดียว (month = yyyy-mm) — หน่วยงานดูได้เฉพาะของตนเอง
function getMonth(token, month, unit) {
  const me = auth_(token);
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('เดือนไม่ถูกต้อง');
  const code = me.role === 'unit' ? me.unit : unit;
  if (allUnitCodes_().indexOf(code) < 0) throw new Error('ไม่พบหน่วยงาน');
  const reports = [];
  sheet_(SH_REPORTS).getDataRange().getValues().slice(1)
    .filter(r => String(r[1]) === code && fmtDate_(r[0]).indexOf(month) === 0)
    .forEach(r => { const rep = JSON.parse(r[4]); rep.shift = rowShift_(r[5], rep.shift); reports.push(rep); });
  reports.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.shift === b.shift ? 0 : a.shift === 'Day' ? -1 : 1));
  return { reports };
}

// เวรของแถวข้อมูล: ค่าในคอลัมน์เวร หรือในรายงาน (ข้อมูลเก่าไม่มี = Day)
function rowShift_(col, fromJson) {
  const v = String(col || fromJson || '').trim();
  return v === 'Night' ? 'Night' : 'Day';
}

function saveReport(token, rep) {
  const me = auth_(token);
  // หน่วยงานแก้ได้เฉพาะของตนเอง | ADMIN แก้ได้ทุกหน่วยงาน | ผู้จัดการดูอย่างเดียว
  const unitCode = me.role === 'admin' ? String(rep.unit || '') : me.unit;
  if (me.role === 'manager' || (me.role === 'unit' && rep.unit !== me.unit) || (me.role === 'admin' && allUnitCodes_().indexOf(unitCode) < 0)) throw new Error('แก้ไขได้เฉพาะรายงานของหน่วยงานตนเอง');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rep.date)) throw new Error('วันที่ไม่ถูกต้อง');
  if (!String(rep.reporter || '').trim()) throw new Error('กรุณากรอกชื่อผู้รายงาน');
  const myUnit = buildConfig_().units.find(u => u.code === unitCode);
  if (myUnit.shifts.indexOf(rep.shift) < 0) throw new Error('หน่วยงานนี้รายงานได้เฉพาะเวร ' + myUnit.shifts.join(', '));

  const form = myUnit.form;
  const keys = form.sections.flatMap(s => s.type === 'grid'
    ? s.rows.flatMap(r => s.cols.map(c => r[0] + '_' + c[0]))
    : s.fields.filter(f => !f.calc || f.calc.manual).flatMap(f => (f.note ? [f.key, f.key + '_note'] : [f.key]).concat(s.categories ? BALLS.map(b => f.key + '_' + b[0]) : [])));
  const values = {};
  keys.forEach(k => { if (rep.values && rep.values[k] !== undefined && rep.values[k] !== '') values[k] = rep.values[k]; });
  // จำนวนผู้ป่วยแต่ละประเภท = ผลรวมลูกบอลสี (ระบบรวมให้ ไม่ใช่ค่าที่กรอกเอง)
  form.sections.filter(s => s.categories).forEach(s => s.fields.forEach(f => {
    const n = BALLS.reduce((a, b) => a + (Number(values[f.key + '_' + b[0]]) || 0), 0);
    if (n > 0) values[f.key] = n;
  }));
  // รายการแบบเลือก + เพิ่ม (เช่น HPC): ตรวจรายการ/ชื่อ แล้วคำนวณยอดรวมเอง
  form.sections.filter(s => s.type === 'list').forEach(s => {
    const rows = [];
    ((rep.values || {})[s.key] || []).forEach(x => {
      const it = s.items.find(i => i.k === (x && x.k)), n = Math.floor(Number(x && x.n));
      if (!it || !(n > 0)) return;
      const name = String(x.name || '').trim().slice(0, 80);
      if (it.ask && !name) throw new Error('กรุณาระบุ' + it.ask + ' (' + it.label + ')');
      rows.push({ k: it.k, name: it.ask ? name : '', n });
    });
    if (rows.length) values[s.key] = rows;
    values[s.totalKey] = rows.reduce((a, r) => a + r.n, 0);
  });
  // ทันตกรรม: รายชื่อแพทย์ + จำนวนเคส + หัตถการของแต่ละท่าน; ยอดรวมผู้รับบริการ = ผลรวมเคสของแพทย์ทุกท่าน
  form.sections.filter(s => s.type === 'docs').forEach(s => {
    const docs = [];
    ((rep.values || {})[s.key] || []).slice(0, 30).forEach(d => {
      const name = String(d && d.name || '').trim().slice(0, 60), n = Math.max(0, Math.floor(Number(d && d.n)) || 0), rows = [];
      ((d && d.rows) || []).forEach(x => {
        const it = s.items.find(i => i.k === (x && x.k)), m = Math.floor(Number(x && x.n));
        if (!it || !(m > 0)) return;
        const nm = String(x.name || '').trim().slice(0, 80);
        if (it.ask && !nm) throw new Error('กรุณาระบุ' + it.ask + ' (' + it.label + ')');
        rows.push({ k: it.k, name: it.ask ? nm : '', n: m });
      });
      if (name || n || rows.length) docs.push({ name, n, rows });
    });
    if (docs.length) values[s.key] = docs;
    values[s.totalKey] = docs.reduce((a, d) => a + d.n, 0);
  });

  const lineIds = (rep.cases || []).map(i => i && i.lineId).filter(Boolean).map(String);
  const clean = {
    date: rep.date, unit: unitCode, reporter: String(rep.reporter).trim(),
    updatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
    values,
    shift: rep.shift,
    staff: (rep.staff || []).filter(s => s && s.name).map(s => ({ name: String(s.name), role: s.role || '', pos: String(s.pos || '').slice(0, 40), subs: (Array.isArray(s.subs) ? s.subs : []).filter(x => (form.staffSubs || []).indexOf(x) >= 0), tag: s.tag || '', tagNote: s.tagNote || '', slot: String(s.slot == null ? '' : s.slot).slice(0, 3), from: hm_(s.from), to: hm_(s.to) })),
    // ผู้ป่วยนอก: แพทย์ที่ออกตรวจวันนั้น (ดึงจากตารางเวรแพทย์แล้วหน่วยงานแก้ เพิ่ม ลบ ปรับเวลาเองได้) off = งด/ไม่มา
    doctors: myUnit.group === 'OPD' ? (rep.doctors || []).filter(x => x && String(x.name || '').trim()).slice(0, 60).map(x => ({
      name: String(x.name).replace(/\s+/g, ' ').trim().slice(0, 60), time: String(x.time || '').trim().slice(0, 60),
      sheet: String(x.sheet || '').slice(0, 40), text: String(x.text || '').slice(0, 200), off: !!x.off })) : undefined,
    reduce: rep.reduce || {},
    notes: String(rep.notes || ''),
    incidents: cleanCases_(rep.incidents, INC_FIELDS),
    cases: cleanCases_(rep.cases, CASE_FIELDS, true)
  };
  const unitInfo = buildConfig_().units.find(u => u.code === unitCode);
  const stats = statRows_(unitInfo, clean);

  withLock_(() => {
    const sh = sheet_(SH_REPORTS);
    ensureHeaders_(sh, HEADERS[SH_REPORTS]);
    const sameRep = r => fmtDate_(r[0]) === clean.date && r[1] === clean.unit && rowShift_(r[5], (String(r[4]).match(/"shift":"(\w+)"/) || [])[1]) === clean.shift;
    deleteRows_(sh, sameRep);
    sh.appendRow([clean.date, clean.unit, clean.reporter, clean.updatedAt, JSON.stringify(clean), clean.shift]);

    const inc = sheet_(SH_INCIDENTS);
    ensureHeaders_(inc, HEADERS[SH_INCIDENTS]);
    deleteRows_(inc, r => fmtDate_(r[0]) === clean.date && r[1] === clean.unit && rowShift_(r[INC_FIELDS.length + 4]) === clean.shift);
    if (clean.incidents.length) {
      inc.getRange(inc.getLastRow() + 1, 1, clean.incidents.length, INC_FIELDS.length + 5).setValues(clean.incidents.map(i =>
        [clean.date, clean.unit].concat(INC_FIELDS.map(k => i[k]), [clean.reporter, i.files.map(x => x.name).join(', '), clean.shift])));
    }

    const cs = sheet_(SH_CASES);
    ensureHeaders_(cs, HEADERS[SH_CASES]);
    deleteRows_(cs, r => fmtDate_(r[0]) === clean.date && r[1] === clean.unit && rowShift_(r[CASE_FIELDS.length + 4]) === clean.shift);
    if (clean.cases.length) {
      cs.getRange(cs.getLastRow() + 1, 1, clean.cases.length, CASE_FIELDS.length + 5).setValues(clean.cases.map(i =>
        [clean.date, clean.unit].concat(CASE_FIELDS.map(k => i[k]), [clean.reporter, i.files.map(x => x.name).join(', '), clean.shift])));
    }
    markLineCases_(lineIds);

    recordProcs_(unitCode, form, values);

    const st = sheet_(SH_STATS);
    ensureHeaders_(st, HEADERS[SH_STATS]);
    deleteRows_(st, r => fmtDate_(r[0]) === clean.date && r[2] === clean.unit && rowShift_(r[7]) === clean.shift);
    if (stats.length) st.getRange(st.getLastRow() + 1, 1, stats.length, 8).setValues(stats);
  });
  return { ok: true };
}

// ===== เคสจาก LINE =====
// ร่างเคสที่ยังไม่ได้นำเข้า ของหน่วยงานและวันที่นั้น (บอทเขียนลงชีต SH_LINE_CASES) — ใช้กรอกฟอร์มรายงานเคสให้อัตโนมัติ
function getLineCases(token, unit, date) {
  const me = auth_(token);
  const code = me.role === 'unit' ? me.unit : String(unit || '');
  if (me.role === 'manager' || LINE_CASE_UNITS.indexOf(code) < 0) return [];
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_LINE_CASES);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  const str = v => v instanceof Date ? Utilities.formatDate(v, tz, 'HH:mm') : String(v == null ? '' : v);
  return sh.getDataRange().getValues().slice(1)
    .filter(r => String(r[3]) === code && fmtDate_(r[2]) === date && String(r[20]) !== 'นำเข้าแล้ว')
    .map(r => {
      const o = { lineId: String(r[0]), sender: String(r[4]) };
      CASE_FIELDS.forEach((k, i) => { o[k] = str(r[5 + i]); });
      return o;
    });
}

// รายงานที่บันทึกมีเคสที่ดึงจาก LINE → ทำเครื่องหมายว่านำเข้าแล้ว จะไม่แสดงให้ดึงซ้ำ
function markLineCases_(ids) {
  const sh = ids.length && SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_LINE_CASES);
  if (!sh || sh.getLastRow() < 2) return;
  const at = stamp_();
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach((r, i) => {
    if (ids.indexOf(String(r[0])) >= 0) sh.getRange(i + 2, 21, 1, 2).setValues([['นำเข้าแล้ว', at]]);
  });
}

// เหตุการณ์ผิดปกติ: เก็บเฉพาะรายการที่มีรายละเอียด | รายงานเคส (anyField): กรอกช่องใดช่องหนึ่งก็เก็บ ไม่บังคับกรอกครบ
function cleanCases_(list, fields, anyField) {
  return (list || []).filter(i => i && (anyField ? fields.some(k => k !== 'o2mode' && String(i[k] == null ? '' : i[k]).trim()) : String(i.detail || '').trim()))
    .map(i => {
      const o = {}; fields.forEach(k => { o[k] = String(i[k] == null ? '' : i[k]); });
      o.files = (i.files || []).filter(x => x && x.id).slice(0, 5)
        .map(x => ({ id: String(x.id), name: String(x.name || '').slice(0, 80), mime: String(x.mime || ''), size: Number(x.size) || 0 }));
      return o;
    });
}

// ยอดมาตรฐาน + ประเภทผู้ป่วย + อัตรากำลัง ของรายงานหนึ่งฉบับ (แถวละหนึ่งค่า)
function statRows_(u, rep) {
  const g = GROUPS.find(x => x.key === u.group).name;
  const bld = String(u.sub || '').replace('ตึก ', '');
  const row = (cat, item, n) => [rep.date, g, u.code, cat, item, n, bld, rep.shift];
  const rows = [];
  Object.entries(stdValues_(u.form, rep.values)).forEach(([k, n]) => rows.push(row('ยอดผู้ป่วย', STD_LABELS[k], n)));
  u.form.sections.filter(s => s.type === 'list').forEach(s => (rep.values[s.key] || []).forEach(r => {
    const it = s.items.find(i => i.k === r.k);
    rows.push(row('รายการบริการ', (it ? it.label : r.k) + (r.name ? ' \u00b7 ' + r.name : ''), r.n));
  }));
  u.form.sections.filter(s => s.type === 'docs').forEach(s => (rep.values[s.key] || []).forEach(d => {
    if (d.n) rows.push(row('ผู้รับบริการรายแพทย์', d.name || '(ไม่ระบุชื่อ)', d.n));
    (d.rows || []).forEach(r => { const it = s.items.find(i => i.k === r.k); rows.push(row('หัตถการ', (it && it.custom ? r.name : it ? it.label : r.k) + ' \u00b7 ' + (d.name || ''), r.n)); });
  }));
  Object.entries(categoryValues_(u.form, rep.values)).forEach(([k, n]) => rows.push(row('ประเภทผู้ป่วย', k, n)));
  const bv = ballValues_(u.form, rep.values);
  BALLS.forEach(b => { if (bv[b[0]]) rows.push(row('ลูกบอลสีผู้ป่วย', b[1], bv[b[0]])); });
  u.form.sections.filter(s => s.categories).forEach(s => s.fields.forEach(f => BALLS.forEach(b => {
    const n = Number(rep.values[f.key + '_' + b[0]]) || 0;
    if (n) rows.push(row('ลูกบอลสีรายประเภท', f.label + ' \u00b7 ' + b[1], n));
  })));
  ROLES.forEach(r => {
    const n = rep.staff.filter(s => s.role === r && s.tag !== 'ออกหน่วย').length;
    if (n) rows.push(row('อัตรากำลัง', r, n));
  });
  ['RN', 'PN', 'NA'].forEach(r => { if (Number(rep.reduce[r])) rows.push(row('ลดอัตรากำลัง (ชม.)', r, Number(rep.reduce[r]))); });
  const docN = (rep.doctors || []).filter(x => !x.off).length;
  if (docN) rows.push(row('แพทย์ออกตรวจ', 'แพทย์', docN));
  rep.incidents.forEach(i => rows.push(row('เหตุการณ์ผิดปกติ', i.type, 1)));
  if (rep.cases.length) rows.push(row('รายงานเคส', 'เคส', rep.cases.length));
  return rows;
}

// ===== ไฟล์แนบของเหตุการณ์ผิดปกติ (เก็บในโฟลเดอร์ Google Drive ของเจ้าของระบบ ไม่เปิดสาธารณะ) =====
// ดูไฟล์ผ่านระบบนี้เท่านั้น (ต้องเข้าสู่ระบบ) ไฟล์ที่ถูกเอาออกจากรายงานยังค้างในโฟลเดอร์ ลบเองใน Drive ได้
function attFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('attFolderId');
  let folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); } catch (e) { folder = null; } }
  if (!folder) { folder = DriveApp.createFolder('daily-report-attachments'); props.setProperty('attFolderId', folder.getId()); }
  return folder;
}

// เรียกครั้งเดียวเพื่ออนุญาตสิทธิ์ Google Drive (หรือเปิดลิงก์ /exec ด้วยบัญชีเจ้าของแล้วกดอนุญาต)
function authorizeDrive() { return attFolder_().getName(); }

function uploadAttachment(token, f) {
  const me = auth_(token);
  if (me.role === 'manager') throw new Error('เฉพาะหน่วยงานที่แนบไฟล์ได้');
  const ext = ATT_TYPES[f && f.mime];
  if (!ext) throw new Error('แนบได้เฉพาะไฟล์ JPG, PNG หรือ PDF');
  const bytes = Utilities.base64Decode(String(f.data || ''));
  if (!bytes.length) throw new Error('ไฟล์ว่าง');
  if (bytes.length > ATT_MAX_BYTES) throw new Error('ไฟล์ใหญ่เกิน 6 MB');
  const name = String(f.name || 'file').replace(/[\\\/:*?"<>|]+/g, '_').slice(0, 80);
  const file = attFolder_().createFile(Utilities.newBlob(bytes, f.mime, (me.unit || 'ADMIN') + '_' + Utilities.getUuid().slice(0, 8) + '_' + name));
  return { id: file.getId(), name, mime: f.mime, size: bytes.length };
}

function getAttachment(token, id) {
  auth_(token);
  const folderId = attFolder_().getId();
  let file;
  try { file = DriveApp.getFileById(String(id)); } catch (e) { throw new Error('ไม่พบไฟล์แนบ'); }
  const parents = file.getParents();
  let inside = false;
  while (parents.hasNext()) { if (parents.next().getId() === folderId) inside = true; }
  if (!inside) throw new Error('ไม่พบไฟล์แนบ');
  const blob = file.getBlob();
  return { name: file.getName().replace(/^.*?_[0-9a-f]{8}_/, ''), mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

// ยอดสะสมที่ยกมาจากรายงานล่าสุดก่อนวันที่กำหนด (ปีเดียวกัน) เช่น ยอด ปกส. ของทันตกรรม; ไม่มี = null (ให้กรอกเอง)
function getCarry(token, unit, date, key) {
  const me = auth_(token);
  if (me.role === 'unit' && unit !== me.unit) throw new Error('ดูได้เฉพาะหน่วยงานตนเอง');
  const u = buildConfig_().units.find(x => x.code === unit);
  if (!u || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('ข้อมูลไม่ถูกต้อง');
  let spec = null;
  u.form.sections.forEach(s => (s.fields || []).forEach(f => { if (f.carryFrom === key) spec = f; }));
  if (!spec || !spec.carryFrom) return null;
  let best = null, bestDate = '';
  sheet_(SH_REPORTS).getDataRange().getValues().slice(1).forEach(r => {
    const d = fmtDate_(r[0]);
    if (String(r[1]) !== unit || d >= date || d.slice(0, 4) !== String(date).slice(0, 4) || d <= bestDate) return;
    try { const rep = JSON.parse(r[4]); best = fieldNum_(u.form, rep.values || {}, spec.carryFrom); bestDate = d; } catch (e) {}
  });
  return best === null ? null : { value: best, date: bestDate };
}

// ===== ชื่อหัตถการที่หน่วยงานพิมพ์เองเคยใช้ (ชีต 'รายการหัตถการ') ใช้แนะนำตอนพิมพ์ครั้งต่อไป =====
const procNorm_ = x => String(x == null ? '' : x).toLowerCase().replace(/\s+/g, '');
function getProcs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SH_PROCS)) return {};
  const rows = sheet_(SH_PROCS).getDataRange().getValues().slice(1).filter(r => r[0] && r[1] && r[2]);
  rows.sort((a, b) => (Number(b[3]) || 0) - (Number(a[3]) || 0));
  const out = {};
  rows.forEach(r => { const u = out[r[0]] = out[r[0]] || {}, l = u[r[1]] = u[r[1]] || []; if (l.length < 200) l.push(String(r[2])); });
  return out;
}
function recordProcs_(unit, form, values) {
  const add = [];
  form.sections.filter(s => s.type === 'list').forEach(s => (values[s.key] || []).forEach(r => {
    const it = s.items.find(i => i.k === r.k);
    if (it && it.custom && r.name) add.push([s.key, r.name]);
  }));
  form.sections.filter(s => s.type === 'docs').forEach(s => (values[s.key] || []).forEach(d => {
    if (d.name) add.push([s.key + ':doc', d.name]);
    (d.rows || []).forEach(r => { const it = s.items.find(i => i.k === r.k); if (it && it.custom && r.name) add.push([s.key, r.name]); });
  }));
  if (!add.length) return;
  const sh = sheet_(SH_PROCS), now = stamp_();
  ensureHeaders_(sh, HEADERS[SH_PROCS]);
  const data = sh.getDataRange().getValues();
  add.forEach(([sec, name]) => {
    const i = data.findIndex((r, k) => k > 0 && String(r[0]) === unit && String(r[1]) === sec && procNorm_(r[2]) === procNorm_(name));
    if (i > 0) { const n = (Number(data[i][3]) || 0) + 1; data[i][3] = n; sh.getRange(i + 1, 4, 1, 2).setValues([[n, now]]); }
    else { sh.appendRow([unit, sec, name, 1, now]); data.push([unit, sec, name, 1, now]); }
  });
}

// ===== ห้องพัก (ชีต 'ห้อง': หน่วยงาน, เลขห้อง, ชื่อ/ประเภท) แก้ในเว็บหรือในชีตก็ได้ =====
function getRooms_() {
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_ROOMS) || sheet_(SH_ROOMS).getLastRow() < 2) withLock_(seedRooms_);
  const sh = sheet_(SH_ROOMS);
  ensureHeaders_(sh, HEADERS[SH_ROOMS]);
  const out = {};
  sh.getDataRange().getValues().slice(1).forEach(r => {
    const u = String(r[0]).trim(), no = String(r[1]).trim(), name = String(r[2] || '').trim();
    if (u && (no || name)) (out[u] = out[u] || []).push({ no: no || name, name: no ? name : '' });
  });
  return out;
}

// หน่วยงานแก้ไขรายการห้องของตนเอง (ADMIN แก้ได้ทุกหน่วยงาน) — แทนที่รายการห้องของหน่วยงานนั้นทั้งหมด
function saveRooms(token, unit, list) {
  const me = auth_(token);
  if (!allUnitCodes_().includes(unit)) throw new Error('ไม่พบหน่วยงาน');
  if (me.role !== 'admin' && unit !== me.unit) throw new Error('แก้ไขได้เฉพาะห้องของหน่วยงานตนเอง');
  const seen = {}, clean = [];
  (list || []).forEach(r => {
    const no = String(r && r.no || '').trim(), name = String(r && r.name || '').trim();
    if (!no) return;
    const key = no.toLowerCase();
    if (seen[key]) throw new Error('เลขห้องซ้ำ: ' + no);
    seen[key] = true; clean.push([unit, no, name]);
  });
  if (clean.length > 300) throw new Error('จำนวนห้องมากเกินไป');
  withLock_(() => {
    getRooms_();
    const sh = sheet_(SH_ROOMS), data = sh.getDataRange().getValues().slice(1);
    const out = []; let placed = false;
    data.forEach(r => {
      if (String(r[0]).trim() === unit) { if (!placed) { clean.forEach(x => out.push(x)); placed = true; } }
      else out.push([r[0], r[1], r[2] || '']);
    });
    if (!placed) clean.forEach(x => out.push(x));
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 3).clearContent();
    if (out.length) sh.getRange(2, 1, out.length, 3).setValues(out);
  });
  return getRooms_();
}

function allUnitCodes_() { return GROUPS.flatMap(g => g.units); }

function seedRooms_() {
  const sh = sheet_(SH_ROOMS);
  if (sh.getLastRow() >= 2) return;
  const rows = [];
  GROUPS.filter(g => g.key === 'IPD').forEach(g => g.units.forEach(u => {
    for (let i = 1; i <= ROOMS_PER_IPD; i++) rows.push([u, u + (i < 10 ? '0' : '') + i, '']);
  }));
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
}

// ===== ทะเบียนเจ้าหน้าที่ =====
let staffHdrOk_ = false;
function staffSheet_() {
  const sh = sheet_(SH_STAFF);
  if (!staffHdrOk_) { ensureHeaders_(sh, HEADERS[SH_STAFF]); staffHdrOk_ = true; }
  return sh;
}

// หน่วยงานว่าง ('') = ยังไม่ผูกแผนก  |  fileDept = ชื่อแผนกตามไฟล์รายชื่อ (คอลัมน์แผนก)
function listStaff(token) {
  auth_(token);
  return staffSheet_().getDataRange().getValues().slice(1)
    .map(r => ({ id: Number(r[0]), unit: String(r[1] || ''), name: r[2], role: r[3], source: r[4], fileDept: String(r[6] || ''), title: String(r[7] || '') }));
}

function saveStaff(token, s) {
  const me = auth_(token);
  if (me.role !== 'admin' && s.unit !== me.unit) throw new Error('แก้ไขได้เฉพาะทะเบียนของหน่วยงานตนเอง');
  const name = String(s.name || '').trim();
  if (!name) throw new Error('กรุณากรอกชื่อ');
  return withLock_(() => {
    const sh = staffSheet_(), data = sh.getDataRange().getValues();
    const now = stamp_();
    if (s.id) {
      const i = data.findIndex((r, k) => k > 0 && Number(r[0]) === Number(s.id));
      if (i < 0) throw new Error('ไม่พบรายชื่อนี้');
      if (me.role !== 'admin' && data[i][1] !== me.unit) throw new Error('แก้ไขได้เฉพาะทะเบียนของหน่วยงานตนเอง');
      sh.getRange(i + 1, 3, 1, 2).setValues([[name, s.role]]);
      // ADMIN ย้ายคนไปหน่วยงานอื่น (หรือ '' = ยังไม่ผูก) ได้
      if (me.role === 'admin' && s.unit !== undefined && (s.unit === '' || allUnitCodes_().indexOf(s.unit) >= 0)) sh.getRange(i + 1, 2).setValue(s.unit);
      sh.getRange(i + 1, 6).setValue(now);
      return { id: Number(s.id) };
    }
    const id = nextId_(data);
    sh.appendRow([id, s.unit, name, s.role, 'manual', now, '', '']);
    return { id };
  });
}

function deleteStaff(token, id) {
  const me = auth_(token);
  withLock_(() => {
    const sh = staffSheet_();
    const row = sh.getDataRange().getValues().find(r => Number(r[0]) === Number(id));
    if (!row) return;
    if (me.role !== 'admin' && row[1] !== me.unit) throw new Error('ลบได้เฉพาะทะเบียนของหน่วยงานตนเอง');
    deleteRows_(sh, r => Number(r[0]) === Number(id));
  });
  return { ok: true };
}

/**
 * อัปโหลดรายชื่อประจำเดือน (ADMIN) — rows: [{ dept, name, role }]
 * - นำเข้าทุกคน ชื่อแผนกตามไฟล์เก็บไว้ในช่อง "แผนกในไฟล์"
 *   แผนกที่ผูกไว้แล้ว (ชื่อตรงกับหน่วยงาน หรือเคยผูกไว้) ถูกจัดเข้าหน่วยงานนั้นทันที
 *   แผนกที่ยังไม่ผูก เก็บไว้ที่ "ยังไม่ผูกแผนก" รอผูกภายหลัง (saveBindings)
 * - รายชื่อ "จากไฟล์" เดิมของแผนกที่อยู่ในไฟล์ใหม่ถูกแทนที่ทั้งหมด
 * - ชื่อที่หน่วยงาน "เพิ่มเอง" แล้วซ้ำกับไฟล์ → ยึดข้อมูลจากไฟล์
 */
function uploadStaff(token, rows) {
  if (auth_(token).role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบ');
  const byNorm = {};
  allUnitCodes_().forEach(c => { byNorm[normAlias_(c)] = c; });
  sheet_(SH_ALIASES).getDataRange().getValues().slice(1).forEach(r => {
    if (String(r[0]).trim() && allUnitCodes_().indexOf(String(r[1]).trim()) >= 0) byNorm[normAlias_(r[0])] = String(r[1]).trim();
  });
  const incoming = (rows || []).filter(r => r && String(r.name || '').trim()).map(r => {
    const dept = String(r.dept || '').replace(/\s+/g, ' ').trim();
    const title = String(r.title || '').replace(/\s+/g, ' ').trim();
    return { dept, title, name: String(r.name).replace(/\s+/g, ' ').trim(), role: (title && titleMap_()[normTitle_(title)]) || r.role || '', unit: byNorm[normAlias_(dept)] || '' };
  });
  const depts = new Set(incoming.map(r => normAlias_(r.dept)));
  const names = new Set(incoming.map(r => normName_(r.name)));

  return withLock_(() => {
    const sh = staffSheet_(), data = sh.getDataRange().getValues();
    let removed = 0, replaced = 0;
    const keep = data.slice(1).filter(r => {
      if (r[4] === 'upload' && depts.has(normAlias_(r[6] || r[1]))) { removed++; return false; }
      if (r[4] !== 'upload' && names.has(normName_(r[2]))) { replaced++; return false; }
      return true;
    }).map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6] || '', r[7] || '']);
    let id = nextId_(data);
    const now = stamp_();
    const all = keep.concat(incoming.map(r => [id++, r.unit, r.name, r.role, 'upload', now, r.dept, r.title]));
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 8).clearContent();
    if (all.length) sh.getRange(2, 1, all.length, 8).setValues(all);
    return { added: incoming.length, replaced, removed, bound: incoming.filter(r => r.unit).length, unbound: incoming.filter(r => !r.unit).length };
  });
}

// ===== ตารางเวรแพทย์ประจำเดือน (ผู้ป่วยนอก) =====
// ADMIN อัปโหลดไฟล์ทุกเดือน (หน้าเว็บอ่านไฟล์ปฏิทินแล้วส่งเป็นรายการ) แต่ละชีตคือสาขาแพทย์ ผูกกับหน่วยงานผู้ป่วยนอกได้หลายหน่วยงาน
// ฟอร์มอัตรากำลังของผู้ป่วยนอกดึงแพทย์ของวันนั้นมาให้ หน่วยงานแก้ เพิ่ม ลบ ปรับเวลาเองได้
const opdUnits_ = () => GROUPS.find(g => g.key === 'OPD').units;
function docBindings_() {
  const out = {};
  sheet_(SH_DOC_BIND).getDataRange().getValues().slice(1).forEach(r => {
    const k = String(r[0]).trim();
    if (k) out[k] = String(r[1] || '').split(',').map(x => x.trim()).filter(x => opdUnits_().indexOf(x) >= 0);
  });
  return out;
}
function saveDocBindings_(map) {
  const cur = docBindings_();
  Object.keys(map || {}).forEach(k => { if (String(k).trim()) cur[String(k).trim()] = (map[k] || []).filter(x => opdUnits_().indexOf(x) >= 0); });
  const rows = Object.keys(cur).map(k => [k, cur[k].join(', ')]);
  const sh = sheet_(SH_DOC_BIND);
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
}
function getDocInfo(token) {
  if (auth_(token).role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบ');
  const months = {}, sheets = {};
  sheet_(SH_DOCS).getDataRange().getValues().slice(1).forEach(r => {
    const m = fmtMonth_(r[0]); if (!m) return;
    months[m] = (months[m] || 0) + 1; sheets[String(r[2])] = 1;
  });
  const bind = docBindings_();
  Object.keys(bind).forEach(k => { sheets[k] = 1; });
  return { months: Object.keys(months).sort().reverse().map(m => ({ month: m, n: months[m] })), sheets: Object.keys(sheets).filter(Boolean), bindings: bind };
}
function saveDocBindings(token, map) {
  if (auth_(token).role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบ');
  withLock_(() => saveDocBindings_(map));
  return getDocInfo(token);
}
// data = { month: 'yyyy-mm', entries: [{ day, sheet, name, time, text, off }], bindings: { ชื่อชีต: [หน่วยงาน] } } — แทนที่ตารางของเดือนนั้นทั้งหมด
function uploadDocSchedule(token, data) {
  if (auth_(token).role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบ');
  const month = String(data && data.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('กรุณาเลือกเดือนของตาราง');
  const last = new Date(+month.slice(0, 4), +month.slice(5), 0).getDate();
  const rows = ((data && data.entries) || []).filter(e => e && String(e.name || '').trim() && +e.day >= 1 && +e.day <= last).slice(0, 20000)
    .map(e => [month, month + '-' + String(+e.day).padStart(2, '0'), String(e.sheet || '').trim().slice(0, 60), String(e.name).replace(/\s+/g, ' ').trim().slice(0, 60),
      String(e.time || '').slice(0, 60), String(e.text || '').replace(/\s+/g, ' ').trim().slice(0, 200), e.off ? 'งด' : '']);
  if (!rows.length) throw new Error('ไม่พบรายชื่อแพทย์ในไฟล์');
  withLock_(() => {
    const sh = sheet_(SH_DOCS);
    ensureHeaders_(sh, HEADERS[SH_DOCS]);
    const keep = sh.getDataRange().getValues().slice(1).filter(r => String(r[0]).trim() && fmtMonth_(r[0]) !== month).map(r => [fmtMonth_(r[0]), fmtDate_(r[1]), r[2], r[3], r[4], r[5], r[6]]);
    const all = keep.concat(rows);
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 7).clearContent();
    sh.getRange(2, 1, all.length, 7).setValues(all);
    if (data.bindings) saveDocBindings_(data.bindings);
  });
  return { month, added: rows.length, sheets: new Set(rows.map(r => r[2])).size };
}
// หน่วยงานผู้ป่วยนอกที่ข้อความในตารางระบุไว้ เช่น "(HPC)" "(OPD+ER)" — "OPD" เฉยๆ (ไม่มีเลข) = หน่วยงานที่ผูกกับสาขานั้น
function docTags_(text) {
  const t = String(text || '');
  return opdUnits_().filter(c => new RegExp('(^|[^A-Za-z0-9])' + c.replace(/[-]/g, '\\-') + '(?![A-Za-z0-9])', 'i').test(t));
}
// แพทย์ในตารางของวันนั้นที่ตรงกับหน่วยงาน: อยู่ในสาขาที่ผูกไว้ (ถ้าข้อความระบุหน่วยงานอื่นเท่านั้นจะไม่นับ) หรือข้อความระบุหน่วยงานนี้ตรงๆ
// others = แพทย์ท่านอื่นในตารางวันนั้น (ใช้เลือกเพิ่มเอง)
function getDocSchedule(token, unit, date) {
  const me = auth_(token);
  if (me.role === 'unit' && unit !== me.unit) throw new Error('ดูได้เฉพาะหน่วยงานตนเอง');
  if (opdUnits_().indexOf(unit) < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('ข้อมูลไม่ถูกต้อง');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SH_DOCS)) return { loaded: false, list: [], others: [] };
  const bind = docBindings_(), list = [], others = [];
  let loaded = false;
  sheet_(SH_DOCS).getDataRange().getValues().slice(1).forEach(r => {
    if (fmtMonth_(r[0]) === String(date).slice(0, 7)) loaded = true;
    if (fmtDate_(r[1]) !== date) return;
    const e = { name: String(r[3]), time: String(r[4] || ''), sheet: String(r[2] || ''), text: String(r[5] || ''), off: String(r[6] || '') === 'งด' };
    const tags = docTags_(e.text), bound = (bind[e.sheet] || []).indexOf(unit) >= 0;
    const hit = tags.indexOf(unit) >= 0 || (bound && (!tags.length || /(^|[^A-Za-z])OPD(?!\s*\d)/i.test(e.text)));
    (hit ? list : others).push(e);
  });
  const start = e => (e.time.match(/^(\d\d)\.(\d\d)/) || [0, 99, 0]).slice(1).join('');
  list.sort((a, b) => start(a) < start(b) ? -1 : start(a) > start(b) ? 1 : 0);
  return { loaded, list, others };
}

// ===== ผูกชื่อแผนกในไฟล์รายชื่อ กับหน่วยงานในระบบ (ADMIN) =====
// เช่น ไฟล์ HR เขียน "ศูนย์อายุรกรรม" แต่ในระบบคือ OPD1 ผูกครั้งเดียว รายชื่อทั้งแผนกย้ายเข้าหน่วยงานนั้น
// และการอัปโหลดครั้งต่อไปจัดเข้าให้เอง  unit = '' คือยกเลิกการผูก
function getAliases(token) {
  if (auth_(token).role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบ');
  return sheet_(SH_ALIASES).getDataRange().getValues().slice(1)
    .filter(r => String(r[0]).trim() && String(r[1]).trim())
    .map(r => ({ alias: String(r[0]).trim(), unit: String(r[1]).trim() }));
}

function saveBindings(token, items) {
  if (auth_(token).role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบ');
  const codes = allUnitCodes_();
  const list = (items || []).filter(x => x && String(x.alias || '').trim() && (x.unit === '' || codes.indexOf(x.unit) >= 0))
    .map(x => ({ alias: String(x.alias).trim(), unit: x.unit, key: normAlias_(x.alias) }));
  const unitOf = {}; list.forEach(x => { unitOf[x.key] = x.unit; });
  withLock_(() => {
    const as = sheet_(SH_ALIASES);
    const keep = as.getDataRange().getValues().slice(1).filter(r => String(r[0]).trim() && !(normAlias_(r[0]) in unitOf))
      .map(r => [String(r[0]).trim(), String(r[1]).trim()]);
    const all = keep.concat(list.filter(x => x.unit).map(x => [x.alias, x.unit]));
    as.getRange(2, 1, Math.max(as.getLastRow() - 1, 1), 2).clearContent();
    if (all.length) as.getRange(2, 1, all.length, 2).setValues(all);

    const st = staffSheet_(), data = st.getDataRange().getValues();
    const units = data.slice(1).map(r => [r[4] === 'upload' && (normAlias_(r[6] || r[1]) in unitOf) ? unitOf[normAlias_(r[6] || r[1])] : r[1]]);
    if (units.length) st.getRange(2, 2, units.length, 1).setValues(units);
  });
  return getAliases(token);
}

// ===== จับคู่ตำแหน่งงานในไฟล์กับบทบาท (หัวหน้า / RN / PN / NA / นศ.) โดยผู้ดูแลระบบ =====
// ตำแหน่งที่ระบบไม่รู้จักจะยังไม่กำหนดบทบาท แอดมินเลือกบทบาทเอง ครั้งเดียว รายชื่อเดิมที่มีตำแหน่งนี้และการอัปโหลดครั้งต่อไปใช้บทบาทที่เลือกทันที
const normTitle_ = s => String(s || '').toLowerCase().replace(/\s+/g, '');
function titleMap_() {
  const m = {};
  sheet_(SH_TITLES).getDataRange().getValues().slice(1).forEach(r => { if (String(r[0]).trim() && String(r[1]).trim()) m[normTitle_(r[0])] = String(r[1]).trim(); });
  return m;
}
function getTitleBindings(token) {
  if (auth_(token).role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบ');
  return sheet_(SH_TITLES).getDataRange().getValues().slice(1)
    .filter(r => String(r[0]).trim() && String(r[1]).trim()).map(r => ({ title: String(r[0]).trim(), role: String(r[1]).trim() }));
}
function saveTitleBindings(token, items) {
  if (auth_(token).role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบ');
  const list = (items || []).filter(x => x && String(x.title || '').trim() && ROLES.indexOf(x.role) >= 0)
    .map(x => ({ title: String(x.title).replace(/\s+/g, ' ').trim(), role: x.role }));
  const roleOf = {}; list.forEach(x => { roleOf[normTitle_(x.title)] = x.role; });
  withLock_(() => {
    const ts = sheet_(SH_TITLES);
    const keep = ts.getDataRange().getValues().slice(1).filter(r => String(r[0]).trim() && !(normTitle_(r[0]) in roleOf))
      .map(r => [String(r[0]).trim(), String(r[1]).trim()]);
    const all = keep.concat(list.map(x => [x.title, x.role]));
    ts.getRange(2, 1, Math.max(ts.getLastRow() - 1, 1), 2).clearContent();
    if (all.length) ts.getRange(2, 1, all.length, 2).setValues(all);

    const st = staffSheet_(), data = st.getDataRange().getValues();
    const roles = data.slice(1).map(r => [r[4] === 'upload' && r[7] && (normTitle_(r[7]) in roleOf) ? roleOf[normTitle_(r[7])] : r[3]]);
    if (roles.length) st.getRange(2, 4, roles.length, 1).setValues(roles);
  });
  return getTitleBindings(token);
}

// ตัดคำนำหน้า ช่องว่าง เครื่องหมาย ออกก่อนเทียบชื่อแผนก (ต้องตรงกับ normUnit ใน Index.html)
function normAlias_(s) {
  return String(s || '').toUpperCase().replace(/ผู้ป่วยใน|ผู้ป่วยนอก|ตึก|หอผู้ป่วย|หอ|แผนก|หน่วยงาน|ชั้น|\s|[-_.\/()]/g, '');
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
    if (name === SH_USERS || name === SH_ROOMS || name === SH_DOCS) sh.getRange('B:B').setNumberFormat('@');
    if (name === SH_ROOMS) sh.getRange('C:C').setNumberFormat('@');
  }
  return sh;
}

// ชีตเก่าที่มีคอลัมน์หัวตารางน้อยกว่าเวอร์ชันใหม่ → เติมหัวตารางที่ขาด
function ensureHeaders_(sh, header) {
  const have = sh.getRange(1, 1, 1, header.length).getValues()[0];
  header.forEach((h, i) => { if (!String(have[i] || '').trim()) sh.getRange(1, i + 1).setValue(h).setFontWeight('bold'); });
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

// เวลา 24 ชม. HH:MM (ไม่ถูกต้อง = ว่าง)
function hm_(v) { const t = String(v == null ? '' : v).trim(); return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : ''; }

function fmtMonth_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM');
  return String(v || '').trim().slice(0, 7);
}

function stamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v);
}
