/**
 * แบบฟอร์มรายงานของแต่ละหน่วยงาน
 * ใช้ร่วมกันทั้งฝั่งเซิร์ฟเวอร์ (Code.gs) และหน้าเว็บ (ส่งไปผ่าน getBoot)
 *
 * section = { title, fields: [...], sum?: 'ป้ายยอดรวม' }
 *         | { title, type: 'grid', rows: [[key, label]], cols: [[key, label]] }
 * field   = { key, label, unit?, type?: 'num'|'text'|'time', calc?, pctOf? }
 *   calc  = { plus: [keys], minus: [keys] } → คำนวณอัตโนมัติ แก้ไม่ได้
 *   pctOf = key → แสดงเปอร์เซ็นต์เทียบกับช่องนั้น
 *
 * std = ยอดมาตรฐานสำหรับวิเคราะห์ข้ามหน่วยงาน { ชื่อยอด: key | [keys ที่นำมารวม] }
 *   ผู้ป่วยนอก: total, admit, refer   ผู้ป่วยใน: carried, admit, tr_in, tr_out, refer, dead, dc, remain
 * CATEGORIES = จัดกลุ่มประเภทผู้ป่วยคงพยาบาลของทุกตึกให้นับรวมกันได้
 */

const ROLES = ['RN', 'PN', 'NA', 'นศ.', 'อื่นๆ'];
const ROLE_ALIASES = {
  'พยาบาลวิชาชีพ': 'RN', 'rn': 'RN',
  'ผู้ช่วยพยาบาล': 'PN', 'pn': 'PN',
  'ผู้ช่วยเหลือผู้ป่วย': 'NA', 'na': 'NA',
  'นักศึกษาพยาบาล': 'นศ.', 'นศ.ฝึกงานพยาบาล': 'นศ.'
};
const DUTY_TAGS = ['Inc.', 'POC', 'Clerk', 'Cc', 'ออกหน่วย'];
const SHIFTS = ['Day', 'Evening', 'Night'];
const PROBLEM_TYPES = [
  'ความคลาดเคลื่อนทางยา', 'ผู้ป่วยพลัดตกหกล้ม', 'การระบุตัวผู้ป่วยผิด', 'อัตรากำลังไม่เพียงพอ',
  'เครื่องมือ/อุปกรณ์ขัดข้อง', 'ข้อร้องเรียน', 'ความเสี่ยงด้านการติดเชื้อ', 'อื่นๆ'
];
const SEVERITY = ['-', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const O2_MODES = ['Room air', 'Cannula', 'Mask', 'ET tube', 'HF'];

const STD_LABELS = {
  total: 'ผู้ป่วยทั้งหมด', admit: 'Admit', refer: 'Refer',
  carried: 'ยกมา', tr_in: 'รับย้าย', tr_out: 'ย้ายไป', dead: 'Dead', dc: 'จำหน่าย', remain: 'คงพยาบาล'
};
const STD_OPD = ['total', 'admit', 'refer'];
const STD_IPD = ['carried', 'admit', 'tr_in', 'tr_out', 'refer', 'dead', 'dc', 'remain'];
const CATEGORIES = {
  adult: 'ผู้ใหญ่ทั่วไป', child: 'เด็ก', obgyn: 'สูติ-นรีเวช', gyn: 'สูติ-นรีเวช', ob: 'สูติ-นรีเวช',
  med: 'อายุรกรรม', surg: 'ศัลยกรรม', ortho: 'ออร์โธ', pla: 'พลาสติก', uro: 'Uro', ent: 'ENT', skin: 'Skin',
  covid_child: 'Covid-19', covid_adult: 'Covid-19', bedridden: 'Bedridden', pre_or: 'เตรียม OR', post_op: 'Post Op', obs: 'Obs'
};

const N = (key, label, unit) => ({ key, label, unit: unit || 'ราย' });
const TX = (key, label) => ({ key, label, type: 'text' });
const TM = (key, label) => ({ key, label, type: 'time' });

// ===== ผู้ป่วยใน: ยอดเคลื่อนไหว (เหมือนกันทุกตึก) =====
const IPD_CENSUS = {
  title: 'ยอดผู้ป่วย',
  fields: [
    N('carried', 'ยอดยกมา'), N('admit', 'รับใหม่'), N('tr_in', 'รับย้าย'), N('tr_out', 'ย้ายไป'),
    N('refer', 'Refer'), N('dead', 'Dead'), N('dc', 'จำหน่าย'),
    Object.assign(N('remain', 'คงพยาบาล'), {
      calc: { plus: ['carried', 'admit', 'tr_in'], minus: ['tr_out', 'refer', 'dead', 'dc'] }
    })
  ]
};
const IPD_ROOMS = { title: 'ห้องพัก', fields: [TX('rooms_ready', 'ห้องว่างพร้อมรับ'), TX('rooms_clean', 'ห้องรอทำความสะอาด')] };
const IPD_STD = { carried: 'carried', admit: 'admit', tr_in: 'tr_in', tr_out: 'tr_out', refer: 'refer', dead: 'dead', dc: 'dc', remain: 'remain' };
const ipd = types => ({ std: IPD_STD, sections: [IPD_CENSUS, { title: 'ประเภทผู้ป่วยคงพยาบาล', categories: true, fields: types, sum: 'รวม' }, IPD_ROOMS] });

const ADULT_MIX = [
  N('adult', 'ทั่วไปผู้ใหญ่'), N('child', 'เด็ก'), N('obgyn', 'สูติ-นรีเวช'), N('skin', 'Skin'),
  N('ent', 'ENT'), N('uro', 'Uro'), N('ortho', 'Ortho'), N('surg', 'Surg')
];
const PED_MIX = [
  N('child', 'เด็กทั่วไป'), N('adult', 'ผู้ใหญ่ทั่วไป'), N('covid_child', 'Covid-19 เด็ก'), N('covid_adult', 'Covid-19 ผู้ใหญ่')
];

// ===== แบบฟอร์มรายหน่วยงาน =====
const FORMS = {
  // ----- ผู้ป่วยนอก -----
  OPD1: { std: { total: 'total', admit: ['med_admit'] }, sections: [
    { title: 'ยอดรวม', fields: [N('total', 'ยอด Total (Med+Psy)')] },
    { title: 'ผู้ป่วยอายุรกรรม', fields: [N('med', 'ผู้ป่วยอายุรกรรม'), N('med_appt', 'เป็นนัด'), N('med_admit', 'Admit'), N('med_elder', 'ผู้สูงอายุ')] },
    { title: 'ผู้ป่วยจิตเวช', fields: [N('psy', 'ผู้ป่วยจิตเวช'), N('psy_appt', 'เป็นนัด')] },
    { title: 'การดำเนินงาน', fields: [
      TM('close', 'ปิดแผนก'), N('recall', 'โทร recall นัด', 'เคส'),
      Object.assign(N('files', 'สรุปแฟ้มประจำวัน', 'แฟ้ม'), { pctOf: 'total' })
    ] }
  ] },
  OPD3: { std: { total: 'total', admit: ['admit_surg', 'admit_ortho', 'admit_uro', 'admit_pla'] }, sections: [
    { title: 'ภาพรวม', fields: [N('total', 'จำนวนผู้ป่วย'), N('remain', 'ยอดคงเหลือ')] },
    { title: 'ส่งต่อ / Admit', type: 'grid',
      rows: [['er', 'ส่งหัตถการที่ ER'], ['or', 'ส่ง OR'], ['admit', 'Admit']],
      cols: [['surg', 'Surg'], ['ortho', 'Ortho'], ['uro', 'Uro'], ['pla', 'Plastic']] },
    { title: 'ผู้ป่วย Ortho', sum: 'รวม Ortho', fields: [N('ortho_exam', 'ตรวจรักษา'), N('ortho_proc', 'หัตถการ'), N('ortho_fu', 'F/U+ทำแผล')] },
    { title: 'ผู้ป่วย Plastic', sum: 'รวม Plastic', fields: [N('pla_ds', 'หัตถการ d/s'), N('pla_exam', 'ตรวจ'), N('pla_proc', 'หัตถการ'), N('pla_dress', 'ทำแผล')] },
    { title: 'ผู้ป่วย Surg', sum: 'รวม Surg', fields: [N('surg_exam', 'ตรวจรักษา'), N('surg_proc', 'หัตถการ'), N('surg_dress', 'ทำแผล'), N('surg_fu', 'F/U+ทำแผล')] },
    { title: 'อื่นๆ', fields: [N('ccc', 'เจาะเลือดที่ CCC (ไม่รวมยอด OPD3)')] }
  ] },
  'OBG-IVF': { std: { total: ['obg', 'gyn', 'ivf', 'gyn_sp', 'eki', 'stim', 'consult', 'nhso'], admit: ['ad_cs', 'ad_or', 'ad_induce', 'ad_tocolysis', 'ad_obsgyn', 'ad_abort'] }, sections: [
    { title: 'ผู้รับบริการ', sum: 'รวม', fields: [
      N('obg', 'OBG'), N('gyn', 'GYN'), N('ivf', 'IVF'), N('gyn_sp', 'นรีเวชพิเศษ'), N('eki', 'Consult EKI'),
      N('stim', 'Stimulation'), N('consult', 'Consult จาก IPD/HPC'), N('nhso', 'สปสช.+สถาบัน')
    ] },
    { title: 'Admit', sum: 'รวม Admit', fields: [
      N('ad_cs', 'Admit C/S'), N('ad_or', 'Admit OR'), N('ad_induce', 'Admit induction'), N('or_opd', 'OR OPD'),
      N('ad_tocolysis', 'Admit ยับยั้งคลอด'), N('ad_obsgyn', 'Admit OBS&Gyn'), N('ad_abort', 'Admit ยุติการตั้งครรภ์')
    ] },
    { title: 'แพทย์', fields: [N('doctor', 'แพทย์ออกตรวจ', 'คน')] }
  ] },
  PC: { total: 'ยอดรวมทั้งหมด', std: {
    total: ['vac', 'breast', 'vac_nodoc', 'well_nb', 'well_refuse', 'sick', 'sick_admit', 'sick_icu', 'sick_nb', 'sick_refuse', 'dev_act', 'dev_speech', 'dev_doc', 'dev_psy', 'dev_drug', 'dev_psych'],
    admit: ['well_nb', 'sick_admit', 'sick_icu', 'sick_nb'] }, sections: [
    { title: 'เด็กดี', sum: 'รวม', fields: [N('vac', 'วัคซีนตามอายุ'), N('breast', 'คลินิกนมแม่'), N('vac_nodoc', 'วัคซีน ไม่พบแพทย์'), N('well_nb', 'Admit NB'), N('well_refuse', 'ปฏิเสธ Admit')] },
    { title: 'เด็กป่วย', sum: 'รวม', fields: [N('sick', 'เด็กป่วย'), N('sick_admit', 'Admit'), N('sick_icu', 'Admit ICU'), N('sick_nb', 'Admit NB'), N('sick_refuse', 'ปฏิเสธ Admit')] },
    { title: 'ศูนย์พัฒนาการเด็ก', sum: 'รวม', fields: [N('dev_act', 'นักกิจกรรม'), N('dev_speech', 'ฝึกพูด'), N('dev_doc', 'หมอ'), N('dev_psy', 'นักจิต'), N('dev_drug', 'ซื้อยา'), N('dev_psych', 'จิตเวช')] }
  ] },

  // ----- ผู้ป่วยใน -----
  A4: ipd([
    N('child', 'ทั่วไปเด็ก'), N('obgyn', 'สูติ-นรีเวช'), N('surg', 'ศัลยกรรม'), N('ortho', 'ออร์โธ'), N('pla', 'พลาสติก'),
    N('med', 'อายุรกรรม'), N('uro', 'URO'), N('pre_or', 'เตรียม OR'), N('post_op', 'Post Op'), N('obs', 'Obs')
  ]),
  A5: ipd([
    N('adult', 'ทั่วไปผู้ใหญ่'), N('child', 'เด็ก'), N('gyn', 'นรีเวช'), N('ob', 'สูติ'), N('skin', 'Skin'),
    N('ent', 'ENT'), N('uro', 'Uro'), N('ortho', 'Ortho'), N('surg', 'Surg'), N('bedridden', 'Bedridden')
  ]),
  A6: ipd(ADULT_MIX),
  B3: ipd(PED_MIX),
  B4: ipd(PED_MIX),
  B5: ipd(PED_MIX),
  C3: Object.assign(ipd(ADULT_MIX), { draft: true }),
  C4: Object.assign(ipd(ADULT_MIX), { draft: true }),
  C5: Object.assign(ipd(ADULT_MIX), { draft: true }),

  // ----- Special Unit (รอรูปแบบจริง) -----
  ICU: { draft: true, std: IPD_STD, sections: [IPD_CENSUS] },
  'LR-NB': { draft: true, std: { total: ['nl', 'cs'] }, sections: [{ title: 'การคลอด', fields: [N('nl', 'คลอดปกติ'), N('cs', 'ผ่าคลอด'), N('nb', 'ทารกแรกเกิด')] }] },
  'ไตเทียม': { draft: true, std: { total: 'hd' }, sections: [{ title: 'ไตเทียม', fields: [N('hd', 'ฟอกเลือด (HD)'), N('hd_new', 'ผู้ป่วยรายใหม่')] }] },
  OR: { draft: true, std: { total: ['elective', 'emergency'] }, sections: [{ title: 'ห้องผ่าตัด', sum: 'รวม', fields: [N('elective', 'Elective'), N('emergency', 'Emergency')] }, { title: 'อื่นๆ', fields: [N('cancel', 'งดผ่าตัด')] }] }
};

// ผู้ป่วยนอกที่ยังไม่มีแบบฟอร์มจริง
const OPD_DRAFT = { draft: true, std: { total: 'total', admit: 'admit', refer: 'refer' }, sections: [{ title: 'ยอดผู้ป่วย', fields: [N('total', 'ผู้ป่วยทั้งหมด'), N('new', 'ผู้ป่วยใหม่'), N('admit', 'Admit'), N('refer', 'Refer out')] }] };

const GROUPS = [
  { key: 'OPD', name: 'ผู้ป่วยนอก', units: ['OPD1', 'OPD3', 'ER', 'HPC', 'OBG-IVF', 'PC', 'EENT', 'Dent'] },
  { key: 'IPD', name: 'ผู้ป่วยใน', units: ['A4', 'A5', 'A6', 'B3', 'B4', 'B5', 'C3', 'C4', 'C5'] },
  { key: 'SPU', name: 'Special Unit', units: ['ICU', 'LR-NB', 'ไตเทียม', 'OR'] }
];

// ===== คำนวณยอด (ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ — หน้าเว็บมีสำเนาใน Index.html) =====
function fieldNum_(form, vals, key) {
  for (const s of form.sections) for (const f of (s.fields || [])) {
    if (f.key === key && f.calc) return f.calc.plus.reduce((a, k) => a + (Number(vals[k]) || 0), 0) - f.calc.minus.reduce((a, k) => a + (Number(vals[k]) || 0), 0);
  }
  return Number(vals[key]) || 0;
}
function stdValues_(form, vals) {
  const out = {};
  Object.entries(form.std || {}).forEach(([k, spec]) => {
    out[k] = (Array.isArray(spec) ? spec : [spec]).reduce((a, key) => a + fieldNum_(form, vals || {}, key), 0);
  });
  return out;
}
function categoryValues_(form, vals) {
  const out = {};
  form.sections.filter(s => s.categories).forEach(s => s.fields.forEach(f => {
    const n = Number((vals || {})[f.key]) || 0;
    const c = CATEGORIES[f.key] || f.label;
    if (n) out[c] = (out[c] || 0) + n;
  }));
  return out;
}

function buildConfig_() {
  const units = GROUPS.flatMap(g => g.units.map(code => ({ code, group: g.key, form: FORMS[code] || OPD_DRAFT })));
  return {
    groups: GROUPS.map(g => ({ key: g.key, name: g.name })),
    units, roles: ROLES, roleAliases: ROLE_ALIASES, dutyTags: DUTY_TAGS, shifts: SHIFTS,
    problemTypes: PROBLEM_TYPES, severity: SEVERITY, o2Modes: O2_MODES,
    stdLabels: STD_LABELS, stdOpd: STD_OPD, stdIpd: STD_IPD, categories: CATEGORIES
  };
}
