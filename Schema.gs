/**
 * แบบฟอร์มรายงานของแต่ละหน่วยงาน
 * ใช้ร่วมกันทั้งฝั่งเซิร์ฟเวอร์ (Code.gs) และหน้าเว็บ (ส่งไปผ่าน getBoot)
 *
 * section = { title, fields: [...], sum?: 'ป้ายยอดรวม' }
 *         | { title, type: 'grid', rows: [[key, label]], cols: [[key, label]] }
 * field   = { key, label, unit?, type?: 'num'|'text'|'time', calc?, pctOf? }
 *   calc  = { plus: [keys], minus: [keys] } → คำนวณอัตโนมัติ แก้ไม่ได้
 *   pctOf = key → แสดงเปอร์เซ็นต์เทียบกับช่องนั้น
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
const ipd = types => [IPD_CENSUS, { title: 'ประเภทผู้ป่วยคงพยาบาล', fields: types, sum: 'รวม' }, IPD_ROOMS];

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
  OPD1: { sections: [
    { title: 'ยอดรวม', fields: [N('total', 'ยอด Total (Med+Psy)')] },
    { title: 'ผู้ป่วยอายุรกรรม', fields: [N('med', 'ผู้ป่วยอายุรกรรม'), N('med_appt', 'เป็นนัด'), N('med_admit', 'Admit'), N('med_elder', 'ผู้สูงอายุ')] },
    { title: 'ผู้ป่วยจิตเวช', fields: [N('psy', 'ผู้ป่วยจิตเวช'), N('psy_appt', 'เป็นนัด')] },
    { title: 'การดำเนินงาน', fields: [
      TM('close', 'ปิดแผนก'), N('recall', 'โทร recall นัด', 'เคส'),
      Object.assign(N('files', 'สรุปแฟ้มประจำวัน', 'แฟ้ม'), { pctOf: 'total' })
    ] }
  ] },
  OPD3: { sections: [
    { title: 'ภาพรวม', fields: [N('total', 'จำนวนผู้ป่วย'), N('remain', 'ยอดคงเหลือ')] },
    { title: 'ส่งต่อ / Admit', type: 'grid',
      rows: [['er', 'ส่งหัตถการที่ ER'], ['or', 'ส่ง OR'], ['admit', 'Admit']],
      cols: [['surg', 'Surg'], ['ortho', 'Ortho'], ['uro', 'Uro'], ['pla', 'Plastic']] },
    { title: 'ผู้ป่วย Ortho', sum: 'รวม Ortho', fields: [N('ortho_exam', 'ตรวจรักษา'), N('ortho_proc', 'หัตถการ'), N('ortho_fu', 'F/U+ทำแผล')] },
    { title: 'ผู้ป่วย Plastic', sum: 'รวม Plastic', fields: [N('pla_ds', 'หัตถการ d/s'), N('pla_exam', 'ตรวจ'), N('pla_proc', 'หัตถการ'), N('pla_dress', 'ทำแผล')] },
    { title: 'ผู้ป่วย Surg', sum: 'รวม Surg', fields: [N('surg_exam', 'ตรวจรักษา'), N('surg_proc', 'หัตถการ'), N('surg_dress', 'ทำแผล'), N('surg_fu', 'F/U+ทำแผล')] },
    { title: 'อื่นๆ', fields: [N('ccc', 'เจาะเลือดที่ CCC (ไม่รวมยอด OPD3)')] }
  ] },
  'OBG-IVF': { sections: [
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
  PC: { total: 'ยอดรวมทั้งหมด', sections: [
    { title: 'เด็กดี', sum: 'รวม', fields: [N('vac', 'วัคซีนตามอายุ'), N('breast', 'คลินิกนมแม่'), N('vac_nodoc', 'วัคซีน ไม่พบแพทย์'), N('well_nb', 'Admit NB'), N('well_refuse', 'ปฏิเสธ Admit')] },
    { title: 'เด็กป่วย', sum: 'รวม', fields: [N('sick', 'เด็กป่วย'), N('sick_admit', 'Admit'), N('sick_icu', 'Admit ICU'), N('sick_nb', 'Admit NB'), N('sick_refuse', 'ปฏิเสธ Admit')] },
    { title: 'ศูนย์พัฒนาการเด็ก', sum: 'รวม', fields: [N('dev_act', 'นักกิจกรรม'), N('dev_speech', 'ฝึกพูด'), N('dev_doc', 'หมอ'), N('dev_psy', 'นักจิต'), N('dev_drug', 'ซื้อยา'), N('dev_psych', 'จิตเวช')] }
  ] },

  // ----- ผู้ป่วยใน -----
  A4: { sections: ipd([
    N('child', 'ทั่วไปเด็ก'), N('obgyn', 'สูติ-นรีเวช'), N('surg', 'ศัลยกรรม'), N('ortho', 'ออร์โธ'), N('pla', 'พลาสติก'),
    N('med', 'อายุรกรรม'), N('uro', 'URO'), N('pre_or', 'เตรียม OR'), N('post_op', 'Post Op'), N('obs', 'Obs')
  ]) },
  A5: { sections: ipd([
    N('adult', 'ทั่วไปผู้ใหญ่'), N('child', 'เด็ก'), N('gyn', 'นรีเวช'), N('obs', 'สูติ'), N('skin', 'Skin'),
    N('ent', 'ENT'), N('uro', 'Uro'), N('ortho', 'Ortho'), N('surg', 'Surg'), N('bedridden', 'Bedridden')
  ]) },
  A6: { sections: ipd(ADULT_MIX) },
  B3: { sections: ipd(PED_MIX) },
  B4: { sections: ipd(PED_MIX) },
  B5: { sections: ipd(PED_MIX) },
  C3: { draft: true, sections: ipd(ADULT_MIX) },
  C4: { draft: true, sections: ipd(ADULT_MIX) },
  C5: { draft: true, sections: ipd(ADULT_MIX) },

  // ----- Special Unit (รอรูปแบบจริง) -----
  ICU: { draft: true, sections: [IPD_CENSUS] },
  'LR-NB': { draft: true, sections: [{ title: 'การคลอด', fields: [N('nl', 'คลอดปกติ'), N('cs', 'ผ่าคลอด'), N('nb', 'ทารกแรกเกิด')] }] },
  'ไตเทียม': { draft: true, sections: [{ title: 'ไตเทียม', fields: [N('hd', 'ฟอกเลือด (HD)'), N('hd_new', 'ผู้ป่วยรายใหม่')] }] },
  OR: { draft: true, sections: [{ title: 'ห้องผ่าตัด', sum: 'รวม', fields: [N('elective', 'Elective'), N('emergency', 'Emergency')] }, { title: 'อื่นๆ', fields: [N('cancel', 'งดผ่าตัด')] }] }
};

// ผู้ป่วยนอกที่ยังไม่มีแบบฟอร์มจริง
const OPD_DRAFT = { draft: true, sections: [{ title: 'ยอดผู้ป่วย', fields: [N('total', 'ผู้ป่วยทั้งหมด'), N('new', 'ผู้ป่วยใหม่'), N('admit', 'Admit'), N('refer', 'Refer out')] }] };

const GROUPS = [
  { key: 'OPD', name: 'ผู้ป่วยนอก', units: ['OPD1', 'OPD3', 'ER', 'HPC', 'OBG-IVF', 'PC', 'EENT', 'Dent'] },
  { key: 'IPD', name: 'ผู้ป่วยใน', units: ['A4', 'A5', 'A6', 'B3', 'B4', 'B5', 'C3', 'C4', 'C5'] },
  { key: 'SPU', name: 'Special Unit', units: ['ICU', 'LR-NB', 'ไตเทียม', 'OR'] }
];

function buildConfig_() {
  const units = GROUPS.flatMap(g => g.units.map(code => ({ code, group: g.key, form: FORMS[code] || OPD_DRAFT })));
  return {
    groups: GROUPS.map(g => ({ key: g.key, name: g.name })),
    units, roles: ROLES, roleAliases: ROLE_ALIASES, dutyTags: DUTY_TAGS, shifts: SHIFTS,
    problemTypes: PROBLEM_TYPES, severity: SEVERITY
  };
}
