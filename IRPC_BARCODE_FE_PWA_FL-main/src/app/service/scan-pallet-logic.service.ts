import { Injectable } from '@angular/core';

//  Location ที่ Pallet จะถูกวาง (ปลายทาง)
export interface PalletTargetLocation {
  location: string;
  //  เฉพาะงาน Inbound ที่ to_location เลือกได้มากกว่า 1 ที่ -> โชว์โควต้าที่เหลือของ location นั้นๆ กำกับไว้ (undefined = backend ไม่ส่งมา/ไม่เกี่ยว)
  completeQty?: number;
  totalQty?: number;
}

//  ข้อมูลที่แยกออกมาจากโค้ดสแกน (costCenter|grade|lot|runningNo|palletId)
//  dateTime เป็น field เสริม (ไม่บังคับ) จากฟอร์แมตใหม่ 6 ส่วน costCenter|grade|lot|runningNo|palletId|dateTime
//  (เช่น "211006" = วันที่ 21 เวลา 10:06 สองหลักแรก=วันที่ สี่หลักหลัง=เวลา) เพิ่มเข้ามาแก้ปัญหา Pallet No. ซ้ำกันได้
//  ในล็อตเดียวกัน (คนละวัน/เวลา) -> โค้ด 5 ส่วนเดิมยังใช้งานได้ปกติไม่ต้องย้าย ไม่มี field นี้แค่เป็น undefined เหมือนเดิม
//  ใช้แค่ตอนเช็คตอนสแกนเท่านั้น ไม่เอาไปแสดงผลหน้าจอ
export interface ParsedScanCode {
  costCenter: string;
  grade: string;
  lot: string;
  runningNo: string;
  palletId: string;
  dateTime?: string;
}

//  โค้ด "เอาทั้ง pallet" พิเศษ ต่างจาก QR ถุงปกติ: PL<code>|grade|lot|qty (4 ส่วน ไม่ใช่ 5, ไม่มี runningNo แยก)
//  qty มาให้ตรงๆ ในโค้ดเลย -> สแกนครั้งเดียวยืนยัน pallet ทั้งใบได้ทันที ไม่ต้องนับ BAG_REQUIRED_COUNT ถุงเหมือนโค้ดปกติ
export interface FullPalletScanCode {
  rawCode: string;
  grade: string;
  lot: string;
  qty: number;
}

//  โค้ด Jumbo Bag: costCenter|grade|lot|runningNo|palletId|qty|type (7 ส่วน) — 5 ส่วนแรกตำแหน่ง/รูปแบบเหมือนถุงปกติเป๊ะ
//  (ใช้ ParsedScanCode เดิมได้เลย ไม่ต้องแยก type ใหม่) มี qty แนบมาในโค้ดเหมือนโค้ด PL -> สแกนครั้งเดียวจบ ไม่ต้องยิง
//  GetProcessPallet หาน้ำหนักจริงเหมือนถุงปกติ ส่วน type (ตำแหน่งสุดท้าย เช่น "JB1") ไม่มีนัยยะฝั่งหน้าบ้าน ไม่ต้องเก็บ
export interface JumboBagScanCode extends ParsedScanCode {
  qty: number;
}

//  Lot ย่อยของ from_location เดียว (backend ส่ง addon_lot เป็น array แบบนี้ -> 1 location มีได้หลาย Lot)
export interface AddonLotEntry {
  lot: string;
  qty: number;
}

//  Pallet ที่รอการนำไปวาง (หลังจากสแกนถุงครบแล้ว)
export interface PalletToPlaceItem {
  id: string | null;
  grade: string;
  lotNo: string;
  qty: number;
  isActive: boolean;
  isChecked: boolean;
  isSelectedForPlacement: boolean;
  targetLocations: PalletTargetLocation[];
  sourceLocation?: string;
  itemId?: number;
  fromLocationId?: number;

  //  โค้ด QR ที่สแกนตอน Get (Special Package = ถุงใบที่ยืนยัน grade/lot/location ต้นทาง, งานปกติ = ถุงใบล่าสุด
  //  ที่ยืนยัน Pallet, โค้ด PL = rawCode "PLM..." เท่านั้น) เก็บไว้ใช้ส่งซ้ำตอน Put-away/Delete (ยังไม่มี -> ไล่หาจาก receive_pallet ของ backend แทน)
  qrCode?: string;

  //  งานปกติเท่านั้น: โค้ดเต็มของ "ทุกถุง" ที่สแกนยืนยัน Pallet นี้ (qrCode ด้านบนเก็บแค่ใบล่าสุด) ไว้จับว่าถุงไหนซ้ำ/เป็นของ Pallet ไหน
  //  ด้วยโค้ดเต็ม (costCenter|grade|lot|runningNo|palletId) แทน palletId อย่างเดียว เพราะ palletId ซ้ำข้าม grade/lot ได้
  //  (ไม่มีตอน restore จาก backend หลัง reload -> ใช้ qrCode = scanned_qr_code ของ backend แทน)
  bagCodes?: string[];

  //  Special Package เท่านั้น: ข้อความ progress "x/total ถุง" สำหรับแสดงผล (qty ยังคงเป็นจำนวนที่รอวางจริงไว้ใช้ยิง API)
  progressLabel?: string;

  //  Special Package เท่านั้น: เลข Pallet (จาก "Add Pallet") ที่รายการนี้อยู่ -> แนบไปกับ Get/Put ทุกครั้งว่าเป็นกล่องไหน
  palletSeq?: number;

  //  Special Package เท่านั้น: id สังเคราะห์ของรายการนี้ใน _jobDataRaw.pallets.receive_pallet (ไว้หาเพื่อลบออกตอน put-away สำเร็จ)
  specialEntryId?: number;
  
  //  Special Package เท่านั้น: หลาย Get (grade/lot เดียวกัน) ที่ถูกรวมเป็นรายการเดียวตอนกด "เตรียมเอาไปวาง" -> เก็บ id ทุกตัวไว้
  //  (ใช้แทน specialEntryId เดี่ยวๆ เมื่อรายการนี้เป็นผลรวม) ต้องลบออกจาก receive_pallet ให้ครบทุกตัวตอน put-away สำเร็จ
  specialEntryIds?: number[];

  //  โค้ด PL เท่านั้น: id ตัวเลขจริงของ backend (เช่น 222) จาก response ตอน Get สำเร็จ -> ใช้"แสดงผล"ให้ user เท่านั้น
  //  (id หลักของ pallet ยังเป็น rawCode "PLM..." เหมือนเดิมเพื่อกันสแกนซ้ำ/เทียบ conflict ถูกต้อง ไม่งั้นถ้าเปลี่ยน id หลักเลย จะสแกนโค้ดเดิมซ้ำแล้วไม่โดนจับว่าซ้ำ)
  backendId?: string;

  //  Cost Center ที่สแกนได้จากโค้ด QR สดๆ -> ใช้ "แสดงผล" ในการ์ดผลลัพธ์เท่านั้น (ไม่ใช้เทียบ/ส่ง API ที่ไหนเลย)
  //  pallet ที่ reconstruct ตอน reload (จาก receive_pallet ของ backend) ไม่มีค่านี้ให้ใส่ เพราะ backend ไม่ได้เก็บ
  //  costCenter แยกไว้ต่างหาก -> undefined ไปแสดง "-" แทน เป็น field ที่ไม่ครบทุก pallet ตั้งแต่ต้นโดยตั้งใจ
  costCenter?: string;
}

//  งาน Special Package: กลุ่มรายการที่ Get แล้วแต่ยังไม่ put away ของ 1 pallet (palletSeq เดียวกัน อาจมีหลาย grade/lot ผสมกัน)
export interface SpecialPalletGroup {
  seq: number;
  entries: PalletToPlaceItem[];
}

//  กลุ่มถุงที่กำลังสแกนอยู่ ณ ขณะนี้ (นับถุงต่อ Pallet 1 ใบ)
export interface CurrentScanGroup {
  key: string;
  palletId: string;
  itemId: number;
  runningNos: Set<string>;
  //  โค้ดเต็มของถุงที่สแกนแล้วใน Pallet นี้ -> ใช้จับถุงซ้ำ (runningNos ไว้แสดงผลอย่างเดียว)
  codes: Set<string>;
  //  เวลา (Date.now()) ของถุงใบล่าสุดที่สแกนสำเร็จในกลุ่มนี้ -> ใช้เช็คว่าสแกนถุงถัดไปเร็วผิดปกติไหม (MIN_BAG_SCAN_INTERVAL_MS)
  lastScanAt: number;
}

//  รายการ Pallet ของ Session ปัจจุบัน ใช้ประกอบการคำนวณโควต้า/ตรวจสอบ Pallet ซ้ำ
//  outboundVerificationPallets คือพาเลทที่สแกนครบแล้วแต่ยังรอ API ตรวจสอบอยู่
export interface SessionPalletLists {
  palletToPlaceList: PalletToPlaceItem[];
  palletsAwaitingSourceLocation: PalletToPlaceItem[];
  completedPalletList: PalletToPlaceItem[];
  outboundVerificationPallets?: PalletToPlaceItem[];
  //  ชุด backendId + qrCode (normalize แล้ว) ของพาเลทที่ backend ยืนยันแล้วจริง (อยู่ใน receive_pallet/complete_pallet
  //  ของ rawJob ปัจจุบัน) ใช้กัน sumSessionPalletWeightAtLocation/countSessionPalletsAtLocation นับพาเลทใบเดียวกันซ้ำ
  //  สองรอบ (รอบนึงผ่าน location.receive_qty/complete_qty ตรงๆ อีกรอบผ่านการนับ list ฝั่งเครื่องเอง) optional เพราะ
  //  จุดที่สร้าง lists ตอน bootstrap list แรกสุด (buildPalletToPlaceList) ยังไม่ต้องใช้ค่านี้
  knownServerPalletKeys?: Set<string>;
}

//  Service รวม Logic การสแกน/แยกวิเคราะห์โค้ด, ตรวจสอบความถูกต้อง และ resolve item/location ที่เกี่ยวข้อง
//  (ไม่มีการยิง API หรือแก้ state ของ component โดยตรง — รับข้อมูลปัจจุบันเข้ามาแล้วคืนผลลัพธ์ให้ component ตัดสินใจต่อ)
@Injectable({
  providedIn: 'root',
})

