/**
 * Daily Report — ระบบรายงานยอดประจำวันแยกตามหน่วยงาน
 * Google Apps Script (ผูกกับ Google Sheets)
 *
 * หน่วยงานกรอกยอดของตนเอง → ข้อมูลรวมที่ผู้จัดการ → พิมพ์สรุปเป็น A4
 */

// ===== รายการที่ต้องรายงาน (ตัวอย่าง — รอรูปแบบรายงานจริง) =====
// key = รหัสรายการ (ห้ามซ้ำในหน่วยงานเดียวกัน), unit = หน่วยนับ
const OPD_ITEMS = [
  { key: 'total', label: 'ผู้ป่วยทั้งหมด', unit: 'ราย' },
  { key: 'new', label: 'ผู้ป่วยใหม่', unit: 'ราย' },
  { key: 'admit', label: 'Admit', unit: 'ราย' },
  { key: 'refer', label: 'Refer out', unit: 'ราย' }
];
const IPD_ITEMS = [
  { key: 'carried', label: 'ยกมา', unit: 'ราย' },
  { key: 'admit', label: 'รับใหม่', unit: 'ราย' },
  { key: 'tr_in', label: 'รับย้าย', unit: 'ราย' },
  { key: 'discharge', label: 'จำหน่าย', unit: 'ราย' },
  { key: 'tr_out', label: 'ย้ายออก', unit: 'ราย' },
  { key: 'dead', label: 'เสียชีวิต', unit: 'ราย' },
  { key: 'remain', label: 'คงพยาบาล', unit: 'ราย' }
];
const LR_ITEMS = [
  { key: 'nl', label: 'คลอดปกติ', unit: 'ราย' },
  { key: 'cs', label: 'ผ่าคลอด', unit: 'ราย' },
  { key: 'nb', label: 'ทารกแรกเกิด', unit: 'ราย' }
];
const HD_ITEMS = [
  { key: 'hd', label: 'ฟอกเลือด (HD)', unit: 'ราย' },
  { key: 'hd_new', label: 'ผู้ป่วยรายใหม่', unit: 'ราย' }
];
const OR_ITEMS = [
  { key: 'total', label: 'ผ่าตัดทั้งหมด', unit: 'ราย' },
  { key: 'elective', label: 'Elective', unit: 'ราย' },
  { key: 'emergency', label: 'Emergency', unit: 'ราย' },
  { key: 'cancel', label: 'งดผ่าตัด', unit: 'ราย' }
];

// ===== กลุ่มและหน่วยงาน =====
// items = รายการของทั้งกลุ่ม, overrides = หน่วยงานที่รายการต่างจากกลุ่ม
const GROUPS = [
  {
    key: 'OPD', name: 'ผู้ป่วยนอก', items: OPD_ITEMS,
    units: ['OPD1', 'OPD3', 'ER', 'HPC', 'OBG-IVF', 'PC', 'EENT', 'Dent']
  },
  {
    key: 'IPD', name: 'ผู้ป่วยใน', items: IPD_ITEMS,
    units: ['A4', 'A5', 'A6', 'B3', 'B4', 'B5', 'C3', 'C4', 'C5']
  },
  {
    key: 'SPU', name: 'Special Unit', items: IPD_ITEMS,
    units: ['ICU', 'LR-NB', 'ไตเทียม', 'OR'],
    overrides: { 'LR-NB': LR_ITEMS, 'ไตเทียม': HD_ITEMS, 'OR': OR_ITEMS }
  }
];

