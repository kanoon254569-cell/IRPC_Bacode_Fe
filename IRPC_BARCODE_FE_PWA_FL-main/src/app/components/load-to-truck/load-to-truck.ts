import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, HostListener, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { CrudService } from '../../service/crud.service';
import { ScanPalletLogicService, ParsedScanCode } from '../../service/scan-pallet-logic.service';
import { ScanPalletApiService } from '../../service/scan-pallet-api.service';
import { AutoLogoutService } from '../../service/auto-logout.service';
import { LoadingService } from '../../service/loading.service';
import { firstValueFrom } from 'rxjs';

//  รูปแบบโค้ดที่สแกนสร้างการ์ด: ถุงปกติ (5/6 ส่วน), Jumbo Bag (7 ส่วน มี qty), โค้ด PL (4 ส่วน มี qty)
//  Jumbo/PL รู้ qty จากโค้ด เอาทั้งพาเลทเสมอ แบ่งเป็นถุงไม่ได้ (เปิด modal นับถุงได้เฉพาะ 'bag')
type PalletKind = 'bag' | 'jumbo' | 'pl';

// รายการพาเลตที่รอเอาไปวาง (รอขึ้นรถ) -> นับเป็น กก. แบบงานกลุ่ม kilo หน้า scan-pallet
//  modeId 1 = เอาทั้งพาเลท (qrCodes = [โค้ดที่สแกน]), 3 = นับถุง (qrCodes = ทุกถุงที่สแกนใน modal)
interface PalletToLoadItem {
  kind: PalletKind;
  id: string | null;
  grade: string;
  lotNo: string;
  qty: number;
  documentJob: string;
  isChecked: boolean;
  isSelectedForPlacement: boolean;
  itemId?: number;
  qrCodes: string[];
  modeId: 1 | 3;
  parsed: ParsedScanCode;
  record: any;   //  record จาก GetProcessPallet (qty, unit_ratio, unit_pallet, is_full_pallet)
  palletSeq?: number;   //  จองตอนจะยิง Get ครั้งแรก (ดู claimNextPalletSeq) -> Get/Put ไม่ผ่านแล้วสแกนรถใหม่ใช้เลขเดิม
  //  Get ผ่านแล้ว (backend บันทึกหยิบแล้ว) แต่ Put ยังไม่ผ่าน -> สแกนรถใหม่ยิงแค่ Put (Get ซ้ำ BE ตอบ "พาเลทนี้ถูกรับเข้ามาแล้ว")
  //  เก็บ item/body ของ Put ไว้ใช้ซ้ำให้ตรงกับที่ Get ไป, ลบการ์ด -> ยิง reset-pallet คืนสถานะที่ backend ก่อน
  getDone?: { itemId: number; putBody: object };
}

// แถวที่โหลดขึ้นรถแล้ว 1 ครั้ง (ทั้งพาเลท หรือชุดถุง) ที่แสดงใต้ DO group ฝั่งขวา
interface TotalPalletDisplayItem {
  key: string;
  grade: string;
  lotNo: string;
  qty: number | string;
  id: string | null;
  palletNo: string;   //  หมายเลขพาเลทจากโค้ดที่สแกน (ดู palletNos)
}

// modal นับถุง (ย่อจาก _specialQtyModal หน้า scan-pallet: ไม่มี toggle เอาออก/จัดเก็บ ไม่มีส่งให้ Step 2)
interface LoadBagModal {
  code: string;                //  ถุงใบแรกที่เปิด modal -> ใช้เป็นโค้ดตอน "เลือกทั้งหมด"
  parsed: ParsedScanCode;      //  ถุงต่อไปต้อง grade/lot/พาเลทเดียวกับใบนี้
  record: any;
  scannedCodes: string[];
  remaining: number | null;    //  กก. ที่ item ยังต้องโหลด, null = ยังไม่รู้ Shipment (พาเลทใบแรก ไปรู้ตอนสแกนรถ)
  hint: string | null;
  //  มีค่า = เปิดจากตอนสแกนรถ เพราะการ์ดที่รอเกินยอดที่เหลือ -> ยืนยันแล้วแก้การ์ดใบนี้แล้วโหลดขึ้นรถทันที ไม่ต้องสแกนรถซ้ำ
  pallet?: PalletToLoadItem;
  truckCode?: string;
}

// 1 การ์ดฝั่งขวา = 1 DO รวมทุก item ภายใต้ DO เดียวกัน
interface DoGroupDisplay {
  doNo: string;
  headerLabel: string;
  extraItemsCount: number;
  completedCount: number;
  totalCount: number;
  pallets: TotalPalletDisplayItem[];
  expanded: boolean;
}

@Component({
  selector: 'app-load-to-truck',
  standalone: false,
  templateUrl: './load-to-truck.html',
  styleUrl: './load-to-truck.css',
})
export class LoadToTruck implements OnInit, AfterViewInit {

  @ViewChild('scannerInput') scannerInputRef!: ElementRef<HTMLInputElement>;

  // หน้านี้ไม่รู้จัก shipment ใดๆ ล่วงหน้า ต้องสแกน pallet แล้วสแกน QR รถ
  // ให้ backend บอกกลับมาว่าเป็น shipment ไหน ถึงจะรู้จักและแสดงผลได้
  job: any = { jobTag: '-', shipmentNo: '-' };

  _jobDataRaw: any = null;
  _scannerValue: string = '';
  //  เข้าหน้าแล้วพร้อมสแกนได้ทันที (ปุ่มเขียว "กำลังสแกน...") ไม่ต้องกดปุ่มเองก่อน เหมือนหน้า scan-pallet (ngAfterViewInit
  //  เรียก onClickScanButton) ตั้งตั้งแต่ค่าเริ่มต้นแทน -> ไม่เปลี่ยนค่าหลัง view ถูกเช็คไปแล้ว ส่วนโฟกัสช่องสแกนยังทำใน ngAfterViewInit เหมือนเดิม
  _isScanning: boolean = true;
  _isScanBlocked: boolean = false;

  //  ยอดทั้งหมดของ Shipment (Σ total_qty) และที่โหลดขึ้นรถแล้ว (Σ complete_qty) -> หน่วยตาม _qtyUnit
  _totalQty: number = 0;
  _completedQty: number = 0;

  //  งานที่มีรายการพาเลทกำหนดไว้ล่วงหน้า (pallet_assigned/pallet_manual) -> เหมือนกลุ่ม kilo หน้า scan-pallet: โค้ดต้องตรงกับ
  //  รายการเท่านั้น เอาทั้งพาเลทเสมอ นับเป็น "จำนวนพาเลท" ไม่ใช่ กก. (ดู normalizeManifest)
  _isManifestJob = false;

  get _qtyUnit(): string {
    return this._isManifestJob ? 'Pallet' : 'กก.';
  }

  _palletToLoadList: PalletToLoadItem[] = [];
  _completedPalletList: PalletToLoadItem[] = [];

  _bagModal: LoadBagModal | null = null;

  //  ตัวนับ pallet_seq แบบงานกลุ่ม kilo หน้า scan-pallet (claimNextSpecialSeq) -> เลขที่ส่งจริง = ตัวนับ * 100,000 + user_id
  //  กัน 2 เครื่องคำนวณตัวนับได้เลขเดียวกันพอดีแล้วทับ seq เดียวกัน 1 การโหลด = 1 seq (ไม่มีเปิด/ปิดกล่องแบบหน้า scan-pallet)
  private readonly SEQ_USER_SUFFIX_RANGE = 100000;
  private _palletSeqCounter = 0;

  _currentUserId: number = 0;

  // Manual Input Mode (พิมพ์เองแทนสแกน กรณีสแกน QR ไม่ได้)
  _isManualInputMode: boolean = false;
  _manualInputValue: string = '';

  _isProcessingScan: boolean = false;

  // ลำดับ DO ที่เพิ่ง Put-away สำเร็จล่าสุด (ตัวล่าสุดอยู่หน้าสุด) ใช้จัดลำดับการ์ดฝั่งขวา
  private _recentlyLoadedDoOrder: string[] = [];

  // QR รถที่ยืนยันแล้วว่าเป็นของ Shipment ที่กำลังโหลดอยู่ (carrierCode|เลขทะเบียน ผ่าน normalizeTruckQr แล้ว)
  private _truckQrCode: string | null = null;

  //  รถคันนี้มีงาน Loading ค้างมากกว่า 1 งาน -> พาเลทที่ไม่ลงงานปัจจุบันยังสแกนได้ แล้วสลับงานตอนสแกนรถ (ดู matchPendingPalletsToShipment)
  private _truckHasOtherJobs = false;

  // สถานะเปิด/ปิดของแต่ละ DO group ฝั่งขวา (key = do_no)
  private _expandedDoMap: Map<string, boolean> = new Map();

  // Pallet ที่ complete มาแล้วจาก backend ของ shipment ปัจจุบัน แยกตาม item.id
  private _completedPalletsByItem: Map<number, any[]> = new Map();

  constructor(
    private router: Router,
    private restService: CrudService,
    private cdr: ChangeDetectorRef,
    private scanLogic: ScanPalletLogicService,
    private scanApi: ScanPalletApiService,
    private autoLogout: AutoLogoutService,
    private loadingService: LoadingService,
  ) { }

  //  Lifecycle 

  ngOnInit(): void {
    this._currentUserId = Number(localStorage.getItem('userId')) || 0;
  }

  ngAfterViewInit(): void {
    this.focusScannerInput();
  }