export class ScanPalletLogicService {

  //  จุดเข้าเดียวที่ทุกหน้าเรียก -> แยกไปตามจำนวนส่วนของโค้ด (5 = เดิม, 6 = ใหม่มี dateTime) คนละฟังก์ชันกันชัดเจน
  //  ไม่ต้องแก้ที่เรียกใช้เลยสักจุด (scan-pallet/pallet-management/report-broken-bag/load-to-truck เรียกตัวนี้เหมือนเดิม)
  parseScanCode(code: string): ParsedScanCode | null {
    const parts = code.split('|').map((p) => p.trim());
    if (parts.length === 6) return this.parseScanCode6Part(parts);
    if (parts.length === 5) return this.parseScanCode5Part(parts);
    return null;
  }

  //  ฟอร์แมตเดิม: costCenter|grade|lot|runningNo|palletId (5 ส่วน) ไม่เปลี่ยนพฤติกรรมจากของเดิมเลย
  private parseScanCode5Part(parts: string[]): ParsedScanCode | null {
    return this.parseScanCodeBaseFields(parts);
  }

  //  ฟอร์แมตใหม่: costCenter|grade|lot|runningNo|palletId|dateTime (6 ส่วน) เพิ่ม dateTime ต่อท้าย
  //  (2 หลักแรก = วันที่, 4 หลักหลัง = เวลา) แก้ปัญหา Pallet No. ซ้ำกันได้ในล็อตเดียวกัน (คนละวัน/เวลา)
  private parseScanCode6Part(parts: string[]): ParsedScanCode | null {
    const base = this.parseScanCodeBaseFields(parts);
    if (!base) return null;

    //  dateTime: ตัวเลข 6 หลักเป๊ะ ไม่ตรงถือเป็นโค้ดผิด
    if (!/^\d{6}$/.test(parts[5])) return null;

    return { ...base, dateTime: parts[5] };
  }

  //  validate + ประกอบ 5 ฟิลด์แรกที่ฟอร์แมต 5 ส่วนกับ 6 ส่วนใช้ร่วมกันเป๊ะ (กันเขียน regex ซ้ำ 2 จุดแล้วแก้ตามกันไม่ครบทีหลัง)
  private parseScanCodeBaseFields(parts: string[]): ParsedScanCode | null {
    //  รูปแบบตายตัวของแต่ละส่วน: costCenter 4 หลัก, runningNo 2 หลัก, palletId 3 หลัก
    //  (grade/lot ยังไม่กำหนดจำนวนหลักตายตัว รอข้อมูลชัดเจนกว่านี้)
    if (!/^\d{4}$/.test(parts[0])) return null;
    if (!/^\d{2}$/.test(parts[3])) return null;
    if (!/^\d{3}$/.test(parts[4])) return null;

    const rawPalletId = parts[4];
    const normalizedPalletId = !isNaN(Number(rawPalletId)) ? String(Number(rawPalletId)) : rawPalletId;

    return {
      costCenter: parts[0],
      grade: parts[1],
      lot: parts[2],
      runningNo: parts[3],
      palletId: normalizedPalletId,
    };
  }

  //  โค้ด "เอาทั้ง pallet" พิเศษ: PL<code>|grade|lot|qty (4 ส่วน, ส่วนแรกขึ้นต้นด้วย "PL" เท่านั้นที่เข้าเงื่อนไขนี้)
  parseFullPalletScanCode(code: string): FullPalletScanCode | null {
    const parts = code.split('|').map((p) => p.trim());
    if (parts.length !== 4) return null;
    if (!parts[0].startsWith('PL')) return null;

    const qty = Number(parts[3]);
    if (!parts[1] || !parts[2] || isNaN(qty) || qty <= 0) return null;

    return { rawCode: parts[0], grade: parts[1], lot: parts[2], qty };
  }

  //  โค้ด Jumbo Bag: costCenter|grade|lot|runningNo|palletId|qty|type (7 ส่วน) — 5 ส่วนแรก validate เหมือน parseScanCode เป๊ะ
  parseJumboBagScanCode(code: string): JumboBagScanCode | null {
    const parts = code.split('|').map((p) => p.trim());
    if (parts.length !== 7) return null;

    if (!/^\d{4}$/.test(parts[0])) return null;
    if (!/^\d{2}$/.test(parts[3])) return null;
    if (!/^\d{3}$/.test(parts[4])) return null;

    const qty = Number(parts[5]);
    if (isNaN(qty) || qty <= 0) return null;

    const rawPalletId = parts[4];
    const normalizedPalletId = !isNaN(Number(rawPalletId)) ? String(Number(rawPalletId)) : rawPalletId;

    return {
      costCenter: parts[0],
      grade: parts[1],
      lot: parts[2],
      runningNo: parts[3],
      palletId: normalizedPalletId,
      qty,
    };
  }

