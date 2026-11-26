//  Standard Response Syntax
export interface ResponseStandard {
  status: string;
  message: string;
  result: any;
}

/*------------------ Broken Bag List ---------------------*/
//  Contract ของ api/v1/Process/broken-bag (BrokenBagController) — พอร์ตเฉพาะส่วน
//  list + create ที่หน้า report-broken-bag ของ FL ใช้ จากโปรเจกต์
//  IRPC_BARCODE_FE_PWA_CHECKER/broken-bag-list (ตัด approve/reject/replace ฝั่ง Checker ออก)
export type BrokenBagTimelineTitle =
  | 'แจ้งเปลี่ยนถุงแตก'
  | 'Checker Approve'
  | 'ตรวจสอบถุง'
  | 'เปลี่ยนถุงแตกสำเร็จ'
  | 'นำของขึ้นรถสำเร็จ';

export interface BrokenBagTimelineStep {
  title: BrokenBagTimelineTitle | string;
  subtitle: string;
  status: 'done' | 'active' | 'pending';
}

//  ยอดที่แจ้งไว้ตอนสร้างงาน (เดิมชื่อ damage_bags ก่อน backend เปลี่ยน key) — โชว์ในรายการ job list + ใช้เป็นเป้าของ modal เปลี่ยนของกับ Warehouse
export interface BrokenBagReportedItem {
  id: number;
  grade: string;
  lot: string;
  qty: number;   // น้ำหนัก (กก.)
  bag: number;   // จำนวนถุง — ใช้แสดงผลแทน qty (qty เป็นน้ำหนัก ไม่ใช่จำนวนถุง)
  status: 'Checked' | 'Pending';
}

//  1 ถุงที่ถูกสแกนจริงระหว่างขั้นตอนต่างๆ ของงาน (เช่น Get ตอน scan-pallet งาน BK) — เป็น log ต่อถุง ไม่ใช่ยอดสรุป
export interface BrokenBagScannedBag {
  id: number;
  grade: string;
  lot: string;
  qty: number;
  user_id: number | null;
  user_name: string | null;
}

//  สรุปเหตุผล+จำนวนต่อเหตุผล (Checker กรอกไว้ตอน approve)
export interface BrokenBagRemarkReason {
  reason: string;
  qty: number;
  bag: number;
}

//  1 แถวใน tr_broken_bag_replace_detail — ถุงที่ forklift สแกน/พิมพ์ไปแล้วและกด Submit
//  ยืนยันจาก response จริง (job BK-20260026): ไม่มี fg/scan_datetime/create_datetime อย่างที่เคยคิด
//  โครงเดียวกับ BrokenBagScannedBag (damage_bags) + bag_qr_code เพิ่มมา
export interface ReplaceDetailItem {
  id: number;
  grade: string;
  lot: string;
  qty: number;
  bag_qr_code: string | null;
  user_id: number | null;
  user_name: string | null;
}

//  1 แถวต่อ 1 ใบงาน — array ที่ซ้อน (steps / damage_bags / replace_bags / reported_items) ถูก group มาจาก backend แล้ว
export interface ResultProcessBrokenBagListData {
  id: number;
  system_no: string;
  report_location_id: number | null;
  report_location_type: string | null;
  sm: string | null;
  do_no: string | null;
  status_id: number;
  status_name: string;
  action_type: 'inspect' | 'replace';
  remark: string | null;
  remark_reasons: BrokenBagRemarkReason[];
  reject_reason: string | null;
  warehouse_ready: boolean;
  shipping_ready: boolean;
  create_datetime: string;
  steps: BrokenBagTimelineStep[];
  damage_bags: BrokenBagScannedBag[];
  replace_bags: ReplaceDetailItem[];
  reported_items: BrokenBagReportedItem[];
}

export interface ResponseProcessBrokenBagListData {
  status: string;
  message: string;
  data: ResultProcessBrokenBagListData[];
  total_count: number;
}

//  Body ของ POST broken-bag (ปุ่ม "แจ้งเปลี่ยนถุงแตก" ใน modal)
export interface CreateBrokenBagItem {
  grade: string;
  lot: string;
  qty: number;   // น้ำหนัก (กก.) — flow นี้ไม่มีเครื่องชั่ง ส่ง 0 ไปก่อน
  bag: number;   // จำนวนถุงที่ผู้ใช้กรอก
}

export interface CreateBrokenBagModel {
  reportLocationId?: number;
  reportLocationType?: string;
  sm?: string;
  doNo?: string;
  items: CreateBrokenBagItem[];
  createBy?: number;
}

