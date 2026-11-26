import { Component, OnInit, computed, signal, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DateAdapter, NativeDateAdapter } from '@angular/material/core';
import Swal from 'sweetalert2';
import { firstValueFrom } from 'rxjs';
import { HeaderComponent } from '../header/header.component';
import { CrudService } from '../../service/crud.service';
import { ScanPalletLogicService } from '../../service/scan-pallet-logic.service';
import { AutoLogoutService } from '../../service/auto-logout.service';
import * as Type from '../../../models/variables-type';

//  บังคับ format วันที่ในช่อง datepicker เป็น dd/mm/yyyy ตรงๆ (แนวทางเดียวกับหน้า job-accept)
class DdMmYyyyDateAdapter extends NativeDateAdapter {
  override format(date: Date, _displayFormat: unknown): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}

//  ถุงที่สแกน/กรอกใน modal "เพิ่มแจ้งเปลี่ยนถุงแตก" — qty เป็น 'None' จนกว่าจะใส่จำนวน
//  bag: จำนวนถุงจริงจาก damage_bags (ใช้แสดงผลในรายการ job list เท่านั้น — undefined ตอนสแกนใน modal เพิ่มถุง)
interface ScannedBag {
  id: number;
  grade: string;
  lot: string;
  qty: number | 'None';
  bag?: number;
}

//  View-model 1 ใบงาน — map มาจาก ResultProcessBrokenBagListData ของ backend
interface BrokenJob {
  rawId: number;                          // tr_broken_bag_header.id — ใช้อ้างอิงตอนเรียก API
  systemNo: string;
  sm: string;
  do: string;
  bags: ScannedBag[];                     // จาก reported_items (ยอดที่แจ้งไว้ตอนสร้างงาน)
  steps: Type.BrokenBagTimelineStep[];    // timeline จาก backend
  statusId: number;                       // status_id ดิบจาก backend — ใช้คุมปุ่ม "เปลี่ยนของกับ Warehouse"
  statusName: string;
  datetime: string;                       // create_datetime ดิบจาก API
  replaceItems: Type.ReplaceDetailItem[]; // ถุงที่ forklift สแกน/พิมพ์ไปแล้วและ Submit (tr_broken_bag_replace_detail จาก replace_bags)
}

//  status_id ที่อนุญาตให้กดปุ่ม "เปลี่ยนของกับ Warehouse" (ขั้น "ตรวจสอบถุง")
const STATUS_READY_TO_CHANGE = 2;

//  ผลลัพธ์การสแกน Truck/Dock ตอนเปิด modal "เพิ่มแจ้งเปลี่ยนถุงแตก" — ใช้ตอนสร้าง payload ส่ง POST broken-bag
//  id = id ของรถ/dock บนเส้น api ที่ใช้ค้นหา (carrier_id สำหรับรถ เพราะ master/vehicle ไม่มี field id เดี่ยวๆ, id ตรงๆ สำหรับ dock)
interface ReportLocationInfo {
  id: number;
  type: 'VEHICLE' | 'DOCK';
  label: string; // ป้ายทะเบียน หรือ location_desc — โชว์ในหัว modal ตอนเจอแล้ว
}

//  1 ถุงที่สแกนใน modal "เปลี่ยนของกับ Warehouse" — เก็บลง sessionStorage กันหายตอนเผลอปิด modal
interface WarehouseReplaceBag {
  no: number;            //  ลำดับถุง (Bag#1, Bag#2, ...)
  grade: string;
  lot: string;
  qty: number;           //  จำนวน/น้ำหนักต่อถุง (mockup — จริงต้องดึงจากระบบชั่งถุง)
  code: string;          //  โค้ด QR ดิบ ใช้กันสแกนซ้ำ
  scanDatetime: string;  //  ISO — เวลาที่สแกนถุงใบนั้น (ส่งเป็น scan_datetime)
  reason: string;        //  เหตุผลของถุงใบนี้ — กรอกเองใน modal ก่อนกด Submit (ส่งไปกับ shipping/scan-bag)
}

//  จำนวน/น้ำหนักต่อถุงที่สแกนได้ (mockup — QR มีแค่ grade/lot ยังไม่มีน้ำหนักจริง)
const WH_REPLACE_MOCK_QTY = 25;

//  1 ถุงที่สแกนใน modal "นำของขึ้นรถ" — ต้องตรงกับ bag_qr_code ใน replaceItems ของใบงานเป๊ะๆ (เช็คระดับถุงจริง ไม่ใช่แค่ grade/lot)
interface LoadToTruckBag {
  palletId: string;
  grade: string;
  lot: string;
  code: string;
}

//  ตัวคูณกันชน user_id ท้ายเลข pallet_seq ของงานโหลด (สูตรเดียวกับหน้า /load-to-truck และ claimNextSpecialSeq ของ scan-pallet)
const LOADING_SEQ_USER_SUFFIX_RANGE = 100000;
//  prefix key ใน sessionStorage เก็บถุงที่สแกนค้างไว้ แยกตามใบงาน (rawId)
const WH_REPLACE_STORAGE_PREFIX = 'brokenBagWhReplaceScan:';
//  ตัวเลือกเหตุผลต่อถุงใน modal "เปลี่ยนของกับ Warehouse" (ส่งไปกับ shipping/scan-bag)
const WH_REPLACE_REASON_OPTIONS = ['ถุงฉีกขาด', 'น้ำรั่วซึม', 'เปื้อนคราบ', 'อื่นๆ'];

@Component({
  selector: 'app-report-broken-bag',
  standalone: false,
  templateUrl: './report-broken-bag.html',
  styleUrl: './report-broken-bag.css',
  providers: [{ provide: DateAdapter, useClass: DdMmYyyyDateAdapter }],
})
export class ReportBrokenBag implements OnInit {
  _projectName = signal('QTrack');
  _forkliftId = signal('FL - 01');

  //  Add Broken Bag modal
  _showModal = signal(false);
  _scanState = signal<'scan' | 'success' | 'table'>('scan');
  _scannedBags = signal<ScannedBag[]>([]);
  //  ผลลัพธ์ step สแกน Truck/Dock -> ใช้เป็น reportLocationId/reportLocationType ตอน submit
  _reportLocation: ReportLocationInfo | null = null;
  //  Shipment ที่หาเจอจาก GET job/loading/{key} (rawJob.items[] ใช้เช็ค grade/lot ที่สแกนถุง)
  _shipmentRaw: any = null;
  _shipmentSm = '';
  //  งาน Loading ทั้งหมดของรถคันนี้ (รถ 1 คันมีงานค้างได้หลายงาน/หลาย Shipment) -> เลือก SM ตอนส่งจาก grade/lot ของถุง (ดู resolveShipmentSm)
  _shipmentJobs: any[] = [];
  //  true ระหว่างรอ GetJobByLoadingTruck (หลังเจอรถแล้ว กำลังวิ่งหา shipment ต่อ) -> โชว์ loading ใน scan-area
  _isFetchingShipment = signal(false);
  //  DO ของถุงใบแรกที่สแกนผ่าน -> ล็อกไว้ ถุงถัดไปต้องเป็น DO เดียวกันเท่านั้น (payload ส่งได้ทีละ 1 doNo)
  _lockedDoNo: string | null = null;

  //  ช่องรับค่าจากเครื่องสแกน (ซ่อนไว้) ใช้ร่วมกันทั้ง step สแกน Truck/Dock และ step สแกนถุง
  _scannerValue = '';
  _isScanningDockTruck = signal(false);
  _isScanningBag = signal(false);
  _manualMode = false;      //  Toggle "พิมพ์" — พิมพ์รหัสเองแทนการยิงสแกน (แนวทางเดียวกับ modal เปลี่ยนของกับ Warehouse)
  _manualValue = '';
  @ViewChild('addModalScannerInput') private addModalScannerInputRef?: ElementRef<HTMLInputElement>;

  //  ── Modal คีย์แพดตัวเลข (ใส่/แก้ไขจำนวนถุงในตาราง) — ปิด keyboard ของระบบ ใช้ปุ่มกดเองแทน (เหมาะกับ tablet) ──
  _qtyKeypadShowModal = signal(false);
  _qtyKeypadIndex: number | null = null;
  _qtyKeypadValue = signal('');
  private readonly QTY_KEYPAD_MAX_DIGITS = 5;

