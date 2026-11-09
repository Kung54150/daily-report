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

const ROLES = ['หัวหน้า', 'RN', 'PN', 'NA', 'เจ้าหน้าที่', 'EMT', 'นศ.']; // ตำแหน่งในเวร (ไม่มี "อื่นๆ"); หัวหน้านับรวมเป็น RN ในตารางอัตรากำลัง
const ROLE_ALIASES = {
  'พยาบาลวิชาชีพ': 'RN', 'rn': 'RN',
  'ผู้ช่วยพยาบาล': 'PN', 'pn': 'PN',
  'ผู้ช่วยเหลือผู้ป่วย': 'NA', 'na': 'NA',
  'นักศึกษาพยาบาล': 'นศ.', 'นศ.ฝึกงานพยาบาล': 'นศ.',
  'emt': 'EMT', 'เจ้าหน้าที่ฉุกเฉินการแพทย์': 'EMT'
};
const DUTY_TAGS = ['Inc.', 'POC', 'Clerk', 'Cc', 'ออกหน่วย'];
const SHIFTS = ['Day', 'Night'];
const PROBLEM_TYPES = [
  'ความคลาดเคลื่อนทางยา', 'ผู้ป่วยพลัดตกหกล้ม', 'การระบุตัวผู้ป่วยผิด', 'อัตรากำลังไม่เพียงพอ',
  'เครื่องมือ/อุปกรณ์ขัดข้อง', 'ข้อร้องเรียน', 'ความเสี่ยงด้านการติดเชื้อ', 'อื่นๆ'
];
const SEVERITY = ['-', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const O2_MODES = ['Room air', 'Cannula', 'Mask', 'ET tube', 'HF'];

// ลูกบอลสีของผู้ป่วยคงพยาบาลแต่ละประเภท (เขียว เหลือง ส้ม แดง) เก็บในช่อง <ประเภท>_g / _y / _o / _r
const BALLS = [['g', 'เขียว'], ['y', 'เหลือง'], ['o', 'ส้ม'], ['r', 'แดง']];
// ห้องผ่าตัดใช้ลูกบอลแค่ 2 สี (แสดง Major ก่อน Minor): แดง = ผ่าตัดใหญ่ (Major) · เขียว = ผ่าตัดเล็ก (Minor) (section.balls ใช้แทน BALLS ได้)
const OR_BALLS = [['r', 'Major'], ['g', 'Minor']];

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

// รายการแบบเลือกจาก Drop down แล้วกดเพิ่มต่อๆ ไป (ask = ต้องระบุชื่อก่อนจึงจะเพิ่มได้ เช่น ชื่อบริษัท)
const LIST_ = (key, title, totalKey, totalLabel, items) => ({ title, type: 'list', key, totalKey, totalLabel, fields: [],
  items: ITEMS_(items) });
const ITEMS_ = items => items.map(x => ({ k: x[0], label: x[1], ask: x[2] || '', custom: !!x[3] }));
// custom = รายการ "เพิ่มรายการ (พิมพ์เอง)": พิมพ์ชื่อหัตถการเองและระบบจำชื่อที่เคยใช้ไว้แนะนำครั้งต่อไป
const CUSTOM_ITEM = ['__custom', '+ เพิ่มรายการ (พิมพ์เอง)', 'ชื่อรายการ', true];
const DENT_ITEMS = [['scale', 'ขูดหินปูน'], ['xray', 'X-ray'], ['fill', 'อุดฟัน'], ['ext_perm', 'ถอนฟันแท้'], ['ext_milk', 'ถอนฟันน้ำนม'], ['exam', 'ตรวจฟัน'], ['exam_prog', 'ตรวจฟันโปรแกรม'], ['splint', 'ติดตามอาการหลังใส่ splint'], CUSTOM_ITEM];
const ENT_ITEMS = [['suction', 'Suction'], ['removefb', 'RemoveFB'], ['blood', 'เจาะเลือด'], ['sinuscope', 'Sinuscope'], ['earpack', 'Ear packing'], ['rhinoscope', 'Rhinoscope'], ['fna', 'FNA'], ['or_admit', 'OR/Admit'], CUSTOM_ITEM];
const EYE_ITEMS = [['va_auto', 'VA+Autotometer'], ['glasses', 'วัดแว่น'], ['eye_prog', 'ตรวจตาในโปรแกรม'], ['retina', 'Retina camera'], ['removefb', 'RemoveFB'], ['dilate', 'Dilate'], ['or', 'OR'], ['inject', 'ฉีดยา'], ['laser', 'Laser'], ['patch', 'ปิดตา'], ['admit', 'Admit'], CUSTOM_ITEM];
const HPC_ITEMS = [
  ['p1', 'ตรวจสุขภาพโปรแกรม 1'], ['p2', 'ตรวจสุขภาพโปรแกรม 2'], ['p3', 'ตรวจสุขภาพโปรแกรม 3'],
  ['stroke', 'ตรวจสุขภาพโปรแกรมคัดกรองหลอดเลือดสมอง'], ['cancer', 'ตรวจสุขภาพโปรแกรมคัดกรองมะเร็ง'], ['mentor', 'ตรวจสุขภาพโปรแกรมพี่เลี้ยงเด็ก'],
  ['wedding', 'ตรวจสุขภาพโปรแกรม แต่งงาน'], ['excl', 'ตรวจสุขภาพโปรแกรม Exclusive Care'], ['liver', 'ตรวจสุขภาพโปรแกรม การทำงานของตับ'],
  ['wisdom', 'ตรวจสุขภาพโปรแกรมโรคทางเพศสัมพันธ์'], ['aia', 'ตรวจสุขภาพประจำปีของบริษัทประกันชีวิตต่างๆ AIA Prestige'], ['boat', 'ตรวจสุขภาพคนเรือกรมเจ้าท่า'],
  ['ekachai', 'ตรวจสุขภาพเอกชัยเนิร์สซิ่งโฮม'], ['company', 'ตรวจสุขภาพประจำปีบริษัท', 'ชื่อบริษัท'],
  ['flu', 'ให้บริการฉีดวัคซีนป้องกันไข้หวัดใหญ่'], ['vax', 'ให้บริการฉีดวัคซีนอื่นๆ'],
  ['lab_back', 'ตรวจทางห้องปฏิบัติการรับผลกลับ'], ['lab_doc', 'ตรวจทางห้องปฏิบัติการและฟังผลกับแพทย์'],
  ['insure', 'ตรวจสุขภาพทำประกัน'], ['cert', 'ขอใบรับรองแพทย์ต่างๆ'],
  ['prejob', 'ตรวจสุขภาพก่อนเข้างานพนักงานโรงพยาบาล'], ['staff_year', 'ตรวจสุขภาพประจำปีพนักงานโรงพยาบาล'], ['sso', 'ตรวจสุขภาพประจำปีประกันสังคม'],
  ['welfare', 'สวัสดิการรักษาพนักงานโรงพยาบาล'], ['est', 'ให้บริการตรวจ Exercise Stress Test'], ['ekg', 'ให้บริการตรวจ EKG'],
  ['free', 'ไม่มีค่าใช้จ่าย'], ['other', 'อื่นๆ', 'ระบุรายการ']
];
// เครื่องนึ่ง/อบ แยกเป็นหม้อ แต่ละหม้อมี Lot (เริ่มต้น minLots Lot กดเพิ่ม Lot เองได้) ค่าเก็บเป็น { รหัสหม้อ: [จำนวนแต่ละ Lot] }
const LOTS_ = (key, title, prefix, totalKey, pots, minLots) => ({ title, type: 'lots', key, prefix, totalKey, totalLabel: 'รวม ' + prefix, unit: 'ชิ้น', minLots: minLots || 3,
  pots: pots.map(x => ({ k: x[0], label: x[1] })), fields: [] });
const N_ = (key, label, unit) => ({ key, label, unit: unit || 'ราย' });
const TX_ = (key, label) => ({ key, label, type: 'text' });
const TM_ = (key, label) => ({ key, label, type: 'time' });

// ===== ผู้ป่วยใน: ยอดเคลื่อนไหว (เหมือนกันทุกตึก) =====
const IPD_CENSUS = {
  title: 'ยอดผู้ป่วย',
  fields: [
    // snap: 'first' = รวมทั้งวันใช้ค่าของเวรแรก (ยอดยกมา)  'last' = ใช้ค่าของเวรสุดท้าย (ยอดคงพยาบาล ประเภทผู้ป่วย ห้อง)
    Object.assign(N_('carried', 'ยอดยกมา'), { snap: 'first' }), N_('admit', 'รับใหม่'),
    // note = ต้องระบุที่มา/ปลายทางเป็นข้อความเมื่อมียอด (เก็บในช่อง <key>_note)
    Object.assign(N_('tr_in', 'รับย้าย'), { note: 'รับย้ายจากที่ไหน' }),
    Object.assign(N_('tr_out', 'ย้ายไป'), { note: 'ย้ายไปที่ไหน' }),
    Object.assign(N_('refer', 'Refer'), { note: 'Refer ไปที่ไหน' }), N_('dead', 'Dead'), N_('dc', 'จำหน่าย'),
    Object.assign(N_('remain', 'คงพยาบาล'), {
      calc: { plus: ['carried', 'admit', 'tr_in'], minus: ['tr_out', 'refer', 'dead', 'dc'] }
    })
  ]
};
// rooms: true = เลือกจากปุ่มห้องของหน่วยงาน (ชีต 'ห้อง') หรือพิมพ์เอง ค่าเก็บเป็นข้อความคั่นด้วยจุลภาค
const RM_ = (key, label) => ({ key, label, type: 'text', rooms: true });
// ICU: ลำดับและหน่วย "เคส" ตามข้อความรายงานของหน่วย (staffSlot = อัตรากำลังระบุ "คนที่ N")
const ICU_CENSUS = Object.assign({}, IPD_CENSUS, {
  fields: ['carried', 'admit', 'tr_in', 'dc', 'tr_out', 'refer', 'dead', 'remain'].map(k => Object.assign({}, IPD_CENSUS.fields.find(f => f.key === k), { unit: 'เคส' }))
});
const IPD_ROOMS = { title: 'ห้องพัก', fields: [RM_('rooms_ready', 'ห้องว่างพร้อมรับ'), RM_('rooms_clean', 'ห้องรอทำความสะอาด')] };
const IPD_STD = { carried: 'carried', admit: 'admit', tr_in: 'tr_in', tr_out: 'tr_out', refer: 'refer', dead: 'dead', dc: 'dc', remain: 'remain' };
const ipd_ = types => ({ std: IPD_STD, sections: [IPD_CENSUS, { title: 'ประเภทผู้ป่วยคงพยาบาล', categories: true, fields: types, sum: 'รวม' }, IPD_ROOMS] });

const ADULT_MIX = [
  N_('adult', 'ทั่วไปผู้ใหญ่'), N_('child', 'เด็ก'), N_('obgyn', 'สูติ-นรีเวช'), N_('skin', 'Skin'),
  N_('ent', 'ENT'), N_('uro', 'Uro'), N_('ortho', 'Ortho'), N_('surg', 'Surg')
];
const PED_MIX = [
  N_('child', 'เด็กทั่วไป'), N_('adult', 'ผู้ใหญ่ทั่วไป'), N_('covid_child', 'Covid-19 เด็ก'), N_('covid_adult', 'Covid-19 ผู้ใหญ่')
];

// ===== แบบฟอร์มรายหน่วยงาน =====
const FORMS = {
  // ----- ผู้ป่วยนอก -----
  // ER ตามตัวอย่างรายงาน (กรอกแยกเวร Day / Night)
  ER: { std: { total: 'total', admit: 'admit', refer: 'refer_out' }, sections: [
    { title: 'ยอดผู้รับบริการ', fields: [
      Object.assign(N_('total', 'ยอดผู้รับบริการทั้งหมด'), { calc: { plus: ['opd', 'admit'], minus: [] } }),
      N_('opd', 'OPD Case'), N_('admit', 'Admit')
    ] },
    { title: 'OPD Case แบ่งตามประเภท (Triage)', sum: 'รวม (ควรเท่ากับยอดผู้รับบริการทั้งหมด)', fields: [
      N_('resus', 'Resuscitation'), N_('emerg', 'Emergency'), N_('urgent', 'Urgency'), N_('semi', 'Semi-urgent'), N_('nonurg', 'Non Urgency')
    ] },
    { title: 'รายการอื่นๆ', fields: [
      N_('refer_out', 'Refer out'), N_('ama', 'AMA'), N_('refer_in', 'Refer In'), N_('wound', 'ทำแผล'), N_('ward_send', 'Ward ส่ง'),
      N_('fu', 'F/U (ER-OPD)'), N_('set_or', 'Set OR (รวม cath lab)'), N_('cpr', 'CPR / CODE8'), N_('delivery', 'คลอด (BBA)'), N_('code3', 'Code 3'),
      N_('wait_admit', 'ฝากรอ admit'), N_('left_wo', 'เคสที่ไม่รอตรวจ'), N_('als', 'ออกเหตุระดับ ALS'), N_('bls', 'ออกเหตุระดับ BLS'), N_('traffic', 'เหตุจราจร')
    ] },
    { title: 'ผู้สูงอายุ > 60 ปี', fields: [N_('elder_er', 'ผู้สูงอายุ ER'), N_('elder_opd', 'ในจำนวนนี้ OPD'), N_('elder_admit', 'ในจำนวนนี้ Admit')] },
    { title: 'Trauma HI', fields: [N_('trauma_hi', 'ยอด Trauma HI'), N_('trauma_admit', 'ในจำนวนนี้ Admit')] },
    { title: 'เคสหลัง 22.00 น. (ใช้กับเวร Night)', fields: [
      N_('late_total', 'ทั้งหมด'), N_('late_opd', 'OPD'), Object.assign(N_('late_admit', 'Admit'), { pctOf: 'late_total' })
    ] }
  ] },
  EENT: { std: { total: 'total' }, sections: [
    { title: 'ยอดผู้ป่วย', fields: [N_('ent_cases', 'ENT', 'เคส'), N_('eye_cases', 'EYE', 'เคส'), Object.assign(N_('total', 'จำนวนคนไข้ทั้งหมด', 'เคส'), { calc: { plus: ['ent_cases', 'eye_cases'], minus: [] } })] },
    Object.assign(LIST_('ent', 'ENT \u00b7 หัตถการ', 'ent_proc', 'รวมหัตถการ ENT', ENT_ITEMS), { unit: 'ครั้ง' }),
    Object.assign(LIST_('eye', 'EYE \u00b7 หัตถการ', 'eye_proc', 'รวมหัตถการ EYE', EYE_ITEMS), { unit: 'ครั้ง' })
  ] },
  // ทันตกรรม: แพทย์พิมพ์ชื่อเอง (ระบบจำชื่อเป็นปุ่ม) แต่ละท่านมีจำนวนเคสและหัตถการ; ยอดรวมผู้รับบริการคำนวณจากเคสของแพทย์ทุกท่าน; ยอด ปกส. ยกมาจากวันก่อนอัตโนมัติ
  Dent: { std: { total: 'total' }, sections: [
    { title: 'ผู้รับบริการทันตกรรม', type: 'docs', key: 'docs', totalKey: 'total', totalLabel: 'ผู้รับบริการทันตกรรม (รวมทั้งแผนก)', unit: 'เคส', procUnit: 'ครั้ง', fields: [], items: ITEMS_(DENT_ITEMS) },
    { title: 'ประกันสังคม (ปกส.)', fields: [
      Object.assign(N_('ins_carry', 'ยอด ปกส. ยกมา', 'เคส'), { carryFrom: 'ins_total' }),
      N_('ins_today', 'จนท. ปกส. (วันนี้)', 'เคส'),
      Object.assign(N_('ins_total', 'รวมยอด ปกส. สะสมปีนี้', 'เคส'), { calc: { plus: ['ins_carry', 'ins_today'], minus: [] } })
    ] }
  ] },
  HPC: { std: { total: 'total' }, sections: [LIST_('svc', 'รายการตรวจ / บริการ', 'total', 'รวมจำนวนผู้รับบริการทั้งหมดในวันนี้', HPC_ITEMS)] },
  OPD1: { std: { total: 'total', admit: ['med_admit'] }, sections: [
    { title: 'ยอดรวม', fields: [N_('total', 'ยอด Total (Med+Psy)')] },
    { title: 'ผู้ป่วยอายุรกรรม', fields: [N_('med', 'ผู้ป่วยอายุรกรรม'), N_('med_appt', 'เป็นนัด'), N_('med_admit', 'Admit'), N_('med_elder', 'ผู้สูงอายุ')] },
    { title: 'ผู้ป่วยจิตเวช', fields: [N_('psy', 'ผู้ป่วยจิตเวช'), N_('psy_appt', 'เป็นนัด')] },
    { title: 'การดำเนินงาน', fields: [
      TM_('close', 'ปิดแผนก'), N_('recall', 'โทร recall นัด', 'เคส'),
      Object.assign(N_('files', 'สรุปแฟ้มประจำวัน', 'แฟ้ม'), { pctOf: 'total' })
    ] }
  ] },
  OPD3: { std: { total: 'total', admit: ['admit_surg', 'admit_ortho', 'admit_uro', 'admit_pla'] }, sections: [
    { title: 'ภาพรวม', fields: [N_('total', 'จำนวนผู้ป่วย'), N_('remain', 'ยอดคงเหลือ')] },
    { title: 'ส่งต่อ / Admit', type: 'grid',
      rows: [['er', 'ส่งหัตถการที่ ER'], ['or', 'ส่ง OR'], ['admit', 'Admit']],
      cols: [['surg', 'Surg'], ['ortho', 'Ortho'], ['uro', 'Uro'], ['pla', 'Plastic']] },
    { title: 'ผู้ป่วย Ortho', sum: 'รวม Ortho', fields: [N_('ortho_exam', 'ตรวจรักษา'), N_('ortho_proc', 'หัตถการ'), N_('ortho_fu', 'F/U+ทำแผล')] },
    { title: 'ผู้ป่วย Plastic', sum: 'รวม Plastic', fields: [N_('pla_ds', 'หัตถการ d/s'), N_('pla_exam', 'ตรวจ'), N_('pla_proc', 'หัตถการ'), N_('pla_dress', 'ทำแผล')] },
    { title: 'ผู้ป่วย Surg', sum: 'รวม Surg', fields: [N_('surg_exam', 'ตรวจรักษา'), N_('surg_proc', 'หัตถการ'), N_('surg_dress', 'ทำแผล'), N_('surg_fu', 'F/U+ทำแผล')] },
    { title: 'อื่นๆ', fields: [N_('ccc', 'เจาะเลือดที่ CCC (ไม่รวมยอด OPD3)')] }
  ] },
  // CCC ตามตารางสรุปของแผนก: ยอดรวมทั้งหมด = ตรวจแรงงานต่างด้าว + ตรวจประจำปี + ตรวจก่อนเข้างาน (จำนวนคน)
  // หัตถการ (ATK EKG เจาะเลือด ตรวจหู VA/อาชีวะ ปอด มือ/หลัง) และแผนกอื่นส่งตรวจ เป็นยอดหัตถการ ไม่นำไปรวมในยอดรวม · ATK อยู่ในรายการหัตถการ
  // (คีย์ช่องเดิมคงไว้ รายงานที่ส่งแล้วยังอ่านได้: total = ตรวจก่อนเข้างาน, all = ยอดรวมทั้งหมด)
  CCC: { std: { total: 'all' }, sections: [
    { title: 'ยอดรวม', fields: [Object.assign(N_('all', 'ยอดรวมทั้งหมด'), { calc: { plus: ['labor', 'annual', 'total'], minus: [] } })],
      hint: 'ยอดรวม = ตรวจแรงงานต่างด้าว + ตรวจประจำปี + ตรวจก่อนเข้างาน' },
    { title: 'ผู้รับบริการ (จำนวนคน)', fields: [N_('labor', 'ตรวจแรงงานต่างด้าว'), N_('annual', 'ตรวจประจำปี'), N_('total', 'ตรวจก่อนเข้างาน')] },
    { title: 'หัตถการ', fields: [N_('ekg', 'EKG'), N_('blood', 'เจาะเลือด'), N_('ear', 'ตรวจหู'), N_('eye', 'VA/อาชีวะ'), N_('lung', 'ปอด'), N_('hand', 'มือ/หลัง'), N_('atk', 'ATK')],
      hint: 'ยอดหัตถการ ไม่ใช่จำนวนคน ไม่นำไปรวมในยอดรวม' },
    { title: 'แผนกอื่นส่งตรวจ', fields: [N_('ref_ear', 'หู'), N_('ref_eye', 'VA/อาชีวะ'), N_('ref_lung', 'ปอด'), N_('ref_hand', 'มือ/หลัง')],
      hint: 'ยอดหัตถการ ไม่ใช่จำนวนคน' },
    { title: 'โดนตาม', fields: [N_('interp', 'ล่าม-OPD', 'ครั้ง')] }
  ] },
  'OBG-IVF': { std: { total: ['obg', 'gyn', 'ivf', 'gyn_sp', 'eki', 'stim', 'consult', 'nhso'], admit: ['ad_cs', 'ad_or', 'ad_induce', 'ad_tocolysis', 'ad_obsgyn', 'ad_abort'] }, sections: [
    { title: 'ผู้รับบริการ', sum: 'รวม', fields: [
      N_('obg', 'OBG'), N_('gyn', 'GYN'), N_('ivf', 'IVF'), N_('gyn_sp', 'นรีเวชพิเศษ'), N_('eki', 'Consult EKI'),
      N_('stim', 'Stimulation'), N_('consult', 'Consult จาก IPD/HPC'), N_('nhso', 'สปสช.+สถาบัน')
    ] },
    { title: 'Admit', sum: 'รวม Admit', fields: [
      N_('ad_cs', 'Admit C/S'), N_('ad_or', 'Admit OR'), N_('ad_induce', 'Admit induction'), N_('or_opd', 'OR OPD'),
      N_('ad_tocolysis', 'Admit ยับยั้งคลอด'), N_('ad_obsgyn', 'Admit OBS&Gyn'), N_('ad_abort', 'Admit ยุติการตั้งครรภ์')
    ] },
    { title: 'แพทย์', fields: [N_('doctor', 'แพทย์ออกตรวจ', 'คน')] }
  ] },
  PC: { staffSubs: ['PC', 'WCC', 'CTDC'], total: 'ยอดรวมทั้งหมด', std: {
    total: ['vac', 'breast', 'vac_nodoc', 'well_nb', 'sick', 'sick_admit', 'sick_icu', 'sick_nb', 'dev_act', 'dev_speech', 'dev_doc', 'dev_psy', 'dev_drug', 'dev_psych'],
    admit: ['well_nb', 'sick_admit', 'sick_icu', 'sick_nb'] }, sections: [
    { title: 'เด็กดี', sum: 'รวม', fields: [N_('vac', 'วัคซีนตามอายุ'), N_('breast', 'คลินิกนมแม่'), N_('vac_nodoc', 'วัคซีน ไม่พบแพทย์'), N_('well_nb', 'Admit NB'), Object.assign(N_('well_refuse', 'ปฏิเสธการรักษา'), { noSum: true })] },
    { title: 'เด็กป่วย', sum: 'รวม', fields: [N_('sick', 'เด็กป่วย OPD case'), N_('sick_admit', 'Admit ward'), N_('sick_icu', 'Admit ICU'), N_('sick_nb', 'Admit NB'), Object.assign(N_('sick_refuse', 'ปฏิเสธการรักษา'), { noSum: true })] },
    { title: 'ศูนย์พัฒนาการเด็ก', sum: 'รวม', fields: [N_('dev_act', 'พบนักกิจกรรม'), N_('dev_speech', 'พบนักฝึกพูด'), N_('dev_doc', 'พบแพทย์'), N_('dev_psy', 'พบนักจิต'), N_('dev_drug', 'ซื้อยา'), N_('dev_psych', 'จิตเวช')] }
  ] },

  // ----- ผู้ป่วยใน -----
  A4: ipd_([
    N_('child', 'ทั่วไปเด็ก'), N_('obgyn', 'สูติ-นรีเวช'), N_('surg', 'ศัลยกรรม'), N_('ortho', 'ออร์โธ'), N_('pla', 'พลาสติก'),
    N_('med', 'อายุรกรรม'), N_('uro', 'URO'), N_('pre_or', 'เตรียม OR'), N_('post_op', 'Post Op'), N_('obs', 'Obs')
  ]),
  A5: ipd_([
    N_('adult', 'ทั่วไปผู้ใหญ่'), N_('child', 'เด็ก'), N_('gyn', 'นรีเวช'), N_('ob', 'สูติ'), N_('skin', 'Skin'),
    N_('ent', 'ENT'), N_('uro', 'Uro'), N_('ortho', 'Ortho'), N_('surg', 'Surg'), N_('bedridden', 'Bedridden')
  ]),
  A6: ipd_(ADULT_MIX),
  B3: ipd_(PED_MIX),
  B4: ipd_(PED_MIX),
  B5: ipd_(PED_MIX),
  C3: Object.assign(ipd_(ADULT_MIX), { draft: true }),
  C4: Object.assign(ipd_(ADULT_MIX), { draft: true }),
  C5: Object.assign(ipd_(ADULT_MIX), { draft: true }),

  // ----- Special Unit (รอรูปแบบจริง) -----
  ICU: { staffSlot: true, std: IPD_STD, sections: [ICU_CENSUS, { title: 'ประเภทผู้ป่วยคงพยาบาล', categories: true, fields: ADULT_MIX, sum: 'รวม' }, IPD_ROOMS] },
  LR: { draft: true, std: { total: ['nl', 'cs'] }, sections: [{ title: 'การคลอด', fields: [N_('nl', 'คลอดปกติ'), N_('cs', 'ผ่าคลอด')] }] },
  NB: { draft: true, std: { total: 'nb' }, sections: [{ title: 'ทารกแรกเกิด', fields: [N_('nb', 'ทารกแรกเกิด'), N_('nb_adm', 'Admit ตึกเด็ก')] }] },
  // CSSD: ST = นึ่งด้วยไอน้ำ 4 หม้อ · EO = อบแก๊ส 1 หม้อ · ยอดรวม = ST + EO (ชิ้น)
  CSSD: { items: true, stdLabels: { total: 'ยอดรวม (ชิ้น)' }, std: { total: 'total' }, sections: [
    { title: 'ยอดรวม', fields: [Object.assign(N_('total', 'ยอดรวม (ST + EO)', 'ชิ้น'), { calc: { plus: ['st_total', 'eo_total'], minus: [] } })] },
    LOTS_('st', 'ST (ST/Pe vacuum) \u00b7 นึ่งด้วยไอน้ำ', 'ST', 'st_total', [['p1', 'หม้อ1'], ['p2', 'หม้อ2'], ['p3', 'หม้อ3'], ['p4', 'หม้อ4']]),
    LOTS_('eo', 'EO (EO) \u00b7 อบแก๊ส', 'EO', 'eo_total', [['p1', 'หม้อ1']])
  ] },
  // ไตเทียม (HEM): ยอดคนไข้ HD / HDF แยกรอบ 1-2 · ยอดรวม = HD + HDF = ผลรวมแยกตามสิทธิ์ · Complication during HD (รายการประจำ + พิมพ์เพิ่มได้) ระบบรวมให้
  'ไตเทียม': { std: { total: 'total' }, sections: [
    { title: 'ยอดรวม', hint: 'Total = HD + HDF ของทุกรอบ (รอบ 1, 2 และรอบเพิ่มเติม)', fields: [
      Object.assign(N_('total', 'Total', 'คน'), { calc: { plus: ['r1_hd', 'r1_hdf', 'r2_hd', 'r2_hdf', 'rx_hd', 'rx_hdf'], minus: [] } }),
      Object.assign(N_('hd', 'HD', 'คน'), { calc: { plus: ['r1_hd', 'r2_hd', 'rx_hd'], minus: [] } }),
      Object.assign(N_('hdf', 'HDF', 'คน'), { calc: { plus: ['r1_hdf', 'r2_hdf', 'rx_hdf'], minus: [] } })
    ] },
    { title: 'รอบ 1', fields: [N_('r1_hd', 'HD', 'คน'), N_('r1_hdf', 'HDF', 'คน'), Object.assign(N_('r1', 'รวมรอบ 1', 'คน'), { calc: { plus: ['r1_hd', 'r1_hdf'], minus: [] } })] },
    { title: 'รอบ 2', fields: [N_('r2_hd', 'HD', 'คน'), N_('r2_hdf', 'HDF', 'คน'), Object.assign(N_('r2', 'รวมรอบ 2', 'คน'), { calc: { plus: ['r2_hd', 'r2_hdf'], minus: [] } })] },
    // rounds = รอบที่ 3 ขึ้นไป กด "+ เพิ่มรอบ" เอง (เก็บ [{ hd, hdf }] ยอดรวม HD/HDF ของรอบเหล่านี้อยู่ในช่อง hdKey / hdfKey)
    { title: 'รอบเพิ่มเติม', hint: 'ถ้าวันนี้มีมากกว่า 2 รอบ กด + เพิ่มรอบ', rounds: { key: 'rx', startAt: 3, hdKey: 'rx_hd', hdfKey: 'rx_hdf', addLabel: 'เพิ่มรอบ' }, fields: [] },
    { title: 'แยกตามสิทธิ์', sum: 'รวม', sumEq: 'total', fields: [
      N_('r_cgd', 'กรมบัญชีกลาง (รูดบัตร)', 'คน'), N_('r_bkk', 'ข้าราชการ กทม.', 'คน'), N_('r_local', 'ข้าราชการ อปท.', 'คน'),
      N_('r_sso', 'ประกันสังคม', 'คน'), N_('r_uc', 'สปสช. (Authen ครบ)', 'คน'), N_('r_other', 'รัฐวิสาหกิจ / เงินสด', 'คน')
    ] },
    // extra = แถวที่ผู้ใช้กด "+ เพิ่ม" แล้วพิมพ์ชื่อ + จำนวนเอง (เก็บ { name, n }) ยอดรวมของแถวเหล่านี้อยู่ในช่อง totalKey
    { title: 'Complication during HD', extra: { key: 'cx', totalKey: 'cx_total', addLabel: 'เพิ่ม Complication', noun: ' Complication', placeholder: 'ชื่อ Complication', unit: 'case' }, fields: [
      Object.assign(N_('comp_total', 'รวม Complication', 'case'), { calc: { plus: ['c_cramp', 'c_htn', 'c_arr', 'c_hypo', 'c_glu', 'cx_total'], minus: [] } }),
      N_('c_cramp', 'Muscle cramp', 'case'), N_('c_htn', 'Hypertension', 'case'), N_('c_arr', 'Arrhythmia', 'case'),
      N_('c_hypo', 'Hypotension', 'case'), N_('c_glu', 'Hypoglycemia', 'case')
    ] }
  ] },
  // ห้องผ่าตัด ตามสถิติรายเดือนของหน่วย: ยอดรวม = Major + Minor (ลูกบอลแดง = Major, เขียว = Minor ของแต่ละแผนก)
  // Emergency + Elective ต้องเท่ากับยอดรวม · ส่งมาจาก OPD/IPD · สิทธิการรักษาของแต่ละเคส
  OR: { std: { total: 'total' }, sections: [
    { title: 'ยอดผ่าตัด', fields: [Object.assign(N_('total', 'ยอดรวม (Major + Minor)', 'เคส'), { calc: { plus: ['obs', 'gyn', 'surg', 'ortho', 'scope', 'ent', 'cvt', 'pla', 'neuro', 'uro', 'eye', 'ivf', 'tese', 'med', 'xray', 'ane'], minus: [] } })] },
    { title: 'Emergency / Elective', sum: 'รวม', sumEq: 'total', fields: [N_('emergency', 'Emergency case', 'เคส'), N_('elective', 'Elective case', 'เคส')] },
    { title: 'ผ่าตัดแยกตามแผนก', categories: true, additive: true, balls: OR_BALLS, catUnit: 'เคส', sum: 'รวม', fields: [N_('obs', 'OBS', 'เคส'), N_('gyn', 'GYN', 'เคส'), N_('surg', 'SURG', 'เคส'), N_('ortho', 'ORTHO', 'เคส'), N_('scope', 'SCOPE', 'เคส'), N_('ent', 'ENT', 'เคส'), N_('cvt', 'CVT', 'เคส'), N_('pla', 'PLASTIC', 'เคส'), N_('neuro', 'NEURO', 'เคส'), N_('uro', 'URO', 'เคส'), N_('eye', 'EYE', 'เคส'), N_('ivf', 'IVF (OPU / FET)', 'เคส'), N_('tese', 'TESE', 'เคส'), N_('med', 'MED', 'เคส'), N_('xray', 'X-RAY', 'เคส'), N_('ane', 'ANE', 'เคส')] },
    { title: 'ส่งมาจากหน่วยงาน', fields: [N_('src_opd', 'ผู้ป่วยนอก (OPD)', 'เคส'), N_('src_ipd', 'ผู้ป่วยใน (IPD)', 'เคส')] },
    { title: 'สิทธิการรักษา', sum: 'รวม', fields: [N_('r_self', 'ทั่วไป', 'เคส'), N_('r_ins', 'ประกันชีวิต', 'เคส'), N_('r_fund', 'กองทุน', 'เคส'), N_('r_contract', 'Contract', 'เคส'), N_('r_act', 'พรบ.', 'เคส'), N_('r_ucep', 'UCEP', 'เคส'), N_('r_welfare', 'สวัสดิการ', 'เคส')] }
  ] },};

// ผู้ป่วยนอกที่ยังไม่มีแบบฟอร์มจริง
const OPD_DRAFT = { draft: true, std: { total: 'total', admit: 'admit', refer: 'refer' }, sections: [{ title: 'ยอดผู้ป่วย', fields: [N_('total', 'ผู้ป่วยทั้งหมด'), N_('new', 'ผู้ป่วยใหม่'), N_('admit', 'Admit'), N_('refer', 'Refer out')] }] };

const GROUPS = [
  { key: 'OPD', name: 'ผู้ป่วยนอก', units: ['OPD1', 'OPD3', 'ER', 'HPC', 'CCC', 'OBG-IVF', 'PC', 'EENT', 'Dent'] },
  { key: 'IPD', name: 'ผู้ป่วยใน', units: ['A4', 'A5', 'A6', 'B3', 'B4', 'B5', 'C3', 'C4', 'C5'] },
  { key: 'SPU', name: 'Special Unit', units: ['ICU', 'LR', 'NB', 'ไตเทียม', 'OR', 'CSSD'] }
];

// ===== คำนวณยอด (ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ — หน้าเว็บมีสำเนาใน Index.html) =====
function fieldNum_(form, vals, key) {
  for (const s of form.sections) for (const f of (s.fields || [])) {
    if (f.key === key && f.calc && !(f.calc.manual && vals[key] !== undefined && vals[key] !== '')) return f.calc.plus.reduce((a, k) => a + (Number(vals[k]) || 0), 0) - f.calc.minus.reduce((a, k) => a + (Number(vals[k]) || 0), 0);
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
// ลูกบอลสีของแบบฟอร์ม: ใช้ของหมวดที่ระบุ balls ไว้ ไม่งั้นใช้ BALLS มาตรฐาน
function formBalls_(form) {
  const sec = form.sections.find(x => x.categories && x.balls);
  return sec ? sec.balls : BALLS;
}
function ballValues_(form, vals) {
  const out = { g: 0, y: 0, o: 0, r: 0 };
  form.sections.filter(s => s.categories).forEach(s => s.fields.forEach(f => BALLS.forEach(b => { out[b[0]] += Number((vals || {})[f.key + '_' + b[0]]) || 0; })));
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

// ผู้ป่วยในแยกเป็นตึก A / B / C ตามตัวอักษรหน้ารหัสหน่วยงาน (A4 → ตึก A)
function subGroups_(g) {
  if (g.key !== 'IPD') return [{ label: g.name, sub: '', units: g.units }];
  const by = {};
  g.units.forEach(u => { const k = u.charAt(0); (by[k] = by[k] || []).push(u); });
  return Object.keys(by).sort().map(k => ({ label: g.name + ' \u00b7 ตึก ' + k, sub: 'ตึก ' + k, units: by[k] }));
}

// ผู้ป่วยนอกทุกแผนกยกเว้น ER ไม่มีเวร Night
function unitShifts_(group, code) {
  return (group === 'OPD' && code !== 'ER') || code === 'CSSD' || code === 'ไตเทียม' ? ['Day'] : SHIFTS; // CSSD / ไตเทียม รายงานรายวัน (เวร Day เวรเดียว)
}

function buildConfig_() {
  const subOf = {};
  GROUPS.forEach(g => subGroups_(g).forEach(s => s.units.forEach(u => { subOf[u] = s.sub; })));
  const units = GROUPS.flatMap(g => g.units.map(code => ({ code, group: g.key, sub: subOf[code], shifts: unitShifts_(g.key, code), form: FORMS[code] || OPD_DRAFT, staffSlot: !!(FORMS[code] && FORMS[code].staffSlot) })));
  return {
    groups: GROUPS.map(g => ({ key: g.key, name: g.name })),
    sections: GROUPS.flatMap(g => subGroups_(g).map(s => ({ group: g.key, label: s.label, sub: s.sub, units: s.units }))),
    balls: BALLS, units, roles: ROLES, roleAliases: ROLE_ALIASES, dutyTags: DUTY_TAGS, shifts: SHIFTS,
    problemTypes: PROBLEM_TYPES, severity: SEVERITY, o2Modes: O2_MODES,
    stdLabels: STD_LABELS, stdOpd: STD_OPD, stdIpd: STD_IPD, categories: CATEGORIES
  };
}