  //  เทียบ grade แบบไม่สนช่องว่าง (ตัดช่องว่างทั้งหมดออกก่อนเทียบ ไม่ใช่แค่ trim หัวท้าย) ใช้กับทุกจุดที่ "จับคู่" grade
  //  ตอนสแกน (pallet ปกติ/manual_pallet/Special) กัน scanner ยิงวรรคแปลกๆติดมา (เช่น "1100RC SUB") แล้วจับคู่ item ไม่เจอ
  //  ใช้แค่ตอนเทียบเท่านั้น -> ค่าที่เก็บ/แสดงผล/ส่งไป API ยังเป็นค่าดิบที่สแกนได้เหมือนเดิมทุกจุด ไม่ถูกตัดวรรคทิ้ง
  gradesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
    const normalize = (v: string | null | undefined) => String(v ?? '').replace(/\s+/g, '');
    return normalize(a) === normalize(b);
  }

  //  โค้ดถุง 5/6 ส่วนเท่านั้น: บาง format ต่อวงเล็บท้าย grade (เช่นสแกนได้ "GA501RT1 5200(NH1L)" แต่ item.grade ของงานเป็น
  //  "GA501RT1 5200") -> ตัด "(…)" ออกแล้วใช้เทียบเป็นรอบ 2 ตอนหา item เท่านั้น หลังเทียบทั้งคำด้วย gradesMatch แล้วไม่เจอ
  //  item ไหนเลย (ดู resolveItemForScan/resolveSpecialItemForScan) ไม่ตัด "/" (มีความหมายในงานอื่น) ไม่แตะค่าที่เก็บ/แสดงผล/ส่งไป API
  private gradeWithoutParen(grade: string): string {
    return String(grade ?? '').replace(/\(.*?\)/g, '');
  }

  //  โค้ด Jumbo Bag เท่านั้น: grade ดิบอาจมีคำนำหน้า "GRADE " หรือมีส่วนต่อท้ายได้ 2 แบบ "/900" กับ "(NH1L)" ติดมาด้วย -> ตัดทั้งหมดออก
  //  เหลือแค่รหัส grade ล้วนๆ ไว้เทียบแบบผ่อนปรน (ใช้ร่วมกันทั้ง resolveJumboBagItemGrade และ takeMatchingPallet ด้านล่าง)
  //  ตัดช่องว่างตรงกลางเป็นขั้นสุดท้ายเสมอ (ห้ามสลับลำดับ) เพราะ regex ตัด "GRADE " ต้องเจอวรรคหลังคำนี้ก่อนถึงจะตัดออกได้
  private stripJumboBagGradeCode(value: string): string {
    return value.replace(/^GRADE\s+/i, '').trim().split('/')[0].replace(/\(.*?\)/g, '').replace(/\s+/g, '');
  }

  //  โค้ด Jumbo Bag เท่านั้น: grade ที่ฝังมาในโค้ดมีได้หลายแบบ ("220PC/900" หรือมีคำนำหน้า "GRADE 220PC/900")
  //  ต้องตัดคำนำหน้า "GRADE " ออกก่อนเสมอ แล้วเทียบกับ grade ของ item ในงานแบบไม่สนส่วนต่อท้าย "/" ทั้ง 2 ฝั่ง
  //  (เช่น scan "GRADE 220PC/900" กับ item.grade "220PC/900" -> ตัดเหลือ "220PC" ทั้งคู่แล้วเทียบ ไม่ต้องตรงกันทั้งสตริง)
  //  คืนค่า grade เต็มของ item ที่เจอ (ไม่ใช่ค่าที่ตัดแล้ว) ไปใช้กับ resolveItemForScan ต่อ ไม่แตะ parsed.grade ดิบ/qrCode เดิม
  resolveJumboBagItemGrade(rawGrade: string, items: any[]): string | null {
    const cleaned = this.stripJumboBagGradeCode(rawGrade);
    const matched = items.find((item) => this.stripJumboBagGradeCode(String(item?.grade ?? '')) === cleaned);
    return matched ? String(matched.grade).trim() : null;
  }

  fallback(value: any): any {
    return value === null || value === undefined || value === '' ? '-' : value;
  }

  //  แปลง addon_lot ของ from_location ให้เป็น array เดียวกันเสมอ ไม่ว่า backend จะส่งมาแบบ string ค่าเดียว (แบบเดิม)
  //  หรือ array ของ {lot, qty} (แบบใหม่) -> ที่อื่นในโค้ดจะได้ไม่ต้องสนใจว่า backend ส่งมารูปแบบไหน
  getLocationLots(loc: any): AddonLotEntry[] {
    const raw = loc?.addon_lot;

    if (Array.isArray(raw)) {
      return raw
        .map((entry: any) => ({ lot: String(entry?.lot ?? '').trim(), qty: entry?.qty ?? 0 }))
        .filter((entry: AddonLotEntry) => !!entry.lot);
    }

    const lot = String(raw ?? '').trim();
    return lot ? [{ lot, qty: loc?.qty ?? 0 }] : [];
  }

  //  น้ำหนักมาตรฐานต่อ 1 Pallet (กก.) — backend ไม่ได้ส่งจำนวน Pallet ต่อ Lot มาตรงๆ ใน addon_lot
  //  มีแต่น้ำหนักรวม (qty) เลยต้องเดาจำนวน Pallet จากน้ำหนักแทน โดยปัดขึ้นเสมอ
  //  (เช่น 1,200 กก. = 2 Pallet, 1,000 กก. พอดี = 1 Pallet)
  readonly PALLET_WEIGHT_KG = 1000;

  //  จำนวนถุงที่ต้องสแกนเพื่อยืนยัน 1 Pallet (งานปกติ ไม่ใช่ Special/BK) — ค่ากลางเดียว กัน scan-pallet.ts/loading-truck.ts hardcode ซ้ำกันคนละที่
  readonly BAG_REQUIRED_COUNT = 3;

  //  ช่วงเวลาต่ำสุดที่ยอมรับได้ระหว่างสแกนถุง 2 ใบติดกันของ pallet เดียวกัน (ms) -> เร็วกว่านี้ถือว่าผิดปกติ
  //  (ไม่น่าเป็นไปได้ที่คนจะหยิบถุงจริงอีกใบแล้วสแกนทันเวลานี้) เช็คทีละคู่ ไม่ใช่รวมเวลาทั้งกลุ่ม กันเคส 2 ใบแรกเร็วผิดปกติ
  //  แต่ใบสุดท้ายช้ากว่ามาก จนเฉลี่ยรวมดูปกติ
  readonly MIN_BAG_SCAN_INTERVAL_MS = 500;

  estimatePalletCountFromWeight(weightKg: number): number {
    if (!weightKg || weightKg <= 0) return 0;
    return Math.ceil(weightKg / this.PALLET_WEIGHT_KG);
  }

  //  แบ่งจำนวนเต็ม (ถุง/pallet) ตามสัดส่วนน้ำหนักที่ให้มา -> ตัวสุดท้ายรับเศษที่เหลือกันผลรวมคลาดจาก total
  splitCountByWeight(total: number, weights: number[]): number[] {
    const totalWeight = weights.reduce((sum, w) => sum + (w ?? 0), 0);
    if (total <= 0 || totalWeight <= 0) return weights.map(() => 0);

    let assigned = 0;
    return weights.map((w, index) => {
      const isLast = index === weights.length - 1;
      const share = isLast ? total - assigned : Math.round((total * (w ?? 0)) / totalWeight);
      assigned += share;
      return share;
    });
  }

  mapJobTag(typeName?: string, typeTopic?: string): string {
    if (typeName === 'Request') return 'RQ';
    if (typeName === 'Special Package') return 'SP';
    //  เหมือน special concept แต่ type_topic จริงเป็น 'Outbound' (ไม่ใช่ 'Broken') -> ต้องเช็คจาก type_name ก่อนเข้า switch เหมือนกับหน้า job-accept
    if (typeName === 'Breakage & Replacement') return 'BK';
    //  type_topic จริงเป็น 'Outbound' เหมือนงาน Outbound ทั่วไป -> ต้องเช็คจาก type_name ก่อน ไม่งั้นจะไปโชว์ "OUT" ปนกับงาน Outbound ปกติ
    if (typeName === 'Internal Transfer') return 'IT';
    //  งานใหม่ (ยิง endpoint /transfer-wh/... ของตัวเอง) type_topic จริงเป็น 'Outbound' เหมือนกัน -> เช็คจาก type_name ก่อนเหมือน IT
    if (typeName === 'Transfer WH') return 'TW';

    switch (typeTopic) {
      case 'Inbound': return 'IN';
      case 'Outbound': return 'OUT';
      case 'Broken': return 'BK';
      default: return this.fallback(typeTopic);
    }
  }

  //  แปลง to_locations ของ Item ให้เป็นรูปแบบ PalletTargetLocation
  //  lot (ถ้าส่งมา): item ที่แบ่ง Location ปลายทางตาม lot (to_locations[].addon_lot เช่นงาน Shipping แยก Dock ต่อ lot)
  //  -> วางได้เฉพาะ Location ที่มี lot นี้ ไม่งั้นพาเลท lot A ลง Dock ของ lot B ได้ (BE เช็คแค่จำนวนต่อ Location ไม่เช็ค lot)
  //  ไม่มี Location ไหนระบุ lot นี้เลย -> ใช้ทุก Location แบบเดิม
  buildTargetLocations(rawItem: any, lot?: string | null): PalletTargetLocation[] {
    const allLocations: any[] = rawItem?.locations?.to_locations ?? [];
    const lotKey = String(lot ?? '').trim();
    const lotMatched = lotKey && lotKey !== '-'
      ? allLocations.filter((loc: any) => this.getLocationLots(loc).some((entry) => entry.lot === lotKey))
      : [];
    const toLocations = lotMatched.length > 0 ? lotMatched : allLocations;
    return toLocations.map((loc: any) => ({
      location: this.fallback(loc.location_name),
      completeQty: loc.complete_qty,
      totalQty: loc.total_qty,
    }));
  }

  //  หา Item ที่ตรงกับ pallet (ใช้ itemId ก่อนเสมอ ถ้าไม่มีค่อย fallback ไปเทียบ grade+lot)
  resolveItemForPallet(pallet: PalletToPlaceItem, items: any[]): any {
    return pallet.itemId !== undefined
      ? items.find((item: any) => item.id === pallet.itemId)
      : items.find(
        (item: any) => this.gradesMatch(item.grade, pallet.grade) && String(item.lot_no).trim() === pallet.lotNo,
      );
  }

  //  เช็ค grade ของ record ใน pool (receive_pallet/complete_pallet) ตรงกับ item ไหม -> ตรงตัวเป๊ะก่อนเสมอ (งานทั่วไป/PL)
  //  ถ้าไม่ตรงแล้ว record นี้เป็นโค้ด Jumbo Bag จริง (parse scanned_qr_code ผ่าน 7 ส่วน) ถึงค่อยเทียบแบบผ่อนปรน
  //  (ตัด "GRADE "/ตัด "/" ทั้ง 2 ฝั่ง เหมือนตอนสแกนสด resolveJumboBagItemGrade) กันกระทบงานอื่นที่ "/" มีความหมายสำคัญจริง
  //  (เช่น "220PC/900" กับ "220PC/800" เป็นคนละ item กัน ถ้าตัด "/" แบบไม่เลือกจะจับคู่ผิดได้)
  //  public เพราะหน้า load-to-truck ใช้จับคู่ complete_pallet กับ item ด้วย (buildCompletedPalletsByItem)
  isPoolGradeMatch(p: any, itemGrade: string): boolean {
    const poolGrade = String(p?.grade ?? '').trim();
    if (this.gradesMatch(poolGrade, itemGrade)) return true;

    const isJumboBagRecord = this.parseJumboBagScanCode(String(p?.scanned_qr_code ?? '').trim()) !== null;
    if (!isJumboBagRecord) return false;

    return this.stripJumboBagGradeCode(poolGrade) === this.stripJumboBagGradeCode(itemGrade);
  }

  //  ดึง pallet จาก pool ที่ grade/lot ตรงกับ item จริงๆ (ไม่ใช่หยิบตามลำดับคิวเฉยๆ) กัน id/lot สลับข้าม item
  //  ที่ grade เดียวกันแต่ lot ต่างกัน เมื่อลำดับใน pool ไม่ตรงกับลำดับ item พอดี — ถ้าหาตัวที่ตรงไม่เจอ
  //  (ไม่มี lot_no ระบุ, ไม่มี pallet เหลือที่ lot ตรง ฯลฯ) fallback ไปหยิบตัวแรกที่เหลือเหมือนเดิม
  private takeMatchingPallet(pool: any[], item: any): any | null {
    const itemGrade = String(item?.grade ?? '').trim();
    const itemLotNo = String(item?.lot_no ?? '').trim();

    if (itemLotNo) {
      const index = pool.findIndex(
        (p) => this.isPoolGradeMatch(p, itemGrade) && String(p?.lot ?? '').trim() === itemLotNo,
      );
      if (index > -1) return pool.splice(index, 1)[0];
    }

    //  item แบบ manifest (pallet_manual เช่น IT ที่มี pallet_assigned) -> lot_no รวมของ item เป็นเลขเอกสาร
    //  ไม่ใช่ lot จริงของแต่ละใบ -> เทียบกับ lot ใน pallet_manual แทน
    const manualLots = new Set((item?.pallet_manual ?? []).map((m: any) => String(m?.lot ?? '').trim()));
    if (manualLots.size > 0) {
      const index = pool.findIndex(
        (p) => this.isPoolGradeMatch(p, itemGrade) && manualLots.has(String(p?.lot ?? '').trim()),
      );
      if (index > -1) return pool.splice(index, 1)[0];
    }

    return pool.shift() ?? null;
  }

  //  สร้างรายการ Pallet ที่รอนำไปวาง (ฝั่ง Get ที่ยืนยันแล้วจากรอบก่อนหน้า) จากข้อมูลงาน
  buildPalletToPlaceList(rawJob: any, items: any[]): PalletToPlaceItem[] {
    const receivedPalletsPool: any[] = [...(rawJob.pallets?.receive_pallet ?? [])];
    const result: PalletToPlaceItem[] = [];
    const lists: SessionPalletLists = { palletToPlaceList: result, palletsAwaitingSourceLocation: [], completedPalletList: [] };

    items.forEach((item: any) => {
      const hasManualManifest = Array.isArray(item?.pallet_manual) && item.pallet_manual.length > 0;
      //  item แบบ manifest (เช่น IT ที่นับหน่วยเป็นกก.) -> item.receive_qty อาจไม่ใช่ "จำนวนใบ" (เช่นเป็นกก.แทน)
      //  ใช้จำนวน record จริงใน receive_pallet ที่ตรงกับ item นี้แทนเสมอ กันสร้างแถวหลอนเกินจำนวนใบจริง
      const manualLots = new Set((item?.pallet_manual ?? []).map((m: any) => String(m?.lot ?? '').trim()));
      const pendingCount = hasManualManifest
        ? receivedPalletsPool.filter((p) => this.gradesMatch(p?.grade, item.grade) && manualLots.has(String(p?.lot ?? '').trim())).length
        : (item.receive_qty ?? 0);

      for (let i = 0; i < pendingCount; i++) {
        const realPallet = this.takeMatchingPallet(receivedPalletsPool, item);
        //  หา record จริงไม่เจอ (pool หมดก่อนครบ pendingCount เช่น receive_qty นับหน่วยไม่ตรงกับจำนวนใบจริง) -> ข้ามไปเลย
        //  ไม่ push แถวหลอน (ไม่มีทั้ง qrCode/backendId) เพราะแถวแบบนี้ backfill ไม่ได้ และ auto-fetch dedup
        //  (knownCodes/knownBackendIds ใน scan-pallet.ts) มองไม่เห็นมัน (filter ค่า falsy ทิ้ง) พอ record จริงโผล่มาทีหลัง
        //  เลยถูกเพิ่มเป็นแถวใหม่ซ้อนแทนที่จะอัปเดตแถวเดิม กลายเป็น pallet ใบเดียวกันโชว์ซ้ำ 2 การ์ด
        if (!realPallet) continue;
        const effectiveLotNo = this.fallback(hasManualManifest ? (realPallet?.lot ?? item.lot_no) : (item.lot_no ?? realPallet?.lot));
        const fromLocation = this.resolveFromLocationForItem(item, effectiveLotNo, lists);

        //  โค้ด PL: scanned_qr_code เก็บ rawCode ไว้ส่วนแรกเหมือนเดิม -> ใช้เป็น id หลัก (เหมือนตอนสแกนสด) กัน id ที่โชว์เพี้ยนเป็นเลข backend ล้วนๆ ตอน reload
        const scannedCode = String(realPallet?.scanned_qr_code ?? '').trim();
        const rawCode = scannedCode.split('|')[0]?.trim();
        const isManualPallet = !!rawCode && rawCode.startsWith('PL');
        //  โค้ดถุงปกติ: ดึงเลข Pallet No. (เลขท้ายโค้ด) จาก scanned_qr_code เหมือนตอนสแกนสด (parsed.palletId) เป็น id หลัก
        //  กัน id ที่โชว์เพี้ยนเป็นเลข backend ดิบ ("48291") ตอน reload ทั้งที่ตอนสแกนสดโชว์เป็นเลข Pallet No. เล็กๆ ("1")
        //  -> backendId ยังเก็บเลข backend จริงไว้แยกต่างหากเหมือนเดิม (ใช้ตอน Put/Delete/complete_pallet เท่านั้น ไม่ใช้โชว์)
        const normalPalletNo = !isManualPallet ? this.parseScanCode(scannedCode)?.palletId : undefined;

        result.push({
          id: isManualPallet ? rawCode : (normalPalletNo ?? (realPallet ? String(realPallet.id) : null)),
          backendId: realPallet ? String(realPallet.id) : undefined,
          //  โชว์ grade จริงของ record (receive_pallet) ก่อนเสมอ ไม่ใช่ item.grade -> ตรงกับข้อมูลจริงที่ backend
          //  ส่งมาเป๊ะ (เหมือนที่การ์ดสีเขียว/complete_pallet ใช้ serverPallet.grade อยู่แล้ว) item.grade เป็นแค่ fallback
          //  เผื่อ record ไม่มี grade มาจริงๆ
          grade: this.fallback(realPallet?.grade ?? item.grade),
          lotNo: effectiveLotNo,
          qty: realPallet?.qty ?? item.qty ?? 0,
          isActive: true,
          isChecked: true,
          isSelectedForPlacement: false,
          targetLocations: this.buildTargetLocations(item, effectiveLotNo),
          itemId: item.id,
          fromLocationId: fromLocation?.location_id,
          //  qrCode ที่ backend เก็บไว้ตอน Get รอบก่อนหน้า (คนละ session/คนละคนกับที่ Get ก็ยังมีให้ใช้ตอน Put/Delete)
          //  โค้ด PL: ต้องเป็น rawCode เท่านั้น (เหมือนตอนสแกนสด) ไม่ใช่ scanned_qr_code เต็มสตริง ไม่งั้น Put/Delete หลัง reload จะส่งทั้งสตริงกลับไปผิด
          qrCode: isManualPallet ? rawCode : realPallet?.scanned_qr_code,
        });
      }
    });

    return result;
  }

  //  งานปกติและ RQ เท่านั้น: สร้าง pallet 1 ใบจาก record กลุ่มเดียวกันใน receive_pallet (group ด้วย id ของ backend เอง
  //  ก่อนเรียกมาแล้ว ไม่ใช่ pallet_seq ที่ client คิดเอง กันชนกันข้ามเครื่อง) ใช้ตอน auto-fetch เจอ pallet ที่เครื่องอื่น
  //  Get ไปแล้วแต่เครื่องนี้ยังไม่รู้จัก -> คืน pallet พร้อมใช้งานจริง (เลือก/วางได้เลย) ไม่ใช่แค่โชว์เฉยๆ
  //  คืน null ถ้าหา item ที่ grade/lot ตรงไม่เจอเลย (ข้อมูลไม่สมบูรณ์พอจะสร้าง pallet ที่ใช้งานได้จริง)
  buildPendingPalletFromRecords(records: any[], items: any[]): PalletToPlaceItem | null {
    if (records.length === 0) return null;
    const first = records[0];
    const itemGrade = String(first?.grade ?? '').trim();
    const itemLot = String(first?.lot ?? '').trim();
    const item = items.find(
      (it: any) => this.isPoolGradeMatch(first, String(it.grade ?? '').trim()) && String(it.lot_no ?? '').trim() === itemLot,
    );
    if (!item) return null;

    const codes = records.map((r: any) => String(r?.scanned_qr_code ?? '').trim()).filter((c) => !!c);
    const totalQty = records.reduce((sum: number, r: any) => sum + (r?.qty ?? 0), 0);
    const [firstCode, ...restCodes] = codes;

    //  ดึงเลข Pallet No. (เลขท้ายโค้ด) จาก scanned_qr_code เหมือนตอนสแกนสด -> กัน id ที่โชว์เพี้ยนเป็นเลข backend ดิบ
    //  ลองโค้ดปกติก่อน ไม่ติดค่อย fallback ไปโค้ด Jumbo Bag (เหมือน buildPalletToPlaceList)
    const normalPalletNo = this.parseScanCode(firstCode ?? '')?.palletId ?? this.parseJumboBagScanCode(firstCode ?? '')?.palletId;

    return {
      id: normalPalletNo ?? String(first.id),
      backendId: String(first.id),
      grade: this.fallback(itemGrade || item.grade),
      lotNo: this.fallback(item.lot_no),
      qty: totalQty,
      isActive: true,
      isChecked: true,
      isSelectedForPlacement: false,
      targetLocations: this.buildTargetLocations(item),
      itemId: item.id,
      qrCode: firstCode,
      bagCodes: restCodes,
    };
  }

  //  หา entry ใน receive_pallet ที่ id ตรงกับ pallet ที่ระบุ (งานปกติ Inbound/Outbound/Picking ที่มี pallet id จริง
  //  ต่างจาก findSpecialReceivePoolEntryForItem ที่จับคู่ด้วย grade/lot เพราะงาน Special ไม่มี id ต่อถุง)
  //  ใช้ตอน Put/Delete -> ส่ง scanned_qr_code จริงจาก backend แทนค่า qrCode ที่ track ไว้ฝั่ง client (ซึ่งอาจไม่มีถ้าคนละ session/คนละคนกับที่ Get)
  //  จับคู่ด้วย id + grade/lot (ไม่ใช่ id อย่างเดียว เพราะ id ซ้ำข้าม grade/lot ได้ -> ไม่งั้นได้ scanned_qr_code ของอีก lot มาส่ง Put/Reset)
  findReceivePoolEntryForPallet(rawJob: any, pallet: PalletToPlaceItem): any | null {
    if (!pallet.id) return null;
    const pool: any[] = rawJob?.pallets?.receive_pallet ?? [];
    return (
      pool.find((p: any) => {
        if (String(p.id) !== String(pallet.id)) return false;
        const grade = String(p?.grade ?? '').trim();
        const lot = String(p?.lot ?? '').trim();
        return (!grade || this.gradesMatch(grade, pallet.grade)) && (!lot || lot === pallet.lotNo);
      }) ?? null
    );
  }

  //  SPECIAL PACKAGE (นับเป็นถุง ไม่ใช่ pallet) ────────────────────────────
  //  หา lot ที่ใช้แสดงผล/resolve location ของ item งาน Special: ถ้าไม่มี lot_no รวม (เหมือนงาน outbound ปกติแบบ addon_lot)
  //  ให้ลองหา addon_lot จาก from_locations แทน (1 ค่า -> ใช้เลย, มากกว่า 1 ค่า -> รวมแสดงกันข้อมูลตก)
  resolveSpecialDisplayLot(item: any): string {
    const itemLotNo = String(item?.lot_no ?? '').trim();
    if (itemLotNo) return itemLotNo;

    const fromLocations = item?.locations?.from_locations ?? [];
    const lots: string[] = Array.from(new Set(
      fromLocations.flatMap((loc: any) => this.getLocationLots(loc).map((entry: AddonLotEntry) => entry.lot)),
    ));
    if (lots.length === 0) return '';
    if (lots.length === 1) return lots[0];

    return lots.join('/');
  }

  //  งาน Special: จัดกลุ่มรายการที่ backend คืนมาใน pallets.receive_pallet (Get แล้วแต่ยังไม่ put away) ตาม pallet_seq
  //  backend เก็บ pallet_seq ให้เองแล้ว (field ใหม่) -> ไม่ต้อง derive จาก receive_qty ของ item เหมือนเดิมอีกต่อไป
  //  1 pallet_seq อาจมีหลาย grade/lot ผสมกันได้ (ใส่อะไรก็ได้ตราบใดที่ไม่เกิน qty ของ item นั้นๆ)
  buildSpecialPalletGroups(rawJob: any, items: any[]): SpecialPalletGroup[] {
    const pool: any[] = rawJob?.pallets?.receive_pallet ?? [];
    const bySeq = new Map<number, PalletToPlaceItem[]>();
    const lists: SessionPalletLists = { palletToPlaceList: [], palletsAwaitingSourceLocation: [], completedPalletList: [] };

    pool.forEach((p: any) => {
      const seq = p.pallet_seq ?? 0;
      //  gradesMatch เทียบตรงตัวเป๊ะ ไม่ตัด suffix "/750" ที่ item.grade ของงาน Jumbo Bag มักมีติดมา (เช่น "361F/750")
      //  แต่ p.grade (ดิบจาก receive_pallet) เป็นแค่ "361F" ล้วนๆ จากโค้ดที่สแกน -> ต้องใช้ isPoolGradeMatch เหมือน
      //  takeMatchingPallet ด้านล่าง ไม่งั้นหา item ไม่เจอ (item เป็น undefined -> itemId หาย) ทุกครั้งที่ reload หน้านี้
      //  สำหรับงาน Jumbo Bag (เจอจริง: itemId กลายเป็น 0 ตอนยิง Put หลัง reload)
      const item = items.find(
        (it: any) => this.isPoolGradeMatch(p, it.grade)
          && (!it.lot_no || String(it.lot_no).trim() === String(p.lot ?? '').trim()),
      );
      const fromLocation = item ? this.resolveFromLocationForItem(item, p.lot, lists) : null;

      const entry: PalletToPlaceItem = {
        id: null,
        grade: this.fallback(p.grade),
        lotNo: this.fallback(p.lot),
        qty: p.qty ?? 0,
        isActive: true,
        isChecked: true,
        isSelectedForPlacement: false,
        targetLocations: item ? this.buildTargetLocations(item, p.lot) : [],
        itemId: item?.id,
        fromLocationId: fromLocation?.location_id,
        qrCode: p.scanned_qr_code,
        palletSeq: seq,
        specialEntryId: p.id,
      };

      const list = bySeq.get(seq) ?? [];
      list.push(entry);
      bySeq.set(seq, list);
    });

    return Array.from(bySeq.entries())
      .map(([seq, entries]) => ({ seq, entries }))
      .sort((a, b) => a.seq - b.seq);
  }

  //  หา Item ของงาน Special ที่ตรงกับ Grade/Lot ที่สแกน และยังเหลือโควต้าถุง (ไม่ใช่นับรายการเหมือน resolveItemForScan)
  //  isBagCode: true เฉพาะตอนเรียกจากจุดรับโค้ดถุง 5/6 ส่วน -> เทียบทั้งคำแล้วไม่เจอ item เลย ค่อยเทียบ grade ที่ตัด (…) ออก
  //  อีกรอบ (ดู gradeWithoutParen) โค้ด PL/Jumbo ไม่ส่งมา เลยไม่มีรอบ 2
  resolveSpecialItemForScan(parsed: ParsedScanCode, jobDataRaw: any, isBagCode = false): { item: any | null; remaining: number; errorMessage?: string } {
    const items = jobDataRaw?.items ?? [];

    const findCandidates = (grade: string) => items
      .filter((item: any) => {
        if (!this.gradesMatch(item.grade, grade)) return false;

        const itemLotNo = String(item.lot_no ?? '').trim();
        if (itemLotNo && itemLotNo === parsed.lot) return true;

        const fromLocations = item?.locations?.from_locations ?? [];
        return fromLocations.some((loc: any) => this.getLocationLots(loc).some((entry) => entry.lot === parsed.lot));
      })
      .sort((a: any, b: any) => a.id - b.id);

    let candidateItems = findCandidates(parsed.grade);
    if (candidateItems.length === 0 && isBagCode) candidateItems = findCandidates(this.gradeWithoutParen(parsed.grade));

    if (candidateItems.length === 0) {
      return { item: null, remaining: 0, errorMessage: 'Scan ถุงผิด (ไม่พบ Grade/Lot ในรายการ)' };
    }

    const matchedItem = candidateItems.find((item: any) => {
      const used = (item.receive_qty ?? 0) + (item.complete_qty ?? 0);
      return used < (item.total_qty ?? 0);
    });

    if (!matchedItem) {
      const fullItemIds = candidateItems.map((item: any) => item.id).join(', ');
      return {
        item: null,
        remaining: 0,
        errorMessage: `Grade/Lot "${parsed.grade} ${parsed.lot}" นี้ครบตามจำนวนที่ต้องการแล้ว (Item id: ${fullItemIds})`,
      };
    }

    const remaining = (matchedItem.total_qty ?? 0) - (matchedItem.receive_qty ?? 0) - (matchedItem.complete_qty ?? 0);
    return { item: matchedItem, remaining };
  }

  //  เช็คโควต้าคงเหลือของ Location ต้นทาง -> งาน Special/RQ วัดเป็นน้ำหนัก (กก.) ไม่ใช่จำนวนใบ ต้องรวมน้ำหนักที่ใช้ไปแล้ว
  //  ในเซสชันนี้ด้วย (sumSessionPalletWeightAtLocation) ไม่งั้น location ที่ดึงน้ำหนักออกไปครบแล้วในเซสชันนี้ (แต่ backend
  //  ยังไม่ sync receive_qty/complete_qty ของ from_location ตัวนั้นกลับมา) จะดูเหมือนยังมีโควต้าเหลือเต็มอยู่เสมอ
  //  extraWeightByLocationName: น้ำหนักของถุงที่ยัง "รอสแกน Location ต้นทาง" (ยังไม่ confirm เข้า palletToPlaceList/
  //  completedPalletList เลย sumSessionPalletWeightAtLocation มองไม่เห็น) ต้องบวกแยกเข้ามาเอง (ดู scan-pallet.ts
  //  _specialAwaitingWeightByLocationName) ไม่งั้น pallet อื่นที่กำลังรอ confirm อยู่ที่ location เดียวกัน จะไม่ถูกนับ
  //  รับ lists ของ session จริงเข้ามา (ไม่ใช้ list ว่างเปล่า) ให้ resolve location เดียวกันกับตอนยิง Get จริงตอน confirm
  checkSpecialFromLocationQuota(
    item: any,
    lot: string,
    itemRemaining: number,
    lists: SessionPalletLists,
    extraWeightByLocationName?: Map<string, number>,
  ): { location: any; remaining: number } {
    const location = this.resolveFromLocationForItem(item, lot, lists, true, extraWeightByLocationName);

    if (!location || typeof location.total_qty !== 'number') {
      return { location, remaining: itemRemaining };
    }

    const pendingWeight = extraWeightByLocationName?.get(location.location_name) ?? 0;
    const usedAtLocation =
      (location.receive_qty ?? 0) + (location.complete_qty ?? 0) + this.sumSessionPalletWeightAtLocation(location.location_id, lists) + pendingWeight;
    const locationRemaining = location.total_qty - usedAtLocation;
    return { location, remaining: Math.min(itemRemaining, locationRemaining) };
  }

  //  เหมือน checkSpecialFromLocationQuota แต่เช็ค "ยอดรวม" ของหลายพาเลทที่ resolve ไปที่ rawLocation เดียวกันพร้อมกันทีเดียว
  //  (ไม่ใช่ item/lot เดียว) ใช้ตอน batch ยิง Get หลายพาเลทเต็มที่ source location เดียวกัน (ดู scan-pallet.ts
  //  getSpecialFullPalletBatch) demandWeight = น้ำหนักรวมของทุกพาเลทในกลุ่มที่ resolve มาที่ rawLocation นี้
  hasEnoughFromLocationCapacity(
    rawLocation: any,
    demandWeight: number,
    lists: SessionPalletLists,
    extraWeightByLocationName?: Map<string, number>,
  ): boolean {
    return demandWeight <= this.fromLocationRemainingWeight(rawLocation, lists, extraWeightByLocationName);
  }

  //  น้ำหนัก (กก.) ที่ from_location ใบนี้ยังรับได้อีก = total_qty - ที่ backend นับแล้ว - ที่เครื่องนี้รับไปในเซสชัน - ที่รออยู่
  //  (extraWeightByLocationName) ไม่มี total_qty แปลว่าไม่คุมโควต้าที่นี้ -> ไม่จำกัด
  fromLocationRemainingWeight(
    rawLocation: any,
    lists: SessionPalletLists,
    extraWeightByLocationName?: Map<string, number>,
  ): number {
    if (!rawLocation || typeof rawLocation.total_qty !== 'number') return Infinity;
    const pendingWeight = extraWeightByLocationName?.get(rawLocation.location_name) ?? 0;
    const usedAtLocation =
      (rawLocation.receive_qty ?? 0) + (rawLocation.complete_qty ?? 0)
      + this.sumSessionPalletWeightAtLocation(rawLocation.location_id, lists) + pendingWeight;
    return rawLocation.total_qty - usedAtLocation;
  }

  //  เช็คว่า Item นี้เคยถูก "ส่งให้ Step 2" ไปแล้วหรือยัง (มี pallet ค้างอยู่ใน pallets.prepare_pallet ตรงกับ grade/lot)
  //  ถ้าใช่ -> คนที่สแกนตอนนี้คือคนทำ Step 2 (ไม่ต้องขึ้นปุ่ม "ส่งให้ Step 2" ซ้ำอีก)
  isSpecialItemPrepared(item: any, rawJob: any): boolean {
    const preparePool: any[] = rawJob?.pallets?.prepare_pallet ?? [];
    if (preparePool.length === 0) return false;

    const itemLotNo = String(item?.lot_no ?? '').trim();
    return preparePool.some((p: any) => {
      if (!this.gradesMatch(p.grade, item?.grade)) return false;
      if (!itemLotNo) return true;   //  item ไม่มี lot_no รวม (แบบ addon_lot) -> match แค่ grade พอ
      return String(p.lot ?? '').trim() === itemLotNo;
    });
  }

  //  หา pool entry (receive_pallet/prepare_pallet) ที่ scanned_qr_code ตรงกับโค้ดที่สแกนได้ตอนนี้เป๊ะๆ
  //  ใช้แยกว่าถุงนี้เคย Get/Prepare ไปแล้วหรือยัง (แทนที่จะเข้าใจว่าเป็นการสแกนถุงใหม่ทุกครั้ง)
  findSpecialScannedPoolEntry(rawJob: any, poolKey: 'receive_pallet' | 'prepare_pallet', code: string): any | null {
    const pool: any[] = rawJob?.pallets?.[poolKey] ?? [];
    return pool.find((p: any) => String(p.scanned_qr_code ?? '').trim() === code.trim()) ?? null;
  }

  //  หา item ที่ตรงกับ grade/lot ของ pool entry (ใช้ตอน match receive_pallet/prepare_pallet กลับไปหา item ที่แท้จริง)
  resolveSpecialItemForPoolEntry(rawJob: any, entry: any): any | null {
    const items = rawJob?.items ?? [];
    const entryGrade = String(entry?.grade ?? '').trim();
    const entryLot = String(entry?.lot ?? '').trim();

    return items.find((item: any) => {
      if (!this.gradesMatch(item.grade, entryGrade)) return false;
      if (!entryLot) return true;
      return this.resolveSpecialDisplayLot(item) === entryLot;
    }) ?? null;
  }

  //  หา entry ใน receive_pallet ที่ grade/lot ตรงกับ item ที่ระบุ (ทิศตรงข้ามกับ resolveSpecialItemForPoolEntry)
  //  ใช้ตอนลบ/reset -> ส่ง scanned_qr_code จริงจาก backend แทนค่า qrCode ที่ track ไว้ฝั่ง client (ซึ่งอาจหายไปถ้าข้าม session)
  findSpecialReceivePoolEntryForItem(rawJob: any, item: any): any | null {
    const pool: any[] = rawJob?.pallets?.receive_pallet ?? [];
    const itemGrade = String(item?.grade ?? '').trim();
    const itemLot = this.resolveSpecialDisplayLot(item);

    return pool.find((p: any) => {
      if (!this.gradesMatch(p.grade, itemGrade)) return false;
      if (!itemLot) return true;
      return String(p.lot ?? '').trim() === itemLot;
    }) ?? null;
  }

  //  สร้างรายการ Pallet ที่รอสแกน Location ต้นทาง (เฉพาะงาน Outbound)
  buildPalletsAwaitingSourceLocation(rawJob: any, items: any[], palletToPlaceList: PalletToPlaceItem[]): PalletToPlaceItem[] {
    const pool: any[] = [...(rawJob.pallets?.awaiting_source_pallet ?? [])];
    const result: PalletToPlaceItem[] = [];
    const lists: SessionPalletLists = { palletToPlaceList, palletsAwaitingSourceLocation: result, completedPalletList: [] };

    items.forEach((item: any) => {
      const hasManualManifest = Array.isArray(item?.pallet_manual) && item.pallet_manual.length > 0;
      //  เหตุผลเดียวกับ buildPalletToPlaceList: item แบบ manifest นับหน่วยอาจไม่ใช่ "จำนวนใบ" -> ใช้ record จริงแทน
      const manualLots = new Set((item?.pallet_manual ?? []).map((m: any) => String(m?.lot ?? '').trim()));
      const waitingCount = hasManualManifest
        ? pool.filter((p) => this.gradesMatch(p?.grade, item.grade) && manualLots.has(String(p?.lot ?? '').trim())).length
        : (item.awaiting_source_pallet ?? 0);

      for (let i = 0; i < waitingCount; i++) {
        const realPallet = this.takeMatchingPallet(pool, item);
        const effectiveLotNo = this.fallback(hasManualManifest ? (realPallet?.lot ?? item.lot_no) : (item.lot_no ?? realPallet?.lot));
        const fromLocation = this.resolveFromLocationForItem(item, effectiveLotNo, lists);

        result.push({
          id: realPallet ? String(realPallet.id) : null,
          grade: this.fallback(item.grade),
          lotNo: effectiveLotNo,
          qty: realPallet?.qty ?? item.qty ?? 0,
          isActive: true,
          isChecked: true,
          isSelectedForPlacement: false,
          targetLocations: this.buildTargetLocations(item, effectiveLotNo),
          sourceLocation: this.fallback(fromLocation?.location_name),
          itemId: item.id,
          fromLocationId: fromLocation?.location_id,
          //  โค้ดถุงใบล่าสุดที่ mirror ไว้ตอนยืนยัน Pallet (completePalletOutbound) -> ใช้ส่ง Get ตอนสแกน Location ต้นทาง และจับถุงซ้ำหลัง reload
          qrCode: realPallet?.scanned_qr_code,
        });
      }
    });

    return result;
  }

  //  สร้าง Map ของ Pallet ที่เสร็จสิ้นแล้วจาก Backend แยกตาม Item
  //  จับคู่ record ใน complete_pallet กับ item ด้วย grade/lot จริง (เหมือน takeMatchingPallet ที่ใช้กับ receive_pallet)
  //  แทนการตัดตามลำดับ position เฉยๆ เพราะ complete_pallet ของ backend ไม่ได้เรียงตรงกับลำดับ items[] เสมอไป
  //  ถ้าเรียงไม่ตรงแล้วตัดตาม position จะได้ record ผิด grade/lot ไปแปะให้ item อื่นที่ไม่เกี่ยวข้อง
  buildCompletedPalletsByItem(rawJob: any, items: any[]): Map<number, any[]> {
    const completedPalletsPool: any[] = [...(rawJob.pallets?.complete_pallet ?? [])];
    const completedPalletsByItem = new Map<number, any[]>();

    items.forEach((item: any) => {
      const completeCount = item.complete_qty ?? 0;
      const matched: any[] = [];
      for (let i = 0; i < completeCount; i++) {
        const pallet = this.takeMatchingPallet(completedPalletsPool, item);
        if (!pallet) break;
        matched.push(pallet);
      }
      completedPalletsByItem.set(item.id, matched);
    });

    return completedPalletsByItem;
  }

  //  รวม total_qty ที่แท้จริงของ Item — ถ้าเป็น item แบบ addon_lot (ไม่มี lot_no รวม) ให้รวมจาก
  //  total_qty ของแต่ละ from_location แทน item.total_qty ตรงๆ เพราะบางงาน item.total_qty ที่ backend
  //  ส่งมาไม่ตรงกับผลรวมจริงของทุก addon_lot ทำให้แจกแจง Lot ในรายการ "รอสแกนถุง" ไม่ครบ
  //  (บางใบเลยตกไปแสดงเป็น "ไม่ระบุ Lot" ทั้งที่จริงมี addon_lot อยู่)
  resolveItemTotalQty(item: any): number {
    const itemLotNo = String(item?.lot_no ?? '').trim();
    const fromLocations = item?.locations?.from_locations ?? [];

    if (itemLotNo || fromLocations.length === 0) return item?.total_qty ?? 0;

    const hasAddonLot = fromLocations.some((loc: any) => this.getLocationLots(loc).length > 0);
    if (!hasAddonLot) return item?.total_qty ?? 0;

    const sumFromLocations = fromLocations.reduce((sum: number, loc: any) => sum + (loc.total_qty ?? 0), 0);
    return sumFromLocations > 0 ? sumFromLocations : (item?.total_qty ?? 0);
  }

  //  หา from_location ที่ตรงกับ lot ที่กำลังสแกน (รองรับทั้ง lot_no ปกติ และ addon_lot)
  //  ถ้ามีหลาย Location ตรงกับ lot เดียวกัน -> เลือก Location ที่ "ยังมีโควต้าเหลือ" ก่อนเสมอ ถ้าตัวที่ตรง lot เต็มหมด
  //  แล้ว (หรือไม่มีตัวไหนตรง lot ที่สแกนเลย) -> overflow ไปหา location อื่นของ item เดียวกันที่ยังมีโควต้าเหลือแทน
  //  (บางงาน WMS แบ่งโควต้า "เอาจาก location ไหนก่อน" ไว้ล่วงหน้าเป็น addon_lot ต่อ location แต่ grade/lot จริงที่คนขับ
  //  เห็นเป็นก้อนเดียวกันทั้งงาน พอ location แรกที่ WMS จัดไว้เต็มแล้ว ต้องดึงจาก location ถัดไปของ item เดียวกันต่อได้เอง
  //  ไม่ใช่ค้างฟ้อง "เต็มแล้ว" ทั้งที่ item ยังเหลือโควต้ารวมอยู่จริง เคสเจอจริง: 4 location ต่าง addon_lot กัน ยอดรวม
  //  item ยังไม่ครบ แต่พอ location แรกเต็ม ระบบไม่ยอม swap ไป location ที่ 2/3/4 เลย)
  //  useWeight: true = เทียบด้วยน้ำหนักสะสม (งาน Special/RQ ที่ total_qty ของ location เป็น กก.) แทนจำนวนใบ
  //  ไม่งั้นถ้า location นั้นดึงน้ำหนักออกไปครบแล้วแต่ "จำนวนใบ" ยังน้อยกว่า total_qty (ซึ่งเป็นเลข กก.) อยู่เสมอ
  //  จะดูเหมือนยังมีโควต้าเหลือตลอดไป ไม่มีวันสลับไป location อื่น (ดู checkSpecialFromLocationQuota)
  //  extraWeightByLocationName: น้ำหนักที่ pallet อื่นรอ confirm อยู่ (ยังไม่เข้า lists) ดู checkSpecialFromLocationQuota
  resolveFromLocationForItem(
    item: any,
    lot: string,
    lists: SessionPalletLists,
    useWeight: boolean = false,
    extraWeightByLocationName?: Map<string, number>,
  ): any {
    const fromLocations = item?.locations?.from_locations ?? [];
    if (fromLocations.length === 0) return undefined;

    const itemLotNo = String(item?.lot_no ?? '').trim();

    //  รายชื่อ Location ที่ตรงกับ lot ที่สแกน (ไม่ใช่แค่ตัวแรก)
    const candidateLocations = itemLotNo && itemLotNo === lot
      ? fromLocations
      : fromLocations.filter((loc: any) => this.getLocationLots(loc).some((entry) => entry.lot === lot));

    const hasRemainingQuota = (loc: any): boolean => {
      if (typeof loc.total_qty !== 'number') return true;   //  ไม่มี quota tracking ของ location นี้ -> ใช้ได้เสมอ
      const sessionUsed = useWeight
        ? this.sumSessionPalletWeightAtLocation(loc.location_id, lists)
        : this.countSessionPalletsAtLocation(loc.location_id, lists);
      const pendingUsed = extraWeightByLocationName?.get(loc.location_name) ?? 0;
      const used = (loc.complete_qty ?? 0) + sessionUsed + pendingUsed;
      return used < loc.total_qty;
    };

    //  ตัวที่ตรง lot ที่สแกน + ยังมีโควต้าเหลือ -> ใช้ก่อนเสมอ
    const matchedWithQuota = candidateLocations.find(hasRemainingQuota);
    if (matchedWithQuota) return matchedWithQuota;

    //  ตัวที่ตรง lot เต็มหมดแล้ว (หรือไม่มีตัวไหนตรง lot เลย) -> overflow ไปหา location อื่นของ item นี้ที่ยังมีโควต้าเหลือ
    const overflow = fromLocations.find(hasRemainingQuota);
    if (overflow) return overflow;

    //  ไม่เหลือที่ไหนเลยจริงๆ -> คืนค่าเดิม (ตัวที่ตรง lot ถ้ามี ไม่งั้นตัวแรกสุด) ให้ผู้เรียกไปฟ้อง "เต็มแล้ว" ตามปกติ
    return candidateLocations[0] ?? fromLocations[0];
  }

  checkFromLocationQuota(item: any, lot: string, lists: SessionPalletLists): { location: any; remaining: number } | null {
    const location = this.resolveFromLocationForItem(item, lot, lists);
    if (!location || typeof location.total_qty !== 'number') return null;

    const usedTotal = (location.complete_qty ?? 0) + this.countSessionPalletsAtLocation(location.location_id, lists);
    return { location, remaining: location.total_qty - usedTotal };
  }

  //  ใช้ตอน build SessionPalletLists.knownServerPalletKeys -> ชุด backendId ("id" ดิบ) + qrCode (normalize แล้ว)
  //  ของทุก record ใน receive_pallet/complete_pallet ของ rawJob ปัจจุบัน (พาเลทที่ backend ยืนยัน/นับไปแล้วจริง)
  buildKnownServerPalletKeys(rawJob: any): Set<string> {
    const pool = [...(rawJob?.pallets?.receive_pallet ?? []), ...(rawJob?.pallets?.complete_pallet ?? [])];
    const keys = new Set<string>();
    pool.forEach((p: any) => {
      if (p?.id != null) keys.add(String(p.id));
      const code = this.normalizeQrCodeForMatch(p?.scanned_qr_code);
      if (code) keys.add(code);
    });
    return keys;
  }

  //  พาเลทใบนี้ backend นับไปแล้วจริงหรือยัง (อยู่ใน knownServerPalletKeys) -> ใช้กัน countSessionPalletsAtLocation/
  //  sumSessionPalletWeightAtLocation ด้านล่างนับซ้ำกับ location.receive_qty/complete_qty ที่ sync มาจาก server แล้ว
  private isKnownServerPallet(p: PalletToPlaceItem, lists: SessionPalletLists): boolean {
    const keys = lists.knownServerPalletKeys;
    if (!keys) return false;
    if (p.backendId && keys.has(p.backendId)) return true;
    return !!p.qrCode && keys.has(this.normalizeQrCodeForMatch(p.qrCode));
  }

  //  นับ pallet ที่ใช้โควต้าของ Location นี้ไปแล้วในเซสชันปัจจุบัน (ไม่นับใบที่ backend ยืนยัน/sync กลับมาแล้ว กันนับซ้ำ
  //  กับ location.complete_qty ที่ caller บวกเพิ่มเองอยู่แล้ว)
  countSessionPalletsAtLocation(locationId: number | undefined, lists: SessionPalletLists): number {
    if (locationId === undefined) return 0;
    const matches = (p: PalletToPlaceItem) => p.fromLocationId === locationId && !this.isKnownServerPallet(p, lists);
    return (
      lists.palletToPlaceList.filter(matches).length +
      lists.palletsAwaitingSourceLocation.filter(matches).length +
      (lists.outboundVerificationPallets ?? []).filter(matches).length +
      lists.completedPalletList.filter(matches).length
    );
  }

  //  รวมน้ำหนัก (qty) ของ pallet ทั้งหมดที่ผูกกับ Location ต้นทางนี้ไปแล้วในเซสชันปัจจุบัน (คู่กับ countSessionPalletsAtLocation ที่นับเป็นใบ)
  //  ใช้เช็คว่าดึงของออกจาก Location ต้นทางเกินน้ำหนักที่มีจริง (location.qty) หรือไม่ -> เหมือนฝั่ง put-away ปลายทางที่มี preparePutAwayList เช็คอยู่แล้ว
  //  ไม่นับใบที่ backend ยืนยัน/sync กลับมาแล้ว (ดู isKnownServerPallet) กันนับซ้ำกับ location.receive_qty/complete_qty
  sumSessionPalletWeightAtLocation(locationId: number | undefined, lists: SessionPalletLists): number {
    if (locationId === undefined) return 0;
    const sumQty = (list: PalletToPlaceItem[]) =>
      list
        .filter((p) => p.fromLocationId === locationId && !this.isKnownServerPallet(p, lists))
        .reduce((sum, p) => sum + (p.qty ?? 0), 0);
    return (
      sumQty(lists.palletToPlaceList) +
      sumQty(lists.palletsAwaitingSourceLocation) +
      sumQty(lists.outboundVerificationPallets ?? []) +
      sumQty(lists.completedPalletList)
    );
  }

  //  หา from_location ของ pallet ที่ verify ไปแล้ว โดยอิงจาก fromLocationId ที่ผูกไว้ตอนสแกน
  resolveFromLocationByPallet(matchedItem: any, pallet: PalletToPlaceItem): any {
    const fromLocations = matchedItem?.locations?.from_locations ?? [];
    if (pallet.fromLocationId === undefined) return fromLocations[0];
    return fromLocations.find((loc: any) => loc.location_id === pallet.fromLocationId) ?? fromLocations[0];
  }

  //  หา Item ที่ตรงกับ Grade/Lot ที่กำลังสแกน
  //  isBagCode: true เฉพาะตอนเรียกจากจุดรับโค้ดถุง 5/6 ส่วน -> เทียบทั้งคำแล้วไม่เจอ item เลย ค่อยเทียบ grade ที่ตัด (…) ออก
  //  อีกรอบ (ดู gradeWithoutParen) โค้ด PL/Jumbo ไม่ส่งมา เลยไม่มีรอบ 2
  resolveItemForScan(
    parsed: ParsedScanCode,
    jobDataRaw: any,
    currentGroup: CurrentScanGroup | null,
    lists: SessionPalletLists,
    isBagCode = false,
  ): { item: any | null; errorMessage?: string } {
    const items = jobDataRaw?.items ?? [];
    const findCandidates = (grade: string) => items
      .filter((item: any) => {
        if (!this.gradesMatch(item.grade, grade)) return false;

        const itemLotNo = String(item.lot_no ?? '').trim();
        if (itemLotNo && itemLotNo === parsed.lot) return true;

        //  กรณี item ไม่มี lot_no รวม -> เทียบกับ addon_lot ของแต่ละ from_location แทน
        const fromLocations = item?.locations?.from_locations ?? [];
        if (fromLocations.some((loc: any) => this.getLocationLots(loc).some((entry) => entry.lot === parsed.lot))) return true;

        //  กรณี item มี pallet_manual (manifest คงที่ เช่น IT ที่ backend ส่ง pallet_assigned มาให้) -> lot_no/addon_lot ของ backend
        //  อาจไม่ครบ/ไม่ตรง (คนละความหมายกัน หรือไม่ส่งมาเลย) -> เช็คตรงที่ตัว QR code เองเลย เทียบ rawCode ที่สแกนได้
        //  กับ scanned_qr_code ของแต่ละใบใน pallet_manual แทน ไม่ต้องพึ่ง field อื่นที่ backend อาจส่งมาไม่ครบ
        const manualList = item?.pallet_manual ?? [];
        return manualList.some((m: any) => String(m?.scanned_qr_code ?? '').split('|')[0]?.trim() === parsed.palletId);
      })
      .sort((a: any, b: any) => a.id - b.id);

    let candidateItems = findCandidates(parsed.grade);
    if (candidateItems.length === 0 && isBagCode) candidateItems = findCandidates(this.gradeWithoutParen(parsed.grade));

    //  เช็คก่อนเสมอไม่ว่าจะกำลังสแกนกลุ่มถุงค้างอยู่ (currentGroup) หรือไม่ -> grade/lot ที่สแกนมาไม่ตรงกับใบงานเลย
    //  ต้องขึ้น error นี้ก่อน ไม่ใช่ปล่อยผ่านไปเจอ "กรุณาสแกน Pallet เดิมให้ครบก่อน" ที่ implies ว่ามันเป็นพาเลตอื่นที่ valid
    //  ทั้งที่จริงๆ grade/lot นี้ไม่มีในใบงานเลยด้วยซ้ำ
    if (candidateItems.length === 0) {
      return { item: null, errorMessage: 'Grade, Lot ไม่ตรงกับใบงาน' };
    }

    if (currentGroup) {
      //  grade/lot ที่สแกนใหม่มีอยู่จริงในใบงาน (เช็คด้านบนผ่านแล้ว) -> ยึด item ของกลุ่มที่กำลังสแกนค้างอยู่เป็นหลักเสมอ
      //  (ไม่ใช่ candidateItems ตัวแรก เพราะกลุ่มเดิมอาจ match ได้มากกว่า 1 item) ให้ตัวเรียก (scan-pallet.ts) เทียบ
      //  currentGroup.key เองว่าเป็นพาเลตคนละใบกันไหม (ขึ้น "กรุณาสแกน Pallet เดิมให้ครบก่อน" ถ้าใช่)
      const groupItem = items.find((item: any) => item.id === currentGroup.itemId);
      return { item: groupItem ?? null };
    }

    const matchedItem = candidateItems.find((item: any) => {
      const used =
        (item.complete_qty ?? 0) +
        lists.palletToPlaceList.filter((p) => p.itemId === item.id).length +
        lists.palletsAwaitingSourceLocation.filter((p) => p.itemId === item.id).length +
        (lists.outboundVerificationPallets ?? []).filter((p) => p.itemId === item.id).length;
      return used < (item.total_qty ?? 0);
    });

    if (!matchedItem) {
      const fullItemIds = candidateItems.map((item: any) => item.id).join(', ');
      return {
        item: null,
        errorMessage: `Grade/Lot "${parsed.grade} ${parsed.lot}" ครบจำนวน Pallet ตามกำหนดแล้ว (Item id: ${fullItemIds})`,
      };
    }

    return { item: matchedItem };
  }

  //  ตัวจับคู่ด้วย "โค้ดเต็ม" (costCenter|grade|lot|runningNo|palletId) แทน palletId อย่างเดียว เพราะ palletId ซ้ำข้าม grade/lot ได้
  //  โค้ด PL (PLM...|grade|lot|qty) เทียบแค่ rawCode (ส่วนแรกก่อน "|") เหมือนที่ส่งให้ backend
  normalizeQrCode(code: string | null | undefined): string {
    const raw = String(code ?? '').trim();
    return raw.startsWith('PL') ? (raw.split('|')[0] ?? '').trim() : raw;
  }

  //  QR รถ "carrierCode|ทะเบียน" -> รูปแบบเดียวกับ to_location_name ของงาน Loading (pProcessGetLoadingJobs:
  //  carrier_code + '|' + เลขตัวหน้าของทะเบียนที่เป็นตัวเลขล้วน) เช่น "111946|726988รย" -> "111946|726988"
  //  QR ที่พิมพ์จากหน้า Vehicle ของ Boardman รุ่นก่อนมีอักษรไทยท้ายทะเบียน -> backend หา Shipment ไม่เจอ / เทียบรถไม่ตรง
  //  ทะเบียนที่ขึ้นต้นด้วยอักษรไทย (เช่น "ผบ744รย") ไม่มีเลขนำหน้า -> คืนโค้ดเดิม (ถ้าตัดเหลือ "carrier|" จะไปจับรถทุกคันของ carrier นั้น)
  normalizeTruckQr(code: string | null | undefined): string {
    const raw = String(code ?? '').trim();
    const sep = raw.indexOf('|');
    if (sep < 0) return raw;

    const carrier = raw.slice(0, sep).trim();
    const digits = raw.slice(sep + 1).trim().match(/^[0-9]+/)?.[0] ?? '';

    return carrier && digits ? `${carrier}|${digits}` : raw;
  }

  //  เทียบ qrCode แบบไม่สนช่องว่าง (ใช้ normalizeQrCode เดิมก่อน แล้วตัดช่องว่างทั้งหมดทับอีกที) สำหรับจุดที่ "เทียบ" ว่า
  //  เป็น pallet เดียวกันไหมเท่านั้น (duplicate/dedup detection) เช่น grade ที่ฝังอยู่ในโค้ดมีวรรคติดมาจากเครื่องสแกน
  //  ("...|1100RC SUB|...") แต่ backend คืนมาไม่มีวรรค ("...|1100RCSUB|...") ถือเป็น pallet เดียวกัน
  //  ห้ามเอาผลลัพธ์ไปเก็บแทน pallet.qrCode/scanned_qr_code จริงเด็ดขาด (ดู normalizeQrCode ด้านบนที่ยังต้องคงไว้ตัวเดิม
  //  เพราะมีจุดอื่น (proceedCompletePallet) เอาผลลัพธ์ไปใช้เป็น qrCode จริงที่ส่งต่อ API) ตัวเดี่ยว normalizeQrCodeForMatch
  //  ไว้ใช้ตอนสร้าง Set/เช็ค .has() เอง (ต้องเรียกให้ครบทั้งฝั่งสร้างและฝั่งเช็ค ถึงจะ match กันถูก)
  normalizeQrCodeForMatch(code: string | null | undefined): string {
    return this.normalizeQrCode(code).replace(/\s+/g, '');
  }

  qrCodesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
    return this.normalizeQrCodeForMatch(a) === this.normalizeQrCodeForMatch(b);
  }

  //  Pallet นี้เคยยืนยันด้วยถุงโค้ดนี้ไหม (ถุงใบล่าสุดที่ส่ง Get หรือถุงอื่นของ Pallet เดียวกันที่สแกนในเซสชัน)
  palletHasCode(pallet: PalletToPlaceItem, code: string): boolean {
    const target = this.normalizeQrCodeForMatch(code);
    if (!target) return false;
    if (this.normalizeQrCodeForMatch(pallet.qrCode) === target) return true;
    return (pallet.bagCodes ?? []).some((c) => this.normalizeQrCodeForMatch(c) === target);
  }

  //  จับคู่ pallet ที่ verify ไปแล้ว (รอเลือก) ด้วย grade/lot + เลขท้ายโค้ด (palletId) แทนต้องเป็นถุงใบเดิมเป๊ะเหมือน palletHasCode
  //  ใช้เฉพาะตอน "เลือก" pallet ที่ค้างรออยู่ (เช่นถูกยกเลิกเลือกเพราะ location ไม่พอ, หรือ step 2 มาเลือก pallet ที่ step 1
  //  Get ไว้แล้ว) เพราะคนขับจำไม่ได้ว่าตอน verify ใช้ถุงใบไหน แต่ยังยืนยันได้ว่าเป็น pallet ต้นทางใบเดียวกันจาก grade/lot
  //  + เลขท้าย QR ที่ตรงกัน (ไม่ใช้จุดอื่น เช่น checkPalletIdConflict ที่ต้องจับด้วยโค้ดเป๊ะเพื่อกันสแกนถุงซ้ำหลุดผ่าน)
  //  รองรับทั้งโค้ดถุงปกติ (5 ส่วน) และ Jumbo Bag (7 ส่วน, เทียบ grade แบบผ่อนปรนด้วย stripJumboBagGradeCode เหมือนตอน Get
  //  เพราะ grade ที่ฝังมาอาจมี "GRADE " นำหน้า/ "/900" ต่อท้ายไม่ตรงกับตอน verify ครั้งแรกเป๊ะ)
  findPendingPalletByRunningNumber(pallets: PalletToPlaceItem[], code: string): PalletToPlaceItem | null {
    const normalParsed = this.parseScanCode(code);
    const jumboParsed = !normalParsed ? this.parseJumboBagScanCode(code) : null;
    const parsed = normalParsed ?? jumboParsed;
    if (!parsed) return null;

    const isJumbo = !!jumboParsed;
    const scannedGradeKey = isJumbo ? this.stripJumboBagGradeCode(parsed.grade) : parsed.grade;
    const parsePalletId = (c: string) => (isJumbo ? this.parseJumboBagScanCode(c) : this.parseScanCode(c))?.palletId;

    return (
      pallets.find((p) => {
        const gradeMatches = isJumbo ? this.stripJumboBagGradeCode(p.grade) === scannedGradeKey : this.gradesMatch(p.grade, parsed.grade);
        if (!gradeMatches || p.lotNo !== parsed.lot) return false;
        const ownCodes = [p.qrCode, ...(p.bagCodes ?? [])].filter((c): c is string => !!c);
        return ownCodes.some((c) => parsePalletId(c) === parsed.palletId);
      }) ?? null
    );
  }

  //  record ใน receive_pallet/awaiting_source_pallet (ของ backend หรือที่ mirror ไว้ฝั่ง client) นี้คือ Pallet ใบนี้ไหม
  //  จับด้วย scanned_qr_code ก่อน (ถ้าทั้งสองฝั่งมี) ไม่งั้นเทียบ id + grade/lot (ไม่ใช้ id อย่างเดียว เพราะ id ซ้ำข้าม grade/lot ได้)
  isSamePalletRecord(entry: any, pallet: PalletToPlaceItem): boolean {
    const entryCode = this.normalizeQrCodeForMatch(entry?.scanned_qr_code);
    const palletCode = this.normalizeQrCodeForMatch(pallet.qrCode);
    if (entryCode && palletCode) return entryCode === palletCode;

    if (pallet.id === null || String(entry?.id) !== String(pallet.id)) return false;
    const entryGrade = String(entry?.grade ?? '').trim();
    const entryLot = String(entry?.lot ?? '').trim();
    return (!entryGrade || this.gradesMatch(entryGrade, pallet.grade)) && (!entryLot || entryLot === pallet.lotNo);
  }

  //  ตรวจสอบว่าถุงที่สแกนนี้ (โค้ดเต็ม) ถูกใช้ไปแล้วในสถานะอื่นหรือยัง (รอ source location / จัดวางเสร็จแล้ว)
  //  ไม่ใช้ palletId อย่างเดียวจับอีกแล้ว: palletId เดียวกันซ้ำข้าม grade/lot ได้ ไม่ได้ Unique ทั้งระบบ
  checkPalletIdConflict(
    code: string,
    jobDataRaw: any,
    lists: SessionPalletLists,
  ): { icon: string; message: string } | null {
    //  ฟอร์แมต 6 ช่อง: ต่อ dateTime เข้าไปในชื่อที่โชว์ด้วย ("004 | 211006") กันงงว่าชนกันที่ dateTime ไหน
    //  (palletId อย่างเดียวบอกไม่ได้ เพราะฟอร์แมตนี้ palletId ซ้ำกันได้ข้าม dateTime)
    const parsedForLabel = this.parseScanCode(code);
    const label = parsedForLabel
      ? (parsedForLabel.dateTime ? `${parsedForLabel.palletId} | ${parsedForLabel.dateTime}` : parsedForLabel.palletId)
      : this.normalizeQrCode(code);

    const awaitingSource = lists.palletsAwaitingSourceLocation.find((p) => this.palletHasCode(p, code));
    if (awaitingSource) {
      return {
        icon: 'warning',
        message: `Pallet No. "${label}" ถูกยืนยันถุงไปแล้ว กรุณาสแกน Location ต้นทาง "${awaitingSource.sourceLocation}" เพื่อยืนยัน ไม่สามารถสแกนถุงซ้ำได้`,
      };
    }

    const verifying = (lists.outboundVerificationPallets ?? []).find((p) => this.palletHasCode(p, code));
    if (verifying) {
      return {
        icon: 'warning',
        message: `Pallet No. "${label}" กำลังตรวจสอบอยู่ กรุณารอสักครู่ก่อนสแกนซ้ำ`,
      };
    }

    const target = this.normalizeQrCodeForMatch(code);
    const completedThisSession = lists.completedPalletList.some((p) => this.palletHasCode(p, code));
    const completedFromServer = (jobDataRaw?.pallets?.complete_pallet ?? []).some(
      (p: any) => this.normalizeQrCodeForMatch(p?.scanned_qr_code) === target,
    );
    if (completedThisSession || completedFromServer) {
      return { icon: 'error', message: `Pallet No. "${label}" ถูกจัดวางเสร็จสิ้นไปแล้ว ไม่สามารถสแกนซ้ำได้` };
    }

    return null;
  }
}