  //  ── Modal "เปลี่ยนของกับ Warehouse" (สแกนถุงแบบเดียวกับหน้า /scan-pallet) ──
  _whShowModal = signal(false);
  _whJob = signal<BrokenJob | null>(null);
  _whScannedBags = signal<WarehouseReplaceBag[]>([]);
  _whScannerValue = '';
  _whIsScanning = signal(false);   //  กดปุ่ม "กรุณากดปุ่มเพื่อสแกน" แล้วถึงจะรับค่าสแกน (แนวทางเดียวกับ scan-pallet)
  _whManualMode = false;      //  Toggle "พิมพ์" — พิมพ์รหัสถุงเองแทนการยิงสแกน
  _whManualValue = '';
  _isSubmittingWhReplace = false;
  //  ตัวเลือกเหตุผลต่อถุงใน mat-select (ให้ template ใช้ผ่าน *ngFor)
  readonly _whReasonOptions = WH_REPLACE_REASON_OPTIONS;

  //  ช่อง input ที่ซ่อนไว้รับค่าจากเครื่องสแกน (แนวทางเดียวกับ scannerInput ของหน้า scan-pallet)
  @ViewChild('whScannerInput') private whScannerInputRef?: ElementRef<HTMLInputElement>;

  //  ── Modal "นำของขึ้นรถ" (สแกนทุกถุงที่เปลี่ยนไว้แล้ว + สแกนรถ — concept เดียวกับหน้า /load-to-truck แต่ UI เป็น modal) ──
  _loadShowModal = signal(false);
  _loadJob = signal<BrokenJob | null>(null);
  _loadStep = signal<'bag' | 'truck'>('bag');
  _loadScannedBags = signal<LoadToTruckBag[]>([]);
  _loadScannerValue = '';
  _loadIsScanning = signal(false);
  _loadManualMode = false;
  _loadManualValue = '';
  _isSubmittingLoad = false;
  @ViewChild('loadModalScannerInput') private loadModalScannerInputRef?: ElementRef<HTMLInputElement>;

  //  Grade/Lot ของใบงาน — ถุงที่สแกนใน modal นี้ต้องตรงกับใบงานเท่านั้น (เหมือนเงื่อนไข modal เปลี่ยนของกับ Warehouse)
  _loadJobGrade = computed(() => this._loadJob()?.bags?.[0]?.grade ?? '-');
  _loadJobLot = computed(() => this._loadJob()?.bags?.[0]?.lot ?? '-');
  //  ต้องสแกนให้ครบทุกถุงที่ "เปลี่ยนของกับ Warehouse" ไปแล้วจริง (replaceItems) ถึงจะไปสแกนรถต่อได้
  _loadTargetCount = computed(() => (this._loadJob()?.replaceItems ?? []).filter((it) => !!it.bag_qr_code).length);
  _loadScannedComplete = computed(() => this._loadTargetCount() > 0 && this._loadScannedBags().length >= this._loadTargetCount());
  //  list ถุงเป้าหมายของใบงาน (replaceItems) ผูกสถานะเช็คแล้ว/ยังไม่สแกนสด — โชว์ในตาราง step "bag" ของ modal นำของขึ้นรถ
  _loadTargetBags = computed(() => {
    const scannedCodes = new Set(this._loadScannedBags().map((b) => b.code));
    return (this._loadJob()?.replaceItems ?? [])
      .filter((it) => !!it.bag_qr_code)
      .map((it, i) => ({
        no: i + 1,
        grade: it.grade,
        lot: it.lot,
        checked: scannedCodes.has((it.bag_qr_code as string).trim()),
      }));
  });

  //  จำนวนถุงที่ต้องเปลี่ยนทั้งหมดของใบงาน = ผลรวม bag ของ damage_bags (qty เป็นน้ำหนัก ไม่ใช่จำนวนถุง)
  _whTargetCount = computed(() =>
    (this._whJob()?.bags ?? []).reduce((sum, b) => sum + (typeof b.bag === 'number' ? b.bag : 0), 0)
  );
  //  Grade/Lot ของใบงาน — ใช้ตรวจว่าโค้ดที่สแกนตรงกับใบงานไหม + โชว์หัว modal
  _whJobGrade = computed(() => this._whJob()?.bags?.[0]?.grade ?? '-');
  _whJobLot = computed(() => this._whJob()?.bags?.[0]?.lot ?? '-');
  //  สแกนครบจำนวนของใบงานแล้วหรือยัง -> ครบถึงจะโชว์ dropdown สาเหตุ + เปิดปุ่ม Submit
  _whScannedComplete = computed(
    () => this._whTargetCount() > 0 && this._whScannedBags().length >= this._whTargetCount()
  );

  //  รายการดิบจาก GET api/v1/Process/broken-bag (map แล้ว);
  //  filteredBrokenJobs() กรอง Status / Date ทับอีกชั้นแบบ client-side
  //  (แนวทางเดียวกับ _items() ของ IRPC_BARCODE_FE_PWA_CHECKER/broken-bag-list)
  _allBrokenJobs = signal<BrokenJob[]>([]);
  _isLoading = signal(false);

  //  Filter State — default: Status = ทั้งหมด (array ว่าง = ไม่กรอง), Date = วันนี้
  _selectedStatus: string[] = [];
  _selectedDate: Date | null = new Date();

  //  ตัวเลือก Status = ชื่อสถานะ (status_name) เท่าที่มีจริงในรายการที่โหลดมา
  _statusOptions = computed<string[]>(() =>
    Array.from(new Set(this._allBrokenJobs().map((j) => j.statusName).filter(Boolean)))
  );

  //  Fallback timeline ตอนใบงานยังไม่มี steps ส่งมาจาก API
  private readonly DEFAULT_STEPS: Type.BrokenBagTimelineStep[] = [
    { title: 'แจ้งเปลี่ยนถุงแตก', subtitle: '', status: 'pending' },
    { title: 'Checker Approve', subtitle: 'รอดำเนินการ', status: 'pending' },
    { title: 'ตรวจสอบถุง', subtitle: 'รอดำเนินการ', status: 'pending' },
    { title: 'เปลี่ยนถุงแตกสำเร็จ', subtitle: 'รอดำเนินการ', status: 'pending' },
    { title: 'นำของขึ้นรถสำเร็จ', subtitle: 'รอดำเนินการ', status: 'pending' },
  ];

  constructor(
    private crudService: CrudService,
    private scanLogic: ScanPalletLogicService,
    private autoLogout: AutoLogoutService,
  ) {}

  //  ผู้ใช้ปัจจุบัน — ส่งเป็น createBy ตอน POST broken-bag (แนวทางเดียวกับ updateBy ของหน้า scan-pallet)
  private _currentUserId = 0;

  ngOnInit() {
    this._currentUserId = Number(localStorage.getItem('userId')) || 0;
    this.loadBrokenBagList();
  }

  /*------------------ List Loading ------------------*/
  //  กัน race: เปลี่ยน filter รัวๆ ยิง API ซ้อนกันได้ -> ยึด response ของ request ล่าสุดเท่านั้น
  private _loadRequestId = 0;

  //  GET api/v1/Process/broken-bag (BrokenBagController). error -> list ว่าง
  //  (defensive แบบเดียวกับ broken-bag-list.ts ของฝั่ง Checker)
  //  whCode/date filter ฝั่ง backend ไม่น่าเชื่อถือ (เทียบกันคนละคอลัมน์กับที่ส่งกลับมาโชว์ ทำให้ job จริงหายไปทั้งที่ whCode/วันที่ตรง)
  //  เลยดึงทั้งหมดมาก่อนเสมอ แล้วกรอง Warehouse/Status/Date ทับด้วย filteredBrokenJobs() ฝั่ง client ล้วนๆ
  loadBrokenBagList() {
    this._isLoading.set(true);
    const reqId = ++this._loadRequestId;

    this.crudService.GetBrokenBagList('', '', 0, 1, 100, '').subscribe({
      next: (res) => {
        if (reqId !== this._loadRequestId) return;   //  มี request ใหม่กว่าแซงไปแล้ว
        const jobs = (res.data ?? []).map((row) => this.mapApiJobToVM(row));
        this._allBrokenJobs.set(jobs);
        this._isLoading.set(false);
      },
      error: () => {
        if (reqId !== this._loadRequestId) return;
        this._allBrokenJobs.set([]);
        this._isLoading.set(false);
      },
    });
  }