//  1 คันจาก GET api/v1/master/vehicle — เช็คว่ามีรถคันนี้จริงไหมตอนสแกน QR รถ (carrierCode|licensePlate)
export interface MasterVehicleItem {
  license_plate: string;
  vehicle_text: string | null;
  vehicle_type_desc: string | null;
  vehicle_group_desc: string | null;
  is_active: string | null;
  carrier_id: number | null;
  carrier_code: string | null;
  carrier_name: string | null;
}

export interface ResponseMasterVehicle {
  status: string;
  message: string;
  data: MasterVehicleItem[];
}

//  1 dock จาก GET api/v1/master/location/dock — เช็คว่ามี dock นี้จริงไหมตอนสแกน QR dock (ค่าที่สแกนคือ location_desc)
export interface MasterDockItem {
  id: number;
  wh_code: string | null;
  area_code: string | null;
  level_code: string | null;
  location_code: string | null;
  location_desc: string;
}

export interface ResponseMasterDock {
  status: string;
  message: string;
  data: MasterDockItem[];
}

//  1 ถุงที่สแกนใน modal "เปลี่ยนของกับ Warehouse" -> 1 แถวใน tr_broken_bag_replace_detail
//  fg: Finish Good — 0 = NG (ถุงแตกที่ถอดออก), 1 = OK (ถุงดีจาก Warehouse ที่เอามาเปลี่ยน)
export interface ReplaceItemModel {
  fg: number;
  bagQrCode?: string;         // โค้ด QR ถุงที่สแกน/พิมพ์เอง (ดิบ)
  scanDatetime?: string;      // ISO — เวลาที่สแกนถุงใบนั้น
  reason?: string;            // เหตุผลของถุงใบนี้ — ใช้กับ PATCH broken-bag/{id}/shipping/scan-bag เท่านั้น
}

export interface ConfirmReplaceBrokenBagModel {
  flWarehouseUserId: number;
  flShippingUserId: number;
  ckWarehouseUserId: number;
  ckShippingUserId: number;
  items: ReplaceItemModel[];
}

//  Body ของ PATCH broken-bag/{id}/shipping/scan-bag (ปุ่ม Submit ใน modal "เปลี่ยนของกับ Warehouse" — แทน forklift-scan-broken-bag เดิม)
export interface ShippingScanBrokenBagModel {
  items: ReplaceItemModel[];
  updateBy?: number;
}

//  Body ของ PATCH broken-bag/{id}/forklift-scan (ปุ่ม Submit ใน modal "เปลี่ยนของกับ Warehouse")
//  บันทึกเฉพาะรายการถุงที่สแกน — user_id ฝั่ง API อ่านจาก JWT ให้เอง
export interface ForkliftScanBrokenBagModel {
  items: ReplaceItemModel[];
}

//  Body ของ PATCH broken-bag/{id}/complete — ปิดงาน หลังนำของขึ้นรถ (put-away) สำเร็จเท่านั้น
export interface CompleteBrokenBagModel {
  updateBy: number;
}

//  Body ของ PATCH master/forklift/{flId}/checkin และ /checkout — stamp ใช้งาน/เลิกใช้งานรถ forklift
export interface ForkliftCheckModel {
  updateBy: number;
}

//  Get user
export interface ResponseLogin {
  status: string;
  message: any;
  token: string;
}

//  Permission flags แนบอยู่ใน JWT payload (ทุกค่าเป็น 'Y' | 'N')
export interface JwtPermission {
  transferSlip: string;
  putAway: string;
  picking: string;
  shipmentDelivery: string;
  requestOther: string;
  specialPackage: string;
  breakageReplacement: string;
  tabletPwa: string;
  pcWeb: string;
  palletManagement: string;
  masterData: string;
  userManagement: string;
  auditLog: string;
  truckInfo: string;
  locationInfo: string;
}

//  Payload ที่ decode ได้จาก JWT ตอน Login
export interface JwtPayload {
  id: string;
  user_id: string;
  user_name: string;
  emp_id: string;
  department_id: string;
  department: string;
  role_id: string;
  role: string;
  permission: string;   // JSON string -> ต้อง JSON.parse ต่อเป็น JwtPermission
  exp: number;
  iss: string;
  aud: string;
}

//  ข้อมูล user ที่แกะจาก JwtPayload แล้ว เก็บไว้ที่ sessionStorage key '_USER_INFO'
export interface UserSessionInfo {
  id: string;
  userId: string;
  userName: string;
  empId: string;
  departmentId: string;
  department: string;
  roleId: string;
  role: string;
  permission: JwtPermission | null;
  exp: number;
}