const PROBLEM_TYPES = [
  'ความคลาดเคลื่อนทางยา', 'ผู้ป่วยพลัดตกหกล้ม', 'การระบุตัวผู้ป่วยผิด', 'อัตรากำลังไม่เพียงพอ',
  'เครื่องมือ/อุปกรณ์ขัดข้อง', 'ข้อร้องเรียน', 'ความเสี่ยงด้านการติดเชื้อ', 'อื่นๆ'
];
const SEVERITY = ['-', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

const SHEET_COUNTS = 'ยอดประจำวัน';
const SHEET_PROBLEMS = 'ปัญหาประจำวัน';
const HEAD_COUNTS = ['บันทึกเมื่อ', 'วันที่', 'กลุ่ม', 'หน่วยงาน', 'ผู้รายงาน', 'รหัสรายการ', 'รายการ', 'จำนวน', 'หน่วย', 'หมายเหตุ'];
const HEAD_PROBLEMS = ['บันทึกเมื่อ', 'วันที่', 'เวลา', 'กลุ่ม', 'หน่วยงาน', 'ผู้รายงาน', 'ประเภท', 'ระดับความรุนแรง', 'รายละเอียด', 'การแก้ไขเบื้องต้น'];

// หน่วยงานทั้งหมด เรียงตามกลุ่ม: { code, group, groupName, items }
const UNITS = GROUPS.flatMap(g => g.units.map(u => ({
  code: u, group: g.key, groupName: g.name,
  items: (g.overrides && g.overrides[u]) || g.items
})));

// ===== Web app =====
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('รายงานยอดประจำวัน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getConfig() {
  return {
    groups: GROUPS.map(g => ({ key: g.key, name: g.name })),
    units: UNITS,
    problemTypes: PROBLEM_TYPES,
    severity: SEVERITY,
    url: ScriptApp.getService().getUrl()
  };
}

// ===== ยอดเดิมของหน่วยงาน (แสดงเมื่อเปิดแก้ไข) =====
function getUnitReport(date, code) {
  const rows = getSheet_(SHEET_COUNTS, HEAD_COUNTS).getDataRange().getValues().slice(1)
    .filter(r => fmtDate_(r[1]) === date && r[3] === code);
  if (!rows.length) return null;
  const values = {};
  rows.forEach(r => { values[r[5]] = r[7]; });
  return { reporter: rows[0][4], note: rows[0][9], values };
}

// ===== บันทึกยอด (ส่งซ้ำวัน+หน่วยงานเดิม = แทนที่ของเดิม) =====
function submitCounts(p) {
  const u = findUnit_(p.unit);
  if (!p.date || !p.reporter) throw new Error('กรุณากรอกวันที่และผู้รายงาน');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getSheet_(SHEET_COUNTS, HEAD_COUNTS);
    deleteRows_(sh, r => fmtDate_(r[1]) === p.date && r[3] === u.code);

    const now = new Date();
    const rows = u.items.map(it => [
      now, p.date, u.groupName, u.code, p.reporter, it.key, it.label,
      Number(p.values[it.key]) || 0, it.unit, p.note || ''
    ]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEAD_COUNTS.length).setValues(rows);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ===== บันทึกปัญหา/เหตุการณ์ผิดปกติ =====
function submitProblem(p) {
  const u = findUnit_(p.unit);
  if (!p.date || !p.reporter || !p.type || !p.detail) throw new Error('กรุณากรอกข้อมูลให้ครบ');

  getSheet_(SHEET_PROBLEMS, HEAD_PROBLEMS).appendRow([
    new Date(), p.date, p.time || '', u.groupName, u.code, p.reporter,
    p.type, p.severity || '-', p.detail, p.action || ''
  ]);
  return { ok: true };
}

// ===== สรุปรายวันสำหรับผู้จัดการ =====
function getSummary(date) {
  const reports = {};
  getSheet_(SHEET_COUNTS, HEAD_COUNTS).getDataRange().getValues().slice(1)
    .filter(r => fmtDate_(r[1]) === date)
    .forEach(r => {
      const rep = reports[r[3]] || (reports[r[3]] = { reporter: r[4], note: r[9], values: {} });
      rep.values[r[5]] = r[7];
    });

  const order = UNITS.map(u => u.code);
  const problems = getSheet_(SHEET_PROBLEMS, HEAD_PROBLEMS).getDataRange().getValues().slice(1)
    .filter(r => fmtDate_(r[1]) === date)
    .map(r => ({ time: fmtTime_(r[2]), unit: r[4], reporter: r[5], type: r[6], severity: r[7], detail: r[8], action: r[9] }))
    .sort((a, b) => order.indexOf(a.unit) - order.indexOf(b.unit) || a.time.localeCompare(b.time));

  return { reports, problems };
}

// ===== helpers =====
function findUnit_(code) {
  const u = UNITS.find(x => x.code === code);
  if (!u) throw new Error('ไม่พบหน่วยงาน');
  return u;
}

function getSheet_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.getRange('B:C').setNumberFormat('@'); // เก็บวันที่/เวลาเป็นข้อความ
  }
  return sh;
}

function deleteRows_(sh, match) {
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (match(data[i])) sh.deleteRow(i + 1);
  }
}

function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v);
}

function fmtTime_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  return String(v);
}