  //  ResultProcessBrokenBagListData (snake_case) -> BrokenJob (view-model)
  //  bags มาจาก reported_items (ยอดที่แจ้งไว้ตอนสร้างงาน) — damage_bags ตอนนี้กลายเป็น log ต่อถุงที่สแกนจริง (BrokenBagScannedBag) ไม่ใช่ยอดสรุปแล้ว
  private mapApiJobToVM(row: Type.ResultProcessBrokenBagListData): BrokenJob {
    const reportedItems = row.reported_items ?? [];
    return {
      rawId: row.id,
      systemNo: row.system_no || `#${row.id}`,
      sm: row.sm ?? '-',
      do: row.do_no ?? '-',
      bags: reportedItems.map((b) => ({ id: b.id, grade: b.grade, lot: b.lot, qty: b.qty, bag: b.bag })),
      steps: row.steps?.length ? row.steps : [...this.DEFAULT_STEPS],
      statusId: row.status_id ?? 0,
      statusName: row.status_name ?? '',
      datetime: row.create_datetime ?? '',
      replaceItems: row.replace_bags ?? [],
    };
  }

  /*------------------ Filters (client-side) ------------------*/
  //  กรอง Status (ว่าง = ทั้งหมด) + Date (เทียบเฉพาะวัน) — เดิมกรอง Warehouse ด้วย แต่ backend เลิกส่ง wh_code มาแล้ว (ไม่มีข้อมูลให้กรอง)
  filteredBrokenJobs(): BrokenJob[] {
    const statuses = this._selectedStatus;
    const date = this._selectedDate;
    return this._allBrokenJobs().filter((job) => {
      if (statuses.length && !statuses.includes(job.statusName)) return false;
      if (date && !this.isSameDay(job.datetime, date)) return false;
      return true;
    });
  }

  //  รวมบรรทัด Grade/Lot ของ job เป็นบรรทัดเดียว (compact row แสดงได้แค่บรรทัดเดียว)
  bagsSummary(job: BrokenJob): string {
    if (!job.bags.length) return '-- ไม่มีรายการถุง --';
    return job.bags.map((b) => `Grade : ${b.grade} - Lot : ${b.lot} X${b.bag ?? 0} Bags`).join(', ');
  }

  //  ข้อความที่โชว์ในกล่อง Status ตอนเลือกบางสถานะ (ค่าใน _selectedStatus คือชื่อสถานะอยู่แล้ว)
  statusTriggerText(): string {
    return this._selectedStatus.join(', ');
  }

  //  เปลี่ยน filter ตัวใดตัวหนึ่ง (Status / Date) -> ดึงข้อมูลจาก backend ใหม่ทันที
  //  แล้ว filteredBrokenJobs() ค่อยกรอง Status/Date ที่เลือกทับอีกชั้น (endpoint ยังไม่รับ param เหล่านี้)
  onFilterChange(): void {
    this.loadBrokenBagList();
  }

  //  datetime = create_datetime ดิบจาก API (รูปแบบไม่การันตี) -> เทียบเฉพาะ Y/M/D
  //  รองรับ "d/m/yyyy[ HH:mm]" ที่ปีอาจเป็น พ.ศ. (2569 => 2026) และอะไรก็ตามที่ Date parse ได้เอง
  private isSameDay(datetime: string, target: Date): boolean {
    if (!datetime) return false;

    const dmy = datetime.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmy) {
      const [, dd, mm, yyyy] = dmy;
      return (
        this.toGregorianYear(Number(yyyy)) === target.getFullYear() &&
        Number(mm) === target.getMonth() + 1 &&
        Number(dd) === target.getDate()
      );
    }