export interface LastSelection {
  orgId: number;
  type: number;
  year: number;
  month: number;
}

//  Process CB
export interface ResponseProcessCbJobStatus {
  status: string
  message: string
  data: ResultProcessCbJobStatus[]
}

export interface ResultProcessCbJobStatus {
  id: number
  name: string
  name_th: string
}

export interface ResponseProcessCbJobType {
  status: string
  message: string
  data: ResultProcessCbJobType[]
}

export interface ResultProcessCbJobType {
  id: number
  topic: string
  name: string
}


//  Process
export interface ResponseProcessGetForklift {
  status: string
  message: string
  data: ResultProcessGetForklift[]
  total_count: number
}

export interface ResultProcessGetForklift {
  id: number
  forklift_name: string
  warehouse_code: string
  forklift_status: string
  lasted_used_datetime: string
  updated_datetime: string
  status_active: string
  remark: any
}

export interface ResponseProcessGetForkliftJob {
  status: string
  message: string
  data: ResultProcessGetForkliftJob[]
}

export interface ResultProcessGetForkliftJob {
  id: number
  system_no: string
  type_id: number
  type_topic: string
  type_name: string
  is_urgent: string
  is_multi_fl: string
  from_location_type: string
  from_location_cc_code: string
  from_location_cc_desc: string
  to_location_type: string
  to_location_cc_code: string
  to_location_cc_desc: string
  movement_unit: string
  receive_qty: number
  complete_qty: number
  total_qty: number
  status_id: number
  status_name: string
  remark: string
  start_datetime: any
  end_datetime: any
  create_datetime: string
  pallets?: Pallets
  items: gradeLot[]
}

export interface gradeLot {
  id: number
  document_job: string
  grade: string
  lot_no: string
  qty: number
  movement_unit: string
  receive_qty: number
  complete_qty: number
  total_qty: number
  locations: Locations
}

export interface ResponseProcessGetShipmentJob {
  status: string
  message: string
  data: ResultProcessGetShipmentJob[]
}

export interface ResultProcessGetShipmentJob {
  id: number
  system_no: string
  type_id: number
  type_topic: string
  type_name: string
  is_urgent: string
  is_multi_fl: string
  from_location_type: string
  from_location_cc_code: any
  from_location_cc_desc: string
  to_location_type: string
  to_vehicle_desc: string
  receive_pallet: number
  complete_pallet: number
  total_pallet: number
  status_id: number
  status_name: string
  remark: any
  start_datetime: any
  end_datetime: any
  create_datetime: string
  pallets: Pallets
  items: Item[]
}

export interface Pallets {
  receive_pallet: any[]
  complete_pallet: any[]
}

export interface Item {
  id: number
  do_no: string
  document_job: string
  grade: string
  lot_no: string
  qty: number
  receive_pallet: number
  complete_pallet: number
  total_pallet: number
  locations: Locations
}
export interface Locations {
  from_locations: FromLocation[]
  to_locations: ToLocation[]
}

//  รายการ Lot ย่อยของ Location เดียว (backend เปลี่ยนจาก addon_lot เป็น string ค่าเดียว -> array แบบนี้)
export interface AddonLotEntry {
  lot: string
  qty: number
}

export interface FromLocation {
  id: number
  wh_code: any
  location_id: number
  location_name: string
  //  รองรับทั้งรูปแบบเก่า (string ค่าเดียว) และรูปแบบใหม่จาก backend (array ของ {lot, qty})
  addon_lot?: string | AddonLotEntry[]
  qty?: number
  actual_qty?: number
  movement_unit?: string
  receive_qty?: number
  complete_qty?: number
  total_qty?: number
  receive_pallet?: number
  complete_pallet?: number
  total_pallet?: number
}

export interface ToLocation {
  id: number
  wh_code: any
  location_id: number
  location_name: string
  addon_lot?: string | AddonLotEntry[]
  qty?: number
  actual_qty?: number
  movement_unit?: string
  receive_qty?: number
  complete_qty?: number
  total_qty?: number
  receive_pallet?: number
  complete_pallet?: number
  total_pallet?: number
}

export interface ResponseProcessGetPallet {
  status: string
  message: string
  data: ResultProcessGetPallet[]
  total_count: number
}

export interface ResultProcessGetPallet {
  id: number
  pallet_no: string
  grade: string
  lot: string
  pallet_type: string
  current_location: string
  unit_pallet: number
  qty: number
  create_datetime: string
}

