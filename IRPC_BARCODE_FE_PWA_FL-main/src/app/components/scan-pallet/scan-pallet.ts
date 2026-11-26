import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  HostListener,
  ChangeDetectorRef,
} from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { driver, DriveStep } from 'driver.js';
import { TourService } from '../../service/tour.service';
import { of, from, concat, defer, Observable, throwError } from 'rxjs';
import { map, catchError, toArray, switchMap } from 'rxjs/operators';
import {
  ScanPalletLogicService,
  PalletTargetLocation,
  ParsedScanCode,
  FullPalletScanCode,
  JumboBagScanCode,
  PalletToPlaceItem,
  CurrentScanGroup,
  SessionPalletLists,
  SpecialPalletGroup,
} from '../../service/scan-pallet-logic.service';
import { ScanPalletApiService } from '../../service/scan-pallet-api.service';
import { OfflineQueueService, QueueActionType } from '../../service/offline-queue.service';
import { CrudService } from '../../service/crud.service';
import { NetworkService } from '../../service/network.service';
import { OfflineSyncService } from '../../service/offline-sync.service';

//  ═════════════════════════════════════════════════════════════
//  TYPES / INTERFACES
//  ═════════════════════════════════════════════════════════════

//  ข้อมูล Pallet สำหรับแสดงในสรุปฝั่งขวา (Total Pallet Display)
interface TotalPalletDisplayItem {
  key: string;
  grade: string;
  lotNo: string;
  qty: number | string;
  id: string | null;
  //  โค้ด PL เท่านั้น: id ตัวเลขจริงของ backend (แยกจาก id ด้านบนที่เป็น rawCode "PLM..." เสมอ ใช้โชว์ "id :" แทน rawCode)
  backendId?: string;
  //  เลข Pallet No. ดิบจาก QR ตรงๆ (ไม่ผ่าน Number() เหมือน id ด้านบน) -> โค้ด PL = rawCode "PLM...", โค้ดปกติ/Jumbo =
  //  เลขท้ายดิบไม่ตัดศูนย์หน้า (เช่น "001") ใช้โชว์ "Pallet No. :" แยกจาก "id :" ที่เป็นเลข backend จริง (backendId)
  rawPalletNo?: string | null;
  status: 'pending' | 'waiting-location' | 'complete' | 'waiting-source-location' | 'special-open';
  locationName?: string;
  //  งาน Special เท่านั้น: เลข Pallet ของแถวนี้ + รายการ grade/lot/qty ข้างในกล่อง (1 pallet ใส่ได้หลาย grade/lot)
  palletSeq?: number;
  contents?: { grade: string; lot: string; qty: number }[];
  //  งาน RQ/Transfer WH/IT เท่านั้น: ยอดถุงที่กดยืนยัน (ล็อก) ไว้แล้ว รอแค่สแกน Location ต้นทาง (ดู
  //  onLockSpecialQtyForLocationScan) -> โชว์ต่อท้าย "พาเลท #N" แยกจาก locationName (ป้ายม่วง "รอสแกน...")
  pendingLockedQty?: number;
  //  จำนวนถุงที่ล็อกไว้ (คู่กับ pendingLockedQty ด้านบน) -> โชว์คู่กัน "(25 กก. • 2 ถุง)"
  pendingLockedBagCount?: number;
  //  งาน Special เท่านั้น: หมายเลขพาเลทของแถวนี้ (ไม่รวม raw id) จากโค้ดที่สแกนจริง ดู specialPalletNos
  palletNos?: string;
}

//  งานปกติเท่านั้น: รวม row ของ _totalPalletDisplayList ที่เป็น item (grade/lot) เดียวกันไว้เป็นกลุ่มเดียว ให้ collapse/expand ได้
interface TotalPalletGroup {
  key: string;
  grade: string;
  lotNo: string;
  doneCount: number;
  totalCount: number;
  rows: TotalPalletDisplayItem[];
}

//  Modal สแกนถุง (เฉพาะงาน Special Package) — เปิดหลังสแกนถุง + ยืนยัน Location ต้นทางแล้ว
//  ทุกถุงที่จะเอา/เก็บต้องสแกน QR Code จริงเข้ามาทีละใบ (ไม่ใช่พิมพ์จำนวนเอง) เพราะ Get ส่ง qrCodes เป็น array ให้ backend คำนวณ กก. เอง
interface SpecialQtyModalState {
  code: string;
  parsed: ParsedScanCode;
  item: any;
  remaining: number;
  serverRemaining?: number;
  scannedCodes: string[];
  hint: string | null;
  //  toggle เอาออก/จัดเก็บ: 'take' (modeId 3) = ถุงที่สแกนคือถุงที่จะเอาออกจริง, 'store' (modeId 2) = เก็บไว้ไม่เอาออก
  mode: 'take' | 'store';
  //  งาน 2-step + item นี้ยังไม่เคยถูกส่งให้ Step 2 -> ขึ้นปุ่ม "ส่งให้ Step 2" ได้
  canSendToStep2: boolean;
  //  true = สแกนถุงที่เคยถูก "ส่งให้ Step 2" ไว้ (มาจาก prepare_pallet) ใช้ตัดสินว่าจะโชว์ id ของ pallet ที่ผลักเข้ารายการหรือไม่
  isStep2Continuation: boolean;
  //  เลข Pallet ที่กำลัง Get เข้าอยู่ (จากการกด "Add Pallet"/กด card เพื่อ select) -> ส่งกลับไปกับ Get ว่าถุงชุดนี้อยู่ pallet ใบไหน
  palletSeq: number;
  //  record จาก GetProcessPallet ของถุงใบแรกที่สแกน (มี unit_ratio = กก./ถุง ให้ตรงๆ) -> คูณจำนวนถุงที่สแกนทั้งหมด
  sourceRecord: any;
  //  งานกลุ่ม _isAutoSpecialJob (RQ/Transfer WH/IT/Picking/Special Package) เท่านั้น: ชื่อ Location ต้นทางที่ยังไม่ถูก
  //  สแกนยืนยัน (modal เปิดก่อนสแกน Location แล้ว ต่างจาก BK ที่ Location ถูกยืนยันไปก่อนเปิด modal อยู่แล้ว) ใช้โชว์
  //  บอก user ว่าต้องสแกนอะไรตอนครบ
  sourceLocation?: string;
  //  ต้นทางถูกยืนยันแล้ว จึงกดยืนยันเพื่อส่ง Get ซ้ำได้แม้ผู้ใช้แก้จำนวนหลัง API ปฏิเสธ
  sourceLocationConfirmed?: boolean;
  //  งาน RQ/Transfer WH/IT เท่านั้น: user กดปุ่ม "เลือกทั้งหมด" สลับจากนับทีละถุงมาเป็นเอาทั้งพาเลท (ดู
  //  onToggleSpecialSelectAll) -> สลับ UI เป็นสรุปเต็มพาเลท กด "ยกเลิก" กลับมานับทีละถุงแบบเดิมได้ (ยังไม่กระทบ
  //  entry จริงจนกว่าจะกด "ยืนยัน" ดู onConfirmSpecialSelectAll) undefined/false = โหมดนับทีละถุงปกติ
  selectAllMode?: boolean;
}

//  งาน Special Package: ถุงที่สแกนแล้ว grade/lot ถูกต้อง แต่ยังไม่ได้ยืนยัน Location ต้นทาง (รอสแกน Location ต้นทางก่อนถึงจะขึ้น modal ถามจำนวน)
interface SpecialAwaitingSourceEntry {
  code: string;
  parsed: ParsedScanCode;
  item: any;
  remaining: number;
  sourceLocation: string;
  //  true = ถุงใบนี้อยู่บน pallet ที่ is_full_pallet = 'Y' และ user ยืนยันจะเอาทั้ง pallet (modeId 1 Full Pallet)
  isFullPallet: boolean;
  fullPalletRecord: any;
  palletSeq: number;
  //  true เฉพาะ Jumbo Bag ที่ auto เปิดกล่องใหม่ของตัวเอง (ไม่ได้เข้ากล่องที่ user กด Add Pallet ไว้เอง) -> Get สำเร็จ
  //  แล้วข้าม "เตรียมเอาไปวาง" ไปเข้ารายการที่รอวางเลยทันที เพราะไม่มีใครจะมาเติมของเพิ่มใส่กล่องนี้อีกแน่นอน
  autoReady?: boolean;
  //  งานกลุ่ม _isAutoSpecialJob (RQ/Transfer WH/IT/Picking/Special Package) เท่านั้น: กดปุ่ม "ยืนยัน" ล็อกจำนวนถุงที่
  //  นับไว้แล้ว (ดู onLockSpecialQtyForLocationScan) ก่อนสแกน Location ต้นทางจริง -> เก็บรายการถุงทั้งหมด (ไม่ใช่แค่
  //  ถุงใบแรก) ไว้ยิง Get ตอนสแกน Location จริง (ดู handleSpecialSourceLocationScan) undefined = ยังไม่กดล็อก (เคส ×
  //  ปิด modal กลางคัน หรือ BK ที่ modal ยังไม่เปิดตอนนี้) -> ยังคงพฤติกรรมเดิม (เปิด modal ใหม่เหลือแค่ถุงใบแรก)
  lockedCodes?: string[];
  lockedMode?: 'take' | 'store';
}

//  งาน Special Package: item ที่ถูก "ส่งให้ Step 2" ไว้แล้ว (มีอยู่ใน prepare_pallet) แต่ยังไม่มีใครมาสแกนรับจริง
//  แสดงเป็นการ์ดสีเหลืองในลิสต์ซ้าย (แสดงผลอย่างเดียว กดอะไรไม่ได้ ต้องสแกนถุงจริงถึงจะเปลี่ยนสถานะ)
interface SpecialPreparedDisplayItem {
  key: string;
  grade: string;
  lotNo: string;
  progressLabel: string;
  targetLocations: PalletTargetLocation[];
}

//  ═════════════════════════════════════════════════════════════
//  COMPONENT: ScanPallet
//  ═════════════════════════════════════════════════════════════
@Component({
  selector: 'app-scan-pallet',
  standalone: false,
  templateUrl: './scan-pallet.html',
  styleUrl: './scan-pallet.css',
})
export class ScanPallet implements OnInit, AfterViewInit, OnDestroy {

  //  ─────────────────────────────────────────────────────────────
  //  VIEW REFS
  //  ─────────────────────────────────────────────────────────────
  @ViewChild('scannerInput') scannerInputRef!: ElementRef<HTMLInputElement>;

  //  ─────────────────────────────────────────────────────────────
  //  STATE: Job Data
  //  ─────────────────────────────────────────────────────────────
  _job: any = { jobTag: '-', jobNomber: '-' };
  _jobDataRaw: any = null;
  _isMultiStep = false;
  _totalPalletCount = 0;

  _palletToPlaceList: PalletToPlaceItem[] = [];
  _completedPalletList: PalletToPlaceItem[] = [];

  //  จำนวนที่ "เสร็จแล้ว" จริง = รวม complete_qty สดจาก _jobDaโtaRaw.items ตรงๆ ทุกครั้งที่เรียก (ไม่ใช่ snapshot ค้าง)
  //  markPalletPutAwayComplete update เลขนี้ทันทีตอน put สำเร็จ (rawItem.complete_qty += completeAmount) และ
  //  refreshJobProgressFromServer ก็ sync กลับมาแบบ Math.max ต่อ item เดียวกัน (ไม่มีวันถอยหลัง) -> อ่านค่าปัจจุบันตรงๆ
  //  จากตรงนี้เลยถูกต้องเสมอทันทีที่ put สำเร็จ ไม่ต้องรอ auto-fetch ก่อนถึงจะขยับ (ของเดิมใช้ baseline แยกต่างหากที่ freeze
  //  ไว้ตอนโหลดหน้า แล้ว Math.max กับยอดสะสมแค่ใน session นี้ -> ถ้า baseline ตอนโหลดมากกว่ายอดที่เพิ่ง put ใน session
  //  (เช่น งานที่ complete ไปแล้วบางส่วนจากรอบก่อน) จะค้างเลขเก่าจนกว่า auto-fetch รอบถัดไปจะมาอัปเดต baseline ให้)
  get _completedPalletCount(): number {
    const items = this._jobDataRaw?.items ?? [];
    return items.reduce((sum: number, item: any) => sum + (item.complete_qty ?? 0), 0);
  }

  _currentUserId = 0;
  _palletsAwaitingSourceLocation: PalletToPlaceItem[] = [];
  private _outboundVerificationPallets: PalletToPlaceItem[] = [];

  //  ─────────────────────────────────────────────────────────────
  //  STATE: Job Type Flags & Scan Mode
  //  ─────────────────────────────────────────────────────────────
  _isOutbound = false;
  _isRequestJob = false;
  _isPickingJob = false;
  _isShippingJob = false;
  //  true = ใช้ special-job flow ทั้งหมด (Add Pallet, palletSeq, session tracking ฯลฯ) — ครอบคลุมทั้ง Special Package และ Breakage & Replacement
  _isSpecialJob = false;
  //  false เฉพาะงาน Breakage & Replacement — เหมือน special ทุกอย่างแต่ตัดตัวเลือก "เอาทั้ง pallet" ออก (ต้องสแกนทีละถุงเสมอ)
  _specialAllowsFullPallet = false;
  //  true เฉพาะงาน Breakage & Replacement — อยู่ในกลุ่ม _isAutoSpecialJob (สแกนได้เลย/modal นับถุงตั้งแต่ถุงแรก) แต่ยังนับ
  //  ทีละถุงเสมอ (_specialAllowsFullPallet false) และไม่มีขั้นสแกน location ปลายทาง -> Get สำเร็จแล้วยิง Put ต่อให้เองทันที
  //  (ดู putAwayBkPallets) ปลายทางโชว์เป็น text จาก items[].locations.to_locations ตอนงานครบ
  _isBkJob = false;
  //  true เฉพาะงาน Internal Transfer — isSpecialJob เป็น true ด้วย (ใช้ special-job flow ทั้งหมดฝั่ง client เหมือน Special Package
  //  เต็มรูปแบบ รวมขั้น put-away) แต่ backend แยก endpoint get/putAway/reset ของตัวเอง (ดู isInternalTransferJob ใน JobTypeFlags)
  _isInternalTransferJob = false;
  //  true เฉพาะงาน Transfer WH (งานใหม่) — เหมือน Internal Transfer เป๊ะ: isSpecialJob เป็น true ด้วย ใช้ special-job flow
  //  ทั้งหมดฝั่ง client แต่ backend แยก endpoint get/putAway/reset ของตัวเองที่ /transfer-wh/... (ไม่มี concept manifest
  //  แบบ IT เลย เป็น special-job เสมอ ไม่ต้องเช็ค pallet_assigned)
  _isTransferWhJob = false;
  //  true เฉพาะงาน Picking — isSpecialJob เป็น true ด้วย (เข้า special-job flow ฝั่งรับของเหมือน RQ/Transfer WH/IT ทุก
  //  จุด: เปิดกล่องเอง, auto-confirm เต็มพาเลท, modal นับถุง) แต่ backend แยก endpoint get/putAway/reset ของตัวเองที่
  //  /picking/... (ต้องเช็คก่อน isSpecialJob เสมอ ดู resolveJobApi()) ฝั่ง "วาง" ยังใช้ free-location flow เดิมของ
  //  Picking เอง (ดู isPickingFreeLocationPallet) ไม่ได้เข้าร่วม _isAutoSpecialJob ตรงนั้น เพราะ handleLocationScan
  //  แยกเช็ค _isPickingJob ของตัวเองอยู่แล้ว ไม่ต้องพึ่ง flag รวมนี้

  //  งาน special job ที่ "auto" ทุกอย่าง (เปิดกล่องเอง ไม่ต้องกด Add Pallet, auto-confirm เต็มพาเลท ไม่ถาม popup, modal
  //  นับถุงเปิดทันทีตั้งแต่ถุงใบแรก, ปิดกล่อง/เข้ารายการรอวางให้เองไม่ต้องกด "เตรียมเอาไปวาง", ไม่มีปุ่ม "ส่งให้ Step 2")
  //  ตรงข้ามกับ BK เท่านั้นที่ยังต้องกด Add Pallet/card ก่อนเสมอ และถาม popup ก่อนเอาเต็มพาเลท (Special Package/Shipping
  //  ย้ายมาเข้ากลุ่มนี้เต็มรูปแบบแล้ว เหมือน RQ/Transfer WH/IT/Picking ทุกจุด) ใช้ตัวนี้แทนการเช็ค
  //  _isRequestJob/_isTransferWhJob/_isInternalTransferJob/_isPickingJob/_isShippingJob/type_name==='Special Package'
  //  แยกทีละตัวทุกจุด (ยกเว้นฝั่ง "วาง" ของ Picking ที่ตั้งใจไม่ให้เข้าร่วม ดูคอมเมนต์ _isPickingJob ด้านบน)
  //  Shipping: backend ยังไม่อัปเดต endpoint /shipping/... ให้รองรับ payload แบบ special (modeId/qrCodes/palletSeq ฯลฯ)
  //  ตอนนี้ -> ขึ้น client ไว้ก่อนตามที่ตกลง (ยังทดสอบจริงไม่ได้จนกว่า BE จะแก้ตาม) ดู ScanPalletApiService.resolveJobApi
  //  ที่ต้องเช็ค isShippingJob ก่อน isSpecialJob เหมือนกัน กัน endpoint หลุดไปเรียก /special/... ผิดตัว
  //  BK ย้ายเข้ากลุ่มนี้แล้ว (ไม่ต้องกด Add Pallet, modal นับถุงตั้งแต่ถุงแรก) เช็คจาก type_name ตรงๆ เหมือน Special Package
  //  เพราะ getter นี้ถูกเรียกใน loadJobData ก่อนตั้งค่า _isBkJob (ดู hasAssignedPallet/_isSpecialJob)
  get _isAutoSpecialJob(): boolean {
    return this._isRequestJob || this._isTransferWhJob || this._isInternalTransferJob || this._isPickingJob
      || this._isShippingJob
      || this._jobDataRaw?.type_name === 'Special Package'
      || this._jobDataRaw?.type_name === 'Breakage & Replacement';
  }

  //  Get สำเร็จแล้วปิดกล่องเข้ารายการรอวางให้เองทันที: งานกลุ่ม kilo ฝั่ง Outbound และงาน BK (ไม่มีขั้นสแกนปลายทาง
  //  ปิดกล่องแล้วยิง Put ต่อให้เองเลย ดู onClickReadyToPlaceSpecialPallet)
  get _readyRightAfterGet(): boolean {
    return this._isBkJob || (this._isOutbound && this._isAutoSpecialJob);
  }

  //  true = item มี field pallet_manual เป็น array ไม่ว่าง (งานปกติ backend ส่งมาเป็น [] ว่างเหมือนกัน) -> รองรับสแกนโค้ด PL ยืนยัน pallet ทั้งใบได้ 1 ครั้ง
  _isManualPalletJob = false;

  //  Inbound = งานที่ไม่ตรงกับ flag เฉพาะทางตัวไหนเลย (ค่า default เดียวกับที่ resolveJobApi() ใช้เลือก endpoint)
  get _isInboundJob(): boolean {
    return !this._isOutbound && !this._isSpecialJob && !this._isRequestJob && !this._isPickingJob && !this._isShippingJob;
  }

  //  โหมดการสแกน (get / put / both) จาก job-accept -> จำกัดสิทธิ์สแกนในงาน 2-step (is_multi_fl = 'Y')
  _scanAction: 'get' | 'put' | 'both' = 'both';

  //  ─────────────────────────────────────────────────────────────
  //  STATE: Special Package (นับเป็นถุง)
  //  ─────────────────────────────────────────────────────────────
  //  กลุ่มถุงที่กำลังสแกนอยู่ (null = ยังไม่เริ่มสแกนพาเลตใหม่)
  private _currentGroup: CurrentScanGroup | null = null;

  //  Modal สแกนถุง (เฉพาะงาน Special Package)
  _specialQtyModal: SpecialQtyModalState | null = null;

  //  ปุ่มสแกนถุงใน modal: ต้องกดปุ่มก่อนถึงรับค่าจากเครื่องสแกนได้ (โฟกัสหลุด -> ปิดโหมดสแกน ต้องกดใหม่)
  _isSpecialBagScanning = false;

  //  true ระหว่างรอ GetProcessPallet ตอบกลับ (checkSpecialFullPalletThenQueue) -> กันสแกนถุงใบถัดไปรัวๆ แซงหน้า
  //  response ของถุงใบก่อนที่ยังไม่ทันกลับมา (งานกลุ่ม _isAutoSpecialJob เปิด modal รับถุงต่อได้ทันทีไม่ต้องรอสแกน
  //  Location ต้นทางก่อนแบบเดิมแล้ว เลยสแกนถุงรัวติดกันได้ง่ายขึ้นกว่าเดิมมาก) ไม่กันเฉพาะกลุ่มนั้นเพราะ BK มี race
  //  แบบเดียวกันอยู่แล้ว แค่โอกาสเกิดน้อยกว่าเพราะมีขั้นสแกน Location ต้นทางคั่นอยู่)
  private _isSpecialBagResolving = false;

  //  modal สแกนถุง: toggle สลับจากสแกนจริง -> พิมพ์โค้ดถุงเอง (concept เดียวกับ toggle "พิมพ์" หน้า scan-pallet)
  _isSpecialManualInputMode = false;
  _specialManualInputValue = '';

  //  งาน Special Package: รายการถุงที่รอสแกน Location ต้นทางยืนยัน (ก่อนขึ้น modal ถามจำนวน)
  _specialAwaitingSourceLocation: SpecialAwaitingSourceEntry[] = [];

  //  งาน Special ทุกแบบ (Special Package/BK/RQ/Transfer WH/IT) เท่านั้น: กันช่วงเวลาที่ยิง Get ไปแล้ว (เอา entry ออกจาก _specialAwaitingSourceLocation แล้ว)
  //  แต่ API ยังไม่ตอบกลับ -> ยังไม่ถูกผลักเข้า _specialOpenPallets เลย ทำให้ pallet อื่นที่ resolve location ต้นทาง
  //  พร้อมกันพอดี (ก่อน response แรกจะกลับมา) มองไม่เห็นว่าโควต้าถูกจองไปแล้ว เลยเลือก location ต้นทางซ้ำกันได้
  //  จองน้ำหนักไว้ตรงนี้ทันทีก่อนยิง request เสมอ แล้วเอาออกตอน response กลับมา (ทั้ง success/error)
  _specialInFlightWeight: { locationName: string; qty: number }[] = [];

  //  งาน Special Package: pallet ที่ "Add Pallet"/select ไว้แล้วแต่ยังไม่กด "เตรียมเอาไปวาง" (ยังรับ Get เพิ่มได้)
  //  แยกจาก _palletToPlaceList โดยเด็ดขาด -> ย้ายไป _palletToPlaceList ทีเดียวทั้งกล่องตอนกด "เตรียมเอาไปวาง" เท่านั้น
  _specialOpenPallets: SpecialPalletGroup[] = [];

  //  งาน Special Package: modal ดู grade/lot/qty รวมทั้งหมดของ pallet ใบหนึ่ง (เปิดตอนกดไอคอนตาบนการ์ดที่มีมากกว่า 1 grade/lot)
  _specialContentsModal: { seq: number; contents: { grade: string; lot: string; qty: number }[] } | null = null;

  //  งาน Special Package: pallet ที่ select ไว้อยู่ตอนนี้ (highlight) -> Get ถัดไปจะแนบ palletSeq นี้เสมอ
  //  เก็บแค่ "ตัวนับ" ดิบๆ เท่านั้น (ไม่ต่อ user_id) ดู claimNextSpecialSeq ที่ต่อ user_id เข้าไปตอนคืนค่าจริงออกไปใช้
  _specialPalletSeq = 0;
  _specialActiveSeq: number | null = null;

  //  ตัวคูณกันชน user_id ท้ายเลข pallet_seq (ดู claimNextSpecialSeq) -> เลขที่ส่งจริงให้ backend/ใช้เป็น palletSeq คือ
  //  "ตัวนับ * ค่านี้ + user_id ของคนที่สแกน" กันงาน 1-step ที่มีหลายคน/หลายเครื่องทำพร้อมกัน คำนวณตัวนับได้เลขเดียวกันพอดี
  //  (เห็น backend snapshot เดียวกันตอนโหลดหน้า) แล้วเอาพาเลทคนละใบไปทับ seq เดียวกันจนยอดถูกบวกรวมกันผิดๆ (เคสที่เจอจริง)
  //  user_id ต่อท้ายทำให้ 2 เครื่องไม่มีทางได้เลขตรงกันแม้ตัวนับจะชนกันพอดี ต้องใหญ่กว่า user_id สูงสุดที่เป็นไปได้เสมอ
  //  (ไม่โตเร็วตามจำนวนพนักงาน) 100,000 ปลอดภัยเกินพอ ไม่เสี่ยงเกินขอบเขตตัวเลขที่เก็บได้ด้วย (ตัวนับจริงไม่มีทางเกินหลักพัน)
  private readonly SPECIAL_SEQ_USER_SUFFIX_RANGE = 100000;

  //  แปลง pallet_seq จริง (มี user_id ต่อท้ายแล้ว) กลับเป็นเลขสั้นๆ อ่านง่ายสำหรับโชว์จอ (หารเอาเฉพาะส่วนตัวนับ) ไม่โชว์
  //  เลขยาวๆ ที่มี user_id ปนอยู่ให้คนขับเห็น เลขที่ได้คือ "พาเลทใบที่เท่าไหร่ของงานนี้" แบบเดิมเป๊ะ ไม่ต้องมี state แยกเพิ่ม
  specialSeqDisplayLabel(seq: number | null | undefined): number {
    return Math.floor((seq ?? 0) / this.SPECIAL_SEQ_USER_SUFFIX_RANGE);
  }

  //  เลข pallet_seq ที่เคยเปิดไว้แล้วถูกลบทิ้งจนไม่เหลือค้างที่ไหนเลย (ทั้ง open/pending/receive/complete) -> เอากลับมา
  //  ใช้ก่อนเสมอ (ดู claimNextSpecialSeq) แทนที่จะเพิ่มเลขใหม่ไปเรื่อยๆ ไม่สิ้นสุดทุกครั้งที่ลบ/สแกนผิดแล้วเปิดใหม่
  //  ไม่ persist ข้าม reload (reset กลับ [] เสมอตอนโหลดงานใหม่) เพราะ backend ไม่เก็บว่าเลขไหน "เคยลองแล้วแต่ยกเลิก" ไว้
  //  เป็นแค่ optimization ของ session นี้เท่านั้น ไม่กระทบความถูกต้อง (ไม่ reuse ก็แค่เลขกระโดดข้ามเหมือนเดิม ไม่ชนกันอยู่ดี)
  _specialReusableSeqs: number[] = [];

  //  งาน RQ/Transfer WH/IT เท่านั้น: รูปแบบ pallet ที่สแกนได้ครั้งแรกของงานนี้ (Jumbo Bag/ปกติ) -> ล็อคทั้งงานให้เป็นแบบเดียวกันเสมอ
  //  (ยืนยันแล้วว่า 1 งานใช้ format เดียวตลอด ไม่ปนกัน) กันสแกนผิดประเภทกลางงานโดยไม่ตั้งใจ -> ตอนโหลดงาน derive จาก
  //  receive_pallet/complete_pallet ที่มีอยู่แล้วก่อนเสมอ (รองรับ reload/งาน 2-step คนละเครื่อง) ถ้ายังไม่มีเลยค่อยให้
  //  สแกนสดครั้งแรกของ session นี้เป็นตัวกำหนด (ดู handleJumboBagScan/handleSpecialScannedCode)
  _requestJobPalletFormat: 'jumbo' | 'normal' | null = null;

  //  ─────────────────────────────────────────────────────────────
  //  STATE: Scan & Bag Verification (งานปกติ)
  //  ─────────────────────────────────────────────────────────────
  _bagRequiredCount: number;
  _bagCheckList: boolean[] = [];
  _scannerValue = '';
  _isScanning = false;
  _isScanBlocked = false;

  //  ─────────────────────────────────────────────────────────────
  //  STATE: Pallet Selection (รอเลือกวาง)
  //  ─────────────────────────────────────────────────────────────
  _selectedPalletsForPlacement: PalletToPlaceItem[] = [];
  _completedPalletsByItem: Map<number, any[]> = new Map();

  //  pallet ที่กำลังมี Put request ค้างอยู่ (ยิงไปแล้ว ยังไม่ response กลับ) -> auto-deselect ตอน auto-fetch
  //  (refreshJobProgressFromServer) ต้อง skip ไม่แตะ กันชนกับ request ที่กำลังทำงานอยู่พอดี (เทียบด้วย reference ตรงๆ)
  private _putInFlightPallets = new Set<PalletToPlaceItem>();

  //  คิว Get ของงาน Inbound เรียงลำดับตามที่สแกนจริง (promise chain ง่ายๆ แบบเดียวกับ _mutationLock ของ
  //  OfflineQueueService) กัน 2 pallet ที่สแกนรัวติดกันยิง Get ชนกันตอน online (เคสที่เจอ: ได้ผลแค่ใบแรก แต่ user
  //  เข้าใจว่าได้ครบ) ใบถัดไปรอ response ของใบก่อนหน้า (สำเร็จ/fail ก็ตาม) ก่อนค่อยยิงจริง ไม่บล็อกการสแกนถุงใบถัดไปเลย
  private _inboundGetQueue: Promise<void> = Promise.resolve();

  //  ─────────────────────────────────────────────────────────────
  //  STATE: Manual Input Mode (สลับจากปุ่มสแกน -> ช่องพิมพ์เอง)
  //  ─────────────────────────────────────────────────────────────
  _isManualInputMode = false;
  _manualInputValue = '';

  //  ─────────────────────────────────────────────────────────────
  //  CONSTRUCTOR & COMPUTED HELPERS
  //  ─────────────────────────────────────────────────────────────
  constructor(
    private router: Router,
    private cdr: ChangeDetectorRef,
    private scanLogic: ScanPalletLogicService,
    private scanApi: ScanPalletApiService,
    private offlineQueue: OfflineQueueService,
    private crudService: CrudService,
    private network: NetworkService,
    private offlineSync: OfflineSyncService,
    private tourService: TourService,
  ) {
    this._bagRequiredCount = this.scanLogic.BAG_REQUIRED_COUNT;
  }

  //  qrCode/backendId (normalize แล้ว) ของพาเลทที่เพิ่งกดลบไปในเซสชันนี้ -> กัน refreshJobProgressFromServer (งาน 2-step)
  //  เข้าใจผิดว่าเป็น "ของใหม่" ที่เพิ่งเจอใน receive_pallet ของ server แล้วดึงพาเลทที่เพิ่งลบไปกลับเข้า _palletToPlaceList
  //  เอง (เจอจริง: receive_pallet ของ server ไม่ได้ลบ record ออกทันทีที่ reset สำเร็จ แค่ item.receive_qty ลดลงแทน
  //  ตัว array ดิบยังมี record เดิมค้างอยู่ได้) ไม่ต้อง clear ออกเลย อยู่แค่ใน session นี้พอ (reload ใหม่ข้อมูลสดอยู่แล้ว)
  private readonly _deletedPalletKeysThisSession = new Set<string>();

  //  รวม List ของ Pallet ณ ปัจจุบัน ส่งให้ ScanPalletLogicService ใช้คำนวณโควต้า/ตรวจสอบ Pallet ซ้ำ
  private get _sessionPalletLists(): SessionPalletLists {
    return {
      palletToPlaceList: this._palletToPlaceList,
      palletsAwaitingSourceLocation: this._palletsAwaitingSourceLocation,
      completedPalletList: this._completedPalletList,
      outboundVerificationPallets: this._outboundVerificationPallets,
      knownServerPalletKeys: this.scanLogic.buildKnownServerPalletKeys(this._jobDataRaw),
    };
  }

  //  งาน Special ทุกแบบ (Special Package/BK/RQ/Transfer WH/IT) เท่านั้น: รวมน้ำหนักของถุงที่ยัง "รอสแกน Location ต้นทาง" (ยังไม่ confirm เข้า 3 list ข้างบนเลย)
  //  แยกตามชื่อ location -> ส่งเข้า checkSpecialFromLocationQuota/resolveFromLocationForItem กันเลือก location ต้นทาง
  //  ซ้ำเดิมทั้งที่มี pallet อื่นจองน้ำหนักไว้แล้วจริง ใช้ fullPalletRecord.qty (น้ำหนักจริงของ pallet ต้นทางใบนั้นจาก
  //  GetProcessPallet) เชื่อถือได้ทั้งเคสเอาเต็ม pallet (คือค่าที่จะยิง Get จริง) และเคสนับถุงเอง (เป็นเพดานบนที่แน่นอน)
  private get _specialAwaitingWeightByLocationName(): Map<string, number> {
    return this.specialAwaitingWeightExcept();
  }

  //  เหมือน _specialAwaitingWeightByLocationName แต่ไม่นับรายการใน exclude -> ใช้ตอนเช็คที่ว่างของ Location ที่เพิ่งสแกน
  //  ยืนยันรายการชุดนั้นเอง กันน้ำหนักของรายการเหล่านั้นถูกนับซ้ำเป็น "ของที่รออยู่" ทับกับ demand ที่กำลังเช็คอยู่
  private specialAwaitingWeightExcept(exclude?: Set<SpecialAwaitingSourceEntry>): Map<string, number> {
    const map = new Map<string, number>();
    for (const e of this._specialAwaitingSourceLocation) {
      if (exclude?.has(e)) continue;
      const weight = e.fullPalletRecord?.qty ?? 0;
      map.set(e.sourceLocation, (map.get(e.sourceLocation) ?? 0) + weight);
    }
    //  รวม in-flight reservation (ยิง Get ไปแล้ว รอ response) เข้าไปด้วยเสมอ -> กัน race condition ตอนสแกน pallet
    //  ถัดไประหว่างที่ยัง Get pallet ก่อนหน้าไม่เสร็จ ดู _specialInFlightWeight ด้านบน
    for (const r of this._specialInFlightWeight) {
      map.set(r.locationName, (map.get(r.locationName) ?? 0) + r.qty);
    }
    return map;
  }

  //  ส่งให้ ScanPalletApiService ใช้เลือก endpoint ให้ตรงกับประเภทงาน
  private get _jobTypeFlags() {
    return {
      isRequestJob: this._isRequestJob,
      isPickingJob: this._isPickingJob,
      isShippingJob: this._isShippingJob,
      isSpecialJob: this._isSpecialJob,
      isBkJob: this._isBkJob,
      isInternalTransferJob: this._isInternalTransferJob,
      isTransferWh: this._isTransferWhJob,
    };
  }

  //  ─────────────────────────────────────────────────────────────
  //  OFFLINE QUEUE (รอบแรก: เฉพาะงานธรรมดา ยังไม่รองรับ Special/BK/IT)
  //  ─────────────────────────────────────────────────────────────
  //  งาน Special/BK/IT ยังไม่รองรับ offline queue (ต้องมีเน็ตเสมอ) เพราะ flow นับถุง/manifest/2-step
  //  ซับซ้อนกว่างานธรรมดา และยังไม่ได้ออกแบบ conflict-resolution ให้ครอบคลุมเคสพวกนี้
  private get _offlineQueueEligible(): boolean {
    return !this._isSpecialJob && !this._isBkJob && !this._isInternalTransferJob;
  }

  //  จุดเดียวที่ตัดสินใจว่าจะยิง API จริง หรือเก็บเข้า queue แทน -> เรียกแทน this.scanApi.callJobApi ตรงๆ
  //  ทุกจุดที่ยิง Get/Put/Reset ของงานธรรมดา (4 จุด: completePalletInbound, handleSourceLocationScan,
  //  handleLocationScan, deletePalletFromPlaceList) ออนไลน์ทำงานเหมือนเดิมทุกอย่าง ไม่เปลี่ยนพฤติกรรม
  //  offline + งานธรรมดา -> เก็บเข้า queue แล้วถือว่า "next" สำเร็จ (เหมือนออนไลน์) รอ sync จริงตอนกลับมา
  private runOrQueueJobApi(action: QueueActionType, jobId: number, requestData: any, palletCode: string): Observable<any> {
    const normalizedCode = this.scanLogic.normalizeQrCode(palletCode);

    const enqueueAction$ = () => from(
      this.offlineQueue.enqueue({
        jobId,
        systemNo: this._job.jobNomber,
        palletCode: normalizedCode,
        actionType: action,
        requestData,
        jobTypeFlags: this._jobTypeFlags,
      }),
    ).pipe(map(() => ({ queued: true })));

    if (!this._offlineQueueEligible) {
      return this.scanApi.callJobApi(this._jobTypeFlags, action, jobId, requestData);
    }

    //  health check ล่าสุดบอกว่า online แต่หลุดจริงระหว่างรอ response ได้ (WiFi กระพริบในโกดัง) -> ถ้า request ไม่ถึง
    //  backend เลย (status 0 = ไม่มี response กลับมา ต่างจาก 4xx/5xx ที่ backend reject จริงพร้อม message) fallback
    //  เข้า queue แทนที่จะโชว์ error ทื่อๆ ให้ user กดใหม่เอง + สั่ง health check ทันที ไม่ต้องรอรอบ poll ถัดไป
    //  (ใบถัดไปใน concat จะเห็น offline แล้วเข้า queue ตรงๆ ไม่ต้องรอ request ค้างจนหลุดทีละใบ)
    const live$ = () => this.scanApi.callJobApi(this._jobTypeFlags, action, jobId, requestData).pipe(
      catchError((err) => {
        if (err?.status !== 0) return throwError(() => err);
        this.network.reportUnreachable();
        return enqueueAction$();
      }),
    );

    //  defer: ตัดสินใจตอน subscribe จริง ไม่ใช่ตอนสร้าง observable -> caller ที่ map สร้าง request ทุกใบไว้ก่อนแล้ว
    //  ค่อย concat ยิงทีละใบ จะได้ใช้สถานะเน็ต ณ ตอนที่ใบนั้นยิงจริง
    //  สถานะจาก health check api/v1/health (NetworkService) ยังรองรับ window.__forceOffline สำหรับ DEBUG เหมือนเดิม
    return defer(async () => {
      if (!this.network.isOnline) return 'queue' as const;

      //  pallet นี้ยังมี action ที่ค้างใน queue (เช่น Get ตอน offline แล้วเน็ตเพิ่งกลับมา แต่ยัง sync ไม่ถึง) -> ต้อง sync
      //  ของเก่าให้จบก่อน ไม่งั้น Put/Reset ใหม่จะวิ่งแซง Get ที่ backend ยังไม่รู้ แล้วโดน reject (หรือลำดับกลับหัว)
      if (await this.offlineQueue.hasEarlierPendingActionFor(normalizedCode, Number.POSITIVE_INFINITY)) {
        await this.offlineSync.syncAll();
      }
      return 'live' as const;
    }).pipe(
      switchMap((mode) => mode === 'queue' ? enqueueAction$() : live$()),
    );
  }

  //  ─────────────────────────────────────────────────────────────
  //  LIFECYCLE HOOKS
  //  ─────────────────────────────────────────────────────────────
  //  Auto-fetch ความคืบหน้างานทุก 5 วิ (เฉพาะตอน online) เพื่อให้คนขับเห็นว่างานไปถึงไหนแล้วโดยไม่ต้องย้อนกลับแล้วเข้าใหม่ (feedback UAT)
  private _autoRefreshTimer: any;

  ngOnInit(): void {
    this.loadJobData();
    this._currentUserId = Number(localStorage.getItem('userId')) || 0;
    this._autoRefreshTimer = setInterval(() => this.refreshJobProgressFromServer(), 5000);

    this.tourService.register(() => this.startTour());
  }

  ngOnDestroy(): void {
    if (this._autoRefreshTimer) clearInterval(this._autoRefreshTimer);
    this.tourService.register(null);
  }

  //  ยิง GetJobByForklift ใหม่ (endpoint เดียวกับหน้า job-accept) แล้วอัปเดต "ความคืบหน้า" (progress bar + การ์ด
  //  Pallet ทั้งหมดฝั่งขวาที่เป็นสีเขียว/เหลือง) ให้ตรงกับเครื่องอื่นที่ sync ไปแล้ว โดยตั้งใจไม่แตะ
  //  _palletToPlaceList/_currentGroup/_selectedPalletsForPlacement เลย -> กันไม่ให้ล้าง progress การสแกนที่ยังทำค้าง
  //  อยู่ในเครื่องนี้ทิ้งกลางคัน (ดู getter _totalPalletDisplayList/buildDisplayRowsForItem ที่ใช้ 2 ค่านี้เป็น input)
  //  ทุกค่าที่อัปเดตใช้ Math.max เทียบกับของเดิมเสมอ กันตัวเลข/สถานะถอยหลัง (เช่น server ยังไม่ทัน sync ของ local)
  private refreshJobProgressFromServer(): void {
    if (!this.network.isOnline || !this._jobDataRaw?.id) return;

    const forkliftId = Number(sessionStorage.getItem('_FORKLIFT_ID')) || 0;
    //  ต้องส่ง date ของ "งานนี้" ไปด้วย (เหมือนหน้า job-accept ตอน filter) เพราะไม่ส่ง date มา backend จะ default
    //  เป็นวันนี้เอง -> งานที่เปิดมาจากวันอื่น (ไม่ใช่วันนี้) auto-fetch จะหา job ไม่เจอ (404) ทุกรอบตลอดเวลาที่อยู่ในหน้านี้
    const jobDate = this._jobDataRaw.create_datetime ? this.parseThaiJobDate(this._jobDataRaw.create_datetime) : null;
    const dateParam = jobDate ? this.formatDateParam(jobDate) : undefined;

    this.crudService.GetJobByForklift(forkliftId, undefined, undefined, dateParam).subscribe({
      next: (res) => {
        const freshJob = (res?.data ?? []).find((j: any) => j.id === this._jobDataRaw.id);
        if (!freshJob) return;

        this._totalPalletCount = freshJob.total_qty ?? this._totalPalletCount;

        //  sync complete_qty ต่อ item (ไม่ใช่แค่ยอดรวม) เพราะ _totalPalletDisplayList คำนวณสีเขียวต่อ item เอง
        //  (Math.min กับ complete_qty เดิม) ถ้าไม่อัปเดตตรงนี้ด้วย การ์ดที่เพิ่งเสร็จจากเครื่องอื่นจะไม่ขยับเป็นสีเขียว
        const freshItemsById = new Map((freshJob.items ?? []).map((i: any) => [i.id, i]));
        (this._jobDataRaw.items ?? []).forEach((item: any) => {
          const freshItem: any = freshItemsById.get(item.id);
          if (!freshItem) return;
          item.complete_qty = Math.max(item.complete_qty ?? 0, freshItem.complete_qty ?? 0);

          //  sync to_locations[].complete_qty/actual_qty ด้วย (เลข "X/Y" ที่การ์ด "รอเอาไปวาง" โชว์ต่อ location)
          //  ไม่งั้นถ้าเครื่องอื่นไปวางที่ location เดียวกัน เครื่องนี้จะไม่มีวันเห็นว่าเต็มขึ้นเลยจนกว่าจะ reload หน้าใหม่ทั้งหมด
          //  Math.max กันค่าที่จองไว้ในเครื่องนี้เอง (preparePutAwayList) ถูกทับด้วยค่า server ที่อาจช้ากว่า
          const freshLocationsById = new Map((freshItem.locations?.to_locations ?? []).map((l: any) => [l.location_id, l]));
          (item.locations?.to_locations ?? []).forEach((loc: any) => {
            const freshLoc: any = freshLocationsById.get(loc.location_id);
            if (!freshLoc) return;
            loc.complete_qty = Math.max(loc.complete_qty ?? 0, freshLoc.complete_qty ?? 0);
            if (typeof freshLoc.actual_qty === 'number') {
              loc.actual_qty = Math.max(loc.actual_qty ?? 0, freshLoc.actual_qty);
            }
          });
        });

        //  หลัง sync raw to_locations เสร็จด้านบน -> propagate ตัวเลขเดียวกันเข้า pallet.targetLocations ของ pending
        //  pallet ที่สร้างไปแล้วด้วย (blue การ์ดฝั่งซ้าย) เพราะ targetLocations เป็นแค่ snapshot ตอนสร้าง pallet
        //  (buildTargetLocations) ไม่เคย sync ซ้ำเอง ไม่งั้นเลข "(X/Y)" ที่โชว์จะค้างเลขเก่าจนกว่าจะ reload หน้าใหม่
        //  ไม่แตะ selection/pallet object/id/qty เลยสักตัว แค่ตัวเลข completeQty/totalQty สำหรับโชว์เท่านั้น
        this._palletToPlaceList.forEach((pallet) => {
          const rawItem = this.scanLogic.resolveItemForPallet(pallet, this._jobDataRaw.items ?? []);
          const freshLocationsByName = new Map(
            (rawItem?.locations?.to_locations ?? []).map((l: any) => [String(l.location_name).trim(), l]),
          );
          pallet.targetLocations.forEach((loc) => {
            const freshLoc: any = freshLocationsByName.get(loc.location.trim());
            if (!freshLoc) return;
            if (typeof freshLoc.complete_qty === 'number') {
              loc.completeQty = Math.max(loc.completeQty ?? 0, freshLoc.complete_qty);
            }
            if (typeof freshLoc.total_qty === 'number') {
              loc.totalQty = freshLoc.total_qty;
            }
          });
        });

        //  งานปกติ, RQ, Transfer WH และ IT เท่านั้น: pallet ที่เลือกไว้แล้ว (isSelectedForPlacement) แต่ location ปลายทางที่เป็นไปได้
        //  ทั้งหมดเต็มไปหมดแล้ว (เครื่องอื่นไปวางจนเต็มระหว่างที่ยังไม่ได้ยืนยัน) -> ยกเลิกการเลือกให้เอง กันคนขับสแกน
        //  Location ไปแล้วเจอ error ตอน Put จริง เช็คทุก targetLocations ไม่ใช่แค่ตัวแรก เพราะยังมีสิทธิ์วางที่ตัวอื่นที่
        //  ยังไม่เต็มได้ (ไม่ narrow เหลือตัวเดียวตอนเลือก) ไม่ deselect ถ้ายังมีที่ไปได้อย่างน้อย 1 ที่ -> skip pallet ที่
        //  กำลังมี Put ค้างอยู่ (_putInFlightPallets) กันชนกับ request ที่กำลังทำงานอยู่พอดี
        if (!this._isSpecialJob || this._isAutoSpecialJob) {
          const stillSelected: PalletToPlaceItem[] = [];
          let deselectedCount = 0;

          this._selectedPalletsForPlacement.forEach((pallet) => {
            if (this._putInFlightPallets.has(pallet)) {
              stillSelected.push(pallet);
              return;
            }

            const allFull = pallet.targetLocations.length > 0 && pallet.targetLocations.every(
              (loc) => typeof loc.totalQty === 'number' && (loc.completeQty ?? 0) >= loc.totalQty,
            );

            if (allFull) {
              pallet.isSelectedForPlacement = false;
              deselectedCount += 1;
            } else {
              stillSelected.push(pallet);
            }
          });

          if (deselectedCount > 0) {
            this._selectedPalletsForPlacement = stillSelected;
            this.SweetAlert('warning', `ยกเลิกการเลือกพาเลท ${deselectedCount} ใบให้อัตโนมัติ เพราะที่วางปลายทางเต็มแล้ว กรุณาสแกนเลือกใหม่`);
          }
        }

        //  คำนวณใหม่ว่าถุง/พาเลตไหนบ้าง "เสร็จจริงจาก server" (ใช้ complete_qty ที่ sync แล้วด้านบนตัดจาก pool
        //  ของ freshJob เพราะยอด pool คนละชุดกับที่ _jobDataRaw ถืออยู่ก่อนหน้า) -> การ์ดที่เพิ่งเสร็จจะย้ายจาก
        //  เหลือง(รอสแกนถุง)/น้ำเงิน(รอ location) ไปเขียว(สำเร็จ) เองอัตโนมัติผ่าน getter เดิม ไม่ต้องแก้ template
        this._completedPalletsByItem = this.scanLogic.buildCompletedPalletsByItem(freshJob, this._jobDataRaw.items ?? []);

        //  ชุด qrCode ล่าสุดที่ backend ยืนยันว่า "วางสำเร็จแล้วจริง" (ใช้ทั้ง sync array ด้านล่าง และ reconcile
        //  _palletToPlaceList ถัดไป) เทียบด้วย scanned_qr_code เสมอ ไม่ใช่ id เพราะ id ฝั่ง local บางอันเป็นเลขปลอม
        //  (เช่น Date.now()) ที่ยังไม่ตรงกับของจริงจาก backend
        const freshCompletePool: any[] = freshJob.pallets?.complete_pallet ?? [];
        //  ใช้ normalizeQrCodeForMatch (ตัดวรรคด้วย) ไม่ใช่ normalizeQrCode เฉยๆ -> กัน grade ที่ฝังอยู่ในโค้ดมีวรรค
        //  ไม่ตรงกันระหว่างที่สแกนได้กับที่ backend คืนมา (ดู comment ยาวที่ normalizeQrCodeForMatch)
        const freshCompleteCodes = new Set(
          freshCompletePool.map((p: any) => this.scanLogic.normalizeQrCodeForMatch(p.scanned_qr_code)),
        );
        //  เสริมความทนทาน: เทียบด้วย backend id ด้วย (เหตุผลเดียวกับ knownBackendIds ด้านล่าง) กัน scanned_qr_code
        //  ที่ backend คืนมาตอนนี้ไม่ตรงกับโค้ดที่สแกนได้ตอน Get เป๊ะๆ จนจับไม่ได้ว่าวางสำเร็จไปแล้วจริง
        const freshCompleteBackendIds = new Set(freshCompletePool.map((p: any) => String(p.id)));

        //  sync _jobDataRaw.pallets.complete_pallet ให้ตรงกับ server เสมอ ทุกงาน (เดิมจำกัดแค่ Special/RQ) เหตุผล 2 ต่อ:
        //  (1) งาน Special/RQ - การ์ดสีเขียวของ buildSpecialPalletDisplayRows อ่าน array นี้ตรงๆ
        //  (2) ทุกงาน - refreshDisplayList() (ทุกจุดที่เรียก ไม่ใช่แค่ท้ายฟังก์ชันนี้) คำนวณ _completedPalletsByItem ใหม่
        //  จาก this._jobDataRaw เองเสมอ (กันค้างตอน action อื่นเรียก) ถ้า array นี้ไม่ sync ด้วย การคำนวณใหม่นั้นจะทับ
        //  ของที่เพิ่งอัปเดตถูกต้องจาก freshJob ไปด้านบนทิ้งด้วยข้อมูลเก่าทันที ทำให้งานปกติไม่เคยเห็นพาเลทที่เครื่องอื่น
        //  เพิ่งวางสำเร็จขึ้นเขียวเองเลยจนกว่าจะ reload หน้าใหม่ -> เอาชุดจาก server เป็นหลักเสมอ (มี id/pallet_seq จริง)
        //  + เก็บของ local ที่ server ยังไม่ทันมี (เพิ่งวางสำเร็จไปหมาดๆ ก่อน fetch รอบนี้จะมาถึง) ไว้ด้วย กันหายไปชั่วคราว
        {
          const localCompletePool: any[] = this._jobDataRaw.pallets?.complete_pallet ?? [];
          const localOnly = localCompletePool.filter((p: any) => !freshCompleteCodes.has(this.scanLogic.normalizeQrCodeForMatch(p.scanned_qr_code)));
          this._jobDataRaw.pallets ??= {};
          this._jobDataRaw.pallets.complete_pallet = [...freshCompletePool, ...localOnly];
        }

        //  ทุกงาน: pallet ใน _palletToPlaceList ที่จริงๆ วางสำเร็จไปแล้ว (เจอโค้ดใน complete_pallet ล่าสุด) แต่เครื่องนี้
        //  ไม่เคยรู้ (เช่น เครื่องอื่น/คนอื่นเป็นคน put ให้ ไม่ผ่าน markPalletPutAwayComplete ของเครื่องนี้เอง) -> เอาออก
        //  จาก _palletToPlaceList/_selectedPalletsForPlacement ให้เองเหมือนกับตอน put สำเร็จในเครื่องนี้ ไม่งั้นจะค้าง
        //  โชว์เป็น "รอวาง" ต่อไปเรื่อยๆ (เห็นปนกับการ์ดสีเขียวของใบเดียวกันพร้อมกัน) จนกว่าจะ reload หน้าใหม่
        const isNowCompleteElsewhere = (p: PalletToPlaceItem) => {
          if (p.backendId && freshCompleteBackendIds.has(p.backendId)) return true;
          const codes = [p.qrCode, ...(p.bagCodes ?? [])]
            .filter((c): c is string => !!c)
            .map((c) => this.scanLogic.normalizeQrCodeForMatch(c));
          return codes.some((c) => freshCompleteCodes.has(c));
        };
        //  TW ให้ทำงานเหมือน RQ/IT ทุกจุด (ยกเลิกข้อยกเว้นเดิมที่สมมติว่า backend เขียนลง complete_pallet ตั้งแต่ตอน Get)
        const newlyCompleteElsewhere = this._palletToPlaceList.filter((p) => isNowCompleteElsewhere(p));
        if (newlyCompleteElsewhere.length > 0) {
          //  งาน Special: หักยอดรับรอวางของพาเลทพวกนี้ด้วย เหมือน Put สำเร็จในเครื่องนี้ ไม่งั้นพาเลทถูกนับซ้ำ (complete_qty ที่ดึงจาก
          //  backend ด้านบนนับไปแล้ว + receive_qty ยังค้าง) ระบบขึ้นว่า item ครบทั้งที่ยังไม่ครบ ต้องออกแล้วเข้าใหม่ถึงหาย (เจอจริง:
          //  วางหลายพาเลทพร้อมกัน auto fetch แทรกกลาง batch) ตอนผล Put กลับมา markPalletPutAwayComplete จะข้ามพาเลทที่อยู่ใน
          //  _completedPalletList แล้ว เลยไม่หักซ้ำ
          if (this._isSpecialJob) {
            newlyCompleteElsewhere.forEach((p) =>
              this.releaseSpecialReceived(p, this.scanLogic.resolveItemForPallet(p, this._jobDataRaw.items ?? [])),
            );
          }
          //  ผลักเข้า _completedPalletList เหมือนที่ markPalletPutAwayComplete ทำตอนเครื่องนี้เอง Put สำเร็จ (คนละจุดกัน
          //  ไม่กระทบกัน markPalletPutAwayComplete เอา pallet ออกจาก _palletToPlaceList ของตัวเองไปตั้งแต่ Put สำเร็จ
          //  ก่อน auto-fetch tick ไหนจะมีโอกาสรันด้วยซ้ำ) -> ให้การ์ดขึ้นเขียวทันทีผ่าน completedThisSession
          //  (buildDisplayRowsForItem) ไม่ต้องพึ่ง _completedPalletsByItem/takeMatchingPallet ที่จับคู่แบบ grade/lot
          //  หลวมๆ ไปหา record เจอเองอีกที (พบเคสหาไม่เจอทั้งที่ isNowCompleteElsewhere ข้างบนยืนยันแล้วว่า backendId/
          //  qrCode ของ pallet ใบนี้ตรงกับ complete_pallet เป๊ะ) กันขึ้นเหลืองค้างแทนที่จะเป็นเขียว
          this._completedPalletList = [...this._completedPalletList, ...newlyCompleteElsewhere];
          const completeSet = new Set(newlyCompleteElsewhere);
          this._palletToPlaceList = this._palletToPlaceList.filter((p) => !completeSet.has(p));
          this._selectedPalletsForPlacement = this._selectedPalletsForPlacement.filter((p) => !completeSet.has(p));
        }

        //  งานปกติและงานกลุ่ม _isAutoSpecialJob เท่านั้น (ยังไม่ทำ BK) + เฉพาะงาน 2-step (is_multi_fl = 'Y') เท่านั้น
        //  เพราะจุดประสงค์คือให้คนทำ Step 2 เห็นว่า Step 1 (คนละเครื่อง/คนละคน) Get อะไรเพิ่มมาบ้างโดยไม่ต้อง reload
        //  งาน 1-step คนเดียวทำครบเอง ไม่มี "เครื่องอื่น" ที่มีความหมายแบบนี้ -> เพิ่มเป็น pallet ใช้งานได้จริงเข้า
        //  _palletToPlaceList เลย (เลือก/วางได้ทันที ไม่ใช่แค่โชว์เฉยๆ) แต่แตะแค่ของใหม่จริงๆ ไม่ไปยุ่งกับ entry เดิม
        //  ที่มีอยู่แล้วแม้แต่ตัวเดียว (กัน object reference ของเดิมหลุด -> selection/in-flight tracking พังตามที่คุยกันไว้)
        if (this._isMultiStep && (!this._isSpecialJob || this._isAutoSpecialJob)) {
          //  ต้องใส่ bagCodes ของทุก pallet ด้วย ไม่ใช่แค่ qrCode หลักตัวเดียว (งาน RQ/Special 1 pallet อาจมีหลายถุง
          //  รวมกันผ่าน bagCodes) ไม่งั้น tick ถัดไปจะเห็นถุงที่ถูกรวมเข้า pallet ไปแล้วเป็น "ของใหม่" อีกรอบ สร้าง
          //  pallet ซ้อนเพิ่มขึ้นเรื่อยๆ ทุก 5 วิ (พบจริงจาก record ที่ส่งมาทดสอบ)
          const knownCodes = new Set(
            [
              ...this._palletToPlaceList.flatMap((p) => [p.qrCode, ...(p.bagCodes ?? [])]),
              ...this._palletsAwaitingSourceLocation.flatMap((p) => [p.qrCode, ...(p.bagCodes ?? [])]),
              ...this._completedPalletList.flatMap((p) => [p.qrCode, ...(p.bagCodes ?? [])]),
              ...this._specialOpenPallets.flatMap((g) => g.entries.flatMap((e) => [e.qrCode, ...(e.bagCodes ?? [])])),
              ...this._specialAwaitingSourceLocation.map((e) => e.code),
            ]
              .filter((c): c is string => !!c)
              .map((c) => this.scanLogic.normalizeQrCodeForMatch(c)),
          );

          //  เสริมความทนทาน: เทียบด้วย backend id ของ pallet ด้วย ไม่ใช่แค่ qrCode เผื่อ scanned_qr_code ที่ backend
          //  ส่งกลับมาตอนนี้ ไม่ตรงกับโค้ดที่สแกนได้ตอน Get เป๊ะๆ (format ต่างกันแม้แต่นิดเดียว ก็ทำให้ knownCodes ไม่เจอ)
          //  -> auto-fetch จะเข้าใจผิดว่า record ที่เพิ่ง Get ไปเองเป็น "ใหม่" แล้ว push ซ้ำ (เจอจริง: ขึ้นซ้ำหลัง Get
          //  ไม่กี่วิ ต้องออกจากหน้าแล้วเข้าใหม่ถึงหาย) backendId มาจาก backfillPalletId$ (completePalletInbound)
          //  ซึ่ง resolve เร็วกว่ารอบ auto-fetch ถัดไปเสมอ (เสี้ยววิ ไม่ใช่ 5 วิ) เลยมักมีค่าพร้อมเทียบแล้วตอน tick นี้มาถึง
          const knownBackendIds = new Set(
            this._palletToPlaceList
              .map((p) => p.backendId)
              .filter((id): id is string => !!id),
          );

          const freshReceivePool: any[] = freshJob.pallets?.receive_pallet ?? [];
          const newRecords = freshReceivePool.filter((p: any) => {
            if (knownBackendIds.has(String(p.id))) return false;
            //  record นี้เพิ่งถูกลบไปในเซสชันนี้เอง (ดู _deletedPalletKeysThisSession) -> ไม่ใช่ของใหม่จริง แค่ของเก่าที่
            //  ยังค้างอยู่ใน array ดิบของ server (ลบแล้ว server ลด receive_qty แต่ไม่ได้ตัด record ออกจาก array ทันที)
            if (this._deletedPalletKeysThisSession.has(String(p.id))) return false;
            const code = this.scanLogic.normalizeQrCodeForMatch(p.scanned_qr_code);
            if (code && this._deletedPalletKeysThisSession.has(code)) return false;
            return code && !knownCodes.has(code);
          });

          //  group ของใหม่ด้วย id ของ backend เอง (ไม่ใช่ pallet_seq ที่ client คิดเอง กันชนกันข้ามเครื่อง)
          const groupsById = new Map<string, any[]>();
          newRecords.forEach((p: any) => {
            const key = String(p.id);
            const list = groupsById.get(key) ?? [];
            list.push(p);
            groupsById.set(key, list);
          });

          const newPallets: PalletToPlaceItem[] = [];
          groupsById.forEach((records) => {
            const pallet = this.scanLogic.buildPendingPalletFromRecords(records, this._jobDataRaw.items ?? []);
            if (!pallet) return;

            //  ก่อนสร้างใหม่ เช็คก่อนว่ามี pallet เดิมที่ยังไม่มี backendId (ค้าง "id: รอ Verify" เพราะตอน Get backfill
            //  หา record จริงไม่เจอ เช่น grade ที่ใช้ค้นหา (matchedItem.grade) สะกดไม่ตรงกับ grade จริงใน record เป๊ะๆ)
            //  แต่จริงๆเป็น pallet ใบเดียวกัน (itemId + lot + เลข Pallet No. ที่ derive จากโค้ดตรงกัน แม้ qrCode ดิบ
            //  ทั้งสตริงจะต่างกัน เช่น segment อื่นที่ backend คืนมาไม่ตรงกับที่สแกนเป๊ะ) -> อัปเดตของเดิมแทนสร้างซ้อนใหม่
            //  กัน 1 pallet จริงโชว์ 2 การ์ด (การ์ดเก่าค้าง "รอ Verify" ตลอดไป เพราะไม่มี record จริงให้ backfill ได้อีก)
            const palletNo = this.deriveRawPalletNo(pallet.qrCode);
            const existingUnbacked = palletNo
              ? this._palletToPlaceList.find((p) =>
                !p.backendId
                  && p.itemId === pallet.itemId
                  && p.lotNo === pallet.lotNo
                  && this.deriveRawPalletNo(p.qrCode) === palletNo)
              : undefined;
            if (existingUnbacked) {
              existingUnbacked.backendId = pallet.backendId;
              existingUnbacked.qty = pallet.qty;
              existingUnbacked.qrCode = pallet.qrCode;
              existingUnbacked.bagCodes = pallet.bagCodes;
              //  grade ของ record จริงที่เพิ่งยืนยันได้ (pallet.grade มาจาก record.grade ใน buildPendingPalletFromRecords
              //  อยู่แล้ว) แทนที่ grade ชั่วคราวตอนสแกนสด (matchedItem.grade) ให้ตรงกับ receive_pallet จริงเป๊ะ
              existingUnbacked.grade = pallet.grade;
              return;
            }

            //  งาน Special ทุกแบบ (Special Package/BK/RQ/Transfer WH/IT) เท่านั้น: ขอเลข pallet_seq ใหม่จากตัวนับเดิมของเครื่องนี้ (งานปกติไม่ใช้ concept นี้เลย)
            if (this._isSpecialJob) pallet.palletSeq = this.claimNextSpecialSeq();
            newPallets.push(pallet);
          });

          if (newPallets.length > 0) {
            this._palletToPlaceList = [...this._palletToPlaceList, ...newPallets];
          }

          //  pallet ที่เคยรู้จักแล้ว (มี backendId) แต่ "หายไปจากทั้ง receive_pallet และ complete_pallet" ของรอบนี้
          //  = ถูกลบ/reset จากเครื่องอื่นไปแล้ว (ไม่ใช่วางสำเร็จ ไม่งั้นต้องโผล่ใน complete_pallet แทน ซึ่งมี
          //  isNowCompleteElsewhere จัดการแยกไปแล้วด้านบน) -> เอาออกจาก _palletToPlaceList/
          //  _selectedPalletsForPlacement ของเครื่องนี้ให้ตรงกันด้วย ไม่งั้นค้างโชว์เป็น "รอวาง" ไปเรื่อยๆ จนกว่าจะ
          //  reload หน้าใหม่ -- เช็คเฉพาะ pallet ที่มี backendId แล้วเท่านั้น (ของที่เพิ่ง Get สดๆ ใน session นี้เอง
          //  backfillPalletId$ อาจยังไม่ทันได้ id กลับมา ต้องไม่เข้าใจผิดว่าโดนลบทั้งที่ยังอยู่จริง) และข้าม pallet ที่
          //  กำลังมี Put ค้างอยู่ (_putInFlightPallets) กันชนกับ Put ที่กำลังจะสำเร็จ/ล้มเหลวอยู่แล้วพอดี
          const freshReceiveBackendIds = new Set(freshReceivePool.map((p: any) => String(p.id)));
          const isDeletedElsewhere = (p: PalletToPlaceItem) =>
            !!p.backendId
            && !this._putInFlightPallets.has(p)
            && !freshReceiveBackendIds.has(p.backendId)
            && !freshCompleteBackendIds.has(p.backendId);

          const notDeleted = this._palletToPlaceList.filter((p) => !isDeletedElsewhere(p));
          if (notDeleted.length !== this._palletToPlaceList.length) {
            this._palletToPlaceList = notDeleted;
            this._selectedPalletsForPlacement = this._selectedPalletsForPlacement.filter((p) => !isDeletedElsewhere(p));
          }
        }

        this.saveJobDataToSession();
        this.refreshDisplayList();
      },
      error: () => { /* เงียบไว้ -> เน็ตสะดุดชั่วคราวไม่ต้องรบกวนคนขับ ลองใหม่รอบถัดไปเอง */ },
    });
  }

  //  create_datetime ของ backend เป็น string รูปแบบ "D/M/BE_YYYY HH:mm:ss" (ปี พ.ศ. ไม่ใช่ ค.ศ.) เช่น "8/10/2569 22:42:39"
  //  ห้าม new Date(ตรงๆ) เด็ดขาด เพราะ JS จะตีความปี 2569 เป็น ค.ศ. ตรงๆ (เพี้ยนไปกว่า 500 ปี) ไม่ลบ 543 ให้เอง
  //  -> ต้อง parse เองทีละส่วนแล้วค่อยลบ 543 แปลงเป็น ค.ศ. ก่อนสร้าง Date
  private parseThaiJobDate(value: string): Date | null {
    const datePart = value.trim().split(' ')[0];
    const parts = datePart?.split('/').map((p) => Number(p)) ?? [];
    const [day, month, buddhistYear] = parts;
    if (!day || !month || !buddhistYear) return null;
    return new Date(buddhistYear - 543, month - 1, day);
  }

  //  แปลงเป็น YYYY-MM-DD ตามเวลา local (ไม่ใช้ toISOString() เพราะแปลงเป็น UTC วันที่อาจเพี้ยนได้) — สูตรเดียวกับหน้า job-accept
  private formatDateParam(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  //  trackBy กัน *ngFor สร้าง DOM การ์ดใหม่ทุกครั้งที่ list ถูก rebuild (เช่นตอน refreshDisplayList())
  //  ไม่งั้น Angular มองว่าทุกใบเป็นรายการใหม่ (object reference เปลี่ยนแม้ข้อมูลเหมือนเดิม) ทำลาย DOM เดิมทิ้งแล้วสร้างใหม่
  //  ทุกครั้ง -> animation เข้าการ์ด (card-pop-in) เลยเล่นซ้ำทุกครั้งที่มีการอัปเดตใดๆ ในหน้า ไม่ใช่แค่ตอนเข้าหน้าจริงๆ
  //  งานปกติจับด้วยโค้ดถุง (qrCode) ก่อน เพราะ pallet id ซ้ำข้าม grade/lot ได้ -> key ชนกันใน *ngFor (Special มี palletSeq ใช้ id/index เหมือนเดิม)
  trackByPallet(index: number, pallet: PalletToPlaceItem): string | number {
    return pallet.palletSeq === undefined ? (pallet.qrCode ?? pallet.id ?? index) : (pallet.id ?? index);
  }

  trackByDisplayKey(index: number, item: TotalPalletDisplayItem): string {
    return item.key;
  }

  ngAfterViewInit(): void {
    //  เข้าเพจแล้วพร้อมสแกนได้ทันที ไม่ต้องกดปุ่ม "กรุณากดปุ่มเพื่อสแกน" เอง (feedback UAT)
    //  ยกเว้นงาน Special: ปุ่มสแกนมีความหมายอื่น (ต้องเลือก Pallet card ก่อนถึงเริ่มสแกนได้ ดู onClickSpecialPalletCard)
    //  งาน RQ/Transfer WH เป็นข้อยกเว้นของข้อยกเว้น: มีได้ทั้ง Jumbo Bag (สแกนตรงได้เลยไม่ต้องกด Add Pallet) และแบบเดิม (ต้องกด Add Pallet
    //  ก่อน) ปนกัน -> เปิดสแกนรอไว้เลยเหมือนงานปกติ ถ้าสแกนแรกเป็นโค้ดเดิมไม่ใช่ Jumbo ค่อยโดน guard เดิมเตือนให้กด Add Pallet
    if (!this._isManualInputMode && (!this._isSpecialJob || this._isAutoSpecialJob)) {
      this.onClickScanButton();
      return;
    }
    this.focusScannerInput();
  }

  //  โฟกัสช่องสแกนกลับทุกครั้งที่คลิกที่ใดก็ได้บนหน้า (ยกเว้นตอนอยู่โหมดพิมพ์เอง)
  @HostListener('document:click')
  onDocumentClick(): void {
    //  modal สแกนถุง (Special Package) ต้องให้ช่องสแกนคงโฟกัสไว้เสมอด้วย เพราะปืนสแกนต้องยิงโค้ดเข้า modal นี้ได้ต่อเนื่อง
    if (this._isManualInputMode) return;
    setTimeout(() => this.focusScannerInput(), 0);
  }

  //  ดักตอนสลับหน้าต่าง/แอป (browser หลุด focus) -> ปุ่มต้องกลับเป็นสีน้ำเงิน
  @HostListener('window:blur')
  onWindowBlur(): void {
    this._isScanning = false;
    this._isSpecialBagScanning = false;
  }

  //  ─────────────────────────────────────────────────────────────
  //  JOB DATA LOADING
  //  ─────────────────────────────────────────────────────────────
  //  โหลดข้อมูลงานจาก Navigation State หรือ Session Storage (fallback กันหาย ตอน refresh)
  private loadJobData(): void {
    const navigationState = this.router.getCurrentNavigation()?.extras?.state ?? history.state;

    const stateJob = navigationState?.['job'];
    const stateAction = navigationState?.['action'];

    const sessionJob = this.loadJobDataFromSession();
    const sessionAction = this.loadActionFromSession();

    //  ถ้า session กับ state เป็นงานเดียวกัน (id ตรงกัน) ใช้ของ session เพราะอาจมี progress ที่ scan ไปแล้ว
    const rawJob =
      sessionJob && stateJob && String(sessionJob.id) === String(stateJob.id)
        ? sessionJob
        : (stateJob ?? sessionJob);

    this._scanAction = stateAction ?? sessionAction ?? 'both';

    if (!rawJob) return;

    this._jobDataRaw = rawJob;
    this._job = {
      jobTag: this.scanLogic.mapJobTag(rawJob.type_name, rawJob.type_topic),
      jobNomber: this.scanLogic.fallback(rawJob.system_no),
      isUrgent: rawJob.is_urgent,
    };

    this._isMultiStep = rawJob.is_multi_fl === 'Y';
    this._isOutbound = rawJob.type_topic === 'Outbound';
    this._isRequestJob = rawJob.type_name === 'Request';
    this._isPickingJob = rawJob.type_name === 'Picking';
    this._isShippingJob = rawJob.type_name === 'Shipping';
    this._isInternalTransferJob = rawJob.type_name === 'Internal Transfer';
    this._isTransferWhJob = rawJob.type_name === 'Transfer WH';

    //  งานฝั่ง kg (RQ/Transfer WH/IT/Picking — BE ยืนยันแล้วว่าไม่ใช่แค่ IT) บางงาน backend ส่ง pallet_assigned มาให้
    //  (พาเลทที่รู้ล่วงหน้าแล้วทั้งใบ grade/lot/qty/QR code) -> แยกไปเข้า flow "manual pallet" ของงานปกติไปเลย (สแกน PL
    //  code จบทีเดียว) ไม่ใช่ flow Special (Add Pallet/นับถุง) เพราะไม่มีอะไรให้นับ นับโควต้าเป็น "จำนวนพาเลท" เหมือนเดิม
    //  ทุกงาน (ไม่เปลี่ยนเป็น กก. แม้ Picking/RQ/TW จะใช้ กก. ปกติก็ตาม ยืนยันแล้วว่าเคส manifest นี้ตั้งใจให้นับจำนวนเสมอ)
    //  BK ไม่เข้า flow manifest นี้ (เหมือนก่อนย้าย BK เข้ากลุ่ม _isAutoSpecialJob) นับถุงแบบ special เสมอ
    const hasAssignedPallet = this._isAutoSpecialJob
      && rawJob.type_name !== 'Breakage & Replacement'
      && (rawJob.items ?? []).some((item: any) => Array.isArray(item.pallet_assigned) && item.pallet_assigned.length > 0);

    //  งาน Request/Transfer WH: ใช้ concept ของงาน Special เต็มรูปแบบฝั่ง client (นับถุง/Add Pallet/full-pallet modeId ฯลฯ) เหมือนกันหมด
    //  แต่ยิง API ไปที่ endpoint /request/... หรือ /transfer-wh/... ของจริงเสมอ ไม่ใช่ /special/... -> ดู ScanPalletApiService.resolveJobApi()
    //  ที่เช็ค isRequestJob/isTransferWh ก่อน isSpecialJob เพื่อกันหลุดไปเรียก endpoint special ผิดตัว
    //  Picking (งาน kg เหมือน Request ตามที่ BE ออกแบบ endpoint ของตัวเองไว้แล้ว /picking/...) เข้า special-job flow
    //  ด้วยเช่นกัน แต่ฝั่ง "วาง" ยังใช้ free-location flow เดิมของ Picking เอง (ดู isPickingFreeLocationPallet) เพราะ
    //  Location ปลายทางไม่รู้ล่วงหน้าแบบ RQ/Transfer WH/IT ที่มากับข้อมูลงานอยู่แล้ว
    //  Special Package ย้ายเข้ากลุ่ม _isAutoSpecialJob เต็มรูปแบบแล้ว (เหมือน RQ/Transfer WH/IT/Picking ทุกจุด) ไม่ต้อง
    //  เช็ค type_name === 'Special Package' แยกอีกต่อไปที่ 2 บรรทัดนี้ -- เหลือ BK เท่านั้นที่ยังเป็นข้อยกเว้นจริง
    this._isSpecialJob = rawJob.type_name === 'Breakage & Replacement' || (this._isAutoSpecialJob && !hasAssignedPallet);
    this._isBkJob = rawJob.type_name === 'Breakage & Replacement';
    //  BK นับทีละถุงเสมอ (ไม่มีเอาทั้งพาเลท/ปุ่ม "เลือกทั้งหมด") แม้จะอยู่ในกลุ่ม _isAutoSpecialJob แล้วก็ตาม
    this._specialAllowsFullPallet = this._isAutoSpecialJob && !hasAssignedPallet && !this._isBkJob;

    const items = rawJob.items ?? [];

    //  งานฝั่ง kg + pallet_assigned: normalize field ให้ตรงกับ pallet_manual ที่งานปกติใช้อยู่แล้ว (scanned_qr_code ไม่ใช่
    //  scannedQrCode) แล้วยืม flow manual pallet ทั้งหมดมาใช้ (match/แสดงผล/ยิง Get) โดยไม่ต้องเขียนโค้ดใหม่ซ้ำ
    if (hasAssignedPallet) {
      items.forEach((item: any) => {
        if (Array.isArray(item.pallet_assigned) && item.pallet_assigned.length > 0) {
          item.pallet_manual = item.pallet_assigned.map((p: any) => ({
            id: p.id,
            grade: p.grade,
            lot: p.lot,
            qty: p.qty,
            scanned_qr_code: p.scannedQrCode,
          }));
        }
      });
    }

    //  งาน manual pallet: item มี field pallet_manual เป็น array ไม่ว่าง (งานปกติ backend ส่ง field นี้มาด้วยเหมือนกันแต่เป็น [] ว่าง) -> ยืนยัน pallet ได้จากสแกนโค้ด PL ครั้งเดียว เหมือน Outbound
    this._isManualPalletJob = items.some((item: any) => Array.isArray(item.pallet_manual) && item.pallet_manual.length > 0);

    //  scan_qty ย้ายไปอยู่ระดับ item แล้ว (บาง grade สแกนแค่ 1 ครั้ง บาง grade สแกน 3 ครั้ง ไม่เท่ากันในงานเดียวกันได้)
    //  -> resolve ใหม่ทุกครั้งที่เริ่มกลุ่มสแกนของ item ไหนแทน (ดูตอนสร้าง _currentGroup ใหม่ใน handleScannedCode)
    //  ตรงนี้แค่ตั้งค่าเริ่มต้นก่อนสแกนจริง (ยังไม่รู้ว่าจะสแกน item ไหนก่อน) -> เดาจาก item แรกไปก่อน กันโชว์เลขผิด
    //  ตั้งแต่ยังไม่ทันสแกน (งานส่วนใหญ่มีแค่ item เดียว หรือ item แรกเป็นตัวแทนที่แม่นพอ)
    this.initBagCheckList(items[0]?.scan_qty ?? (this._isOutbound || this._isManualPalletJob ? 1 : 3));

    this._totalPalletCount = rawJob.total_qty ?? 0;

    //  Special Package: backend เก็บ pallet_seq ให้เองใน pallets.receive_pallet -> จัดกลุ่มตรงๆ ไม่ต้อง derive จาก receive_qty
    //  pallet ที่ "เตรียมเอาไปวาง" ไปแล้วก่อนหน้า (session ก่อนรีเฟรช) เก็บ seq ไว้เอง (backend ไม่รู้ว่ากล่องไหน "ปิด" แล้วบ้าง)
    if (this._isSpecialJob) {
      const groups = this.scanLogic.buildSpecialPalletGroups(rawJob, items);
      const session = this.loadSpecialSessionFromStorage(rawJob.id);
      const openSeqSet = new Set(session?.openSeqs ?? []);

      //  BK: ของใน receive_pallet = Get แล้วแต่ Put ยังไม่ผ่าน (ปกติ Put ต่อให้เองทันที) -> เข้ารายการรอวางทั้งหมดเสมอ ไม่เป็น
      //  กล่องเปิดค้าง ให้กดปุ่ม "ยิง Put อีกครั้ง" ได้ (รวมถึงของที่ค้างจาก flow BK เดิมก่อนมี Put)
      const isOpen = (g: { seq: number }) => !this._isBkJob && openSeqSet.has(g.seq);
      this._specialOpenPallets = groups.filter(isOpen);
      //  กลุ่มที่ "ปิด" แล้ว (รอวาง) รวม grade/lot ซ้ำเป็นรายการเดียวเหมือนตอนกด "เตรียมเอาไปวาง" จริง กัน reload แล้วเห็นแยกการ์ด
      this._palletToPlaceList = groups
        .filter((g) => !isOpen(g))
        .flatMap((g) => this.mergeSpecialEntriesByGradeLot(g.entries));

      //  ต้องเทียบกับ pallet_seq ใน complete_pallet ด้วย ไม่ใช่แค่ receive_pallet (pending) เพราะ pallet ที่วางสำเร็จแล้ว
      //  จะถูกลบออกจาก receive_pallet ไปแล้ว -> ถ้าเช็คแค่ receive_pallet เลข seq ที่วางเสร็จไปแล้วจะถูกใช้ซ้ำได้
      const completePool: any[] = rawJob.pallets?.complete_pallet ?? [];
      const backendMaxSeqRaw = Math.max(
        groups.reduce((max, g) => Math.max(max, g.seq), 0),
        completePool.reduce((max: number, p: any) => Math.max(max, p.pallet_seq ?? 0), 0),
      );
      //  backendMaxSeqRaw มี user_id ต่อท้ายอยู่แล้ว (ดู claimNextSpecialSeq/SPECIAL_SEQ_USER_SUFFIX_RANGE) -> หารออก
      //  เอาแค่ส่วนตัวนับก่อนเก็บ ไม่งั้นตัวนับครั้งต่อไปจะเพี้ยน (เทียบ max กันตรงๆ แบบนี้ยังถูกต้องเสมอ เพราะตัวนับอยู่หลัก
      //  สูงกว่า user_id เสมอไม่ว่า user_id จะเป็นใคร ไม่ต้องหารก่อนค่อยเทียบ)
      const backendMaxSeq = Math.floor(backendMaxSeqRaw / this.SPECIAL_SEQ_USER_SUFFIX_RANGE);
      this._specialPalletSeq = Math.max(backendMaxSeq, (session?.nextSeq ?? 1) - 1);
      this._specialActiveSeq = null;
      //  ไม่รู้ว่าเลขไหน "เคยลองแล้วยกเลิก" บ้างจาก session ก่อน reload (backend ไม่เก็บข้อมูลนี้) -> เริ่มใหม่เสมอ
      //  ปลอดภัย ไม่ reuse ก็แค่เลขกระโดดข้ามเหมือนเดิม ไม่ชนกับของเดิมอยู่ดี
      this._specialReusableSeqs = [];
    } else {
      this._palletToPlaceList = this.scanLogic.buildPalletToPlaceList(rawJob, items);
    }

    //  งาน RQ/Transfer WH/IT เท่านั้น: derive รูปแบบ pallet ของงานนี้จากของที่มีอยู่แล้วใน backend ก่อนเสมอ (กัน step 2/reload คนละเครื่อง
    //  ไม่รู้ว่า step 1 สแกนแบบไหนไว้) ถ้ายังไม่เคยมี record ไหนเลยปล่อย null รอให้สแกนสดครั้งแรกกำหนดเอง
    this._requestJobPalletFormat = null;
    if (this._isAutoSpecialJob) {
      const existingPool: any[] = [...(rawJob.pallets?.receive_pallet ?? []), ...(rawJob.pallets?.complete_pallet ?? [])];
      const firstCoded = existingPool.find((p: any) => !!p?.scanned_qr_code);
      if (firstCoded) {
        //  โค้ด PL (4 ส่วน) ใช้ล็อค 'jumbo' ร่วมกับ Jumbo Bag จริง (ดู handleFullPalletScanForRequest) -> ต้องลองทั้งคู่
        const code = String(firstCoded.scanned_qr_code).trim();
        this._requestJobPalletFormat =
          this.scanLogic.parseJumboBagScanCode(code) || this.scanLogic.parseFullPalletScanCode(code) ? 'jumbo' : 'normal';
      }
    }

    this._palletsAwaitingSourceLocation = this._isOutbound && !this._isSpecialJob
      ? this.scanLogic.buildPalletsAwaitingSourceLocation(rawJob, items, this._palletToPlaceList)
      : [];
    this._outboundVerificationPallets = [];
    this._completedPalletsByItem = this.scanLogic.buildCompletedPalletsByItem(rawJob, items);
    this.autoSelectPalletsIfEligible();
    this.saveJobDataToSession();

    if (items.length === 0) {
      this.SweetAlert('warning', 'ไม่พบรายการสินค้าของงานนี้ กรุณากลับไปเลือกงานใหม่');
    }
  }

  private loadJobDataFromSession(): any {
    const saved = sessionStorage.getItem('scanPalletJobData');
    return saved ? JSON.parse(saved).job : null;
  }

  private loadActionFromSession(): 'get' | 'put' | 'both' | null {
    const saved = sessionStorage.getItem('scanPalletJobData');
    return saved ? (JSON.parse(saved).action ?? null) : null;
  }

  //  งาน Special: backend ไม่รู้ว่า pallet ไหน "เตรียมเอาไปวาง" แล้วบ้าง (แค่รู้ว่า Get แล้วยังไม่ put away) -> เก็บ seq ที่ "ปิด" เองใน session
  private loadSpecialSessionFromStorage(jobId: number): { nextSeq: number; openSeqs: number[] } | null {
    try {
      const saved = sessionStorage.getItem('scanPalletJobData');
      if (!saved) return null;
      const session = JSON.parse(saved).specialSession;
      if (!session || String(session.jobId) !== String(jobId)) return null;
      return session;
    } catch {
      return null;
    }
  }

  //  ─────────────────────────────────────────────────────────────
  //  SCANNER INPUT (ปุ่มสแกน / โหมดพิมพ์เอง / ช่อง input ที่ซ่อนไว้)
  //  ─────────────────────────────────────────────────────────────
  focusScannerInput(): void {
    this.scannerInputRef?.nativeElement?.focus();
  }

  onClickScanButton(): void {
    this._isScanning = true;
    this._isScanBlocked = false;
    this.focusScannerInput();
  }

  //  ล้างสถานะการสแกนถุงและกลุ่มที่กำลังสแกนอยู่ทั้งหมด
  onClickClearCheckList(): void {
    this.initBagCheckList(this._bagRequiredCount);
    this._isScanning = false;
    this._isScanBlocked = true;
    this._scannerValue = '';
    this.resetCurrentGroup();
    this.focusScannerInput();
  }

  //  จำนวนกล่อง Special ที่รอสแกน Location หรือรอ Get ตอบกลับ แยกตาม palletSeq เพราะ 1 กล่องอาจมีหลาย Grade/Lot
  private get _pendingSpecialPalletCount(): number {
    const pendingSeqs = new Set(this._specialAwaitingSourceLocation.map((entry) => entry.palletSeq));
    return pendingSeqs.size + this._specialInFlightWeight.length;
  }

  private get _isSpecialPalletBatchFull(): boolean {
    return this._pendingSpecialPalletCount >= 2;
  }

  //  กล่อง active ตอนนี้ "เต็ม" แล้วหรือยัง (มี entry ที่ไม่รับของเพิ่มเข้ากล่องเดิมได้อีกแล้วค้างอยู่) -> ต้อง claim
  //  seq ใหม่แทนที่จะ join กล่องเดิมสำหรับสแกนครั้งถัดไป (ดู handleSpecialScannedCode/handleJumboBagScan) ครอบคลุม
  //  2 เคส: (1) เต็ม pallet/Jumbo (isFullPallet) ที่รอสแกน Location อยู่ -> แต่ละใบคือคนละพาเลทจริงเสมอ ห้ามแชร์กล่อง
  //  เดียวกัน (ไม่งั้นป้ายม่วงจะ merge กันจนดูเหมือนสแกนไปใบเดียว เจอจริงตอนทดสอบ) (2) ถุงที่กดล็อกไว้แล้ว (lockedCodes
  //  ดู onLockSpecialQtyForLocationScan) ถือว่ากล่องนั้นจบการนับแล้วเหมือนกัน
  private isActiveSpecialSeqOccupied(): boolean {
    return this._specialAwaitingSourceLocation.some(
      (e) => e.palletSeq === this._specialActiveSeq && (e.lockedCodes || e.isFullPallet),
    );
  }

  //  งาน BK เท่านั้น (งานกลุ่ม _isAutoSpecialJob ไม่มีปุ่มนี้แล้ว ใช้ auto เปิดกล่องจากการสแกนแทน): ทุก item เต็มโควต้า
  //  หมดแล้วหรือยัง (1 pallet ใส่ได้หลาย grade/lot ผสมกัน -> ต้องเช็คทุก item ไม่ใช่แค่ item เดียว) ใช้ซ่อนปุ่ม Add Pallet
  //  ตอนงานเสร็จสมบูรณ์แล้ว
  get _allSpecialItemsFull(): boolean {
    const items = this._jobDataRaw?.items ?? [];
    if (items.length === 0) return false;
    return items.every((item: any) => (item.receive_qty ?? 0) + (item.complete_qty ?? 0) >= (item.total_qty ?? 0));
  }

  //  งาน BK เท่านั้น (งานกลุ่ม _isAutoSpecialJob: RQ/Transfer WH/IT/Picking/Special Package เอาปุ่มนี้ออกไปหมดแล้ว
  //  ใช้ auto เปิดกล่องจากการสแกนแทน) กด "Add Pallet" ที่ header ของ "รายการทั้งหมด" -> สร้าง pallet ใหม่ (palletSeq = n+1
  //  หรือเลขที่เคยลบทิ้งไว้) แล้ว select ให้ทันที
  onClickAddSpecialPallet(): void {
    if (this._allSpecialItemsFull) {
      this.SweetAlert('warning', 'สินค้าครบตามจำนวนที่ต้องการทุกรายการแล้ว ไม่สามารถเพิ่มพาเลทได้อีก');
      return;
    }

    if (this._isSpecialPalletBatchFull) {
      this.SweetAlert('warning', 'กรุณาสแกน Location ต้นทางยืนยันพาเลทปัจจุบันให้เสร็จก่อน ถึงจะเพิ่มพาเลทใหม่ได้');
      return;
    }

    const seq = this.claimNextSpecialSeq();
    this._specialOpenPallets = [...this._specialOpenPallets, { seq, entries: [] }];
    this._specialActiveSeq = seq;
    this.saveJobDataToSession();
    this.onClickScanButton();
  }

  //  งาน Special: กด card pallet ที่มีอยู่แล้ว (ยังไม่ "เตรียมเอาไปวาง") เพื่อ select/highlight แล้ว Get เพิ่มเข้ากล่องนี้
  onClickSpecialPalletCard(seq: number): void {
    if (this._specialActiveSeq === seq) return;

    if (this._isSpecialPalletBatchFull) {
      this.SweetAlert('warning', 'กรุณาสแกน Location ต้นทางยืนยันพาเลทปัจจุบันให้เสร็จก่อน ถึงจะสลับไปกล่องอื่นได้');
      return;
    }

    this._specialActiveSeq = seq;
    this.onClickScanButton();
  }

  //  งาน Special: กด "เตรียมเอาไปวาง" -> ปิดกล่องนี้ถาวร รวม Get ที่ grade/lot ซ้ำกันเป็นรายการเดียว (บวก qty กัน) แล้วย้ายไปรายการรอวางฝั่งซ้าย
  //  autoSelect default true เหมือนเดิมทุกจุดเรียก (กดปุ่มเองของ BK ตั้งใจกดแล้วอยากให้เลือกให้เลย)
  //  ยกเว้น auto-trigger ของงานกลุ่ม _isAutoSpecialJob ตอนเป็นงาน 2-step (getSpecialFullPallet/onConfirmSpecialQty) ที่ส่ง false มา
  //  เพราะยังไม่ควรเลือก/พร้อม put ในเซสชัน Step 1 นี้ (เหมือน autoSelectPalletsIfEligible กัน _isMultiStep ไว้ให้งานปกติ)
  //  -> "เข้ารายการรอวาง" ต้องเกิดเสมอไม่ว่า autoSelect จะเป็นอะไร (ไม่งั้นการ์ดจะค้างอยู่ในกล่องเปล่าๆ ไม่มีสถานะให้โชว์)
  onClickReadyToPlaceSpecialPallet(seq: number, autoSelect: boolean = true): void {
    const group = this._specialOpenPallets.find((g) => g.seq === seq);
    if (!group || group.entries.length === 0) return;

    this._specialOpenPallets = this._specialOpenPallets.filter((g) => g.seq !== seq);

    const merged = this.mergeSpecialEntriesByGradeLot(group.entries);
    this._palletToPlaceList = [...this._palletToPlaceList, ...merged];
    //  เลือกไว้รอวางทันที ไม่ต้องสแกนถุงซ้ำเพื่อ "เลือก" แบบงานปกติ -> สแกน Location ปลายทางได้เลย
    //  BK ไม่เลือก (ไม่มีปลายทางให้สแกน) ยิง Put ต่อให้เองด้านล่าง
    if (autoSelect && !this._isBkJob) merged.forEach((p) => this.selectPalletForPlacement(p));

    if (this._specialActiveSeq === seq) {
      this._specialActiveSeq = null;
      //  BK ไม่มีปลายทางให้ไปสแกนต่อ -> คงโหมดสแกนไว้ สแกนถุงชุดถัดไปได้เลยไม่ต้องกดปุ่มสแกนใหม่
      if (!this._isBkJob) this._isScanning = false;
    }

    this.saveJobDataToSession();
    this.refreshDisplayList();

    if (this._isBkJob) this.putAwayBkPallets(merged);
  }

  //  รวมรายการที่ grade/lot เดียวกัน (มาจากหลาย Get) เป็นรายการเดียว บวก qty กัน -> ไม่ต้องขึ้นการ์ดซ้ำต่อถุง
  //  เก็บ specialEntryId ทุกตัวไว้ใน specialEntryIds กัน put-away ลืมลบบาง entry ออกจาก receive_pallet
  //  เก็บ qrCode ของถุงใบที่ 2 ขึ้นไปไว้ใน bagCodes ด้วย (ไม่ทิ้ง) -> งาน 2-step ที่ต้อง "สแกนซ้ำเพื่อเลือก" pallet ที่
  //  ปิดกล่องไปแล้วใน Step 1 (คนละเครื่อง/คนละคน) ต้อง match ได้ไม่ว่าจะสแกนถุงใบไหนจากทั้งหมดที่ receive_pallet ส่งมา
  //  ไม่ใช่แค่ใบแรกที่บังเอิญรอดมาเป็น qrCode หลัก (ดู palletHasCode ที่เช็คทั้ง qrCode และ bagCodes)
  private mergeSpecialEntriesByGradeLot(entries: PalletToPlaceItem[]): PalletToPlaceItem[] {
    const map = new Map<string, PalletToPlaceItem>();

    entries.forEach((e) => {
      const key = `${e.grade}|${e.lotNo}`;
      const qty = typeof e.qty === 'number' ? e.qty : 0;
      const existing = map.get(key);

      if (existing) {
        existing.qty = (typeof existing.qty === 'number' ? existing.qty : 0) + qty;
        if (e.specialEntryId != null) existing.specialEntryIds = [...(existing.specialEntryIds ?? []), e.specialEntryId];
        if (e.qrCode) existing.bagCodes = [...(existing.bagCodes ?? []), e.qrCode];
      } else {
        map.set(key, { ...e, specialEntryIds: e.specialEntryId != null ? [e.specialEntryId] : [] });
      }
    });

    return Array.from(map.values());
  }

  //  หา id ทุกตัวใน receive_pallet ของรายการนี้ (รองรับทั้งรายการเดี่ยวที่ยังไม่รวม และรายการที่รวมมาแล้วตอน "เตรียมเอาไปวาง")
  private getSpecialEntryIds(pallet: PalletToPlaceItem): number[] {
    if (pallet.specialEntryIds && pallet.specialEntryIds.length > 0) return pallet.specialEntryIds;
    return pallet.specialEntryId != null ? [pallet.specialEntryId] : [];
  }

  //  งาน Special: ลบ pallet ที่ "เปิด" อยู่ (ยังไม่กด "เตรียมเอาไปวาง") -> ยังไม่มีของก็ลบตรงๆ ได้เลย
  //  มีของแล้วต้องยิง reset คืนโควต้าที่ Get ไปก่อนทีละรายการ (แนบ palletSeq ไปด้วยว่าเป็นกล่องไหน)
  onClickDeleteSpecialOpenPallet(seq: number): void {
    const group = this._specialOpenPallets.find((g) => g.seq === seq);
    if (!group) return;

    if (group.entries.length === 0) {
      this._specialOpenPallets = this._specialOpenPallets.filter((g) => g.seq !== seq);

      //  กล่องนี้อาจมีถุง/Jumbo Bag ที่สแกนไปแล้วแต่ยังรอสแกน Location ต้นทางยืนยันอยู่ (ยังไม่เข้า entries จนกว่าจะ
      //  Get สำเร็จ) -> ต้องลบ entry นั้นออกจาก _specialAwaitingSourceLocation ด้วย ไม่งั้นพอไปสแกน Location ทีหลัง
      //  (โดยไม่รู้ว่ากล่องนี้ถูกลบไปแล้ว) ระบบจะ "ฟื้น" กล่องที่ลบไปแล้วขึ้นมาใหม่เองโดยไม่ตั้งใจ
      this._specialAwaitingSourceLocation = this._specialAwaitingSourceLocation.filter((e) => e.palletSeq !== seq);

      //  เลขนี้ไม่เหลือค้างที่ไหนเลยแล้ว (ไม่มี entries, ไม่มี pending) -> เอากลับมาให้ pallet ใหม่ใช้ก่อนได้เลย
      this._specialReusableSeqs = [...this._specialReusableSeqs, seq];

      if (this._specialActiveSeq === seq) {
        this._specialActiveSeq = null;
        this._isScanning = false;
      }
      this.saveJobDataToSession();
      this.refreshDisplayList();
      return;
    }

    Swal.fire({
      icon: 'warning',
      title: 'ยืนยันการลบพาเลท',
      text: `ต้องการลบพาเลท #${this.specialSeqDisplayLabel(seq)} ทั้งหมดใช่หรือไม่? (${group.entries.length} รายการที่ Get ไปแล้วจะถูกคืนกลับ)`,
      showCancelButton: true,
      confirmButtonText: 'ลบ',
      cancelButtonText: 'ยกเลิก',
      customClass: { popup: 'scan-pallet-delete-confirm' },
    }).then((result) => {
      if (result.isConfirmed) this.deleteSpecialOpenPallet(seq, group);
    });
  }

  private deleteSpecialOpenPallet(seq: number, group: SpecialPalletGroup): void {
    const requests = group.entries.map((entry) => {
      const matchedItem = this.scanLogic.resolveItemForPallet(entry, this._jobDataRaw?.items ?? []);
      const fromLocation = matchedItem ? this.scanLogic.resolveFromLocationByPallet(matchedItem, entry) : null;
      const requestData = {
        itemId: matchedItem?.id ?? 0,
        palletId: Number(entry.id) || 0,
        locationId: fromLocation?.location_id ?? 0,
        locationType: this._jobDataRaw?.from_location_type ?? '',
        updateBy: this._currentUserId,
        qty: entry.qty,
        qrCode: entry.qrCode ?? '',
        palletSeq: seq,
      };

      return this.scanApi.callJobApi(this._jobTypeFlags, 'reset', this._jobDataRaw.id, requestData).pipe(
        map(() => ({ success: true as const, entry, matchedItem, fromLocation })),
        catchError(() => of({ success: false as const, entry, matchedItem: null as any, fromLocation: null as any })),
      );
    });

    //  ยิงทีละใบตามลำดับ (concat) แทนพร้อมกันหมด (forkJoin เดิม) -> กัน request หลายใบไปชนกันที่ backend พร้อมกันจริง
    //  (เหตุผลเดียวกับฝั่ง get/put-away) ผลลัพธ์/modal สรุปท้ายสุดเหมือนเดิมทุกอย่าง
    concat(...requests).pipe(toArray()).subscribe((results) => {
      const succeededEntries: PalletToPlaceItem[] = [];
      const failedEntries: PalletToPlaceItem[] = [];

      results.forEach((r) => {
        if (r.success && r.matchedItem) {
          //  งาน Special receive_qty = ยอดที่รับไปแล้วสะสม (Get บวกเพิ่ม) ลบพาเลทต้องหักออก เหมือน deletePalletFromPlaceList
          //  เดิมบวกเพิ่มตรงนี้ ตัวเลขรับสำเร็จบน progress bar เลยเพิ่มขึ้นตอนลบ
          r.matchedItem.receive_qty = Math.max(0, (r.matchedItem.receive_qty ?? 0) - (r.entry.qty ?? 0));
          this.adjustSpecialFromLocationReceived(r.fromLocation, -(r.entry.qty ?? 0));
          if (r.entry.specialEntryId != null && this._jobDataRaw.pallets?.receive_pallet) {
            this._jobDataRaw.pallets.receive_pallet = this._jobDataRaw.pallets.receive_pallet.filter(
              (p: any) => p.id !== r.entry.specialEntryId,
            );
          }
          succeededEntries.push(r.entry);
        } else {
          failedEntries.push(r.entry);
        }
      });

      if (succeededEntries.length > 0) {
        this._specialOpenPallets = failedEntries.length === 0
          ? this._specialOpenPallets.filter((g) => g.seq !== seq)
          : this._specialOpenPallets.map((g) => (g.seq === seq ? { ...g, entries: failedEntries } : g));
        if (failedEntries.length === 0) {
          //  ลบสำเร็จหมดทั้งกล่อง ไม่เหลือค้างที่ไหนเลย -> เลขนี้เอากลับมาใช้ซ้ำได้ (เหมือน branch กล่องว่างด้านบน)
          this._specialAwaitingSourceLocation = this._specialAwaitingSourceLocation.filter((e) => e.palletSeq !== seq);
          this._specialReusableSeqs = [...this._specialReusableSeqs, seq];
          if (this._specialActiveSeq === seq) {
            this._specialActiveSeq = null;
            this._isScanning = false;
          }
        }
        this.saveJobDataToSession();
      }

      this.refreshDisplayList();
      this.notifyBatchResult('ลบพาเลท', succeededEntries, failedEntries, 'รายการ');
    });
  }

  //  งาน Special: ผลัก entry ที่ Get สำเร็จเข้ากลุ่มของ pallet นั้น (เก็บใน _specialOpenPallets ระหว่างที่ยังไม่ "เตรียมเอาไปวาง")
  private pushIntoSpecialOpenPallet(seq: number, entry: PalletToPlaceItem): void {
    let found = false;
    this._specialOpenPallets = this._specialOpenPallets.map((g) => {
      if (g.seq !== seq) return g;
      found = true;
      return { ...g, entries: [...g.entries, entry] };
    });
    if (!found) this._specialOpenPallets = [...this._specialOpenPallets, { seq, entries: [entry] }];
  }

  //  งาน Special: เลข pallet_seq ที่จะใช้เปิดกล่องใหม่ -> เอาจากเลขที่เคยถูกลบทิ้งไปแล้วก่อนเสมอ (เล็กสุดก่อน, ต่อ user_id
  //  ไว้แล้วตั้งแต่ตอนสร้าง ไม่ต้องต่อซ้ำ) ถ้าไม่มีค่อยนับเพิ่มใหม่แล้วต่อ user_id ของตัวเองท้ายเลขเสมอ (ดู
  //  SPECIAL_SEQ_USER_SUFFIX_RANGE ด้านบน) กันชนกับเครื่องอื่นที่คำนวณตัวนับได้เลขเดียวกันพอดี
  private claimNextSpecialSeq(): number {
    if (this._specialReusableSeqs.length > 0) {
      const seq = Math.min(...this._specialReusableSeqs);
      this._specialReusableSeqs = this._specialReusableSeqs.filter((s) => s !== seq);
      return seq;
    }
    this._specialPalletSeq += 1;
    return this._specialPalletSeq * this.SPECIAL_SEQ_USER_SUFFIX_RANGE + this._currentUserId;
  }

  onToggleManualInputMode(checked: boolean): void {
    this._isManualInputMode = checked;
    this._manualInputValue = '';

    if (!this._isManualInputMode) {
      this.focusScannerInput();
    }
  }

  //  ยืนยันโค้ดที่พิมพ์เอง -> ใช้ logic เดียวกับตอนสแกนจริงทุกอย่าง (onScannerEnter)
  onClickSubmitManualInput(): void {
    const code = this._manualInputValue.trim();
    if (!code) return;

    this._isScanBlocked = false;
    this._isScanning = true;   //  บังคับเปิดโหมดสแกนไปด้วย เพราะ manual input ข้ามปุ่ม "กดเพื่อสแกน" ไป
    this._scannerValue = code;
    this._manualInputValue = '';

    this.onScannerEnter();
  }

  //  แยกส่วนข้อมูลจากโค้ดที่สแกนได้ (costCenter|grade|lot|runningNo|palletId)
  parseScanCode(code: string): ParsedScanCode | null {
    return this.scanLogic.parseScanCode(code);
  }

  //  จัดการเมื่อผู้ใช้กด Enter หลังสแกน/พิมพ์โค้ด -> แยกไปทำงานตามประเภทของโค้ดที่ได้
  onScannerEnter(): void {
    const code = this._scannerValue.trim();
    this._scannerValue = '';

    if (!code || this._isScanBlocked) return;

    //  กันสแกนถุงใบถัดไปรัวๆ แซงหน้า response ของถุงใบก่อนที่ยังไม่ทันกลับมา (ดู _isSpecialBagResolving ด้านบน)
    if (this._isSpecialBagResolving) {
      this.SweetAlert('warning', 'กรุณารอสักครู่');
      this.focusScannerInput();
      return;
    }

    if (this.shouldBlockOutboundScan(code)) {
      this.focusScannerInput();
      return;
    }

    //  Special job: modal สแกนถุงเปิดอยู่ -> ทุกโค้ดที่สแกนเข้ามาคือถุงที่จะเพิ่มเข้า modal ไม่ใช่การสแกนงานปกติ
    //  ยกเว้นงานกลุ่ม _isAutoSpecialJob: entry ยังค้างอยู่ใน _specialAwaitingSourceLocation ระหว่างเปิด modal (ดู
    //  queueSpecialAwaitingSourceLocation) -> ถ้าโค้ดที่สแกนตรงกับ Location ต้นทางที่รออยู่ ถือเป็นสัญญาณ "นับครบแล้ว
    //  ยิงเลย" ไม่ใช่ถุงอีกใบ (BK ไม่มีวันเข้าเงื่อนไขนี้ เพราะ entry ของมันถูก splice ออกไปก่อน
    //  modal จะเปิดเสมอ -> isKnownSpecialSourceLocation คืน false ตลอด ไหลไปทาง handleSpecialBagScanForModal แบบเดิม)
    if (this._specialQtyModal) {
      if (this.isKnownSpecialSourceLocation(code)) {
        this.handleSpecialSourceLocationScan(code);
        this.focusScannerInput();
        return;
      }
      this.handleSpecialBagScanForModal(code);
      this.focusScannerInput();
      return;
    }

    const hasPendingSourceScan = this._isOutbound
      && (this._palletsAwaitingSourceLocation.length > 0 || this._outboundVerificationPallets.length > 0);
    const hasPendingSpecialSourceScan = this._isSpecialJob && this._specialAwaitingSourceLocation.length > 0;

    const canAcceptScan =
      this._isScanning || this._selectedPalletsForPlacement.length > 0 || hasPendingSourceScan || hasPendingSpecialSourceScan;

    if (!canAcceptScan) return;

    //  งาน 2-step โหมด Get เท่านั้น: สแกนโค้ดที่ Get ไปแล้ว (อยู่ใน _palletToPlaceList) ไม่ควรตีความเป็น "เลือกเพื่อวาง"
    //  (แนวคิดฝั่ง Put) เพราะเครื่องที่ทำ Step 1/โหมด Get ไม่มีขั้นวางเลย -> ฟันธงเป็น error "สแกนซ้ำ" ตรงๆ ดักไว้ต้นทาง
    //  ก่อนเข้า handler ย่อยของแต่ละ format เลย กันต้องไปแก้ alreadyVerified ทีละจุดในหลายฟังก์ชัน
    if (this._isMultiStep && this._scanAction === 'get') {
      const alreadyGot = this._palletToPlaceList.find((p) => this.scanLogic.palletHasCode(p, code));
      if (alreadyGot) {
        this.SweetAlert('error', 'สแกนพาเลทซ้ำ');
        this.focusScannerInput();
        return;
      }
    }

    //  งาน manifest (pallet_manual/pallet_assigned): เช็คก่อนว่าโค้ดที่สแกนตรงกับ entry ที่รู้จักไว้ล่วงหน้าไหม ไม่สนรูปร่างโค้ด
    //  งาน IT บางงานมี pallet_assigned ปนกันทั้งโค้ด PL (4 ส่วน) และโค้ดถุงปกติ (5 ส่วน) ในรายการเดียวกัน -> ต้องเช็คเนื้อโค้ดตรงๆ
    //  ก่อนเสมอ ไม่ใช่เดาจากรูปร่างโค้ดแบบเดิม เพื่อให้จบพาเลทได้ในสแกนเดียวไม่ว่าโค้ดจะหน้าตายังไง
    const manifestMatch = this._isManualPalletJob ? this.findManualManifestMatch(code) : null;

    //  โค้ด "เอาทั้ง pallet" พิเศษ (ขึ้นต้น PL, 4 ส่วน มี qty ฝังมา) -> เฉพาะงานที่นับถุงแบบปกติ (ไม่ใช่ Special/BK ที่มี flow
    //  นับถุงของตัวเองอยู่แล้ว) ยกเว้นงาน RQ/Transfer WH/IT เหมือน Jumbo Bag เป๊ะ (มีได้ทั้ง 3 แบบ: นับน้ำหนักสะสม/Jumbo Bag/โค้ด PL นี้)
    const fullPalletParsed = !manifestMatch && (!this._isSpecialJob || this._isAutoSpecialJob) ? this.scanLogic.parseFullPalletScanCode(code) : null;

    //  โค้ด Jumbo Bag (7 ส่วน มี qty ฝังมาในโค้ด) -> งานนับถุงแบบปกติเหมือนโค้ด PL (ไม่ยุ่งงาน Special/BK)
    //  ยกเว้นงาน RQ/Transfer WH/IT ที่ติด _isSpecialJob ด้วยเหมือนกัน แต่มีได้ทั้ง 2 แบบ (นับน้ำหนักสะสมแบบเดิม หรือ Jumbo Bag แบบใหม่)
    //  -> ต้องลอง parse ก่อนเสมอ ถ้าเจอรูปร่าง Jumbo จริงให้ข้ามไปทาง handleJumboBagScan ไม่ใช่ handleSpecialScannedCode
    const jumboBagParsed = !manifestMatch && !fullPalletParsed && (!this._isSpecialJob || this._isAutoSpecialJob)
      ? this.scanLogic.parseJumboBagScanCode(code)
      : null;

    //  งาน manifest (_isManualPalletJob) ที่โค้ดหน้าตาเป็นพาเลทจริง (ไม่ว่าแบบ PL/Jumbo/ถุงปกติ) แต่ไม่ตรงกับ
    //  pallet_manual ใบไหนเลย (manifestMatch = null) -> ห้ามปล่อยไหลไปจับคู่แค่ grade/lot แบบงานทั่วไป (เคยหลุดมาแล้วจริง
    //  งาน Inbound ได้พาเลทผิดใบแต่ grade/lot ตรง บันทึกว่าเสร็จทั้งที่ของจริงมาไม่ครบ) เช็คแค่ "หน้าตาเป็นพาเลท" เท่านั้น
    //  ไม่ไปแตะเงื่อนไขอื่น (location code ไม่มีทาง parse ผ่านสามอันนี้อยู่แล้ว เลยยังไหลไปทาง handleLocationScan ต่อได้ปกติ)
    const looksLikeAnyPallet = !!fullPalletParsed || !!jumboBagParsed || this.parseScanCode(code) !== null;

    if (manifestMatch) {
      this.handleManifestPalletScan(manifestMatch.item, manifestMatch.entry, code);
    } else if (this._isManualPalletJob && looksLikeAnyPallet) {
      this.SweetAlert('error', 'งานนี้เป็นงานแบบ Manual พาเลทที่สแกนไม่ตรงกับรายการที่ระบบกำหนดไว้ล่วงหน้า กรุณาตรวจสอบ QR Code ให้ตรงกับใบที่กำหนด');
    } else if (fullPalletParsed) {
      //  งาน RQ/Transfer WH/IT: โค้ด PL วัดโควต้าเป็น กก. ไม่ใช่จำนวนใบแบบงานปกติ -> ต้องเข้า flow Special เอง (เหมือน Jumbo Bag)
      this._isAutoSpecialJob
        ? this.handleFullPalletScanForRequest(fullPalletParsed)
        : this.handleFullPalletScan(fullPalletParsed, code);
    } else if (jumboBagParsed) {
      this.handleJumboBagScan(jumboBagParsed, code);
    } else if (this.parseScanCode(code) !== null) {
      this._isSpecialJob ? this.handleSpecialScannedCode(code) : this.handleScannedCode(code);
    } else if (hasPendingSpecialSourceScan && this.isKnownSpecialSourceLocation(code)) {
      this.handleSpecialSourceLocationScan(code);
    } else if (hasPendingSourceScan && this.isKnownSourceLocation(code)) {
      this.handleSourceLocationScan(code);
    } else if (this._selectedPalletsForPlacement.length > 0) {
      this.handleLocationScan(code);
    } else if (hasPendingSourceScan) {
      this.handleSourceLocationScan(code);
    } else if (hasPendingSpecialSourceScan) {
      this.handleSpecialSourceLocationScan(code);
    } else if (this._isMultiStep && this._scanAction === 'put' && !this.isCodeInReceivePallet(code)) {
      //  งาน 2-step โหมด Put เท่านั้น: โค้ดนี้ไม่ตรงอะไรเลยที่ผ่านมา (ไม่ใช่ pallet ที่รอวาง/ไม่ใช่ location ที่รู้จัก)
      //  เช็คจาก receive_pallet local (เช็คตามที่ sync ล่าสุด ไม่ยิง API ถามสดเพิ่ม ถ้า auto-fetch ยังไม่ทันอัปเดตก็ถือว่า
      //  ยังไม่มีไปก่อน) ว่าเคยมีใคร Get ไปหรือยัง ถ้าไม่เคยเลยบอกตรงๆ ว่ายังไม่ได้ verify ไม่ใช่ข้อความทั่วไปที่ไม่ช่วยอะไร
      this.SweetAlert(
        'error',
        `พาเลทนี้ยังไม่สแกนยืนยัน กรุณาสแกนพาเลทที่ยืนยันในงาน ${this._job.jobNomber} ไปแล้ว`,
      );
    } else {
      this.SweetAlert('error', 'QR Code ไม่ถูกต้อง กรุณาสแกน QR Code ให้ถูกต้อง');
    }

    this.focusScannerInput();
  }

  //  เช็คว่าโค้ดนี้เคยถูก Get แล้วจริงไหม (มี record อยู่ใน receive_pallet ของงานนี้) จาก local state (sync ล่าสุด
  //  ตอนโหลดหน้า/auto-fetch/action ของเซสชันนี้เอง) ไม่ใช่การยิง API ถามสดเพิ่ม
  private isCodeInReceivePallet(code: string): boolean {
    const target = this.scanLogic.normalizeQrCodeForMatch(code);
    if (!target) return false;
    const pool: any[] = this._jobDataRaw?.pallets?.receive_pallet ?? [];
    return pool.some((p: any) => this.scanLogic.normalizeQrCodeForMatch(p?.scanned_qr_code) === target);
  }

  private isKnownSourceLocation(code: string): boolean {
    return [...this._palletsAwaitingSourceLocation, ...this._outboundVerificationPallets].some(
      (p) => (p.sourceLocation ?? '').trim() === code.trim(),
    );
  }

  private isOutboundScanBatchFull(): boolean {
    const pendingCount =
      this._palletsAwaitingSourceLocation.length +
      this._outboundVerificationPallets.length +
      this._pendingSpecialPalletCount;
    return this._isOutbound && pendingCount >= 2;
  }

  private shouldBlockOutboundScan(code: string): boolean {
    if (!this.isOutboundScanBatchFull()) return false;
    if (this.isKnownSourceLocation(code) || this.isKnownSpecialSourceLocation(code)) return false;

    const alreadyAvailablePallet =
      this._palletToPlaceList.find((p) => this.scanLogic.palletHasCode(p, code))
      ?? this.scanLogic.findPendingPalletByRunningNumber(this._palletToPlaceList, code);
    if (alreadyAvailablePallet) return false;

    const conflict = this.scanLogic.checkPalletIdConflict(code, this._jobDataRaw, this._sessionPalletLists);
    if (conflict) {
      this.SweetAlert(conflict.icon, conflict.message);
    } else {
      this.SweetAlert('warning', 'สแกนได้ไม่เกิน 2 พาเลทต่อรอบ กรุณาสแกน Location ต้นทางเพื่อยืนยันก่อนสแกนพาเลทเพิ่ม');
    }
    return true;
  }

  //  ─────────────────────────────────────────────────────────────
  //  NORMAL JOB: BAG SCAN -> PALLET VERIFICATION
  //  ─────────────────────────────────────────────────────────────
  //  จัดการสแกนถุง/Pallet: จับคู่กับ Item, ตรวจสอบความถูกต้อง, ยืนยัน Pallet เมื่อสแกนครบ
  private handleScannedCode(code: string): void {
    const parsed = this.parseScanCode(code);
    if (!parsed) return;

    //  จับด้วยโค้ดเต็มของถุงก่อนเสมอ (ไม่ใช่ palletId อย่างเดียว เพราะ palletId ซ้ำข้าม grade/lot ได้)
    //  ไม่เจอ -> fallback จับด้วย grade/lot + เลขท้ายโค้ด (palletId) แทน เผื่อเป็นการสแกนถุงคนละใบของ pallet เดิม
    //  เพื่อ "เลือก" ใบที่ verify ไปแล้วแต่ยังไม่ได้เลือก (เช่นถูกยกเลิกเลือกเพราะ location ไม่พอ) โดยคนขับจำไม่ได้ว่า
    //  ตอน verify ใช้ถุงใบไหน (ดู findPendingPalletByRunningNumber)
    const alreadyVerified =
      this._palletToPlaceList.find((p) => this.scanLogic.palletHasCode(p, code))
      ?? this.scanLogic.findPendingPalletByRunningNumber(this._palletToPlaceList, code);

    if (alreadyVerified) {
      if (alreadyVerified.isSelectedForPlacement) {
        //  สแกนซ้ำใบที่เลือกไว้แล้ว -> แค่เตือนให้รู้ตัว ไม่ยกเลิกการเลือก (ยกเลิกจริงใช้ปุ่มลบ)
        this.SweetAlert('warning', `เลือกพาเลทหมายเลข ${alreadyVerified.id} ไว้แล้ว กรุณาสแกน Location ปลายทางเพื่อวาง หรือกดปุ่มลบถ้าต้องการยกเลิก`);
        return;
      }
      this.handleSelectPalletByIdScan(alreadyVerified);
      return;
    }

    //  เช็คว่าถุงนี้ (โค้ดเต็ม) ซ้ำ/ถูกใช้ไปแล้วหรือไม่ (รอ Location ต้นทาง/จัดวางเสร็จสิ้นไปแล้ว) -> ต้องเช็คก่อน
    //  resolveItemForScan เสมอ (ย้ายขึ้นมาจากเดิมที่เช็คทีหลัง) เพราะ resolveItemForScan เช็คแค่โควต้ารวมของ grade/lot
    //  แบบกว้างๆ (complete_qty + รอวาง + รอ location ต้นทาง เทียบ total_qty) ถ้าพาเลทใบที่สแกนนี้เองเป็นใบที่ทำให้ครบ
    //  โควต้าพอดี (เช่นเพิ่งถูกจัดวางไปแล้วจริง แต่เครื่องนี้เพิ่งรู้จาก auto-refresh) resolveItemForScan จะ error
    //  "ครบจำนวนแล้ว" แบบทั่วไปก่อน ไม่มีทางไหลมาถึงข้อความเจาะจงตรงนี้เลย (เจอจริง: สแกนพาเลทที่มีใน complete_pallet
    //  อยู่แล้ว ไม่ขึ้นข้อความ "จัดวางเสร็จสิ้นไปแล้ว" ตามที่ควรจะเป็น) ไม่ต้องรอ matchedItem เพราะฟังก์ชันนี้ไม่ได้ใช้เลย
    const conflict = this.scanLogic.checkPalletIdConflict(code, this._jobDataRaw, this._sessionPalletLists);
    if (conflict) {
      this.SweetAlert(conflict.icon, conflict.message);
      return;
    }

    //  งาน 2-step (is_multi_fl = 'Y') + โหมด Put -> ห้ามรับ Pallet ใหม่ ต้องกดปุ่ม Get ก่อน
    if (this._isMultiStep && this._scanAction === 'put') {
      this.SweetAlert('warning', 'งานนี้แยกขั้นตอน Get และ Put กรุณากลับไปกดปุ่ม Get ที่หน้ารายการงานเพื่อรับพาเลทใหม่ก่อน');
      return;
    }

    //  โค้ดถุง 5/6 ส่วนเสมอ (parseScanCode ผ่านแล้วด้านบน) -> isBagCode = true เปิดรอบ 2 เทียบ grade ที่ตัด (…) ออก ตอนหา item
    //  (ดู gradeWithoutParen ใน ScanPalletLogicService)
    const { item: matchedItem, errorMessage: resolveError } = this.scanLogic.resolveItemForScan(
      parsed, this._jobDataRaw, this._currentGroup, this._sessionPalletLists, true,
    );
    if (!matchedItem) {
      if (resolveError) this.SweetAlert('error', resolveError);
      return;
    }

    //  BUG FIX: กัน Get เกินโควต้าจริงของ Location ต้นทาง (แยกจาก item-level check ที่มีอยู่เดิม)
    const quota = this.scanLogic.checkFromLocationQuota(matchedItem, parsed.lot, this._sessionPalletLists);
    if (quota && quota.remaining <= 0) {
      this.SweetAlert(
        'error',
        `Location ต้นทาง "${this.formatLocationDisplay(quota.location.location_name)}" (Lot: ${parsed.lot}) ถูก Get ครบจำนวนแล้ว (${quota.location.total_qty} พาเลท) ไม่สามารถสแกนเพิ่มได้`,
      );
      return;
    }

    //  ตรวจกลุ่มที่กำลังสแกนอยู่ (Grade/Lot เดียวกัน + Pallet ID เดียวกัน)
    if (!this._currentGroup) {
      this._currentGroup = {
        key: `${parsed.grade}|${parsed.lot}`,
        palletId: parsed.palletId,
        itemId: matchedItem.id,
        runningNos: new Set(),
        codes: new Set(),
        lastScanAt: Date.now(),
      };
      //  scan_qty อยู่ระดับ item แล้ว (แต่ละ grade ในงานเดียวกันสแกนจำนวนถุงไม่เท่ากันได้) -> resolve ใหม่ทุกครั้งที่
      //  เริ่มกลุ่มสแกนของ item ไหน (ไม่มีค่ามา fallback ใช้ logic เดิม)
      const itemScanQty = matchedItem.scan_qty;
      this.initBagCheckList(itemScanQty != null ? itemScanQty : (this._isOutbound || this._isManualPalletJob ? 1 : 3));
      //  บังคับ re-render แถว checkbox ทันที (ค่าจริงใน _bagCheckList เปลี่ยนถูกต้องแล้ว แต่ Angular ไม่ trigger
      //  change detection ให้เองเสมอไปในจุดนี้ ไม่งั้นจำนวนกล่องที่โชว์จะค้างของ item ก่อนหน้าจนกว่าจะมี event อื่นมาสะกิด)
      this.cdr.detectChanges();
    }

    if (this._currentGroup.key !== `${parsed.grade}|${parsed.lot}`) {
      this.SweetAlert('error', 'กรุณาสแกนพาเลทเดิม (เกรด/ล๊อตเดิม) ให้ครบก่อนเปลี่ยนพาเลท');
      return;
    }

    if (this._currentGroup.palletId !== parsed.palletId) {
      this.SweetAlert('error', 'พาเลท ID ไม่ตรงกับที่กำลังสแกนอยู่');
      return;
    }

    //  เช็คถุงซ้ำเป็นลำดับสุดท้าย (นับจำนวนถุงต่อ Pallet) -> จับด้วยโค้ดเต็มของถุง ไม่ใช่ Running No. อย่างเดียว
    //  (runningNos เก็บไว้แสดงผลในข้อความแจ้งเตือนเท่านั้น)
    if (this._currentGroup.codes.has(code)) {
      this.SweetAlert('error', '', this.buildDuplicateRunningNoHtml(parsed, this._currentGroup.runningNos));
      return;
    }

    //  ถุงตั้งแต่ใบที่ 2 ของกลุ่มเป็นต้นไป -> เช็คว่าห่างจากถุงก่อนหน้าเร็วผิดปกติไหม (ใบแรกของกลุ่มไม่มีใบก่อนหน้าให้เทียบ ข้ามเช็ค)
    if (this._currentGroup.codes.size > 0 && Date.now() - this._currentGroup.lastScanAt < this.scanLogic.MIN_BAG_SCAN_INTERVAL_MS) {
      this.SweetAlert('warning', 'สแกนเร็วเกินไป กรุณาตรวจสอบว่าเป็นถุงจริงอีกใบ แล้วสแกนใหม่อีกครั้ง');
      return;
    }

    this._currentGroup.codes.add(code);
    this._currentGroup.runningNos.add(parsed.runningNo);
    this._currentGroup.lastScanAt = Date.now();

    const nextIndex = this._bagCheckList.findIndex((checked) => !checked);
    if (nextIndex === -1) return;

    this._bagCheckList[nextIndex] = true;
    this.showScanSuccessToast('ยิงถุงสำเร็จ', {
      cc: parsed.costCenter,
      grade: parsed.grade,
      lot: parsed.lot,
      bagNo: parsed.runningNo,
      //  โชว์เลขดิบจาก QR ตรงๆ (เช่น "001") ไม่ใช่ parsed.palletId ที่ parseScanCode ตัดเลขศูนย์หน้าออกไปแล้ว
      palletNo: this.deriveRawPalletNo(code) ?? parsed.palletId,
      //  ถุงปกตินับทีละใบ ไม่รู้น้ำหนักรวมจนกว่าจะครบ Pallet -> ไม่มีให้โชว์ตอนนี้ (เป็น "-")
    }, this._isOutbound);

    const scannedCount = this._bagCheckList.filter(Boolean).length;
    if (scannedCount >= this._bagRequiredCount) {
      if (this._isOutbound) {
        const bagCodes = Array.from(this._currentGroup?.codes ?? [code]);
        const reservation = this.createOutboundVerificationReservation(parsed, matchedItem, code, bagCodes);
        this._outboundVerificationPallets.push(reservation);
        this.resetCurrentGroup();
        this.initBagCheckList(this._bagRequiredCount);
        setTimeout(() => this.completePalletVerification(parsed, matchedItem, code, bagCodes, reservation), 2000);
      } else {
        //  Inbound: ไม่มี modal ตอน Get สำเร็จอีกแล้ว (ข้ามไปเข้าคิว Get เลย) -> ยิงทันที ไม่ต้องรอ toast ปิด
        setTimeout(() => this.completePalletVerification(parsed, matchedItem, code), this._isInboundJob ? 0 : 2000);
      }
    }
  }

  //  แจ้งผลสแกนสำเร็จแบบสั้น (ยังไม่ใช่ตอน Get/Put ครบ Pallet จริง) ใช้ร่วมกันทั้ง 3 ฟอร์แมต (ถุงปกติ/manual Pallet/Jumbo Bag)
  //  title ต่างกันตามฟอร์แมตที่สแกน (ให้คนขับรู้ทันทีว่าระบบจับเป็นฟอร์แมตไหน) ส่วน field เป็นชุดเดียวกันหมดทุกฟอร์แมต
  //  (CC/เกรด/ล๊อต/ถุงที่/ตันที่/จำนวน) ฟอร์แมตไหนไม่มีค่าจริง (เช่น manual Pallet ไม่มี CC/ถุงที่/ตันที่ เพราะโค้ด PL
  //  ไม่มี segment พวกนี้แยกจริงๆ) ก็ปล่อย undefined ไป โชว์ "-" แทนเอง ปิดเองใน 1.5 วิ (เล็กกว่า modal ตอน Get/Put สำเร็จ)
  private showScanSuccessToast(
    title: string,
    fields: { cc?: string; grade: string; lot: string; bagNo?: string; palletNo?: string | null; qty?: number },
    nonBlocking = false,
  ): void {
    const field = (label: string, value: string | number | null | undefined) => `
      <div style="display:flex;justify-content:space-between;gap:20px;padding:9px 0;font-size:26px;">
        <span style="color:#6b7280;font-weight:600;">${label} :</span>
        <strong style="color:#111827;">${value ?? '-'}</strong>
      </div>`;

    Swal.fire({
      toast: nonBlocking,
      position: nonBlocking ? 'top-end' : 'center',
      icon: 'success',
      title,
      html: `
        <div style="text-align:left;max-width:340px;margin:0 auto;padding:8px 0;">
          ${field('CC', fields.cc)}
          ${field('เกรด', fields.grade)}
          ${field('ล๊อต', fields.lot)}
          ${field('ถุงที่', fields.bagNo)}
          ${field('ตันที่', fields.palletNo)}
          ${field('จำนวน', fields.qty)}
        </div>`,
      width: 520,
      showConfirmButton: !nonBlocking,
      confirmButtonText: 'OK',
      timer: 1500,
      timerProgressBar: true,
    });
  }

  //  โค้ด "เอาทั้ง pallet" พิเศษ (ขึ้นต้น PL) -> ยืนยัน pallet ทั้งใบจากสแกนครั้งเดียว ไม่ต้องนับ BAG_REQUIRED_COUNT ถุงเหมือนโค้ดปกติ
  //  qty มาให้ตรงๆ ในโค้ดเลย ไม่ต้องยิง GetProcessPallet หาน้ำหนักจริงเพิ่ม -> เรียก proceedCompletePallet ตรงๆ
  //  ใช้ palletId = rawCode ("PL...") แทน pallet id ตัวเลขปกติ เพื่อ reuse resolveItemForScan/checkFromLocationQuota/checkPalletIdConflict ชุดเดิมได้ทั้งหมด
  //  (แค่ตอนแสดงผล/เทียบ item เท่านั้น -> code เต็มที่สแกนได้ ("PL...|grade|lot|qty") ต่างหากที่ใช้ยิง Get/Put จริง)
  private handleFullPalletScan(parsed: FullPalletScanCode, code: string): void {
    const syntheticParsed: ParsedScanCode = {
      costCenter: '',
      grade: parsed.grade,
      lot: parsed.lot,
      runningNo: '',
      palletId: parsed.rawCode,
    };

    //  โค้ด PL: pallet.qrCode = code เต็ม ("PL...|grade|lot|qty") เหมือนกันหมดทั้งตอนสแกนสดและหลัง reload -> จับด้วยโค้ดเต็ม
    const alreadyVerified = this._palletToPlaceList.find((p) => this.scanLogic.palletHasCode(p, code));
    if (alreadyVerified) {
      if (alreadyVerified.isSelectedForPlacement) {
        this.SweetAlert('warning', `เลือกพาเลท id: ${alreadyVerified.id} ไว้แล้ว กรุณาสแกน Location ปลายทางเพื่อวาง หรือกดปุ่มลบถ้าต้องการยกเลิก`);
        return;
      }
      this.handleSelectPalletByIdScan(alreadyVerified);
      return;
    }

    if (this._isMultiStep && this._scanAction === 'put') {
      this.SweetAlert('warning', 'งานนี้แยกขั้นตอน Get และ Put กรุณากลับไปกดปุ่ม Get ที่หน้ารายการงานเพื่อรับพาเลทใหม่ก่อน');
      return;
    }

    const { item: matchedItem, errorMessage: resolveError } = this.scanLogic.resolveItemForScan(
      syntheticParsed, this._jobDataRaw, null, this._sessionPalletLists,
    );
    if (!matchedItem) {
      if (resolveError) this.SweetAlert('error', resolveError);
      return;
    }

    const quota = this.scanLogic.checkFromLocationQuota(matchedItem, syntheticParsed.lot, this._sessionPalletLists);
    if (quota && quota.remaining <= 0) {
      this.SweetAlert(
        'error',
        `Location ต้นทาง "${this.formatLocationDisplay(quota.location.location_name)}" (Lot: ${syntheticParsed.lot}) ถูก Get ครบจำนวนแล้ว (${quota.location.total_qty} พาเลท) ไม่สามารถสแกนเพิ่มได้`,
      );
      return;
    }

    const conflict = this.scanLogic.checkPalletIdConflict(code, this._jobDataRaw, this._sessionPalletLists);
    if (conflict) {
      this.SweetAlert(conflict.icon, conflict.message);
      return;
    }

    //  โค้ด PL ไม่มี CC/ถุงที่/ตันที่แยกจริงๆ (โครงสร้างแค่ rawCode|grade|lot|qty) -> ปล่อย undefined ไปตั้งใจ โชว์ "-"
    this.showScanSuccessToast('ยิงใบแปะพาเลทสำเร็จ', { grade: parsed.grade, lot: parsed.lot, qty: parsed.qty });

    //  qrCode ส่ง code เต็ม ("PLM...|grade|lot|qty") ตามที่เปลี่ยนให้ backend ไม่ใช่แค่ rawCode เฉยๆ เหมือนเดิมอีกต่อไป
    //  Inbound: ไม่มี modal ตอน Get สำเร็จแล้ว -> ยิงทันที   Outbound: ยังรอ toast ปิดก่อน (1.5 วิ) กัน modal ทับกัน
    setTimeout(() => this.proceedCompletePallet(syntheticParsed, matchedItem, parsed.qty, code), this._isInboundJob ? 0 : 2000);
  }

  //  โค้ด Jumbo Bag (costCenter|grade|lot|runningNo|palletId|qty|type, 7 ส่วน) -> ยืนยัน pallet ทั้งใบจากสแกนครั้งเดียว
  //  เหมือนโค้ด PL (มี qty ฝังมาในโค้ดแล้ว ไม่ต้องยิง GetProcessPallet หาน้ำหนักจริงเพิ่ม) แต่ parsed เป็น ParsedScanCode
  //  จริงๆ (มี costCenter/runningNo/palletId แยกเหมือนถุงปกติ ไม่ใช่ rawCode รวมแบบ PL) เลย reuse
  //  palletHasCode/findPendingPalletByRunningNumber/resolveItemForScan/checkFromLocationQuota/checkPalletIdConflict
  //  ได้ตรงๆ เหมือนถุงปกติทุกอย่าง ต่างแค่ข้าม completePalletVerification ไปเรียก proceedCompletePallet ตรงๆ เลย
  private handleJumboBagScan(parsed: JumboBagScanCode, code: string): void {
    const alreadyVerified =
      this._palletToPlaceList.find((p) => this.scanLogic.palletHasCode(p, code))
      ?? this.scanLogic.findPendingPalletByRunningNumber(this._palletToPlaceList, code);

    if (alreadyVerified) {
      if (alreadyVerified.isSelectedForPlacement) {
        this.SweetAlert('warning', `เลือกพาเลทหมายเลข ${alreadyVerified.id} ไว้แล้ว กรุณาสแกน Location ปลายทางเพื่อวาง หรือกดปุ่มลบถ้าต้องการยกเลิก`);
        return;
      }
      this.handleSelectPalletByIdScan(alreadyVerified);
      return;
    }

    if (this._isMultiStep && this._scanAction === 'put') {
      this.SweetAlert('warning', 'งานนี้แยกขั้นตอน Get และ Put กรุณากลับไปกดปุ่ม Get ที่หน้ารายการงานเพื่อรับพาเลทใหม่ก่อน');
      return;
    }

    //  งาน RQ/Transfer WH/IT เท่านั้น: 1 งานใช้ pallet format เดียวตลอด (ยืนยันแล้ว) -> ถ้างานนี้เคยสแกนเป็นแบบปกติไปแล้ว ห้ามปนโค้ด Jumbo Bag เข้ามา
    if ((this._isAutoSpecialJob) && this._requestJobPalletFormat === 'normal') {
      this.SweetAlert('error', 'งานนี้เริ่มสแกนด้วยพาเลทแบบปกติไปแล้ว ไม่สามารถสแกนโค้ด Jumbo Bag ปนเข้ามาได้ กรุณาตรวจสอบ QR Code');
      return;
    }

    //  grade ที่ฝังมาในโค้ด Jumbo Bag อาจมีคำนำหน้า "GRADE " หรือมีส่วนต่อท้าย "/900" ที่ item จริงในงานไม่ได้เขียนตรงกันเป๊ะ
    //  -> หา grade เต็มของ item ที่ตรงกัน (เทียบแบบตัดคำนำหน้า/ส่วนท้ายออกก่อน) มาแทนที่ก่อนส่งเข้า resolveItemForScan
    //  (ที่เทียบแบบตรงตัวทั้งสตริง) ไม่งั้นจะหา item ไม่เจอ -> ไม่แตะ parsed.grade ดิบ/qrCode ที่จะส่งไป Get/Put เลย
    const resolvedGrade = this.scanLogic.resolveJumboBagItemGrade(parsed.grade, this._jobDataRaw?.items ?? []);
    const gradeMatchedParsed: JumboBagScanCode = resolvedGrade ? { ...parsed, grade: resolvedGrade } : parsed;

    //  งาน RQ/Transfer WH: total_qty ของ item/location วัดเป็นน้ำหนัก (กก.) ไม่ใช่จำนวนใบ เหมือนงาน Special -> ต้องเช็ค
    //  remaining/quota แบบเดียวกับที่ handleSpecialScannedCode ใช้ (นับน้ำหนักสะสม) ไม่ใช่แบบนับจำนวนใบของงานปกติ
    const { item: matchedItem, errorMessage: resolveError, remaining: itemRemaining } = this._isAutoSpecialJob
      ? this.scanLogic.resolveSpecialItemForScan(gradeMatchedParsed, this._jobDataRaw)
      : { ...this.scanLogic.resolveItemForScan(gradeMatchedParsed, this._jobDataRaw, null, this._sessionPalletLists), remaining: Infinity };
    if (!matchedItem) {
      if (resolveError) this.SweetAlert('error', resolveError);
      return;
    }

    if (this._isAutoSpecialJob) {
      const quota = this.scanLogic.checkSpecialFromLocationQuota(matchedItem, parsed.lot, itemRemaining, this._sessionPalletLists);
      if (quota.remaining <= 0) {
        this.SweetAlert(
          'error',
          `Location ต้นทาง "${this.formatLocationDisplay(quota.location?.location_name) || '-'}" (Lot: ${parsed.lot}) ถูก Get ครบจำนวนแล้ว ไม่สามารถสแกนเพิ่มได้`,
        );
        return;
      }
      if (!quota.location?.location_name) {
        this.SweetAlert('error', 'ไม่พบ Location ต้นทางของเกรด/ล๊อตนี้ กรุณาตรวจสอบข้อมูลงาน');
        return;
      }

      const conflict = this.scanLogic.checkPalletIdConflict(code, this._jobDataRaw, this._sessionPalletLists);
      if (conflict) {
        this.SweetAlert(conflict.icon, conflict.message);
        return;
      }

      //  กันสแกน Jumbo ใบเดียวกันซ้ำก่อนสแกน Location ต้นทางยืนยัน (checkPalletIdConflict ไม่รวม _specialAwaitingSourceLocation)
      //  เหมือน alreadyAwaitingPl ของโค้ด PL ไม่งั้นขึ้นพาเลทสีม่วงซ้ำ 2 ใบโดยไม่เตือนอะไรเลย
      if (this._specialAwaitingSourceLocation.some((e) => this.scanLogic.qrCodesMatch(e.code, code))) {
        this.SweetAlert('warning', `พาเลทใบนี้รอสแกน Location ต้นทางอยู่แล้ว กรุณาสแกน Location ต้นทาง "${this.specialSourceLocationText(matchedItem, quota.location.location_name)}" เพื่อยืนยัน`);
        return;
      }

      //  ผ่านทุกเงื่อนไขแล้ว ถือว่าสแกนนี้ถูกต้องแน่นอน -> ล็อค format ของงานนี้เป็น Jumbo Bag (เผื่อยังไม่เคยมีมาก่อน)
      this._requestJobPalletFormat = 'jumbo';

      //  Jumbo Bag บนงาน RQ: qty ฝังมาในโค้ดอยู่แล้ว เหมือน "Full Pallet" shortcut ของ Special (ไม่ต้องยิง GetProcessPallet
      //  ถามซ้ำว่าเอาเต็ม pallet ไหมเหมือนถุงปกติ เพราะรูปแบบโค้ดเองก็ฟันธงอยู่แล้วว่าใช่)
      //  ถ้ามีกล่องที่ active อยู่แล้ว (ผู้ใช้กด Add Pallet/เลือก card ไว้เอง) -> เข้ากล่องนั้นเลย เหมือนถุงปกติที่สแกนตอนนี้
      //  (queueSpecialAwaitingSourceLocation ก็ใช้ _specialActiveSeq เดียวกัน) ไม่สร้างกล่องใหม่ซ้อนทับความตั้งใจของผู้ใช้
      //  ถ้าไม่มีกล่อง active (สแกน Jumbo ตรงๆ ไม่ผ่านปุ่ม Add Pallet) -> auto เปิดกล่องใหม่ของตัวเอง ไม่ set
      //  _specialActiveSeq ตาม เพราะ Jumbo แต่ละใบคือคนละ pallet จริงอยู่แล้ว ไม่ควรรวมกับ Jumbo ใบถัดไปที่สแกนเข้ามาอีก
      //  ต้องสร้าง entry ใน _specialOpenPallets ก่อนเสมอถ้าเป็นกล่องใหม่ (เหมือน onClickAddSpecialPallet ทำก่อนเริ่มสแกน)
      //  ไม่งั้น buildSpecialPalletDisplayRows หา group ของ seq นี้ไม่เจอ การ์ด/label "รอสแกน Location" เลยไม่ขึ้นที่ไหนเลย
      let seq: number;
      let autoReady = false;
      if (this._specialActiveSeq !== null) {
        seq = this._specialActiveSeq;
      } else {
        seq = this.claimNextSpecialSeq();
        this._specialOpenPallets = [...this._specialOpenPallets, { seq, entries: [] }];
        autoReady = true;
      }
      this._specialAwaitingSourceLocation.push({
        code,
        parsed: gradeMatchedParsed,
        item: matchedItem,
        remaining: quota.remaining,
        sourceLocation: quota.location.location_name,
        isFullPallet: true,
        fullPalletRecord: { qty: parsed.qty, pallet_no: parsed.palletId, id: parsed.palletId },
        autoReady,
        palletSeq: seq,
      });
      this.saveJobDataToSession();

      this.SweetAlert('success', `ยืนยันถุงสำเร็จ กรุณาสแกน Location ต้นทาง "${this.specialSourceLocationText(matchedItem, quota.location.location_name, parsed.qty)}" เพื่อยืนยัน`);
      return;
    }

    const quota = this.scanLogic.checkFromLocationQuota(matchedItem, parsed.lot, this._sessionPalletLists);
    if (quota && quota.remaining <= 0) {
      this.SweetAlert(
        'error',
        `Location ต้นทาง "${this.formatLocationDisplay(quota.location.location_name)}" (Lot: ${parsed.lot}) ถูก Get ครบจำนวนแล้ว (${quota.location.total_qty} พาเลท) ไม่สามารถสแกนเพิ่มได้`,
      );
      return;
    }

    const conflict = this.scanLogic.checkPalletIdConflict(code, this._jobDataRaw, this._sessionPalletLists);
    if (conflict) {
      this.SweetAlert(conflict.icon, conflict.message);
      return;
    }

    //  Jumbo Bag ไม่ผ่าน _currentGroup/_bagCheckList เลย (จบในสแกนเดียว) แต่ยัง sync label/checkbox ให้โชว์ "1"
    //  ไว้ด้วยเสมอ กัน UI ค้างเลขของ item ก่อนหน้า (เช่น 3 จากถุงปกติ) ทั้งที่ item นี้ไม่เกี่ยวกับการนับถุงเลย
    this.initBagCheckList(1);
    this.cdr.detectChanges();

    //  โค้ด Jumbo มี CC/ถุงที่/ตันที่ ครบเหมือนถุงปกติจริง (แค่มี qty/type ต่อท้ายเพิ่ม) -> โชว์ครบ ไม่ตัดอะไรออก
    //  ไม่เอา "ประเภท" (JB1/JB2 ตัวสุดท้ายของโค้ด) มาโชว์ด้วยตามที่ตกลงกัน
    this.showScanSuccessToast('ยิงถุง Jumbo Bag สำเร็จ', {
      cc: parsed.costCenter,
      grade: parsed.grade,
      lot: parsed.lot,
      bagNo: parsed.runningNo,
      palletNo: this.deriveRawPalletNo(code) ?? parsed.palletId,
      qty: parsed.qty,
    });

    //  qty มาให้ตรงๆ ในโค้ดเลย ไม่ต้องยิง GetProcessPallet หาน้ำหนักจริงเพิ่มเหมือนถุงปกติ (completePalletVerification)
    //  ส่ง parsed เดิม (ไม่ใช่ gradeMatchedParsed) ต่อจากนี้ -> newPallet.grade โชว์ grade เต็มจาก matchedItem.grade อยู่แล้ว
    //  (ดู proceedCompletePallet) ส่วน qrCode/code ที่ส่งไป Get/Put ก็เป็นค่าที่สแกนมาทั้งสตริงเดิมเสมอ ไม่เกี่ยวกับ grade ที่ clean แล้ว
    //  Inbound: ไม่มี modal ตอน Get สำเร็จแล้ว -> ยิงทันที   Outbound: ยังรอ toast ปิดก่อน (1.5 วิ) กัน modal ทับกัน
    setTimeout(() => this.proceedCompletePallet(parsed, matchedItem, parsed.qty, code), this._isInboundJob ? 0 : 2000);
  }

  //  หา entry ใน pallet_manual (item ไหนก็ได้) ที่ scanned_qr_code ตรงกับโค้ดที่สแกนได้เป๊ะๆ ไม่สนรูปร่างโค้ด
  //  งาน IT บางงานมี pallet_assigned ปนกันทั้งโค้ด PL (4 ส่วน) และโค้ดถุงปกติ (5 ส่วน) ในรายการเดียวกัน
  private findManualManifestMatch(code: string): { item: any; entry: any } | null {
    const target = code.trim();
    const items = this._jobDataRaw?.items ?? [];
    for (const item of items) {
      const entry = (item?.pallet_manual ?? []).find((m: any) => String(m?.scanned_qr_code ?? '').trim() === target);
      if (entry) return { item, entry };
    }
    return null;
  }

  //  งาน manifest: เจอโค้ดที่ตรงกับ entry ที่รู้จักไว้ล่วงหน้าแล้ว (findManualManifestMatch) -> จบพาเลทในสแกนเดียวเสมอ
  //  ใช้ grade/lot/qty จาก entry เอง ไม่ต้อง parse โครงสร้างโค้ด (โค้ดถุงปกติ 5 ส่วนไม่มี qty ฝังอยู่ด้วยซ้ำ)
  private handleManifestPalletScan(item: any, entry: any, code: string): void {
    const alreadyVerified = this._palletToPlaceList.find((p) => this.scanLogic.palletHasCode(p, code));
    if (alreadyVerified) {
      if (alreadyVerified.isSelectedForPlacement) {
        this.SweetAlert('warning', `เลือกพาเลท id: ${alreadyVerified.id} ไว้แล้ว กรุณาสแกน Location ปลายทางเพื่อวาง หรือกดปุ่มลบถ้าต้องการยกเลิก`);
        return;
      }
      this.handleSelectPalletByIdScan(alreadyVerified);
      return;
    }

    if (this._isMultiStep && this._scanAction === 'put') {
      this.SweetAlert('warning', 'งานนี้แยกขั้นตอน Get และ Put กรุณากลับไปกดปุ่ม Get ที่หน้ารายการงานเพื่อรับพาเลทใหม่ก่อน');
      return;
    }

    const grade = this.scanLogic.fallback(entry.grade ?? item.grade);
    const lot = String(entry.lot ?? '').trim();
    const qty = Number(entry.qty) || 0;

    const displayId = this.deriveShortDisplayId(code);

    const syntheticParsed: ParsedScanCode = {
      costCenter: '',
      grade,
      lot,
      runningNo: '',
      palletId: displayId,
    };

    const quota = this.scanLogic.checkFromLocationQuota(item, lot, this._sessionPalletLists);
    if (quota && quota.remaining <= 0) {
      this.SweetAlert(
        'error',
        `Location ต้นทาง "${this.formatLocationDisplay(quota.location.location_name)}" (Lot: ${lot}) ถูก Get ครบจำนวนแล้ว (${quota.location.total_qty} พาเลท) ไม่สามารถสแกนเพิ่มได้`,
      );
      return;
    }

    const conflict = this.scanLogic.checkPalletIdConflict(code, this._jobDataRaw, this._sessionPalletLists);
    if (conflict) {
      this.SweetAlert(conflict.icon, conflict.message);
      return;
    }

    //  โค้ดที่ match manifest ได้ อาจเป็นได้ทั้ง 3 รูปแบบปน (ดูคอมเมนต์ findManualManifestMatch: งาน IT บางงานมีทั้งโค้ด PL
    //  และโค้ดถุงปกติใน pallet_assigned เดียวกัน) -> เช็ครูปร่างโค้ดจริงเพื่อเลือก title/field ให้ตรงแบบเดียวกับ
    //  handleFullPalletScan/handleJumboBagScan ไม่ใช่ "ยิงถุงสำเร็จ" เหมารวมเสมอเหมือนที่พลาดไปก่อนหน้านี้
    const plShape = this.scanLogic.parseFullPalletScanCode(code);
    const jumboShape = !plShape ? this.scanLogic.parseJumboBagScanCode(code) : null;

    if (plShape) {
      this.showScanSuccessToast('ยิงใบแปะพาเลทสำเร็จ', { grade, lot, qty });
    } else if (jumboShape) {
      this.showScanSuccessToast('ยิงถุง Jumbo Bag สำเร็จ', {
        cc: jumboShape.costCenter,
        grade,
        lot,
        bagNo: jumboShape.runningNo,
        palletNo: this.deriveRawPalletNo(code) ?? jumboShape.palletId,
        qty,
      });
    } else {
      const normalShape = this.parseScanCode(code);
      this.showScanSuccessToast('ยิงถุงสำเร็จ', {
        cc: normalShape?.costCenter,
        grade,
        lot,
        bagNo: normalShape?.runningNo,
        palletNo: this.deriveRawPalletNo(code) ?? normalShape?.palletId,
        qty,
      });
    }

    //  Inbound: ไม่มี modal ตอน Get สำเร็จแล้ว -> ยิงทันที   Outbound: ยังรอ toast ปิดก่อน (1.5 วิ) กัน modal ทับกัน
    setTimeout(() => this.proceedCompletePallet(syntheticParsed, item, qty, this.scanLogic.normalizeQrCode(code)), this._isInboundJob ? 0 : 2000);
  }

  //  งาน RQ/Transfer WH/IT เท่านั้น: โค้ด PL (4 ส่วน มี qty ฝังมา) อีกฟอร์แมตหนึ่งเหมือน Jumbo Bag เป๊ะ (ใช้ล็อค _requestJobPalletFormat
  //  ค่า 'jumbo' ร่วมกันเลย ไม่แยกเป็นฟอร์แมตที่ 3 เพราะพฤติกรรมเดียวกันทุกอย่าง: สแกนครั้งเดียวรู้ qty ครบ ไม่ต้องยิง
  //  GetProcessPallet ถาม ไม่ต้องเปิด modal นับถุง) แต่ item ของงานกลุ่มนี้วัดโควต้าเป็น กก. ไม่ใช่จำนวนใบแบบงานปกติ -> ต้องเข้า
  //  flow Special เต็มรูปแบบ (checkSpecialFromLocationQuota, กล่อง _specialOpenPallets, สแกน Location ต้นทางก่อน Get จริง)
  //  handleFullPalletScan เดิมเรียก proceedCompletePallet ตรงๆ ซึ่งเป็น flow งานปกติล้วนๆ ใช้กับงานกลุ่มนี้ไม่ได้
  private handleFullPalletScanForRequest(parsed: FullPalletScanCode): void {
    //  โค้ด PL: pallet.qrCode = rawCode เหมือนกันหมดทั้งตอนสแกนสดและหลัง reload -> จับด้วยโค้ด (rawCode) เหมือนงานปกติ
    const alreadyVerified = this._palletToPlaceList.find((p) => this.scanLogic.palletHasCode(p, parsed.rawCode));
    if (alreadyVerified) {
      if (alreadyVerified.isSelectedForPlacement) {
        this.SweetAlert('warning', `เลือกพาเลท Grade ${alreadyVerified.grade} ไว้แล้ว กรุณาสแกน Location ปลายทางเพื่อวาง`);
        return;
      }
      this.handleSelectPalletByIdScan(alreadyVerified);
      return;
    }

    if (this._isMultiStep && this._scanAction === 'put') {
      this.SweetAlert('warning', 'งานนี้แยกขั้นตอน Get และ Put กรุณากลับไปกดปุ่ม Get ที่หน้ารายการงานเพื่อรับพาเลทใหม่ก่อน');
      return;
    }

    //  งาน RQ/Transfer WH/IT เท่านั้น (ฟังก์ชันนี้ถูกเรียกเฉพาะ 3 งานนี้อยู่แล้ว): 1 งานใช้ pallet format เดียวตลอด -> ถ้างานนี้เคยสแกนเป็นแบบนับน้ำหนักสะสมไปแล้ว ห้ามปนโค้ด PL เข้ามา
    if (this._requestJobPalletFormat === 'normal') {
      this.SweetAlert('error', 'งานนี้เริ่มสแกนด้วยพาเลทแบบปกติไปแล้ว ไม่สามารถสแกนโค้ด PL ปนเข้ามาได้ กรุณาตรวจสอบ QR Code');
      return;
    }

    const syntheticParsed: ParsedScanCode = {
      costCenter: '',
      grade: parsed.grade,
      lot: parsed.lot,
      runningNo: '',
      palletId: parsed.rawCode,
    };

    const { item: matchedItem, errorMessage: resolveError, remaining: itemRemaining } =
      this.scanLogic.resolveSpecialItemForScan(syntheticParsed, this._jobDataRaw);
    if (!matchedItem) {
      if (resolveError) this.SweetAlert('error', resolveError);
      return;
    }

    const quota = this.scanLogic.checkSpecialFromLocationQuota(matchedItem, parsed.lot, itemRemaining, this._sessionPalletLists);
    if (quota.remaining <= 0) {
      this.SweetAlert(
        'error',
        `Location ต้นทาง "${this.formatLocationDisplay(quota.location?.location_name) || '-'}" (Lot: ${parsed.lot}) ถูก Get ครบจำนวนแล้ว ไม่สามารถสแกนเพิ่มได้`,
      );
      return;
    }
    if (!quota.location?.location_name) {
      this.SweetAlert('error', 'ไม่พบ Location ต้นทางของเกรด/ล๊อตนี้ กรุณาตรวจสอบข้อมูลงาน');
      return;
    }

    const conflict = this.scanLogic.checkPalletIdConflict(parsed.rawCode, this._jobDataRaw, this._sessionPalletLists);
    if (conflict) {
      this.SweetAlert(conflict.icon, conflict.message);
      return;
    }

    //  กันสแกนโค้ด PL ใบเดียวกันซ้ำก่อนสแกน Location ต้นทางยืนยัน (checkPalletIdConflict ด้านบนจับไม่ได้ เพราะเช็คจาก
    //  _sessionPalletLists ซึ่งไม่รวม _specialAwaitingSourceLocation เลย) ไม่งั้นจะเข้าคิวซ้ำ 2 entry พอสแกน Location ยิง Get
    //  พร้อมกันทั้งคู่ ใบที่สองจะ fail แล้วถูกคืนเข้าคิวเป็นกล่องม่วงรอสแกน Location อีกรอบ ทั้งที่เป็นพาเลทซ้ำยิงไงก็ไม่ผ่าน
    const alreadyAwaitingPl = this._specialAwaitingSourceLocation.some((e) => this.scanLogic.qrCodesMatch(e.code, parsed.rawCode));
    if (alreadyAwaitingPl) {
      this.SweetAlert('warning', `พาเลทใบนี้รอสแกน Location ต้นทางอยู่แล้ว กรุณาสแกน Location ต้นทาง "${this.specialSourceLocationText(matchedItem, quota.location.location_name)}" เพื่อยืนยัน`);
      return;
    }

    //  ผ่านทุกเงื่อนไขแล้ว ถือว่าสแกนนี้ถูกต้องแน่นอน -> ล็อค format ของงานนี้เป็น 'jumbo' (ร่วมกับ Jumbo Bag จริง)
    this._requestJobPalletFormat = 'jumbo';

    //  เหมือน Jumbo Bag ของ RQ: มีกล่อง active อยู่แล้วก็เข้ากล่องนั้น ไม่มีก็ auto เปิดกล่องใหม่ของตัวเอง (autoReady ปิด
    //  กล่องให้เองทันทีที่ Get สำเร็จ เพราะโค้ด PL ฟันธงมาแล้วว่า 1 โค้ด = 1 pallet จริง ไม่มีใครมาเติมถุงเพิ่มใส่กล่องนี้อีก)
    let seq: number;
    let autoReady = false;
    if (this._specialActiveSeq !== null) {
      seq = this._specialActiveSeq;
    } else {
      seq = this.claimNextSpecialSeq();
      this._specialOpenPallets = [...this._specialOpenPallets, { seq, entries: [] }];
      autoReady = true;
    }

    this._specialAwaitingSourceLocation.push({
      code: parsed.rawCode,
      parsed: syntheticParsed,
      item: matchedItem,
      remaining: quota.remaining,
      sourceLocation: quota.location.location_name,
      isFullPallet: true,
      fullPalletRecord: { qty: parsed.qty, pallet_no: parsed.rawCode, id: parsed.rawCode },
      autoReady,
      palletSeq: seq,
    });
    this.saveJobDataToSession();

    this.SweetAlert('success', `ยืนยันพาเลทสำเร็จ กรุณาสแกน Location ต้นทาง "${this.specialSourceLocationText(matchedItem, quota.location.location_name, parsed.qty)}" เพื่อยืนยัน`);
  }

  //  id สั้นๆ สำหรับ "แสดงผล" เท่านั้น (ไม่ใช้เทียบซ้ำ/ส่ง API) โค้ด PL ใช้ rawCode, โค้ดฟอร์แมตถุงปกติใช้เลข Pallet ตัวท้าย
  //  เหมือนถุงธรรมดาทั่วไป -> กันไม่ให้โค้ดเต็มยาวๆ (เช่น "1312|1126NK|230000001|01|001") ไปโผล่ในหน้าจอ
  private deriveShortDisplayId(code: string): string {
    return this.scanLogic.parseFullPalletScanCode(code)?.rawCode
      ?? this.parseScanCode(code)?.palletId
      ?? this.scanLogic.normalizeQrCode(code);
  }

  //  "Pallet No." ที่โชว์ผล -> ต้องเป็นเลขดิบจาก QR ตรงๆ ไม่ผ่าน parseScanCode/parseJumboBagScanCode ที่ normalize ด้วย
  //  Number() (เช่น "001" กลายเป็น "1") ใช้แค่แสดงผลจุดนี้เท่านั้น ไม่แตะ parser เดิม/field อื่นที่ใช้ยิง Get/Put/เทียบ conflict
  //  public เพราะ template เรียกตรงๆ ด้วย (list ฝั่งซ้าย "รอเอาไปวาง")
  deriveRawPalletNo(qrCode: string | null | undefined): string | null {
    if (!qrCode) return null;
    const pl = this.scanLogic.parseFullPalletScanCode(qrCode);
    if (pl) return pl.rawCode;
    const parts = qrCode.split('|').map((p) => p.trim());
    //  โค้ดปกติ (5 ส่วน), โค้ดใหม่มี dateTime ต่อท้าย (6 ส่วน) และ Jumbo Bag (7 ส่วน) เก็บเลข Pallet No. ไว้ตำแหน่งเดียวกัน (index 4)
    if (parts.length === 5 || parts.length === 6 || parts.length === 7) return parts[4] || null;
    return null;
  }

  //  งาน Special: หมายเลขพาเลทที่โชว์บนการ์ด (ยังไม่โชว์ raw id) จากโค้ดที่สแกนจริงหลายใบ -> ใช้ deriveRawPalletNo แบบเดียวกับ
  //  การ์ดงานปกติ (ตำแหน่งตาม format ของโค้ด ไม่ตัด 0 หน้า) ยกเว้นโค้ด PL ที่ flow special เก็บไว้แค่ rawCode ("PLM...")
  //  ไม่ใช่โค้ดเต็ม 4 ส่วน deriveRawPalletNo เลยคืน null แต่ rawCode นั้นคือเลขพาเลทอยู่แล้ว ถุงจากพาเลทต้นทางใบเดียวกัน
  //  ได้เลขเดียวกัน เลยรวมเหลือแต่ค่าที่ไม่ซ้ำ public เพราะการ์ดฝั่งซ้ายใน template เรียกตรงๆ
  specialPalletNos(codes: (string | null | undefined)[]): string {
    const nos = codes.map((c) => {
      const code = String(c ?? '').trim();
      return this.deriveRawPalletNo(code) ?? (code.startsWith('PL') ? code : null);
    });
    return Array.from(new Set(nos.filter((n): n is string => !!n))).join(', ');
  }

  //  เฉพาะ Inbound: ถ้า Location ปลายทางของ Pallet ที่กำลังจะเลือก ไม่ตรงกับ Location ปลายทางของ
  //  Pallet fixed (location เดียวแน่นอน) ที่เลือกไว้แล้ว -> ยกเลิกการเลือกทั้งหมด บังคับสแกนใหม่
  //  Pallet แบบ ambiguous (location ได้มากกว่า 1 ที่) ไม่ต้อง reset -> ปล่อยให้สะสมเลือกได้หลายใบเหมือนงาน
  //  1-step (autoSelectPalletsIfEligible/findUnfitAmbiguousGroup) เพราะยังไม่รู้จนกว่าจะสแกน Location จริงว่าจะไปที่ไหนกันแน่
  //  ให้ tryAutoAssignMultiLocationPallets ตอนสแกน Location เป็นคนเช็คโควต้าจริงแทน (ใช้ร่วมกับ 1-step อยู่แล้ว)
  private handleSelectPalletByIdScan(pallet: PalletToPlaceItem): void {
    if (this._isOutbound) {
      this.selectPalletForPlacement(pallet);
      return;
    }

    const isAmbiguous = pallet.targetLocations.length > 1;

    if (!isAmbiguous) {
      const pickingLocation = pallet.targetLocations[0]?.location ?? null;
      const hasFixedMismatch = this._selectedPalletsForPlacement.some(
        (p) => p.targetLocations.length === 1 && p.targetLocations[0].location !== pickingLocation,
      );

      if (hasFixedMismatch) {
        //  ยกเลิกการเลือกทั้งหมด (ไม่ใช่แค่ปฏิเสธใบใหม่) เพราะ location ไม่ตรงกันของทั้งกลุ่มแปลว่าการเลือกที่ผ่านมาน่าจะผิดพลาด
        //  ไปแล้ว ให้คนขับเริ่มสแกนเลือกใหม่ทั้งหมด ไม่เก็บใบเดิมที่อาจจะผิดไว้ครึ่งๆ กลางๆ
        this.deselectAllPallets();
        this.SweetAlert(
          'warning',
          `พาเลทหมายเลข ${pallet.id} มี Location ปลายทางไม่ตรงกับพาเลทที่เลือกไว้ ยกเลิกการเลือกทั้งหมด กรุณาสแกนเลือกใหม่`,
        );
        return;
      }
    }

    this.selectPalletForPlacement(pallet);
  }

  //  ยืนยัน Pallet สำเร็จหลังสแกนถุงครบ -> หา qty จริงก่อน แล้วแยก Flow ตาม Outbound/Inbound
  //  เตือนผู้ใช้ชัดๆ ถ้าดึงน้ำหนักจริงมาไม่ได้ไม่ว่ากรณีไหน (backend error, response status != success, หรือ
  //  success แต่ไม่เจอ record ของ pallet ใบนี้) -> fallback เป็น 0 เสมอ ห้ามใช้ matchedItem.qty (เป็น qty รวมทั้ง
  //  item/grade-lot ไม่ใช่น้ำหนักเฉพาะ pallet ใบนี้ ถ้าใช้จะเพี้ยนไปเป็นค่าเต็ม item) งานปกติ/IT ไม่ส่ง qty กลับไป
  //  backend ตอน Get/Put อยู่แล้ว (ใช้แค่แสดงผล + เช็คโควต้าน้ำหนักฝั่ง FE) 0 จึงปลอดภัยกว่าเดิมด้วย
  private createOutboundVerificationReservation(
    parsed: ParsedScanCode,
    matchedItem: any,
    code: string,
    bagCodes: string[],
  ): PalletToPlaceItem {
    const fromLocation = this.scanLogic.resolveFromLocationForItem(matchedItem, parsed.lot, this._sessionPalletLists);
    const hasManualManifest = Array.isArray(matchedItem?.pallet_manual) && matchedItem.pallet_manual.length > 0;
    const effectiveLotNo = this.scanLogic.fallback(hasManualManifest ? parsed.lot : (matchedItem.lot_no ?? parsed.lot));

    return {
      id: parsed.palletId,
      grade: this.scanLogic.fallback(matchedItem.grade),
      lotNo: effectiveLotNo,
      qty: 0,
      isActive: true,
      isChecked: true,
      isSelectedForPlacement: false,
      targetLocations: this.scanLogic.buildTargetLocations(matchedItem, effectiveLotNo),
      sourceLocation: this.scanLogic.fallback(fromLocation?.location_name),
      itemId: matchedItem.id,
      fromLocationId: fromLocation?.location_id,
      qrCode: code,
      bagCodes,
      costCenter: parsed.costCenter,
    };
  }

  private completePalletVerification(
    parsed: ParsedScanCode,
    matchedItem: any,
    code: string,
    bagCodes?: string[],
    reservation?: PalletToPlaceItem,
  ): void {
    const finish = (qty: number) => {
      if (reservation) {
        this._outboundVerificationPallets = this._outboundVerificationPallets.filter((p) => p !== reservation);
      }
      this.proceedCompletePallet(parsed, matchedItem, qty, code, bagCodes);
    };

    this.scanApi.getProcessPallet(parsed.palletId, parsed.grade, parsed.lot, code).subscribe({
      next: (res) => {
        if (res?.status !== 'success') {
          this.warnPalletQtyFallback(res?.message);
          finish(0);
          return;
        }

        const found = res?.data?.[0];
        if (found?.qty == null) {
          this.warnPalletQtyFallback();
          finish(0);
          return;
        }

        finish(found.qty);
      },
      error: () => {
        this.warnPalletQtyFallback();
        finish(0);
      },
    });
  }

  private warnPalletQtyFallback(backendMessage?: string): void {
    console.error('ดึงน้ำหนัก Pallet จริงไม่ได้:', backendMessage);
    this.SweetAlert(
      'warning',
      'ไม่สามารถดึงน้ำหนักพาเลทจริงได้ บันทึกน้ำหนักเป็น 0 กก. ไปก่อน กรุณาตรวจสอบน้ำหนักจริงอีกครั้งภายหลัง',
    );
  }

  //  ดำเนินการยืนยัน Pallet ต่อหลังได้ qty จริงมาแล้ว -> แยก Flow ตาม Outbound/Inbound
  //  resolve from_location ตาม lot ที่สแกนจริง (รองรับ addon_lot) แทนการ hardcode from_locations[0]
  //  และเก็บ lotNo เป็นค่าจริงจาก parsed.lot (lot ที่สแกนได้) แทน '-' เพื่อให้ตรวจสแกนซ้ำ/แสดงผลถูกต้อง
  private proceedCompletePallet(
    parsed: ParsedScanCode,
    matchedItem: any,
    qty: number,
    code: string,
    bagCodes?: string[],
  ): void {
    const fromLocation = this.scanLogic.resolveFromLocationForItem(matchedItem, parsed.lot, this._sessionPalletLists, this._isSpecialJob);
    //  item ที่มี pallet_manual (manifest คงที่ เช่น IT ที่มี pallet_assigned) -> lot_no ของ item เป็นแค่เลขเอกสาร/job
    //  ไม่ใช่ lot จริงของพาเลท -> เชื่อ lot ที่สแกนได้จริง (parsed.lot) ก่อนเสมอ ไม่ fallback ไปใช้ lot_no
    const hasManualManifest = Array.isArray(matchedItem?.pallet_manual) && matchedItem.pallet_manual.length > 0;
    const effectiveLotNo = this.scanLogic.fallback(hasManualManifest ? parsed.lot : (matchedItem.lot_no ?? parsed.lot));

    const newPallet: PalletToPlaceItem = {
      id: parsed.palletId,
      grade: this.scanLogic.fallback(matchedItem.grade),
      lotNo: effectiveLotNo,
      qty,
      isActive: true,
      isChecked: true,
      isSelectedForPlacement: false,
      targetLocations: this.scanLogic.buildTargetLocations(matchedItem, effectiveLotNo),
      sourceLocation: this._isOutbound ? this.scanLogic.fallback(fromLocation?.location_name) : undefined,
      itemId: matchedItem.id,
      fromLocationId: fromLocation?.location_id,
      costCenter: parsed.costCenter,
      //  โค้ด QR ของถุงใบล่าสุดที่สแกนตอนยืนยัน Pallet นี้ -> ส่งกลับไปเป็น qrCode ตอนยิง API Get
      //  (โค้ด PL: code ตรงนี้คือสตริงเต็ม "PLM...|grade|lot|qty" ตามที่ backend ต้องการ — ผู้เรียก handleFullPalletScan ส่งมาแบบนั้นแล้ว)
      qrCode: code,
      //  ทุกถุงที่สแกนยืนยัน Pallet นี้ (กลุ่มยังไม่ถูก reset ณ จุดนี้) -> สแกนถุงใบไหนซ้ำก็จับได้ว่าเป็น Pallet ใบนี้
      bagCodes: bagCodes ?? (this._currentGroup && this._currentGroup.palletId === parsed.palletId
        ? Array.from(this._currentGroup.codes)
        : [code]),
    };

    this._isOutbound
      ? this.completePalletOutbound(parsed, matchedItem, newPallet)
      : this.completePalletInbound(matchedItem, newPallet);
  }

  //  Outbound: ยืนยันถุงเสร็จ -> รอสแกน Location ต้นทางต่อ (ยังไม่ยิง API Get)
  private completePalletOutbound(parsed: ParsedScanCode, matchedItem: any, newPallet: PalletToPlaceItem): void {
    this._palletsAwaitingSourceLocation.push(newPallet);

    this._jobDataRaw.pallets ??= {};
    this._jobDataRaw.pallets.awaiting_source_pallet ??= [];
    //  เก็บ id เป็น string ดิบ (ไม่ Number()) เพราะ pallet.id ของโค้ด PL ("PLM...") ไม่ใช่ตัวเลข
    //  เก็บ scanned_qr_code + grade/lot ด้วย -> ตอนลบออกทีหลัง (isSamePalletRecord) จับด้วยโค้ด/grade-lot ได้ ไม่ลบผิดใบเมื่อ id ซ้ำข้าม lot
    this._jobDataRaw.pallets.awaiting_source_pallet.push({
      id: parsed.palletId,
      qty: newPallet.qty,
      grade: newPallet.grade,
      lot: newPallet.lotNo,
      scanned_qr_code: newPallet.qrCode,
    });

    matchedItem.awaiting_source_pallet = (matchedItem.awaiting_source_pallet ?? 0) + 1;

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: `ยืนยันพาเลท ${parsed.palletId} สำเร็จ`,
      text: 'สแกนพาเลทใบถัดไป หรือสแกน Location ต้นทางเมื่อพร้อม',
      showConfirmButton: false,
      timer: 2500,
      timerProgressBar: true,
    });

    this.saveJobDataToSession();
    this.refreshDisplayList();
    this.resetCurrentGroup();
    this.initBagCheckList(this._bagRequiredCount);
  }

  //  เรียกจาก proceedCompletePallet ทุกครั้งที่ _isOutbound === false (เส้นแบ่งเดิมของระบบ) ซึ่งครอบคลุมทั้ง Inbound
  //  จริง และ Picking/Shipping/Request ที่หลุดมาทาง Jumbo Bag format (_isOutbound เป็น false ได้เหมือนกัน ดู _isInboundJob
  //  getter) -> งานกลุ่มหลังนี้ยังไม่ได้รับการแก้ตามที่ขอ "เอาแค่งาน Inbound ก่อน" ต้องคง behavior เดิมไว้ (มี modal, ไม่เข้าคิว)
  //  reset group/bagCheckList ทันทีเสมอไม่ว่าจะเข้าเงื่อนไขไหน (สแกนพาเลทถัดไปต่อได้เลย ไม่ต้องรอ Get ใบนี้ตอบกลับ)
  private completePalletInbound(matchedItem: any, newPallet: PalletToPlaceItem): void {
    this.resetCurrentGroup();
    this.initBagCheckList(this._bagRequiredCount);

    this._isInboundJob
      //  Inbound จริง: Get จริงเข้าคิว _inboundGetQueue (เรียงลำดับตามที่สแกน ไม่ยิงซ้อนกันเอง), ไม่มี modal ตอนสำเร็จ
      ? this._inboundGetQueue = this._inboundGetQueue.then(() => this.runInboundGet(matchedItem, newPallet))
      //  Picking/Shipping/Request: ยิงทันทีแบบเดิม ไม่เข้าคิว + ยังโชว์ modal ตอนสำเร็จเหมือนเดิมทุกอย่าง
      : this.runInboundGet(matchedItem, newPallet, true);
  }

  //  ยิง Get จริงของ pallet 1 ใบ -> resolve เสมอไม่ว่าสำเร็จ/fail กันคิวค้าง (เรียกผ่านคิวสำหรับ Inbound จริงเท่านั้น
  //  งาน Picking/Shipping/Request เรียกตรงได้ ไม่ต้องเข้าคิว)
  //  ใช้ from_location ที่ผูกไว้กับ pallet นี้จริง (fromLocationId) แทนการ hardcode from_locations[0]
  //  เพื่อรองรับ item ที่มีหลาย addon_lot / หลาย location ต้นทางพร้อมกัน
  //  showModalOnSuccess: true เฉพาะงาน Picking/Shipping/Request (คง behavior เดิมไว้) — Inbound จริงไม่มี modal แล้ว
  //  ข้ามไปเพิ่มเข้า _palletToPlaceList เลย (เห็นผลจากการ์ด "รอเอาไปวาง" ทันที) ส่วน error ยังโชว์ modal เหมือนเดิมทุกงาน
  private runInboundGet(matchedItem: any, newPallet: PalletToPlaceItem, showModalOnSuccess = false): Promise<void> {
    return new Promise<void>((resolve) => {
      const fromLocation = this.scanLogic.resolveFromLocationByPallet(matchedItem, newPallet);

      //  งาน IT: endpoint /internal-transfer/get-pallet mirror จาก Special มาเป๊ะๆ ต้องการ qrCodes เป็น array + modeId/palletSeq
      //  ไม่ใช่ qrCode ตัวเดียวแบบงาน manual pallet ปกติ (modeId 1 = Full Pallet, ไม่มี palletSeq ให้ใช้ 0)
      //  ไม่ส่ง palletId แล้ว (ทุกงานปกติ) — endpoint จริงระบุ pallet ด้วย qrCode อย่างเดียว ไม่มี palletId ใน schema
      //  งานกลุ่ม kilo อื่น (RQ/Transfer WH/Picking, _isAutoSpecialJob) ก็ต้องส่ง modeId 1 (Full Pallet) เหมือน IT
      //  ด้วย (manifest pallet เป็นพาเลทเต็มที่รู้ล่วงหน้าอยู่แล้วเสมอ ไม่มี mode นับถุงให้เลือก) ไม่ใช่แค่ IT เท่านั้น
      //  ส่วน Inbound/Shipping ปกติ ไม่ใช่งานกลุ่ม kilo -> ไม่ส่ง modeId เหมือนเดิม
      const requestData: any = this._isInternalTransferJob
        ? {
          qrCodes: [newPallet.qrCode ?? ''],
          itemId: matchedItem.id,
          locationId: fromLocation?.location_id ?? 0,
          locationType: this._jobDataRaw?.from_location_type ?? '',
          palletSeq: 0,
          modeId: 1,
          updateBy: this._currentUserId,
        }
        : {
          itemId: matchedItem.id,
          locationId: fromLocation?.location_id ?? 0,
          locationType: this._jobDataRaw?.from_location_type ?? '',
          updateBy: this._currentUserId,
          //  ถุงใบล่าสุดที่สแกนตอนยืนยัน Pallet นี้
          qrCode: newPallet.qrCode ?? '',
          ...(this._isAutoSpecialJob ? { modeId: 1 } : {}),
        };

      this.runOrQueueJobApi('get', this._jobDataRaw.id, requestData, newPallet.qrCode ?? '').subscribe({
        next: () => {
          //  id จริงของ backend (ชุดเดียวกับที่ complete_pallet ใช้ตอนวางสำเร็จ เช่น 343) ไม่ใช่เลข assignment/เลขท้าย
          //  โค้ดที่ parse ได้เอง (เช่น pallet_manual[].id หรือ "001" ท้าย format โค้ดถุงปกติ คนละชุดเลขกัน โชว์แล้วไม่ตรงกับ
          //  ตอนเสร็จ) ไม่ต้องรอจนวางสำเร็จค่อยรู้ id จริง ดึงได้ตั้งแต่ตอน Get นี้เลยผ่าน GetProcessPallet:
          //  โค้ด PL (manifest) -> match ด้วย pallet_no (rawCode "PLA...") ตรงๆ
          //  โค้ดถุงปกติ -> match ด้วย pallet_id (เลขท้าย format โค้ด) เหมือนที่งาน Special ใช้อยู่แล้ว (scanApi.getProcessPallet)
          const backfillPalletId$ = newPallet.id?.startsWith('PL')
            ? this.crudService.GetProcessPallet(0, newPallet.id, matchedItem.grade, newPallet.lotNo, 0, 0, 0, newPallet.qrCode ?? '')
            : this.scanApi.getProcessPallet(newPallet.id ?? '', matchedItem.grade, newPallet.lotNo);

          backfillPalletId$.subscribe({
            next: (res: any) => {
              const found = res?.data?.[0];
              if (found?.id == null) return;
              newPallet.backendId = String(found.id);
              if (found.qty != null) newPallet.qty = found.qty;
              //  แทนที่ grade ชั่วคราวตอนสแกนสด (matchedItem.grade) ด้วย grade จริงของ record ที่เพิ่งยืนยันได้
              //  ให้ตรงกับ receive_pallet จริงเป๊ะ (เหมือนการ์ดสีเขียวที่ใช้ grade ของ record จริงอยู่แล้ว)
              if (found.grade) newPallet.grade = found.grade;
              this.refreshDisplayList();
            },
            error: () => { /* เงียบไว้ -> โชว์เลข/rawCode ที่สแกนได้ (p.id) แทนไปก่อน ไม่ใช่ error ที่ต้องรบกวนคนขับ */ },
          });

          //  กัน race กับ auto-fetch (refreshJobProgressFromServer ทุก 5 วิ): ถ้า response ของ auto-fetch กลับมาถึงก่อน
          //  ระหว่างที่ request get นี้ยังไม่ resolve -> มันจะเห็น record เดียวกันนี้จาก server เป็นของใหม่ (ตอนนั้น
          //  newPallet ยังไม่เข้า list ไหนเลย) แล้วเพิ่มเองไปแล้วหนึ่งรอบ ไม่ต้อง push ซ้ำอีกใบ
          const alreadyAddedByAutoFetch = this._palletToPlaceList.some((p) => this.scanLogic.palletHasCode(p, newPallet.qrCode ?? ''));
          if (!alreadyAddedByAutoFetch) this._palletToPlaceList.push(newPallet);
          this.autoSelectPalletsIfEligible();

          if (this._jobDataRaw.pallets?.receive_pallet) {
            this._jobDataRaw.pallets.receive_pallet = this._jobDataRaw.pallets.receive_pallet.filter(
              (p: any) => !this.scanLogic.isSamePalletRecord(p, newPallet),
            );
          }
          if (matchedItem.receive_qty > 0) matchedItem.receive_qty -= 1;

          //  Picking/Shipping/Request เท่านั้น (ดู showModalOnSuccess ที่เรียกมา) -> คง modal เดิมไว้ ไม่แตะ behavior
          if (showModalOnSuccess) {
            this.SweetAlert('success', '', this.buildBatchResultHtml('success', 'ตรวจสอบพาเลทสำเร็จ', this.formatPalletDetailRows([newPallet])));
          }

          this.saveJobDataToSession();
          this.refreshDisplayList();
          resolve();
        },
        error: (err) => {
          this.SweetAlert('error', this.apiErrorMessage(err, 'ไม่สามารถอัปเดต Get พาเลทได้ กรุณาสแกนถุงยืนยันพาเลทนี้ใหม่อีกครั้ง'));
          this.refreshDisplayList();
          resolve();
        },
      });
    });
  }

  private resetCurrentGroup(): void {
    this._currentGroup = null;
  }

  //  สร้าง HTML แสดงรายละเอียดถุงที่สแกนไปแล้วทั้งหมดของ Pallet นี้ ตอนสแกนซ้ำ (ใบที่สแกนซ้ำไฮไลต์สีแดง)
  private buildDuplicateRunningNoHtml(parsed: ParsedScanCode, scannedRunningNos: Set<string>): string {
    const cells = Array.from(scannedRunningNos)
      .sort()
      .map((no) => {
        const isDuplicate = no === parsed.runningNo;
        const bg = isDuplicate ? '#fee2e2' : '#ffffff';
        const border = isDuplicate ? '#fca5a5' : '#e5e7eb';
        const color = isDuplicate ? '#b91c1c' : '#374151';
        return `
          <div style="padding:10px 6px;border-radius:8px;background:${bg};border:1px solid ${border};color:${color};font-size:17px;font-weight:700;text-align:center;">
            ${no}
          </div>`;
      })
      .join('');

    return `
      <div style="text-align:left;font-family:inherit;">
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 12px;text-align:center;margin-bottom:14px;">
          <div style="font-size:19px;color:#b91c1c;font-weight:700;">ถุง Running No. ${parsed.runningNo} สแกนไปแล้ว</div>
          <div style="font-size:14px;color:#7f1d1d;margin-top:4px;">กรุณาตรวจสอบก่อนสแกนใหม่อีกครั้ง</div>
        </div>

        <div style="display:grid;grid-template-columns:0.9fr 0.9fr 1.2fr;gap:8px;margin-bottom:16px;">
          <div style="background:#f9fafb;border-radius:8px;padding:8px 4px;text-align:center;">
            <div style="font-size:12px;color:#9ca3af;">Grade</div>
            <div style="font-size:16px;font-weight:700;color:#111827;white-space:nowrap;">${parsed.grade}</div>
          </div>
          <div style="background:#f9fafb;border-radius:8px;padding:8px 4px;text-align:center;">
            <div style="font-size:12px;color:#9ca3af;">Lot</div>
            <div style="font-size:16px;font-weight:700;color:#111827;white-space:nowrap;">${parsed.lot}</div>
          </div>
          <div style="background:#f9fafb;border-radius:8px;padding:8px 4px;text-align:center;">
            <div style="font-size:12px;color:#9ca3af;">Pallet ID</div>
            <div style="font-size:14px;font-weight:700;color:#111827;white-space:nowrap;">${parsed.palletId}</div>
          </div>
        </div>

        <div style="font-size:14px;color:#6b7280;font-weight:600;margin-bottom:8px;">
          ถุงที่สแกนไปแล้ว (${scannedRunningNos.size} ถุง)
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(56px, 1fr));gap:8px;max-height:220px;overflow-y:auto;padding:2px;">
          ${cells}
        </div>
      </div>
    `;
  }

  //  ─────────────────────────────────────────────────────────────
  //  SPECIAL JOB (Special Package/BK/RQ/Transfer WH/IT): FIRST SCAN -> OPEN BOX / QUEUE
  //  ─────────────────────────────────────────────────────────────
  //  สแกนถุง 1 ครั้ง -> เช็ค grade/lot + โควต้า กก. คงเหลือ -> รอสแกน Location ต้นทางยืนยันก่อน (ไม่ผ่าน _bagCheckList แบบงานปกติ)
  private handleSpecialScannedCode(code: string): void {
    const parsed = this.parseScanCode(code);
    if (!parsed) return;

    //  เช็คก่อนว่าถุงนี้ (โค้ดเต็ม) ถูกจัดวางเสร็จสิ้นไปแล้วหรือยัง (อยู่ใน complete_pallet ของ backend/เครื่องนี้เอง) ->
    //  เดิม flow นี้เช็คแค่ _palletToPlaceList (ด้านล่าง) ไม่เคยเช็คกับ complete_pallet เลย สแกนถุงที่วางสำเร็จไปแล้วซ้ำ
    //  ยังไหลผ่านไปจนถึงยิง Get จริง ปล่อยให้ backend เป็นคนดักแทน (ช้ากว่า เสียรอบ API ฟรี) -> ใช้ checkPalletIdConflict
    //  ตัวเดียวกับที่งานปกติใช้อยู่แล้ว (ดู handleScannedCode) ดักตั้งแต่ฝั่ง client ก่อนเสมอ
    const conflict = this.scanLogic.checkPalletIdConflict(code, this._jobDataRaw, this._sessionPalletLists);
    if (conflict) {
      this.SweetAlert(conflict.icon, conflict.message);
      return;
    }

    //  pallet ที่เคย Get ไปแล้ว (อยู่ใน _palletToPlaceList แล้ว ไม่ว่าจะมาจาก Step นี้เองหรือ Step 1/เครื่องอื่น) ->
    //  สแกนถุงใบไหนก็ได้ของ pallet นั้น (เทียบกับ qrCode/bagCodes ที่สะสมไว้ตอน mergeSpecialEntriesByGradeLot) ถือว่า
    //  "เลือก" pallet นั้นเพื่อรอวาง ไม่ใช่พยายาม Get ใหม่ -> สำคัญมากสำหรับงาน 2-step ที่ Step 2 ต้องสแกนซ้ำเพื่อเลือก
    //  เองเสมอ (ไม่ auto-select ให้ ดู autoSelectPalletsIfEligible ที่ข้าม multi-step เสมอ) เดิมไม่มี check นี้เลย
    //  เลยสแกนถุงที่ Get ไปแล้วไม่ได้ ถูกตีความเป็น Get ใหม่ทุกครั้ง
    const alreadyVerified = this._palletToPlaceList.find((p) => this.scanLogic.palletHasCode(p, code));
    if (alreadyVerified) {
      if (alreadyVerified.isSelectedForPlacement) {
        this.SweetAlert('warning', `เลือกพาเลท Grade ${alreadyVerified.grade} ไว้แล้ว กรุณาสแกน Location ปลายทางเพื่อวาง`);
        return;
      }
      this.handleSelectPalletByIdScan(alreadyVerified);
      return;
    }

    //  งาน RQ/Transfer WH/IT เท่านั้น: 1 งานใช้ pallet format เดียวตลอด (ยืนยันแล้ว) -> ถ้างานนี้เคยสแกนเป็น Jumbo Bag ไปแล้ว ห้ามปนถุงแบบปกติเข้ามา
    if ((this._isAutoSpecialJob) && this._requestJobPalletFormat === 'jumbo') {
      this.SweetAlert('error', 'งานนี้เริ่มสแกนด้วย Jumbo Bag ไปแล้ว ไม่สามารถสแกนถุงแบบปกติปนเข้ามาได้ กรุณาตรวจสอบ QR Code');
      return;
    }

    //  สแกนโค้ดที่เคยถูก "ส่งให้ Step 2" ไว้ (พบใน prepare_pallet) -> ข้ามขั้นตอนยืนยัน Location ต้นทาง เปิด modal สแกนถุงได้เลย
    const preparedMatch = this.scanLogic.findSpecialScannedPoolEntry(this._jobDataRaw, 'prepare_pallet', code);
    if (preparedMatch) {
      this.handleSpecialResumePreparedPallet(preparedMatch, code, parsed);
      return;
    }

    let item: any;
    let remaining: number;
    //  เลข seq ของกล่องที่เพิ่งเปิดใหม่จากการสแกนครั้งนี้เอง (ถ้ามี) -> ส่งต่อให้ checkSpecialFullPalletThenQueue
    //  ไว้ rollback ทิ้งถ้าเจอว่าพาเลทนี้ไม่มีข้อมูลน้ำหนัก (กันกล่องเปล่าค้างโชว์ฝั่งขวาทั้งที่ error ไปแล้ว เหมือนบั๊ก
    //  PUT mode ที่เคยเจอ) null = ไม่ได้เปิดกล่องใหม่ตอนนี้ (reuse กล่อง active เดิม หรือเป็น BK ที่
    //  ต้องมีกล่องอยู่ก่อนสแกนเสมออยู่แล้ว ไม่ต้อง rollback อะไร)
    let freshlyOpenedSeq: number | null = null;

    if (this._isAutoSpecialJob) {
      //  งาน RQ/Transfer WH/IT เท่านั้น: ไม่ต้องกด "Add Pallet" อีกต่อไป (เอาปุ่มออกไปแล้ว) -> เช็คว่าถุงนี้ grade/lot ตรงกับใบงานและ
      //  ยังไม่ครบโควต้าก่อนเสมอ กันเปิดกล่องเปล่าทิ้งค้างไว้เวลาสแกนโค้ดผิด/สินค้าในงานครบหมดแล้ว แล้วค่อย auto เปิดกล่องเอง
      const resolved = this.scanLogic.resolveSpecialItemForScan(parsed, this._jobDataRaw, true);   //  โค้ดถุง 5/6 ส่วน -> isBagCode = true (ดู gradeWithoutParen)
      if (!resolved.item) {
        if (resolved.errorMessage) this.SweetAlert('error', resolved.errorMessage);
        return;
      }
      item = resolved.item;
      remaining = resolved.remaining;

      //  งาน 2-step + โหมด Put: เช็คก่อนจะแตะ state อะไรเลย (ย้ายมาจากหลัง if/else เดิม) ไม่งั้นถุงที่ยังไม่ถูกส่งให้
      //  Step 2 จะเปิดกล่องใหม่ (claimNextSpecialSeq ด้านล่าง) ไปก่อนแล้วค่อย reject กล่องเปล่าเลยค้างโชว์อยู่ฝั่งขวา
      //  ทั้งที่ error ไปแล้ว (เจอจริงจากการทดสอบ) ต้อง return ก่อนถึงจุด mutate state ใดๆ ทั้งนั้น
      if (this._isMultiStep && this._scanAction === 'put' && !this.scanLogic.isSpecialItemPrepared(item, this._jobDataRaw)) {
        this.SweetAlert(
          'error',
          'ถุงนี้ยังไม่ได้ถูกส่งให้ Step 2 กรุณาสแกนถุงที่เตรียมไว้ให้เท่านั้น หรือกลับไปกดปุ่ม Get ที่หน้ารายการงานเพื่อรับถุงใหม่ก่อน',
        );
        return;
      }

      //  เปิดกล่องใหม่ได้จนกว่าจะมี 2 กล่องรอยืนยัน Location ต้นทางพร้อมกัน
      if (this._specialActiveSeq === null && this._isSpecialPalletBatchFull) {
        this.SweetAlert('warning', 'กรุณาสแกน Location ต้นทางยืนยันพาเลทปัจจุบันให้เสร็จก่อน ถึงจะเริ่มพาเลทใหม่ได้');
        return;
      }

      //  กล่อง active ตอนนี้เต็มแล้วหรือยัง (ล็อกไปแล้ว หรือมีเต็ม pallet/Jumbo รอ location อยู่แล้ว ดู
      //  isActiveSpecialSeqOccupied ด้านบน) -> เปิดกล่องใหม่ให้เลย ไม่งั้นของใบนี้จะไปลงกล่องเดิมที่เต็มแล้วปนกัน
      //  (ป้ายม่วงจะ merge กันจนดูเหมือนสแกนไปใบเดียว เจอจริงตอนทดสอบด้วยเต็ม pallet 2 ใบ)
      if (this._specialActiveSeq === null || this.isActiveSpecialSeqOccupied()) {
        const seq = this.claimNextSpecialSeq();
        this._specialOpenPallets = [...this._specialOpenPallets, { seq, entries: [] }];
        this._specialActiveSeq = seq;
        freshlyOpenedSeq = seq;
        this.saveJobDataToSession();
      }

      //  ผ่านแล้ว ถือว่าสแกนนี้ถูกต้องแน่นอน -> ล็อค format ของงานนี้เป็นแบบปกติ (เผื่อยังไม่เคยมีมาก่อน)
      this._requestJobPalletFormat = 'normal';
    } else {
      //  งาน BK เท่านั้น (ไม่รวมงานกลุ่ม _isAutoSpecialJob): ยังต้องกด "Add Pallet" หรือกด card Pallet ที่ต้องการก่อนเสมอเหมือนเดิม (ไม่เปลี่ยน)
      if (this._specialActiveSeq === null) {
        this.SweetAlert('warning', 'กรุณากดปุ่ม "Add พาเลท" หรือกด card พาเลทที่ต้องการก่อนสแกนถุง');
        return;
      }

      const resolved = this.scanLogic.resolveSpecialItemForScan(parsed, this._jobDataRaw, true);   //  โค้ดถุง 5/6 ส่วน -> isBagCode = true (ดู gradeWithoutParen)
      if (!resolved.item) {
        if (resolved.errorMessage) this.SweetAlert('error', resolved.errorMessage);
        return;
      }
      item = resolved.item;
      remaining = resolved.remaining;
    }

    //  งาน 2-step + โหมด Put (มาต่อจากคนที่กด "ส่งให้ Step 2") -> รับสแกนได้เฉพาะ item ที่ถูกเตรียมไว้ใน prepare_pallet เท่านั้น
    //  ห้ามรับ item ใหม่ที่ไม่เคยถูกส่งมาให้ (เหมือนงานปกติที่ต้องกลับไปกด Get ก่อนถึงจะรับ Pallet ใหม่ได้)
    if (this._isMultiStep && this._scanAction === 'put' && !this.scanLogic.isSpecialItemPrepared(item, this._jobDataRaw)) {
      this.SweetAlert(
        'error',
        'ถุงนี้ยังไม่ได้ถูกส่งให้ Step 2 กรุณาสแกนถุงที่เตรียมไว้ให้เท่านั้น หรือกลับไปกดปุ่ม Get ที่หน้ารายการงานเพื่อรับถุงใหม่ก่อน',
      );
      return;
    }

    const quota = this.scanLogic.checkSpecialFromLocationQuota(item, parsed.lot, remaining, this._sessionPalletLists, this._specialAwaitingWeightByLocationName);
    if (quota.remaining <= 0) {
      this.SweetAlert(
        'error',
        `Location ต้นทาง "${this.formatLocationDisplay(quota.location?.location_name) || '-'}" ถูก Get ครบจำนวนแล้ว ไม่สามารถสแกนเพิ่มได้`,
      );
      //  error หลังเปิดกล่องใหม่ไปแล้ว (freshlyOpenedSeq) -> rollback ทิ้ง กันกล่องเปล่าค้างโชว์ฝั่งขวาทั้งที่ error ไปแล้ว
      //  (เดิมมีแค่ checkSpecialFullPalletThenQueue ที่ rollback ให้ จุดนี้/ด้านล่างไม่เคย rollback เลย)
      this.rollbackFreshlyOpenedSpecialSeq(freshlyOpenedSeq);
      return;
    }

    if (!quota.location?.location_name) {
      this.SweetAlert('error', 'ไม่พบ Location ต้นทางของเกรด/ล๊อตนี้ กรุณาตรวจสอบข้อมูลงาน');
      this.rollbackFreshlyOpenedSpecialSeq(freshlyOpenedSeq);
      return;
    }

    //  กันสแกนถุงที่มาจาก pallet ต้นทางใบเดียวกันจริง (เทียบด้วย parsed.palletId เลขท้ายโค้ดที่ระบุตัวพาเลตต้นทางจริง)
    //  ซ้ำเข้าไป ก่อนถุงที่รอ Location ต้นทางของ pallet ใบนั้นจะได้ยืนยัน -> ไม่ใช่ item.id เพราะ grade/lot เดียวกัน
    //  มีได้หลาย pallet ต้นทาง (คนละเลขท้าย) ที่ต้องไปเอาจากคนละ Location พร้อมกันจริง แต่ก็ไม่ใช่ palletSeq (กล่อง Add
    //  Pallet ฝั่งจอ) เพราะถุงจาก pallet ต้นทางใบเดียวกัน (เลขท้ายตรงกัน) ห้ามถูกแยกไปคนละกล่องเด็ดขาด ไม่ว่า palletSeq จะต่างกันแค่ไหน
    const alreadyAwaiting = this._specialAwaitingSourceLocation.some(
      (e) => e.item.id === item.id && e.parsed.palletId === parsed.palletId,
    );
    if (alreadyAwaiting) {
      this.SweetAlert('warning', `ถุงนี้รอสแกน Location ต้นทางอยู่แล้ว กรุณาสแกน Location ต้นทาง "${this.specialSourceLocationText(item, quota.location.location_name)}" เพื่อยืนยัน`);
      this.rollbackFreshlyOpenedSpecialSeq(freshlyOpenedSeq);
      return;
    }

    //  งานกลุ่ม kilo สแกน Location ต้นทางได้ทุก from_location ของ item -> ยอดที่รับได้ของรายการนี้ (เพดานนับถุง/ตัดสินว่าเอาเต็ม
    //  พาเลทได้ไหม) คือยอดคงเหลือของ item ไม่ผูกกับที่ว่างของ Location ที่ระบบเลือกให้ตอนนี้ ที่ว่างของที่ที่สแกนจริงไปเช็คตอนสแกน
    //  Location แทน (ดู handleSpecialSourceLocationScan) Location ที่ระบบเลือกยังใช้จองน้ำหนักไว้ก่อนเหมือนเดิม
    const entryQuota = this._isAutoSpecialJob ? { location: quota.location, remaining } : quota;

    //  เช็คก่อนว่าถุงใบนี้อยู่บน pallet ต้นทางที่เป็น pallet เต็มหรือไม่ (is_full_pallet) ก่อนเข้าคิวรอสแกน Location ต้นทาง
    this.checkSpecialFullPalletThenQueue(code, parsed, item, entryQuota, freshlyOpenedSeq);
  }

  //  ยกเลิกกล่องที่เพิ่งเปิดไปจากการสแกนครั้งนี้เอง (ถ้ามี, seq มาจาก handleSpecialScannedCode) ตอน
  //  checkSpecialFullPalletThenQueue เจอว่าพาเลทนี้ไม่มีข้อมูลน้ำหนักให้ใช้ต่อ (ไม่เจอ pallet/ไม่เจอ qty) -> ใช้ pattern
  //  เดียวกับ onClickDeleteSpecialOpenPallet (คืน seq เข้า reusable pool, เอากล่องออกจาก _specialOpenPallets) กันกล่อง
  //  เปล่าค้างโชว์ฝั่งขวาทั้งที่ error ไปแล้ว (บั๊กแบบเดียวกับ PUT mode ที่เคยเจอและแก้ไปก่อนหน้านี้)
  private rollbackFreshlyOpenedSpecialSeq(seq: number | null): void {
    if (seq == null) return;
    this._specialOpenPallets = this._specialOpenPallets.filter((g) => g.seq !== seq);
    this._specialReusableSeqs = [...this._specialReusableSeqs, seq];
    if (this._specialActiveSeq === seq) {
      this._specialActiveSeq = null;
      this._isScanning = false;
    }
    this.saveJobDataToSession();
    this.refreshDisplayList();
  }

  //  เรียก GetProcessPallet เพื่อเช็ค is_full_pallet + เก็บ record (มี unit_ratio = กก./ถุง) ไว้ใช้ตอนยืนยัน modal ทีหลัง
  //  freshlyOpenedSeq: เลขกล่องที่เพิ่งเปิดใหม่จากการสแกนครั้งนี้ (ถ้ามี) ส่งต่อมาจาก handleSpecialScannedCode เพื่อ rollback
  //  ได้ถ้าจบลงด้วย error ไม่มี qty ให้ใช้
  private checkSpecialFullPalletThenQueue(
    code: string,
    parsed: ParsedScanCode,
    item: any,
    quota: { location: any; remaining: number },
    freshlyOpenedSeq: number | null,
  ): void {
    this._isSpecialBagResolving = true;
    this.scanApi.getProcessPallet(parsed.palletId, parsed.grade, parsed.lot, code).subscribe({
      next: (res) => {
        this._isSpecialBagResolving = false;
        //  จับคู่ด้วย pallet_id (เลขที่ parse จาก QR ตรงๆ) ก่อนเสมอ ไม่ใช่ id (row id จริงในระบบ คนละความหมายกัน)
        //  ตอนนี้ยิง palletId ไปกับ request แล้วด้วย ปกติควรได้ผลลัพธ์แค่ใบเดียวอยู่แล้ว อันนี้กันไว้เผื่อ backend ยังคืนมาหลายใบ
        const found =
          (res?.data ?? []).find((p: any) => String(p.pallet_id) === String(parsed.palletId))
          ?? (res?.data ?? []).find((p: any) => String(p.id) === String(parsed.palletId))
          ?? res?.data?.[0]
          ?? null;

        //  ไม่เจอ record พาเลทนี้ในระบบเลย (คนละเคสกับเจอแต่ไม่มี qty ด้านล่าง) -> ขึ้น error บอกให้เช็ค QR Code/ลองใหม่
        //  ไม่ปล่อยให้ไหลเข้า modal นับถุงเลยทั้งที่ไม่รู้ข้อมูลอะไรของพาเลทใบนี้สักนิด
        if (found == null) {
          this.SweetAlert('error', 'ไม่พบพาเลทใบนี้ในระบบ กรุณาตรวจสอบ QR Code ว่าถูกต้อง หรือลองสแกนใหม่อีกครั้ง');
          this.rollbackFreshlyOpenedSpecialSeq(freshlyOpenedSeq);
          return;
        }

        //  เจอ record จริง แต่ไม่มีข้อมูลน้ำหนัก (qty) ให้ใช้เลย -> สแกนใหม่ก็ไม่ช่วยอะไร (ไม่ใช่ปัญหาจากฝั่งคนสแกน)
        //  ต้องให้เจ้าหน้าที่คลังไปตรวจสอบข้อมูลพาเลทนี้ในระบบก่อน ข้อความเลยต่างจากเคส "ไม่เจอ pallet" ด้านบน
        if (found.qty == null) {
          this.SweetAlert('error', 'พบพาเลทใบนี้ในระบบ แต่ไม่มีข้อมูลน้ำหนัก กรุณาติดต่อเจ้าหน้าที่คลังเพื่อตรวจสอบข้อมูลพาเลทนี้ก่อนสแกนอีกครั้ง');
          this.rollbackFreshlyOpenedSpecialSeq(freshlyOpenedSeq);
          return;
        }

        //  ไม่เสนอตัวเลือก "เลือกเต็มพาเลท" เลยถ้าพาเลทมีมากกว่าที่งานเหลือ (เลือกไปก็ยิง Get ไม่ผ่านอยู่ดีเพราะเอาทั้งใบ
        //  แบ่งครึ่งไม่ได้) -> เข้าโหมดนับถุงตรงๆ แทน โมดัลที่เปิดจะโชว์ทั้งยอดงานเหลือ/ยอดพาเลทจริงอยู่แล้ว (ดู
        //  _specialModalEffectiveRemaining) ไม่ต้องขึ้น SweetAlert ซ้ำอธิบายอีกชั้น
        if (this._specialAllowsFullPallet && found.is_full_pallet === 'Y' && found.qty <= quota.remaining) {
          //  งาน RQ/Transfer WH/IT เท่านั้น: ไม่ถาม popup ซ้ำอีกต่อไป (เอาทั้งใบพอดีกับยอดที่เหลืออยู่แล้ว ไม่มีอะไรให้
          //  ตัดสินใจ) -> auto เอาเต็มพาเลทไปเลยเหมือนตอบ "ใช่" ให้เอง กด feedback จริงว่าต้องกดยืนยันทุกใบแม้จะพอดีอยู่แล้ว
          //  BK: ยังถาม popup เหมือนเดิมทุกครั้ง ไม่เปลี่ยนพฤติกรรม (ยังไม่มีใครขอให้เปลี่ยนฝั่งนี้)
          if (this._isAutoSpecialJob) {
            this.queueSpecialAwaitingSourceLocation(code, parsed, item, quota, true, found);
          } else {
            this.confirmSpecialFullPallet(code, parsed, item, quota, found);
          }
        } else {
          this.queueSpecialAwaitingSourceLocation(code, parsed, item, quota, false, found);
        }
      },
      error: () => {
        this._isSpecialBagResolving = false;
        this.SweetAlert('error', 'ไม่พบพาเลทใบนี้ในระบบ กรุณาตรวจสอบ QR Code ว่าถูกต้อง หรือลองสแกนใหม่อีกครั้ง');
        this.rollbackFreshlyOpenedSpecialSeq(freshlyOpenedSeq);
      },
    });
  }

  //  ถาม user ว่าต้องการเลือกเต็ม pallet หรือไม่ ("ใช่" -> modeId 1 Full Pallet, "ไม่" -> เข้า flow สแกนถุงตามปกติ)
  private confirmSpecialFullPallet(
    code: string,
    parsed: ParsedScanCode,
    item: any,
    quota: { location: any; remaining: number },
    record: any,
  ): void {
    Swal.fire({
      icon: 'question',
      title: 'ต้องการเลือกเต็มพาเลทหรือไม่?',
      html: `พาเลท id: ${record.pallet_no ?? record.id ?? parsed.palletId}<br>${item.grade} &bull; ${parsed.lot}<br>น้ำหนัก ${record.qty ?? '-'} กก.`,
      showCancelButton: true,
      confirmButtonText: 'ใช่ เลือกเต็มพาเลท',
      cancelButtonText: 'ไม่ นับเป็นถุง',
    }).then((result) => {
      if (result.isConfirmed) {
        this.queueSpecialAwaitingSourceLocation(code, parsed, item, quota, true, record);
      } else {
        this.queueSpecialAwaitingSourceLocation(code, parsed, item, quota, false, record);
      }
    });
  }

  private queueSpecialAwaitingSourceLocation(
    code: string,
    parsed: ParsedScanCode,
    item: any,
    quota: { location: any; remaining: number },
    isFullPallet: boolean,
    record: any,
  ): void {
    const entry: SpecialAwaitingSourceEntry = {
      code,
      parsed,
      item,
      remaining: quota.remaining,
      sourceLocation: quota.location.location_name,
      isFullPallet,
      fullPalletRecord: record,
      palletSeq: this._specialActiveSeq ?? 0,
    };
    this._specialAwaitingSourceLocation.push(entry);

    //  งาน auto-special ที่นับถุงเอง (isFullPallet false เท่านั้น) -> เปิด modal ทันทีหลังสแกนถุง
    //  ให้ผู้ใช้สแกนถุงเพิ่มและกดยืนยันจำนวนเอง; งาน Outbound จะรอสแกน Location ต้นทางหลังยืนยัน
    if (!isFullPallet && (this._isAutoSpecialJob)) {
      //  ไม่ขึ้น SweetAlert ซ้ำ -> modal ที่เพิ่งเปิดมีข้อความคำแนะนำเดียวกันโชว์ค้างอยู่แล้ว (special-qty-modal-hint-instruction
      //  ใน HTML) ขึ้นซ้อนแค่แป๊บเดียว (timer 3 วิ) บัง modal เฉยๆ ไม่ได้ให้ข้อมูลอะไรเพิ่ม
      this.openSpecialQtyModalFromEntry(entry, false);
      return;
    }

    this.SweetAlert('success', `ยืนยันถุงสำเร็จ กรุณาสแกน Location ต้นทาง "${this.specialSourceLocationText(item, quota.location.location_name, this.specialEntryDemand(entry))}" เพื่อยืนยัน`);
  }

  //  ─────────────────────────────────────────────────────────────
  //  SPECIAL JOB: MODAL SETUP (OPEN / RESUME)
  //  ─────────────────────────────────────────────────────────────
  //  สร้าง modal สแกนถุงจาก entry ที่รอ Location ต้นทางอยู่ -> ใช้ร่วมกันทั้ง BK (เปิดหลังสแกน Location
  //  ต้นทางยืนยันแล้ว ดู handleSpecialSourceLocationScan) และงานกลุ่ม _isAutoSpecialJob (เปิดทันทีตั้งแต่ถุงใบแรก ดู
  //  queueSpecialAwaitingSourceLocation ด้านบน) canSendToStep2 รับจาก caller เพราะคำนวณคนละสูตรกันคนละจุด
  //  scannedCodes/mode รับ override ได้ -> ใช้ตอนสแกน Location ต้นทางจริงของ entry ที่เคยกดล็อกไว้แล้ว (entry.lockedCodes
  //  ดู handleSpecialSourceLocationScan) เพื่อสร้าง modal จากรายการถุงที่นับไว้ทั้งหมด ไม่ใช่แค่ถุงใบแรก
  private openSpecialQtyModalFromEntry(
    entry: SpecialAwaitingSourceEntry,
    canSendToStep2: boolean,
    scannedCodes: string[] = [entry.code],
    mode: 'take' | 'store' = 'take',
    sourceLocationConfirmed = false,
  ): void {
    this._specialQtyModal = {
      code: entry.code,
      parsed: entry.parsed,
      item: entry.item,
      remaining: entry.remaining,
      scannedCodes,
      hint: null,
      mode,
      canSendToStep2,
      isStep2Continuation: false,
      palletSeq: entry.palletSeq,
      sourceRecord: entry.fullPalletRecord,
      sourceLocation: entry.sourceLocation,
      sourceLocationConfirmed,
    };
    this._isSpecialBagScanning = true;
  }

  //  สแกนถุงที่เคยถูก "ส่งให้ Step 2" ไว้ (พบใน prepare_pallet) -> ข้ามขั้นตอนยืนยัน Location ต้นทาง เปิด modal สแกนถุงได้เลย
  private handleSpecialResumePreparedPallet(entry: any, code: string, parsed: ParsedScanCode): void {
    const rawItem = this.scanLogic.resolveSpecialItemForPoolEntry(this._jobDataRaw, entry);
    if (!rawItem) {
      this.SweetAlert('error', 'ไม่พบข้อมูลสินค้าของถุงนี้ในงาน กรุณาตรวจสอบ QR Code');
      return;
    }

    const remaining = (rawItem.total_qty ?? 0) - (rawItem.receive_qty ?? 0) - (rawItem.complete_qty ?? 0);
    if (remaining <= 0) {
      this.SweetAlert('error', `เกรด/ล๊อต "${rawItem.grade}" นี้ครบตามจำนวนที่ต้องการแล้ว`);
      return;
    }

    this._specialQtyModal = {
      code,
      parsed,
      item: rawItem,
      remaining,
      scannedCodes: [code],
      hint: null,
      mode: 'take',
      //  item นี้ถูก prepare มาแล้ว -> คนที่สแกนตอนนี้คือคนทำ Step 2 เอง ไม่ต้องขึ้นปุ่มส่งต่ออีก
      canSendToStep2: false,
      isStep2Continuation: true,
      palletSeq: this._specialActiveSeq ?? 0,
      //  ponytail: ไม่มี GetProcessPallet lookup ใน flow นี้ -> ไม่รู้ กก./ถุง จริง onConfirmSpecialQty จะ fallback ใช้จำนวนถุงแทน
      sourceRecord: null,
    };
    this._isSpecialBagScanning = true;
  }

  private isKnownSpecialSourceLocation(code: string): boolean {
    return this._specialAwaitingSourceLocation.some((e) => this.isSpecialSourceLocationFor(e, code));
  }

  //  รายการนี้ยืนยันด้วยการสแกน Location ต้นทาง code ได้ไหม -> งานกลุ่ม kilo สแกนได้ทุก from_location ของ item (ที่ไหนก็ได้
  //  ที่ item นี้เอาได้ ไม่สนว่า lot ใน addon_lot ของที่นั้นตรงกับถุงไหม) งานอื่น (BK) ยังต้องสแกนตาม Location ที่ระบบเลือก
  //  ให้ตอนสแกนถุง (sourceLocation) ที่เดียวเหมือนเดิม
  private isSpecialSourceLocationFor(entry: SpecialAwaitingSourceEntry, code: string): boolean {
    const target = code.trim();
    if (!this._isAutoSpecialJob) return entry.sourceLocation.trim() === target;
    return (entry.item?.locations?.from_locations ?? []).some((l: any) => String(l.location_name ?? '').trim() === target);
  }

  //  record ของ from_location ที่จะใช้ยิง Get -> ใช้ Location ที่ยืนยันด้วยการสแกนแล้ว (locationName = sourceLocation ของรายการ)
  //  ตรงๆ ไม่ให้ระบบเลือกใหม่ตอนยิง (งานกลุ่ม kilo สแกนได้ทุก from_location ระบบเลือกเองจะไม่ตรงกับที่หยิบมาจริง) หาไม่เจอ
  //  (เช่น modal ของถุงที่ส่งให้ Step 2 ซึ่งไม่ผ่านการสแกน Location) ค่อยให้ระบบเลือกเหมือนเดิม
  private resolveSpecialFromLocation(item: any, lot: string, locationName: string | undefined, extraWeight?: Map<string, number>): any {
    const name = String(locationName ?? '').trim();
    const confirmed = name
      ? (item?.locations?.from_locations ?? []).find((l: any) => String(l.location_name ?? '').trim() === name)
      : undefined;
    return confirmed
      ?? this.scanLogic.resolveFromLocationForItem(item, lot, this._sessionPalletLists, true, extraWeight ?? this._specialAwaitingWeightByLocationName);
  }

  //  ข้อความ Location ต้นทางที่สแกนยืนยันได้ สำหรับป้ายม่วง/ข้อความแจ้ง/modal -> งานกลุ่ม kilo โชว์ from_location ของ item ที่ยัง
  //  รับน้ำหนัก demand ของรายการนั้นได้ (ที่ที่เอามาหมดแล้ว/เหลือไม่พอจะหายไปเอง) ไม่มีที่ไหนพอเลยค่อยโชว์ที่ที่ยังเหลือที่อยู่
  //  โชว์ครบทุกชื่อเสมอ ไม่ย่อเป็น "+N" (คนขับต้องรู้ว่าไปที่ไหนได้บ้าง) งานอื่นโชว์ Location ที่ระบบเลือกให้ที่เดียวเหมือนเดิม
  //  public เพราะ modal ใน template เรียกตรงๆ
  specialSourceLocationText(item: any, sourceLocation: string | undefined, demand = 0): string {
    if (!this._isAutoSpecialJob) return this.formatLocationDisplay(sourceLocation);
    const fit = this.specialFitSourceLocations(item, demand);
    const names = Array.from(new Set(
      (fit.length > 0 ? fit : this.specialFitSourceLocations(item, 0)).map((n) => this.formatLocationDisplay(n)),
    ));
    if (names.length === 0) return this.formatLocationDisplay(sourceLocation);
    return names.join(', ');
  }

  //  ข้อความตอนสแกน Location ผิด -> บอกทั้งที่สแกนมา และ Location ที่ถูกครบทุกที่ (ไม่ย่อ "+N") ใช้ทั้งต้นทาง/ปลายทางทุกงาน
  //  expected = ชื่อแสดงผลแล้ว (formatLocationDisplay) อาจเป็นข้อความ "A, B" ที่รวมมาแล้ว -> แยกแล้วตัดซ้ำก่อนต่อกันใหม่
  //  หาไม่ได้สักที่ -> กลับไปใช้ข้อความแบบเดิม (ไม่บอกชื่อ) ไม่ขึ้นชื่อว่างๆ ""
  private wrongLocationMessage(code: string, side: 'ต้นทาง' | 'ปลายทาง', target: string, expected: (string | null | undefined)[]): string {
    const names = Array.from(new Set(
      expected.flatMap((t) => String(t ?? '').split(',')).map((n) => n.trim()).filter((n) => !!n),
    ));
    const hint = names.length > 0
      ? `กรุณาสแกน Location ${side} "${names.join(', ')}"`
      : `กรุณาสแกน Location ${side}ของ${target}`;
    return `Location "${this.formatLocationDisplay(code)}" ไม่ใช่ Location ${side}ของ${target} ${hint}`;
  }

  //  ชื่อ from_location (ชื่อดิบ) ของ item ที่ยังรับน้ำหนัก demand ได้ (demand 0 = ยังไม่รู้จำนวน -> เอาที่ที่ยังเหลือที่) นับที่ว่าง
  //  จากยอดของ Location + ที่เครื่องนี้รับไปแล้ว + ที่ยิง Get ค้างอยู่ ไม่นับรายการอื่นที่ยังรอสแกน Location (ยังไม่ได้ผูกที่จริง)
  private specialFitSourceLocations(item: any, demand: number): string[] {
    const lists = this._sessionPalletLists;
    const inFlightOnly = this.specialAwaitingWeightExcept(new Set(this._specialAwaitingSourceLocation));
    return (item?.locations?.from_locations ?? [])
      .filter((l: any) => {
        const remaining = this.scanLogic.fromLocationRemainingWeight(l, lists, inFlightOnly);
        return demand > 0 ? remaining >= demand : remaining > 0;
      })
      .map((l: any) => String(l.location_name ?? '').trim())
      .filter((n: string) => !!n);
  }

  //  น้ำหนักที่รายการรอสแกน Location ต้นทางนี้จะดึงออกจาก Location (กก.) -> เต็มพาเลท = น้ำหนักพาเลท, ถุงที่กดยืนยันไว้ = ตาม
  //  จำนวนถุง ยังไม่รู้จำนวน (กำลังนับ/ปิด modal กลางคัน) = 0
  private specialEntryDemand(e: SpecialAwaitingSourceEntry): number {
    if (e.isFullPallet) return e.fullPalletRecord?.qty ?? 0;
    return e.lockedCodes ? this.computeSpecialModalQty(e.fullPalletRecord, e.lockedCodes.length) : 0;
  }

  //  บวก/ลบยอดที่ Get ออกจาก from_location ใบนี้ คู่กับ item.receive_qty -> พาเลทที่เพิ่ง Get มี record ใน receive_pallet แล้ว
  //  (isKnownServerPallet) เลยไม่ถูกนับจาก list ฝั่งเครื่อง แต่ยอดของ from_location เองไม่เคยถูก sync จาก backend ระหว่างอยู่หน้านี้
  //  ถ้าไม่บวกเอง ที่ว่างของ Location ต้นทางจะไม่ลดเลยจนกว่าจะโหลดหน้าใหม่ (รับจาก A จนหมดแล้วระบบยังเห็นว่า A ว่างอยู่)
  private adjustSpecialFromLocationReceived(fromLocation: any, delta: number): void {
    if (!fromLocation) return;
    fromLocation.receive_qty = Math.max(0, (fromLocation.receive_qty ?? 0) + delta);
  }

  //  ─────────────────────────────────────────────────────────────
  //  SPECIAL JOB: SOURCE LOCATION SCAN -> GET (เดี่ยว/batch)
  //  ─────────────────────────────────────────────────────────────
  //  สแกน Location ต้นทางยืนยันสำเร็จ -> ยิง Get ให้ทุก entry ที่ Location นี้ "พร้อมอยู่แล้ว" ในสแกนเดียวกันทั้งหมด
  //  (เต็ม pallet/Jumbo + ถุงที่กดยืนยัน/ล็อกไว้แล้ว ปนกันได้ ดู getSpecialLocationBatch) ไม่ต้องสแกนซ้ำทีละประเภทแบบเดิม
  //  ส่วน entry ที่ "ยังไม่พร้อม" (กำลังนับถุงอยู่ในกล่อง active ตอนนี้พอดี หรือยังไม่เคยกดล็อก/ปิด modal กลางคันไว้)
  //  ยังต้องจัดการแยกเหมือนเดิม เพราะไม่รู้ว่าจะเอากี่ถุงจนกว่า user จะยืนยันเอง
  private handleSpecialSourceLocationScan(code: string): void {
    const matches = this._specialAwaitingSourceLocation.filter((e) => this.isSpecialSourceLocationFor(e, code));
    if (matches.length === 0) {
      this.SweetAlert('error', this.wrongLocationMessage(
        code,
        'ต้นทาง',
        'ถุงที่รออยู่',
        this._specialAwaitingSourceLocation.map((e) => this.specialSourceLocationText(e.item, e.sourceLocation, this.specialEntryDemand(e))),
      ));
      return;
    }

    //  งาน RQ/Transfer WH/IT: modal นับถุงเปิดอยู่แล้วตั้งแต่ถุงใบแรก (ดู queueSpecialAwaitingSourceLocation) การสแกน
    //  Location ต้นทางครั้งนี้ตรงกับกล่องที่กำลังนับอยู่พอดี -> สัญญาณ "นับครบแล้ว ยิงเลย" ยิงด้วยถุงสดใน modal ตรงๆ
    //  (ยังไม่ทันกดล็อกเลยไม่มี lockedCodes ให้ใช้) ใช้ onConfirmSpecialQty ตัวเดิมเป๊ะ แยกยิงเดี่ยวเสมอ ไม่รวมเข้า batch
    //  ด้านล่าง (BK ไม่มีวันเข้าเงื่อนไขนี้ เพราะ modal ของมันยังไม่เปิดตอนนี้)
    const activeModal = this._specialQtyModal;
    const countingEntry = activeModal ? matches.find((e) => e.palletSeq === activeModal.palletSeq) : undefined;

    //  งานกลุ่ม kilo สแกนได้ทุก from_location ของ item -> ยืนยันเท่าที่ที่ว่างของ Location นี้พอ ไล่ตามลำดับ (กล่องที่กำลังนับใน
    //  modal ก่อน แล้วตามลำดับที่สแกนพาเลทไว้) ใบที่ไม่พอยังรอสแกน Location ต้นทางที่อื่นต่อ (ป้ายม่วงเหลือแค่ที่ที่ยังพอ) ไม่พอสักใบ
    //  หรือชุดที่กำลังนับอยู่ไม่พอ -> ไม่ยืนยันอะไรเลย เตือนให้ไปสแกนที่อื่น (ถุงที่นับไว้ยังอยู่ครบ) ใบที่ยืนยันแล้วผูก Location ที่
    //  สแกนจริงไว้ให้ Get ใช้ที่นี้ (ดู resolveSpecialFromLocation)
    let confirmed = matches;
    //  ทำต่อหลัง popup ผล Get ของใบที่ยืนยันปิดแล้ว (ดู openBagsFor ด้านล่าง) undefined = ไม่มีอะไรต้องทำต่อ
    let afterGet: (() => void) | undefined;
    if (this._isAutoSpecialJob) {
      const target = code.trim();
      const extraWeight = this.specialAwaitingWeightExcept(new Set(matches));
      const demandOf = (e: SpecialAwaitingSourceEntry): number =>
        e === countingEntry && activeModal
          ? this.computeSpecialModalQty(activeModal.sourceRecord, activeModal.scannedCodes.length)
          : this.specialEntryDemand(e);
      const shortMessage = (demand: number, remaining: number) =>
        `Location ต้นทาง "${this.formatLocationDisplay(target)}" เหลือที่ไม่พอ (ต้องการ ${this.formatDisplayQty(demand)} กก. เหลือ ${this.formatDisplayQty(Math.max(0, remaining))} กก.) กรุณาสแกน Location ต้นทางอื่น`;

      const ordered = countingEntry ? [countingEntry, ...matches.filter((e) => e !== countingEntry)] : matches;
      const takenAt = new Map<any, number>();
      const accepted: SpecialAwaitingSourceEntry[] = [];
      let firstShortMessage = '';
      //  เต็มพาเลทที่ใส่ Location นี้ไม่พอ -> เปลี่ยนเป็นนับถุงที่นี่แทน (เฉพาะโค้ดถุง 5/6 ส่วน PL/Jumbo แบ่งเป็นถุงไม่ได้)
      //  เอาใบแรกที่เจอ และเฉพาะตอนไม่มี modal เปิดอยู่ (กันเปิดซ้อน)
      let toBags: SpecialAwaitingSourceEntry | undefined;
      for (const e of ordered) {
        const rawLocation = (e.item?.locations?.from_locations ?? []).find((l: any) => String(l.location_name ?? '').trim() === target);
        const demand = demandOf(e);
        const remainingWeight = this.scanLogic.fromLocationRemainingWeight(rawLocation, this._sessionPalletLists, extraWeight)
          - (takenAt.get(rawLocation) ?? 0);
        if (demand > 0 && demand > remainingWeight) {
          //  ชุดที่กำลังนับอยู่ใน modal (ตั้งใจสแกน Location เพื่อยืนยันชุดนี้) ไม่พอ -> ไม่ยืนยันรายการอื่นแทนให้งง
          if (e === countingEntry) {
            this.SweetAlert('error', shortMessage(demand, remainingWeight));
            return;
          }
          if (!firstShortMessage) firstShortMessage = shortMessage(demand, remainingWeight);
          if (!toBags && !activeModal && e.isFullPallet && this.parseScanCode(e.code)) toBags = e;
          continue;
        }
        takenAt.set(rawLocation, (takenAt.get(rawLocation) ?? 0) + demand);
        accepted.push(e);
      }

      //  เปิด modal นับถุงให้ใบที่เอาเต็มไม่ได้ จำกัดไม่เกินที่ว่างของที่นี้ -> คิดที่ว่างใหม่ตอนเปิดเสมอ (ใบอื่นอาจเพิ่ง Get
      //  จากที่เดียวกันไป) entry ยังค้างใน _specialAwaitingSourceLocation เหมือนนับถุงปกติ สแกน Location นี้อีกครั้ง = ยิง Get
      const openBagsFor = (e: SpecialAwaitingSourceEntry) => {
        if (this._specialQtyModal || !e.isFullPallet || !this._specialAwaitingSourceLocation.includes(e)) return;
        const rawLocation = (e.item?.locations?.from_locations ?? []).find((l: any) => String(l.location_name ?? '').trim() === target);
        const atTarget = new Set(this._specialAwaitingSourceLocation.filter((x) => this.isSpecialSourceLocationFor(x, target)));
        const room = this.scanLogic.fromLocationRemainingWeight(rawLocation, this._sessionPalletLists, this.specialAwaitingWeightExcept(atTarget));
        if (room <= 0) {
          this.SweetAlert('error', shortMessage(this.specialEntryDemand(e), room));
          return;
        }
        e.isFullPallet = false;
        e.sourceLocation = target;
        e.remaining = Math.min(e.remaining, room);
        this.openSpecialQtyModalFromEntry(e, false);
      };

      if (accepted.length === 0) {
        if (toBags) {
          openBagsFor(toBags);
          return;
        }
        this.SweetAlert('error', firstShortMessage);
        return;
      }
      const leftover = toBags;
      if (leftover) afterGet = () => openBagsFor(leftover);

      accepted.forEach((e) => (e.sourceLocation = target));
      //  ใบที่ไม่พอที่นี้ ย้ายที่จองน้ำหนัก (sourceLocation) ไปที่อื่นที่ยังพอแทน ไม่งั้นน้ำหนักของมันยังถูกนับว่ารออยู่ที่นี้
      //  ทับกับใบที่เพิ่งยืนยัน (เช็คที่ว่างตอนยิงแบบ batch ด้านล่างจะไม่ผ่านทั้งชุด)
      matches
        .filter((e) => !accepted.includes(e) && e.sourceLocation.trim() === target)
        .forEach((e) => (e.sourceLocation = this.specialFitSourceLocations(e.item, demandOf(e)).find((n) => n !== target) ?? ''));
      if (countingEntry && activeModal) {
        activeModal.sourceLocation = target;
        activeModal.sourceLocationConfirmed = true;
      }
      confirmed = accepted;
    }

    if (countingEntry) {
      //  เอาออกจากรายการรอสแกน Location ก่อนยิง เหมือนทางเต็มพาเลท/ถุงที่กดยืนยันไว้ด้านล่าง เดิมไม่เอาออก Get สำเร็จแล้ว
      //  รายการยังค้าง ระบบเลยคิดว่ายังมีพาเลทรอสแกน Location อยู่ สแกนพาเลทใบถัดไปไม่ได้จนกว่าจะโหลดหน้าใหม่ ถ้า Get
      //  ไม่สำเร็จ modal ยังเปิดอยู่พร้อม hint และปุ่มยืนยันให้ยิงซ้ำได้ (ใช้ Location ที่สแกนไว้ใน modal.sourceLocation)
      this._specialAwaitingSourceLocation = this._specialAwaitingSourceLocation.filter((e) => e !== countingEntry);
      this.onConfirmSpecialQty();
    }

    //  เต็ม pallet/Jumbo (isFullPallet) + ถุงที่กดยืนยัน/ล็อกไว้แล้ว (lockedCodes, งาน RQ/Transfer WH/IT เท่านั้น ดู
    //  onLockSpecialQtyForLocationScan) ที่ Location เดียวกันนี้ -> พร้อมยิงอัตโนมัติทันทีไม่ต้องรอ user ทำอะไรเพิ่ม
    const autoFullPallet = confirmed.filter((e) => e !== countingEntry && e.isFullPallet);
    const autoLockedBag = confirmed.filter((e) => e !== countingEntry && !e.isFullPallet && e.lockedCodes);
    const autoTotal = autoFullPallet.length + autoLockedBag.length;

    if (autoTotal === 1 && autoFullPallet.length === 1) {
      const entry = autoFullPallet[0];
      this._specialAwaitingSourceLocation = this._specialAwaitingSourceLocation.filter((e) => e !== entry);
      this.getSpecialFullPallet(entry, afterGet);
    } else if (autoTotal === 1 && autoLockedBag.length === 1 && !afterGet) {
      const entry = autoLockedBag[0];
      this._specialAwaitingSourceLocation = this._specialAwaitingSourceLocation.filter((e) => e !== entry);
      this.openSpecialQtyModalFromEntry(entry, false, entry.lockedCodes, entry.lockedMode, true);
      this.onConfirmSpecialQty();
    } else if (autoTotal >= 1) {
      //  ถุงที่ล็อกไว้ใบเดียวแต่มีใบต้องเปิด modal นับถุงต่อ (afterGet) -> ยิงทาง batch แทน เพราะทางเดี่ยวใช้ modal ของตัวเองยิง
      this.getSpecialLocationBatch(autoFullPallet, autoLockedBag, code, afterGet);
    }

    //  เหลือ entry ที่ไม่ใช่กล่องกำลังนับ ไม่ใช่เต็ม pallet และยังไม่เคยกดล็อก (เช่นปิด modal ด้วย × ค้างไว้ก่อนหน้า) ->
    //  ไม่รู้จะเอากี่ถุง ต้องเปิด modal ให้ยืนยันเอง (พฤติกรรมเดิมเป๊ะ รวมถึง BK ที่ไม่มีปุ่มล็อกเลยเข้า
    //  เงื่อนไขนี้เสมอ) ถ้ามีมากกว่า 1 ตัว เอาตัวแรกสุด (ตามลำดับที่สแกนไว้) ก่อนเหมือน findIndex เดิม ตัวที่เหลือรอสแกนซ้ำ
    const unresolved = confirmed.filter((e) => e !== countingEntry && !e.isFullPallet && !e.lockedCodes);
    if (unresolved.length > 0) {
      const entry = unresolved[0];
      this._specialAwaitingSourceLocation = this._specialAwaitingSourceLocation.filter((e) => e !== entry);

      //  งาน 2-step + item นี้ยังไม่เคยถูกส่งให้ Step 2 มาก่อน -> ขึ้นปุ่ม "ส่งให้ Step 2" ได้
      //  ถ้า item นี้มี pallet ค้างอยู่ใน prepare_pallet แล้ว แปลว่าคนที่สแกนตอนนี้คือคนทำ Step 2 เอง -> ไม่ต้องขึ้นปุ่มซ้ำ
      //  ไม่เอากับงาน RQ/Transfer WH/IT (ไม่เคยขอฟีเจอร์นี้ -> Step 2 แค่สแกนซ้ำเพื่อเลือก pallet ที่ Get ไปแล้ว ไม่ต้องมีขั้น "ส่งให้ Step 2" แยก)
      const canSendToStep2 = this._isMultiStep && !this._isAutoSpecialJob && !this.scanLogic.isSpecialItemPrepared(entry.item, this._jobDataRaw);
      this.openSpecialQtyModalFromEntry(entry, canSendToStep2, undefined, undefined, true);
    }
  }

  //  Get ทั้ง pallet (modeId 1 Full Pallet) -> ส่ง qrCodes อาร์เรย์ 1 ตัว แล้วผลักเข้า _specialOpenPallets (pending ใน pallet_seq ที่ select ไว้)
  //  afterDone: เรียกหลัง popup ผล Get ปิด (ทั้งสำเร็จ/ไม่สำเร็จ) ดู afterGet ใน handleSpecialSourceLocationScan
  private getSpecialFullPallet(entry: SpecialAwaitingSourceEntry, afterDone?: () => void): void {
    const fromLocation = this.resolveSpecialFromLocation(entry.item, entry.parsed.lot, entry.sourceLocation);
    const record = entry.fullPalletRecord;
    const qty = record?.qty ?? 0;
    const requestData = {
      qrCodes: [entry.code],
      itemId: entry.item.id,
      locationId: fromLocation?.location_id ?? 0,
      locationType: this._jobDataRaw?.from_location_type ?? '',
      palletSeq: entry.palletSeq,
      modeId: 1,
      updateBy: this._currentUserId,
    };

    //  จองน้ำหนักไว้ก่อนยิง request เสมอ (กัน pallet ถัดไปที่สแกนระหว่างรอ response resolve location ต้นทางซ้ำ) -> ดู _specialInFlightWeight
    const inFlightReservation = { locationName: fromLocation?.location_name ?? '', qty };
    this._specialInFlightWeight.push(inFlightReservation);
    const clearInFlightReservation = () => {
      this._specialInFlightWeight = this._specialInFlightWeight.filter((r) => r !== inFlightReservation);
    };

    this.scanApi.callJobApi(this._jobTypeFlags, 'get', this._jobDataRaw.id, requestData).subscribe({
      next: () => {
        clearInFlightReservation();
        entry.item.receive_qty = (entry.item.receive_qty ?? 0) + qty;
        this.adjustSpecialFromLocationReceived(fromLocation, qty);
        entry.item.qrCode = entry.code;

        const entryId = Date.now();
        this._jobDataRaw.pallets ??= {};
        this._jobDataRaw.pallets.receive_pallet ??= [];
        this._jobDataRaw.pallets.receive_pallet.push({
          id: entryId,
          pallet_seq: entry.palletSeq,
          grade: entry.item.grade,
          lot: entry.parsed.lot,
          qty,
          scanned_qr_code: entry.code,
        });

        this.pushIntoSpecialOpenPallet(entry.palletSeq, {
          id: String(record?.pallet_no ?? record?.id ?? entry.parsed.palletId),
          grade: this.scanLogic.fallback(entry.item.grade),
          lotNo: this.scanLogic.fallback(entry.item.lot_no || entry.parsed.lot),
          qty,
          isActive: true,
          isChecked: true,
          isSelectedForPlacement: false,
          targetLocations: this.scanLogic.buildTargetLocations(entry.item, entry.item.lot_no || entry.parsed.lot),
          itemId: entry.item.id,
          fromLocationId: fromLocation?.location_id,
          costCenter: entry.parsed.costCenter,
          qrCode: entry.code,
          palletSeq: entry.palletSeq,
          specialEntryId: entryId,
        });

        this.SweetAlert('success', `รับพาเลทเต็มสำเร็จ (${qty} กก.)`).then(() => afterDone?.());

        //  Jumbo Bag ที่ auto เปิดกล่องของตัวเอง (ไม่ใช่กล่องที่ user กด Add Pallet ไว้) -> ข้าม "เตรียมเอาไปวาง" ไปเข้า
        //  รายการที่รอวางเลยทันที ไม่ต้องรอ user กดปุ่มเอง (ดู autoReady ด้านบน ตอน push เข้า _specialAwaitingSourceLocation)
        //  งาน RQ/IT/Transfer WH ฝั่ง Outbound: auto-ready เสมอเหมือนกัน ไม่ว่าจะ join กล่องเดิมหรือเปิดกล่องใหม่ (entry.autoReady
        //  เดิมออกแบบไว้แค่เคส Jumbo Bag เปิดกล่องเอง ไม่ครอบคลุมเคส "เอาทั้ง pallet" ที่ join กล่อง active อยู่ด้วย)
        //  งาน 2-step: ยังต้องเข้ารายการรอวางเหมือนเดิม (ไม่งั้นการ์ดค้างอยู่ในกล่องเปล่าๆ ไม่มีสถานะให้โชว์) แค่ไม่เลือก
        //  อัตโนมัติ (ไม่ขึ้นแดง) เหมือนงานปกติที่มี autoSelectPalletsIfEligible กัน _isMultiStep ไว้อยู่แล้ว -> รอให้
        //  คนขับ/Step 2 มาสแกนเลือกเองทีหลัง (ดู autoSelect param ของ onClickReadyToPlaceSpecialPallet)
        if (entry.autoReady || this._readyRightAfterGet) {
          this.onClickReadyToPlaceSpecialPallet(entry.palletSeq, !this._isMultiStep);
        }

        this.saveJobDataToSession();
        this.refreshDisplayList();
        this.focusScannerInput();
      },
      error: (err) => {
        clearInFlightReservation();
        //  Get ไม่สำเร็จ -> คืน entry กลับเข้า _specialAwaitingSourceLocation เหมือนก่อนสแกน Location ต้นทาง (กล่องว่างที่
        //  สร้างไว้ก่อนหน้านี้ใน _specialOpenPallets ยังอยู่พอดี ไม่ต้องสร้างใหม่) กลับไปเป็นสถานะ "รอสแกน Location" (ม่วง)
        //  ให้สแกน Location เดิมซ้ำเพื่อลอง Get ใหม่ได้เลย ไม่ต้องสแกนถุง/โค้ดใหม่ตั้งแต่ต้น -> กันกล่องค้างลอยๆ ไม่มีถุง
        //  ไม่มีทางรีสแกนต่อเหมือนเดิม (เจอจริงตอนทดสอบ)
        this._specialAwaitingSourceLocation = [...this._specialAwaitingSourceLocation, entry];
        this.saveJobDataToSession();
        this.refreshDisplayList();
        this.SweetAlert('error', this.apiErrorMessage(err, 'ไม่สามารถรับพาเลทเต็มได้ กรุณาสแกน Location ต้นทางใหม่อีกครั้ง')).then(() => afterDone?.());
      },
    });
  }

  //  รวม entry 2 แบบที่พร้อมยิงอัตโนมัติแล้ว (เต็ม pallet/Jumbo + ถุงที่ล็อกไว้แล้ว) ที่ Location ต้นทางเดียวกันนี้ ยิง
  //  Get ทีละ request ต่อเนื่องกัน (concat) เหมือน handleLocationScan ฝั่งปลายทาง กัน request หลายใบชนกันที่ backend
  //  ตอนเช็ค/บวกโควต้าของ location ต้นทางเดียวกันพร้อมกันจริง ไม่รวมเป็น qrCodes เดียวกันหลายใบ เพราะคนละ item/คนละ
  //  modeId กันได้ (เต็ม pallet = modeId 1 ถุงนับเอง = modeId 2/3 ตาม lockedMode) ยิงแยกทีละรายการปลอดภัยกว่า
  //  เรียกเฉพาะตอน autoTotal >= 2 เท่านั้น (ดู handleSpecialSourceLocationScan) อาจเป็นเต็ม pallet ล้วน/ถุงล็อกล้วน/ปนกันก็ได้
  private getSpecialLocationBatch(
    fullPalletEntries: SpecialAwaitingSourceEntry[],
    lockedBagEntries: SpecialAwaitingSourceEntry[],
    code: string,
    afterDone?: () => void,   //  เรียกหลัง popup ผล Get ปิด ดู afterGet ใน handleSpecialSourceLocationScan
  ): void {
    const entries = [...fullPalletEntries, ...lockedBagEntries];
    const matchedSet = new Set(entries);
    this._specialAwaitingSourceLocation = this._specialAwaitingSourceLocation.filter((e) => !matchedSet.has(e));

    //  คำนวณหลัง filter ออกจาก _specialAwaitingSourceLocation แล้ว -> น้ำหนักของ entries ชุดนี้เองจะไม่ถูกนับเป็น
    //  "pending" ซ้ำกับ demand ที่กำลังจะเช็คด้านล่าง (_specialAwaitingWeightByLocationName อ่านจาก array นี้ตรงๆ)
    const extraWeight = this._specialAwaitingWeightByLocationName;
    const fullPerEntry = fullPalletEntries.map((entry) => ({
      entry,
      isFullPallet: true as const,
      qty: entry.fullPalletRecord?.qty ?? 0,
      qrCodes: [entry.code],
      modeId: 1,
      fromLocation: this.resolveSpecialFromLocation(entry.item, entry.parsed.lot, entry.sourceLocation, extraWeight),
    }));
    const bagPerEntry = lockedBagEntries.map((entry) => {
      const qrCodes = entry.lockedCodes ?? [entry.code];
      return {
        entry,
        isFullPallet: false as const,
        qty: this.computeSpecialModalQty(entry.fullPalletRecord, qrCodes.length),
        qrCodes,
        modeId: entry.lockedMode === 'store' ? 2 : 3,
        fromLocation: this.resolveSpecialFromLocation(entry.item, entry.parsed.lot, entry.sourceLocation, extraWeight),
      };
    });
    const perEntry = [...fullPerEntry, ...bagPerEntry];

    //  รวม demand ต่อ rawLocation object จริง (ไม่ใช่แค่ชื่อ location ซ้ำกัน) เพราะ entries คนละ item อาจ resolve ไปคนละ
    //  record ของ from_locations ทั้งที่ location_name ตรงกัน (เหมือน tryAutoAssignMultiLocationPallets ฝั่งปลายทาง)
    const demandByLocation = new Map<any, { weight: number; locationName: string }>();
    perEntry.forEach(({ qty, fromLocation }) => {
      if (!fromLocation) return;
      const d = demandByLocation.get(fromLocation) ?? { weight: 0, locationName: fromLocation.location_name };
      d.weight += qty;
      demandByLocation.set(fromLocation, d);
    });

    for (const [rawLocation, demand] of demandByLocation) {
      if (!this.scanLogic.hasEnoughFromLocationCapacity(rawLocation, demand.weight, this._sessionPalletLists, extraWeight)) {
        //  ไม่พอ -> คืนทุก entry กลับเข้าคิวทั้งกลุ่ม (fail closed เหมือน tryAutoAssignMultiLocationPallets) ไม่ยิงอะไรเลย
        this._specialAwaitingSourceLocation = [...this._specialAwaitingSourceLocation, ...entries];
        this.SweetAlert(
          'error',
          `Location ต้นทาง "${this.formatLocationDisplay(demand.locationName)}" เหลือที่ไม่พอสำหรับของที่รออยู่ทั้งหมด (ต้องการรวม ${demand.weight} กก.) กรุณาตรวจสอบข้อมูลหรือลองสแกน Location นี้ใหม่อีกครั้ง`,
        ).then(() => afterDone?.());
        return;
      }
    }

    //  จองน้ำหนักไว้ก่อนยิงทุกรายการ (เหมือน flow เดี่ยวเดิม ดู _specialInFlightWeight) ตลอดช่วงที่ยิงทีละรายการตามลำดับด้านล่าง
    const reservations = perEntry.map(({ qty, fromLocation }) => ({ locationName: fromLocation?.location_name ?? '', qty }));
    this._specialInFlightWeight.push(...reservations);

    const requests = perEntry.map(({ entry, qrCodes, modeId, fromLocation }) => {
      const requestData = {
        qrCodes,
        itemId: entry.item.id,
        locationId: fromLocation?.location_id ?? 0,
        locationType: this._jobDataRaw?.from_location_type ?? '',
        palletSeq: entry.palletSeq,
        modeId,
        updateBy: this._currentUserId,
      };
      return this.scanApi.callJobApi(this._jobTypeFlags, 'get', this._jobDataRaw.id, requestData).pipe(
        map(() => ({ success: true as const })),
        catchError((err) => of({ success: false as const, message: this.apiErrorMessage(err, 'ไม่สามารถรับของได้') })),
      );
    });

    concat(...requests).pipe(toArray()).subscribe((results) => {
      const succeededDisplay: PalletToPlaceItem[] = [];
      const failedDisplay: PalletToPlaceItem[] = [];
      const failedMessages = new Map<PalletToPlaceItem, string>();
      const readySeqs = new Set<number>();

      results.forEach((result, i) => {
        const { entry, qty, fromLocation, qrCodes, isFullPallet } = perEntry[i];
        this._specialInFlightWeight = this._specialInFlightWeight.filter((r) => r !== reservations[i]);

        const display: PalletToPlaceItem = {
          id: isFullPallet ? String(entry.fullPalletRecord?.pallet_no ?? entry.fullPalletRecord?.id ?? entry.parsed.palletId) : null,
          grade: this.scanLogic.fallback(entry.item.grade),
          lotNo: this.scanLogic.fallback(entry.item.lot_no || entry.parsed.lot),
          qty,
          isActive: true,
          isChecked: true,
          isSelectedForPlacement: false,
          targetLocations: this.scanLogic.buildTargetLocations(entry.item, entry.item.lot_no || entry.parsed.lot),
          itemId: entry.item.id,
          fromLocationId: fromLocation?.location_id,
          costCenter: entry.parsed.costCenter,
          qrCode: qrCodes[0],
          bagCodes: isFullPallet ? undefined : qrCodes.slice(1),
          palletSeq: entry.palletSeq,
        };

        if (result.success) {
          entry.item.receive_qty = (entry.item.receive_qty ?? 0) + qty;
          this.adjustSpecialFromLocationReceived(fromLocation, qty);
          entry.item.qrCode = qrCodes[0];

          const entryId = Date.now() + i;   //  +i กัน id ชนกันตอนยิงหลายรายการในลูปเดียวกัน (Date.now() ความละเอียดแค่ ms)
          this._jobDataRaw.pallets ??= {};
          this._jobDataRaw.pallets.receive_pallet ??= [];
          this._jobDataRaw.pallets.receive_pallet.push({
            id: entryId, pallet_seq: entry.palletSeq, grade: entry.item.grade, lot: entry.parsed.lot, qty, scanned_qr_code: qrCodes[0],
          });

          this.pushIntoSpecialOpenPallet(entry.palletSeq, { ...display, specialEntryId: entryId });

          //  งาน RQ/IT/Transfer WH ฝั่ง Outbound: ปิดกล่องให้เองเสมอไม่ว่าเต็ม pallet หรือถุงนับเอง (เหมือน
          //  getSpecialFullPallet/onConfirmSpecialQty เดี่ยว) ถุงนับเองฝั่งอื่น (ไม่ outbound) ต้องรอ item ครบก่อน
          const remainingAfter = Math.max(0, (entry.item.total_qty ?? 0) - (entry.item.receive_qty ?? 0) - (entry.item.complete_qty ?? 0));
          if (
            entry.autoReady
            || this._readyRightAfterGet
            || (!isFullPallet && (this._isAutoSpecialJob) && remainingAfter <= 0)
          ) {
            readySeqs.add(entry.palletSeq);
          }
          succeededDisplay.push(display);
        } else {
          this._specialAwaitingSourceLocation = [...this._specialAwaitingSourceLocation, entry];
          if (result.message) failedMessages.set(display, result.message);
          failedDisplay.push(display);
        }
      });

      //  เรียกครั้งเดียวต่อกล่อง หลังจากทุก entry ของ batch ผลักเข้า _specialOpenPallets ครบแล้ว (ดีกว่าเรียกทันทีทุก entry
      //  แบบเดี่ยว เพราะ 2 entry grade/lot เดียวกันที่แบ่งกล่องเดียวกันจะได้ merge เป็นการ์ดเดียวจริง ไม่ใช่ปิดกล่องทันทีที่
      //  entry แรกเข้า แล้วเปิดกล่องใหม่ซ้อนให้ entry ที่สอง) งาน 2-step ไม่ auto-select เหมือนเดิม
      readySeqs.forEach((seq) => this.onClickReadyToPlaceSpecialPallet(seq, !this._isMultiStep));

      this.saveJobDataToSession();
      this.refreshDisplayList();
      this.focusScannerInput();
      this.notifySpecialWeightBatchResult('รับของ', succeededDisplay, failedDisplay, failedMessages).then(() => afterDone?.());
    });
  }

  //  ─────────────────────────────────────────────────────────────
  //  SPECIAL JOB: MODAL CONTROLS (เปิด/ปิด/ปุ่มสแกน/โหมดพิมพ์เอง)
  //  ─────────────────────────────────────────────────────────────
  onCloseSpecialQtyModal(): void {
    this._specialQtyModal = null;
    this._isSpecialBagScanning = false;
    this._isSpecialManualInputMode = false;
    this._specialManualInputValue = '';
    this.focusScannerInput();
  }

  //  ปุ่มสแกนถุงใน modal -> เปิดโหมดสแกน (concept เดียวกับปุ่มสแกนหน้า login/scan-pallet)
  onClickSpecialBagScanButton(): void {
    this._isSpecialBagScanning = true;
    this.focusScannerInput();
  }

  //  โฟกัสหลุดจากช่องสแกนตอน modal สแกนถุงเปิดอยู่ -> ปิดโหมดสแกน ต้องกดปุ่มใหม่ถึงจะกลับมารับค่าได้อีกครั้ง
  onScannerInputBlur(): void {
    if (this._specialQtyModal) {
      this._isSpecialBagScanning = false;
    }
  }

  //  toggle สแกนจริง <-> พิมพ์โค้ดถุงเอง ใน modal (concept เดียวกับ toggle "พิมพ์" หน้า scan-pallet)
  onToggleSpecialManualInputMode(checked: boolean): void {
    this._isSpecialManualInputMode = checked;
    this._specialManualInputValue = '';
    if (!checked) this.focusScannerInput();
  }

  //  ยืนยันโค้ดถุงที่พิมพ์เอง -> เข้า flow เดียวกับสแกนจริงทุกอย่าง (handleSpecialBagScanForModal)
  //  บังคับเปิดโหมดสแกนไปด้วย เพราะ manual input ข้ามปุ่ม "กดเพื่อสแกนถุงเพิ่ม" ไป (เหมือน onClickSubmitManualInput หน้าปกติ)
  onClickSubmitSpecialManualInput(): void {
    const code = this._specialManualInputValue.trim();
    if (!code) return;
    this._specialManualInputValue = '';
    this._isSpecialBagScanning = true;
    this.handleSpecialBagScanForModal(code);
  }

  //  ─────────────────────────────────────────────────────────────
  //  SPECIAL JOB: MODAL QTY CALCULATION
  //  ─────────────────────────────────────────────────────────────
  //  กก. รวมของถุง N ใบ ใน modal นี้ -> ใช้ record ของถุงใบแรกที่สแกนเป็นอัตราส่วน (BE ส่ง unit_ratio มาให้ตรงๆแล้วถ้ามี
  //  ไม่มีก็ fallback เป็น qty/unit_pallet แล้วค่อย fallback นับจำนวนถุงตรงๆ) ใช้สูตรเดียวกันทั้ง 3 จุด: โชว์ real-time,
  //  เช็คก่อนรับถุงเพิ่มเข้า modal (handleSpecialBagScanForModal), และตอนกดยืนยันจริง (onConfirmSpecialQty)
  private computeSpecialModalQty(record: any, bagCount: number): number {
    const unitPallet = record?.unit_pallet ?? 0;
    const qtyPerBag = record?.unit_ratio ?? (unitPallet > 0 ? (record?.qty ?? 0) / unitPallet : 0);
    return qtyPerBag > 0 ? Math.round(qtyPerBag * bagCount * 100) / 100 : bagCount;
  }

  //  น้ำหนักของถุงที่สแกนค้างอยู่ใน modal (ยังไม่กดยืนยัน) แบบ real-time -> โชว์ "X/Y กก." ที่หัว modal ให้ขยับตามทันที
  //  ที่สแกนแต่ละใบ ไม่ใช่รอ backend ตอบกลับหลังกดยืนยันก่อน
  get _specialModalScannedQty(): number {
    const modal = this._specialQtyModal;
    if (!modal) return 0;
    return this.computeSpecialModalQty(modal.sourceRecord, modal.scannedCodes.length);
  }

  //  ยอดคงเหลือจริงที่ใช้บล็อกการสแกนถุงเพิ่ม = min(งานเหลือ, พาเลทต้นทางมีจริง) กันสแกนเกินทั้ง 2 ทาง (เกินงานต้องการ
  //  หรือเกินของจริงที่มีบนพาเลทใบนี้) ไม่มี sourceRecord (เช่น flow "ส่งให้ Step 2" ที่ไม่มี GetProcessPallet lookup)
  //  -> fallback เหลือแค่เช็คงานอย่างเดียวเหมือนเดิม
  get _specialModalEffectiveRemaining(): number {
    const modal = this._specialQtyModal;
    if (!modal) return 0;
    const palletQty = modal.sourceRecord?.qty;
    return palletQty != null ? Math.min(modal.remaining, palletQty) : modal.remaining;
  }

  //  true ถ้าพาเลทใบนี้มี qty มากกว่ายอดงานที่เหลือ (เอาทั้งใบไม่ได้จริง ต้องนับถุงเอาแค่เท่าที่ต้องการ) -> ซ่อนปุ่ม
  //  "เลือกทั้งหมด" กันกดแล้วพยายามเอาเกินโควต้า (เคสเดียวกับที่ checkSpecialFullPalletThenQueue ข้าม auto-confirm/popup
  //  นอก modal ไปแล้วถ้าเกินแบบนี้ -> ต้อง sync เงื่อนไขเดียวกันไว้ที่นี่ด้วย กันปุ่มในนี้ขึ้นสวนทาง)
  get _specialModalFullPalletExceedsRemaining(): boolean {
    const modal = this._specialQtyModal;
    const palletQty = modal?.sourceRecord?.qty;
    return palletQty != null && modal != null && palletQty > modal.remaining;
  }

  //  ─────────────────────────────────────────────────────────────
  //  SPECIAL JOB: BAG SCAN WITHIN MODAL (เพิ่ม/ลบถุงใน modal ที่เปิดอยู่)
  //  ─────────────────────────────────────────────────────────────
  //  toggle เอาออก/จัดเก็บ -> สลับความหมายของถุงที่สแกนเข้า modal นี้ เคลียร์ hint เก่าทิ้ง
  onSelectSpecialQtyMode(mode: 'take' | 'store'): void {
    if (!this._specialQtyModal) return;
    this._specialQtyModal.mode = mode;
    this._specialQtyModal.hint = null;
  }

  //  ระหว่างเปิด modal สแกนถุง -> ทุกโค้ดที่ปืนสแกนยิงเข้ามา (routed จาก onScannerEnter) ถูกเพิ่มเข้าที่นี่แทนที่จะเข้า flow ปกติ
  handleSpecialBagScanForModal(code: string): void {
    const modal = this._specialQtyModal;
    if (!modal || !this._isSpecialBagScanning) return;

    const parsed = this.parseScanCode(code);
    if (!parsed) {
      this.SweetAlert('error', 'QR Code ไม่ถูกต้อง กรุณาสแกน QR Code ถุงให้ถูกต้อง');
      return;
    }

    if (!this.scanLogic.gradesMatch(parsed.grade, modal.parsed.grade) || parsed.lot !== modal.parsed.lot) {
      this.SweetAlert('error', 'ถุงนี้เกรด/ล๊อตไม่ตรงกับรายการที่กำลังสแกนอยู่');
      return;
    }

    //  กันถุงจากพาเลทต้นทางคนละใบ (เกรด/ล็อตตรงกันได้ แต่เลขท้ายโค้ดที่ระบุ pallet ต้นทางจริงต้องตรงกับถุงใบแรกที่เปิด modal นี้)
    if (parsed.palletId !== modal.parsed.palletId) {
      this.SweetAlert('error', 'ถุงนี้มาจากพาเลทต้นทางคนละใบ (เลขท้ายโค้ดไม่ตรงกัน) กรุณาสแกนถุงจากพาเลทเดียวกัน');
      return;
    }

    if (modal.scannedCodes.includes(code)) {
      this.SweetAlert('warning', 'ถุงนี้สแกนไปแล้ว กรุณาสแกนถุงใบอื่น');
      return;
    }

    //  ถุงใบนี้อาจมาจาก pallet ต้นทางเดียวกันแต่เป็นถุงที่วางเสร็จไปแล้ว (complete_pallet/_completedPalletList) -> เช็คด้วย
    //  checkPalletIdConflict ตัวเดียวกับตอนสแกนถุงใบแรกเข้า handleSpecialScannedCode ไม่ใช่แค่ซ้ำกับ modal.scannedCodes ด้านบน
    const conflict = this.scanLogic.checkPalletIdConflict(code, this._jobDataRaw, this._sessionPalletLists);
    if (conflict) {
      this.SweetAlert(conflict.icon, conflict.message);
      return;
    }

    //  ถุงที่สแกนเข้าพาเลทอื่นในเครื่องนี้ไปแล้วแต่ยังไม่ได้วาง: Get แล้วรอวาง (_palletToPlaceList), Get แล้วแต่กล่องยังไม่ปิด
    //  (_specialOpenPallets) หรือกดยืนยันไว้ในกล่องอื่นรอสแกน Location ต้นทาง (lockedCodes) -> เตือนทันทีตอนสแกน ไม่ต้องรอ
    //  backend ปฏิเสธตอน Get (ไม่นับ entry ของ modal นี้เอง) ถุงที่รถคันอื่นเพิ่งรับไประหว่างอยู่หน้านี้เครื่องนี้ไม่รู้
    //  (งาน 1-step ไม่ sync receive_pallet ระหว่างอยู่หน้านี้) ยังให้ backend ดักตอน Get เหมือนเดิม
    const hasCode = (p: PalletToPlaceItem) => this.scanLogic.palletHasCode(p, code);
    const takenElsewhere =
      this._palletToPlaceList.some(hasCode)
      || this._specialOpenPallets.some((g) => g.entries.some(hasCode))
      || this._specialAwaitingSourceLocation.some(
        (e) => e.code !== modal.code && [e.code, ...(e.lockedCodes ?? [])].some((c) => this.scanLogic.qrCodesMatch(c, code)),
      );
    if (takenElsewhere) {
      this.SweetAlert('warning', 'ถุงนี้ถูกสแกนเข้าพาเลทอื่นไปแล้ว (ยังไม่ได้วาง) กรุณาสแกนถุงใบอื่น');
      return;
    }

    //  เช็คโควต้าก่อนรับถุงเข้ารายการทุกครั้ง (ไม่ใช่รอไปเช็คตอนกดยืนยันอย่างเดียว) -> ถุงที่ทำให้เกิน min(งานเหลือ, พาเลทมีจริง)
    //  สแกนเข้าไม่ได้เลย (ดู _specialModalEffectiveRemaining) ข้อความบอกให้ตรงว่าชนขีดจำกัดไหน กันงง
    const effectiveRemaining = this._specialModalEffectiveRemaining;
    const nextQty = this.computeSpecialModalQty(modal.sourceRecord, modal.scannedCodes.length + 1);
    if (nextQty > effectiveRemaining) {
      const palletQty = modal.sourceRecord?.qty;
      const hitsPalletLimit = palletQty != null && palletQty < modal.remaining;
      this.SweetAlert(
        'error',
        hitsPalletLimit
          ? `สแกนถุงนี้เพิ่มจะเกินน้ำหนักจริงของพาเลทใบนี้ (มี ${palletQty} กก.) กรุณากดยืนยันเท่าที่มีอยู่ก่อน`
          : `สแกนถุงนี้เพิ่มจะเกินยอดคงเหลือของงาน (เหลือ ${modal.remaining} กก.) กรุณากดยืนยันเท่าที่มีอยู่ก่อน`,
      );
      return;
    }

    modal.scannedCodes.push(code);
    modal.hint = null;
  }

  //  เอาถุงที่สแกนพลาดออกจากรายการใน modal (แก้ไขก่อนกดยืนยัน)
  onRemoveSpecialScannedBag(code: string): void {
    const modal = this._specialQtyModal;
    if (!modal) return;
    modal.scannedCodes = modal.scannedCodes.filter((c) => c !== code);
    modal.hint = null;
  }

  //  ─────────────────────────────────────────────────────────────
  //  BK เท่านั้น: COMPLETION HELPERS
  //  ─────────────────────────────────────────────────────────────
  //  งาน BK: ทุก item ใน job ได้ receive_qty ครบ total_qty แล้วหรือยัง (ไม่นับ complete_qty เพราะ BK ไม่มีขั้น put-away)
  private isBkJobFullyReceived(): boolean {
    const items = this._jobDataRaw?.items ?? [];
    if (items.length === 0) return false;
    //  backend ย้ายยอดจาก receive_qty ไป complete_qty ได้ (receive_qty รีเซ็ตเป็น 0) -> ต้องรวมสองตัวเหมือน "remaining" ที่อื่นในไฟล์นี้
    return items.every((it: any) => (it.receive_qty ?? 0) + (it.complete_qty ?? 0) >= (it.total_qty ?? 0));
  }

  //  ข้อความปลายทางที่จะให้ user นำของไปวาง (เป็น text ล้วน ไม่ใช่ location ที่สแกนได้) — เอาจาก item แรกที่มี to_locations
  private getBkDestinationLabel(): string {
    const items = this._jobDataRaw?.items ?? [];
    const toLocation = items.map((it: any) => it.locations?.to_locations?.[0]).find((loc: any) => loc?.location_name);
    return this.formatLocationDisplay(toLocation?.location_name) || this._jobDataRaw?.to_location_cc_desc || '-';
  }

  //  ─────────────────────────────────────────────────────────────
  //  SPECIAL JOB: MODAL CONFIRM / SUBMIT
  //  ─────────────────────────────────────────────────────────────
  //  ปุ่มยืนยัน (เขียว) -> ยิง API Get ด้วย qrCodes ของทุกถุงที่สแกนเข้า modal นี้ backend คำนวณ กก. เองจากโค้ดที่ส่งไป
  //  FE คำนวณ กก. เองคู่ขนานไว้ (ใช้ record ของถุงใบแรก unit_pallet/qty เป็นอัตราส่วน) เพื่อเช็คโควต้า/แสดงผลเท่านั้น
  onConfirmSpecialQty(): void {
    const modal = this._specialQtyModal;
    if (!modal) return;

    if (modal.scannedCodes.length < 1) {
      modal.hint = 'กรุณาสแกนถุงอย่างน้อย 1 ใบ';
      return;
    }

    //  เช็คโควต้าคงเหลือจากค่าจริงล่าสุดของ item อีกครั้ง (ไม่ใช้ modal.remaining ที่ cache ไว้ตอนเปิด modal เฉยๆ)
    //  กัน over-receive ถ้ามีการ Get item เดียวกันสำเร็จไปแล้วจากที่อื่นระหว่างที่ modal นี้เปิดค้างอยู่
    const itemRemaining = Math.max(
      0,
      (modal.item.total_qty ?? 0) - (modal.item.receive_qty ?? 0) - (modal.item.complete_qty ?? 0),
    );
    modal.remaining = Math.min(itemRemaining, modal.serverRemaining ?? Number.POSITIVE_INFINITY);
    if (modal.remaining <= 0) {
      this.SweetAlert('error', `เกรด/ล๊อต "${modal.item.grade}" นี้ครบตามจำนวนที่ต้องการแล้ว`);
      this._specialQtyModal = null;
      return;
    }

    const qty = this.computeSpecialModalQty(modal.sourceRecord, modal.scannedCodes.length);

    if (qty > modal.remaining) {
      modal.hint = `จำนวนที่สแกน (${qty} กก.) เกินยอดที่เหลือ ${modal.remaining} กก. กรุณาเอาถุงออกบางส่วน`;
      return;
    }
    modal.hint = null;

    const modeId = modal.mode === 'take' ? 3 : 2;   //  3 = Pick Bag (เอาออก), 2 = Store Bag (จัดเก็บ)
    const fromLocation = this.resolveSpecialFromLocation(modal.item, modal.parsed.lot, modal.sourceLocation);
    const requestData = {
      qrCodes: modal.scannedCodes,
      itemId: modal.item.id,
      locationId: fromLocation?.location_id ?? 0,
      locationType: this._jobDataRaw?.from_location_type ?? '',
      palletSeq: modal.palletSeq,
      modeId,
      updateBy: this._currentUserId,
    };

    //  จองน้ำหนักไว้ก่อนยิง request เสมอ (กัน pallet ถัดไปที่สแกนระหว่างรอ response resolve location ต้นทางซ้ำ) -> ดู _specialInFlightWeight
    const inFlightReservation = { locationName: fromLocation?.location_name ?? '', qty };
    this._specialInFlightWeight.push(inFlightReservation);
    const clearInFlightReservation = () => {
      this._specialInFlightWeight = this._specialInFlightWeight.filter((r) => r !== inFlightReservation);
    };

    this.scanApi.callJobApi(this._jobTypeFlags, 'get', this._jobDataRaw.id, requestData).subscribe({
      next: () => {
        clearInFlightReservation();
        modal.item.receive_qty = (modal.item.receive_qty ?? 0) + qty;
        this.adjustSpecialFromLocationReceived(fromLocation, qty);

        //  เก็บ qrCode ที่สแกนไว้ที่ตัว item (ซึ่งอยู่ใน _jobDataRaw -> ถูก save ลง sessionStorage ด้วย saveJobDataToSession()
        //  ด้านล่าง) กันหายตอนออกจากหน้า scan-pallet แล้วกลับเข้ามาใหม่ (งาน 1-step ไม่มีจุดสแกนซ้ำให้ได้ qrCode คืนมา)
        modal.item.qrCode = modal.scannedCodes[0];

        const entryId = Date.now();
        this._jobDataRaw.pallets ??= {};
        this._jobDataRaw.pallets.receive_pallet ??= [];
        this._jobDataRaw.pallets.receive_pallet.push({
          id: entryId,
          pallet_seq: modal.palletSeq,
          grade: modal.item.grade,
          lot: modal.item.lot_no || modal.parsed.lot,
          qty,
          scanned_qr_code: modal.scannedCodes[0],
        });

        //  Get ครั้งนี้เสร็จแล้ว -> ผลักเข้า pallet ที่กำลังเตรียมอยู่ (ยังไม่ใช่รอวางจริง จนกว่าจะกด "เตรียมเอาไปวาง")
        this.pushIntoSpecialOpenPallet(modal.palletSeq, {
          //  ถุงที่มาจาก Step 2 -> ใช้ palletId ที่สแกนได้จริง (parse แล้ว เช่น "010" -> "10") เป็น id แสดงผล
          //  ถุงปกติ (Get เอง) -> ไม่มี id เดี่ยวๆ ที่มีความหมาย -> เป็น null เหมือนเดิม
          id: modal.isStep2Continuation ? modal.parsed.palletId : null,
          grade: this.scanLogic.fallback(modal.item.grade),
          //  ไม่มี lot_no รวม -> ใช้ lot ที่สแกนได้จริง (ตรงกับ addon_lot ที่ match ไว้ตอน resolveSpecialItemForScan)
          lotNo: this.scanLogic.fallback(modal.item.lot_no || modal.parsed.lot),
          qty,
          isActive: true,
          isChecked: true,
          isSelectedForPlacement: false,
          targetLocations: this.scanLogic.buildTargetLocations(modal.item, modal.item.lot_no || modal.parsed.lot),
          itemId: modal.item.id,
          fromLocationId: fromLocation?.location_id,
          costCenter: modal.parsed.costCenter,
          qrCode: modal.scannedCodes[0],   //  เก็บโค้ดที่สแกนตอน Get ไว้ ใช้ส่งซ้ำตอน Put-away
          //  โค้ดถุงใบที่ 2 เป็นต้นไปใน modal นี้ (scannedCodes ทั้งหมดถูกส่งไป Get พร้อมกันเป็น array เดียว แต่ backend
          //  แยกเป็น record ละ 1 ถุงต่อใบ) ต้องเก็บไว้ด้วย ไม่งั้น knownCodes ของ auto-fetch (refreshJobProgressFromServer)
          //  จะไม่รู้จักโค้ดพวกนี้ -> เข้าใจผิดว่าเป็นถุงใหม่ สร้าง pallet ลอยซ้อนขึ้นมาอีกก้อนตอน tick ถัดไป
          bagCodes: modal.scannedCodes.slice(1),
          palletSeq: modal.palletSeq,
          specialEntryId: entryId,
        });

        //  งาน BK: ไม่ขึ้นผล Get ตรงนี้ -> ปิดกล่องแล้วยิง Put ต่อให้เองทันที (ด้านล่าง) สรุปผลทีเดียวตอน Put จบ (runPutAway)
        if (!this._isBkJob) {
          this.SweetAlert('success', `รับสำเร็จ ${qty} กก. (${modal.scannedCodes.length} ถุง)`);
        }

        //  งาน RQ/IT/Transfer WH ฝั่ง Outbound เท่านั้น: ไม่มีปุ่ม "เตรียมเอาไปวาง" ให้กดแล้ว (เอาออกไปตามที่ตกลงกัน) -> ปิดกล่องให้เอง
        //  ทันทีที่ Get ครั้งนี้สำเร็จ (กล่องนี้มีของแล้ว พร้อมวางได้เลย ไม่ต้องรอให้ item ครบทั้งก้อนก่อน เพราะแต่ละกล่องคือ
        //  pallet จริงคนละใบที่พร้อมเอาไปวางได้เอง เจอจริงจากงานที่ต้อง Get หลายรอบกว่าจะครบ: Get รอบแรกไม่ครบ item เลยไม่เคย
        //  auto-ready ให้ ต้องออกจากหน้าแล้วเข้าใหม่ค่อยเห็น) -- ไม่แตะงาน Inbound เด็ดขาดตามที่ตกลงกัน ยังใช้เงื่อนไข
        //  "item ครบเท่านั้น" แบบเดิมต่อไป
        //  งาน 2-step: เหตุผลเดียวกับ flow getSpecialFullPallet ด้านบน (ยังเข้ารายการรอวาง แค่ไม่เลือกอัตโนมัติ)
        //  งาน BK: ปิดกล่องทุกครั้งเหมือนกัน แล้วยิง Put ต่อให้เอง (ดู _readyRightAfterGet / onClickReadyToPlaceSpecialPallet)
        if (this._readyRightAfterGet) {
          this.onClickReadyToPlaceSpecialPallet(modal.palletSeq, !this._isMultiStep);
        } else if (this._isAutoSpecialJob) {
          const remainingAfter = Math.max(
            0,
            (modal.item.total_qty ?? 0) - (modal.item.receive_qty ?? 0) - (modal.item.complete_qty ?? 0),
          );
          if (remainingAfter <= 0) this.onClickReadyToPlaceSpecialPallet(modal.palletSeq, !this._isMultiStep);
        }
        this._specialQtyModal = null;
        this._isSpecialBagScanning = false;
        this.saveJobDataToSession();
        this.refreshDisplayList();
        this.focusScannerInput();
      },
      error: (err) => {
        clearInFlightReservation();
        const errorMessage = this.apiErrorMessage(err, 'ไม่สามารถรับถุงได้ กรุณาลองใหม่อีกครั้ง');
        const quantityLimit = /กำหนด\s*([\d,.]+)\s*,\s*รับแล้ว\s*([\d,.]+)\s*,\s*ครั้งนี้\s*([\d,.]+)/.exec(errorMessage);
        const targetQty = quantityLimit ? Number(quantityLimit[1].replace(/,/g, '')) : NaN;
        const receivedQty = quantityLimit ? Number(quantityLimit[2].replace(/,/g, '')) : NaN;
        if (Number.isFinite(targetQty) && Number.isFinite(receivedQty)) {
          const serverRemaining = Math.max(0, targetQty - receivedQty);
          modal.serverRemaining = Math.min(modal.serverRemaining ?? Number.POSITIVE_INFINITY, serverRemaining);
          modal.remaining = Math.min(modal.remaining, modal.serverRemaining);
          modal.hint = `จำนวนที่สแกน (${qty} กก.) เกินยอดที่เหลือ ${modal.remaining} กก. กรุณาเอาถุงออกบางส่วน`;
        } else {
          modal.hint = 'ไม่สามารถอัปเดตได้ กรุณาลองใหม่อีกครั้ง';
        }
        this.SweetAlert('error', errorMessage);
      },
    });
  }

  //  ปุ่มยืนยัน (งาน RQ/Transfer WH/IT เท่านั้น, ยังไม่มี hint ค้าง) -> "ล็อก" จำนวนถุงที่นับไว้ ปิด modal ขึ้นการ์ดม่วง
  //  รอสแกน Location ต้นทาง ยังไม่ยิง Get จริง (ต้องสแกน Location ต้นทางก่อนเสมอ เป็น safeguard ว่ายืนอยู่หน้า location
  //  จริง ดู handleSpecialSourceLocationScan ที่จะยิง Get จริงตอนสแกน Location) เก็บรายการถุงทั้งหมดไว้ที่ entry
  //  (entry.lockedCodes) ก่อนปิด modal ไม่งั้นพอสแกน Location ทีหลังจะเหลือแค่ถุงใบแรก (เหมือนเคส × ปิด modal กลางคันเดิม)
  onLockSpecialQtyForLocationScan(): void {
    const modal = this._specialQtyModal;
    if (!modal) return;

    if (modal.scannedCodes.length < 1) {
      modal.hint = 'กรุณาสแกนถุงอย่างน้อย 1 ใบ';
      return;
    }

    const entry = this._specialAwaitingSourceLocation.find((e) => e.code === modal.code);
    if (entry) {
      entry.lockedCodes = [...modal.scannedCodes];
      entry.lockedMode = modal.mode;
    }

    this._specialQtyModal = null;
    this._isSpecialBagScanning = false;
    this.SweetAlert('success', `บันทึกจำนวนไว้แล้ว (${modal.scannedCodes.length} ถุง) สแกน Location ต้นทาง "${this.specialSourceLocationText(modal.item, modal.sourceLocation, this.computeSpecialModalQty(modal.sourceRecord, modal.scannedCodes.length))}" เพื่อส่งข้อมูล`);
    this.focusScannerInput();
  }

  //  toggle ปุ่ม "เลือกทั้งหมด" (งาน RQ/Transfer WH/IT เท่านั้น) -> สลับ UI ไปมาระหว่างนับทีละถุง/เอาทั้งพาเลท เฉยๆ
  //  ยังไม่แตะ entry จริง กด "ยกเลิก" (enable=false) กลับมานับทีละถุงต่อได้เหมือนไม่มีอะไรเกิดขึ้น (scannedCodes เดิมยังอยู่ครบ)
  onToggleSpecialSelectAll(enable: boolean): void {
    const modal = this._specialQtyModal;
    if (!modal) return;
    modal.selectAllMode = enable;
    modal.hint = null;
  }

  //  ปุ่มยืนยัน ตอนอยู่ในโหมด "เลือกทั้งหมด" -> ไม่ส่งถุงที่นับไว้เลย เปลี่ยน entry เป็น isFullPallet ตรงๆ (เหมือนตอบ "ใช่
  //  เลือกเต็มพาเลท" ตั้งแต่แรก) ยังไม่ยิง Get ทันที รอสแกน Location ต้นทางก่อนเหมือนเดิม (safeguard เดียวกับ
  //  onLockSpecialQtyForLocationScan) ตอนสแกน Location จะไปเข้าทาง getSpecialFullPallet/Batch ที่มีอยู่แล้วเอง
  //  (ดู handleSpecialSourceLocationScan) ไม่ต้องเขียน path ยิง Get ใหม่ซ้ำ
  private onConfirmSpecialSelectAll(): void {
    const modal = this._specialQtyModal;
    if (!modal || modal.sourceRecord?.qty == null) return;
    //  กันไว้อีกชั้น (ปุ่มที่เรียกมาซ่อนไปแล้วปกติ ดู _specialModalFullPalletExceedsRemaining) เผื่อโดนเรียกตอนพาเลทมี
    //  qty เกินยอดงานที่เหลือ -> เอาทั้งใบไม่ได้จริง ต้องนับถุงเอาแค่เท่าที่ต้องการแทน
    if (this._specialModalFullPalletExceedsRemaining) return;

    const entry = this._specialAwaitingSourceLocation.find((e) => e.code === modal.code);
    if (entry) {
      entry.isFullPallet = true;
      entry.lockedCodes = undefined;
      entry.lockedMode = undefined;
    }

    this._specialQtyModal = null;
    this._isSpecialBagScanning = false;
    this.SweetAlert('success', `เลือกเต็มพาเลทแล้ว (${modal.sourceRecord.qty} กก.) สแกน Location ต้นทาง "${this.specialSourceLocationText(modal.item, modal.sourceLocation, modal.sourceRecord.qty)}" เพื่อส่งข้อมูล`);
    this.focusScannerInput();
  }

  //  ปุ่มยืนยัน (เขียว) ใน modal นับถุง -> เลือกทั้งหมดอยู่: onConfirmSpecialSelectAll; ยังไม่ยืนยันต้นทาง:
  //  onLockSpecialQtyForLocationScan; ยืนยันต้นทางแล้ว: ส่ง Get ตรงๆ รวมถึง retry หลังแก้จำนวน
  onClickSpecialQtyConfirm(): void {
    const modal = this._specialQtyModal;
    if (!modal) return;
    if (modal.selectAllMode) {
      this.onConfirmSpecialSelectAll();
      return;
    }
    if (this._isAutoSpecialJob && !modal.sourceLocationConfirmed) {
      this.onLockSpecialQtyForLocationScan();
      return;
    }
    this.onConfirmSpecialQty();
  }

  //  ปุ่มน้ำเงิน "ส่งให้ Step 2" (เฉพาะงาน 2-step) -> ยกยอดที่เหลือทั้งหมดให้คนทำ Step 2 มา Get/Put ต่อ
  //  ต้องไม่มีถุงที่สแกนเพิ่มค้างอยู่ (เกินถุงแรกที่เปิด modal มา) กันกดพลาดตอนตั้งใจจะกดยืนยัน (Get เอง) อยู่
  onClickSpecialStep2(): void {
    const modal = this._specialQtyModal;
    if (!modal) return;

    if (modal.scannedCodes.length > 1) {
      modal.hint = 'กรุณาเอาถุงที่สแกนเพิ่มออกก่อนกดปุ่ม "ส่งให้ Step 2"';
      return;
    }

    //  เช็คโควต้าคงเหลือจากค่าจริงล่าสุดของ item อีกครั้ง (ไม่ใช้ modal.remaining ที่ cache ไว้ตอนเปิด modal เฉยๆ)
    //  กันส่งจำนวนเกินจริงให้ Step 2 ถ้ามีการ Get item เดียวกันสำเร็จไปแล้วระหว่างที่ modal นี้เปิดค้างอยู่
    modal.remaining = Math.max(
      0,
      (modal.item.total_qty ?? 0) - (modal.item.receive_qty ?? 0) - (modal.item.complete_qty ?? 0),
    );
    if (modal.remaining <= 0) {
      this.SweetAlert('error', `เกรด/ล๊อต "${modal.item.grade}" นี้ครบตามจำนวนที่ต้องการแล้ว`);
      this._specialQtyModal = null;
      return;
    }
    modal.hint = null;

    const fromLocation = this.scanLogic.resolveFromLocationForItem(modal.item, modal.parsed.lot, this._sessionPalletLists, true, this._specialAwaitingWeightByLocationName);
    const requestData = {
      qrCode: modal.code,
      qty: modal.remaining,
      itemId: modal.item.id,
      palletId: Number(modal.parsed.palletId) || 0,
      locationId: fromLocation?.location_id ?? 0,
      locationType: this._jobDataRaw?.from_location_type ?? '',
      updateBy: this._currentUserId,
    };

    //  จองน้ำหนักไว้ก่อนยิง request เสมอ (กัน pallet ถัดไปที่สแกนระหว่างรอ response resolve location ต้นทางซ้ำ) -> ดู _specialInFlightWeight
    const inFlightReservation = { locationName: fromLocation?.location_name ?? '', qty: modal.remaining };
    this._specialInFlightWeight.push(inFlightReservation);
    const clearInFlightReservation = () => {
      this._specialInFlightWeight = this._specialInFlightWeight.filter((r) => r !== inFlightReservation);
    };

    this.scanApi.prepareSpecialPallet(this._jobDataRaw.id, requestData).subscribe({
      next: () => {
        clearInFlightReservation();
        //  เก็บลง _jobDataRaw เอง (backend ตอบแค่ ResponseStandard ไม่มี entry ที่สร้างกลับมาให้)
        //  เพื่อให้การ์ดเหลือง "รอ Step 2 มารับ" ขึ้นบนหน้าจอคนแรกทันที ไม่ต้องรอโหลดหน้าใหม่
        this._jobDataRaw.pallets ??= {};
        this._jobDataRaw.pallets.prepare_pallet ??= [];
        this._jobDataRaw.pallets.prepare_pallet.push({
          grade: modal.item.grade,
          lot: this.scanLogic.resolveSpecialDisplayLot(modal.item) || modal.parsed.lot,
          qty: modal.remaining,
          scanned_qr_code: modal.code,
        });

        this.SweetAlert('success', `ส่งให้ Step 2 สำเร็จ ${modal.remaining} ถุง`);
        this._specialQtyModal = null;
        this.saveJobDataToSession();
        this.refreshDisplayList();
        this.focusScannerInput();
      },
      error: () => {
        clearInFlightReservation();
        modal.hint = 'ไม่สามารถส่งให้ Step 2 ได้ กรุณาลองใหม่อีกครั้ง';
        this.SweetAlert('error', 'ไม่สามารถส่งให้ Step 2 ได้ กรุณาลองใหม่อีกครั้ง');
      },
    });
  }

  //  ─────────────────────────────────────────────────────────────
  //  PALLET SELECTION (เลือก/ยกเลิกเลือก Pallet เพื่อรอวาง)
  //  ─────────────────────────────────────────────────────────────
  private selectPalletForPlacement(pallet: PalletToPlaceItem): void {
    if (pallet.isSelectedForPlacement) return;

    pallet.isSelectedForPlacement = true;
    this._selectedPalletsForPlacement.push(pallet);

    //  ย้ายขึ้นบนสุดของรายการด้วย -> เทียบด้วย reference (p === pallet) ไม่ใช่ p.id === pallet.id
    //  เพราะ pallet ของงาน Special ทุกใบมี id เป็น null เหมือนกันหมด เทียบด้วย id จะจับผิดใบได้ถ้ามีมากกว่า 1 รายการ
    const index = this._palletToPlaceList.findIndex((p) => p === pallet);
    if (index > -1) {
      this._palletToPlaceList.splice(index, 1);
      this._palletToPlaceList.unshift(pallet);
    }
  }

  private deselectAllPallets(): void {
    this._selectedPalletsForPlacement.forEach((p) => (p.isSelectedForPlacement = false));
    this._selectedPalletsForPlacement = [];
  }

  //  Inbound เท่านั้น: pallet ที่มี Location ปลายทางได้มากกว่า 1 ที่ ถูก auto-select (แดง) ไว้ตั้งแต่ verify เสร็จแล้ว (autoSelectPalletsIfEligible)
  //  พอยิง Location ปลายทาง -> รวมยอดทั้งกลุ่มที่ตรงกับ Location นี้เช็คโควต้า (จำนวนใบ + น้ำหนัก เหมือน preparePutAwayList) ก่อน
  //  พอ -> ไม่ต้องทำอะไร (เลือกไว้แล้ว) ปล่อยให้ flow เดิมด้านล่าง (matchingPallets/preparePutAwayList) วางให้ตามปกติ
  //  ไม่พอ -> ยกเลิกการเลือกเฉพาะกลุ่มนี้ (กลับไปยังไม่เลือก) เตือนให้สแกนเลือกเองทีละใบแทน (ใช้ flow "ยิง pallet id ก่อน ค่อยยิง location" ที่มีอยู่แล้ว)
  //  เช็คว่า location นี้ (rawLocation จริงจาก _jobDataRaw) มีที่เหลือพอสำหรับ demand (จำนวนใบ + น้ำหนักรวม) ที่ต้องการไหม
  //  ใช้ร่วมกันทั้ง tryAutoAssignMultiLocationPallets (ตอนสแกน location จริง) และ autoSelectPalletsIfEligible
  //  (เช็คล่วงหน้าตอน verify เสร็จ ก่อนจะรู้ด้วยซ้ำว่าจะสแกน location ไหน)
  private hasEnoughLocationCapacity(rawLocation: any, demand: { count: number; weight: number }): boolean {
    const hasQuotaTracking = typeof rawLocation.total_qty === 'number';
    const notEnoughQuota = hasQuotaTracking && (rawLocation.complete_qty ?? 0) + demand.count > rawLocation.total_qty;

    const hasWeightTracking = typeof rawLocation.qty === 'number' && typeof rawLocation.actual_qty === 'number';
    const notEnoughWeight = hasWeightTracking && (rawLocation.actual_qty ?? 0) + demand.weight > rawLocation.qty;

    return !notEnoughQuota && !notEnoughWeight;
  }

  private tryAutoAssignMultiLocationPallets(code: string): 'blocked' | 'none' {
    const redGroup = this._selectedPalletsForPlacement.filter(
      (p) => p.targetLocations.length > 1 && p.targetLocations.some((loc) => loc.location.trim() === code.trim()),
    );
    if (redGroup.length === 0) return 'none';

    const items = this._jobDataRaw?.items ?? [];
    const demandByLocation = new Map<any, { count: number; weight: number }>();

    for (const pallet of redGroup) {
      const rawItem = this.scanLogic.resolveItemForPallet(pallet, items);
      const rawLocation = rawItem?.locations?.to_locations?.find(
        (loc: any) => String(loc.location_name).trim() === code.trim(),
      );
      if (!rawLocation) return 'none';   //  หา location จริงไม่เจอ -> ปล่อยให้ flow เดิมด้านล่างจัดการ (ขึ้น error ปกติ)

      const demand = demandByLocation.get(rawLocation) ?? { count: 0, weight: 0 };
      demand.count += 1;
      demand.weight += pallet.qty ?? 0;
      demandByLocation.set(rawLocation, demand);
    }

    for (const [rawLocation, demand] of demandByLocation) {
      if (!this.hasEnoughLocationCapacity(rawLocation, demand)) {
        const redSet = new Set(redGroup);
        redGroup.forEach((p) => (p.isSelectedForPlacement = false));
        this._selectedPalletsForPlacement = this._selectedPalletsForPlacement.filter((p) => !redSet.has(p));

        this.SweetAlert(
          'error',
          `Location "${this.formatLocationDisplay(code)}" เหลือที่ไม่พอกับพาเลทที่รอเอาไปวางทั้งหมด (ต้องการ ${demand.count} ใบ) กรุณาสแกนเลือกพาเลททีละใบแทน`,
        );
        return 'blocked';
      }
    }

    return 'none';
  }

  //  เงื่อนไข Auto-Select (ใช้กับทุกงานที่ไม่ใช่ multi-step เหมือนกันหมด ไม่แยก Outbound/Inbound/Special แล้ว):
  //  - Multi-step (is_multi_fl === 'Y'): ต้องสแกนหา Pallet ID / Location เพื่อเลือกเองเสมอ ไม่ auto-select
  //  - พาเลตที่ Location ปลายทางแน่นอนแล้ว (1 ที่): ต้องตรงกันหมดทุกใบถึง auto-select ได้ (เทียบแค่ location
  //    ไม่สนใจ grade/lot เลย -> คนละ grade/lot แต่ location เดียวกัน ก็ auto-select แล้วสแกน location ทีเดียวจบได้เหมือนกัน)
  //    ถ้า location ไม่ตรงกันหมด -> deselect ทั้งหมด + เตือนให้สแกน pallet ทีละใบเพื่อเลือกเอง
  //  - พาเลตที่ Location ปลายทางยังไม่แน่นอน (มากกว่า 1 ที่เป็นไปได้): เช็คล่วงหน้าว่ามี location ไหนในกลุ่มที่ item
  //    เดียวกัน + candidate ชุดเดียวกันเหลือที่พอสำหรับทั้งกลุ่มไหม (เช่น 2 ใบ แต่ทุก location เหลือที่แค่ 1 -> รู้ได้เลย
  //    ว่าไม่มีทางวางพร้อมกันได้จริง ไม่ต้องรอสแกน location ก่อนถึงจะรู้) ถ้าไม่มี location ไหนพอเลย -> ไม่ auto-select
  //    กลุ่มนั้น ที่เหลือ (fixed + ambiguous ที่ยังพอมีทางไปได้) auto-select ตามปกติ ปล่อยให้ tryAutoAssignMultiLocationPallets
  //    ตัดสินใจรอบสุดท้ายตอนสแกน location จริงอีกที (เผื่อ pallet อื่นนอกกลุ่มมาแย่งที่ไปก่อนระหว่างนี้)
  private autoSelectPalletsIfEligible(): void {
    if (this._palletToPlaceList.length === 0) return;

    if (this._isMultiStep) return;   //  multi-step -> ไม่ auto-select เลย (ต้อง re-scan pallet/location เพื่อเลือกเอง)

    const fixedLocationPallets = this._palletToPlaceList.filter((p) => p.targetLocations.length === 1);
    const allFixedSameLocation =
      fixedLocationPallets.length === 0 ||
      fixedLocationPallets.every((p) => p.targetLocations[0].location === fixedLocationPallets[0].targetLocations[0].location);

    if (!allFixedSameLocation) {
      this.deselectAllPallets();
      this.SweetAlert('warning', 'พาเลทที่ยกมามี Location ปลายทางคนละที่กัน ต้องสแกนพาเลทและสแกน Location ปลายทางเพื่อเลือกพาเลท');
      return;
    }

    const unfitAmbiguousGroup = this.findUnfitAmbiguousGroup();
    if (unfitAmbiguousGroup.length > 0) {
      const unfitSet = new Set(unfitAmbiguousGroup);
      //  ยกเลิกเลือกให้ทุกใบในกลุ่มที่ไม่พอแบบชัดเจน (เผื่อบางใบเคยถูกเลือกไปแล้วตั้งแต่ตอนที่ยังไม่มีคู่แข่ง/โควต้ายังพอ)
      //  ไม่งั้นใบที่เคยเลือกไว้ก่อนจะค้างเลือกอยู่ต่อ เพราะโค้ดด้านล่างแค่ "ไม่เลือกซ้ำ" ไม่ได้ไปยกเลิกของเดิม
      unfitAmbiguousGroup.forEach((p) => (p.isSelectedForPlacement = false));
      this._selectedPalletsForPlacement = this._selectedPalletsForPlacement.filter((p) => !unfitSet.has(p));
      this._palletToPlaceList.filter((p) => !unfitSet.has(p)).forEach((p) => this.selectPalletForPlacement(p));
      this.SweetAlert(
        'warning',
        `ยกเลิกการเลือกพาเลท ${unfitAmbiguousGroup.length} ใบให้อัตโนมัติ เพราะที่ว่างไม่พอสำหรับวางพร้อมกันทั้งหมด กรุณาสแกนเลือกพาเลททีละใบแทน`,
      );
      return;
    }

    this._palletToPlaceList.forEach((p) => this.selectPalletForPlacement(p));
  }

  //  หากลุ่มพาเลตที่ location ยังไม่แน่นอน (แต่ item เดียวกัน + ชุด candidate location เดียวกันทุกใบ) ที่ไม่มี candidate
  //  location ไหนเลยเหลือที่พอสำหรับทั้งกลุ่ม -> คืนพาเลตกลุ่มนั้นออกมา (กลุ่มที่ยังพอมีทางไปได้ ไม่นับรวมมาด้วย)
  private findUnfitAmbiguousGroup(): PalletToPlaceItem[] {
    const ambiguousPallets = this._palletToPlaceList.filter((p) => p.targetLocations.length > 1);
    if (ambiguousPallets.length < 2) return [];

    const groups = new Map<string, PalletToPlaceItem[]>();
    ambiguousPallets.forEach((p) => {
      const key = `${p.itemId}::${p.targetLocations.map((l) => l.location).sort().join('|')}`;
      const group = groups.get(key) ?? [];
      group.push(p);
      groups.set(key, group);
    });

    const items = this._jobDataRaw?.items ?? [];
    const unfit: PalletToPlaceItem[] = [];

    groups.forEach((group) => {
      if (group.length < 2) return;   //  แค่ 1 ใบไม่มีทางชนกันเอง ไม่ต้องเช็ค

      const rawItem = this.scanLogic.resolveItemForPallet(group[0], items);
      const demand = { count: group.length, weight: group.reduce((sum, p) => sum + (p.qty ?? 0), 0) };
      const canFitSomewhere = group[0].targetLocations.some((loc) => {
        const rawLocation = rawItem?.locations?.to_locations?.find(
          (l: any) => String(l.location_name).trim() === loc.location.trim(),
        );
        return rawLocation ? this.hasEnoughLocationCapacity(rawLocation, demand) : true;   //  หา location จริงไม่เจอ -> ปล่อยผ่าน ไม่บล็อก
      });

      if (!canFitSomewhere) unfit.push(...group);
    });

    return unfit;
  }

  //  ─────────────────────────────────────────────────────────────
  //  SOURCE LOCATION SCAN (เฉพาะ Outbound)
  //  ─────────────────────────────────────────────────────────────
  //  ใช้ from_location ที่ผูกไว้กับ pallet นี้จริง (fromLocationId) แทนการ hardcode from_locations[0]
  handleSourceLocationScan(code: string): void {
    if (this._isMultiStep && this._scanAction === 'put') {
      this.SweetAlert('warning', 'งานนี้แยกขั้นตอน Get และ Put กรุณากลับไปกดปุ่ม Get ที่หน้ารายการงานเพื่อดำเนินการรับพาเลทนี้ก่อน');
      return;
    }

    const verifyingPallets = this._outboundVerificationPallets.filter(
      (p) => (p.sourceLocation ?? '').trim() === code.trim(),
    );
    if (verifyingPallets.length > 0) {
      this.SweetAlert('warning', 'พาเลทที่ Location นี้กำลังตรวจสอบอยู่ กรุณารอสักครู่แล้วสแกน Location อีกครั้ง');
      return;
    }

    const matchingPallets = this._palletsAwaitingSourceLocation.filter(
      (p) => (p.sourceLocation ?? '').trim() === code.trim(),
    );

    if (matchingPallets.length === 0) {
      this.SweetAlert('error', this.wrongLocationMessage(
        code,
        'ต้นทาง',
        'พาเลทที่รออยู่',
        this._palletsAwaitingSourceLocation.map((p) => this.formatLocationDisplay(p.sourceLocation)),
      ));
      return;
    }

    const preparedList = matchingPallets
      .map((pallet) => ({ pallet, matchedItem: this.scanLogic.resolveItemForPallet(pallet, this._jobDataRaw?.items ?? []) }))
      .filter((entry): entry is { pallet: PalletToPlaceItem; matchedItem: any } => !!entry.matchedItem);

    if (preparedList.length === 0) return;

    //  กันดึงของออกจาก Location ต้นทางเกินน้ำหนักที่มีจริง (fromLocation.qty) เหมือนฝั่ง put-away ปลายทาง (preparePutAwayList) — เดิมเช็คแค่จำนวนใบ (checkFromLocationQuota)
    //  ไม่เคยเช็คน้ำหนักฝั่งต้นทางเลย พอ pallet มีน้ำหนักจริงเกินเฉลี่ย ก็ดึงเกินได้ทั้งที่จำนวนใบยังไม่ครบโควต้า
    //  pallet เหล่านี้ (matchingPallets) อยู่ใน session อยู่แล้ว (awaitingSourceLocation) -> หักน้ำหนักตัวเองออกจากยอดรวมก่อน แล้วไล่บวกทีละใบเช็คว่าพอไหม
    const weightOverflowPallets: PalletToPlaceItem[] = [];
    const runningWeightByLocation = new Map<any, number>();

    const weightOkList = preparedList.filter(({ pallet, matchedItem }) => {
      const fromLocation = this.scanLogic.resolveFromLocationByPallet(matchedItem, pallet);
      if (!fromLocation || typeof fromLocation.qty !== 'number') return true;   //  ไม่มีข้อมูลน้ำหนักให้เช็ค -> ปล่อยผ่านเหมือนเดิม

      if (!runningWeightByLocation.has(fromLocation)) {
        const totalAtLocation = this.scanLogic.sumSessionPalletWeightAtLocation(fromLocation.location_id, this._sessionPalletLists);
        const thisBatchTotal = matchingPallets
          .filter((p) => p.fromLocationId === fromLocation.location_id)
          .reduce((sum, p) => sum + (p.qty ?? 0), 0);
        runningWeightByLocation.set(fromLocation, totalAtLocation - thisBatchTotal);   //  baseline: ไม่รวม batch นี้ (กันนับตัวเองซ้ำ)
      }

      const current = runningWeightByLocation.get(fromLocation)!;
      const palletWeight = pallet.qty ?? 0;
      if (current + palletWeight > fromLocation.qty) {
        weightOverflowPallets.push(pallet);
        return false;
      }
      runningWeightByLocation.set(fromLocation, current + palletWeight);
      return true;
    });

    if (weightOverflowPallets.length > 0) {
      this.SweetAlert(
        'error',
        `น้ำหนักเกินที่ Location ต้นทางมีจริง พาเลท id: ${weightOverflowPallets.map((p) => p.id ?? '-').join(', ')} กรุณาตรวจสอบยอดคงเหลือก่อนยืนยันอีกครั้ง`,
      );
    }

    if (weightOkList.length === 0) return;

    const requests = weightOkList.map(({ pallet, matchedItem }) => {
      const fromLocation = this.scanLogic.resolveFromLocationByPallet(matchedItem, pallet);
      //  งาน IT: endpoint /internal-transfer/get-pallet mirror จาก Special มาเป๊ะๆ ต้องการ qrCodes เป็น array + modeId/palletSeq
      //  ไม่ใช่ qrCode ตัวเดียวแบบงาน manual pallet ปกติ (modeId 1 = Full Pallet, ไม่มี palletSeq ให้ใช้ 0)
      //  งานกลุ่ม kilo อื่น (RQ/Transfer WH/Picking, _isAutoSpecialJob) ก็ต้องส่ง modeId 1 เหมือน IT ด้วย ไม่ใช่แค่ IT เท่านั้น
      const requestData: any = this._isInternalTransferJob
        ? {
          qrCodes: [pallet.qrCode ?? ''],
          itemId: matchedItem.id,
          locationId: fromLocation?.location_id ?? 0,
          locationType: this._jobDataRaw?.from_location_type ?? '',
          palletSeq: 0,
          modeId: 1,
          updateBy: this._currentUserId,
        }
        : {
          itemId: matchedItem.id,
          locationId: fromLocation?.location_id ?? 0,
          locationType: this._jobDataRaw?.from_location_type ?? '',
          updateBy: this._currentUserId,
          //  ถุงใบล่าสุดที่สแกนตอนยืนยัน Pallet นี้ (เก็บไว้ตอน completePalletOutbound)
          qrCode: pallet.qrCode ?? '',
          ...(this._isAutoSpecialJob ? { modeId: 1 } : {}),
        };
      return this.runOrQueueJobApi('get', this._jobDataRaw.id, requestData, pallet.qrCode ?? '').pipe(
        map(() => ({ success: true as const })),
        catchError((err) => of({ success: false as const, message: err?.error?.message as string | undefined })),
      );
    });

    //  ยิงทีละใบตามลำดับ (concat) แทนพร้อมกันหมด (forkJoin เดิม) -> กัน request หลายใบไปชนกันที่ backend พร้อมกันจริง
    //  (เหตุผลเดียวกับฝั่ง put-away ที่ handleLocationScan) ผลลัพธ์/modal สรุปท้ายสุดเหมือนเดิมทุกอย่าง
    concat(...requests).pipe(toArray()).subscribe((results) => {
      const succeededPallets: PalletToPlaceItem[] = [];
      const failedPallets: PalletToPlaceItem[] = [];
      const failedMessages = new Map<PalletToPlaceItem, string>();

      results.forEach((result, i) => {
        const { pallet, matchedItem } = weightOkList[i];

        if (!result.success) {
          if (result.message) failedMessages.set(pallet, result.message);
          failedPallets.push(pallet);
          return;
        }

        this._palletsAwaitingSourceLocation = this._palletsAwaitingSourceLocation.filter((p) => p !== pallet);

        if (this._jobDataRaw.pallets?.awaiting_source_pallet && pallet.id) {
          this._jobDataRaw.pallets.awaiting_source_pallet = this._jobDataRaw.pallets.awaiting_source_pallet.filter(
            (p: any) => !this.scanLogic.isSamePalletRecord(p, pallet),
          );
        }
        if (matchedItem.awaiting_source_pallet > 0) matchedItem.awaiting_source_pallet -= 1;

        if (this._jobDataRaw.pallets?.receive_pallet && pallet.id) {
          this._jobDataRaw.pallets.receive_pallet = this._jobDataRaw.pallets.receive_pallet.filter(
            (p: any) => !this.scanLogic.isSamePalletRecord(p, pallet),
          );
        }
        if (matchedItem.receive_qty > 0) matchedItem.receive_qty -= 1;

        this._palletToPlaceList.push(pallet);
        succeededPallets.push(pallet);
      });

      if (succeededPallets.length > 0) {
        this.autoSelectPalletsIfEligible();
        this.saveJobDataToSession();
      }

      this.refreshDisplayList();
      this.notifyBatchResult('ยืนยัน Location ต้นทาง', succeededPallets, failedPallets, 'ใบ', undefined, undefined, failedMessages);
    });
  }

  //  ─────────────────────────────────────────────────────────────
  //  DESTINATION LOCATION SCAN (Put-away)
  //  ─────────────────────────────────────────────────────────────
  private handleLocationScan(code: string): void {
    if (this._isMultiStep && this._scanAction === 'get') {
      this.SweetAlert(
        'warning',
        this._isSpecialJob
          ? 'งานนี้แยกขั้นตอน Get และ Put กรุณากดปุ่ม Put ที่หน้ารายการงานเพื่อดำเนินการจัดวางถุงต่อ'
          : 'งานนี้แยกขั้นตอน Get และ Put กรุณากดปุ่ม Put ที่หน้ารายการงานเพื่อดำเนินการจัดวางพาเลทต่อ',
      );
      return;
    }

    //  Inbound เท่านั้น: pallet ที่ยังไม่เลือก (แดง — มี Location ปลายทางได้มากกว่า 1 ที่) ตรงกับ Location ที่สแกน -> ลองรวบยอด auto เลือกทั้งกลุ่ม
    //  ถ้า location เต็ม/พอเลย -> ไม่เลือกอะไรเลย (ยังแดงเหมือนเดิม) เตือนให้ไปสแกนเลือกเองทีละใบแทน (flow เดิม: ยิง pallet id ก่อน ค่อยยิง location)
    if (this._isInboundJob && this.tryAutoAssignMultiLocationPallets(code) === 'blocked') {
      return;
    }

    //  งาน Picking ที่ยังไม่มี Location ปลายทางกำหนดไว้ล่วงหน้า (พาเลตแรก) -> Flow เลือก Location เอง
    const pickingFreeLocationPallets = this._selectedPalletsForPlacement.filter((p) =>
      this.isPickingFreeLocationPallet(p),
    );
    if (pickingFreeLocationPallets.length > 0) {
      this.handlePickingFreeLocationScan(code, pickingFreeLocationPallets);
      return;
    }

    //  งานปกติ: Location ปลายทางกำหนดไว้แล้ว
    const matchingPallets = this._selectedPalletsForPlacement.filter((p) =>
      p.targetLocations.some((loc) => loc.location.trim() === code.trim()),
    );

    if (matchingPallets.length === 0) {
      this.SweetAlert('error', this.wrongLocationMessage(
        code,
        'ปลายทาง',
        'พาเลทที่เลือกไว้',
        this._selectedPalletsForPlacement.flatMap((p) => p.targetLocations.map((loc) => this.formatLocationDisplay(loc.location))),
      ));
      return;
    }

    const { preparedList, fullLocationIds, itemOverflowIds, weightOverflowDetails } = this.preparePutAwayList(matchingPallets, code);

    if (fullLocationIds.length > 0) {
      this.SweetAlert('error', `Location "${code}" เต็มแล้ว ไม่สามารถวางพาเลทหมายเลข ${fullLocationIds.join(', ')} ได้ กรุณาสแกน Location อื่น`);
    }

    //  งาน Special: qty ที่จะวางเกินยอดที่เหลือจริงของ item (total_qty - complete_qty) -> ไม่ยิง put ให้ กันวางเกินโควต้า
    if (itemOverflowIds.length > 0) {
      this.SweetAlert('error', `จำนวนที่จะวางเกินยอดคงเหลือของเกรด/ล๊อตนี้: ${itemOverflowIds.join(', ')} กรุณาตรวจสอบยอดคงเหลือก่อนวางอีกครั้ง`);
    }

    //  งานทั่วไป: qty จริงของ pallet ใบนี้เกินน้ำหนักที่ location ต้องการ (actual_qty/qty) -> ไม่ยิง put ให้ กันวางเกินโควต้าน้ำหนัก
    if (weightOverflowDetails.length > 0) {
      const message = weightOverflowDetails
        .map((d) => `พาเลทหมายเลข ${d.palletId} — qty (${d.palletQty}) เกิน qty ที่ต้องการของ Location "${this.formatLocationDisplay(d.location)}" (ตอนนี้ ${d.actualQty}/${d.targetQty})`)
        .join(' • ');
      this.SweetAlert('error', message);
    }

    if (preparedList.length === 0) return;

    this.runPutAway(preparedList);
  }

  //  งาน BK: ไม่มีขั้นสแกน Location ปลายทาง -> Get สำเร็จแล้ว (กล่องเข้ารายการรอวาง) ยิง Put ต่อให้เองทันทีโดยไม่ต้องสแกน
  //  ปลายทางส่งเป็น to_location แรกของ item (ไม่มีให้สแกนเลือก) Put ไม่ผ่าน -> การ์ดค้างในรายการรอวาง กดปุ่ม "ยิง Put อีกครั้ง"
  //  ได้ (onClickRetryBkPut) ไม่เช็คโควต้าปลายทาง/ยอด item ซ้ำ เพราะ Get เพิ่งผ่านการเช็คมาแล้ว ให้ backend ตัดสินเอง
  private putAwayBkPallets(pallets: PalletToPlaceItem[]): void {
    const items = this._jobDataRaw?.items ?? [];
    const preparedList = pallets
      .filter((pallet) => !this._putInFlightPallets.has(pallet))
      .map((pallet) => {
        const rawItem = this.scanLogic.resolveItemForPallet(pallet, items);
        const rawLocation = rawItem?.locations?.to_locations?.[0];
        return { pallet, matchedLocation: pallet.targetLocations[0], rawItem, rawLocation, currentComplete: rawLocation?.complete_qty ?? 0 };
      });

    if (preparedList.length > 0) this.runPutAway(preparedList);
  }

  //  ปุ่ม "ยิง Put อีกครั้ง" บนการ์ด BK ที่ค้างในรายการรอวาง (Put รอบก่อนไม่ผ่าน หรือค้างมาจาก flow BK เดิมที่ไม่มี Put)
  onClickRetryBkPut(pallet: PalletToPlaceItem): void {
    this.putAwayBkPallets([pallet]);
  }

  //  การ์ด BK ที่กำลังยิง Put อยู่ -> ซ่อนปุ่มยิงซ้ำ โชว์ "กำลังบันทึก..." แทน (template เข้าถึง _putInFlightPallets ตรงๆ ไม่ได้)
  isPutInFlight(pallet: PalletToPlaceItem): boolean {
    return this._putInFlightPallets.has(pallet);
  }

  //  ยิง Put-away ของรายการที่เตรียมไว้แล้ว (preparePutAwayList หรือ putAwayBkPallets) ทีละใบ แล้วสรุปผลทีเดียว
  private runPutAway(preparedList: Array<{
    pallet: PalletToPlaceItem;
    matchedLocation?: PalletTargetLocation;
    rawItem: any;
    rawLocation: any;
    currentComplete: number;
    currentActualQty?: number;
  }>): void {
    const requests = preparedList.map(({ pallet, rawItem, rawLocation }) => {
      const requestData: any = {
        itemId: rawItem?.id ?? 0,
        locationId: rawLocation?.location_id ?? 0,
        locationType: this._jobDataRaw?.to_location_type ?? '',
        updateBy: this._currentUserId,
      };
      if (this._isSpecialJob) {
        requestData.palletId = Number(pallet.id) || 0;   //  Special/BK เท่านั้นที่ยังส่ง palletId (ไม่แตะพฤติกรรมเดิม)
        requestData.qty = pallet.qty;
        requestData.palletSeq = pallet.palletSeq ?? 0;
        //  หา entry จริงใน receive_pallet ด้วย specialEntryIds ตรงๆ (แม่นกว่าจับคู่แค่ item เพราะ 1 item อาจมีหลาย pallet ค้างพร้อมกัน)
        //  รายการที่รวมมาจากหลาย Get ตอน "เตรียมเอาไปวาง" จะมีหลาย id -> เอาใบแรกพอเป็นตัวแทนตอนยิง qrCode
        const entryIds = this.getSpecialEntryIds(pallet);
        const receivePool: any[] = this._jobDataRaw?.pallets?.receive_pallet ?? [];
        const receivePoolEntry = receivePool.find((p: any) => entryIds.includes(p.id));
        const rawQrCode = receivePoolEntry?.scanned_qr_code || pallet.qrCode || '';
        //  งาน RQ/Transfer WH/IT โค้ด PL: ส่งแค่ rawCode เหมือนตอน Get เสมอ (เผื่อ record ที่เก็บไว้ดันเป็น code เต็มจากของเก่า/reload)
        //  ไม่ใช่โค้ด PL (เช่น Jumbo Bag/นับน้ำหนักสะสม) -> ส่งเต็มเหมือนเดิม ไม่ตัดมั่ว
        requestData.qrCode = this._isAutoSpecialJob
          ? (this.scanLogic.parseFullPalletScanCode(rawQrCode)?.rawCode ?? rawQrCode)
          : rawQrCode;
      } else {
        //  งานปกติ (Inbound/Outbound/Picking): เหมือนกัน แต่จับคู่ด้วย pallet id ตรงๆ แทน grade/lot
        const receivePoolEntry = this.scanLogic.findReceivePoolEntryForPallet(this._jobDataRaw, pallet);
        requestData.qrCode = receivePoolEntry?.scanned_qr_code || pallet.qrCode || '';
        //  งาน IT: /internal-transfer/put-away ต้องการ palletSeq มาด้วย (ไม่มี palletId/qty/modeId เหมือน Get) -> ไม่มี concept
        //  Add Pallet/palletSeq ในโหมด manual pallet นี้ ใช้ 0 เสมอ
        if (this._isInternalTransferJob) requestData.palletSeq = 0;
      }
      return this.runOrQueueJobApi('putAway', this._jobDataRaw.id, requestData, pallet.qrCode ?? '').pipe(
        map(() => ({ success: true as const })),
        catchError((err) => of({ success: false as const, message: err?.error?.message as string | undefined })),
      );
    });

    //  mark ไว้ว่า pallet พวกนี้กำลังมี Put ค้างอยู่ -> ดู refreshJobProgressFromServer ที่ skip ไม่ auto-deselect
    //  pallet กลุ่มนี้ตราบใดที่ response ยังไม่กลับ กันชนกับ Put ที่กำลังจะสำเร็จ/ล้มเหลวอยู่แล้วพอดี
    preparedList.forEach(({ pallet }) => this._putInFlightPallets.add(pallet));

    //  ยิงทีละใบตามลำดับ (concat) แทนพร้อมกันหมด (forkJoin เดิม) -> กัน 2 request ไปชนกันที่ backend ตอนเช็ค/บวก
    //  โควต้าของ location เดียวกันพร้อมกันจริง (เจอจริงบน tablet ที่เน็ตช้ากว่า PC ยิงใบนึงหลุดไม่ถูกนับ ต้องออกแล้ว
    //  เข้าใหม่ค่อย put ใบที่เหลือ) ผลลัพธ์/ลำดับ/modal สรุปท้ายสุดเหมือนเดิมทุกอย่าง ช้าขึ้นแค่เสี้ยววินาทีต่อใบ
    concat(...requests).pipe(toArray()).subscribe((results) => {
      const succeededPallets: PalletToPlaceItem[] = [];
      const failedPallets: PalletToPlaceItem[] = [];
      const failedMessages = new Map<PalletToPlaceItem, string>();

      results.forEach((result, i) => {
        const { pallet, matchedLocation, rawItem, rawLocation, currentComplete, currentActualQty } = preparedList[i];
        this._putInFlightPallets.delete(pallet);

        if (result.success) {
          this.markPalletPutAwayComplete(pallet, matchedLocation, rawItem);
          succeededPallets.push(pallet);
        } else {
          //  คืนโควต้าที่จองไว้ เพราะยิง API ไม่สำเร็จ (ทั้งจำนวนใบและน้ำหนัก ถ้าเคยจองไว้)
          if (rawLocation) rawLocation.complete_qty = currentComplete;
          if (rawLocation && currentActualQty !== undefined) rawLocation.actual_qty = currentActualQty;
          if (result.message) failedMessages.set(pallet, result.message);
          failedPallets.push(pallet);
        }
      });

      if (succeededPallets.length > 0) this.saveJobDataToSession();

      this.refreshDisplayList();

      //  งาน BK: Put ผ่านครบ + งานครบทุก item แล้ว -> บอกให้นำของไปปลายทาง (ข้อความเดิมของ BK ที่เคยขึ้นตอน Get ครบ
      //  ย้ายมาขึ้นหลัง Put แทน ขึ้นได้ทั้งทางนับถุง/เต็ม pallet/batch) ไม่ครบ -> สรุปผลเป็น กก. แบบงาน special ปกติ
      if (this._isBkJob && failedPallets.length === 0 && this._palletToPlaceList.length === 0 && this.isBkJobFullyReceived()) {
        this.SweetAlert('success', `งานสำเร็จ โปรดนำของไปที่ ${this.getBkDestinationLabel()}`);
        return;
      }

      this._isSpecialJob
        ? this.notifySpecialWeightBatchResult(this._isBkJob ? 'รับ' : 'วาง', succeededPallets, failedPallets, failedMessages)
        : this.notifyBatchResult('จัดวางพาเลท', succeededPallets, failedPallets, 'ใบ', 'สำเร็จทั้งหมด', 'สำเร็จ', failedMessages);
    });
  }

  //  แจ้งผลลัพธ์ของงาน Special/RQ ที่นับเป็น กก. ไม่ใช่ Pallet/ใบ เหมือนงานปกติ (pallet.id เป็น null เสมอ แสดงไม่ได้
  //  ใน header แต่การ์ด Grade/Lot/Qty ของ formatPalletDetailRows ยังโชว์ได้ปกติ) รวม qty เอาจาก pallet.qty เอง
  //  failedMessages: ข้อความจริงจาก backend ของแต่ละใบที่ล้มเหลว (เหมือน notifyBatchResult)
  //  actionLabel: คำกริยาที่ใช้ในข้อความ (เดิม hardcode "วาง" ไว้ตัวเดียว ตอนนี้แยกให้ getSpecialLocationBatch
  //  ส่ง "รับพาเลทเต็ม" มาแทนได้ด้วย ไม่ต้องสร้างฟังก์ชันซ้ำ)
  private notifySpecialWeightBatchResult(
    actionLabel: string,
    succeededPallets: PalletToPlaceItem[],
    failedPallets: PalletToPlaceItem[],
    failedMessages?: Map<PalletToPlaceItem, string>,
  ) {
    const succeededQty = succeededPallets.reduce((sum, p) => sum + (p.qty ?? 0), 0);
    const failedQty = failedPallets.reduce((sum, p) => sum + (p.qty ?? 0), 0);

    if (failedQty === 0) {
      return this.SweetAlert('success', '', this.buildBatchResultHtml(
        'success',
        `${actionLabel}สำเร็จทั้งหมด ${succeededQty} กก.`,
        this.formatPalletDetailRows(succeededPallets),
      ));
    } else if (succeededQty === 0) {
      return this.SweetAlert('error', '', this.buildBatchResultHtml(
        'error',
        `ไม่สามารถ${actionLabel}ได้ ${failedQty} กก. กรุณาลองใหม่อีกครั้ง`,
        this.formatPalletDetailRows(failedPallets, true, failedMessages),
      ));
    } else {
      return this.SweetAlert('warning', '', this.buildBatchResultHtml(
        'warning',
        `${actionLabel}สำเร็จ ${succeededQty} กก. แต่ล้มเหลว ${failedQty} กก.`,
        this.formatPalletDetailRows(succeededPallets) + this.formatPalletDetailRows(failedPallets, true, failedMessages),
      ));
    }
  }

  //  เตรียมรายการ Pallet ที่จะ Put-away พร้อม "จองโควต้า" ล่วงหน้า (กัน race ระหว่างรอ API หลายใบพร้อมกัน)
  private preparePutAwayList(matchingPallets: PalletToPlaceItem[], code: string) {
    const items = this._jobDataRaw?.items ?? [];
    const fullLocationIds: string[] = [];
    const itemOverflowIds: string[] = [];
    const weightOverflowDetails: { palletId: string; location: string; palletQty: number; actualQty: number; targetQty: number }[] = [];

    const preparedList: Array<{
      pallet: PalletToPlaceItem;
      matchedLocation?: PalletTargetLocation;
      rawItem: any;
      rawLocation: any;
      currentComplete: number;
      currentActualQty?: number;
    }> = [];

    matchingPallets.forEach((pallet) => {
      const rawItem = this.scanLogic.resolveItemForPallet(pallet, items);
      const matchedLocation = pallet.targetLocations.find((loc) => loc.location.trim() === code.trim());
      const rawLocation = rawItem?.locations?.to_locations?.find(
        (loc: any) => String(loc.location_name).trim() === matchedLocation?.location,
      );

      const claimAmount = this._isSpecialJob ? (pallet.qty ?? 0) : 1;

      //  งาน Special: to_locations ของจริงไม่มี total_qty มาให้เช็คโควต้าต่อ location (เช็คด้านล่างข้ามไปเลย) -> เช็คกับยอดคงเหลือ
      //  จริงของ item เอง (total_qty - complete_qty) แทน กันวางเกินโควต้าถ้า qty ที่ประมาณไว้ตอน Get คลาดจากของจริง
      //  หรือมีเครื่องอื่นวางไปพร้อมกันจนยอดคงเหลือเปลี่ยนไประหว่างที่ pallet นี้ยังค้างรออยู่BK
      if (this._isSpecialJob) {
        const itemRemaining = (rawItem?.total_qty ?? 0) - (rawItem?.complete_qty ?? 0);
        if (claimAmount > itemRemaining) {
          itemOverflowIds.push(`${rawItem?.grade ?? '-'} ${pallet.lotNo ?? ''}`.trim());
          return;
        }
      }

      const hasQuotaTracking = rawLocation && typeof rawLocation.total_qty === 'number';
      const currentComplete = rawLocation?.complete_qty ?? 0;
      const totalAllowed = rawLocation?.total_qty ?? 0;

      if (hasQuotaTracking && currentComplete + claimAmount > totalAllowed) {
        fullLocationIds.push(pallet.id ?? '-');
        return;
      }

      //  งานทั่วไปเท่านั้น (ห้ามยุ่ง Special/BK — มี logic เช็คน้ำหนักระดับ item ของตัวเองแยกอยู่แล้วด้านบน)
      //  เช็คน้ำหนักจริงคู่กับจำนวนใบ: location มี qty (เป้าหมายน้ำหนัก) และ actual_qty (น้ำหนักที่วางไปแล้วจริง) มาให้ต่างหากจาก complete_qty/total_qty ที่นับเป็นใบ
      const hasWeightTracking =
        !this._isSpecialJob &&
        rawLocation &&
        typeof rawLocation.qty === 'number' &&
        typeof rawLocation.actual_qty === 'number';
      const currentActualQty = rawLocation?.actual_qty ?? 0;
      const palletWeight = pallet.qty ?? 0;

      if (hasWeightTracking && currentActualQty + palletWeight > rawLocation.qty) {
        weightOverflowDetails.push({
          palletId: pallet.id ?? '-',
          location: matchedLocation?.location ?? code,
          palletQty: palletWeight,
          actualQty: currentActualQty,
          targetQty: rawLocation.qty,
        });
        return;
      }

      if (hasQuotaTracking && rawLocation) {
        rawLocation.complete_qty = currentComplete + claimAmount;   //  จองโควต้าไว้ก่อน
      }
      if (hasWeightTracking && rawLocation) {
        rawLocation.actual_qty = currentActualQty + palletWeight;   //  จองน้ำหนักไว้ก่อนด้วยเช่นกัน
      }

      preparedList.push({ pallet, matchedLocation, rawItem, rawLocation, currentComplete, currentActualQty: hasWeightTracking ? currentActualQty : undefined });
    });

    return { preparedList, fullLocationIds, itemOverflowIds, weightOverflowDetails };
  }

  //  งาน Special: พาเลทนี้วางสำเร็จแล้ว ไม่ใช่ "รับแล้วรอวาง" อีกต่อไป -> หัก item.receive_qty ตามน้ำหนักพาเลท และเอารายการออกจาก
  //  receive_pallet ให้ครบทุก id (เผื่อรวมมาจากหลาย Get ตอน "เตรียมเอาไปวาง") กัน reload แล้วเห็นซ้ำ (TW ก็ push เข้า pool นี้เอง
  //  ฝั่ง client ตอน Get เหมือนกัน) ใช้ร่วมกันทั้งตอน Put สำเร็จในเครื่องนี้ (markPalletPutAwayComplete) และตอน auto fetch เห็นจาก
  //  backend ก่อนว่าวางเสร็จแล้ว (newlyCompleteElsewhere ใน refreshJobProgressFromServer)
  private releaseSpecialReceived(pallet: PalletToPlaceItem, rawItem: any): void {
    if (!rawItem) return;
    rawItem.receive_qty = Math.max(0, (rawItem.receive_qty ?? 0) - (pallet.qty ?? 0));
    const entryIds = this.getSpecialEntryIds(pallet);
    if (entryIds.length > 0 && this._jobDataRaw.pallets?.receive_pallet) {
      this._jobDataRaw.pallets.receive_pallet = this._jobDataRaw.pallets.receive_pallet.filter(
        (p: any) => !entryIds.includes(p.id),
      );
    }
  }

  //  บันทึกผลสำเร็จของ Put-away ลง state (รวมทั้ง Flow ปกติ และเรียกซ้ำได้จาก Flow Picking)
  private markPalletPutAwayComplete(
    pallet: PalletToPlaceItem,
    matchedLocation: PalletTargetLocation | undefined,
    rawItem: any,
  ): void {
    //  กัน double-count: ถ้า auto-fetch (refreshJobProgressFromServer) แทรกเข้ามากลางทางระหว่าง batch put หลายใบ
    //  ยังค้างอยู่ (concat(...).pipe(toArray()) รอให้ request ทุกใบจบก่อนถึงจะเรียกฟังก์ชันนี้) แล้วเจอว่า pallet ใบนี้
    //  backend confirm สำเร็จไปแล้ว (newlyCompleteElsewhere) มันจะ finalize ให้เองก่อน (บวก complete_qty ผ่าน Math.max +
    //  push เข้า _completedPalletList ไปแล้ว) พอ batch เดิมเรียกฟังก์ชันนี้ซ้ำสำหรับ pallet ใบเดียวกัน จะบวก complete_qty
    //  ซ้ำอีกรอบ (เจอจริง: put 4 ใบพร้อมกัน แต่ auto-fetch แทรกกลางทาง ตัวเลขจบที่ 7/4 แทนที่จะเป็น 4/4) -> เช็คก่อนว่า
    //  pallet ใบนี้ถูก finalize ไปแล้วหรือยัง (reference เดียวกับที่ newlyCompleteElsewhere push เข้า _completedPalletList
    //  ไว้) ถ้าใช่ ข้ามไปเลย ไม่ต้องประมวลผลซ้ำ
    if (this._completedPalletList.includes(pallet)) return;

    //  งาน Special (นับเป็น กก.): 1 pallet ในรายการ = ถุงหลายใบรวมกัน (pallet.qty) -> บวกตามจำนวนจริง ไม่ใช่ +1 แบบ pallet ปกติ
    //  งาน IT นับเป็น กก. เสมอเหมือนกัน (ทั้งแบบนับถุงและแบบ pallet_assigned) แม้ตอนนี้ _isSpecialJob จะเป็น false ก็ตาม (manifest job)
    const completeAmount = (this._isSpecialJob || this._isInternalTransferJob) ? (pallet.qty ?? 0) : 1;

    //  งาน Special ทุกตัวรวม TW: ถุงที่วางสำเร็จแล้ว ไม่ใช่ "รอวาง" อีกต่อไป -> ต้องหัก receive_qty ออกเสมอ ไม่ยกเว้น TW
    //  (ตอน Get บวก receive_qty ให้ทุกงาน Special เหมือนกันหมดไม่เว้น TW เลย ดู getSpecialFullPallet/onConfirmSpecialQty)
    //  เดิมห่อบรรทัดนี้ไว้ในเงื่อนไข !_isTransferWhJob เดียวกับ complete_qty ด้านล่างโดยไม่ตั้งใจ เลยกลายเป็น TW ไม่เคย
    //  ถูกลด receive_qty เลยสักครั้ง -> ค้างสะสมไปเรื่อยๆ จนรวมกับ complete_qty (ที่ sync ถูกจาก backend ทุก auto-fetch
    //  อยู่แล้ว) เกิน total_qty ทั้งที่ของจริงยังไม่ครบ บล็อก Get รอบถัดไปทั้งที่ progress bar ยังโชว์ถูก (เจอจริง: total_qty
    //  4000 Put ไปแค่ 2000 แต่ Get ต่อไม่ได้ขึ้นว่าครบแล้ว progress bar ก็ยังขึ้น 2000/4000 ถูกอยู่ เพราะมันอ่านแค่
    //  complete_qty ไม่เห็น receive_qty ที่ค้าง ต้องออกจากหน้าแล้วเข้าใหม่ถึงหาย เพราะ reload ดึง receive_qty จาก
    //  backend ของจริง (ที่ถูกต้องอยู่แล้ว) มาทับของค้างฝั่ง client)
    if (this._isSpecialJob) this.releaseSpecialReceived(pallet, rawItem);

    //  TW ให้ทำงานเหมือน RQ/IT ทุกจุด (ยกเลิกข้อยกเว้นเดิมที่สมมติว่า backend นับ complete_qty ไปแล้วตั้งแต่ตอน Get)
    if (rawItem) {
      rawItem.complete_qty = (rawItem.complete_qty ?? 0) + completeAmount;

      this._jobDataRaw.pallets ??= {};
      this._jobDataRaw.pallets.complete_pallet ??= [];
      this._jobDataRaw.pallets.complete_pallet.push({
        //  โค้ด PL: pallet.id เป็น "PLM..." (ไม่ใช่ตัวเลข) -> ใช้ backendId จริงจาก response ตอน Get แทนถ้ามี ไม่งั้น Number() จะได้ NaN -> 0 ผิด
        id: Number(pallet.backendId ?? pallet.id) || 0,
        qty: pallet.qty,
        lot: pallet.lotNo,
        //  งานปกติก็เก็บโค้ดถุงไว้ด้วย -> ถุงของ Pallet นี้ที่จัดวางเสร็จแล้ว สแกนซ้ำจับได้ด้วยโค้ดเหมือนของ backend (checkPalletIdConflict)
        scanned_qr_code: pallet.qrCode,
        ...(this._isSpecialJob ? { pallet_seq: pallet.palletSeq, grade: pallet.grade } : {}),
      });
    }

    this._completedPalletList = [
      ...this._completedPalletList,
      { ...pallet, targetLocations: matchedLocation ? [matchedLocation] : pallet.targetLocations },
    ];

    this._palletToPlaceList = this._palletToPlaceList.filter((p) => p !== pallet);
    this._selectedPalletsForPlacement = this._selectedPalletsForPlacement.filter((p) => p !== pallet);
    //  _completedPalletCount เป็น getter คำนวณจาก _completedPalletList ด้านบนแล้วเอง ไม่ต้อง += ตรงนี้อีก
  }

  //  ─────────────────────────────────────────────────────────────
  //  PICKING: FREE-LOCATION FLOW (พาเลตแรกที่ยังไม่มี Location ปลายทางกำหนดมาให้)
  //  ─────────────────────────────────────────────────────────────
  private isPickingFreeLocationPallet(pallet: PalletToPlaceItem): boolean {
    return this._isPickingJob && pallet.targetLocations.length === 0;
  }

  private handlePickingFreeLocationScan(code: string, pallets: PalletToPlaceItem[]): void {
    const locationCode = code.trim();

    this.scanApi.getPreZoneLocation(locationCode).subscribe({
      next: (res: any) => {
        const list = res?.data ?? [];
        const found = list.find(
          (loc: any) =>
            String(loc.location_desc ?? '').trim() === locationCode ||
            String(loc.location_code ?? '').trim() === locationCode,
        );

        if (!found) {
          this.SweetAlert('error', `ไม่พบ Location "${locationCode}" ในระบบ กรุณาตรวจสอบและสแกนใหม่อีกครั้ง`);
          return;
        }

        this.confirmPickingFirstLocation(found, pallets);
      },
      error: () => this.SweetAlert('error', 'ไม่สามารถตรวจสอบ Location นี้ได้ กรุณาลองใหม่อีกครั้ง'),
    });
  }

  private confirmPickingFirstLocation(location: any, pallets: PalletToPlaceItem[]): void {
    const locationLabel = this.scanLogic.fallback(location.location_desc ?? location.location_code);

    Swal.fire({
      icon: 'question',
      title: 'ยืนยัน Location ปลายทาง',
      html: `ต้องการวางพาเลทที่ Location <b>${locationLabel}</b> ใช่หรือไม่?<br><br>
           <span style="color:#d32f2f;font-size:13px;">* Location นี้จะถูกใช้กับพาเลทที่เหลือของรายการนี้ทั้งหมด</span>`,
      showCancelButton: true,
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ยกเลิก',
    }).then((result) => {
      result.isConfirmed
        ? this.putAwayPickingPallets(pallets, location)
        : this.focusScannerInput();
    });
  }

  //  งาน Picking: ยิง API Put-away ให้ Pallet ที่เลือกไว้ทั้งหมดพร้อมกัน (batch เหมือน handleLocationScan)
  //  แล้วสรุปผลรวมทีเดียวด้วย notifyBatchResult -> กัน SweetAlert ของแต่ละใบทับกันจนเห็นแค่ใบสุดท้าย
  //  ใช้ Location id ที่ค้นเจอจาก Pre-zone และ sync location เข้า Pallet อื่นในกลุ่มเดียวกัน
  private putAwayPickingPallets(pallets: PalletToPlaceItem[], location: any): void {
    const placedLocationName = this.scanLogic.fallback(location.location_desc ?? location.location_code);
    const placedLocation: PalletTargetLocation = { location: placedLocationName };

    const preparedList = pallets.map((pallet) => ({
      pallet,
      rawItem: this.scanLogic.resolveItemForPallet(pallet, this._jobDataRaw?.items ?? []),
    }));

    const requests = preparedList.map(({ pallet, rawItem }) => {
      //  ใช้ scanned_qr_code จริงจาก receive_pallet (backend) ก่อนเสมอ เผื่อ pallet.qrCode ที่ track ไว้ฝั่ง client หายไป (ข้าม session)
      const receivePoolEntry = this.scanLogic.findReceivePoolEntryForPallet(this._jobDataRaw, pallet);
      const requestData = {
        itemId: rawItem?.id ?? 0,
        locationId: location.id,
        locationType: this._jobDataRaw?.to_location_type ?? '',
        updateBy: this._currentUserId,
        qrCode: receivePoolEntry?.scanned_qr_code || pallet.qrCode || '',
      };
      return this.runOrQueueJobApi('putAway', this._jobDataRaw.id, requestData, pallet.qrCode ?? '').pipe(
        map(() => ({ success: true as const })),
        catchError((err) => of({ success: false as const, message: err?.error?.message as string | undefined })),
      );
    });

    //  ยิงทีละใบตามลำดับ (concat) แทนพร้อมกันหมด (forkJoin เดิม) -> กัน request หลายใบไปชนกันที่ backend พร้อมกันจริง
    //  (เหตุผลเดียวกับฝั่ง put-away ที่ handleLocationScan) ผลลัพธ์/modal สรุปท้ายสุดเหมือนเดิมทุกอย่าง
    concat(...requests).pipe(toArray()).subscribe((results) => {
      const succeededPallets: PalletToPlaceItem[] = [];
      const failedPallets: PalletToPlaceItem[] = [];
      const failedMessages = new Map<PalletToPlaceItem, string>();

      results.forEach((result, i) => {
        const { pallet, rawItem } = preparedList[i];

        if (!result.success) {
          if (result.message) failedMessages.set(pallet, result.message);
          failedPallets.push(pallet);
          return;
        }

        if (rawItem) {
          rawItem.locations ??= {};
          rawItem.locations.to_locations = [
            { id: location.id, wh_code: location.wh_code ?? null, location_id: location.id, location_name: placedLocationName },
          ];
        }

        //  sync location เข้า pallet อื่นในกลุ่มเดียวกัน (item เดียวกัน) ที่ยังไม่มี location
        this.syncFreeLocationToSiblingPallets(pallet, placedLocation);

        this.markPalletPutAwayComplete(pallet, placedLocation, rawItem);
        succeededPallets.push(pallet);
      });

      if (succeededPallets.length > 0) this.saveJobDataToSession();

      this.refreshDisplayList();
      this.notifyBatchResult('จัดวางพาเลท', succeededPallets, failedPallets, 'ใบ', 'สำเร็จทั้งหมด', 'สำเร็จ', failedMessages);
    });
  }

  private syncFreeLocationToSiblingPallets(pallet: PalletToPlaceItem, placedLocation: PalletTargetLocation): void {
    const isSameItem = (p: PalletToPlaceItem) =>
      pallet.itemId !== undefined ? p.itemId === pallet.itemId : this.scanLogic.gradesMatch(p.grade, pallet.grade) && p.lotNo === pallet.lotNo;

    [...this._palletToPlaceList, ...this._palletsAwaitingSourceLocation].forEach((p) => {
      if (isSameItem(p) && p.targetLocations.length === 0) {
        p.targetLocations = [placedLocation];
      }
    });
  }

  //  ดึงรายการ Location ปลายทางของ Pallet (ใช้จาก Template)
  getTargetLocationsList(pallet: PalletToPlaceItem): PalletTargetLocation[] {
    const rawItem = this.scanLogic.resolveItemForPallet(pallet, this._jobDataRaw?.items ?? []);
    return this.scanLogic.buildTargetLocations(rawItem);
  }

  //  เฉพาะ Inbound: ซ่อน location ที่เต็มโควต้าแล้ว (complete >= total) ออกจาก badge "นำไปวางที่" เหลือแต่ตัวเลือกที่ยังวางได้จริง
  //  กันเคสกรองแล้วว่างเปล่าหมด (ตามหลักการไม่เกิด เพราะโควต้าต่อ location รวมกันแล้วเท่ากับจำนวน pallet ทั้งหมดพอดีอยู่แล้ว แต่เผื่อไว้)
  getVisibleTargetLocations(pallet: PalletToPlaceItem): PalletTargetLocation[] {
    const all = this.getTargetLocationsList(pallet);
    if (!this._isInboundJob) return all;

    const notFull = all.filter((loc) => loc.totalQty === undefined || (loc.completeQty ?? 0) < loc.totalQty);
    return notFull.length > 0 ? notFull : all;
  }

  //  โชว์แค่ 2 location แรกในการ์ด เกินกว่านั้นกดดู "+N more" เป็น modal แทน (เหมือน route-summary-row ด้านบน
  //  กันแถบ "นำไปวางที่" ล้นถ้า pallet ใบนั้น ambiguous ไปได้หลาย location)
  getVisibleTargetLocationsPrimary(pallet: PalletToPlaceItem): PalletTargetLocation[] {
    return this.getVisibleTargetLocations(pallet).slice(0, 2);
  }

  getVisibleTargetLocationsExtraCount(pallet: PalletToPlaceItem): number {
    return Math.max(0, this.getVisibleTargetLocations(pallet).length - 2);
  }

  onClickShowAllTargetLocations(pallet: PalletToPlaceItem): void {
    const locations = this.getVisibleTargetLocations(pallet);
    const rows = locations
      .map((loc) => {
        const qtyText = this._isInboundJob && loc.totalQty !== undefined ? ` (${loc.completeQty ?? 0}/${loc.totalQty})` : '';
        return `<div style="padding:16px 0; font-size:34px; font-weight:700; border-bottom:1px solid #f0f0f0;">${this.formatLocationDisplay(loc.location)}${qtyText}</div>`;
      })
      .join('');

    Swal.fire({
      position: 'center',
      title: `Location ปลายทางทั้งหมด (${locations.length})`,
      html: `<div style="text-align:left;">${rows}</div>`,
      showConfirmButton: true,
      confirmButtonText: 'ปิด',
    });
  }

  //  ─────────────────────────────────────────────────────────────
  //  DELETE PALLET
  //  ─────────────────────────────────────────────────────────────
  onClickDeletePallet(pallet: PalletToPlaceItem): void {
    Swal.fire({
      icon: 'warning',
      title: 'ยืนยันการลบพาเลท',
      text: `ต้องการลบพาเลทหมายเลข ${pallet.id ?? '-'} ออกจากรายการที่รอเอาไปวางใช่หรือไม่?`,
      showCancelButton: true,
      confirmButtonText: 'ลบ',
      cancelButtonText: 'ยกเลิก',
      customClass: { popup: 'scan-pallet-delete-confirm' },
    }).then((result) => {
      if (result.isConfirmed) this.deletePalletFromPlaceList(pallet);
    });
  }

  //  ลบ Pallet ออกจากรายการที่รอเอาไปวาง -> ใช้ from_location ที่ผูกไว้กับ pallet นี้จริง (fromLocationId)
  //  แทนการ hardcode from_locations[0] เพื่อคืนโควต้ากลับที่ location ต้นทางที่ถูกต้อง
  private deletePalletFromPlaceList(pallet: PalletToPlaceItem): void {
    const matchedItem = this.scanLogic.resolveItemForPallet(pallet, this._jobDataRaw?.items ?? []);

    if (!matchedItem) {
      this.SweetAlert('error', 'ไม่พบข้อมูลสินค้าของพาเลทนี้ ไม่สามารถลบได้');
      return;
    }

    const fromLocation = this.scanLogic.resolveFromLocationByPallet(matchedItem, pallet);
    const resetAmount = this._isSpecialJob ? (pallet.qty ?? 0) : 1;
    const requestData: any = {
      itemId: matchedItem.id,
      locationId: fromLocation?.location_id ?? 0,
      locationType: this._jobDataRaw?.from_location_type ?? '',
      updateBy: this._currentUserId,
    };
    //  BK อยู่กลุ่ม _isAutoSpecialJob แล้วแต่ reset ยังยิง endpoint ของ special (BK ไม่มี reset ของตัวเอง) -> ส่งแบบ special เหมือนเดิม
    if (this._isAutoSpecialJob && !this._isBkJob) {
      //  งาน RQ/Transfer WH/IT: /request, /transfer-wh และ /internal-transfer reset-pallet contract ไม่เหมือน Special/BK
      //  (ไม่มี palletId/qty ในสัญญาเลย ต้องส่ง palletSeq แทน ไม่งั้น backend หา pallet ที่จะ reset ไม่เจอ — ของ IT คอนเฟิร์ม
      //  จาก comment เดิมตรงงานปกติ/manifest ด้านล่างอยู่แล้วว่า contract เดียวกัน) ใช้ palletSeq ของ
      //  pallet ใบนี้ตรงๆ (เลขกล่องที่ client คิดเอง เหมือนตอน Get)
      requestData.palletSeq = pallet.palletSeq ?? 0;
      //  หา entry จริงใน receive_pallet ด้วย specialEntryIds ตรงๆ (แม่นกว่าจับคู่แค่ grade/lot เพราะ 1 item อาจมีหลาย
      //  pallet ค้างพร้อมกัน — pattern เดียวกับที่ preparePutAwayList ใช้ตอน put-away อยู่แล้ว) เดิมใช้
      //  findSpecialReceivePoolEntryForItem ที่จับคู่แค่ grade/lot ของ item เฉยๆ พอมีหลายใบ grade/lot เดียวกันค้างพร้อมกัน
      //  (.find() คืนใบแรกที่เจอเสมอ) ลบ 2 ใบติดกันเลยไปโดน record เดิมซ้ำ ใบที่ 2 ที่ตั้งใจลบจริงไม่เคยถูก reset ที่ backend เลย
      const entryIds = this.getSpecialEntryIds(pallet);
      const receivePool: any[] = this._jobDataRaw?.pallets?.receive_pallet ?? [];
      const receivePoolEntry = receivePool.find((p: any) => entryIds.includes(p.id));
      const rawQrCode = receivePoolEntry?.scanned_qr_code || pallet.qrCode || '';
      //  โค้ด PL: ส่งแค่ rawCode เหมือนตอน Get/Put เสมอ ไม่ใช่โค้ด PL (Jumbo Bag/นับน้ำหนักสะสม) -> ส่งเต็มเหมือนเดิม
      requestData.qrCode = this.scanLogic.parseFullPalletScanCode(rawQrCode)?.rawCode ?? rawQrCode;
    } else if (this._isSpecialJob) {
      requestData.palletId = Number(pallet.id) || 0;   //  Special/BK เท่านั้นที่ยังส่ง palletId (ไม่แตะพฤติกรรมเดิม)
      requestData.qty = resetAmount;
      //  เหตุผลเดียวกับฝั่ง RQ/IT/TW ด้านบน (จับคู่ด้วย specialEntryIds แม่นกว่า grade/lot เฉยๆ)
      const entryIds = this.getSpecialEntryIds(pallet);
      const receivePool: any[] = this._jobDataRaw?.pallets?.receive_pallet ?? [];
      const receivePoolEntry = receivePool.find((p: any) => entryIds.includes(p.id));
      requestData.qrCode = receivePoolEntry?.scanned_qr_code || pallet.qrCode || '';
    } else {
      //  งานปกติ (Inbound/Outbound/Picking): เหมือนกัน แต่จับคู่ด้วย pallet id ตรงๆ แทน grade/lot
      const receivePoolEntry = this.scanLogic.findReceivePoolEntryForPallet(this._jobDataRaw, pallet);
      const rawQrCode = receivePoolEntry?.scanned_qr_code || pallet.qrCode || '';
      //  โค้ด PL: reset ต้องส่งแค่ rawCode ("PLM...") เหมือน Get/Put ไม่ใช่ทั้งสตริง "PLM...|grade|lot|qty" -> ตัดเอาส่วนแรกเสมอ กันหลุดส่งทั้งสตริงไม่ว่าค่าจะมาจากทางไหน
      requestData.qrCode = this._isManualPalletJob ? String(rawQrCode).split('|')[0]?.trim() : rawQrCode;
      //  งาน IT: /internal-transfer/reset-pallet ต้องการ palletSeq มาด้วย (ไม่มี palletId/qty เหมือน Special) -> ไม่มี concept
      //  Add Pallet/palletSeq ในโหมด manual pallet นี้ ใช้ 0 เสมอ
      if (this._isInternalTransferJob) requestData.palletSeq = 0;
    }

    this.runOrQueueJobApi('reset', this._jobDataRaw.id, requestData, pallet.qrCode ?? '').subscribe({
      next: () => {
        this._palletToPlaceList = this._palletToPlaceList.filter((p) => p !== pallet);
        this._selectedPalletsForPlacement = this._selectedPalletsForPlacement.filter((p) => p !== pallet);

        //  receive_qty ความหมายกลับกันระหว่าง 2 กลุ่มงาน: งานปกติ = เหลือกี่ใบที่ยังไม่ได้รับ (ลดตอน Get ด้วย -= 1 ที่
        //  runInboundGet) ลบแล้วคืนโควต้า = บวกกลับถูกแล้ว / งาน Special (RQ/IT/TW ฯลฯ) = รับไปแล้วกี่หน่วยสะสม (เพิ่ม
        //  ตอน Get ด้วย += ที่ getSpecialFullPallet/onConfirmSpecialQty) ลบแล้วต้องลบของที่เพิ่งบวกไปออก ไม่ใช่บวกซ้ำ
        //  (ไม่งั้นตัวเลข "รับสำเร็จ" ที่ progress bar ยิ่งเพิ่มขึ้นตอนลบ กลับทิศที่ควรจะเป็น)
        matchedItem.receive_qty = Math.max(0, (matchedItem.receive_qty ?? 0) + (this._isSpecialJob ? -resetAmount : resetAmount));
        if (this._isSpecialJob) this.adjustSpecialFromLocationReceived(fromLocation, -resetAmount);

        //  ไม่ใส่ pallet นี้กลับเข้า receive_pallet เอง -> ยืนยันจาก backend จริงแล้วว่า reset ไม่ได้คืนกลับเข้า pool
        //  (ลบแล้วหายไปเลย ไม่กลับมาให้หยิบซ้ำ) ถ้าเครื่องไปใส่คืนเองจะไม่ตรงกับ backend ทันที โดยเฉพาะงาน 2-step ที่มี
        //  logic คอยดึงของ "ใหม่" จาก receive_pallet มาเติม _palletToPlaceList ให้อัตโนมัติ (ดู refreshJobProgressFromServer)
        //  จะเข้าใจผิดว่าเจอของใหม่แล้วดึงพาเลทที่เพิ่งลบกลับเข้ารายการรอวางทันที เหมือนลบไม่ออกเลย

        //  ยังไม่พอ: receive_pallet ดิบของ server เองก็ยังมี record เดิมค้างอยู่ได้ (ไม่ได้ลบออกจาก array ทันที แค่
        //  item.receive_qty ลดแทน) -> ต้องจำไว้เองฝั่งเครื่องด้วยว่าพาเลทนี้เพิ่งถูกลบไปในเซสชันนี้ กัน auto-poll รอบถัดไป
        //  เข้าใจผิดว่าเป็นของใหม่จาก record เดิมที่ยังค้างอยู่ใน array (ดู knownDeletedKeys ที่ refreshJobProgressFromServer)
        [pallet.backendId, pallet.qrCode].forEach((key) => {
          if (key) this._deletedPalletKeysThisSession.add(this.scanLogic.normalizeQrCodeForMatch(key));
        });

        this.SweetAlert('success', '', this.buildBatchResultHtml('success', 'ลบพาเลทออกจากรายการที่รอเอาไปวางสำเร็จ', this.formatPalletDetailRows([pallet]), 17));

        this.autoSelectPalletsIfEligible();
        this.saveJobDataToSession();
        this.refreshDisplayList();
      },
      error: () => this.SweetAlert('error', 'ไม่สามารถลบพาเลทนี้ได้ กรุณาลองใหม่อีกครั้ง'),
    });
  }

  //  ─────────────────────────────────────────────────────────────
  //  DISPLAY: FORMATTING & LIST BUILDING (สรุป Pallet ฝั่งขวา)
  //  ─────────────────────────────────────────────────────────────
  //  แสดง qty ของแถวฝั่งขวา: งาน special ส่ง qty มาเป็น string ("x/total ถุง") พร้อมแสดงผลอยู่แล้ว -> โชว์ตรงๆ
  //  งานปกติ qty เป็นตัวเลข -> จัด format ใส่ comma คั่นหลักพัน (แทนที่ number pipe เดิมที่ใช้กับ string ไม่ได้)
  formatDisplayQty(qty: number | string): string {
    return typeof qty === 'number' ? qty.toLocaleString() : qty;
  }

  //  Display เท่านั้น: Location code ที่ขึ้นต้นด้วย "M" (เช่น M42A0002) -> โชว์เป็น "WH42A0002" แทน
  //  ไม่แตะค่าจริงที่ใช้ match กับโค้ดที่สแกน/ยิง API เลย (เรียกเฉพาะตอนแสดงผลเท่านั้น)
  formatLocationDisplay(code?: string | null): string {
    if (!code) return code ?? '';
    return code.startsWith('M') ? 'WH' + code.slice(1) : code;
  }

  //  งาน Special: item ที่ถูก "ส่งให้ Step 2" ไว้แล้ว แต่ยังไม่มีใครมาสแกนรับจริง (ยังไม่ครบ receive_qty+complete_qty)
  //  -> แสดงเป็นการ์ดเหลืองในลิสต์ซ้าย ให้คนทำ Step 2 เห็นว่ามีอะไรรอเขาอยู่บ้าง
  get _specialPreparedList(): SpecialPreparedDisplayItem[] {
    if (!this._isSpecialJob) return [];

    const items = this._jobDataRaw?.items ?? [];

    return items
      .filter((item: any) => {
        const total = item.total_qty ?? 0;
        const progressQty = (item.receive_qty ?? 0) + (item.complete_qty ?? 0);
        if (total <= 0 || progressQty >= total) return false;
        return this.scanLogic.isSpecialItemPrepared(item, this._jobDataRaw);
      })
      .map((item: any) => ({
        key: `${item.id}-prepared`,
        grade: item.grade,
        lotNo: this.scanLogic.resolveSpecialDisplayLot(item) || 'ไม่ระบุ Lot',
        progressLabel: `${(item.receive_qty ?? 0) + (item.complete_qty ?? 0)}/${item.total_qty} กก.`,
        targetLocations: this.scanLogic.buildTargetLocations(item),
      }));
  }

  //  รวมรายการ Pallet ทั้งหมดฝั่งขวา แยกตามสถานะ (เขียว/น้ำเงิน/ม่วง/เหลือง)
  get _totalPalletDisplayList(): TotalPalletDisplayItem[] {
    if (this._isSpecialJob) return this.buildSpecialPalletDisplayRows();

    const items = this._jobDataRaw?.items ?? [];

    const pendingList: TotalPalletDisplayItem[] = [];
    const sourceWaitingList: TotalPalletDisplayItem[] = [];
    const waitingList: TotalPalletDisplayItem[] = [];
    const completeList: TotalPalletDisplayItem[] = [];

    items.forEach((item: any) => {
      this.buildDisplayRowsForItem(item, { pendingList, sourceWaitingList, waitingList, completeList });
    });

    this.sortById(waitingList);
    this.sortById(completeList);
    this.sortById(sourceWaitingList);

    return [...sourceWaitingList, ...waitingList, ...pendingList, ...completeList];
  }

  //  งานปกติเท่านั้น: เหมือน _totalPalletDisplayList เป๊ะ (เรียก buildDisplayRowsForItem ตัวเดิม) แค่แยก bucket เป็นต่อ item
  //  แทนที่จะรวมเป็น bucket กลาง -> ได้ row ของแต่ละ item แยกเป็นกลุ่มของตัวเอง ให้ UI แสดงเป็น card ย่อ/ขยายได้ทีละ item
  get _totalPalletGroupedList(): TotalPalletGroup[] {
    const items = this._jobDataRaw?.items ?? [];

    return items.map((item: any) => {
      const pendingList: TotalPalletDisplayItem[] = [];
      const sourceWaitingList: TotalPalletDisplayItem[] = [];
      const waitingList: TotalPalletDisplayItem[] = [];
      const completeList: TotalPalletDisplayItem[] = [];

      this.buildDisplayRowsForItem(item, { pendingList, sourceWaitingList, waitingList, completeList });

      this.sortById(waitingList);
      this.sortById(completeList);
      this.sortById(sourceWaitingList);

      const rows = [...sourceWaitingList, ...waitingList, ...pendingList, ...completeList];

      return {
        key: String(item.id),
        grade: this.scanLogic.fallback(item.grade),
        lotNo: this.scanLogic.fallback(item.lot_no),
        doneCount: completeList.length,
        totalCount: rows.length,
        rows,
      };
    });
  }

  //  เก็บ key ของกลุ่มที่ถูกกดย่อไว้ (ค่าเริ่มต้น = ขยายทุกกลุ่ม เหมือนพฤติกรรมเดิมก่อนมี group)
  private _collapsedGroupKeys = new Set<string>();

  isGroupCollapsed(key: string): boolean {
    return this._collapsedGroupKeys.has(key);
  }

  toggleGroupCollapse(key: string): void {
    const next = new Set(this._collapsedGroupKeys);
    next.has(key) ? next.delete(key) : next.add(key);
    this._collapsedGroupKeys = next;
  }

  trackByGroupKey(index: number, g: TotalPalletGroup): string {
    return g.key;
  }

  //  งาน Special: รวม grade/lot เดียวกันเป็นบรรทัดเดียว บวก qty กัน -> ไม่ต้องขึ้นทุกถุงที่สแกนแยกกัน
  private groupSpecialContents(
    lines: { grade: string; lot: string; qty: number }[],
  ): { grade: string; lot: string; qty: number }[] {
    const map = new Map<string, { grade: string; lot: string; qty: number }>();
    lines.forEach((line) => {
      const key = `${line.grade}|${line.lot}`;
      const existing = map.get(key);
      if (existing) existing.qty += line.qty;
      else map.set(key, { ...line });
    });
    return Array.from(map.values());
  }

  //  งาน Special: pallet มีมากกว่า 1 grade/lot -> กดไอคอนตาข้างบรรทัดแรกเพื่อดูรายการทั้งหมด + qty รวมของ pallet นั้น
  onClickShowPalletContents(p: TotalPalletDisplayItem): void {
    this._specialContentsModal = { seq: p.palletSeq ?? 0, contents: p.contents ?? [] };
  }

  onCloseSpecialContentsModal(): void {
    this._specialContentsModal = null;
  }

  //  งาน Special: 1 แถว = 1 pallet (palletSeq) ไม่ใช่ 1 แถวต่อ item เหมือนงานปกติ เพราะ 1 pallet ใส่ได้หลาย grade/lot ผสมกัน
  private buildSpecialPalletDisplayRows(): TotalPalletDisplayItem[] {
    const rows: TotalPalletDisplayItem[] = [];

    //  เปิดอยู่ (ยังไม่กด "เตรียมเอาไปวาง") -> Get เพิ่มได้เรื่อยๆ, กด card เพื่อ select ก่อน Get
    [...this._specialOpenPallets]
      .sort((a, b) => a.seq - b.seq)
      .forEach((g) => {
        //  ถุงที่สแกนแล้วแต่ยังไม่ได้ยืนยัน Location ต้นทางของ pallet นี้ -> ขึ้น label บอกไว้ที่ท้ายการ์ด กันคนใช้ลืมว่าต้องสแกนที่ไหน
        //  โชว์เฉพาะ entry ที่ "ยืนยันแล้วจริง" เท่านั้น (isFullPallet เต็มพาเลทไม่มี modal ให้นับอยู่แล้ว โชว์ทันที หรือกดปุ่ม
        //  "ยืนยัน" ล็อกจำนวนถุงแล้ว มี lockedCodes ดู onLockSpecialQtyForLocationScan) -> entry ที่กำลังนับถุงอยู่ ไม่ว่า modal
        //  จะเปิดอยู่หรือถูกปิดไปแล้วด้วย × โดยยังไม่กดยืนยัน (ยังไม่มี lockedCodes) ไม่ขึ้นป้ายม่วงเลยทั้ง 2 กรณี กัน user
        //  เห็นป้าย "รอสแกน Location" ค้างทั้งที่ยังไม่ได้ยืนยันอะไรจริง
        const pendingEntries = this._specialAwaitingSourceLocation.filter(
          (e) => e.palletSeq === g.seq && (e.isFullPallet || e.lockedCodes),
        );
        const pendingLocations = Array.from(new Set(pendingEntries.map((e) => this.specialSourceLocationText(e.item, e.sourceLocation, this.specialEntryDemand(e)))));
        //  งาน RQ/Transfer WH/IT: กดปุ่ม "ยืนยัน" ล็อกจำนวนถุงไว้แล้ว (ดู onLockSpecialQtyForLocationScan) -> โชว์ยอดรวม
        //  ไปกับป้ายด้วยเลย กันดูเหมือนกล่องว่างทั้งที่มีของรอส่งอยู่จริง (ยังไม่กดล็อก/ยังนับอยู่ -> ไม่มี lockedCodes ไม่มียอดโชว์)
        const lockedEntries = pendingEntries.filter((e) => e.lockedCodes);
        const pendingQty = lockedEntries.reduce((sum, e) => sum + this.computeSpecialModalQty(e.fullPalletRecord, e.lockedCodes!.length), 0);
        const pendingBagCount = lockedEntries.reduce((sum, e) => sum + e.lockedCodes!.length, 0);
        //  หมายเลขพาเลทของกล่องนี้: ถุง/พาเลทที่ Get เข้ากล่องแล้ว + ที่ยืนยันแล้วรอสแกน Location ต้นทาง (ป้ายม่วง) ไม่นับ
        //  entry ที่ยังนับถุงอยู่ ให้ตรงกับเงื่อนไขขึ้นป้ายม่วงด้านบน
        const palletNos = this.specialPalletNos([
          ...g.entries.flatMap((e) => [e.qrCode, ...(e.bagCodes ?? [])]),
          ...pendingEntries.flatMap((e) => [e.code, ...(e.lockedCodes ?? [])]),
        ]);

        rows.push({
          key: `special-open-${g.seq}`,
          grade: `Pallet #${this.specialSeqDisplayLabel(g.seq)}`,
          lotNo: '',
          qty: '',
          id: null,
          status: 'special-open',
          palletSeq: g.seq,
          contents: this.groupSpecialContents(g.entries.map((e) => ({ grade: e.grade, lot: e.lotNo, qty: e.qty ?? 0 }))),
          locationName: pendingLocations.length > 0 ? pendingLocations.join(', ') : undefined,
          pendingLockedQty: pendingQty > 0 ? pendingQty : undefined,
          pendingLockedBagCount: pendingBagCount > 0 ? pendingBagCount : undefined,
          palletNos: palletNos || undefined,
        });
      });

    //  ปิดแล้ว (กด "เตรียมเอาไปวาง" ไปแล้ว) รอสแกน Location ปลายทาง -> กลุ่มจาก _palletToPlaceList ตาม palletSeq
    const waitingBySeq = new Map<number, PalletToPlaceItem[]>();
    this._palletToPlaceList.forEach((p) => {
      const seq = p.palletSeq ?? 0;
      const list = waitingBySeq.get(seq) ?? [];
      list.push(p);
      waitingBySeq.set(seq, list);
    });
    Array.from(waitingBySeq.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([seq, entries]) => {
        rows.push({
          key: `special-waiting-${seq}`,
          grade: `Pallet #${this.specialSeqDisplayLabel(seq)}`,
          lotNo: '',
          qty: '',
          id: null,
          status: 'waiting-location',
          palletSeq: seq,
          contents: this.groupSpecialContents(entries.map((e) => ({ grade: e.grade, lot: e.lotNo, qty: e.qty ?? 0 }))),
          palletNos: this.specialPalletNos(entries.flatMap((e) => [e.qrCode, ...(e.bagCodes ?? [])])) || undefined,
        });
      });

    //  วางสำเร็จแล้ว -> กลุ่มจาก pallets.complete_pallet (backend คืน pallet_seq มาให้แล้ว)
    const completePool: any[] = this._jobDataRaw?.pallets?.complete_pallet ?? [];
    const completeBySeq = new Map<number, any[]>();
    completePool.forEach((p: any) => {
      const seq = p.pallet_seq ?? 0;
      const list = completeBySeq.get(seq) ?? [];
      list.push(p);
      completeBySeq.set(seq, list);
    });
    Array.from(completeBySeq.entries())
      .filter(([seq]) => !waitingBySeq.has(seq))   //  กันโชว์ซ้ำ: seq เดียวกันไม่ควรขึ้นทั้งบล็อก "รอวาง" และ "วางสำเร็จ" พร้อมกัน
      .sort((a, b) => a[0] - b[0])
      .forEach(([seq, entries]) => {
        rows.push({
          key: `special-complete-${seq}`,
          grade: `Pallet #${this.specialSeqDisplayLabel(seq)}`,
          lotNo: '',
          qty: '',
          id: null,
          status: 'complete',
          palletSeq: seq,
          contents: this.groupSpecialContents(entries.map((e: any) => ({
            grade: this.scanLogic.fallback(e.grade),
            lot: this.scanLogic.fallback(e.lot),
            qty: e.qty ?? 0,
          }))),
          palletNos: this.specialPalletNos(entries.map((e: any) => e.scanned_qr_code)) || undefined,
        });
      });

    return rows;
  }

  //  คำนวณแถวแสดงผลของ Item เดียว แล้วผลักเข้า bucket ที่เกี่ยวข้อง (สีเขียว/น้ำเงิน/ม่วง/เหลือง) — งานปกติเท่านั้น (special ใช้ buildSpecialPalletDisplayRows แทน)
  private buildDisplayRowsForItem(
    item: any,
    buckets: {
      pendingList: TotalPalletDisplayItem[];
      sourceWaitingList: TotalPalletDisplayItem[];
      waitingList: TotalPalletDisplayItem[];
      completeList: TotalPalletDisplayItem[];
    },
  ): void {

    const total = this.scanLogic.resolveItemTotalQty(item);

    const completedFromServer = this._completedPalletsByItem.get(item.id) ?? [];
    const completedServerIds = new Set(completedFromServer.map((p: any) => String(p.id)));
    const completedServerCodes = new Set(completedFromServer.map((p: any) => this.scanLogic.normalizeQrCodeForMatch(p?.scanned_qr_code)));

    const belongsToItem = (p: PalletToPlaceItem) =>
      p.itemId !== undefined ? p.itemId === item.id : this.scanLogic.gradesMatch(p.grade, item.grade) && p.lotNo === item.lot_no;

    const completedThisSession = this._completedPalletList.filter((p) => belongsToItem(p));

    const knownCompletedCount = completedFromServer.length + completedThisSession.length;
    const green = Math.min(item.complete_qty ?? 0, total, knownCompletedCount);

    //  pallet ที่ backend จัดวางเสร็จแล้วต้องไม่โผล่ซ้ำเป็นสีน้ำเงิน -> จับด้วยโค้ดถุง (มีทั้งสองฝั่ง) ก่อน ไม่งั้นค่อยเทียบ id
    //  (id ของ pallet ที่สแกนสด = เลขท้ายโค้ด ส่วนของ backend = id ของ record คนละความหมายกัน เทียบตรงๆ อาจชนกันมั่ว)
    const isCompletedOnServer = (p: PalletToPlaceItem) =>
      p.qrCode
        ? completedServerCodes.has(this.scanLogic.normalizeQrCodeForMatch(p.qrCode))
        : !!(p.id && completedServerIds.has(p.id));

    const bluePalletsAll = this._palletToPlaceList.filter((p) => belongsToItem(p) && !isCompletedOnServer(p));

    const remainingAfterGreen = Math.max(0, total - green);
    const blue = Math.min(bluePalletsAll.length, remainingAfterGreen);
    const bluePallets = bluePalletsAll.slice(0, blue);

    const purplePalletsAll = this._isOutbound
      ? this._palletsAwaitingSourceLocation.filter((p) => belongsToItem(p))
      : [];

    const remainingAfterBlue = Math.max(0, remainingAfterGreen - blue);
    const purple = Math.min(purplePalletsAll.length, remainingAfterBlue);
    const purplePallets = purplePalletsAll.slice(0, purple);

    const yellow = Math.max(0, total - green - blue - purple);

    //  เขียว: Complete Pallet
    for (let i = 0; i < green; i++) {
      let palletId: string | null = null;
      let backendId: string | undefined;
      let locationName: string | undefined;
      let rawPalletNo: string | null = null;
      let lotNo: any = this.scanLogic.fallback(item.lot_no);
      //  ใช้ grade ของ record จริงก่อนเสมอ (เหมือน lotNo ด้านล่าง) ไม่ใช้ item.grade เฉยๆ เพราะ buildCompletedPalletsByItem
      //  จับคู่ record ด้วย grade/lot แล้วก็จริง แต่ถ้า backend ส่ง complete_pallet มาไม่ครบ/ไม่ตรงจริงๆ (fallback
      //  pool.shift() ใน takeMatchingPallet) จะได้เห็น grade ที่ถูกต้องตาม record จริงไว้ก่อน ไม่ใช่ grade ของ item ผิดๆ
      let grade: any = this.scanLogic.fallback(item.grade);

      if (i < completedFromServer.length) {
        const serverPallet = completedFromServer[i];
        //  โค้ด PL: complete_pallet ของ backend ก็มี scanned_qr_code ติดมาด้วย (เหมือน pallet_manual) -> ใช้ rawCode นำหน้าเหมือนตอนยังรอวาง
        //  ไม่งั้นพอ reload แล้ว item.complete_qty ขยับ (ผ่าน completedFromServer แทน completedThisSession) จะเห็น backend id แทน rawCode ทันที
        const rawCode = String(serverPallet?.scanned_qr_code ?? '').split('|')[0]?.trim();
        backendId = serverPallet ? String(serverPallet.id) : undefined;
        if (rawCode && rawCode.startsWith('PL')) {
          palletId = rawCode;
        } else {
          palletId = serverPallet ? String(serverPallet.id) : null;
        }
        rawPalletNo = this.deriveRawPalletNo(serverPallet?.scanned_qr_code);
        grade = this.scanLogic.fallback(serverPallet?.grade ?? item.grade);
        lotNo = this.scanLogic.fallback(serverPallet?.lot ?? item.lot_no);
      } else {
        const real = completedThisSession[i - completedFromServer.length];
        palletId = real?.id ?? null;
        backendId = real?.backendId;
        rawPalletNo = this.deriveRawPalletNo(real?.qrCode);
        locationName = this.formatLocationDisplay(real?.targetLocations?.[0]?.location);
        grade = this.scanLogic.fallback(real?.grade ?? item.grade);
        lotNo = this.scanLogic.fallback(real?.lotNo ?? item.lot_no);
      }

      let qty: any = item.qty;
      if (i < completedFromServer.length) {
        qty = completedFromServer[i]?.qty ?? item.qty;
      } else {
        qty = completedThisSession[i - completedFromServer.length]?.qty ?? item.qty;
      }

      buckets.completeList.push({
        key: `${item.id}-green-${i}`,
        grade,
        lotNo,
        qty,
        id: palletId,
        backendId,
        rawPalletNo,
        status: 'complete',
        locationName,
      });
    }

    //  น้ำเงิน: รอ Location ปลายทาง
    //  ใช้ grade จริงของ pallet ใบนั้น (p.grade) ก่อนเสมอ ไม่ใช่ item.grade -> ตรงกับ record จริงใน receive_pallet
    //  เหมือนการ์ดสีเขียวที่ใช้ serverPallet.grade อยู่แล้ว (item.grade เป็นแค่ fallback เผื่อ p.grade ไม่มีค่า)
    bluePallets.forEach((p, i) => {
      buckets.waitingList.push({
        key: `${item.id}-blue-${i}`,
        grade: this.scanLogic.fallback(p.grade ?? item.grade),
        lotNo: this.scanLogic.fallback(p.lotNo ?? item.lot_no),
        qty: p.qty ?? item.qty,
        id: p.id,
        backendId: p.backendId,
        rawPalletNo: this.deriveRawPalletNo(p.qrCode),
        status: 'waiting-location',
      });
    });

    //  ม่วง: รอ Location ต้นทาง
    purplePallets.forEach((p, i) => {
      buckets.sourceWaitingList.push({
        key: `${item.id}-purple-${i}`,
        grade: item.grade,
        lotNo: this.scanLogic.fallback(p.lotNo ?? item.lot_no),
        qty: p.qty ?? item.qty,
        id: p.id,
        rawPalletNo: this.deriveRawPalletNo(p.qrCode),
        status: 'waiting-source-location',
        locationName: this.formatLocationDisplay(p.sourceLocation),
      });
    });

    //  เหลือง: รอสแกนถุง -> งาน manual pallet มี item.pallet_manual บอกไว้ล่วงหน้าอยู่แล้วว่าถุงไหนบ้าง (grade/lot/qty/id จริง/โค้ด PL จริง)
    //  ไม่ต้องรอสแกนก่อนถึงจะรู้เหมือนงานทั่วไป ใช้ข้อมูลจริงแสดงได้เลย
    if (this._isManualPalletJob) {
      //  กันซ้ำกับถุงที่ "รู้จักแล้ว" ทุก bucket ไม่ใช่แค่ server (receive_pallet/complete_pallet) เพราะถุงที่เพิ่ง Get สำเร็จใน
      //  session นี้ (ขึ้น bucket น้ำเงิน/เขียวแล้ว) ยังไม่ถูกมิเรอร์กลับเข้า _jobDataRaw.pallets จนกว่าจะ reload หน้า
      //  ใช้ normalizeQrCode เทียบทั้งโค้ด (ไม่ใช่ตัดเอาแค่ส่วนแรกก่อน "|" ซึ่งใช้ได้แค่โค้ด PL) เพราะ pallet_assigned บางใบ
      //  เป็นโค้ดถุงปกติ (5 ส่วน ขึ้นต้นด้วย cost center) ตัดแบบเดิมจะได้ cost center มาเทียบ ไม่ใช่ตัวบ่งชี้ถุงจริง เลยไม่เคยตรงกับ p.id
      const accountedCodes = new Set<string>(
        [
          ...completedFromServer.map((p: any) => this.scanLogic.normalizeQrCodeForMatch(p?.scanned_qr_code)),
          ...completedThisSession.map((p) => this.scanLogic.normalizeQrCodeForMatch(p.qrCode)),
          ...bluePalletsAll.map((p) => this.scanLogic.normalizeQrCodeForMatch(p.qrCode)),
          ...purplePalletsAll.map((p) => this.scanLogic.normalizeQrCodeForMatch(p.qrCode)),
        ].filter((code): code is string => !!code),
      );
      this.buildManualPendingRowsForItem(item, accountedCodes, buckets.pendingList);
    } else {
      this.buildPendingRowsForItem(item, yellow, buckets.pendingList);
    }
  }

  //  งาน manual pallet เท่านั้น: item.pallet_manual เป็น manifest คงที่ (รู้ล่วงหน้า มี id จริงของ backend ติดมาด้วยตั้งแต่ต้น)
  //  แต่ยังไม่โชว์ id ตอนเหลือง (ก่อนสแกน) ตามลำดับเดิม -> "รอ Verify" ค่อยเปลี่ยนเป็น id จริงตอน Get สำเร็จ (ย้ายไป bucket น้ำเงิน/เขียว)
  //  accountedCodes = โค้ด (normalize แล้ว) ของถุงที่ "รู้จักแล้ว" (bucket อื่นแสดงอยู่แล้ว) กันโชว์ซ้ำ
  private buildManualPendingRowsForItem(item: any, accountedCodes: Set<string>, pendingList: TotalPalletDisplayItem[]): void {
    const manualList: any[] = item.pallet_manual ?? [];
    if (manualList.length === 0) return;

    manualList
      .filter((m) => {
        const code = this.scanLogic.normalizeQrCodeForMatch(m?.scanned_qr_code);
        return code && !accountedCodes.has(code);
      })
      .forEach((m, i) => {
        pendingList.push({
          key: `${item.id}-pending-manual-${i}`,
          grade: this.scanLogic.fallback(m.grade ?? item.grade),
          lotNo: this.scanLogic.fallback(m.lot ?? item.lot_no),
          qty: m.qty ?? 'ไม่ระบุ',
          //  id แสดงผล: ใช้ตัวสั้น (rawCode/เลข Pallet ตัวท้าย) ไม่ใช่ normalizeQrCode เต็มๆ ที่ใช้เทียบซ้ำด้านบน
          //  เพราะ template โชว์ p.id นำหน้า grade ด้วย (เช่น "PLM2609220004 • 1126NK...") ถ้าใช้ตัวเต็มจะเห็นทั้ง QR ยาวๆ
          id: this.deriveShortDisplayId(String(m?.scanned_qr_code ?? '')) || null,
          rawPalletNo: this.deriveRawPalletNo(m?.scanned_qr_code),
          status: 'pending',
        });
      });
  }

  private buildPendingRowsForItem(item: any, yellowCount: number, pendingList: TotalPalletDisplayItem[]): void {
    if (yellowCount <= 0) return;

    const itemLotNo = String(item?.lot_no ?? '').trim();
    const fromLocations = item?.locations?.from_locations ?? [];

    if (itemLotNo || fromLocations.length === 0) {
      const label = itemLotNo || 'ไม่ระบุ Lot';
      for (let i = 0; i < yellowCount; i++) {
        pendingList.push({
          key: `${item.id}-yellow-${i}`,
          grade: item.grade,
          lotNo: label,
          qty: 'ไม่ระบุ',
          id: null,
          status: 'pending',
        });
      }
      return;
    }

    //  ใช้ยอดคงเหลือจริงของแต่ละ Location ต้นทาง (total_qty(ต่อ location) - complete_qty - จำนวนที่สแกนไปแล้วใน session นี้)
    //  ใช้สูตรเดียวกับ checkFromLocationQuota (countSessionPalletsAtLocation) แทน loc.receive_qty ที่เป็นค่านิ่ง
    //  ไม่อัปเดตระหว่าง session -> กันไม่ให้ผลรวมต่อ Location ไม่ตรงกับ yellowCount รวม จนบางแถวตกไปเป็น "ไม่ระบุ Lot"
    const locationTotals = this.resolveLocationPalletTotals(item, fromLocations);

    let rowIndex = 0;
    let allocated = 0;

    fromLocations.forEach((loc: any) => {
      const locTotal = locationTotals.get(loc) ?? 0;
      const locDone = (loc.complete_qty ?? 0) + this.scanLogic.countSessionPalletsAtLocation(loc.location_id, this._sessionPalletLists);
      const count = Math.max(0, locTotal - locDone);
      if (count === 0) return;

      //  1 Location อาจมีหลาย Lot พร้อมกัน (addon_lot เป็น array) -> backend ไม่ได้บอกจำนวน Pallet ต่อ Lot มาตรงๆ
      //  มีแต่น้ำหนักรวมของแต่ละ Lot จึงเดาจำนวน Pallet จากน้ำหนัก (ปัดขึ้นทุก 1000 กก. ต่อ 1 Pallet) แทนการหารสัดส่วน
      const lots = this.scanLogic.getLocationLots(loc);
      const lotLabels = lots.length > 0 ? lots.map((entry) => entry.lot) : ['ไม่ระบุ Lot'];
      const perLotCounts = lots.length > 1
        ? lots.map((entry) => this.scanLogic.estimatePalletCountFromWeight(entry.qty))
        : [count];

      lotLabels.forEach((lotLabel, lotIndex) => {
        const lotCount = perLotCounts[lotIndex] ?? 0;
        for (let i = 0; i < lotCount && allocated < yellowCount; i++) {
          pendingList.push({
            key: `${item.id}-yellow-${rowIndex++}`,
            grade: item.grade,
            lotNo: lotLabel,
            qty: 'ไม่ระบุ',
            id: null,
            status: 'pending',
          });
          allocated++;
        }
      });
    });

    //  กันกรณี field total_qty/receive_qty/complete_qty ของ location ไม่ครบ/ไม่ตรงกับ yellowCount รวม
    //  -> เติมแถวที่เหลือด้วย label กลางกันแถวหาย
    if (allocated < yellowCount) {
      for (let i = allocated; i < yellowCount; i++) {
        pendingList.push({
          key: `${item.id}-yellow-${rowIndex++}`,
          grade: item.grade,
          lotNo: 'ไม่ระบุ Lot',
          qty: 'ไม่ระบุ',
          id: null,
          status: 'pending',
        });
      }
    }
  }

  //  หาจำนวน Pallet "ทั้งหมด" ของแต่ละ from_location (ไม่ใช่ยอดคงเหลือ)
  //  บางงาน (เช่น Outbound - Picking) backend ไม่ได้ระบุ total_qty (จำนวน Pallet) ต่อ Location มาให้เลย
  //  (เป็น 0 ทุก location) ทั้งที่มี loc.qty (น้ำหนัก) ต่อ Location ระบุมาครบ -> เฉลี่ยจำนวน Pallet ของ item
  //  ตามสัดส่วนน้ำหนักแทน (ให้ location สุดท้ายรับเศษที่เหลือ กันผลรวมคลาดจาก item.total_qty)
  //  ดีกว่าปล่อยให้ตกไปเป็น "ไม่ระบุ Lot" ทั้งที่รู้ addon_lot ของแต่ละ location อยู่แล้ว
  private resolveLocationPalletTotals(item: any, fromLocations: any[]): Map<any, number> {
    const result = new Map<any, number>();

    const hasLocationPalletCount = fromLocations.some((loc: any) => (loc.total_qty ?? 0) > 0);
    if (hasLocationPalletCount) {
      fromLocations.forEach((loc: any) => result.set(loc, loc.total_qty ?? 0));
      return result;
    }

    const itemTotal = item.total_qty ?? 0;
    //  น้ำหนักของ Location: ใช้ loc.qty ถ้ามี ไม่งั้น sum จาก addon_lot ของ location นั้น (บางงานเช่น Shipping
    //  ไม่ได้ระบุ loc.qty มาตรงๆ มีแต่น้ำหนักย่อยอยู่ใน addon_lot แต่ละ Lot เท่านั้น)
    const locationWeight = (loc: any): number =>
      loc?.qty ?? this.scanLogic.getLocationLots(loc).reduce((sum, entry) => sum + (entry.qty ?? 0), 0);
    const totalWeight = fromLocations.reduce((sum: number, loc: any) => sum + locationWeight(loc), 0);
    if (itemTotal <= 0 || totalWeight <= 0) {
      fromLocations.forEach((loc: any) => result.set(loc, 0));
      return result;
    }

    let assigned = 0;
    fromLocations.forEach((loc: any, index: number) => {
      const isLast = index === fromLocations.length - 1;
      const share = isLast ? itemTotal - assigned : Math.round((itemTotal * locationWeight(loc)) / totalWeight);
      result.set(loc, share);
      assigned += share;
    });

    return result;
  }

  get totalPalletAllCount(): number {
    return this._totalPalletDisplayList.length;
  }

  //  ─────────────────────────────────────────────────────────────
  //  ROUTE SUMMARY (from_location => to_location) — โชว์เหนือ Progress Bar
  //  ─────────────────────────────────────────────────────────────
  private get _fromLocationNames(): string[] {
    const items = this._jobDataRaw?.items ?? [];
    return this.collectUniqueLocationNames(items, 'from_locations');
  }

  //  โชว์แค่ 2 ชื่อแรกในแถบ route-summary-row เอง เกินกว่านั้นกดดู "+N more" เป็น modal แทน (เหมือนฝั่งปลายทาง -> กัน
  //  แถบยาวล้น/ดัน route-to ตกขอบจอตอนมีหลาย location ต้นทางพร้อมกัน เช่นงาน Special ที่ item เดียวมาจากหลาย location)
  get _fromLocationPrimaryText(): string {
    const names = this._fromLocationNames;
    return names.length === 0 ? 'ไม่ระบุ' : names.slice(0, 2).join(', ');
  }

  get _fromLocationExtraCount(): number {
    return Math.max(0, this._fromLocationNames.length - 2);
  }

  onClickShowAllFromLocations(): void {
    this.showLocationListModal('Location ต้นทางทั้งหมด', this._fromLocationNames);
  }

  private get _toLocationNames(): string[] {
    const items = this._jobDataRaw?.items ?? [];
    const names = this.collectUniqueLocationNames(items, 'to_locations');

    if (this._isPickingJob && names.length === 0) {
      return ['P.Zone'];
    }

    return names;
  }

  //  โชว์แค่ 2 ชื่อแรกในแถบ route-summary-row เอง เกินกว่านั้นกดดู "+N more" เป็น modal แทน (กันแถบยาวล้นถ้ามีหลาย location)
  get _toLocationPrimaryText(): string {
    const names = this._toLocationNames;
    return names.length === 0 ? 'ไม่ระบุ' : names.slice(0, 2).join(', ');
  }

  get _toLocationExtraCount(): number {
    return Math.max(0, this._toLocationNames.length - 2);
  }

  onClickShowAllToLocations(): void {
    this.showLocationListModal('Location ปลายทางทั้งหมด', this._toLocationNames);
  }

  //  ใช้ร่วมกันทั้งฝั่งต้นทาง (onClickShowAllFromLocations) และปลายทาง (onClickShowAllToLocations) -> โชว์ชื่อ location
  //  ทั้งหมดเป็น modal แทนตอนมีมากกว่า 2 ที่ (route-summary-row โชว์แค่ 2 ชื่อแรก + ปุ่ม "+N more")
  private showLocationListModal(titlePrefix: string, names: string[]): void {
    const rows = names
      .map((name) => `
        <div style="padding:16px 0; font-size:34px; font-weight:700; border-bottom:1px solid #f0f0f0;">${name}</div>`)
      .join('');

    Swal.fire({
      position: 'center',
      title: `${titlePrefix} (${names.length})`,
      html: `<div style="text-align:left;">${rows}</div>`,
      showConfirmButton: true,
      confirmButtonText: 'ปิด',
    });
  }

  private collectUniqueLocationNames(items: any[], key: 'from_locations' | 'to_locations'): string[] {
    const names = new Set<string>();

    items.forEach((item: any) => {
      const list = item?.locations?.[key] ?? [];
      list.forEach((loc: any) => {
        if (loc.location_name) names.add(this.formatLocationDisplay(loc.location_name));
      });
    });

    return Array.from(names);
  }

  //  งานปกติเท่านั้น: แยกยอด complete_qty/total_qty ของแต่ละ location ปลายทาง รวมข้าม item ที่ไปจุดเดียวกัน (location_id
  //  เดียวกันอาจรับของจากหลาย grade/lot ในงานเดียวกันได้) -> แสดงเป็น progress bar ย่อยต่อ location ใต้แถบรวมด้านบน
  get _toLocationProgressList(): { key: string; name: string; completeQty: number; totalQty: number }[] {
    const items = this._jobDataRaw?.items ?? [];
    const map = new Map<string, { key: string; name: string; completeQty: number; totalQty: number }>();

    items.forEach((item: any) => {
      const list = item?.locations?.to_locations ?? [];
      list.forEach((loc: any) => {
        if (!loc.location_name) return;
        const key = String(loc.location_id ?? loc.location_name);
        const existing = map.get(key);
        const totalQty = loc.total_qty ?? 0;
        const completeQty = loc.complete_qty ?? 0;
        if (existing) {
          existing.totalQty += totalQty;
          existing.completeQty += completeQty;
        } else {
          map.set(key, { key, name: this.formatLocationDisplay(loc.location_name), totalQty, completeQty });
        }
      });
    });

    return Array.from(map.values());
  }

  //  ค่าเริ่มต้นย่ออยู่ (ต่างจาก group pallet ที่ default เปิด) เพราะเป็นข้อมูลเสริม/drill-down จากแถบรวมด้านบน
  //  ไม่ใช่เนื้อหาหลักของการ์ด ไม่งั้นงานที่มีหลาย location จะดันการ์ด "Pallet ทั้งหมด" ด้านล่างลงไปไกลตั้งแต่เข้าหน้าแรก
  private _locationProgressCollapsed = true;

  get locationProgressCollapsed(): boolean {
    return this._locationProgressCollapsed;
  }

  toggleLocationProgressCollapse(): void {
    this._locationProgressCollapsed = !this._locationProgressCollapsed;
  }

  //  กดปุ่ม i ที่ header "Pallet ทั้งหมด" -> โชว์ความหมายของสีสถานะใน modal แทนแถว badge ที่เคยโชว์ค้างไว้ตลอด
  //  ไม่ใช้ this.SweetAlert() เพราะ wrapper นั้นตั้ง timer auto ปิดเองให้ icon ที่ไม่ใช่ error/warning (ไม่เหมาะกับโมดัล
  //  ที่ user ตั้งใจกดเปิดมาอ่านเอง ไม่อยากให้มันหายไปเองกลางคัน) เรียก Swal ตรงๆ แทน ไม่มี timer
  onClickShowPalletLegend(): void {
    //  แต่ละแถวเป็น "การ์ด" สีอ่อนตามสถานะ (ไม่ใช่แค่จุดสีเฉยๆ) + ชื่อสถานะตัวใหญ่ + คำอธิบายสั้นๆว่าหมายถึงอะไร/ต้องทำอะไรต่อ
    //  ให้กดเปิดมาแล้วเข้าใจได้เลยโดยไม่ต้องเดา ไม่ใช่แค่จำสีได้แล้วไปเทียบเอง
    const row = (bg: string, dot: string, colorName: string, label: string, desc: string) => `
      <div style="display:flex; align-items:flex-start; gap:14px; padding:16px; margin-bottom:12px; background:${bg}; border-radius:14px;">
        <span style="width:24px; height:24px; border-radius:50%; background:${dot}; flex-shrink:0; margin-top:4px;"></span>
        <div style="text-align:left;">
          <div style="font-size:24px; font-weight:800; color:#222;">สี${colorName} = ${label}</div>
          <div style="font-size:17px; color:#555; margin-top:4px;">${desc}</div>
        </div>
      </div>`;

    //  งาน Special Package/BK/RQ/IT/Transfer WH ใช้คนละชุดสถานะกับงานปกติ แต่ม่วง (รอสแกน Location ต้นทาง) ยังมีเหมือนกัน
    //  เฉพาะ Outbound (ดู row-tint-source ใน CSS: การ์ดเหลืองที่มี p.locationName จะติดม่วงแทน ไม่ได้หายไปไหน)
    const html = this._isSpecialJob ? `
      <div>
        ${row('#fef3cd', '#f8c538', 'เหลือง', 'กำลังสแกนถุง', 'เปิดพาเลทนับถุงอยู่ ยังไม่ได้กด "เตรียมเอาไปวาง"')}
        ${this._isOutbound ? row('#ede2f7', '#8e24aa', 'ม่วง', 'รอสแกน Location ต้นทาง', 'สแกนถุงแล้ว รอสแกน Location ต้นทางเพื่อยืนยันก่อนเริ่มนับ') : ''}
        ${row('#dceafc', '#1c5fd4', 'น้ำเงิน', 'รอสแกน Location', 'กด "เตรียมเอาไปวาง" แล้ว รอสแกน Location ปลายทางเพื่อนำไปวาง')}
        ${row('#dbf5dd', '#14a318', 'เขียว', 'สินค้าจัดวางสำเร็จ', 'นำไปวางเรียบร้อยแล้ว')}
      </div>` : `
      <div>
        ${row('#fef3cd', '#f8c538', 'เหลือง', 'รอสแกนถุง', 'ยังไม่ได้สแกนถุงยืนยัน ต้องสแกนถุงก่อนถึงจะ Get ได้')}
        ${this._isOutbound ? row('#ede2f7', '#8e24aa', 'ม่วง', 'รอสแกน Location ต้นทาง', 'สแกนถุงครบแล้ว รอสแกน Location ต้นทางเพื่อยืนยันก่อน Get จริง') : ''}
        ${row('#dceafc', '#1c5fd4', 'น้ำเงิน', 'รอสแกน Location', 'Get สำเร็จแล้ว รอสแกน Location ปลายทางเพื่อนำไปวาง')}
        ${row('#dbf5dd', '#14a318', 'เขียว', 'สินค้าจัดวางสำเร็จ', 'นำไปวางเรียบร้อยแล้ว')}
      </div>`;

    Swal.fire({
      position: 'center',
      title: 'ความหมายของสถานะ',
      html,
      width: 560,
      showConfirmButton: true,
      confirmButtonText: 'ปิด',
    });
  }

  //  ─────────────────────────────────────────────────────────────
  //  SORTING & PROGRESS COUNTERS
  //  ─────────────────────────────────────────────────────────────
  private sortById(list: TotalPalletDisplayItem[]): void {
    list.sort((a, b) => {
      const numA = a.id !== null && !isNaN(Number(a.id)) ? Number(a.id) : Infinity;
      const numB = b.id !== null && !isNaN(Number(b.id)) ? Number(b.id) : Infinity;
      return numA - numB;
    });
  }

  get getPalletCount(): number {
    //  งาน Special: _palletToPlaceList.length นับ "จำนวนรายการ" ไม่ใช่ "จำนวนถุง" (1 รายการอาจแทนหลายถุง)
    //  ต้องรวมจาก item.receive_qty ตรงๆ แทน กันตัวเลขผิดหน่วย
    if (this._isSpecialJob) {
      const items = this._jobDataRaw?.items ?? [];
      const totalReceiving = items.reduce((sum: number, item: any) => sum + (item.receive_qty ?? 0), 0);
      return this._completedPalletCount + totalReceiving;
    }
    return this._completedPalletCount + this._palletToPlaceList.length;
  }

  get getPercent(): number {
    if (this._totalPalletCount === 0) return 0;
    return Math.min(100, Math.round((this.getPalletCount / this._totalPalletCount) * 100));
  }

  get completePercent(): number {
    if (this._totalPalletCount === 0) return 0;
    return Math.min(100, Math.round((this._completedPalletCount / this._totalPalletCount) * 100));
  }

  //  ─────────────────────────────────────────────────────────────
  //  NOTIFICATIONS
  //  ─────────────────────────────────────────────────────────────
  //  ข้อความ error จาก API เส้น Get/Put โดยตรง (ของจริงจาก backend) แทนข้อความตายตัวฝั่งหน้าบ้าน -> fallback กลับไปใช้
  //  ข้อความเดิมเฉพาะตอนไม่มี body ส่งมาจริงๆ (เช่น เน็ตหลุด/timeout ที่ไม่ถึง backend เลย)
  private apiErrorMessage(err: any, fallback: string): string {
    return err?.error?.message || fallback;
  }

  //  แจ้งผลลัพธ์การยิง API แบบกลุ่ม (สำเร็จทั้งหมด / ล้มเหลวทั้งหมด / สำเร็จบางส่วน) พร้อม detail ของ Pallet แต่ละใบ (Grade/Lot/Qty)
  //  failedMessages: ข้อความจริงจาก backend ของแต่ละใบที่ล้มเหลว (ใบที่อยู่ใน batch เดียวกันล้มเหลวคนละเหตุผลได้ เช่น
  //  ใบนึง location เต็ม อีกใบ pallet ถูกจองไปแล้ว) โชว์แยกใต้การ์ดของใบนั้นๆ แทนข้อความ generic รวมเดียวเหมือนเดิม
  private notifyBatchResult(
    actionLabel: string,
    succeededPallets: PalletToPlaceItem[],
    failedPallets: PalletToPlaceItem[],
    unitLabel: string,
    allSuccessPrefix = 'สำเร็จทั้งหมด',
    partialSuccessPrefix = 'สำเร็จ',
    failedMessages?: Map<PalletToPlaceItem, string>,
  ): void {
    if (failedPallets.length === 0) {
      this.SweetAlert('success', '', this.buildBatchResultHtml(
        'success',
        `${actionLabel}${allSuccessPrefix} ${succeededPallets.length} ${unitLabel}`,
        this.formatPalletDetailRows(succeededPallets),
      ));
    } else if (succeededPallets.length === 0) {
      this.SweetAlert('error', '', this.buildBatchResultHtml(
        'error',
        `ไม่สามารถ${actionLabel}ได้ ${failedPallets.length} ${unitLabel} กรุณาลองใหม่อีกครั้ง`,
        this.formatPalletDetailRows(failedPallets, true, failedMessages),
      ));
    } else {
      this.SweetAlert('warning', '', this.buildBatchResultHtml(
        'warning',
        `${actionLabel}${partialSuccessPrefix} ${succeededPallets.length} ${unitLabel} ล้มเหลว ${failedPallets.length} ${unitLabel}`,
        this.formatPalletDetailRows(succeededPallets) + this.formatPalletDetailRows(failedPallets, true, failedMessages),
      ));
    }
  }

  //  แสดง Pallet แต่ละใบเป็นการ์ด field เรียงลำดับ Grade, Lot, Qty, Pallet ID (ใบที่ล้มเหลวไฮไลต์แดง)
  //  messages: ข้อความจริงจาก backend ต่อ pallet (ใบไหนไม่มีใน map ก็ไม่ขึ้นบรรทัดเหตุผล เช่นฝั่งที่สำเร็จ)
  private formatPalletDetailRows(pallets: PalletToPlaceItem[], isFailed = false, messages?: Map<PalletToPlaceItem, string>): string {
    const bg = isFailed ? '#fef2f2' : '#f0fdf4';
    const accent = isFailed ? '#dc2626' : '#16a34a';

    return pallets
      .map((p) => {
        const reason = messages?.get(p);
        //  โค้ด PL (manual pallet): ไม่มีเลข "ตันที่" (เลขรันนิ่ง/Pallet No. แบบโค้ดปกติ-Jumbo) ให้โชว์จริงๆ เพราะทั้งโค้ด
        //  คือตัว identifier เดียวกันหมด ไม่ได้แยกเป็นส่วนๆ เหมือนโค้ดอื่น -> โชว์ "-" ไปเลย ไม่ใช่เอา backendId (id ดิบของ
        //  backend คนละความหมายกับ "ตันที่") มาใส่แทนเหมือนเดิม ส่วนโค้ดปกติ/Jumbo ใช้เลขดิบจาก QR เหมือนจุดอื่นที่แก้ไปแล้ว
        const isManualFormat = p.id?.startsWith('PL');
        const tonNo = isManualFormat ? '-' : (this.deriveRawPalletNo(p.qrCode) ?? p.id ?? '-');
        return `
          <div style="padding:12px 14px;margin:8px 0;border-radius:10px;background:${bg};">
            <div style="display:flex;align-items:center;">
              <div style="flex:1;display:grid;grid-template-columns:0.6fr 0.8fr 0.9fr 1.3fr 0.6fr;gap:18px;">
                <div>
                  <div style="font-size:13px;color:#9ca3af;">CC</div>
                  <div style="font-size:19px;font-weight:700;color:#111827;white-space:nowrap;">${p.costCenter || '-'}</div>
                </div>
                <div>
                  <div style="font-size:13px;color:#9ca3af;">เกรด</div>
                  <div style="font-size:19px;font-weight:700;color:#111827;white-space:nowrap;">${p.grade}</div>
                </div>
                <div>
                  <div style="font-size:13px;color:#9ca3af;">ล๊อต</div>
                  <div style="font-size:19px;font-weight:700;color:#111827;white-space:nowrap;">${p.lotNo}</div>
                </div>
                <div>
                  <div style="font-size:13px;color:#9ca3af;">ตันที่</div>
                  <div style="font-size:16px;font-weight:800;color:${accent};white-space:nowrap;">${tonNo}</div>
                </div>
                <div>
                  <div style="font-size:13px;color:#9ca3af;">จำนวน</div>
                  <div style="font-size:19px;font-weight:700;color:#111827;white-space:nowrap;">${p.qty}</div>
                </div>
              </div>
            </div>
            ${reason ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.08);font-size:18px;font-weight:600;color:${accent};text-align:center;">${reason}</div>` : ''}
          </div>`;
      })
      .join('');
  }

  private buildBatchResultHtml(tone: 'success' | 'warning' | 'error', headerText: string, rowsHtml: string, headerFontSize = 24): string {
    const theme = {
      success: { bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
      warning: { bg: '#fffbeb', border: '#fde68a', color: '#b45309' },
      error: { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c' },
    }[tone];

    return `
      <div style="text-align:left;font-family:inherit;">
        <div style="background:${theme.bg};border:1px solid ${theme.border};border-radius:10px;padding:14px;text-align:center;margin-bottom:14px;">
          <div style="font-size:${headerFontSize}px;font-weight:700;color:${theme.color};">${headerText}</div>
        </div>
        <div style="max-height:260px;overflow-y:auto;padding-right:2px;">${rowsHtml}</div>
      </div>
    `;
  }

  //  ─────────────────────────────────────────────────────────────
  //  SESSION PERSISTENCE & DISPLAY REFRESH
  //  ─────────────────────────────────────────────────────────────
  private refreshDisplayList(): void {
    //  _completedPalletsByItem เดิม set ค่าแค่ตอนโหลดหน้า/auto-fetch ทุก 5 วิ (refreshJobProgressFromServer) เท่านั้น
    //  ไม่เคยคำนวณใหม่ตอน action อื่น (เช่นลบ pallet) เลย -> ถ้า action นั้นกระทบว่า pallet ไหนควรนับเป็นเขียว/น้ำเงิน
    //  (ดู isCompletedOnServer ใน buildDisplayRowsForItem) ค่าจะค้างจนกว่าจะ reload/ครบรอบ auto-fetch ถัดไป
    //  คำนวณใหม่จาก _jobDataRaw ปัจจุบันทุกครั้งที่ refreshDisplayList ถูกเรียก (ทุก action ที่เปลี่ยน local state) กันค้าง
    this._completedPalletsByItem = this.scanLogic.buildCompletedPalletsByItem(this._jobDataRaw, this._jobDataRaw?.items ?? []);
    this._jobDataRaw = { ...this._jobDataRaw };
    this.cdr.detectChanges();
  }

  initBagCheckList(count: number = this._bagRequiredCount): void {
    this._bagRequiredCount = count;
    this._bagCheckList = Array.from({ length: count }, () => false);
  }

  private saveJobDataToSession(): void {
    try {
      const saved = sessionStorage.getItem('scanPalletJobData');
      const parsed = saved ? JSON.parse(saved) : {};
      parsed.job = this._jobDataRaw;
      //  งาน Special: เก็บว่า pallet ไหนยัง "เปิด" อยู่บ้าง (กด "เตรียมเอาไปวาง" ไปแล้วหรือยัง) backend ไม่รู้เรื่องนี้
      if (this._isSpecialJob && this._jobDataRaw) {
        parsed.specialSession = {
          jobId: this._jobDataRaw.id,
          nextSeq: this._specialPalletSeq + 1,
          openSeqs: this._specialOpenPallets.map((g) => g.seq),
        };
      }
      sessionStorage.setItem('scanPalletJobData', JSON.stringify(parsed));
    } catch (err) {
      console.error('ไม่สามารถบันทึกข้อมูลลง sessionStorage ได้:', err);
    }
  }

  //  ─────────────────────────────────────────────────────────────
  //  BACK BUTTON / UNSAVED-PROGRESS GUARD
  //  ─────────────────────────────────────────────────────────────
  //  Back Button Event -> ถ้ามีงานค้างที่ยังไม่เสร็จ เตือนก่อนออก เพราะออกไปแล้วต้องกลับมาทำใหม่
  onClickBack(): void {
    if (!this.hasUnfinishedProgress()) {
      this.router.navigate(['job-accept']);
      return;
    }

    Swal.fire({
      icon: 'warning',
      title: 'ยังทำรายการไม่เสร็จ',
      text: 'ถ้าออกจากหน้านี้ตอนนี้ จะต้องกลับมาทำรายการนี้ใหม่ ต้องการออกหรือไม่?',
      showCancelButton: true,
      confirmButtonText: 'ออกจากหน้านี้',
      cancelButtonText: 'สแกนต่อ',
    }).then((result) => {
      if (result.isConfirmed) this.router.navigate(['job-accept']);
    });
  }

  //  เช็คว่ามีงานค้างที่ยังไม่เสร็จหรือไม่ -> ใช้เตือนก่อนกดปุ่มย้อนกลับ
  //  1) กำลังสแกนถุงของ Pallet ใบใดใบหนึ่งค้างอยู่ (ยังไม่ครบตามจำนวนที่ต้องสแกน)
  //  2) มี Pallet ที่ยืนยันถุงแล้วแต่ยังไม่ได้สแกน Location ต้นทาง (เฉพาะ Outbound)
  //  3) มี Pallet ที่สแกนจับ Pallet id ไปแล้ว (เลือกไว้) แต่ยังไม่ได้สแกน Location ปลายทาง
  private hasUnfinishedProgress(): boolean {
    return (
      this._currentGroup !== null ||
      this._palletsAwaitingSourceLocation.length > 0 ||
      this._selectedPalletsForPlacement.length > 0 ||
      this._specialAwaitingSourceLocation.length > 0 ||
      this._specialQtyModal !== null
    );
  }

  //  ─────────────────────────────────────────────────────────────
  //  GUIDED TOUR (driver.js) -> คุมจากปุ่ม "?" ที่ header ผ่าน TourService (register ไว้ตอน ngOnInit)
  //  หน้านี้หน้าตาเปลี่ยนเยอะมากตามประเภทงาน/step -> รอบแรกคุมแค่โครงสร้างหลักที่มีเสมอทุกโหมด 5 จุด เรียงตาม flow จริง
  //  ที่คนขับเจอ (เช็คงาน -> สแกน -> เห็นผลตรงไหน -> ความคืบหน้าขยับยังไง -> เช็ครวมได้ที่ไหน) ไม่ลงรายละเอียดเฉพาะ
  //  ประเภทงาน (เช่นปุ่ม Add พาเลทของ Special, ปุ่ม legend สี) ไว้ก่อน เพิ่มทีหลังได้ถ้าต้องการ
  //  ─────────────────────────────────────────────────────────────
  private startTour(): void {
    //  ความหมายสีต้องตรงกับ onClickShowPalletLegend เป๊ะๆ (ต่างกันระหว่างงาน Special/ปกติ และมี Location ต้นทางเฉพาะ
    //  Outbound) ไม่ hardcode ซ้ำเป็นชุดคงที่ กันข้อความใน tour เพี้ยนไปจาก legend จริงถ้าวันหลังมีคนแก้ไขแค่จุดเดียว
    const yellowLabel = this._isSpecialJob ? 'กำลังสแกนถุง' : 'รอสแกนถุง';
    const purpleLine = this._isOutbound ? ' 🟣 ม่วง = รอสแกน Location ต้นทาง,' : '';

    const steps: DriveStep[] = [
      {
        element: '.system-number-card',
        popover: {
          title: 'ข้อมูลงาน',
          description: 'เช็คก่อนว่าใช่งานที่ถูกต้อง (เลขที่งาน, ประเภทงาน Tag, โหมดรับ/วาง/รับและวาง) ก่อนเริ่มสแกน',
        },
      },
      {
        element: '.scanner-container',
        popover: {
          title: 'สแกนถุง',
          description: 'กดปุ่มสแกนแล้วยิง QR Code บนถุง/พาเลท (หรือสลับเป็นโหมดพิมพ์เองก็ได้) '
            + 'ถุงที่ครบตามจำนวนจะกลายเป็นพาเลทไปอยู่ในรายการด้านล่างทันที',
        },
      },
      {
        element: '.scaned-palet-card',
        popover: {
          title: 'รายการที่รอเอาไปวาง',
          description: 'พาเลทที่สแกนยืนยันแล้วจะมาโผล่ตรงนี้ รอให้สแกน Location ปลายทางเพื่อยืนยันว่าวางเสร็จ',
        },
      },
      {
        element: '.progress-bar-container',
        popover: {
          title: 'ความคืบหน้า',
          description: 'พอวางสำเร็จ ตัวเลขตรงนี้จะขยับขึ้นเรื่อยๆ จนครบจำนวนที่ต้องทำของงานนี้',
        },
      },
      {
        element: '.total-pallet-card',
        popover: {
          title: 'รายการทั้งหมด',
          description: 'เช็คสถานะของทุกพาเลทในงานนี้ได้ที่นี่ แต่ละแถวมีสีบอกสถานะ: '
            + `🟡 เหลือง = ${yellowLabel},${purpleLine} 🔵 น้ำเงิน = รอสแกน Location ปลายทาง, 🟢 เขียว = จัดวางสำเร็จแล้ว `
            + 'กดปุ่ม i มุมขวาเพื่อดูคำอธิบายเต็มๆ อีกทีได้ทุกเมื่อ',
        },
      },
    ];

    driver({
      showProgress: true,
      nextBtnText: 'ถัดไป',
      prevBtnText: 'ย้อนกลับ',
      doneBtnText: 'เสร็จสิ้น',
      steps,
    }).drive();
  }

  //  ─────────────────────────────────────────────────────────────
  //  SWEET ALERT HELPER
  //  ─────────────────────────────────────────────────────────────
  //  error/warning = ผู้ใช้ต้องอ่านแล้วไปทำอย่างอื่นต่อ (แก้ไข/สแกนใหม่/ย้อนกลับไปหน้าอื่น) -> ไม่หน่วงเวลาปิดเอง ต้องกดปิดเอง
  //  icon อื่น (success/info) = แจ้งผลไม่ต้องตัดสินใจ -> ปิดเองตามเดิม
  SweetAlert(iconn: any, alert_message: string, htmlContent?: string) {
    const needsToRead = iconn === 'error' || iconn === 'warning';

    //  คืน promise ของ popup ไว้ให้ที่ต้องรอ popup ปิดก่อนทำต่อ (เช่น afterDone ของ Get) ที่อื่นไม่ต้องสนใจค่านี้
    return Swal.fire({
      position: 'center',
      icon: iconn,
      title: 'ข้อความจากระบบ',
      ...(htmlContent ? { html: htmlContent, width: 680 } : { text: alert_message }),
      showConfirmButton: true,
      ...(needsToRead ? {} : { timer: htmlContent ? 4500 : 3000, timerProgressBar: true }),
    });
  }
}