  // โฟกัสช่องสแกนกลับทุกครั้งที่คลิกที่ใดก็ได้บนหน้า
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this._isManualInputMode) {
      return;
    }
    setTimeout(() => this.focusScannerInput(), 0);
  }

  // ดักตอนสลับหน้าต่าง/แอป -> ปุ่มต้องกลับเป็นสีน้ำเงิน
  @HostListener('window:blur')
  onWindowBlur(): void {
    this._isScanning = false;
  }

  //  Scanner Input UI 

  onScannerInputBlur(): void {
    if (this._isManualInputMode) {
      return;
    }

    // หน่วงเวลาให้ onDocumentClick (refocus กลับ) ทำงานก่อน
    setTimeout(() => {
      const isFocusBack = document.activeElement === this.scannerInputRef?.nativeElement;
      if (!isFocusBack) {
        this._isScanning = false;
      }
    }, 150);
  }

  focusScannerInput(): void {
    this.scannerInputRef?.nativeElement?.focus();
  }

  onClickScanButton(): void {
    this._isScanning = true;
    this._isScanBlocked = false;
    this.focusScannerInput();
  }

  onToggleManualInputMode(checked: boolean): void {
    this._isManualInputMode = checked;
    this._manualInputValue = '';

    if (!this._isManualInputMode) {
      this.focusScannerInput();
    }
  }

  // ยืนยันโค้ดที่พิมพ์เอง -> ใช้ logic เดียวกับ onScannerEnter
  onClickSubmitManualInput(): void {
    const code = this._manualInputValue.trim();

    if (!code) {
      return;
    }

    this._isScanBlocked = false;
    this._scannerValue = code;
    this._manualInputValue = '';

    this.onScannerEnter();
  }

  // แยกงานตามประเภทโค้ดที่สแกนได้: pallet หรือ QR รถ
  onScannerEnter(): void {
    const rawCode = this._scannerValue.trim();

    this._scannerValue = '';

    if (!rawCode) {
      return;
    }

    if (this._isScanBlocked) {
      return;
    }

    // กันสแกนใบถัดไปซ้อนเข้ามาระหว่างรอ API ของใบก่อนหน้า
    if (this._isProcessingScan) {
      return;
    }

    // ยังไม่ได้กดปุ่มสแกน (และไม่ได้อยู่โหมดพิมพ์เอง) -> ไม่ประมวลผล
    if (!this._isManualInputMode && !this._isScanning) {
      return;
    }

    const code = this.fixMojibake(rawCode);

    //  เปิด modal นับถุงอยู่ -> ทุกโค้ดที่สแกนเข้ามาคือถุงที่จะเพิ่มเข้า modal นี้
    if (this._bagModal) {
      this.handleBagScanForModal(code);
      return;
    }

    const parsed = this.scanLogic.parseScanCode(code);
    const jumbo = parsed ? null : this.scanLogic.parseJumboBagScanCode(code);
    const pl = parsed || jumbo ? null : this.scanLogic.parseFullPalletScanCode(code);

    //  งานที่มีรายการพาเลทกำหนดไว้ (รู้งานแล้ว) -> โค้ดต้องตรงกับรายการเท่านั้น ไม่ว่ารูปแบบไหน เหมือนหน้า scan-pallet
    if (this._isManifestJob) {
      const match = this.findManifestEntry(code);
      if (match) {
        this.handleManifestScan(match.item, match.entry, code);
        return;
      }
      //  รถมีงานอื่นอีก -> อาจเป็นพาเลทของงานนั้น ปล่อยเข้าคิวแบบปกติ ไปสลับงานตอนสแกนรถ
      if ((parsed || jumbo || pl) && !this._truckHasOtherJobs) {
        this.SweetAlert('error', 'พาเลทนี้ไม่อยู่ในรายการพาเลทที่กำหนดของงานนี้ กรุณาตรวจสอบ QR Code');
        return;
      }
    }

    if (parsed) {
      this.runScanTask(this.handleScannedPallet(parsed, code));
    } else if (jumbo) {
      this.runScanTask(this.handleFixedQtyPallet(jumbo, jumbo.qty, code, 'jumbo'));
    } else if (pl) {
      //  โค้ด PL: ใช้ rawCode (ส่วนแรก "PLxxx") เป็นทั้ง id และโค้ดที่ส่ง Get เหมือนหน้า scan-pallet
      this.runScanTask(this.handleFixedQtyPallet(
        { costCenter: '', grade: pl.grade, lot: pl.lot, runningNo: '', palletId: pl.rawCode },
        pl.qty,
        pl.rawCode,
        'pl',
      ));
    } else {
      //  QR รถ -> แปลงเป็นรูป to_location_name (carrier|เลขทะเบียน) ก่อนใช้ทุกจุด (หา Shipment / เทียบรถ / to_location)
      this.runScanTask(this.handleTruckScan(this.scanLogic.normalizeTruckQr(code)));
    }

    console.log('Scanned code:', code);
  }

  //  กันสแกนใบถัดไปซ้อนเข้ามาระหว่างรอ API ของใบก่อนหน้า -> ใช้ร่วมกับปุ่มยืนยันใน modal นับถุงที่โหลดขึ้นรถต่อทันทีด้วย
  //  ปิด loading ตรงนี้จุดเดียว (เปิดตอนเริ่มยิง API ของการโหลดขึ้นรถ ดู showLoadingToTruck) -> จบทุกทางไม่ว่าผ่าน/error/หลุดกลางทาง
  private runScanTask(task: Promise<void>): void {
    this._isProcessingScan = true;
    task
      .catch((err) => console.error('Scan processing error:', err))
      .finally(() => {
        this._isProcessingScan = false;
        this.loadingService.hide();
        this.focusScannerInput();
      });
  }

  //  loading ระหว่างรอ API ค้นหา Shipment / Get / Put (ใช้เวลานาน) -> ใช้ LoadingService ตัวเดียวกับหน้าอื่นทั้งแอป
  //  ข้อความเดียวตลอดทั้งช่วง (show ซ้ำตอนเปิดอยู่แล้วไม่ทำอะไร) ถ้า error ข้อความ error บอกเองว่าติดขั้นไหน
  private showLoadingToTruck(): void {
    this.loadingService.show('กำลังโหลดขึ้นรถ กรุณารอสักครู่...');
  }

  onClickClearCheckList(): void {
    this._isScanning = false;
    this._isScanBlocked = true;
    this._isProcessingScan = false;
    this._scannerValue = '';
    this.focusScannerInput();
  }

  onClickBack(): void {
    this.router.navigate(['job-accept']);
  }

  // ตาราง byte พิเศษของ Windows-1252 ช่วง 0x80-0x9F ที่ไม่ตรงกับ Latin-1 ตรงๆ
  private readonly CP1252_SPECIALS: { [codePoint: number]: number } = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
    0x017E: 0x9E, 0x0178: 0x9F,
  };

  // แก้ mojibake ของ CP1252 ที่เกิดจาก scanner ตีความ byte UTF-8 ผิด
  private fixMojibake(text: string): string {
    try {
      const bytes: number[] = [];

      for (const ch of text) {
        const code = ch.codePointAt(0) ?? 0;

        if (code < 0x100) {
          bytes.push(code);
        } else if (this.CP1252_SPECIALS[code] !== undefined) {
          bytes.push(this.CP1252_SPECIALS[code]);
        } else {
          return text;
        }
      }

      return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    } catch {
      return text;
    }
  }

  //   Pallet Queue (ฝั่งซ้าย)

  //  เช็คร่วมก่อนสร้างการ์ดรอขึ้นรถใบใหม่ทุกแบบ (ถุงปกติ/Jumbo/PL/พาเลทที่กำหนดไว้)
  private checkCanQueuePallet(parsed: ParsedScanCode, code: string): boolean {
    const alreadyWaiting = this._palletToLoadList.some(p => p.qrCodes.some(c => this.scanLogic.qrCodesMatch(c, code)));

    if (alreadyWaiting) {
      this.SweetAlert(
        'warning',
        `สแกน Pallet ซ้ำ กรุณาสแกนรถ หรือลบ Pallet id: ${parsed.palletId} นี้ออกจากรายการ Pallet ที่รอขึ้นรถ`,
      );
      return false;
    }

    if (this.isAlreadyLoaded(parsed, code)) {
      this.SweetAlert('error', `Pallet ID "${parsed.palletId}" ถูกโหลดขึ้นรถไปแล้ว ไม่สามารถสแกนซ้ำได้`);
      return false;
    }

    // จำกัดให้มี Pallet รอขึ้นรถได้ทีละ 1 ใบเท่านั้น
    if (this._palletToLoadList.length > 0) {
      this.SweetAlert(
        'warning',
        `มี Pallet id: ${this._palletToLoadList[0].id ?? '-'} รอขึ้นรถอยู่แล้ว กรุณาลบ (ปุ่ม -) หรือสแกน QR รถเพื่อยืนยันก่อน ถึงจะสแกน Pallet ใหม่ได้`,
      );
      return false;
    }

    return true;
  }

  // สแกนถุง: ดึงข้อมูลพาเลทจริงก่อน แล้วเอาทั้งพาเลท (modeId 1) หรือเปิด modal นับถุง (modeId 3) แบบงานกลุ่ม kilo หน้า scan-pallet
  private async handleScannedPallet(parsed: ParsedScanCode, code: string): Promise<void> {
    if (!this.checkCanQueuePallet(parsed, code)) return;

    const record = await this.fetchPalletRecord(parsed, code);

    if (!record) {
      this.SweetAlert('error', 'ไม่พบพาเลทใบนี้ในระบบ กรุณาตรวจสอบ QR Code ว่าถูกต้อง หรือลองสแกนใหม่อีกครั้ง');
      return;
    }

    if (record.qty == null) {
      this.SweetAlert('error', 'พบพาเลทใบนี้ในระบบ แต่ไม่มีข้อมูลน้ำหนัก กรุณาติดต่อเจ้าหน้าที่คลังเพื่อตรวจสอบข้อมูลพาเลทนี้ก่อนสแกนอีกครั้ง');
      return;
    }

    //  รู้ Shipment แล้ว (สแกนรถไปแล้วอย่างน้อย 1 ครั้ง) -> หา item ได้ตั้งแต่ตอนนี้ รู้ยอด กก. ที่เหลือ ตัดสินได้เลยว่าเอาทั้งพาเลทได้ไหม
    //  ยังไม่รู้ (พาเลทใบแรก) -> remaining = null ไปตัดสินตอนสแกนรถแทน (ดู matchPendingPalletsToShipment)
    let remaining: number | null = null;
    if (this._jobDataRaw) {
      const { item, reason } = this.findItemForLoad(parsed.palletId, parsed.grade, parsed.lot, this._truckQrCode ?? '', this.recordDockId(record));
      if (item) {
        remaining = this.itemRemainingForLot(item, parsed.lot);
      } else if (!this._truckHasOtherJobs) {
        this.SweetAlert('error', reason);
        return;
      }
      //  ไม่ลงงานนี้แต่รถมีงานอื่น -> remaining = null เหมือนพาเลทใบแรก ไปตัดสินตอนสแกนรถ (สลับงาน)
    }

    //  พาเลทเต็ม + ไม่เกินยอดที่เหลือ (หรือยังไม่รู้ยอด) -> เอาทั้งพาเลทเลยไม่ต้องนับถุง เหมือน auto full pallet ของกลุ่ม kilo
    if (record.is_full_pallet === 'Y' && (remaining === null || record.qty <= remaining)) {
      this.addPalletToLoad(parsed, record, [code], 1, record.qty, 'bag');
      return;
    }

    this._bagModal = { code, parsed, record, scannedCodes: [code], remaining, hint: null };
  }

  //  Jumbo Bag / โค้ด PL: qty ฝังมาในโค้ด -> เอาทั้งพาเลทเลย (modeId 1) ไม่ดึงข้อมูลพาเลท ไม่มี modal นับถุง เหมือนกลุ่ม kilo
  //  หน้า scan-pallet แบ่งเป็นถุงไม่ได้ -> เกินยอดที่เหลือ = สแกนไม่ได้ (ใบแรกที่ยังไม่รู้งาน ไปเช็คตอนสแกนรถ)
  //  ดึง record พาเลทด้วย (ไม่บังคับ) เพื่อรู้ว่าพาเลทวางอยู่ Dock ไหนจริง -> ใช้เลือกงาน/Location ต้นทางให้ตรง Dock (ดู recordDockId)
  private async handleFixedQtyPallet(parsed: ParsedScanCode, qty: number, code: string, kind: 'jumbo' | 'pl'): Promise<void> {
    if (!this.checkCanQueuePallet(parsed, code)) return;

    const fetched = await this.fetchPalletRecord(parsed, code);
    const record = { ...(fetched ?? {}), qty };

    if (this._jobDataRaw) {
      const items = this._jobDataRaw.items ?? [];
      const { item, reason } = this.findItemForLoad(
        parsed.palletId,
        this.matchGrade({ kind, grade: parsed.grade }, items),
        parsed.lot,
        this._truckQrCode ?? '',
        this.recordDockId(record),
      );
      if (!item && !this._truckHasOtherJobs) {
        this.SweetAlert('error', reason);
        return;
      }

      const remaining = item ? this.itemRemainingForLot(item, parsed.lot) : Infinity;
      if (qty > remaining) {
        this.SweetAlert('error', `${this.fixedQtyExceedsText(kind, qty, remaining, item)} กรุณาสแกนพาเลทอื่น`);
        return;
      }
    }

    this.addPalletToLoad(parsed, record, [code], 1, qty, kind);
  }

  //  Dock ที่พาเลทวางอยู่จริง (GetProcessPallet: location_type_code DOCK + current_location_id) -> null = ไม่รู้ / ไม่ได้อยู่ Dock
  //  รถ 1 คันมีหลาย Shipment grade/lot เดียวกันได้ (เช่น 321F/750 ทุกงาน) -> จับคู่แค่ grade/lot จะลงงาน/DO ผิด ต้องดู Dock ด้วย
  private recordDockId(record: any): number | null {
    const isDock = String(record?.location_type_code ?? '').trim().toUpperCase() === 'DOCK';
    const id = Number(record?.current_location_id);
    return isDock && id > 0 ? id : null;
  }

  //  item มี Dock นี้เป็นต้นทาง "สำหรับ lot นี้" -> item แบ่ง lot ตาม Dock ได้ (เช่น lot A ที่ 38D01, lot B ที่ 38D02)
  //  Location ที่ไม่ระบุ lot (หรือ item มี lot_no ทั้ง item) ถือว่าทุก lot ตรง
  private dockLocationFor(item: any, dockId: number, lot: string): any | null {
    const itemLot = String(item?.lot_no ?? '').trim();
    return (item?.locations?.from_locations ?? []).find((loc: any) => {
      if (Number(loc?.location_id) !== dockId) return false;
      const lots = this.scanLogic.getLocationLots(loc);
      return !!itemLot || lots.length === 0 || lots.some((entry) => entry.lot === lot);
    }) ?? null;
  }

  private itemHasDock(item: any, dockId: number, lot: string): boolean {
    return this.dockLocationFor(item, dockId, lot) !== null;
  }

  //  งานที่มีรายการพาเลทกำหนดไว้: โค้ดตรงกับรายการแล้ว -> เอาทั้งพาเลทเสมอ ใช้ grade/lot/น้ำหนักจากรายการ
  //  ไม่ดึงข้อมูลพาเลท ไม่นับถุง (เหมือน handleManifestPalletScan หน้า scan-pallet)
  private handleManifestScan(item: any, entry: any, code: string): void {
    const pl = this.scanLogic.parseFullPalletScanCode(code);
    const jumbo = pl ? null : this.scanLogic.parseJumboBagScanCode(code);

    const parsed: ParsedScanCode = {
      costCenter: '',
      grade: this.fallback(entry.grade ?? item.grade),
      lot: String(entry.lot ?? '').trim(),
      runningNo: '',
      //  id สั้นไว้แสดงผล เหมือน deriveShortDisplayId หน้า scan-pallet (PL = rawCode, ถุง/Jumbo = เลข Pallet)
      palletId: pl?.rawCode ?? jumbo?.palletId ?? this.scanLogic.parseScanCode(code)?.palletId ?? this.scanLogic.normalizeQrCode(code),
    };

    if (!this.checkCanQueuePallet(parsed, code)) return;

    const label = `Pallet id "${parsed.palletId}" (${parsed.grade} • ${parsed.lot})`;

    if (!this.isItemOnTruck(item, this._truckQrCode ?? '')) {
      this.SweetAlert('error', `${label} เป็นของรถคันอื่น ไม่ใช่รถคันนี้`);
      return;
    }

    if (this.itemRemaining(item) <= 0) {
      this.SweetAlert('error', `${label} Grade/Lot นี้ครบจำนวนที่ต้องโหลดแล้ว`);
      return;
    }

    const qty = Number(entry.qty) || 0;
    this.addPalletToLoad(parsed, { qty }, [this.scanLogic.normalizeQrCode(code)], 1, qty, pl ? 'pl' : jumbo ? 'jumbo' : 'bag');
  }

  private fixedQtyExceedsText(kind: PalletKind, qty: number, remaining: number, item: any): string {
    return `${kind === 'jumbo' ? 'Jumbo Bag' : 'พาเลท (โค้ด PL)'} นี้ ${this.formatQty(qty)} กก. เกินยอดที่ต้องโหลดของ DO ${this.fallback(item.do_no)} (เหลือ ${this.formatQty(remaining)} กก.) แบ่งเป็นถุงไม่ได้`;
  }

  private addPalletToLoad(parsed: ParsedScanCode, record: any, qrCodes: string[], modeId: 1 | 3, qty: number, kind: PalletKind): void {
    const pallet: PalletToLoadItem = {
      kind,
      id: parsed.palletId,
      grade: this.fallback(parsed.grade),
      lotNo: this.fallback(parsed.lot),
      qty: Number(qty),   //  กันกรณี API ส่ง qty เป็น string -> ตอนบวกยอด กก. จะกลายเป็นต่อ string แทน
      documentJob: '-',
      isChecked: true,
      isSelectedForPlacement: false,
      qrCodes,
      modeId,
      parsed,
      record,
    };

    this._palletToLoadList.push(pallet);

    this.autoSelectPalletsIfEligible();

    //  ไม่ขึ้น popup "Verify Pallet สำเร็จ" แล้ว (เหมือนหน้า scan-pallet) -> การ์ดฝั่งซ้ายขึ้นทันทีพร้อมข้อมูลครบอยู่แล้ว
    //  และไม่บังจอ/แย่ง focus ตอนคนขับสแกน QR รถต่อทันที ขึ้น popup เฉพาะตอน error/warning
    this.refreshDisplayList();
  }

  //  "ทั้งพาเลท" / "20 ถุง" -> ใช้ทั้งข้อความแจ้งผลและการ์ดรอขึ้นรถใน HTML
  palletModeLabel(pallet: PalletToLoadItem): string {
    return pallet.modeId === 1 ? 'ทั้งพาเลท' : `${pallet.qrCodes.length} ถุง`;
  }

  //  หมายเลขพาเลทที่โชว์บนการ์ดทั้ง 2 ฝั่ง -> แบบเดียวกับ deriveRawPalletNo/specialPalletNos หน้า scan-pallet: เลขดิบตามตำแหน่ง
  //  ของแต่ละ format ไม่ตัด 0 หน้า (ถุงปกติ 5/6 ส่วน และ Jumbo 7 ส่วน = ส่วนที่ 5, โค้ด PL = rawCode "PLxxx" ไม่ว่าจะเก็บไว้เต็ม
  //  หรือแค่ rawCode) ถุงหลายใบจากพาเลทเดียวกันรวมเหลือเลขเดียว public เพราะการ์ดฝั่งซ้ายใน template เรียกตรงๆ
  palletNos(codes: (string | null | undefined)[]): string {
    const nos = codes.map((c) => {
      const code = String(c ?? '').trim();
      if (code.startsWith('PL')) return this.scanLogic.normalizeQrCode(code);
      const parts = code.split('|').map((p) => p.trim());
      return parts.length >= 5 && parts.length <= 7 ? parts[4] || null : null;
    });
    return Array.from(new Set(nos.filter((n): n is string => !!n))).join(', ');
  }

  //  ─── Modal นับถุง (ย่อจาก _specialQtyModal หน้า scan-pallet) ───

  //  กก. ของถุง N ใบ -> สูตรเดียวกับ computeSpecialModalQty หน้า scan-pallet (unit_ratio ก่อน ไม่มีค่อย qty/unit_pallet
  //  ไม่มีอีกค่อยนับจำนวนถุงตรงๆ)
  private bagQty(record: any, bagCount: number): number {
    const unitPallet = record?.unit_pallet ?? 0;
    const qtyPerBag = record?.unit_ratio ?? (unitPallet > 0 ? (record?.qty ?? 0) / unitPallet : 0);
    return qtyPerBag > 0 ? Math.round(qtyPerBag * bagCount * 100) / 100 : bagCount;
  }

  get _bagModalQty(): number {
    return this._bagModal ? this.bagQty(this._bagModal.record, this._bagModal.scannedCodes.length) : 0;
  }

  //  ปุ่ม "เลือกทั้งหมด": เฉพาะ modal ที่เปิดตอนสแกนถุง (ที่เปิดตอนสแกนรถคือทั้งพาเลทเกินยอดอยู่แล้ว) และพาเลทไม่เกินยอดที่เหลือ
  get _bagModalCanSelectAll(): boolean {
    const modal = this._bagModal;
    return !!modal && !modal.pallet && modal.record.qty <= (modal.remaining ?? Infinity);
  }

  private handleBagScanForModal(code: string): void {
    const modal = this._bagModal!;
    const parsed = this.scanLogic.parseScanCode(code);

    if (!parsed) {
      this.SweetAlert('error', 'QR Code ไม่ถูกต้อง กรุณาสแกน QR Code ถุงให้ถูกต้อง');
      return;
    }

    if (!this.scanLogic.gradesMatch(parsed.grade, modal.parsed.grade) || parsed.lot !== modal.parsed.lot) {
      this.SweetAlert('error', 'ถุงนี้เกรด/ล๊อตไม่ตรงกับรายการที่กำลังสแกนอยู่');
      return;
    }

    if (parsed.palletId !== modal.parsed.palletId) {
      this.SweetAlert('error', 'ถุงนี้มาจากพาเลทต้นทางคนละใบ (เลขท้ายโค้ดไม่ตรงกัน) กรุณาสแกนถุงจากพาเลทเดียวกัน');
      return;
    }

    if (modal.scannedCodes.some(c => this.scanLogic.qrCodesMatch(c, code))) {
      this.SweetAlert('warning', 'ถุงนี้สแกนไปแล้ว กรุณาสแกนถุงใบอื่น');
      return;
    }

    if (this.isAlreadyLoaded(parsed, code)) {
      this.SweetAlert('error', 'ถุงนี้ถูกโหลดขึ้นรถไปแล้ว กรุณาสแกนถุงใบอื่น');
      return;
    }

    //  เช็คก่อนรับถุงทุกครั้ง: ไม่เกินน้ำหนักจริงของพาเลท และไม่เกินยอดที่เหลือ (ถ้ารู้แล้ว) เหมือน handleSpecialBagScanForModal
    const nextQty = this.bagQty(modal.record, modal.scannedCodes.length + 1);

    if (nextQty > modal.record.qty) {
      this.SweetAlert('error', `สแกนถุงนี้เพิ่มจะเกินน้ำหนักจริงของพาเลทใบนี้ (มี ${this.formatQty(modal.record.qty)} กก.) กรุณากดยืนยันเท่าที่มีอยู่ก่อน`);
      return;
    }

    if (modal.remaining !== null && nextQty > modal.remaining) {
      this.SweetAlert('error', `สแกนถุงนี้เพิ่มจะเกินยอดคงเหลือ (เหลือ ${this.formatQty(modal.remaining)} กก.) กรุณากดยืนยันเท่าที่มีอยู่ก่อน`);
      return;
    }

    modal.scannedCodes.push(code);
    modal.hint = null;
  }

  onRemoveBag(code: string): void {
    if (!this._bagModal) return;
    this._bagModal.scannedCodes = this._bagModal.scannedCodes.filter(c => c !== code);
    this._bagModal.hint = null;
  }

  //  ปิด = ทิ้งถุงที่นับไว้ (เปิดจากตอนสแกนรถ -> การ์ดที่รอยังอยู่เหมือนเดิม ลบเองหรือสแกนรถซ้ำเพื่อเปิด modal ใหม่ได้)
  onCloseBagModal(): void {
    this._bagModal = null;
  }

  onClickBagModalSelectAll(): void {
    const modal = this._bagModal;
    if (!modal || !this._bagModalCanSelectAll) return;

    this._bagModal = null;
    this.addPalletToLoad(modal.parsed, modal.record, [modal.code], 1, modal.record.qty, 'bag');
  }

  onConfirmBagModal(): void {
    const modal = this._bagModal;
    if (!modal || this._isProcessingScan) return;

    if (modal.scannedCodes.length < 1) {
      modal.hint = 'กรุณาสแกนถุงอย่างน้อย 1 ใบ';
      return;
    }

    const qty = this._bagModalQty;

    if (modal.remaining !== null && qty > modal.remaining) {
      modal.hint = `จำนวนที่สแกน (${this.formatQty(qty)} กก.) เกินยอดที่เหลือ ${this.formatQty(modal.remaining)} กก. กรุณาเอาถุงออกบางส่วน`;
      return;
    }

    this._bagModal = null;

    //  เปิดจากตอนสแกนรถ -> แก้การ์ดเป็นนับถุงแล้วโหลดขึ้นรถต่อทันที (รถยืนยันไปแล้ว ไม่ต้องสแกนซ้ำ)
    if (modal.pallet) {
      Object.assign(modal.pallet, { qrCodes: [...modal.scannedCodes], modeId: 3, qty });
      this.runScanTask(this.matchPendingPalletsToShipment(modal.truckCode ?? ''));
      return;
    }

    this.addPalletToLoad(modal.parsed, modal.record, [...modal.scannedCodes], 3, qty, 'bag');
  }

  // เลือก Pallet เพื่อรอสแกนรถ ครั้งละ 1 ใบเท่านั้น
  private selectPalletForPlacement(pallet: PalletToLoadItem): void {
    if (pallet.isSelectedForPlacement) {
      return;
    }

    this.deselectAllPallets();

    pallet.isSelectedForPlacement = true;
  }

  private deselectAllPallets(): void {
    this._palletToLoadList.forEach(p => p.isSelectedForPlacement = false);
  }

  // เหลือ Pallet ในคิวแค่ 1 ใบ -> เลือกอัตโนมัติ, มากกว่านั้น -> ยกเลิกเลือกทั้งหมด (ต้อง rescan เอง)
  private autoSelectPalletsIfEligible(): void {
    if (this._palletToLoadList.length === 0) return;

    if (this._palletToLoadList.length === 1) {
      this.selectPalletForPlacement(this._palletToLoadList[0]);
      return;
    }

    this.deselectAllPallets();
  }

  onClickDeletePallet(pallet: PalletToLoadItem): void {
    Swal.fire({
      icon: 'warning',
      title: 'ยืนยันการลบ Pallet',
      text: `ต้องการลบ Pallet id: ${pallet.id ?? '-'} ออกจากรายการที่รอเอาไปวางใช่หรือไม่?`,
      showCancelButton: true,
      confirmButtonText: 'ลบ',
      cancelButtonText: 'ยกเลิก',
    }).then((result) => {
      if (result.isConfirmed) {
        this.deletePalletFromLoadList(pallet);
      }
    });
  }

  // ลบออกจากคิว -> ถ้า Get ผ่านไปแล้ว (Put ล้ม) ต้องยิง reset-pallet คืนพาเลทที่ backend ก่อน ไม่งั้นพาเลทค้างอยู่ในงานนี้
  //  (สแกนใหม่จะโดน "พาเลทนี้ถูกรับเข้ามาแล้ว") ยังไม่เคย Get -> ลบฝั่ง client อย่างเดียว
  private async deletePalletFromLoadList(pallet: PalletToLoadItem): Promise<void> {
    if (pallet.getDone && this._jobDataRaw) {
      this.loadingService.show('กำลังยกเลิกการหยิบ Pallet กรุณารอสักครู่...');
      try {
        await firstValueFrom(this.restService.resetLoadingPallet(this._jobDataRaw.id, {
          itemId: pallet.getDone.itemId,
          qrCode: pallet.qrCodes[0],
          qrCodes: pallet.qrCodes,
          palletSeq: pallet.palletSeq,
          updateBy: this._currentUserId,
        }));
      } catch (err: any) {
        this.SweetAlert('error', `ยกเลิกการหยิบ Pallet id: ${pallet.id} ไม่สำเร็จ${err?.error?.message ? ` : ${err.error.message}` : ''} กรุณาลองใหม่`);
        return;
      } finally {
        this.loadingService.hide();
      }
    }

    this._palletToLoadList = this._palletToLoadList.filter(p => p !== pallet);

    this.SweetAlert('success', `ลบ Pallet id: ${pallet.id} ออกจากรายการที่รอเอาไปวางสำเร็จ`);

    this.refreshDisplayList();
  }

  //  Truck Scan / Matching 

  // สแกน QR รถ แล้วจับคู่กับ Shipment หรือส่ง Pallet ที่เลือกไว้ไปโหลดขึ้นรถ
  private async handleTruckScan(code: string): Promise<void> {
    const selectedPallets = this._palletToLoadList.filter(p => p.isSelectedForPlacement);

    if (selectedPallets.length === 0) {
      if (this._palletToLoadList.length === 0) {
        this.SweetAlert('error', 'ยังไม่มี Pallet ที่รอขึ้นรถ กรุณาสแกนถุงก่อน');
      }
      return;
    }

    if (!this._jobDataRaw) {
      await this.apiFindShipmentByTruckQr(code);
      return;
    }

    if (this._truckQrCode && !this.isSameTruck(code, this._truckQrCode)) {
      this.SweetAlert('error', 'QR รถไม่ถูกต้อง กรุณาสแกน QR รถของ Shipment นี้');
      return;
    }

    await this.matchPendingPalletsToShipment(code);
  }

  //  พาเลทที่รออยู่ลงงานที่ผูกอยู่ตอนนี้ได้ไหม (มีรายการ/Grade-Lot ตรง อยู่บนรถคันนี้ และยังเหลือยอด)
  private palletFitsCurrentJob(pallet: PalletToLoadItem, truckCode: string): boolean {
    if (this._isManifestJob) {
      const match = this.findManifestEntry(pallet.qrCodes[0]);
      return !!match && this.isItemOnTruck(match.item, truckCode) && this.itemRemaining(match.item) > 0;
    }
    const dockId = this.recordDockId(pallet.record);
    const item = this.findItemForLoad(pallet.id, this.matchGrade(pallet, this._jobDataRaw?.items ?? []), pallet.lotNo, truckCode, dockId).item;
    //  พาเลทอยู่ Dock ที่งานนี้ไม่มี -> ถือว่าไม่ลงงานนี้ (ให้ค้นงานของรถใหม่ หางานที่มี Dock นี้) ไม่มีงานไหนมี Dock นี้ก็กลับมาใช้ grade/lot เดิม
    return !!item && (dockId === null || this.itemHasDock(item, dockId, pallet.lotNo));
  }

  // จับคู่ Pallet ที่รออยู่ (มีได้ทีละ 1 ใบ) กับ item ของ shipment แล้วยิง get-pallet + put-away (get สำเร็จก่อนค่อยยิง put)
  //  allowSwitch: รถคันนี้มีงานอื่นอีก + พาเลทไม่ลงงานปัจจุบัน -> ค้นงานของรถใหม่แล้วสลับไปงานที่พาเลทตรง (ส่ง false ตอนเรียกซ้ำกันวนไม่จบ)
  private async matchPendingPalletsToShipment(truckCode: string, allowSwitch: boolean = true): Promise<void> {
    const pending = this._palletToLoadList.find(p => p.isSelectedForPlacement);
    if (allowSwitch && this._truckHasOtherJobs && pending && !pending.getDone && !this.palletFitsCurrentJob(pending, truckCode)) {
      await this.apiFindShipmentByTruckQr(truckCode);
      return;
    }

    if (this._isJobComplete) {
      this.SweetAlert('warning', `Shipment ${this.fallback(this._jobDataRaw?.system_no)} โหลดขึ้นรถครบแล้ว (${this.formatQty(this._completedQty)}/${this.formatQty(this._totalQty)} ${this._qtyUnit})`);
      return;
    }

    const pallet = this._palletToLoadList.find(p => p.isSelectedForPlacement);
    if (!pallet) return;

    if (pallet.qrCodes.some(c => this.isAlreadyLoaded(pallet.parsed, c))) {
      this.SweetAlert('error', `Pallet id "${pallet.id}" ถูกโหลดขึ้นรถไปแล้ว ไม่สามารถโหลดซ้ำได้`);
      return;
    }

    const label = `Pallet id "${pallet.id}" (${pallet.grade} • ${pallet.lotNo})`;
    let item: any;

    //  Get ผ่านไปแล้วรอบก่อน (Put ล้ม) -> ยิงแค่ Put ด้วย item/body เดิม ไม่เช็คยอดซ้ำ (ยอดถูกจองไว้ตอน Get แล้ว)
    if (pallet.getDone) {
      item = (this._jobDataRaw.items ?? []).find((it: any) => it.id === pallet.getDone!.itemId);
      if (!item) {
        this.SweetAlert('error', `${label} ไม่พบรายการสินค้าเดิมของการหยิบครั้งก่อนใน Shipment นี้ กรุณาลบออก (ปุ่ม -) แล้วสแกนใหม่`);
        return;
      }
      this.showLoadingToTruck();
      await this.putAwayAndFinish(pallet, item, label);
      return;
    }

    if (this._isManifestJob) {
      //  งานที่มีรายการพาเลทกำหนดไว้ (การ์ดใบแรกที่สร้างก่อนรู้งาน) -> โค้ดต้องตรงกับรายการ ใช้ item/น้ำหนักจากรายการ
      //  เอาทั้งพาเลทเสมอ (การ์ดที่นับถุงมาก่อนรู้งานก็ใช้โค้ดใบแรกจับคู่ แล้วโหลดทั้งพาเลทตามรายการ)
      const match = this.findManifestEntry(pallet.qrCodes[0]);
      if (!match) {
        this.SweetAlert('error', `${label} ไม่อยู่ในรายการพาเลทที่กำหนดของงานนี้ กรุณาลบออก (ปุ่ม -) แล้วสแกนพาเลทที่ถูกต้อง`);
        return;
      }
      if (!this.isItemOnTruck(match.item, truckCode)) {
        this.SweetAlert('error', `${label} เป็นของรถคันอื่น ไม่ใช่รถคันนี้`);
        return;
      }
      if (this.itemRemaining(match.item) <= 0) {
        this.SweetAlert('error', `${label} Grade/Lot นี้ครบจำนวนที่ต้องโหลดแล้ว`);
        return;
      }

      item = match.item;
      pallet.qty = Number(match.entry.qty) || pallet.qty;
      pallet.modeId = 1;
    } else {
      const found = this.findItemForLoad(pallet.id, this.matchGrade(pallet, this._jobDataRaw.items ?? []), pallet.lotNo, truckCode, this.recordDockId(pallet.record));
      if (!found.item) {
        this.SweetAlert('error', found.reason);
        return;
      }
      item = found.item;

      const remaining = this.itemRemainingForLot(item, pallet.lotNo);
      if (pallet.qty > remaining) {
        //  Jumbo/PL แบ่งเป็นถุงไม่ได้ -> ให้ลบการ์ดออก
        if (pallet.kind !== 'bag') {
          this.SweetAlert('error', `${this.fixedQtyExceedsText(pallet.kind, pallet.qty, remaining, item)} กรุณาลบออก (ปุ่ม -) แล้วสแกนพาเลทอื่น`);
          return;
        }

        //  ถุงปกติเกินยอดที่เหลือ (เคสพาเลทใบแรกที่ตอนสแกนถุงยังไม่รู้ยอด) -> เปิด modal นับถุงให้เอาเท่าที่เหลือ ยืนยันแล้วโหลดต่อทันที
        //  ทั้งพาเลท -> เริ่มจากถุงที่สแกนไว้ใบเดียว, นับถุงมาแล้ว -> เปิดพร้อมถุงเดิมทั้งหมดให้เอาออกบางถุง
        this._bagModal = {
          code: pallet.qrCodes[0],
          parsed: pallet.parsed,
          record: pallet.record,
          scannedCodes: pallet.modeId === 3 ? [...pallet.qrCodes] : [pallet.qrCodes[0]],
          remaining,
          hint: null,
          pallet,
          truckCode,
        };
        return;
      }
    }

    const jobId = this._jobDataRaw.id;

    //  from_location: เลือกจาก lot ของพาเลทที่สแกน (ดู resolveFromLocation) ไม่ใช่ตัวแรกเสมอ
    const fromLocation = this.resolveFromLocation(item, pallet.lotNo, pallet.qty, this.recordDockId(pallet.record));
    //  to_location: ต้องหาให้ตรงกับรถที่สแกนจริง (truckCode) ไม่ใช้ [0] เฉยๆ
    //  เพราะ item อาจมี to_locations หลายคัน/หลายปลายทาง แล้วรถที่สแกนอาจไม่ใช่ตัวแรกในลิสต์
    const toLocation = item.locations?.to_locations?.find((loc: any) => this.isSameTruck(loc.location_name, truckCode));

    const getFrom = {
      itemId: item.id,
      locationId: fromLocation?.location_id ?? 0,
      locationType: this._jobDataRaw.from_location_type ?? '-',
      updateBy: this._currentUserId,
    };
    const putTo = {
      itemId: item.id,
      locationId: toLocation?.location_id ?? 0,
      locationType: this._jobDataRaw.to_location_type ?? '-',
      updateBy: this._currentUserId,
    };

    //  payload ตามที่ BE แจ้งว่า endpoint loading จะทำให้เหมือนกลุ่ม kilo หน้า scan-pallet -> ยังทดสอบจริงไม่ได้จนกว่า BE จะแก้
    //  (หน้า report-broken-bag ยังส่งแบบเดิม ไม่แตะ)
    //  งานที่มีรายการพาเลทกำหนดไว้ = แบบ manifest (runInboundGet / put-away งานปกติ): qrCode ตัวเดียว + modeId 1 ไม่มี qrCodes/palletSeq
    //  งานอื่น = แบบ kilo ปกติ (getSpecialFullPallet / onConfirmSpecialQty / put-away ส่วน _isSpecialJob)
    if (!this._isManifestJob && pallet.palletSeq == null) {
      this.showLoadingToTruck();
      await this.syncPalletSeqFromServer(truckCode, jobId);
      pallet.palletSeq = this.claimNextPalletSeq();
    }

    const getBody = this._isManifestJob
      ? { ...getFrom, qrCode: pallet.qrCodes[0], modeId: 1 }
      : { ...getFrom, qrCodes: pallet.qrCodes, palletSeq: pallet.palletSeq, modeId: pallet.modeId };

    const putBody = this._isManifestJob
      ? { ...putTo, qrCode: pallet.qrCodes[0] }
      : { ...putTo, palletId: Number(pallet.id) || 0, qty: pallet.qty, palletSeq: pallet.palletSeq, qrCode: pallet.qrCodes[0] };

    this.showLoadingToTruck();

    const getError = await this.apiGetPallet(jobId, getBody);

    if (getError !== null) {
      this.SweetAlert('error', `${label} บันทึกการหยิบ Pallet (Get) ไม่สำเร็จ${getError ? ` : ${getError}` : ''}`);
      return;
    }

    //  Get ผ่านแล้ว = Location ต้นทางนี้ถูกหยิบออกไปจริง -> บวกยอดในเครื่องด้วย พาเลทถัดไปในรอบนี้จะเห็นว่าเหลือน้อยลง
    //  (lot เดียวกันอยู่หลาย Location จะได้สลับไปตัวที่ยังเหลือเอง) เหมือน adjustSpecialFromLocationReceived หน้า scan-pallet
    if (fromLocation) {
      fromLocation.actual_qty = (fromLocation.actual_qty ?? 0) + pallet.qty;
    }

    pallet.getDone = { itemId: item.id, putBody };

    await this.putAwayAndFinish(pallet, item, label);
  }

  //  ยิง Put ของพาเลทที่ Get ผ่านแล้ว -> ผ่าน: ย้ายการ์ดไปฝั่งที่โหลดแล้ว, ไม่ผ่าน: การ์ดค้างไว้ (getDone) สแกนรถใหม่ยิงแค่ Put
  private async putAwayAndFinish(pallet: PalletToLoadItem, item: any, label: string): Promise<void> {
    const putError = await this.apiPutAwayPallet(this._jobDataRaw.id, pallet.getDone!.putBody);

    if (putError !== null) {
      this.SweetAlert('error', `${label} หยิบสำเร็จแล้วแต่บันทึกการโหลดขึ้นรถ (Put-away) ไม่สำเร็จ${putError ? ` : ${putError}` : ''} — สแกน QR รถอีกครั้งเพื่อลองบันทึกใหม่`);
      return;
    }

    pallet.getDone = undefined;
    pallet.itemId = item.id;
    pallet.documentJob = this.fallback(item.document_job);

    //  งานที่มีรายการพาเลทกำหนดไว้นับเป็นจำนวนพาเลท (+1) เหมือนหน้า scan-pallet, งานอื่นนับ กก.
    const added = this._isManifestJob ? 1 : pallet.qty;
    item.complete_qty = (item.complete_qty ?? 0) + added;

    this._completedPalletList.push(pallet);
    this._completedQty += added;

    this.bringDoToFront(this.fallback(item.do_no));

    this._palletToLoadList = this._palletToLoadList.filter(p => p !== pallet);

    this.autoSelectPalletsIfEligible();

    this.SweetAlert('success', `โหลด Pallet ขึ้นรถสำเร็จ ${this.formatQty(pallet.qty)} กก. (${this.palletModeLabel(pallet)}) ลง DO ${this.fallback(item.do_no)}`);

    this.refreshDisplayList();
  }

  //  หา item ของรถคันนี้ที่ตรง grade/lot และยังโหลดไม่ครบ -> ไม่เจอคืนเหตุผลไว้ขึ้น error
  //  ใช้ทั้งตอนสแกนถุง (รู้ Shipment แล้ว) และตอนสแกนรถ
  //  dockId (ถ้ารู้): Dock ที่พาเลทวางอยู่จริง -> item ที่มี Dock นี้เป็นต้นทางมาก่อน (Shipment/DO ที่เอาพาเลทนี้มาวางจริง)
  //  ไม่มี item ไหนมี Dock นี้ -> ใช้ grade/lot แบบเดิม
  private findItemForLoad(palletId: string | null, grade: string, lot: string, truckCode: string, dockId: number | null = null): { item: any | null; reason: string } {
    const label = `Pallet id "${palletId}" (${grade} • ${lot})`;

    const sameGradeLot = (this._jobDataRaw?.items ?? []).filter((item: any) =>
      this.scanLogic.gradesMatch(item.grade, grade) && this.itemMatchesLot(item, lot)
    );

    const onTruck = sameGradeLot.filter((item: any) => this.isItemOnTruck(item, truckCode));

    if (onTruck.length === 0) {
      return {
        item: null,
        reason: sameGradeLot.length > 0
          ? `${label} มี Grade/Lot นี้ใน Shipment แต่เป็นของรถคันอื่น ไม่ใช่รถคันนี้`
          : `${label} ไม่มีอยู่ใน Shipment ของรถคันนี้ — นำ Pallet มาใส่รถผิดคัน`,
      };
    }

    const atDock = dockId === null ? [] : onTruck.filter((item: any) => this.itemHasDock(item, dockId, lot));
    const pool = atDock.length > 0 ? atDock : onTruck;

    //  grade/lot เดียวกันหลาย DO -> เคลียร์ทีละ DO ตาม item id น้อยไปมาก (ไม่พึ่งลำดับ array ที่ BE ส่งมา)
    const item = [...pool]
      .sort((a: any, b: any) => (Number(a.id) || 0) - (Number(b.id) || 0))
      .find((it: any) => this.itemRemainingForLot(it, lot) > 0) ?? null;
    return { item, reason: item ? '' : `${label} Grade/Lot นี้ครบจำนวนที่ต้องโหลดแล้ว` };
  }

  //  ก่อนจองเลขใหม่ทุกครั้ง: ดึง pallet_seq สูงสุดของงานนี้จาก server อีกรอบ -> ผู้ใช้คนเดียวกันโหลดงานเดียวกันจาก 2 เครื่อง
  //  (หรือหน้า report-broken-bag) ตัวนับในเครื่องนี้จะเก่า แล้วได้เลขซ้ำกับอีกเครื่อง -> reset การ์ดหนึ่งไป reset พาเลทของอีกเครื่องด้วย
  //  (BE reset ทั้งกลุ่ม pallet_seq) ดึงไม่สำเร็จ = ใช้ตัวนับในเครื่องต่อ (แบบเดิม)
  private async syncPalletSeqFromServer(truckCode: string, jobId: number): Promise<void> {
    try {
      const res: any = await firstValueFrom(this.restService.GetJobByLoadingTruck(truckCode));
      const job = (res?.data ?? []).find((j: any) => j?.id === jobId);
      const maxSeq = [...(job?.pallets?.receive_pallet ?? []), ...(job?.pallets?.complete_pallet ?? [])]
        .reduce((max: number, p: any) => Math.max(max, Number(p?.pallet_seq) || 0), 0);
      this._palletSeqCounter = Math.max(this._palletSeqCounter, Math.floor(maxSeq / this.SEQ_USER_SUFFIX_RANGE));
    } catch {
      //  ใช้ตัวนับในเครื่อง
    }
  }

  //  ponytail: ไม่เอาเลขของการ์ดที่ถูกลบกลับมาใช้ใหม่ (scan-pallet ทำแค่เป็น optimization) -> เลขแค่กระโดดข้าม ไม่ชนกัน
  private claimNextPalletSeq(): number {
    this._palletSeqCounter += 1;
    return this._palletSeqCounter * this.SEQ_USER_SUFFIX_RANGE + this._currentUserId;
  }

  //  Location ต้นทางที่ส่งไปกับ Get -> BE เช็คโควต้าราย Location ต้องส่งให้ตรงกับ lot ที่หยิบมาจริง ไม่ใช่ตัวแรกเสมอ
  //  (เคสจริง: lot ...439 อยู่ 38D02 แต่เดิมส่ง 38D01 ที่ lot อื่นโหลดครบแล้วไป -> BE ตอบ "จำนวนเกินที่กำหนด")
  //  ลำดับ: lot ตรง + ยังเหลือพอ (qty - actual_qty) -> lot ตรง -> ตัวแรก (แบบเดิม) / item ที่มี lot_no ทั้ง item ถือว่าทุก Location ตรง lot
  //  dockId (ถ้ารู้และเป็นต้นทางของ item นี้): ใช้ Dock ที่พาเลทวางอยู่จริงเสมอ ไม่เดาจาก lot
  private resolveFromLocation(item: any, lot: string, qty: number, dockId: number | null = null): any {
    const fromLocations: any[] = item?.locations?.from_locations ?? [];
    const atDock = dockId === null ? null : this.dockLocationFor(item, dockId, lot);
    if (atDock) return atDock;
    const lotMatched = String(item?.lot_no ?? '').trim()
      ? fromLocations
      : fromLocations.filter((loc: any) => this.scanLogic.getLocationLots(loc).some((entry) => entry.lot === lot));
    const hasRoom = (loc: any) => typeof loc.qty !== 'number' || loc.qty - (loc.actual_qty ?? 0) >= qty;

    return lotMatched.find(hasRoom) ?? lotMatched[0] ?? fromLocations[0];
  }

  //  ยอดที่ item นี้ยังต้องโหลด (หน่วยตาม _qtyUnit) -> สูตรเดียวกับงานกลุ่ม kilo หน้า scan-pallet (total - receive - complete)
  private itemRemaining(item: any): number {
    return Math.max(0, (item.total_qty ?? 0) - (item.receive_qty ?? 0) - (item.complete_qty ?? 0));
  }

  //  ยอดที่ item ยังรับ lot นี้ได้ -> item ที่ไม่มี lot_no แต่แบ่ง lot ไว้ใน addon_lot (เช่น DO เดียวมี lot A 6000 + lot B 1500)
  //  ต้องไม่ให้ lot B เกินส่วนของมัน ไม่งั้น lot B เติม DO จนเต็มแล้วพาเลท lot A ที่วางรออยู่ไม่มีที่ลง (เจอจริงงาน 3893 บน .75:
  //  DO 3031017344 ได้ lot 3439 ไป 7500 จากที่ควรได้ 1500 พาเลท lot 2539 8 ใบเลยโหลดไม่ได้)
  //  item ที่มี lot_no / ไม่มี addon_lot / งานที่มีรายการพาเลทกำหนดไว้ -> ใช้ยอดทั้ง item แบบเดิม
  private itemRemainingForLot(item: any, lot: string): number {
    const remaining = this.itemRemaining(item);
    if (this._isManifestJob || String(item?.lot_no ?? '').trim()) return remaining;

    const share = (item?.locations?.from_locations ?? [])
      .flatMap((loc: any) => this.scanLogic.getLocationLots(loc))
      .filter((entry: { lot: string; qty: number }) => entry.lot === lot)
      .reduce((sum: number, entry: { lot: string; qty: number }) => sum + (Number(entry.qty) || 0), 0);
    if (share <= 0) return remaining;

    const loadedServer = (this._completedPalletsByItem.get(item.id) ?? [])
      .filter((p: any) => String(p?.lot ?? '').trim() === lot)
      .reduce((sum: number, p: any) => sum + (Number(p?.qty) || 0), 0);
    const loadedSession = this._completedPalletList
      .filter((p) => p.itemId === item.id && p.lotNo === lot)
      .reduce((sum, p) => sum + (Number(p.qty) || 0), 0);

    return Math.max(0, Math.min(remaining, share - loadedServer - loadedSession));
  }

  private isItemOnTruck(item: any, truckCode: string): boolean {
    return (item?.locations?.to_locations ?? []).some((loc: any) => this.isSameTruck(loc.location_name, truckCode));
  }

  //  เทียบรถ 2 ฝั่งในรูปเดียวกัน (carrier|เลขทะเบียน) -> QR ที่มีอักษรไทยท้ายทะเบียนยังตรงกับ location_name ของงาน
  private isSameTruck(a: any, b: any): boolean {
    return this.scanLogic.normalizeTruckQr(a) === this.scanLogic.normalizeTruckQr(b);
  }

  //  grade ที่ใช้จับคู่ item -> Jumbo Bag ใช้กฎผ่อนปรนของ Jumbo (ตัด "GRADE " / "/900" / "(…)") เหมือนหน้า scan-pallet
  //  ไม่เจอก็ใช้ grade ดิบ (ไปขึ้น error "ไม่มีใน Shipment" ตามปกติ)
  private matchGrade(pallet: { kind: PalletKind; grade: string }, items: any[]): string {
    return pallet.kind === 'jumbo'
      ? (this.scanLogic.resolveJumboBagItemGrade(pallet.grade, items) ?? pallet.grade)
      : pallet.grade;
  }

  //  งานที่มีรายการพาเลทกำหนดไว้ -> หา entry ใน pallet_manual (item ไหนก็ได้) ที่โค้ดตรงกัน เหมือน findManualManifestMatch หน้า scan-pallet
  private findManifestEntry(code: string, items: any[] = this._jobDataRaw?.items ?? []): { item: any; entry: any } | null {
    for (const item of items) {
      const entry = (item?.pallet_manual ?? []).find((m: any) => this.scanLogic.qrCodesMatch(m?.scanned_qr_code, code));
      if (entry) return { item, entry };
    }
    return null;
  }

  //  pallet_assigned (งานกลุ่ม kg) -> แปลงเข้า pallet_manual (scannedQrCode -> scanned_qr_code) แบบเดียวกับหน้า scan-pallet
  //  แล้วคืนว่าเป็นงานที่มีรายการพาเลทกำหนดไว้ไหม (มี item ไหนมี pallet_manual ไม่ว่าง)
  private normalizeManifest(rawJob: any): boolean {
    const items = rawJob?.items ?? [];

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

    return items.some((item: any) => Array.isArray(item.pallet_manual) && item.pallet_manual.length > 0);
  }

  // หา Shipment จาก QR รถ แล้ว set job + จับคู่ Pallet ที่รออยู่ต่อทันที
  private async apiFindShipmentByTruckQr(truckCode: string): Promise<void> {
    try {
      this.showLoadingToTruck();
      const res: any = await firstValueFrom(this.restService.GetJobByLoadingTruck(truckCode));
      //  BE ค้นด้วย LIKE -> กรองเฉพาะงานที่มีรถคันนี้จริง (ตรงตัว) ก่อน
      const jobs: any[] = (res?.data ?? []).filter((job: any) =>
        (job?.items ?? []).some((item: any) => this.isItemOnTruck(item, truckCode))
      );

      if (jobs.length === 0) {
        this.SweetAlert('error', 'ไม่พบ Shipment ของรถคันนี้ กรุณาตรวจสอบ QR รถอีกครั้ง');
        return;
      }

      //  รถคันเดียวมีงาน Loading ค้างได้หลายงาน (หลาย Shipment / Shipment เดียวแยกงานต่อ DO) -> เดิมเอาแค่ data[0] (id ล่าสุด)
      //  พาเลทของงานอื่นเลยขึ้น "ผิด Shipment" ตอนนี้เลือกงานแรก (id ล่าสุด) ที่พาเลทที่รออยู่ตรงและยังโหลดไม่ครบ
      //  ไม่มีงานไหนเหลือยอด -> ใช้งานแรกที่ตรง (ไปขึ้น "ครบแล้ว" ตามปกติ)
      const candidates = jobs
        .map((job) => ({ job, isManifest: this.normalizeManifest(job) }))
        .filter(({ job, isManifest }) => this.hasMatchingPalletForShipment(job, truckCode, isManifest));

      //  พาเลทวางอยู่ Dock ไหนจริง -> งานที่มี item grade/lot ตรง + Dock นี้เป็นต้นทาง มาก่อนงานที่ตรงแค่ grade/lot
      const pending = this._palletToLoadList.find((p) => p.isSelectedForPlacement);
      const dockId = pending ? this.recordDockId(pending.record) : null;
      const hasDockItem = (job: any) => dockId !== null && pending !== undefined && (job.items ?? []).some((it: any) =>
        this.scanLogic.gradesMatch(it.grade, this.matchGrade(pending, job.items ?? []))
        && this.itemMatchesLot(it, pending.lotNo) && this.itemHasDock(it, dockId, pending.lotNo) && this.itemRemainingForLot(it, pending.lotNo) > 0);
      const hasRemaining = (job: any) => (job.items ?? []).some((it: any) => this.itemRemaining(it) > 0);

      const picked = candidates.find(({ job }) => hasDockItem(job))
        ?? candidates.find(({ job }) => hasRemaining(job))
        ?? candidates[0];

      // ห้ามผูกข้อมูล Shipment ถ้า Pallet ที่สแกนไว้ไม่ตรงกับ Shipment ไหนของรถคันนี้เลย
      if (!picked) {
        const shipmentNos = Array.from(new Set(jobs.map((job) => this.fallback(job.system_no)))).join(', ');
        this.SweetAlert(
          'error',
          `ผิด Shipment — Pallet ที่สแกนไว้ไม่ตรงกับ Shipment ${shipmentNos} ของรถคันนี้ กรุณาตรวจสอบ Pallet หรือสแกน QR รถให้ถูกต้อง`,
        );
        return;
      }

      this.setJobData(picked.job, truckCode, picked.isManifest);
      this._truckHasOtherJobs = jobs.length > 1;

      await this.matchPendingPalletsToShipment(truckCode, false);
    } catch {
      this.SweetAlert('error', 'ไม่สามารถค้นหา Shipment ได้ กรุณาลองสแกนใหม่อีกครั้ง');
    }
  }

  // เช็คว่า Pallet ที่เลือกไว้มีใบไหนตรงกับ Grade/Lot + ปลายทางของรถคันนี้ใน Shipment ที่หาเจอบ้าง
  //  เช็คว่า item นี้ตรงกับ lot ที่ระบุไหม -> รองรับ addon_lot (item.lot_no ว่าง แต่มี lot อยู่ใน
  //  from_locations[].addon_lot แทน) ใช้ร่วมกันทุกจุดที่ต้องจับคู่ item กับ lot ของ pallet ในไฟล์นี้
  private itemMatchesLot(item: any, lot: string): boolean {
    const itemLotNo = String(item?.lot_no ?? '').trim();
    if (itemLotNo) return itemLotNo === lot;

    const fromLocations = item?.locations?.from_locations ?? [];
    return fromLocations.some((loc: any) => this.scanLogic.getLocationLots(loc).some((entry) => entry.lot === lot));
  }

  //  งานที่มีรายการพาเลทกำหนดไว้ -> จับด้วยโค้ดที่อยู่ในรายการ, งานอื่น -> grade/lot (Jumbo ใช้กฎ grade ของ Jumbo)
  private hasMatchingPalletForShipment(rawJob: any, truckCode: string, isManifest: boolean): boolean {
    const items = rawJob?.items ?? [];
    const selectedPallets = this._palletToLoadList.filter((p) => p.isSelectedForPlacement);

    return selectedPallets.some((pallet) => {
      if (isManifest) {
        const match = this.findManifestEntry(pallet.qrCodes[0], items);
        return !!match && this.isItemOnTruck(match.item, truckCode);
      }

      const grade = this.matchGrade(pallet, items);
      return items.some((item: any) =>
        this.scanLogic.gradesMatch(item.grade, grade)
        && this.itemMatchesLot(item, pallet.lotNo)
        && this.isItemOnTruck(item, truckCode)
      );
    });
  }

  // Shipment นี้โหลดครบทุก กก. (หรือทุกพาเลท) แล้วหรือยัง
  get _isJobComplete(): boolean {
    if (!this._jobDataRaw || this._totalQty === 0) {
      return false;
    }
    return this._completedQty >= this._totalQty;
  }

  //  API Calls

  //  ใช้ตัวเดียวกับหน้า scan-pallet (palletId + qrCode ถูกช่อง) -> เดิมส่ง palletId เข้าช่อง palletNo ได้ record ผิดใบได้
  //  ถ้ามีหลายพาเลท grade/lot เดียวกัน จับคู่ด้วย pallet_id ก่อนเหมือน checkSpecialFullPalletThenQueue
  private async fetchPalletRecord(parsed: ParsedScanCode, code: string): Promise<any | null> {
    try {
      const res: any = await firstValueFrom(this.scanApi.getProcessPallet(parsed.palletId, parsed.grade, parsed.lot, code));
      const list: any[] = res?.data ?? [];

      return list.find(p => String(p.pallet_id) === String(parsed.palletId))
        ?? list.find(p => String(p.id) === String(parsed.palletId))
        ?? list[0]
        ?? null;
    } catch {
      return null;
    }
  }

  // await ได้ก่อนยิง put-away ต่อ -> คืน null = สำเร็จ, string = ข้อความ error จาก BE (ว่าง = BE ไม่ได้บอกเหตุผล)
  //  เอาข้อความ BE มาโชว์ใน popup ด้วย (เหมือน apiErrorMessage หน้า scan-pallet) ไม่งั้นต้องเปิด network ดูเองถึงรู้สาเหตุ
  private async apiGetPallet(jobId: number, requestData: object): Promise<string | null> {
    try {
      await firstValueFrom(this.restService.updateLoadingPalletGet(jobId, requestData));
      this.autoLogout.recordAction();   //  Get สำเร็จ = มีการทำงานจริง เริ่มนับ auto-logout ใหม่ (เหมือน ScanPalletApiService.callJobApi)
      return null;
    } catch (err: any) {
      return err?.error?.message ?? '';
    }
  }

  // เรียกได้ก็ต่อเมื่อ apiGetPallet สำเร็จแล้วเท่านั้น
  private async apiPutAwayPallet(jobId: number, requestData: object): Promise<string | null> {
    try {
      await firstValueFrom(this.restService.updateLoadingPalletPutAway(jobId, requestData));
      this.autoLogout.recordAction();   //  Put สำเร็จ = มีการทำงานจริง เริ่มนับ auto-logout ใหม่
      return null;
    } catch (err: any) {
      return err?.error?.message ?? '';
    }
  }

  // ==================== Job / Display Data ====================

  private setJobData(rawJob: any, truckCode: string, isManifest: boolean): void {
    this._jobDataRaw = rawJob;
    this._isManifestJob = isManifest;

    this.job = {
      jobTag: this.mapJobTag(rawJob.type_name, rawJob.type_topic),
      shipmentNo: this.fallback(rawJob.system_no),
    };

    this._truckQrCode = truckCode;

    const items = rawJob.items ?? [];

    this._totalQty = items.reduce((sum: number, item: any) => sum + (item.total_qty ?? 0), 0);
    this._completedQty = items.reduce((sum: number, item: any) => sum + (item.complete_qty ?? 0), 0);

    this.buildCompletedPalletsByItem(rawJob, items);

    //  เริ่มตัวนับจาก seq สูงสุดที่ backend มีอยู่แล้ว (receive + complete) หาร user_id ท้ายเลขออก เหมือน scan-pallet ตอนโหลดงาน
    const maxSeq = [...(rawJob.pallets?.receive_pallet ?? []), ...(rawJob.pallets?.complete_pallet ?? [])]
      .reduce((max: number, p: any) => Math.max(max, Number(p?.pallet_seq) || 0), 0);
    this._palletSeqCounter = Math.floor(maxSeq / this.SEQ_USER_SUFFIX_RANGE);

    this._expandedDoMap.clear();
    this._recentlyLoadedDoOrder = [];

    if (items.length === 0) {
      this.SweetAlert('warning', 'ไม่พบรายการสินค้าของ Shipment นี้');
    }
  }

  //  เช็คซ้ำรายถุง (QR) แทน pallet id -> พาเลทที่เอาไปแค่บางถุง ยังสแกนถุงที่เหลือของพาเลทนั้นได้
  //  + พาเลทที่เพิ่งเอาไปทั้งพาเลท (modeId 1) ในรอบนี้ ถุงไหนของพาเลทนั้นก็สแกนไม่ได้แล้ว
  //  ponytail: ทั้งพาเลทที่โหลดไปก่อนหน้านี้ (จาก server) รู้แค่ QR ถุงที่สแกนตอนนั้น ถุงอื่นของพาเลทนั้นปล่อยให้ backend ดักตอน Get
  private isAlreadyLoaded(parsed: ParsedScanCode, code: string): boolean {
    const serverCodes = (this._jobDataRaw?.pallets?.complete_pallet ?? []).map((p: any) => p?.scanned_qr_code);
    const sessionCodes = this._completedPalletList.flatMap(p => p.qrCodes);

    if ([...serverCodes, ...sessionCodes].some(c => this.scanLogic.qrCodesMatch(c, code))) {
      return true;
    }

    return this._completedPalletList.some(p =>
      p.modeId === 1 && p.id === parsed.palletId && this.scanLogic.gradesMatch(p.grade, parsed.grade) && p.lotNo === parsed.lot
    );
  }

  // ย้าย DO ที่เพิ่ง put-away สำเร็จขึ้นไปบนสุด + เปิด expand ให้อัตโนมัติ
  private bringDoToFront(doNo: string): void {
    this._recentlyLoadedDoOrder = this._recentlyLoadedDoOrder.filter(d => d !== doNo);
    this._recentlyLoadedDoOrder.unshift(doNo);

    this._expandedDoMap.set(doNo, true);
  }

  // จัดลำดับ DO group ตาม _recentlyLoadedDoOrder (ตัวล่าสุดอยู่บนสุด, ที่เหลือคงลำดับเดิม)
  private sortDoGroupsByRecent(groups: DoGroupDisplay[]): DoGroupDisplay[] {
    if (this._recentlyLoadedDoOrder.length === 0) {
      return groups;
    }

    const priority = new Map<string, number>();
    this._recentlyLoadedDoOrder.forEach((doNo, index) => priority.set(doNo, index));

    return [...groups].sort((a, b) => {
      const pa = priority.get(a.doNo);
      const pb = priority.get(b.doNo);

      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return 0;
    });
  }

  // จัดกลุ่ม item ทั้งหมดของ Shipment เป็นการ์ดแยกตาม DO สำหรับแสดงผลฝั่งขวา
  get _doGroups(): DoGroupDisplay[] {
    const items: any[] = this._jobDataRaw?.items ?? [];

    const groupOrder: string[] = [];
    const groupMap = new Map<string, any[]>();

    items.forEach((item: any) => {
      const doNo = this.fallback(item.do_no);
      if (!groupMap.has(doNo)) {
        groupMap.set(doNo, []);
        groupOrder.push(doNo);
      }
      groupMap.get(doNo)!.push(item);
    });

    const result: DoGroupDisplay[] = groupOrder.map(doNo => {
      const groupItems = groupMap.get(doNo)!;
      const firstItem = groupItems[0];

      //  ใช้ resolveSpecialDisplayLot กัน addon_lot item (lot_no ว่าง) ไปนับเป็น pair เดียวกันหมด
      //  (รวม lot จริงทุกตัวของ location เข้าด้วยกันเป็น "lotA/lotB" ให้ Set แยกออกจาก item อื่นที่ grade เดียวกันแต่ lot ต่างจริง)
      const uniquePairs = new Set(
        groupItems.map((it: any) => `${String(it.grade).trim()}|${this.scanLogic.resolveSpecialDisplayLot(it)}`)
      );

      let completedCount = 0;
      let totalCount = 0;
      const pallets: TotalPalletDisplayItem[] = [];
      //  ต่อ item ที่ใช้ addon_lot หลาย lot -> เก็บ "lot x/y กก." ไว้ประกอบ header ด้วย (แทนบรรทัดรวมก้อนเดียว)
      const headerLotSegments: string[] = [];

      groupItems.forEach((item: any) => {
        const total = item.total_qty ?? 0;

        totalCount += total;
        completedCount += Math.min(item.complete_qty ?? 0, total);

        //  1 แถว = โหลดจริง 1 ครั้ง (ทั้งพาเลท หรือชุดถุง) server ก่อน ตามด้วยที่เพิ่งโหลดใน session นี้ -> ไม่มีแถว "รอโหลด"
        //  ที่เดาจำนวนพาเลทจากน้ำหนักแล้ว เหมือนงานกลุ่ม kilo หน้า scan-pallet
        const loaded: { lot: string; qty: any; id: string | null; palletNo: string }[] = [
          ...(this._completedPalletsByItem.get(item.id) ?? []).map((p: any) => ({
            lot: String(p?.lot ?? '').trim(),
            qty: p?.qty,
            id: p?.id != null ? String(p.id) : null,
            palletNo: this.palletNos([p?.scanned_qr_code]),
          })),
          ...this._completedPalletList
            .filter(p => p.itemId === item.id)
            .map(p => ({ lot: p.lotNo, qty: p.qty, id: p.id, palletNo: this.palletNos(p.qrCodes) })),
        ];

        const displayLot = this.fallback(this.scanLogic.resolveSpecialDisplayLot(item));

        loaded.forEach((rec, i) => {
          pallets.push({
            key: `${item.id}-complete-${i}`,
            grade: String(item.grade).trim(),
            lotNo: rec.lot || displayLot,
            qty: rec.qty ?? 'ไม่ระบุ',
            id: rec.id,
            palletNo: rec.palletNo,
          });
        });

        //  item.lot_no ว่าง + มีหลาย lot จริงใน addon_lot -> header บอกยอดต่อ lot (y = กก. จริงของ lot จาก addon_lot ไม่ได้เดา)
        //  งานที่มีรายการพาเลทกำหนดไว้นับเป็นพาเลท ไม่มียอดพาเลทต่อ lot ให้เทียบ -> ใช้ header แบบปกติ
        const itemLotNo = String(item.lot_no ?? '').trim();
        const lots = itemLotNo || this._isManifestJob
          ? []
          : (item?.locations?.from_locations ?? []).flatMap((loc: any) => this.scanLogic.getLocationLots(loc));

        if (lots.length > 1) {
          lots.forEach((entry: { lot: string; qty: number }) => {
            const lotKg = loaded
              .filter(rec => rec.lot === entry.lot)
              .reduce((sum, rec) => sum + (Number(rec.qty) || 0), 0);
            headerLotSegments.push(`${entry.lot} ${this.formatQty(lotKg)}/${this.formatQty(entry.qty)} กก.`);
          });
        }
      });

      this.sortById(pallets);

      //  มี addon_lot หลาย lot -> โชว์ progress แยกต่อ lot ใน header เลย ("lotA 1,000/1,500 กก. / lotB 0/1,500 กก.")
      //  ไม่มี (lot ปกติ) -> รูปแบบเดิมทุกอย่าง
      const headerLabel = headerLotSegments.length > 0
        ? `${String(firstItem.grade).trim()} ${headerLotSegments.join(' / ')} ${firstItem.qty ?? 0}`
        : `${String(firstItem.grade).trim()} • ${this.fallback(this.scanLogic.resolveSpecialDisplayLot(firstItem))} • ${firstItem.qty ?? 0}`;

      return {
        doNo,
        headerLabel,
        extraItemsCount: Math.max(0, uniquePairs.size - 1),
        completedCount,
        totalCount,
        pallets,
        expanded: this._expandedDoMap.get(doNo) ?? false,
      };
    });

    return this.sortDoGroupsByRecent(result);
  }

  onToggleDoGroup(doNo: string): void {
    this._expandedDoMap.set(doNo, !(this._expandedDoMap.get(doNo) ?? false));
  }

  onClickExpandAll(): void {
    const items = this._jobDataRaw?.items ?? [];
    const doNos = new Set<string>(items.map((it: any) => this.fallback(it.do_no)));

    doNos.forEach(doNo => this._expandedDoMap.set(doNo, true));
  }

  onClickCollapseAll(): void {
    this._expandedDoMap.clear();
  }

  // เรียง Pallet ตาม id น้อย -> มาก (id ที่ null หรือไม่ใช่ตัวเลขอยู่ท้ายรายการ)
  private sortById(list: TotalPalletDisplayItem[]): void {
    list.sort((a, b) => {
      const numA = a.id !== null && !isNaN(Number(a.id)) ? Number(a.id) : Infinity;
      const numB = b.id !== null && !isNaN(Number(b.id)) ? Number(b.id) : Infinity;

      return numA - numB;
    });
  }

  private refreshDisplayList(): void {
    this._jobDataRaw = this._jobDataRaw ? { ...this._jobDataRaw } : null;
    this.cdr.detectChanges();
  }

  get _completePercent(): number {
    if (this._totalQty === 0) {
      return 0;
    }
    return Math.min(100, Math.round((this._completedQty / this._totalQty) * 100));
  }

  // แยก pallets.complete_pallet ของ backend (เก็บระดับ job) กลับไปเป็นของแต่ละ item แล้วเติมจนครบ complete_qty ของ item
  //  (งานที่มีรายการพาเลทกำหนดไว้นับทีละใบ, งานอื่นนับ กก. ของ record) แบ่ง 2 รอบเหมือน takeMatchingPallet หน้า scan-pallet:
  //  รอบ 1 จับเฉพาะที่ตรงจริง -> งานที่มีรายการกำหนด = โค้ดอยู่ในรายการของ item, งานอื่น = grade/lot (isPoolGradeMatch รองรับ
  //  Jumbo ที่ record เก็บ grade ดิบจากโค้ด เช่น "321F" แต่ item เป็น "321F/750")
  //  รอบ 2 record ที่เหลือ (grade ใน record ไม่ตรงกับ item เช่นมีวงเล็บต่อท้าย) ใส่ item ที่ยังไม่เต็มตามลำดับ เหมือน fallback
  //  pool.shift() ของ takeMatchingPallet -> ทุก record ที่โหลดแล้วยังโชว์อยู่เสมอ ไม่หายไปจากการ์ด DO เฉยๆ
  //  ponytail: backend ไม่ส่ง item_id มากับ record -> item หลายตัว grade/lot เดียวกัน (คนละ DO) แบ่ง record ตามลำดับ item
  //  ไม่ใช่ตามที่โหลดจริง ถ้า BE ส่ง item_id มาเมื่อไหร่ค่อยเปลี่ยนไปจับตรงๆ
  private buildCompletedPalletsByItem(rawJob: any, items: any[]): void {
    const pool: any[] = [...(rawJob.pallets?.complete_pallet ?? [])];
    const matchedByItem = new Map<number, any[]>(items.map((item: any) => [item.id, []]));
    const filledQty = new Map<number, number>();

    const assign = (belongs: (record: any, item: any) => boolean) => {
      items.forEach((item: any) => {
        for (let i = 0; i < pool.length && (filledQty.get(item.id) ?? 0) < (item.complete_qty ?? 0);) {
          if (!belongs(pool[i], item)) {
            i++;
            continue;
          }
          const [record] = pool.splice(i, 1);
          matchedByItem.get(item.id)!.push(record);
          filledQty.set(item.id, (filledQty.get(item.id) ?? 0) + (this._isManifestJob ? 1 : (Number(record?.qty) || 0)));
        }
      });
    };

    assign((record, item) => this._isManifestJob
      ? (item.pallet_manual ?? []).some((m: any) => this.scanLogic.qrCodesMatch(m?.scanned_qr_code, record?.scanned_qr_code))
      : this.scanLogic.isPoolGradeMatch(record, String(item.grade ?? '').trim())
        && this.itemMatchesLot(item, String(record?.lot ?? '').trim()));
    assign(() => true);

    this._completedPalletsByItem = matchedByItem;
  }

  //  Utils

  isNumberQty(qty: number | string): boolean {
    return typeof qty === 'number';
  }

  //  ตัวเลข กก. ในข้อความ (SweetAlert / header การ์ด DO) -> ใส่ comma ทศนิยมไม่เกิน 2 ตำแหน่ง เหมือน | number ใน HTML
  private formatQty(kg: number): string {
    return Number(kg ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  private fallback(value: any): any {
    return value === null || value === undefined || value === '' ? '-' : value;
  }

  private mapJobTag(typeName?: string, typeTopic?: string): string {
    if (typeName === 'Request') {
      return 'RQ';
    }

    switch (typeTopic) {
      case 'Inbound':
        return 'IN';
      case 'Outbound':
        return 'OUT';
      case 'Booking':
        return 'BK';
      default:
        return this.fallback(typeTopic);
    }
  }

  //  error/warning = ผู้ใช้ต้องอ่านแล้วไปทำอย่างอื่นต่อ (แก้ไข/สแกนใหม่/ย้อนกลับไปหน้าอื่น) -> ไม่หน่วงเวลาปิดเอง ต้องกดปิดเอง
  //  icon อื่น (success/info) = แจ้งผลไม่ต้องตัดสินใจ -> ปิดเองตามเดิม
  SweetAlert(iconn: any, alert_message: string) {
    const needsToRead = iconn === 'error' || iconn === 'warning';

    Swal.fire({
      position: 'center',
      icon: iconn,
      title: 'ข้อความจากระบบ',
      text: alert_message,
      showConfirmButton: true,
      ...(needsToRead ? {} : { timer: 1500, timerProgressBar: true }),
    });
  }
}