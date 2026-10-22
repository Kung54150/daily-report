/**
 * Daily Report — ระบบรายงานยอดประจำวันแยกตามแผนก
 * Google Apps Script (ผูกกับ Google Sheets)
 */

// ===== ตั้งค่าแผนกและรายการที่ต้องรายงาน =====
// แต่ละแผนกมีรายการต่างกันได้ แก้ไข/เพิ่มได้ที่นี่
// group = หมวด (ผู้ป่วย / หัตถการ / อื่นๆ), unit = หน่วยนับ
const DEPARTMENTS = {
  OPD: {
    name: 'ผู้ป่วยนอก (OPD)',
    items: [
      { key: 'opd_new', label: 'ผู้ป่วยใหม่', group: 'ผู้ป่วย', unit: 'ราย' },
      { key: 'opd_old', label: 'ผู้ป่วยเก่า', group: 'ผู้ป่วย', unit: 'ราย' },
      { key: 'opd_refer_out', label: 'ส่งต่อ (Refer out)', group: 'ผู้ป่วย', unit: 'ราย' },
      { key: 'vaccine', label: 'ฉีดวัคซีน', group: 'หัตถการ', unit: 'ราย' },
      { key: 'med_cert', label: 'ตรวจสุขภาพ/ใบรับรองแพทย์', group: 'หัตถการ', unit: 'ราย' }
    ]
  },
  ER: {
    name: 'ห้องฉุกเฉิน (ER)',
    items: [
      { key: 'er_total', label: 'ผู้ป่วยทั้งหมด', group: 'ผู้ป่วย', unit: 'ราย' },
      { key: 'er_triage_1_2', label: 'Triage ระดับ 1–2', group: 'ผู้ป่วย', unit: 'ราย' },
      { key: 'er_admit', label: 'Admit', group: 'ผู้ป่วย', unit: 'ราย' },
      { key: 'er_cpr', label: 'CPR', group: 'หัตถการ', unit: 'ครั้ง' },
      { key: 'er_suture', label: 'เย็บแผล', group: 'หัตถการ', unit: 'ราย' }
    ]
  },
  IPD: {
    name: 'ผู้ป่วยใน (IPD)',
    items: [
      { key: 'ipd_census', label: 'ยอดผู้ป่วยคงพยาบาล', group: 'ผู้ป่วย', unit: 'ราย' },
      { key: 'ipd_admit', label: 'รับใหม่', group: 'ผู้ป่วย', unit: 'ราย' },
      { key: 'ipd_discharge', label: 'จำหน่าย', group: 'ผู้ป่วย', unit: 'ราย' },
      { key: 'ipd_dead', label: 'เสียชีวิต', group: 'ผู้ป่วย', unit: 'ราย' }
    ]
  },
  ENDO: {
    name: 'ส่องกล้อง',
    items: [
      { key: 'egd', label: 'EGD', group: 'หัตถการ', unit: 'ราย' },
      { key: 'colono', label: 'Colonoscopy', group: 'หัตถการ', unit: 'ราย' }
    ]
  },
  XRAY: {
    name: 'รังสีวิทยา',
    items: [
      { key: 'xray', label: 'X-ray', group: 'หัตถการ', unit: 'ราย' },
      { key: 'ct', label: 'CT scan', group: 'หัตถการ', unit: 'ราย' },
      { key: 'ca_score', label: 'Calcium score', group: 'หัตถการ', unit: 'ราย' }
    ]
  }
};

const INCIDENT_TYPES = [
  'ความคลาดเคลื่อนทางยา', 'ผู้ป่วยพลัดตกหกล้ม', 'การระบุตัวผู้ป่วยผิด',
  'เครื่องมือ/อุปกรณ์ขัดข้อง', 'ข้อร้องเรียน', 'ความเสี่ยงด้านการติดเชื้อ', 'อื่นๆ'
];
const SEVERITY = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

const SHEET_COUNTS = 'ยอดประจำวัน';
const SHEET_INCIDENTS = 'เหตุการณ์ผิดปกติ';
const HEAD_COUNTS = ['บันทึกเมื่อ', 'วันที่', 'รหัสแผนก', 'แผนก', 'ผู้รายงาน', 'หมวด', 'รายการ', 'จำนวน', 'หน่วย', 'หมายเหตุ'];
const HEAD_INCIDENTS = ['บันทึกเมื่อ', 'วันที่', 'เวลาเกิดเหตุ', 'รหัสแผนก', 'แผนก', 'ผู้รายงาน', 'ประเภท', 'ระดับความรุนแรง', 'รายละเอียด', 'การแก้ไขเบื้องต้น'];

// ===== Web app =====
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('รายงานยอดประจำวัน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getConfig() {
  return { departments: DEPARTMENTS, incidentTypes: INCIDENT_TYPES, severity: SEVERITY };
}

// ===== บันทึกยอด (ส่งซ้ำวัน+แผนกเดิม = แทนที่ของเดิม) =====
function submitCounts(p) {
  const dept = DEPARTMENTS[p.dept];
  if (!dept) throw new Error('ไม่พบแผนก');
  if (!p.date || !p.reporter) throw new Error('กรุณากรอกวันที่และผู้รายงาน');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getSheet_(SHEET_COUNTS, HEAD_COUNTS);
    deleteRows_(sh, r => fmtDate_(r[1]) === p.date && r[2] === p.dept);

    const now = new Date();
    const rows = dept.items.map(it => [
      now, p.date, p.dept, dept.name, p.reporter, it.group, it.label,
      Number(p.values[it.key]) || 0, it.unit, p.note || ''
    ]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEAD_COUNTS.length).setValues(rows);
    return { ok: true, saved: rows.length };
  } finally {
    lock.releaseLock();
  }
}

// ===== บันทึกเหตุการณ์ผิดปกติ =====
function submitIncident(p) {
  const dept = DEPARTMENTS[p.dept];
  if (!dept) throw new Error('ไม่พบแผนก');
  if (!p.date || !p.reporter || !p.type || !p.detail) throw new Error('กรุณากรอกข้อมูลให้ครบ');

  const sh = getSheet_(SHEET_INCIDENTS, HEAD_INCIDENTS);
  sh.appendRow([new Date(), p.date, p.time || '', p.dept, dept.name, p.reporter,
    p.type, p.severity || '', p.detail, p.action || '']);
  return { ok: true };
}

// ===== สรุปรายวัน =====
function getSummary(date) {
  const counts = getSheet_(SHEET_COUNTS, HEAD_COUNTS).getDataRange().getValues().slice(1)
    .filter(r => fmtDate_(r[1]) === date);
  const incidents = getSheet_(SHEET_INCIDENTS, HEAD_INCIDENTS).getDataRange().getValues().slice(1)
    .filter(r => fmtDate_(r[1]) === date);

  const byDept = {};
  Object.keys(DEPARTMENTS).forEach(k => {
    byDept[k] = { name: DEPARTMENTS[k].name, reported: false, reporter: '', items: [], incidents: [] };
  });
  counts.forEach(r => {
    const d = byDept[r[2]];
    if (!d) return;
    d.reported = true;
    d.reporter = r[4];
    d.items.push({ group: r[5], label: r[6], value: r[7], unit: r[8] });
  });
  incidents.forEach(r => {
    const d = byDept[r[3]];
    if (!d) return;
    d.incidents.push({ time: String(r[2]), type: r[6], severity: r[7], detail: r[8], action: r[9] });
  });
  return byDept;
}

// ===== helpers =====
function getSheet_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
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