/*------------------ Pallet Management ---------------------*/
//  GET api/v1/process/pallet-management (pProcessPalletMgmtGetPallet)
export interface ResponsePalletManagement {
  status: string
  message: string
  data: ResultPalletManagement | null
}

export interface ResultPalletManagement {
  pallet: PalletManagementPallet | null
  bags: PalletManagementBag[]
}

export interface PalletManagementPallet {
  id: number
  pallet_no: string
  //  A / M / S / J / D (D = Dummy pallet PLD...) -- null ถ้า DB ยังไม่ได้รัน sql/108_
  pallet_type?: string | null
  cost_center: string
  grade: string
  lot: string
  unit_pallet: number
  unit_ratio: number
  //  กก./ถุง ตาม grade (ct_grade_package_ratio) -- 0 ถ้า DB ยังไม่ได้รัน sql/108_ หรือไม่พบ grade
  package_ratio?: number
  bag_count: number
  qty: number
  pallet_status_id: number | null
  location_type: string | null
  location_id: number | null
}

export interface PalletManagementBag {
  id: number
  bag_no: number | null
  //  running pallet no (Ton No.)
  pallet_running_no: number | null
  cost_center: string
  grade: string
  lot: string
  qr_text_data: string
  bag_status_id: number | null
  qty: number
}

//  GET api/v1/process/pallet-management/bag (pProcessPalletMgmtFindBag) -- ถุง orphan สำหรับ Add/Replace
export interface ResponsePalletManagementFindBag {
  status: string
  message: string
  data: PalletManagementFoundBag | null
}

export interface PalletManagementFoundBag {
  id: number
  bag_no: number | null
  pallet_running_no: number | null
  cost_center: string
  grade: string
  lot: string
  qr_text_data: string
  qty: number
  //  พาเลทที่ถุงอยู่ตอนนี้ (null = ถุง orphan) -- มีค่าเฉพาะตอนค้นแบบ allowOnPallet (Replace/สลับ)
  pallet_id?: number | null
  pallet_no?: string | null
}

export interface PalletManagementAddBagModel {
  bagId: number
  palletId: number
  userId: number
}

//  รวมพาเลทที่มี Manual (PLM) เกี่ยวข้อง -- pProcessPalletMgmtMergePallet (81)
export interface PalletManagementMergePalletModel {
  srcPalletId: number
  palletId: number
  userId: number
}

export interface PalletManagementReplaceBagModel {
  palletId: number
  oldBagId: number
  newBagId: number
  reason?: string
  userId: number
}

export interface PalletManagementPullOutBagModel {
  bagId: number
  userId: number
}

//  POST pallet-management/clear-dummy (pProcessClearDummyPallet, sql/107_)
export interface PalletManagementClearDummyModel {
  palletId: number
  userId: number
}

//  POST pallet-management/dummy/transfer (pProcessDummyPalletTransferBags, sql/109_)
//  result.remain_qty = กก. ที่เหลือบนพาเลท Manual / ถุงที่เหลือบนพาเลทอื่น
export interface PalletManagementDummyTransferModel {
  srcPalletId: number
  palletId: number
  bagCount: number
  userId: number
}

export interface PalletManagementRejectBagModel {
  bagId: number
  reason?: string
  userId: number
}

export interface PalletManagementEditBagModel {
  bagId: number
  costCenter: string
  bagNo: number
  palletRunningNo: number
  grade: string
  lot: string
  userId: number
}
/*------------------ Scan Location Info ---------------------*/
//  GET api/v1/master/location/wh/MWH?locationDesc=... — 1 แถว = 1 location (WMS+ join qtrack ct_location)
export interface MasterWhLocationItem {
  id: number | null;
  location_id: number;
  wh_code: string;
  area_code: string;
  level_code: string;
  location_code: string;
  location_desc: string;
  priority_name: string | null;
  is_active: boolean;
}

export interface ResponseMasterWhLocation {
  status: string;
  message: string;
  data: MasterWhLocationItem[];
  total_count: number;
}

//  GET api/v1/process/pallet/by-location (pProcessGetPalletListByLocation)
//  tr_pallet.current_location_type = 'MWH' AND current_location_id = locationId
export interface PalletByLocationItem {
  id: number;
  pallet_no: string;
  cost_center: string;
  grade: string;
  lot: string;
  ton_no: number | null;      // ตันที่ (tr_bag.ton_no — เลขตันหลัง re-run)
  qty: number;
  create_datetime: string;
}

export interface ResponsePalletByLocation {
  status: string;
  message: string;
  data: PalletByLocationItem[];
  total_count: number;
}