    const d = new Date(datetime);
    if (isNaN(d.getTime())) return false;
    return (
      this.toGregorianYear(d.getFullYear()) === target.getFullYear() &&
      d.getMonth() === target.getMonth() &&
      d.getDate() === target.getDate()
    );
  }

  //  ปีแบบ พ.ศ. (>= 2400) -> ค.ศ. เพื่อเทียบกับ Date ที่ datepicker สร้าง
  private toGregorianYear(year: number): number {
    return year >= 2400 ? year - 543 : year;
  }

  //  วันเวลาแบบ local wall-clock "yyyy-MM-ddTHH:mm:ss" (ไม่มี Z)
  //  ห้ามใช้ toISOString() — มันแปลงเป็น UTC พอ SQL cast เป็น DATETIME เลยได้เวลาช้าไป 7 ชม.
  //  และไม่ตรงกับ create_datetime ที่ proc เติมด้วย GETDATE() (เวลาเครื่อง SQL = local)
  private formatLocalDateTime(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /*------------------ เปลี่ยนของกับ Warehouse ------------------*/
  //  ปุ่มกดได้เฉพาะใบงานที่อยู่ขั้น "ตรวจสอบถุง" (status_id === 3) เท่านั้น
  canChangeWithWarehouse(job: BrokenJob): boolean {
    return job.statusId === STATUS_READY_TO_CHANGE;
  }

  //  เช็คจาก steps[] (title จาก backend) แทน status_id ตรงๆ — เลี่ยงเลข status_id ที่คอมเมนต์เดิมในไฟล์นี้ขัดกันเอง (2 vs 3)
  private hasStepDone(job: BrokenJob, title: string): boolean {
    return job.steps.some((s) => s.title === title && s.status === 'done');
  }

  //  ปุ่ม "นำของขึ้นรถ" กดได้เมื่อ "เปลี่ยนถุงแตกสำเร็จ" แล้ว แต่ยังไม่ "นำของขึ้นรถสำเร็จ"
  canLoadToTruck(job: BrokenJob): boolean {
    return this.hasStepDone(job, 'เปลี่ยนถุงแตกสำเร็จ') && !this.hasStepDone(job, 'นำของขึ้นรถสำเร็จ');
  }

  //  ใบงาน "นำของขึ้นรถสำเร็จ" แล้ว -> จบ flow ทั้งหมด โชว์ปุ่ม "สำเร็จ" เฉยๆ กดไม่ได้
  isJobComplete(job: BrokenJob): boolean {
    return this.hasStepDone(job, 'นำของขึ้นรถสำเร็จ');
  }

  //  ปุ่ม "เปลี่ยนของกับ Warehouse" บนการ์ดใบงาน -> เปิด modal สแกนถุง
  onChangeWithWarehouse(job: BrokenJob): void {
    if (!this.canChangeWithWarehouse(job)) return;
    this._whJob.set(job);

    //  ไม่เอาถุงจาก replace_items มาใส่ให้ -> ผู้แจ้งต้องสแกนเองทุกถุง
    //  คืนเฉพาะถุงที่ตัวเองสแกนค้างใน sessionStorage (เผื่อรอบก่อนเผลอปิด modal)
    this._whScannedBags.set(this.loadWhScanFromStorage(job.rawId));
    this._whScannerValue = '';
    this._whIsScanning.set(false);
    this._whManualMode = false;
    this._whManualValue = '';
    this._whShowModal.set(true);
  }

  //  ปิด modal — ไม่ล้างถุงที่สแกนไว้ (ยังอยู่ใน sessionStorage รอเปิดมาสแกนต่อ)
  closeWhModal(): void {
    this._whShowModal.set(false);
    this._whIsScanning.set(false);
  }

  //  ปุ่ม "กรุณากดปุ่มเพื่อสแกน" -> เริ่มรับค่าจากเครื่องสแกน + โฟกัสช่อง input ที่ซ่อนไว้
  onWhScanBtnClick(): void {
    this._whIsScanning.set(true);
    this.focusWhScanner();
  }

  //  ปุ่ม X ข้างปุ่มสแกน — หยุดสแกน + ล้างถุงที่สแกนไว้ทั้งหมดของใบงานนี้ (ยืนยันก่อน เพราะเก็บ session ไว้)
  onWhClearScan(): void {
    this._whScannerValue = '';
    this._whIsScanning.set(false);
    if (this._whScannedBags().length === 0) return;

    Swal.fire({
      icon: 'warning',
      title: 'ล้างรายการถุงที่สแกนทั้งหมด?',
      showCancelButton: true,
      confirmButtonText: 'ล้าง',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#d32f2f',
    }).then((res) => {
      if (!res.isConfirmed) return;
      const job = this._whJob();
      this._whScannedBags.set([]);
      if (job) this.clearWhScanFromStorage(job.rawId);
    });
  }

  private focusWhScanner(): void {
    if (this._whManualMode) return;   //  โหมดพิมพ์เอง -> ห้ามแย่ง focus จากช่องพิมพ์
    setTimeout(() => this.whScannerInputRef?.nativeElement?.focus(), 0);
  }

  //  สลับโหมด "พิมพ์" (พิมพ์รหัสถุงเองแทนการยิงสแกน) — แนวทางเดียวกับหน้า scan-pallet
  onWhToggleManual(checked: boolean): void {
    this._whManualMode = checked;
    this._whManualValue = '';
    this._whIsScanning.set(false);   //  เข้าโหมดพิมพ์ -> ปิดสถานะกำลังสแกน
    if (!checked) this.focusWhScanner();
  }

  //  ยืนยันรหัสที่พิมพ์เอง -> ใช้ logic ตรวจ/บันทึกชุดเดียวกับตอนสแกนจริง (onWhScannerEnter)
  onWhSubmitManual(): void {
    const code = this._whManualValue.trim();
    if (!code) return;
    this._whScannerValue = code;
    this._whManualValue = '';
    this.onWhScannerEnter();
  }

  //  ผู้ใช้สแกน/พิมพ์โค้ดถุงแล้วกด Enter — ตรวจ Grade + จำนวน ให้ตรงกับใบงาน (แนวทางเดียวกับ scan-pallet)
  onWhScannerEnter(): void {
    const code = this._whScannerValue.trim();
    this._whScannerValue = '';
    if (!code) return;
    //  โหมดสแกน: ต้องกดปุ่ม "กรุณากดปุ่มเพื่อสแกน" ก่อน / โหมดพิมพ์: มาจากปุ่ม "ยืนยัน" อยู่แล้ว
    if (!this._whManualMode && !this._whIsScanning()) return;

    const parsed = this.scanLogic.parseScanCode(code);
    if (!parsed) {
      Swal.fire({ icon: 'error', title: 'QR Code ไม่ถูกต้อง', text: 'กรุณาสแกน QR Code ถุงให้ถูกต้อง', confirmButtonColor: '#d32f2f' });
      this.focusWhScanner();
      return;
    }

    //  Grade ต้องตรงกับใบงาน (ตาม note "*Grade และจำนวนถุงต้องตรงกับใบงานเท่านั้น")
    if (!this.scanLogic.gradesMatch(parsed.grade, this._whJobGrade())) {
      Swal.fire({ icon: 'error', title: 'Grade ไม่ตรงกับใบงาน', text: `ใบงานนี้ต้องเป็น Grade ${this._whJobGrade()} เท่านั้น`, confirmButtonColor: '#d32f2f' });
      this.focusWhScanner();
      return;
    }

    //  กันสแกนถุงเดิมซ้ำ
    if (this._whScannedBags().some((b) => b.code === code)) {
      Swal.fire({ icon: 'warning', title: 'ถุงนี้ถูกสแกนไปแล้ว', confirmButtonColor: '#F8C538' });
      this.focusWhScanner();
      return;
    }

    //  สแกนครบจำนวนของใบงานแล้ว
    if (this._whScannedBags().length >= this._whTargetCount()) {
      Swal.fire({ icon: 'warning', title: `สแกนครบ ${this._whTargetCount()} ถุงแล้ว`, confirmButtonColor: '#F8C538' });
      this.focusWhScanner();
      return;
    }

    const next: WarehouseReplaceBag = {
      no: this._whScannedBags().length + 1,
      grade: parsed.grade,
      lot: parsed.lot,
      qty: WH_REPLACE_MOCK_QTY,
      code,
      scanDatetime: this.formatLocalDateTime(new Date()),
      reason: '',
    };
    this._whScannedBags.update((bags) => [...bags, next]);
    this.saveWhScanToStorage();

    //  สแกนครบจำนวนแล้ว -> หยุดสแกน ปล่อยให้เลือกสาเหตุ / กด Submit
    if (this._whScannedComplete()) {
      this._whIsScanning.set(false);
    } else {
      this.focusWhScanner();
    }
  }

  //  ลบถุงที่สแกนออก 1 รายการ (ปุ่มถังขยะ) -> renumber Bag# ใหม่
  removeWhBag(index: number): void {
    this._whScannedBags.update((bags) =>
      bags.filter((_, i) => i !== index).map((b, i) => ({ ...b, no: i + 1 })),
    );
    this.saveWhScanToStorage();
  }

  //  Submit ได้เมื่อสแกนครบจำนวนของใบงาน + ทุกถุงกรอกเหตุผลแล้ว
  canSubmitWhReplace(): boolean {
    return this._whScannedComplete() && this._whScannedBags().every((b) => b.reason.trim().length > 0);
  }

  //  ปุ่ม Submit — บันทึกการสแกนถุงแตกลง database ผ่าน PATCH broken-bag/{id}/shipping/scan-bag
  confirmWhReplace(): void {
    const job = this._whJob();
    if (!job || !this.canSubmitWhReplace() || this._isSubmittingWhReplace) return;

    //  bagQrCode = โค้ด QR ถุงที่สแกน/พิมพ์เอง (ส่งดิบ; backend หา bag_id จาก tr_bag.qr_text_data เอง)
    const items: Type.ReplaceItemModel[] = this._whScannedBags().map((b) => ({
      fg: 0,
      bagQrCode: b.code,
      scanDatetime: b.scanDatetime,
      reason: b.reason,
    }));
    if (items.length === 0) return;

    this._isSubmittingWhReplace = true;
    this.crudService
      .ShippingScanBrokenBag(job.rawId, { items, updateBy: this._currentUserId })
      .subscribe({
        next: (res) => {
          this._isSubmittingWhReplace = false;

          if (res?.status && res.status !== 'success') {
            Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: res.message ?? 'กรุณาลองใหม่อีกครั้ง', confirmButtonColor: '#d32f2f' });
            return;
          }

          //  บันทึกสำเร็จ -> เคลียร์ถุงที่เก็บไว้ของใบงานนี้ + ปิด modal + โหลดรายการใหม่
          this.clearWhScanFromStorage(job.rawId);
          this._whScannedBags.set([]);
          this._whIsScanning.set(false);
          this._whShowModal.set(false);
          Swal.fire({ icon: 'success', title: 'บันทึกเปลี่ยนของกับ Warehouse สำเร็จ', confirmButtonColor: '#14a318', timer: 900 });
          this.loadBrokenBagList();
        },
        error: (err) => {
          this._isSubmittingWhReplace = false;
          Swal.fire({
            icon: 'error',
            title: 'บันทึกไม่สำเร็จ',
            text: err?.error?.message ?? 'กรุณาลองใหม่อีกครั้ง',
            confirmButtonColor: '#d32f2f',
          });
        },
      });
  }

  /*------------------ WH Replace: เก็บถุงที่สแกนไว้กันหายตอนเผลอปิด modal ------------------*/
  private whStorageKey(rawId: number): string {
    return `${WH_REPLACE_STORAGE_PREFIX}${rawId}`;
  }

  private saveWhScanToStorage(): void {
    const job = this._whJob();
    if (!job) return;
    try {
      sessionStorage.setItem(this.whStorageKey(job.rawId), JSON.stringify(this._whScannedBags()));
    } catch {
      /* sessionStorage เต็ม/ถูกปิด -> ข้ามไป (ยังใช้งาน modal ต่อได้) */
    }
  }

  private loadWhScanFromStorage(rawId: number): WarehouseReplaceBag[] {
    try {
      const raw = sessionStorage.getItem(this.whStorageKey(rawId));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private clearWhScanFromStorage(rawId: number): void {
    try {
      sessionStorage.removeItem(this.whStorageKey(rawId));
    } catch {
      /* ignore */
    }
  }

  //  โฟกัสช่องสแกนกลับทุกครั้งที่คลิกในหน้า ระหว่างที่กำลังสแกนอยู่ (เผื่อ focus หลุด)
  //  สแกนครบ/โหมดพิมพ์/ยังไม่กดปุ่มสแกน -> ไม่แย่ง focus
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this._whShowModal() && this._whIsScanning() && !this._whScannedComplete() && !this._whManualMode) {
      this.focusWhScanner();
    }
    if (this._showModal() && (this._isScanningDockTruck() || this._isScanningBag()) && !this._manualMode) {
      this.focusAddModalScanner();
    }
    if (this._loadShowModal() && this._loadIsScanning() && !this._loadManualMode) {
      this.focusLoadScanner();
    }
  }

  //  สลับหน้าต่าง/แอป (focus หลุดจาก browser) -> ปุ่มสแกนกลับเป็นสีน้ำเงินปกติ
  @HostListener('window:blur')
  onWindowBlur(): void {
    this._whIsScanning.set(false);
    this._isScanningDockTruck.set(false);
    this._isScanningBag.set(false);
    this._loadIsScanning.set(false);
  }

  /*------------------ Add Broken Bag Modal ------------------*/
  openModal() {
    this._scannedBags.set([]);
    this._scanState.set('scan');
    this._reportLocation = null;
    this._shipmentRaw = null;
    this._shipmentJobs = [];
    this._shipmentSm = '';
    this._lockedDoNo = null;
    this._isFetchingShipment.set(false);
    this._manualMode = false;
    this._manualValue = '';
    this._isScanningDockTruck.set(false);
    this._isScanningBag.set(false);
    this._showModal.set(true);
  }

  closeModal() {
    this._showModal.set(false);
    this._isScanningDockTruck.set(false);
    this._isScanningBag.set(false);
  }

  private focusAddModalScanner(): void {
    if (this._manualMode) return;
    setTimeout(() => this.addModalScannerInputRef?.nativeElement?.focus(), 0);
  }

  //  ปุ่ม "Scan QR Code" ที่หัว modal — ความหมายเปลี่ยนไปตาม step: scan/success = สแกน Truck/Dock, table = สแกนถุง
  onClickScanButton(): void {
    if (this._scanState() === 'table') {
      this._isScanningBag.set(true);
    } else {
      this._isScanningDockTruck.set(true);
    }
    this.focusAddModalScanner();
  }

  onToggleManual(checked: boolean): void {
    this._manualMode = checked;
    this._manualValue = '';
    this._isScanningDockTruck.set(false);
    this._isScanningBag.set(false);
    if (!checked) this.focusAddModalScanner();
  }

  onSubmitManual(): void {
    const code = this._manualValue.trim();
    if (!code) return;
    this._scannerValue = code;
    this._manualValue = '';
    this.onScannerEnter();
  }

  onScannerEnter(): void {
    const code = this._scannerValue.trim();
    this._scannerValue = '';
    if (!code) return;

    if (this._scanState() === 'table') {
      if (!this._manualMode && !this._isScanningBag()) return;
      this.handleBagScan(code);
    } else {
      if (!this._manualMode && !this._isScanningDockTruck()) return;
      if (this._isFetchingShipment()) return;   //  กันสแกน/พิมพ์ซ้ำระหว่างรอผล shipment ของรอบก่อนหน้า
      this._isScanningDockTruck.set(false);
      this.resolveDockTruckScan(code);
    }
  }

  //  รับเฉพาะรถเท่านั้น (ไม่รับ Dock แล้วตามที่ผู้ใช้ขอ) — resolveDockScan() ด้านล่างยังอยู่ครบเผื่อเปิด Dock กลับมาทีหลัง แค่ branch ตรงนี้ตาม code.includes('|')
  private resolveDockTruckScan(code: string): void {
    this.resolveTruckScan(code);
  }

  //  GET master/vehicle ด้วย licensePlate (ส่วนหลัง "|") -> เช็คว่ามีรถคันนี้จริงไหม แล้ววิ่งไปหา Shipment จริงต่อ (GetJobByLoadingTruck)
  private resolveTruckScan(code: string): void {
    //  ใช้ทะเบียนจากโค้ดที่แปลงแล้ว (carrier|เลขทะเบียน) -> QR รุ่นเก่าที่มีอักษรไทย หรืออักษรไทยที่เครื่องสแกนอ่านเพี้ยน ยังหารถเจอ
    const truckKey = this.scanLogic.normalizeTruckQr(code);
    const carrierCode = (truckKey.split('|')[0] ?? '').trim();
    const licensePlate = (truckKey.split('|')[1] ?? '').trim();
    if (!licensePlate) {
      Swal.fire({ icon: 'error', title: 'QR รถไม่ถูกต้อง', text: 'รูปแบบต้องเป็น carrierCode|licensePlate', confirmButtonColor: '#d92d20' });
      return;
    }

    this.crudService.GetMasterVehicle(licensePlate).subscribe({
      next: (res) => {
        const list = res?.data ?? [];
        //  master/vehicle ค้นแบบ LIKE -> เลือกคันที่ carrier + ทะเบียน (รูปแปลงแล้ว) ตรงกับ QR ก่อน
        const vehicle = list.find((v) => this.scanLogic.normalizeTruckQr(`${v.carrier_code ?? ''}|${v.license_plate ?? ''}`) === truckKey)
          ?? list.find((v) => String(v.carrier_code ?? '').trim() === carrierCode)
          ?? list[0];
        if (!vehicle) {
          Swal.fire({ icon: 'error', title: 'ไม่พบรถคันนี้ในระบบ', confirmButtonColor: '#d92d20' });
          return;
        }
        //  key ต้องอยู่ในรูป to_location_name ของงาน Loading (carrier|เลขทะเบียน) ไม่งั้น QR ที่มีอักษรไทยท้ายทะเบียนหาไม่เจอ
        this.fetchShipmentForReportLocation({ id: vehicle.carrier_id ?? 0, type: 'VEHICLE', label: vehicle.license_plate }, truckKey);
      },
      error: () => Swal.fire({ icon: 'error', title: 'ตรวจสอบรถไม่สำเร็จ กรุณาลองใหม่', confirmButtonColor: '#d92d20' }),
    });
  }

  //  GET master/location/dock ทั้งหมด (ไม่กรอง whCode เพราะ endpoint ไม่มี param ค้นด้วย location_desc ตรงๆ) แล้วหาเองด้วย location_desc
  //  ยังไม่ถูกเรียกที่ไหน (Dock ถูกปิดไปตามที่ผู้ใช้ขอ) — เก็บไว้เผื่อเปิดกลับมาใช้ทีหลัง
  private resolveDockScan(code: string): void {
    this.crudService.GetMasterLocationDock().subscribe({
      next: (res) => {
        const dock = (res?.data ?? []).find((d) => String(d.location_desc).trim() === code.trim());
        if (!dock) {
          Swal.fire({ icon: 'error', title: 'ไม่พบ Dock นี้ในระบบ', confirmButtonColor: '#d92d20' });
          return;
        }
        this.fetchShipmentForReportLocation({ id: dock.id, type: 'DOCK', label: dock.location_desc }, dock.location_desc);
      },
      error: () => Swal.fire({ icon: 'error', title: 'ตรวจสอบ Dock ไม่สำเร็จ กรุณาลองใหม่', confirmButtonColor: '#d92d20' }),
    });
  }

  //  GET job/loading/{key} (key = carrierCode|licensePlate สำหรับรถ, location_desc สำหรับ dock)
  //  หา Shipment จริงแล้วเอา items[] (grade/lot/do_no) มาใช้เช็คตอนสแกนถุงใน handleBagScan
  private fetchShipmentForReportLocation(location: ReportLocationInfo, jobLoadingKey: string): void {
    this._scanState.set('success');
    this._reportLocation = location;
    this._isFetchingShipment.set(true);

    this.crudService.GetJobByLoadingTruck(jobLoadingKey).subscribe({
      next: (res: any) => {
        this._isFetchingShipment.set(false);
        //  BE ค้นด้วย LIKE -> เก็บเฉพาะงานที่มีรถคันนี้จริง (รถ: เทียบรูปแปลงแล้ว, dock: ไม่กรอง) ทุกงาน ไม่ใช่แค่ data[0]
        const jobs: any[] = (res?.data ?? []).filter((job: any) => location.type !== 'VEHICLE' || this.isJobOnTruck(job, jobLoadingKey));
        this._shipmentJobs = jobs;
        const rawJob = jobs[0];
        if (!rawJob) {
          this._scanState.set('scan');
          Swal.fire({ icon: 'error', title: 'ไม่พบข้อมูล Shipment ของรายการนี้', confirmButtonColor: '#d92d20' });
          return;
        }
        this._shipmentRaw = rawJob;
        this._shipmentSm = rawJob.system_no ?? '';
        this._lockedDoNo = null;
        setTimeout(() => this._scanState.set('table'), 500);
      },
      error: () => {
        this._isFetchingShipment.set(false);
        this._scanState.set('scan');
        Swal.fire({ icon: 'error', title: 'ค้นหา Shipment ไม่สำเร็จ กรุณาลองใหม่', confirmButtonColor: '#d92d20' });
      },
    });
  }

  private isJobOnTruck(job: any, truckKey: string): boolean {
    return (job?.items ?? []).some((item: any) => this.isItemOnTruck(item, truckKey));
  }

  private isItemOnTruck(item: any, truckKey: string): boolean {
    const key = this.scanLogic.normalizeTruckQr(truckKey);
    return (item?.locations?.to_locations ?? []).some((loc: any) => this.scanLogic.normalizeTruckQr(loc?.location_name) === key);
  }

  //  SM ที่ส่งไปกับใบแจ้ง: งานแรก (id ล่าสุด) ที่มี item grade/lot ตรงกับถุงใบแรก -> ไม่เจอใช้งานแรกของรถ (แบบเดิม)
  private resolveShipmentSm(bags: ScannedBag[]): string {
    const first = bags[0];
    const job = first
      ? this._shipmentJobs.find((j: any) => (j.items ?? []).some((item: any) =>
          this.scanLogic.gradesMatch(item.grade, first.grade) && this.itemMatchesLot(item, first.lot)))
      : null;
    return (job ?? this._shipmentRaw)?.system_no ?? this._shipmentSm;
  }

  //  สแกนถุง (grade/lot) ใน step ตาราง — ไม่มี Shipment ให้เช็คแล้ว (bypass) รับทุกโค้ดที่ parse ผ่านตรงๆ
  private handleBagScan(code: string): void {
    const parsed = this.scanLogic.parseScanCode(code);
    if (!parsed) {
      Swal.fire({ icon: 'error', title: 'QR Code ไม่ถูกต้อง', text: 'กรุณาสแกน QR Code ถุงให้ถูกต้อง', confirmButtonColor: '#d92d20' });
      return;
    }

    const current = this._scannedBags();
    const newBag: ScannedBag = {
      id: current.length + 1,
      grade: parsed.grade,
      lot: parsed.lot,
      qty: 'None',
    };
    this._scannedBags.set([...current, newBag]);
  }

  removeBag(index: number) {
    this._scannedBags.update((bags) => bags.filter((_, i) => i !== index));
    if (this._scannedBags().length === 0) this._lockedDoNo = null;
  }

  //  เปิดคีย์แพดตัวเลขใส่/แก้ไขจำนวนถุงของแถวนี้ (แทน input ธรรมดา -> ไม่เรียก keyboard ระบบ)
  openQtyKeypad(index: number): void {
    const bag = this._scannedBags()[index];
    if (!bag) return;
    this._qtyKeypadIndex = index;
    this._qtyKeypadValue.set(bag.qty === 'None' ? '' : String(bag.qty));
    this._qtyKeypadShowModal.set(true);
  }

  closeQtyKeypad(): void {
    this._qtyKeypadShowModal.set(false);
    this._qtyKeypadIndex = null;
  }

  onQtyKeypadDigit(digit: string): void {
    const current = this._qtyKeypadValue();
    if (current.length >= this.QTY_KEYPAD_MAX_DIGITS) return;
    //  กันเลข 0 นำหน้า (เช่น "05") ยกเว้นค่าปัจจุบันเป็น "0" ตัวเดียว
    this._qtyKeypadValue.set(current === '0' ? digit : current + digit);
  }

  onQtyKeypadBackspace(): void {
    this._qtyKeypadValue.update((v) => v.slice(0, -1));
  }

  onQtyKeypadClear(): void {
    this._qtyKeypadValue.set('');
  }

  confirmQtyKeypad(): void {
    const index = this._qtyKeypadIndex;
    if (index === null) return;

    const parsedQty = parseInt(this._qtyKeypadValue(), 10);
    this._scannedBags.update((bags) => {
      const updated = [...bags];
      updated[index] = { ...updated[index], qty: !parsedQty || parsedQty <= 0 ? 'None' : parsedQty };
      return updated;
    });
    this.closeQtyKeypad();
  }

  //  ปุ่ม "แจ้งเปลี่ยนถุงแตก" -> POST api/v1/Process/broken-bag แล้วโหลดรายการใหม่
  _isSubmitting = false;
  confirmBrokenBag() {
    const bags = this._scannedBags();
    if (bags.length === 0 || this._isSubmitting || !this._reportLocation) return;

    const items: Type.CreateBrokenBagItem[] = bags.map((b) => ({
      grade: b.grade,
      lot: b.lot,
      qty: 0, // ยังไม่มีเครื่องชั่งใน flow นี้ ส่งน้ำหนัก 0 ไปก่อน
      bag: b.qty && b.qty !== 'None' ? Number(b.qty) : 0,
    }));

    if (items.some((i) => !i.bag || i.bag <= 0)) {
      Swal.fire({ icon: 'warning', title: 'กรุณาใส่จำนวนถุงให้ครบทุกรายการ', confirmButtonColor: '#f7bf2d' });
      return;
    }

    this._isSubmitting = true;
    this.crudService.CreateBrokenBag({
      reportLocationId: this._reportLocation.id,
      reportLocationType: this._reportLocation.type,
      sm: this.resolveShipmentSm(bags),
      doNo: this._lockedDoNo ?? '',
      items,
      createBy: this._currentUserId,
    }).subscribe({
      next: () => {
        this._isSubmitting = false;
        this.closeModal();
        Swal.fire({ icon: 'success', title: 'แจ้งเปลี่ยนถุงแตกสำเร็จ', confirmButtonColor: '#14a318', timer: 800 });
        this.loadBrokenBagList();
      },
      error: (err) => {
        this._isSubmitting = false;
        Swal.fire({
          icon: 'error',
          title: 'แจ้งเปลี่ยนถุงแตกไม่สำเร็จ',
          text: err?.error?.message ?? 'กรุณาลองใหม่อีกครั้ง',
          confirmButtonColor: '#d92d20',
        });
      },
    });
  }

  /*------------------ นำของขึ้นรถ (สแกน 1 ถุง + สแกนรถ — API เดียวกับหน้า /load-to-truck) ------------------*/
  onLoadToTruck(job: BrokenJob): void {
    if (!this.canLoadToTruck(job)) return;
    this._loadJob.set(job);
    this._loadStep.set('bag');
    this._loadScannedBags.set([]);
    this._loadScannerValue = '';
    this._loadIsScanning.set(false);
    this._loadManualMode = false;
    this._loadManualValue = '';
    this._loadShowModal.set(true);
  }

  closeLoadModal(): void {
    this._loadShowModal.set(false);
    this._loadIsScanning.set(false);
  }

  private focusLoadScanner(): void {
    if (this._loadManualMode) return;
    setTimeout(() => this.loadModalScannerInputRef?.nativeElement?.focus(), 0);
  }

  onLoadScanBtnClick(): void {
    this._loadIsScanning.set(true);
    this.focusLoadScanner();
  }

  onLoadToggleManual(checked: boolean): void {
    this._loadManualMode = checked;
    this._loadManualValue = '';
    this._loadIsScanning.set(false);
    if (!checked) this.focusLoadScanner();
  }

  onLoadSubmitManual(): void {
    const code = this._loadManualValue.trim();
    if (!code) return;
    this._loadScannerValue = code;
    this._loadManualValue = '';
    this.onLoadScannerEnter();
  }

  onLoadScannerEnter(): void {
    const code = this._loadScannerValue.trim();
    this._loadScannerValue = '';
    if (!code) return;
    if (!this._loadManualMode && !this._loadIsScanning()) return;

    if (this._loadStep() === 'bag') {
      this.handleLoadBagScan(code);
    } else {
      this._loadIsScanning.set(false);
      this.handleLoadTruckScan(code);
    }
  }

  //  สแกนถุง — เช็คระดับถุงจริง: โค้ดที่สแกนต้อง "ตรงกับถุงที่เปลี่ยนไว้แล้ว" (replaceItems.bag_qr_code) ของใบงานนี้เป๊ะๆ
  //  ไม่ตรงเลยคือไม่ใช่ถุงของใบงานนี้ ปฏิเสธทันที ต้องสแกนให้ครบทุกถุงถึงจะไปสแกนรถต่อได้ (_loadTargetCount)
  private handleLoadBagScan(code: string): void {
    const job = this._loadJob();
    if (!job) return;

    const trimmedCode = code.trim();
    const parsed = this.scanLogic.parseScanCode(trimmedCode);
    if (!parsed) {
      Swal.fire({ icon: 'error', title: 'QR Code ไม่ถูกต้อง', text: 'กรุณาสแกน QR Code ถุงให้ถูกต้อง', confirmButtonColor: '#d92d20' });
      this.focusLoadScanner();
      return;
    }

    if (!this.scanLogic.gradesMatch(parsed.grade, this._loadJobGrade()) || parsed.lot !== this._loadJobLot()) {
      Swal.fire({
        icon: 'error',
        title: 'Grade/Lot ไม่ตรงกับใบงาน',
        text: `ใบงานนี้ต้องเป็น Grade ${this._loadJobGrade()} Lot ${this._loadJobLot()} เท่านั้น`,
        confirmButtonColor: '#d92d20',
      });
      this.focusLoadScanner();
      return;
    }

    const isReplacedBag = (job.replaceItems ?? []).some((it) => (it.bag_qr_code ?? '').trim() === trimmedCode);
    if (!isReplacedBag) {
      Swal.fire({
        icon: 'error',
        title: 'ไม่ใช่ถุงของใบงานนี้',
        text: 'ถุงนี้ไม่ตรงกับรายการที่เปลี่ยนไว้ของใบงานนี้ กรุณาสแกนถุงที่ถูกต้อง',
        confirmButtonColor: '#d92d20',
      });
      this.focusLoadScanner();
      return;
    }

    if (this._loadScannedBags().some((b) => b.code === trimmedCode)) {
      Swal.fire({ icon: 'warning', title: 'ถุงนี้ถูกสแกนไปแล้ว', confirmButtonColor: '#f7bf2d' });
      this.focusLoadScanner();
      return;
    }

    this._loadScannedBags.update((bags) => [...bags, { palletId: parsed.palletId, grade: parsed.grade, lot: parsed.lot, code: trimmedCode }]);

    if (this._loadScannedComplete()) {
      this._loadStep.set('truck');
    }
    this.focusLoadScanner();
  }

  //  เช็คว่า item นี้ตรงกับ lot ที่ระบุไหม -> รองรับ addon_lot (item.lot_no ว่าง แต่มี lot อยู่ใน from_locations[].addon_lot แทน)
  //  (สำเนาเดียวกับ itemMatchesLot ของหน้า /load-to-truck — ไฟล์นั้นไม่ export ให้ใช้ร่วม)
  private itemMatchesLot(item: any, lot: string): boolean {
    const itemLotNo = String(item?.lot_no ?? '').trim();
    if (itemLotNo) return itemLotNo === lot;

    const fromLocations = item?.locations?.from_locations ?? [];
    return fromLocations.some((loc: any) => this.scanLogic.getLocationLots(loc).some((entry) => entry.lot === lot));
  }

  //  Location ต้นทางที่ส่งไปกับ Get -> BE เช็คโควต้าราย Location ต้องตรงกับ lot ของถุง ไม่ใช่ตัวแรกเสมอ
  //  ลำดับ: lot ตรง + ยังเหลือพอ (qty - actual_qty) -> lot ตรง -> ตัวแรก (สำเนาเดียวกับ resolveFromLocation ของหน้า /load-to-truck)
  private resolveFromLocation(item: any, lot: string, qty: number): any {
    const fromLocations: any[] = item?.locations?.from_locations ?? [];
    const lotMatched = String(item?.lot_no ?? '').trim()
      ? fromLocations
      : fromLocations.filter((loc: any) => this.scanLogic.getLocationLots(loc).some((entry) => entry.lot === lot));
    const hasRoom = (loc: any) => typeof loc.qty !== 'number' || loc.qty - (loc.actual_qty ?? 0) >= qty;

    return lotMatched.find(hasRoom) ?? lotMatched[0] ?? fromLocations[0];
  }

  //  await ได้ก่อนยิง put-away ต่อ (แนวทางเดียวกับหน้า /load-to-truck) -> คืน null = สำเร็จ, string = ข้อความ error จาก BE
  //  (ว่าง = BE ไม่ได้บอกเหตุผล) เอาไปต่อท้ายข้อความใน popup
  private async apiGetPallet(jobId: number, requestData: object): Promise<string | null> {
    try {
      await firstValueFrom(this.crudService.updateLoadingPalletGet(jobId, requestData));
      this.autoLogout.recordAction();   //  Get สำเร็จ = มีการทำงานจริง เริ่มนับ auto-logout ใหม่ (เหมือน ScanPalletApiService.callJobApi)
      return null;
    } catch (err: any) {
      return err?.error?.message ?? '';
    }
  }

  private async apiPutAwayPallet(jobId: number, requestData: object): Promise<string | null> {
    try {
      await firstValueFrom(this.crudService.updateLoadingPalletPutAway(jobId, requestData));
      this.autoLogout.recordAction();   //  Put สำเร็จ = มีการทำงานจริง เริ่มนับ auto-logout ใหม่
      return null;
    } catch (err: any) {
      return err?.error?.message ?? '';
    }
  }

  //  สแกน QR รถ -> หา Shipment (GetJobByLoadingTruck เหมือนหน้า /load-to-truck) -> ยิง get-pallet + put-away แบบหน้า /load-to-truck
  //  (payload กลุ่ม kilo: qrCodes + modeId 3 นับถุง + palletSeq, นับยอดเป็น กก.) ทีละพาเลทต้นทาง (ถุงจากพาเลทเดียวกันรวมเป็น
  //  Get/Put ครั้งเดียว เหมือน 1 การ์ดนับถุงของหน้า /load-to-truck ที่บังคับถุงพาเลทเดียวกัน) -> ครบทุกถุงแล้วเท่านั้นถึงปิดงาน
  //  (CompleteBrokenBag) modal นี้ต้องสแกนครบทุกถุงทุกครั้ง -> สแกนรถซ้ำหลังบางพาเลทผ่านไปแล้ว ต้องไม่ยิงซ้ำ:
  //  ถุงที่อยู่ใน complete_pallet ของงานโหลดแล้ว = ขึ้นรถแล้ว ข้ามเลย, อยู่ใน receive_pallet = Get ผ่านแต่ Put ไม่ผ่าน ยิงแค่ Put ด้วย seq เดิม
  //  รถ 1 คันมีงาน Loading ค้างได้หลายงาน -> แต่ละกลุ่มถุงหา item จากทุกงานของรถ (งาน id ล่าสุดก่อน) ไม่ใช่แค่ data[0]
  private async handleLoadTruckScan(scannedCode: string): Promise<void> {
    const bags = this._loadScannedBags();
    const job = this._loadJob();
    if (bags.length === 0 || !job || this._isSubmittingLoad) return;

    //  QR รถ -> รูป to_location_name (carrier|เลขทะเบียน) เหมือนหน้า /load-to-truck
    const truckCode = this.scanLogic.normalizeTruckQr(scannedCode);
    this._isSubmittingLoad = true;

    let truckJobs: any[];
    try {
      const res: any = await firstValueFrom(this.crudService.GetJobByLoadingTruck(truckCode));
      truckJobs = (res?.data ?? []).filter((j: any) => this.isJobOnTruck(j, truckCode));
    } catch {
      this._isSubmittingLoad = false;
      Swal.fire({ icon: 'error', title: 'ค้นหา Shipment ไม่สำเร็จ กรุณาลองใหม่', confirmButtonColor: '#d92d20' });
      this.focusLoadScanner();
      return;
    }

    if (truckJobs.length === 0) {
      this._isSubmittingLoad = false;
      Swal.fire({ icon: 'error', title: 'ไม่พบ Shipment ของรถคันนี้', confirmButtonColor: '#d92d20' });
      this.focusLoadScanner();
      return;
    }

    const hasCode = (pool: any[], code: string) => pool.find((p: any) => this.scanLogic.qrCodesMatch(p?.scanned_qr_code, code));
    const poolOf = (j: any, key: 'receive_pallet' | 'complete_pallet'): any[] => j.pallets?.[key] ?? [];
    const allComplete = truckJobs.flatMap((j) => poolOf(j, 'complete_pallet'));

    //  น้ำหนักต่อถุงจากรายการที่เปลี่ยนไว้ของใบงาน (replaceItems.qty) -> ใช้เช็คยอดคงเหลือ/ส่ง qty ตอน Put
    const bagKg = (code: string) => Number((job.replaceItems ?? []).find((it) => (it.bag_qr_code ?? '').trim() === code)?.qty) || 0;
    const remainingKg = (item: any) => (item.total_qty ?? 0) - (item.receive_qty ?? 0) - (item.complete_qty ?? 0);

    //  ตัวนับ pallet_seq แยกต่องาน แบบเดียวกับหน้า /load-to-truck: เริ่มจาก seq สูงสุดที่งานนั้นมีอยู่แล้ว (ตัด user_id ท้ายเลขออก)
    const seqCounters = new Map<number, number>(truckJobs.map((j) => [j.id, Math.floor(
      [...poolOf(j, 'receive_pallet'), ...poolOf(j, 'complete_pallet')].reduce((max: number, p: any) => Math.max(max, Number(p?.pallet_seq) || 0), 0)
        / LOADING_SEQ_USER_SUFFIX_RANGE,
    )]));

    //  ถุงที่ขึ้นรถไปแล้วจากรอบก่อน (อยู่ใน complete_pallet ของงานไหนก็ได้ของรถ) ไม่ต้องยิงซ้ำ ที่เหลือจัดกลุ่มตามพาเลทต้นทาง
    const pendingBags = bags.filter((b) => !hasCode(allComplete, b.code));
    const groups = new Map<string, LoadToTruckBag[]>();
    pendingBags.forEach((b) => groups.set(b.palletId, [...(groups.get(b.palletId) ?? []), b]));

    const failedReasons: string[] = [];
    let successCount = bags.length - pendingBags.length;

    for (const [palletId, groupBags] of groups) {
      const { grade, lot } = groupBags[0];
      const qrCodes = groupBags.map((b) => b.code);
      const qty = groupBags.reduce((sum, b) => sum + bagKg(b.code), 0);
      const label = `Pallet ${palletId} (${groupBags.length} ถุง)`;

      //  Get ผ่านไปแล้วรอบก่อนแต่ Put ไม่ผ่าน -> งานที่ถุงอยู่ใน receive_pallet + pallet_seq เดิม ยิงแค่ Put (ยอดถูกจองไว้แล้ว)
      const receivedJob = truckJobs.find((j) => qrCodes.some((c) => hasCode(poolOf(j, 'receive_pallet'), c)));
      const receivedSeq: number | undefined = receivedJob
        ? qrCodes.map((c) => hasCode(poolOf(receivedJob, 'receive_pallet'), c)).find((p) => !!p)?.pallet_seq
        : undefined;

      let rawJob: any = null;
      let matchedItem: any = null;
      for (const j of receivedJob ? [receivedJob] : truckJobs) {
        matchedItem = (j.items ?? []).find(
          (item: any) =>
            this.scanLogic.gradesMatch(item.grade, grade) &&
            this.itemMatchesLot(item, lot) &&
            this.isItemOnTruck(item, truckCode) &&
            (receivedSeq != null || remainingKg(item) >= qty),
        );
        if (matchedItem) { rawJob = j; break; }
      }

      if (!matchedItem) {
        failedReasons.push(`${label}: ไม่พบรายการที่ตรงกับถุงนี้ในรถคันนี้ หรือยอดคงเหลือไม่พอ`);
        continue;
      }

      const toLocation = matchedItem.locations?.to_locations?.find((loc: any) => this.scanLogic.normalizeTruckQr(loc.location_name) === truckCode);

      let palletSeq = receivedSeq;
      if (palletSeq == null) {
        const seqCounter = (seqCounters.get(rawJob.id) ?? 0) + 1;
        seqCounters.set(rawJob.id, seqCounter);
        palletSeq = seqCounter * LOADING_SEQ_USER_SUFFIX_RANGE + this._currentUserId;

        const fromLocation = this.resolveFromLocation(matchedItem, lot, qty);
        const getError = await this.apiGetPallet(rawJob.id, {
          qrCodes,
          itemId: matchedItem.id,
          locationId: fromLocation?.location_id ?? 0,
          locationType: rawJob.from_location_type ?? '-',
          palletSeq,
          modeId: 3,   //  นับถุง (Pick Bag) เหมือนการ์ดนับถุงของหน้า /load-to-truck
          updateBy: this._currentUserId,
        });
        if (getError !== null) {
          failedReasons.push(`${label}: บันทึกการหยิบถุง (Get) ไม่สำเร็จ${getError ? ` : ${getError}` : ''}`);
          continue;
        }

        //  กันกลุ่มถัดไปในลูปนี้จับคู่ item เดิมเกินยอดคงเหลือ + Location ต้นทางเดิมเกินที่ว่าง (ไม่ว่า Put จะผ่านไหม)
        matchedItem.receive_qty = (matchedItem.receive_qty ?? 0) + qty;
        if (fromLocation) fromLocation.actual_qty = (fromLocation.actual_qty ?? 0) + qty;
      }

      const putError = await this.apiPutAwayPallet(rawJob.id, {
        itemId: matchedItem.id,
        locationId: toLocation?.location_id ?? 0,
        locationType: rawJob.to_location_type ?? '-',
        palletId: Number(palletId) || 0,
        qty,
        palletSeq,
        qrCode: qrCodes[0],
        updateBy: this._currentUserId,
      });
      if (putError !== null) {
        failedReasons.push(`${label}: หยิบสำเร็จแต่บันทึกนำขึ้นรถ (Put-away) ไม่สำเร็จ${putError ? ` : ${putError}` : ''}`);
        continue;
      }

      successCount += groupBags.length;
    }

    if (failedReasons.length > 0) {
      this._isSubmittingLoad = false;
      Swal.fire({
        icon: 'error',
        title: `นำขึ้นรถสำเร็จ ${successCount} / ${bags.length} ถุง`,
        text: failedReasons.join('\n') + '\n\nกรุณาลองสแกน QR รถอีกครั้งสำหรับถุงที่เหลือ',
        confirmButtonColor: '#d92d20',
      });
      this.focusLoadScanner();
      return;
    }

    //  ทุกถุงนำขึ้นรถ (put-away) สำเร็จหมดแล้วเท่านั้น -> ยิงปิดงาน broken-bag ต่อ (broken-bag rawId ไม่ใช่ rawJob.id ของ shipment)
    try {
      await firstValueFrom(this.crudService.CompleteBrokenBag(job.rawId, { updateBy: this._currentUserId }));
      this._isSubmittingLoad = false;
      this._loadShowModal.set(false);
      Swal.fire({ icon: 'success', title: 'นำของขึ้นรถสำเร็จ', confirmButtonColor: '#14a318', timer: 900 });
      this.loadBrokenBagList();
    } catch {
      this._isSubmittingLoad = false;
      this._loadShowModal.set(false);
      Swal.fire({
        icon: 'warning',
        title: 'นำของขึ้นรถสำเร็จ แต่ปิดงานไม่สำเร็จ',
        text: 'กรุณาแจ้งผู้ดูแลระบบ',
        confirmButtonColor: '#f7bf2d',
      });
      this.loadBrokenBagList();
    }
  }
}
