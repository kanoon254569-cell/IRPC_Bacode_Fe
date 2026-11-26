import { Component, inject, signal, ViewChild, ElementRef, computed, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { BarcodeFormat } from '@zxing/library';
import { LoadingService } from '../../service/loading.service';
import { CrudService } from '../../service/crud.service';
import { ScanPalletLogicService } from '../../service/scan-pallet-logic.service';
import * as Type from '../../../models/variables-type';

//  ข้อมูลถุงที่ทุกฟอร์ม (Add / Replace / Edit) ต้องกรอกครบ = 5 ส่วนของ QR ถุง
//  cost_center|grade|lot|bag_no|pallet_running_no (Ton No.)
export interface BagKeyForm {
  costCenter: string;
  grade: string;
  lot: string;
  bagNo: string;
  tonNo: string;
}

export type BagKeyField = keyof BagKeyForm;

type ScanTarget = 'main' | 'add' | 'replace';

//  ถุงในรายการรอของ Add Bag -- fromPalletNo มีค่า = ถุงที่อยู่บนพาเลทอื่น (มาจากการสแกน QR พาเลท)
//  ตอนยืนยันต้องใช้ move-bag แทน add-bag (add-bag รับเฉพาะถุง orphan)
export type QueuedBag = Type.PalletManagementFoundBag & { fromPalletNo?: string };

@Component({
  selector: 'app-pallet-management',
  standalone: false,
  templateUrl: './pallet-management.html',
  styleUrl: './pallet-management.css',
})
export class PalletManagement implements AfterViewInit {
  private router = inject(Router);
  private loadingService = inject(LoadingService);
  private crudService = inject(CrudService);
  private scanLogic = inject(ScanPalletLogicService);

  //  การสแกนใช้รูปแบบเดียวกับหน้า scan-pallet: ช่อง input ซ่อน (inputmode=none ไม่เด้งคีย์บอร์ด)
  //  รับค่าจากปืนสแกน + ปุ่ม "กรุณากดปุ่มเพื่อสแกน" (เขียวกะพริบระหว่างรอ) + toggle "พิมพ์" สำหรับพิมพ์โค้ดเอง
  @ViewChild('_scanInput') _scanInput!: ElementRef;
  _isScanning = signal(false);
  _isManualInputMode = signal(false);
  _selectedBagIndex = signal<number>(0);

  //REPLACE MODAL STATE
  @ViewChild('_replaceScanInput') _replaceScanInput!: ElementRef;
  _showReplaceModal = signal(false);
  _isReplaceScanning = signal(false);
  _replaceScannedBag = signal<Type.PalletManagementFoundBag | null>(null);
  //  signal เหมือน _addBagForm (แอป zoneless) -- สแกนเสร็จแล้วเติมฟอร์มหลัง await ต้อง render ได้
  _replaceManualForm = signal<BagKeyForm>(this.emptyBagForm());
  //  ฟอร์มกรอกเองใน Replace พับไว้เป็นค่าเริ่มต้น -- สแกนก่อนเหมือน Add Bag
  _showReplaceManual = signal(false);

  // ADD / EDIT BAG MODAL STATE
  @ViewChild('_addScanInput') _addScanInput!: ElementRef;
  _showAddBagModal = signal(false);
  _isEditBagMode = signal(false);
  _isAddScanning = signal(false);
  //  เป็น signal -- แอปนี้ไม่มี zone.js (zoneless) ถ้าเป็น field ธรรมดาแล้วเปลี่ยนค่าหลัง await
  //  (เช่น สแกน QR แล้วเติมฟอร์ม) หน้าจอจะไม่ render ค่าใหม่
  _addBagForm = signal<BagKeyForm>(this.emptyBagForm());
  //  ถุงที่สแกนผ่านการตรวจแล้ว รอกด "ยืนยัน" เพื่อบันทึกเข้าพาเลทพร้อมกัน
  _addQueue = signal<QueuedBag[]>([]);
  //  ฟอร์มกรอกเองใน Add Bag พับไว้เป็นค่าเริ่มต้น -> รายการถุงที่สแกนได้พื้นที่เต็ม
  _showAddManual = signal(false);

  //  CAMERA SCAN STATE
  //  toggle "กล้อง" (ค่าเริ่มต้นตาม department, จำค่าที่สลับไว้ใน sessionStorage) -> ปุ่มสแกนหน้าหลัก / เพิ่มถุง / สลับ เปิดกล้องแทนการรอปืนสแกน
  //  ปืนสแกนยังใช้ได้ตามปกติตอนกล้องปิดอยู่
  private readonly CAMERA_MODE_KEY = '_PM_CAMERA_MODE';
  _isCameraMode = signal(this.readCameraMode());
  //  null = กล้องปิด / 'main' | 'add' | 'replace' = เปิดกล้องสแกนให้ช่องไหน
  _cameraTarget = signal<ScanTarget | null>(null);
  _cameraDevice = signal<MediaDeviceInfo | undefined>(undefined);
  _hasCamera = signal(false);
  _cameraBusy = signal(false);
  //  ผลล่าสุดในโหมดสแกนต่อเนื่อง (เพิ่มถุง) -- แสดงใต้ภาพกล้อง
  _cameraLastResult = signal<{ ok: boolean; text: string } | null>(null);
  readonly cameraFormats = [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128];
  private _cameraErrorShown = false;
  private _lastCameraCode = '';
  private _lastCameraAt = 0;
  //  โค้ดเดิมที่ยังอยู่หน้ากล้องไม่นับซ้ำ -- ต้องเอาออกจากกล้องเกินเวลานี้ก่อนถึงสแกนโค้ดเดิมได้อีก
  private readonly CAMERA_REPEAT_MS = 2500;

  protected readonly forkliftId = signal(sessionStorage.getItem('_FORKLIFT_ID') || 'FL-01');
  protected readonly forkliftIdNumber = computed(() => Number(this.forkliftId()) || 0);
  protected readonly selectedWarehouse = signal(sessionStorage.getItem('_SELECTED_WAREHOUSE') || 'WH-01');

  private readonly _currentUserId = Number(localStorage.getItem('userId')) || 0;

  _pallet = signal<Type.PalletManagementPallet | null>(null);
  _bagsList = signal<Type.PalletManagementBag[]>([]);
  _isPalletScanned = computed(() => !!this._pallet());
  //  Dummy Pallet (pallet_type 'D', PLDyyMMddNNNN -- Boardman sql/107_) พาเลทหมุนเวียนสำหรับเบิกของรายถุง
  //  รับของจาก Auto (QR ข้างถุง / QR พาเลท), Manual (QR พาเลท + จำนวนถุง), Dummy อื่น (QR พาเลท + จำนวนถุง)
  //  ไม่จำกัดจำนวนถุง (unit_pallet = NULL) แต่ต้อง Grade / Lot เดียวกัน -- ใช้ SP ของ dummy (sql/109_)
  _isDummyPallet = computed(() => !!this._pallet() && this.isDummyPallet(this._pallet()!));

  //  แถวบน dummy ที่เบิกจากพาเลท Manual ไม่มี QR ข้างถุงจริง (qr_text_data = ป้าย WMS+ ของพาเลท Manual)
  //  -> แก้ไข / สลับ / ดีดออก / ดึงออก ไม่ได้ (ดึงออกจะกลายเป็นถุง orphan ปลอม และน้ำหนักไม่คืนพาเลท Manual)
  _isSelectedBagLocked = computed(() => {
    const bag = this._bagsList()[this._selectedBagIndex()];
    return !!bag && this._isDummyPallet() && !this.isBagQr(bag.qr_text_data ?? '');
  });

  //  Pallet Ratio = จำนวนถุงสูงสุดต่อพาเลท (unit_pallet) -- 0/ไม่มีค่า = ไม่จำกัด
  _palletCapacity = computed(() => Number(this._pallet()?.unit_pallet) || 0);
  _addTotalCount = computed(() => this._bagsList().length + this._addQueue().length);
  _isAddFull = computed(() => this._palletCapacity() > 0 && this._addTotalCount() >= this._palletCapacity());

  _palletData = computed(() => {
    const pallet = this._pallet();
    return {
      number: pallet?.pallet_no ?? '-',
      grade: pallet?.grade ?? '-',
      lot: pallet?.lot ?? '-',
      //  น้ำหนักพาเลท
      //  Manual (PLM) = unit_ratio x unit_pallet (unit_pallet เก็บ qty รวมหลังรวมพาเลท -- SP 81)
      //  Auto         = ถุงที่อยู่จริง x unit_ratio (qty จาก SP 27)
      qty: !pallet ? '-'
        : this.isManualPallet(pallet)
          ? `${(Number(pallet.unit_ratio) || 0) * (Number(pallet.unit_pallet) || 0)}`
          : `${Number(pallet.qty) || 0}`
    };
  });

  _bagData = computed(() => {
    const bag = this._bagsList()[this._selectedBagIndex()];
    return bag
      ? {
        id: bag.id,
        costCenter: bag.cost_center || '-',
        runningNum: this.formatRunningNo(bag.bag_no),
        //  Ton No. จากคอลัมน์ (แก้ได้ผ่าน Edit) ถ้าว่างใช้จาก QR
        tonNo: bag.pallet_running_no ? this.formatTonNo(bag.pallet_running_no) : this.parseTonNo(bag.qr_text_data),
        grade: bag.grade,
        lot: bag.lot,
        //  พาเลท Manual (PLM): ถุงแทนทั้งพาเลท -> น้ำหนักถุง = น้ำหนักพาเลท (unit_pallet x unit_ratio)
        qty: this._pallet() && this.isManualPallet(this._pallet()!) ? this._palletData().qty : `${bag.qty}`,
        qrText: bag.qr_text_data || '-',
      }
      : { id: 0, costCenter: '-', runningNum: '-', tonNo: '-', grade: '-', lot: '-', qty: '-', qrText: '-' };
  });

  //  running pallet no (Ton No.) = ส่วนสุดท้ายของ QR ถุง cost_center|grade|lot|bag_no|pallet_running_no
  parseTonNo(qr: string | null | undefined): string {
    const parts = String(qr ?? '').split('|');
    return parts.length === 5 && parts[4].trim() ? parts[4].trim() : '-';
  }

  //  Ton No. ของถุงใน Bag List -- คอลัมน์ pallet_running_no ก่อน (แก้ได้ผ่าน Edit) ถ้าว่างใช้ส่วนสุดท้ายของ QR
  bagTonNo(bag: Type.PalletManagementBag): string {
    return bag.pallet_running_no ? this.formatTonNo(bag.pallet_running_no) : this.parseTonNo(bag.qr_text_data);
  }

  formatTonNo(tonNo: number | null | undefined): string {
    return tonNo ? String(tonNo).padStart(3, '0') : '-';
  }

  private emptyBagForm(): BagKeyForm {
    return { costCenter: '', grade: '', lot: '', bagNo: '', tonNo: '' };
  }

  //  ตรวจว่ากรอกครบทั้ง 5 ช่อง และรูปแบบตรงกับ QR ถุง -- คืนข้อความ error หรือ null ถ้าผ่าน
  private validateBagForm(form: BagKeyForm): string | null {
    const missing: string[] = [];
    if (!form.costCenter.trim()) missing.push('Cost Center');
    if (!form.grade.trim()) missing.push('Grade');
    if (!form.lot.trim()) missing.push('Lot');
    if (!form.bagNo.trim()) missing.push('Bag No.');
    if (!form.tonNo.trim()) missing.push('Running Pallet No. (Ton No.)');
    if (missing.length) return `กรุณากรอกให้ครบ: ${missing.join(', ')}`;

    if (!/^\d{1,4}$/.test(form.costCenter.trim())) return 'Cost Center ต้องเป็นตัวเลขไม่เกิน 4 หลัก';
    const bagNo = Number(form.bagNo);
    if (!/^\d+$/.test(form.bagNo.trim()) || bagNo < 1 || bagNo > 99) return 'Bag No. ต้องเป็นตัวเลข 1 - 99';
    const tonNo = Number(form.tonNo);
    if (!/^\d+$/.test(form.tonNo.trim()) || tonNo < 1 || tonNo > 999) return 'Running Pallet No. (Ton No.) ต้องเป็นตัวเลข 1 - 999';
    return null;
  }

  onBack() {
    this.router.navigate(['/system-menu']);
  }

  formatRunningNo(bagNo: number | null | undefined): string {
    return bagNo ? String(bagNo).padStart(2, '0') : '-';
  }

  private showError(title: string, err: any) {
    Swal.fire({
      icon: 'error',
      title,
      text: err?.error?.message ?? err?.message ?? 'กรุณาลองใหม่อีกครั้ง',
      confirmButtonColor: '#d32f2f',
    });
  }

  private showSuccess(text: string) {
    Swal.fire({ icon: 'success', title: 'Success', text, timer: 1200, showConfirmButton: false });
  }

  //  ─────────────────────────────────────────────────────────────
  //  SCANNER (รูปแบบเดียวกับหน้า scan-pallet)
  //  ─────────────────────────────────────────────────────────────
  private readonly INVALID_QR_MESSAGE = 'QR Code ไม่ถูกต้อง กรุณาสแกน QR Code ให้ถูกต้อง';

  private focusInput(ref?: ElementRef) {
    setTimeout(() => ref?.nativeElement?.focus(), 0);
  }

  //  QR ถุง: costCenter|grade|lot|bagNo|tonNo (ตรวจรูปแบบด้วย parser เดียวกับหน้า scan-pallet)
  private isBagQr(code: string): boolean {
    return this.scanLogic.parseScanCode(code) !== null;
  }

  //  หน้าหลัก รับได้ทั้ง QR ถุง, โค้ด PL<code>|grade|lot|qty และ Pallet No. (ขึ้นต้น PL เช่น PLA2609250001)
  private isPalletLookupCode(code: string): boolean {
    return this.isBagQr(code) || this.scanLogic.parseFullPalletScanCode(code) !== null || /^PL/i.test(code);
  }

  private showInvalidQr() {
    return Swal.fire({ icon: 'error', title: 'ข้อความจากระบบ', text: this.INVALID_QR_MESSAGE, confirmButtonColor: '#d32f2f' });
  }

  //  ─────────────────────────────────────────────────────────────
  //  AUTO-ARM SCANNER: ผู้ใช้ไม่ต้องกดปุ่มสแกนเอง
  //  'main' = ช่องสแกนหน้าหลัก, 'add' = ช่องสแกนใน modal Add Bag, 'replace' = ช่องสแกนถุงใหม่ใน modal Replace
  //  โฟกัสหลุด (popup / loading / แตะที่ว่าง) -> รอจน popup/loading ปิดแล้ว arm กลับให้เอง
  //  ยกเว้นผู้ใช้ไปแตะช่องพิมพ์อื่น (ค้นหา / ฟอร์ม) -> ปล่อยให้พิมพ์ ไม่แย่งโฟกัส
  //  ─────────────────────────────────────────────────────────────
  private canArm(target: ScanTarget): boolean {
    //  กล้องเปิดอยู่ -> ไม่ต้อง arm ช่องซ่อน (ปิดกล้องแล้วค่อย arm กลับใน closeCamera)
    if (this._cameraTarget()) return false;
    if (target === 'replace') return this._showReplaceModal();
    if (target === 'main') {
      return !this._isManualInputMode() && !this._showAddBagModal() && !this._showReplaceModal();
    }
    return this._showAddBagModal() && !this._isEditBagMode() && !this._isAddFull();
  }

  private isTypingField(el: Element | null): boolean {
    return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.classList.contains('hidden-scanner-field');
  }

  //  delay: เปิด modal ใหม่ต้องรอ render ก่อน (แอป zoneless) ไม่งั้นโฟกัส input ที่ยังซ่อนอยู่ไม่ติด
  private armWhenIdle(target: ScanTarget, delay = 0) {
    const tick = () => {
      if (!this.canArm(target)) return;
      if (Swal.isVisible() || this.loadingService.isShowing) {
        setTimeout(tick, 300);
        return;
      }
      if (this.isTypingField(document.activeElement)) return;
      this.scanFlag(target).set(true);
      this.scanInputRef(target)?.nativeElement?.focus();
    };
    setTimeout(tick, delay);
  }

  private scanInputRef(target: ScanTarget): ElementRef | undefined {
    return target === 'main' ? this._scanInput : target === 'add' ? this._addScanInput : this._replaceScanInput;
  }

  private scanFlag(target: ScanTarget) {
    return target === 'main' ? this._isScanning : target === 'add' ? this._isAddScanning : this._isReplaceScanning;
  }

  onScannerBlur(event: FocusEvent, target: ScanTarget) {
    this.scanFlag(target).set(false);
    if (this.isTypingField(event.relatedTarget as Element | null)) return;
    this.armWhenIdle(target);
  }

  // Scan QR CODE Default Page
  //  เข้าหน้านี้มาให้พร้อมสแกนได้ทันที ไม่ต้องกดปุ่มสแกนเองก่อน
  ngAfterViewInit(): void {
    this.onClickScanButton();
  }

  onClickScanButton() {
    this._isScanning.set(true);
    this.focusInput(this._scanInput);
  }

  //  ปุ่มสแกนหน้าหลัก: โหมดกล้อง -> เปิดกล้อง / ไม่ใช่ -> arm ช่องรับปืนสแกน
  onMainScanButton() {
    if (this._isCameraMode()) this.openCamera('main');
    else this.onClickScanButton();
  }

  onToggleManualInputMode(checked: boolean) {
    this._isManualInputMode.set(checked);
    this._isScanning.set(false);
    //  พิมพ์ กับ กล้อง เลือกได้ทีละอย่าง
    if (checked && this._isCameraMode()) this.setCameraMode(false);
    if (!checked) this.armWhenIdle('main', 150);
  }

  //  ─────────────────────────────────────────────────────────────
  //  CAMERA SCAN (zxing-scanner แบบเดียวกับแอป Checker)
  //  ผลสแกนจากกล้องเข้า logic เดียวกับปืนสแกน:
  //  'main' / 'replace' = สแกน 1 ครั้งแล้วปิดกล้อง, 'add' = สแกนต่อเนื่องจนกด "เสร็จสิ้น" หรือพาเลทเต็ม
  //  ─────────────────────────────────────────────────────────────
  //  ค่าเริ่มต้นตาม department ของ user ที่ login: PLBG = สแกนด้วยกล้อง / อื่นๆ = ปืนสแกนปกติ
  //  ถ้าผู้ใช้สลับ toggle เองแล้ว -> ใช้ค่านั้นตลอด session (login ใหม่ล้างค่า กลับไปใช้ค่าเริ่มต้น -- ดู login.component.ts)
  private readCameraMode(): boolean {
    try {
      const saved = sessionStorage.getItem(this.CAMERA_MODE_KEY);
      if (saved === 'Y' || saved === 'N') return saved === 'Y';
      const userInfo = JSON.parse(sessionStorage.getItem('_USER_INFO') || '{}');
      return String(userInfo?.department ?? '').trim().toUpperCase() === 'PLBG';
    } catch {
      return false;
    }
  }

  private setCameraMode(on: boolean) {
    this._isCameraMode.set(on);
    try {
      sessionStorage.setItem(this.CAMERA_MODE_KEY, on ? 'Y' : 'N');
    } catch { /* ignore */ }
  }

  onToggleCameraMode(checked: boolean) {
    this.setCameraMode(checked);
    if (checked && this._isManualInputMode()) {
      this._isManualInputMode.set(false);
      this.armWhenIdle('main', 150);
    }
  }

  openCamera(target: ScanTarget) {
    if (target === 'add' && this._isAddFull()) {
      this.showPalletFull();
      return;
    }
    this.scanFlag(target).set(false);
    (document.activeElement as HTMLElement | null)?.blur?.();
    this._hasCamera.set(false);
    this._cameraBusy.set(false);
    this._cameraLastResult.set(null);
    this._lastCameraCode = '';
    this._cameraTarget.set(target);
  }

  //  rearm = false: ผู้เรียกจะ arm ช่องสแกนเองหลังประมวลผลโค้ดเสร็จ
  closeCamera(rearm = true) {
    const target = this._cameraTarget();
    this._cameraTarget.set(null);
    this._cameraBusy.set(false);
    if (target && rearm) this.armWhenIdle(target, 150);
  }

  cameraTitle(target: ScanTarget): string {
    if (target === 'add') return 'สแกนถุงเพิ่มเข้าพาเลท (ต่อเนื่อง)';
    if (target === 'replace') return 'สแกน QR ถุงใหม่ที่จะนำมาสลับ';
    return 'สแกน QR ถุง / Pallet';
  }

  //  เลือกกล้องหลังถ้ามี (ชื่อมี back / rear) ไม่งั้นใช้ตัวสุดท้าย
  onCamerasFound(devices: MediaDeviceInfo[]) {
    const videoDevices = devices.filter((d) => d.kind === 'videoinput');
    this._hasCamera.set(videoDevices.length > 0);
    const back = videoDevices.find((d) => /back|rear|environment/i.test(d.label));
    this._cameraDevice.set(back ?? videoDevices[videoDevices.length - 1]);
  }

  //  ไม่มีกล้อง / ไม่อนุญาต / กล้องถูกใช้อยู่ -- กัน ngx-scanner retry แล้ว alert ซ้อน
  onCamerasNotFound() {
    this._hasCamera.set(false);
    if (this._cameraErrorShown) return;
    this._cameraErrorShown = true;
    Swal.fire({
      icon: 'error',
      title: 'ไม่สามารถเปิดกล้องได้',
      text: 'ไม่พบกล้อง ยังไม่ได้อนุญาตให้เว็บไซต์เข้าถึงกล้อง หรือกล้องถูกใช้งานอยู่โดยแอปอื่น กรุณาลองใหม่ หรือใช้ปืนสแกนแทน',
      confirmButtonColor: '#d32f2f',
    }).then(() => {
      this._cameraErrorShown = false;
      this.closeCamera();
    });
  }

  async onCameraScan(result: string) {
    const code = (result ?? '').trim();
    const target = this._cameraTarget();
    if (!code || !target) return;

    //  กล้องอ่านโค้ดเดิมซ้ำทุกเฟรม -- นับเวลาจากครั้งล่าสุดที่เห็น (โค้ดค้างหน้ากล้อง = ไม่นับซ้ำ)
    const now = Date.now();
    const isRepeat = code === this._lastCameraCode && now - this._lastCameraAt < this.CAMERA_REPEAT_MS;
    this._lastCameraCode = code;
    this._lastCameraAt = now;
    if (isRepeat || this._cameraBusy() || Swal.isVisible() || this.loadingService.isShowing) return;

    navigator.vibrate?.(80);

    if (target === 'add') {
      this._cameraBusy.set(true);
      let ok = false;
      try {
        ok = await this.handleAddCode(code);
      } finally {
        this._cameraBusy.set(false);
        //  เริ่มนับซ้ำใหม่หลังประมวลผลเสร็จ (API อาจใช้เวลานานกว่า CAMERA_REPEAT_MS)
        this._lastCameraAt = Date.now();
      }
      this._cameraLastResult.set({ ok, text: ok ? `เพิ่มเข้ารายการแล้ว: ${code}` : `ไม่ได้เพิ่ม: ${code}` });
      //  ครบ Pallet Ratio แล้ว -> ปิดกล้องกลับไปที่ modal ให้กดยืนยัน
      if (this._isAddFull()) this.closeCamera(false);
      return;
    }

    this.closeCamera(false);
    if (target === 'main') await this.handlePalletCode(code);
    else await this.handleReplaceCode(code);
  }

  //  ปืนสแกนยิงโค้ดเข้าช่องซ่อน + Enter
  async onScannerEnter(input: HTMLInputElement) {
    const code = (input.value ?? '').trim();
    input.value = '';
    if (!code || !this._isScanning()) return;
    await this.handlePalletCode(code);
  }

  //  โหมดพิมพ์: ยืนยันโค้ดที่พิมพ์เอง -> logic เดียวกับสแกนจริง
  async onSubmitManualInput(input: HTMLInputElement) {
    const code = (input.value ?? '').trim();
    if (!code) return;
    input.value = '';
    await this.handlePalletCode(code);
  }

  //  สแกน QR ถุงบนพาเลท หรือ pallet_no -> โหลดข้อมูลพาเลท + รายการถุง
  private async handlePalletCode(code: string) {
    if (!this.isPalletLookupCode(code)) {
      this._isScanning.set(false);
      this.showInvalidQr();
      this.armWhenIdle('main');
      return;
    }

    this._searchCode = code;
    await this.searchPallet(code);
    //  loading dialog / popup error ขโมยโฟกัสไประหว่างโหลด -> arm กลับเองเมื่อปิดหมด (สแกนพาเลทถัดไปได้เลย)
    this.armWhenIdle('main');
  }

  //  ช่องค้นหา + ปุ่มค้นหา: ค้นด้วย QR ถุง หรือ Pallet No.
  _searchCode = '';
  //  โค้ดล่าสุดที่ค้นสำเร็จ (QR ถุง หรือ Pallet No.) -- ใช้กับปุ่ม Refresh
  private _lastSearchCode = '';

  async onSearchPallet() {
    const code = this._searchCode.trim();
    if (!code) {
      Swal.fire({ icon: 'warning', title: 'กรุณากรอก QR ถุง หรือ Pallet No.', confirmButtonColor: '#283593' });
      return;
    }
    await this.searchPallet(code);
  }

  private async searchPallet(code: string): Promise<boolean> {
    const loaded = await this.loadPallet(code);
    if (loaded) {
      this._lastSearchCode = code;
      //  ค้นด้วย QR ถุง -> เลือก + เลื่อนไปที่ถุงนั้นใน Bag List ทันที (ค้นด้วย Pallet No. -> ถุงแรก)
      const bagIndex = this.isBagQr(code) ? this.findBagIndexByQr(code) : -1;
      this._selectedBagIndex.set(bagIndex > -1 ? bagIndex : 0);
      if (bagIndex > -1) this.scrollToBag(bagIndex);
    }
    return loaded;
  }

  //  หา index ถุงใน Bag List จาก QR ถุง -- เทียบ qr_text_data ก่อน ถ้าไม่ตรง (เช่น แก้ข้อมูลผ่าน Edit แล้ว)
  //  เทียบทีละส่วน cost_center|grade|lot|bag_no|ton_no แทน
  private findBagIndexByQr(code: string): number {
    const normalize = (s: string | null | undefined) =>
      String(s ?? '').split('|').map((p) => p.trim()).join('|').toUpperCase();
    const target = normalize(code);
    const bags = this._bagsList();

    const exact = bags.findIndex((b) => normalize(b.qr_text_data) === target);
    if (exact > -1) return exact;

    const parsed = this.scanLogic.parseScanCode(code);
    if (!parsed) return -1;
    return bags.findIndex((b) =>
      String(b.cost_center ?? '').trim() === parsed.costCenter &&
      String(b.grade ?? '').trim().toUpperCase() === parsed.grade.toUpperCase() &&
      String(b.lot ?? '').trim().toUpperCase() === parsed.lot.toUpperCase() &&
      Number(b.bag_no) === Number(parsed.runningNo) &&
      Number(this.bagTonNo(b)) === Number(parsed.palletId)
    );
  }

  //  ถุงที่สแกน (QR) หรือกรอกเอง (ฟอร์ม 5 ช่อง) อยู่บนพาเลทที่เปิดอยู่หรือไม่ -- คืน index ใน Bag List หรือ -1
  private findBagIndexOnPallet(qrCode: string, form?: BagKeyForm): number {
    if (qrCode) return this.findBagIndexByQr(qrCode);
    if (!form || this.validateBagForm(form)) return -1;
    const code = [form.costCenter, form.grade, form.lot,
      this.formatRunningNo(Number(form.bagNo)), this.formatTonNo(Number(form.tonNo))].map((p) => p.trim()).join('|');
    return this.findBagIndexByQr(code);
  }

  //  รอ Bag List render ก่อน (แอป zoneless) แล้วเลื่อนให้ถุงที่เลือกอยู่กลางรายการ
  private scrollToBag(index: number) {
    setTimeout(() => {
      document.querySelector(`.bag-item[data-bag-index="${index}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  //  keepBagId: เลือกถุงเดิมไว้หลังโหลดใหม่ (หลัง Edit/Replace)
  //  showError = false: ไม่ขึ้น alert เมื่อไม่พบ (ให้ผู้เรียก fallback เอง)
  private async loadPallet(code: string, keepBagId?: number, showError = true): Promise<boolean> {
    this.loadingService.show('กำลังโหลดข้อมูล...');
    try {
      const res = await firstValueFrom(this.crudService.GetPalletManagement(code));
      const pallet = res.data?.pallet ?? null;
      if (!pallet) throw { message: res.message || 'ไม่พบข้อมูลพาเลท' };

      this._pallet.set(pallet);
      this._bagsList.set(res.data?.bags ?? []);

      if (keepBagId) {
        const index = this._bagsList().findIndex((b) => b.id === keepBagId);
        this._selectedBagIndex.set(index > -1 ? index : 0);
      } else if (this._selectedBagIndex() >= this._bagsList().length) {
        this._selectedBagIndex.set(Math.max(0, this._bagsList().length - 1));
      }
      return true;
    } catch (err) {
      if (showError) this.showError('ไม่พบข้อมูลพาเลท', err);
      return false;
    } finally {
      this.loadingService.hide();
    }
  }

  private reloadPallet(keepBagId?: number) {
    const pallet = this._pallet();
    if (pallet) return this.loadPallet(pallet.pallet_no, keepBagId);
    return Promise.resolve(false);
  }

  //  ปุ่ม Refresh -- ค้นใหม่ด้วยโค้ดในช่องค้นหา (QR ถุง หรือ Pallet No.) ถ้าว่างใช้โค้ดล่าสุดที่ค้นสำเร็จ
  //  คงถุงที่เลือกไว้ (ถ้ายังอยู่บนพาเลท) -- ถ้าค้นด้วยโค้ดนั้นไม่เจอแล้ว (เช่น ถุงที่สแกนถูก Replace ออกไป)
  //  fallback โหลดพาเลทที่แสดงอยู่ด้วย pallet_no แทน
  async onRefreshPallet() {
    const code = this._searchCode.trim() || this._lastSearchCode;
    const bagId = this._bagData().id || undefined;
    const pallet = this._pallet();

    if (!code) {
      await this.reloadPallet(bagId);
      return;
    }

    //  fallback เฉพาะตอน refresh โค้ดเดิม -- ถ้าพิมพ์โค้ดใหม่แล้วไม่พบ ให้แจ้ง error ตามปกติ
    const isSameCode = !!pallet && code === this._lastSearchCode;
    const loaded = await this.loadPallet(code, bagId, !isSameCode);
    if (loaded) {
      this._lastSearchCode = code;
    } else if (isSameCode && pallet) {
      await this.loadPallet(pallet.pallet_no, bagId);
    }
  }

  // Select Bag In Bag List
  selectBag(index: number) {
    this._selectedBagIndex.set(index);
  }

  //  หาถุง orphan: สแกน QR หรือกรอกเองครบ 5 ช่อง -- throw พร้อม message ถ้าไม่ครบ/ไม่พบ/ใช้ไม่ได้
  //  swapPalletId > 0 (Replace/สลับ): รับถุงที่อยู่บนพาเลทอื่นได้ด้วย ยกเว้นพาเลทนี้
  private async findBag(qrCode: string, form?: BagKeyForm, swapPalletId = 0): Promise<Type.PalletManagementFoundBag> {
    let res: Type.ResponsePalletManagementFindBag;
    if (qrCode) {
      res = await firstValueFrom(this.crudService.FindPalletManagementBag(qrCode, '', '', '', 0, 0, swapPalletId));
    } else {
      const invalid = this.validateBagForm(form ?? this.emptyBagForm());
      if (invalid) throw { message: invalid };
      res = await firstValueFrom(this.crudService.FindPalletManagementBag(
        '', form!.costCenter.trim(), form!.grade.trim(), form!.lot.trim(), Number(form!.bagNo), Number(form!.tonNo), swapPalletId,
      ));
    }
    if (!res.data) throw { message: res.message || 'ไม่พบถุงนี้ในระบบ' };
    return res.data;
  }

  //  แจ้งเตือนเมื่อ Grade/Lot ของถุงที่จะนำมาใช้ไม่ตรงกับของเดิม -- true = ผู้ใช้ยืนยันทำต่อ (หรือตรงกันอยู่แล้ว)
  //  รายการ Grade/Lot ที่ไม่ตรงกัน (เทียบแบบ trim + ไม่สนตัวพิมพ์) -- ว่าง = ตรงกันทั้งคู่
  private gradeLotDiffs(target: { grade: string; lot: string }, bag: { grade: string; lot: string }): string[] {
    const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
    const diffs: string[] = [];
    if (norm(target.grade) !== norm(bag.grade)) diffs.push(`Grade: ${target.grade || '-'} → ${bag.grade || '-'}`);
    if (norm(target.lot) !== norm(bag.lot)) diffs.push(`Lot: ${target.lot || '-'} → ${bag.lot || '-'}`);
    return diffs;
  }

  private async confirmGradeLotMismatch(
    target: { grade: string; lot: string },
    bag: { grade: string; lot: string },
    targetLabel: string,
  ): Promise<boolean> {
    const diffs = this.gradeLotDiffs(target, bag);
    if (diffs.length === 0) return true;

    const result = await Swal.fire({
      icon: 'warning',
      title: `Grade/Lot ไม่ตรงกับ${targetLabel}`,
      html: `${diffs.join('<br>')}<br><br>ต้องการดำเนินการต่อหรือไม่?`,
      showCancelButton: true,
      confirmButtonText: 'ดำเนินการต่อ',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#f59e0b',
      cancelButtonColor: '#888888',
      reverseButtons: true,
    });
    return result.isConfirmed;
  }

  // REPLACE MODAL METHODS

  openReplaceModal() {
    if (!this._bagData().id) return;
    const pallet = this._pallet();
    this._replaceManualForm.set({ ...this.emptyBagForm(), costCenter: pallet?.cost_center ?? '', grade: pallet?.grade ?? '', lot: pallet?.lot ?? '' });
    this._replaceScannedBag.set(null);
    this._showReplaceManual.set(false);
    this._showReplaceModal.set(true);
    //  เปิดมาพร้อมสแกนถุงใหม่ทันที ไม่ต้องกดปุ่มสแกนเอง (เหมือน Add Bag)
    this.armWhenIdle('replace', 150);
  }

  closeReplaceModal() {
    if (this._cameraTarget() === 'replace') this.closeCamera(false);
    this._showReplaceModal.set(false);
    this._isReplaceScanning.set(false);
    this._replaceScannedBag.set(null);
    this.armWhenIdle('main', 150);
  }

  onReplaceScanQr() {
    this._isReplaceScanning.set(true);
    this.focusInput(this._replaceScanInput);
  }

  //  สแกน QR ถุงใหม่ที่จะนำมา Replace -- ต้องเป็นรูปแบบ QR ถุงเท่านั้น (เหมือนหน้า scan-pallet)
  async processReplaceScan(value: string, inputElement: HTMLInputElement) {
    const code = (value ?? '').trim();
    inputElement.value = '';
    if (!code || !this._isReplaceScanning()) return;

    this._isReplaceScanning.set(false);
    await this.handleReplaceCode(code);
  }

  //  ใช้ร่วมกันทั้งปืนสแกนและกล้อง
  private async handleReplaceCode(code: string) {
    if (!this.isBagQr(code)) {
      this.showInvalidQr();
    } else {
      await this.resolveReplaceBag(code);
    }
    //  arm กลับหลัง popup/loading ปิด -- สแกนถุงอื่นแทนได้ทันทีถ้าถุงแรกใช้ไม่ได้
    this.armWhenIdle('replace');
  }

  //  ปุ่มสแกนถุงใหม่ใน modal สลับ: โหมดกล้อง -> เปิดกล้อง
  onReplaceScanButton() {
    if (this._isCameraMode()) this.openCamera('replace');
    else this.onReplaceScanQr();
  }

  //  กรอกข้อมูลถุงใหม่เอง -- ต้องครบ Cost Center, Grade, Lot, Bag No., Ton No.
  async onReplaceManualSearch() {
    await this.resolveReplaceBag('', this._replaceManualForm());
    this.armWhenIdle('replace');
  }

  //  แก้ช่องใดหลังพบถุงแล้ว -> ล้างถุงที่พบ ต้องค้นหา/สแกนใหม่ก่อน Replace (กันยืนยันถุงที่ไม่ตรงกับฟอร์ม)
  onReplaceFormInput(field: BagKeyField, value: string) {
    this._replaceManualForm.update((form) => ({ ...form, [field]: value }));
    this._replaceScannedBag.set(null);
  }

  private async resolveReplaceBag(qrCode: string, form?: BagKeyForm) {
    //  ถุงใหม่ต้องไม่อยู่บนพาเลทเดียวกัน -- เช็คจาก Bag List ก่อนยิง API ได้ข้อความที่ชัดกว่า
    //  (API เองก็ไม่ให้ใช้ถุงที่อยู่บนพาเลทใดๆ อยู่แล้ว: pProcessPalletMgmtFindBag รับเฉพาะถุง orphan)
    const sameIndex = this.findBagIndexOnPallet(qrCode, form);
    if (sameIndex > -1) {
      this._replaceScannedBag.set(null);
      const same = this._bagsList()[sameIndex];
      Swal.fire({
        icon: 'warning',
        title: 'ไม่สามารถสลับได้',
        text: `ถุงนี้ (ถุงที่ ${this.formatRunningNo(same.bag_no)}) อยู่ในพาเลท ${this._pallet()?.pallet_no ?? ''} เดียวกันอยู่แล้ว กรุณาสแกนถุงที่ไม่อยู่ในพาเลทนี้`,
        confirmButtonColor: '#283593',
      });
      return;
    }

    this.loadingService.show('กำลังค้นหาถุง...');
    try {
      //  สลับได้ทั้งถุง orphan และถุงจากพาเลทอื่น (ห้ามพาเลทเดียวกัน -- API เช็คซ้ำอีกชั้น)
      const bag = await this.findBag(qrCode, form, this._pallet()?.id ?? 0);
      this._replaceScannedBag.set(bag);
      //  เติมฟอร์มให้ครบทุกช่อง -- ค่าจาก API ก่อน ถ้าว่างใช้ส่วนของ QR ที่สแกน
      const qr = qrCode ? qrCode.split('|').map((p) => p.trim()) : [];
      const fromQr = qr.length === 5 ? qr : ['', '', '', '', ''];
      this._replaceManualForm.set({
        costCenter: bag.cost_center || fromQr[0],
        grade: bag.grade || fromQr[1],
        lot: bag.lot || fromQr[2],
        bagNo: bag.bag_no ? this.formatRunningNo(bag.bag_no) : fromQr[3],
        tonNo: bag.pallet_running_no ? this.formatTonNo(bag.pallet_running_no) : fromQr[4],
      });
    } catch (err) {
      this._replaceScannedBag.set(null);
      this.showError('ไม่สามารถใช้ถุงนี้ได้', err);
    } finally {
      this.loadingService.hide();
    }
  }

  async onConfirmReplace() {
    const pallet = this._pallet();
    const oldBag = this._bagData();
    const newBag = this._replaceScannedBag();
    if (!pallet || !oldBag.id || !newBag) return;

    if (!(await this.confirmGradeLotMismatch(oldBag, newBag, 'ถุงเดิม'))) return;

    //  ถุงใหม่อยู่บนพาเลทอื่น -> สลับที่กันจริง ถุงเดิมต้องย้ายไปพาเลทนั้นด้วย ให้ผู้ใช้ยืนยันก่อน
    if (newBag.pallet_no) {
      const result = await Swal.fire({
        icon: 'question',
        title: 'ยืนยันสลับถุงข้ามพาเลท',
        html: `ถุงใหม่อยู่บนพาเลท <b>${newBag.pallet_no}</b><br>`
          + `ถุงเดิม (ถุงที่ ${oldBag.runningNum}) จะย้ายไปอยู่พาเลท <b>${newBag.pallet_no}</b> แทน<br><br>ต้องการสลับหรือไม่?`,
        showCancelButton: true,
        confirmButtonText: 'ยืนยันสลับ',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#8e24aa',
        cancelButtonColor: '#888888',
        reverseButtons: true,
      });
      if (!result.isConfirmed) {
        this.armWhenIdle('replace');
        return;
      }
    }

    this.loadingService.show('กำลังบันทึก...');
    try {
      await firstValueFrom(this.crudService.ReplacePalletManagementBag({
        palletId: pallet.id,
        oldBagId: oldBag.id,
        newBagId: newBag.id,
        reason: 'Replace bag (Forklift PWA)',
        userId: this._currentUserId,
      }));
      this.loadingService.hide();
      this.closeReplaceModal();
      await this.reloadPallet(newBag.id);
      this.showSuccess(newBag.pallet_no ? `สลับถุงกับพาเลท ${newBag.pallet_no} สำเร็จ` : 'เปลี่ยนถุงสำเร็จ');
    } catch (err) {
      this.loadingService.hide();
      this.showError('เปลี่ยนถุงไม่สำเร็จ', err);
    }
  }

  //  ปุ่ม ดีดออก (Reject, เลื่อนถุง) -- ทำงานเหมือนปุ่ม "ถุง Reject" หน้า Pallet Adjustment (Boardman):
  //  ถุงที่เลือก -> Reject (is_active='R') แล้ว auto-matching จัดลำดับใหม่ทันที = ถุงถัดไปเลื่อนขึ้นมาแทน
  async onRejectBag() {
    const bag = this._bagData();
    if (!bag.id) return;

    const { value: reason, isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: 'ยืนยันการดีดถุงออก',
      html: `ต้องการดีดถุง <b>${bag.grade} | ${bag.lot} | Bag ${bag.runningNum} | Ton ${bag.tonNo}</b> ออกหรือไม่?<br/>`
        + 'ถุงจะถูก Reject และปลดออกจากพาเลท ถุงถัดไปจะเลื่อนขึ้นมาแทน',
      input: 'text',
      inputLabel: 'เหตุผล (ไม่บังคับ)',
      inputValue: 'ถุง reject',
      showCancelButton: true,
      confirmButtonText: 'ยืนยันดีดออก',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#ef6c00',
      cancelButtonColor: '#888888',
      reverseButtons: true,
      //  กว้าง 75% เท่า modal Edit / Replace (ดู .pm-swal-wide ใน styles.css)
      width: '75vw',
      customClass: { popup: 'pm-swal-wide' },
    });
    if (!isConfirmed) return;

    this.loadingService.show('กำลังดีดถุงออก...');
    try {
      await firstValueFrom(this.crudService.RejectPalletManagementBag({
        bagId: bag.id,
        reason: (reason ?? '').trim() || undefined,
        userId: this._currentUserId,
      }));
      this.loadingService.hide();
      //  โหลดพาเลทใหม่ -- คงตำแหน่งที่เลือกไว้ (ตอนนี้คือถุงที่เลื่อนขึ้นมาแทน)
      await this.reloadPallet();
      this.showSuccess('ดีดถุงออกสำเร็จ');
    } catch (err) {
      this.loadingService.hide();
      this.showError('ดีดถุงออกไม่สำเร็จ', err);
    }
  }

  //  ปุ่ม ดึงออก (Remove, ไม่เลื่อนถุง) -- ทำงานเหมือนปุ่ม "ดึงถุงออกจากพาเลท" หน้า Pallet Adjustment (Boardman):
  //  ถุงที่เลือก -> Orphan Bag แล้วเรียงเลขถุงที่เหลือในพาเลทใหม่ 1..n
  async onRemoveBag() {
    const bag = this._bagData();
    const pallet = this._pallet();
    if (!bag.id || !pallet) return;

    const confirm = await Swal.fire({
      icon: 'question',
      title: 'ยืนยันการดึงถุงออกจากพาเลท',
      html: `ต้องการดึงถุง <b>${bag.grade} | ${bag.lot} | Bag ${bag.runningNum} | Ton ${bag.tonNo}</b> ออกจากพาเลท <b>${pallet.pallet_no}</b> หรือไม่?<br/>`
        + 'ถุงจะถูกย้ายไปเป็นถุงที่ยังไม่ผูกพาเลท',
      showCancelButton: true,
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#d32f2f',
      cancelButtonColor: '#888888',
      reverseButtons: true,
      //  กว้าง 75% เท่า modal Edit / Replace (ดู .pm-swal-wide ใน styles.css)
      width: '75vw',
      customClass: { popup: 'pm-swal-wide' },
    });
    if (!confirm.isConfirmed) return;

    this.loadingService.show('กำลังดึงถุงออกจากพาเลท...');
    try {
      await firstValueFrom(this.crudService.PullOutPalletManagementBag({
        bagId: bag.id,
        userId: this._currentUserId,
      }));
      this.loadingService.hide();
      await this.reloadPallet();
      this.showSuccess('ดึงถุงออกจากพาเลทสำเร็จ');
    } catch (err) {
      this.loadingService.hide();
      this.showError('ดึงถุงออกจากพาเลทไม่สำเร็จ', err);
    }
  }

  //  ปุ่ม ล้างพาเลท (เฉพาะ Dummy Pallet) -- ทำงานเหมือนปุ่มล้างพาเลทแท็บ Dummy Pallet (Boardman):
  //  ถุงทุกใบบนพาเลทถูกปลด + ปิดใช้งาน แล้วพาเลทกลับ Bagging Area ให้ใช้กับ Grade / Lot อื่นได้
  async onClearDummyPallet() {
    const pallet = this._pallet();
    if (!pallet || !this.isDummyPallet(pallet)) return;

    const bagCount = this._bagsList().length;
    const confirm = await Swal.fire({
      icon: 'warning',
      title: 'ยืนยันการล้างพาเลท',
      html: `ต้องการล้าง Dummy Pallet <b>${pallet.pallet_no}</b> หรือไม่?<br/>`
        + (bagCount > 0
          ? `ถุงบนพาเลท ${bagCount} ถุง${pallet.grade ? ` (${pallet.grade} / ${pallet.lot})` : ''} จะถูกปลดออกและปิดใช้งาน<br/>`
          : '')
        + 'พาเลทจะกลับไปอยู่ Bagging Area',
      showCancelButton: true,
      confirmButtonText: 'ยืนยันล้างพาเลท',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#6d4c41',
      cancelButtonColor: '#888888',
      reverseButtons: true,
      //  กว้าง 75% เท่า modal Edit / Replace (ดู .pm-swal-wide ใน styles.css)
      width: '75vw',
      customClass: { popup: 'pm-swal-wide' },
    });
    if (!confirm.isConfirmed) return;

    this.loadingService.show('กำลังล้างพาเลท...');
    try {
      await firstValueFrom(this.crudService.ClearPalletManagementDummy({
        palletId: pallet.id,
        userId: this._currentUserId,
      }));
      this.loadingService.hide();
      await this.reloadPallet();
      this.showSuccess(`ล้างพาเลท ${pallet.pallet_no} สำเร็จ`);
    } catch (err) {
      this.loadingService.hide();
      this.showError('ล้างพาเลทไม่สำเร็จ', err);
    }
  }

  // ADD / EDIT BAG MODAL METHODS
  //  Add Bag: สแกนถุงทีละใบต่อเนื่อง (scanner arm เองตลอด) -> ผ่านเช็ค Grade/Lot ตรงกับพาเลท + ไม่เกิน pallet ratio
  //  ค่อยเข้ารายการรอ -> กด "ยืนยัน" ทีเดียวถึงบันทึกเข้าพาเลทจริงครบทุกใบ
  openAddBagModal() {
    const pallet = this._pallet();
    if (!pallet) return;
    this._isEditBagMode.set(false);
    this._addQueue.set([]);
    this._showAddManual.set(false);
    this.resetAddManualForm();
    this._showAddBagModal.set(true);
    if (this._isAddFull()) {
      this.showPalletFull();
      return;
    }
    this.armWhenIdle('add', 150);
  }

  openEditBagModal() {
    const currentBag = this._bagData();
    if (!currentBag.id) return;
    this._isEditBagMode.set(true);
    this._addBagForm.set({
      costCenter: currentBag.costCenter === '-' ? '' : currentBag.costCenter,
      grade: currentBag.grade,
      lot: currentBag.lot,
      bagNo: currentBag.runningNum === '-' ? '' : currentBag.runningNum,
      tonNo: currentBag.tonNo === '-' ? '' : currentBag.tonNo,
    });
    this._showAddBagModal.set(true);
  }

  //  ปิด modal Add ทั้งที่ยังมีถุงในรายการรอ -> ถามก่อน (ถุงที่สแกนไว้ยังไม่ถูกบันทึก)
  async closeAddBagModal() {
    const pending = this._addQueue().length;
    if (!this._isEditBagMode() && pending > 0) {
      const result = await Swal.fire({
        icon: 'warning',
        title: 'ยกเลิกการเพิ่มถุง?',
        text: `ถุงที่สแกนไว้ ${pending} ถุงยังไม่ถูกบันทึกเข้าพาเลท`,
        showCancelButton: true,
        confirmButtonText: 'ยกเลิกทั้งหมด',
        cancelButtonText: 'สแกนต่อ',
        confirmButtonColor: '#d32f2f',
        cancelButtonColor: '#888888',
        reverseButtons: true,
      });
      if (!result.isConfirmed) {
        this.armWhenIdle('add');
        return;
      }
    }
    if (this._cameraTarget() === 'add') this.closeCamera(false);
    this._showAddBagModal.set(false);
    this._isAddScanning.set(false);
    this._addQueue.set([]);
    this.armWhenIdle('main', 150);
  }

  onAddFormInput(field: BagKeyField, value: string) {
    this._addBagForm.update((form) => ({ ...form, [field]: value }));
  }

  //  ฟอร์มกรอกเอง (สำรองกรณี QR ถุงเสีย/สแกนไม่ติด) -- เติม Cost Center/Grade/Lot ของพาเลทไว้ให้
  private resetAddManualForm() {
    const pallet = this._pallet();
    this._addBagForm.set({
      costCenter: pallet?.cost_center ?? '',
      grade: pallet?.grade ?? '',
      lot: pallet?.lot ?? '',
      bagNo: '',
      tonNo: '',
    });
  }

  onAddScanQr() {
    if (this._isAddFull()) {
      this.showPalletFull();
      return;
    }
    this._isAddScanning.set(true);
    this.focusInput(this._addScanInput);
  }

  private showPalletFull() {
    return Swal.fire({
      icon: 'warning',
      title: 'พาเลทเต็มแล้ว',
      text: `พาเลทนี้รับได้สูงสุด ${this._palletCapacity()} ถุง (ห้ามเกิน Pallet Ratio)`,
      confirmButtonColor: '#283593',
    });
  }

  //  สแกน QR ถุงใน modal Add Bag -> ตรวจแล้วเข้ารายการรอ จากนั้น arm สแกนใบถัดไปให้เอง
  async processAddScan(value: string, inputElement: HTMLInputElement) {
    const code = (value ?? '').trim();
    inputElement.value = '';
    if (!code || !this._isAddScanning() || this._isEditBagMode()) return;

    this._isAddScanning.set(false);
    await this.handleAddCode(code);
    this.armWhenIdle('add');
  }

  //  ใช้ร่วมกันทั้งปืนสแกนและกล้อง -- true = เข้ารายการรอ / ย้ายสำเร็จ
  private async handleAddCode(code: string): Promise<boolean> {
    //  Dummy ปลายทางรับ QR Dummy Pallet อื่นด้วย = pallet_no เปล่า (PLD...) ไม่มี |grade|lot|qty
    const isDummySourceCode = this._isDummyPallet() && /^PL[A-Z0-9]+$/i.test(code);
    if (this.scanLogic.parseFullPalletScanCode(code) || isDummySourceCode) {
      return this.queuePalletBags(code);
    }
    if (this.isBagQr(code)) {
      return this.queueBag(code);
    }
    this.showInvalidQr();
    return false;
  }

  //  ปุ่มสแกนใน modal เพิ่มถุง: โหมดกล้อง -> เปิดกล้องสแกนต่อเนื่อง
  onAddScanButton() {
    if (this._isCameraMode()) this.openCamera('add');
    else this.onAddScanQr();
  }

  //  กรอกเองครบ 5 ช่อง -> ค้นหาแล้วเข้ารายการรอ (ตรวจเหมือนสแกน)
  async onAddManualToQueue() {
    if (await this.queueBag('', this._addBagForm())) this.resetAddManualForm();
    this.armWhenIdle('add');
  }

  //  ตรวจถุงก่อนเข้ารายการรอ: พาเลทยังไม่เต็ม -> หาถุง orphan -> ไม่ซ้ำ -> Grade/Lot ตรงกับพาเลท
  private async queueBag(qrCode: string, form?: BagKeyForm): Promise<boolean> {
    const pallet = this._pallet();
    if (!pallet) return false;

    if (this._isAddFull()) {
      this.showPalletFull();
      return false;
    }

    //  เทียบ Grade/Lot จาก QR (cost_center|grade|lot|bag_no|ton) หรือฟอร์มก่อนยิง API
    //  ไม่งั้นถุงที่อยู่บนพาเลทอื่นจะได้ error "อยู่บนพาเลท xx แล้ว" ก่อนรู้ว่า Grade/Lot ไม่ตรง
    //  Dummy ที่ยังว่างและยังไม่มีถุงในรายการ -> ถุงแรกเป็นตัวกำหนด Grade/Lot (ไม่เช็ค)
    const target = this.addTargetKey();
    const qrParts = qrCode ? qrCode.split('|') : [];
    const keyDiffs = !target ? [] : this.gradeLotDiffs(target, qrCode
      ? { grade: qrParts[1] ?? '', lot: qrParts[2] ?? '' }
      : { grade: form?.grade ?? '', lot: form?.lot ?? '' });
    if (keyDiffs.length > 0) {
      this.showGradeLotMismatch(keyDiffs);
      return false;
    }

    this.loadingService.show('กำลังค้นหาถุง...');
    let bag: Type.PalletManagementFoundBag;
    try {
      //  ส่ง pallet.id -> รับถุงที่อยู่บนพาเลทอื่นได้ (ย้ายด้วย move-bag ตอนยืนยัน) แต่ห้ามอยู่บนพาเลทนี้
      bag = await this.findBag(qrCode, form, pallet.id);
    } catch (err) {
      this.loadingService.hide();
      this.showError('ไม่สามารถใช้ถุงนี้ได้', err);
      return false;
    }
    this.loadingService.hide();

    if (this._addQueue().some((b) => b.id === bag.id) || this._bagsList().some((b) => b.id === bag.id)) {
      Swal.fire({ icon: 'warning', title: 'สแกนถุงนี้ไปแล้ว', text: bag.qr_text_data || '', confirmButtonColor: '#283593' });
      return false;
    }

    //  เช็คซ้ำด้วยค่าจริงใน DB (คอลัมน์ grade/lot อาจถูกแก้ผ่าน Edit Bag ต่างจาก QR)
    const diffs = target ? this.gradeLotDiffs(target, bag) : [];
    if (diffs.length > 0) {
      this.showGradeLotMismatch(diffs);
      return false;
    }

    //  เช็คซ้ำอีกรอบหลัง await (กันสแกนรัวจนเกิน ratio)
    if (this._isAddFull()) {
      this.showPalletFull();
      return false;
    }

    //  ถุงอยู่บนพาเลทอื่น -> ตอนยืนยันใช้ move-bag (SP 80) แทน add-bag
    this._addQueue.update((queue) => [...queue, bag.pallet_id ? { ...bag, fromPalletNo: bag.pallet_no ?? '-' } : bag]);
    return true;
  }

  private showGradeLotMismatch(diffs: string[]) {
    Swal.fire({
      icon: 'error',
      title: 'Grade/Lot ไม่ตรงกับพาเลท',
      html: `${diffs.join('<br>')}<br><br>ไม่สามารถเพิ่มถุงนี้เข้าพาเลทได้`,
      confirmButtonColor: '#d32f2f',
    });
  }

  //  สแกน QR พาเลท (PL<code>|grade|lot|qty เช่น PLM2610160008|03R01B|0261001361|500)
  //  -> ย้ายถุงทุกใบบนพาเลทนั้นเข้ารายการรอทั้งหมด หรือไม่เข้าเลยสักใบ (ย้ายทั้งพาเลท)
  //  ต้องผ่าน: ไม่ใช่พาเลทเดียวกัน, Grade/Lot ตรงกับพาเลทปลายทางทุกใบ, ที่ว่างพอไม่เกิน pallet ratio
  //  Dummy ปลายทางรับ QR Dummy Pallet อื่นแบบ pallet_no เปล่า (PLD...) ด้วย -- parsed = null
  private async queuePalletBags(code: string): Promise<boolean> {
    const pallet = this._pallet();
    const parsed = this.scanLogic.parseFullPalletScanCode(code);
    if (!pallet || (!parsed && !this.isDummyPallet(pallet))) return false;
    const rawCode = parsed?.rawCode ?? code;

    const fail = (title: string, html: string) => {
      Swal.fire({ icon: 'error', title, html, confirmButtonColor: '#d32f2f' });
      return false;
    };

    if (rawCode.toUpperCase() === (pallet.pallet_no ?? '').toUpperCase()) {
      return fail('เป็นพาเลทเดียวกัน', `พาเลท <b>${rawCode}</b> คือพาเลทที่กำลังเพิ่มถุงอยู่`);
    }

    //  เช็ค Grade/Lot จาก QR ก่อนยิง API -- ไม่ตรงก็ไม่ต้องโหลด (dummy ว่าง + ไม่มีรายการรอ = ไม่เช็ค)
    const target = this.addTargetKey();
    const qrDiffs = parsed && target ? this.gradeLotDiffs(target, parsed) : [];
    if (qrDiffs.length > 0) {
      return fail('Grade/Lot ไม่ตรงกับพาเลท', `${qrDiffs.join('<br>')}<br><br>ไม่สามารถย้ายถุงจากพาเลทนี้ได้`);
    }

    this.loadingService.show('กำลังโหลดถุงบนพาเลท...');
    let source: Type.PalletManagementPallet;
    let sourceBags: Type.PalletManagementBag[];
    try {
      const res = await firstValueFrom(this.crudService.GetPalletManagement(code));
      if (!res.data?.pallet) throw { message: res.message || 'ไม่พบข้อมูลพาเลท' };
      source = res.data.pallet;
      sourceBags = res.data.bags ?? [];
    } catch (err) {
      this.loadingService.hide();
      this.showError('ไม่พบข้อมูลพาเลท', err);
      return false;
    }
    this.loadingService.hide();

    if (source.id === pallet.id) {
      return fail('เป็นพาเลทเดียวกัน', `พาเลท <b>${source.pallet_no}</b> คือพาเลทที่กำลังเพิ่มถุงอยู่`);
    }

    //  Dummy ปลายทาง + ต้นทาง Manual / Dummy -> กรอกจำนวนถุงที่จะเบิก แล้วย้ายทันที (ไม่เข้ารายการรอ)
    //  ต้นทาง Auto (ถุงมี QR ข้างถุง) -> ไม่รับ QR พาเลท ต้องสแกน QR ข้างถุงทุกใบ
    if (this.isDummyPallet(pallet)) {
      if (this.isManualPallet(source) || this.isDummyPallet(source)) {
        return this.transferToDummy(pallet, source, sourceBags);
      }
      return fail('กรุณาสแกนทีละถุง', `พาเลท <b>${source.pallet_no}</b> เป็นพาเลท Auto<br>กรุณาสแกน QR ข้างถุงทุกใบ`);
    }

    //  มีพาเลท Manual เกี่ยวข้อง -> รวมทั้งพาเลททันที (รวม qty เข้า unit_pallet ของปลายทาง) ไม่เข้ารายการรอ
    if (this.isManualPallet(pallet) || this.isManualPallet(source)) {
      return this.mergeManualPallet(pallet, source);
    }

    const queuedIds = new Set(this._addQueue().map((b) => b.id));
    const bags = sourceBags.filter((b) => !queuedIds.has(b.id));
    if (bags.length === 0) {
      return fail('ไม่มีถุงให้ย้าย', sourceBags.length > 0
        ? `ถุงบนพาเลท <b>${source.pallet_no}</b> อยู่ในรายการแล้วทั้งหมด`
        : `พาเลท <b>${source.pallet_no}</b> ไม่มีถุงอยู่`);
    }

    //  dummy ว่าง: ถุงทุกใบบนพาเลทต้นทางต้อง Grade/Lot เดียวกับใบแรก
    const key = target ?? bags[0];
    const mismatched = bags.filter((b) => this.gradeLotDiffs(key, b).length > 0);
    if (mismatched.length > 0) {
      return fail('Grade/Lot ไม่ตรงกับพาเลท',
        `ถุงบนพาเลท <b>${source.pallet_no}</b> มี Grade/Lot ไม่ตรง ${mismatched.length} ถุง<br>`
        + mismatched.slice(0, 5).map((b) => `Bag ${this.formatRunningNo(b.bag_no)}: ${b.grade || '-'} / ${b.lot || '-'}`).join('<br>')
        + '<br><br>ไม่สามารถย้ายถุงจากพาเลทนี้ได้');
    }

    const capacity = this._palletCapacity();
    if (capacity > 0 && this._addTotalCount() + bags.length > capacity) {
      const free = Math.max(0, capacity - this._addTotalCount());
      return fail('เกิน Pallet Ratio',
        `พาเลท <b>${source.pallet_no}</b> มี ${bags.length} ถุง แต่พาเลทนี้เหลือที่ว่าง ${free} ถุง<br>(รับได้สูงสุด ${capacity} ถุง)`);
    }

    const fromPalletNo = source.pallet_no;
    this._addQueue.update((queue) => [
      ...queue,
      ...bags.map((b): QueuedBag => ({
        id: b.id,
        bag_no: b.bag_no,
        pallet_running_no: b.pallet_running_no,
        cost_center: b.cost_center,
        grade: b.grade,
        lot: b.lot,
        qr_text_data: b.qr_text_data,
        qty: b.qty,
        fromPalletNo,
      })),
    ]);
    this.showSuccess(`เพิ่มถุงจากพาเลท ${fromPalletNo} เข้ารายการ ${bags.length} ถุง`);
    return true;
  }

  //  พาเลท Manual = pallet_no ขึ้นต้น PLM (fGetPalletNo('M')) -- backend เช็ค pallet_type เองอีกชั้น
  private isManualPallet(p: { pallet_no?: string | null; pallet_type?: string | null }): boolean {
    return p.pallet_type === 'M' || (p.pallet_no ?? '').toUpperCase().startsWith('PLM');
  }

  //  Grade/Lot ที่ถุงใหม่ต้องตรงตอน Add Bag -- null = ไม่เช็ค (Dummy ยังว่างและยังไม่มีถุงในรายการรอ)
  //  Dummy ว่างแต่มีรายการรอแล้ว -> ใช้ของถุงแรกในรายการ ; พาเลทอื่นใช้ Grade/Lot ของพาเลทเสมอ
  private addTargetKey(): { grade: string; lot: string } | null {
    const pallet = this._pallet();
    if (!pallet) return null;
    if (!this.isDummyPallet(pallet) || this._bagsList().length > 0) return pallet;
    return this._addQueue()[0] ?? null;
  }

  //  เบิกของจากพาเลท Manual / Dummy อื่น ลง Dummy Pallet ตามจำนวนถุงที่กรอก (pallet-management/dummy/transfer, sql/109_)
  //  Manual: น้ำหนักคงเหลือ = unit_pallet x unit_ratio -> เบิกได้สูงสุด น้ำหนัก / package ratio ถุง
  //  Dummy : ย้ายตามจำนวนได้เฉพาะถุงที่ไม่มี QR ข้างถุง (เบิกมาจาก Manual) ค่าเริ่มต้น = ทั้งหมด แก้เป็นบางถุงได้
  //          ถุงที่มี QR ข้างถุงต้องสแกนทีละใบ
  private async transferToDummy(
    pallet: Type.PalletManagementPallet,
    source: Type.PalletManagementPallet,
    sourceBags: Type.PalletManagementBag[],
  ): Promise<boolean> {
    const fail = (title: string, html: string) => {
      Swal.fire({ icon: 'error', title, html, confirmButtonColor: '#d32f2f' });
      return false;
    };

    if (sourceBags.length === 0) {
      return fail('ไม่มีถุงให้ย้าย', `พาเลท <b>${source.pallet_no}</b> ไม่มีถุงอยู่`);
    }

    const target = this.addTargetKey();
    const diffs = target ? this.gradeLotDiffs(target, source) : [];
    if (diffs.length > 0) {
      return fail('Grade/Lot ไม่ตรงกับพาเลท', `${diffs.join('<br>')}<br><br>ไม่สามารถย้ายของจากพาเลท <b>${source.pallet_no}</b> ได้`);
    }

    const isManual = this.isManualPallet(source);
    const movable = sourceBags.filter((b) => !this.isBagQr(b.qr_text_data ?? ''));
    const qrBagCount = sourceBags.length - movable.length;
    let maxBags = movable.length;
    let detail = `ถุงที่ไม่มี QR ข้างถุง ${movable.length} ถุง`
      + (qrBagCount > 0 ? `<br>(ถุงที่มี QR ข้างถุง ${qrBagCount} ถุง ต้องสแกนทีละใบ)` : '');
    if (!isManual && maxBags < 1) {
      return fail('กรุณาสแกนทีละถุง', `ถุงบนพาเลท <b>${source.pallet_no}</b> มี QR ข้างถุงทั้งหมด<br>กรุณาสแกน QR ข้างถุงทุกใบ`);
    }
    if (isManual) {
      const ratio = Number(source.package_ratio) || 0;
      const totalQty = (Number(source.unit_pallet) || 0) * (Number(source.unit_ratio) || 0);
      if (ratio <= 0) {
        return fail('ไม่พบ Package Ratio', `ไม่พบน้ำหนักต่อถุงของ Grade <b>${source.grade || '-'}</b> -- เบิกจากพาเลท Manual ไม่ได้`);
      }
      maxBags = Math.floor(totalQty / ratio);
      detail = `คงเหลือ ${totalQty} กก. (เบิกได้ ${maxBags} ถุง x ${ratio} กก.)`;
      if (maxBags < 1) {
        return fail('น้ำหนักไม่พอ', `พาเลท <b>${source.pallet_no}</b> ${detail}`);
      }
    }

    const { value, isConfirmed } = await Swal.fire({
      icon: 'question',
      title: isManual ? 'เบิกจากพาเลท Manual' : 'ย้ายจาก Dummy Pallet',
      html: `<b>${source.pallet_no}</b> : ${source.grade || '-'} / ${source.lot || '-'}<br>${detail}<br><br>`
        + `เข้าพาเลท <b>${pallet.pallet_no}</b> -- กรอกจำนวนถุง`,
      input: 'number',
      inputValue: isManual ? '' : String(maxBags),
      inputAttributes: { min: '1', max: String(maxBags), step: '1' },
      inputValidator: (v) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= 1 && n <= maxBags ? null : `กรอกจำนวนถุง 1 - ${maxBags}`;
      },
      showCancelButton: true,
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#283593',
      cancelButtonColor: '#888888',
      reverseButtons: true,
      //  กว้าง 75% เท่า modal Edit / Replace (ดู .pm-swal-wide ใน styles.css)
      width: '75vw',
      customClass: { popup: 'pm-swal-wide' },
    });
    if (!isConfirmed) return false;

    const bagCount = Number(value);
    this.loadingService.show('กำลังย้ายถุง...');
    try {
      const res = await firstValueFrom(this.crudService.TransferDummyPalletBags({
        srcPalletId: source.id,
        palletId: pallet.id,
        bagCount,
        userId: this._currentUserId,
      }));
      this.loadingService.hide();
      await this.reloadPallet();
      const remain = Number(res.result?.remain_qty) || 0;
      this.showSuccess(`ย้าย ${bagCount} ถุงจาก ${source.pallet_no} สำเร็จ (คงเหลือ ${remain} ${isManual ? 'กก.' : 'ถุง'})`);
      return true;
    } catch (err) {
      this.loadingService.hide();
      this.showError('ย้ายถุงไม่สำเร็จ', err);
      return false;
    }
  }

  //  Dummy = pallet_type 'D' (API ส่งมาหลังรัน sql/108_) -- ก่อนหน้านั้นดูจาก prefix PLD แทน
  private isDummyPallet(p: { pallet_no?: string | null; pallet_type?: string | null }): boolean {
    return p.pallet_type === 'D' || (p.pallet_no ?? '').toUpperCase().startsWith('PLD');
  }

  //  Manual -> Manual : รวม qty แล้วลบถุงของพาเลทต้นทาง
  //  Manual -> Auto / Auto -> Manual : รวม qty แล้วย้ายถุงต้นทางมาพาเลทนี้
  //  qty รวมเก็บที่ unit_pallet ของพาเลทนี้ (= qty รวม / unit_ratio) ; พาเลทต้นทางถูกปิด
  private async mergeManualPallet(
    pallet: Type.PalletManagementPallet,
    source: Type.PalletManagementPallet,
  ): Promise<boolean> {
    //  qty เหมือนที่ SP 81 ใช้: Manual = unit_pallet × unit_ratio , Auto = ถุง × unit_ratio (source.qty)
    const sourceQty = this.isManualPallet(source)
      ? (source.unit_pallet ?? 0) * (source.unit_ratio ?? 0)
      : source.qty;
    const deleteSourceBags = this.isManualPallet(pallet) && this.isManualPallet(source);
    const confirm = await Swal.fire({
      icon: 'question',
      title: 'รวมพาเลท',
      html: `รวมพาเลท <b>${source.pallet_no}</b> (qty ${sourceQty ?? '-'})<br>`
        + `เข้าพาเลท <b>${pallet.pallet_no}</b><br><br>`
        + (deleteSourceBags ? 'ข้อมูลถุงของพาเลทต้นทางจะถูกลบ' : 'ถุงของพาเลทต้นทางจะถูกย้ายมาพาเลทนี้')
        + '<br>พาเลทต้นทางจะถูกปิด',
      showCancelButton: true,
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#283593',
    });
    if (!confirm.isConfirmed) return false;

    this.loadingService.show('กำลังรวมพาเลท...');
    try {
      const res = await firstValueFrom(this.crudService.MergePalletManagementPallet({
        srcPalletId: source.id,
        palletId: pallet.id,
        userId: this._currentUserId,
      }));
      this.loadingService.hide();
      await this.reloadPallet();
      this.showSuccess(res.message || `รวมพาเลท ${source.pallet_no} สำเร็จ`);
      return true;
    } catch (err) {
      this.loadingService.hide();
      this.showError('รวมพาเลทไม่สำเร็จ', err);
      return false;
    }
  }

  removeQueuedBag(index: number) {
    this._addQueue.update((queue) => queue.filter((_, i) => i !== index));
    this.armWhenIdle('add');
  }

  //  ปุ่ม "ยืนยัน" -- บันทึกถุงในรายการรอเข้าพาเลททีละใบตามลำดับที่สแกน
  //  ใบไหนล้มเหลว -> หยุดตรงนั้น ใบที่สำเร็จแล้วออกจากรายการ ที่เหลือค้างไว้ให้ลองใหม่/ลบออกได้
  async confirmAddBags() {
    const pallet = this._pallet();
    const queue = this._addQueue();
    if (!pallet) return;
    if (queue.length === 0) {
      Swal.fire({ icon: 'warning', title: 'ยังไม่มีถุงในรายการ', text: 'กรุณาสแกนถุงที่ต้องการเพิ่มก่อน', confirmButtonColor: '#283593' });
      return;
    }

    const capacity = this._palletCapacity();
    if (capacity > 0 && this._bagsList().length + queue.length > capacity) {
      this.showPalletFull();
      return;
    }

    this.loadingService.show('กำลังบันทึก...');
    const addedIds: number[] = [];
    let failure: unknown = null;
    for (const bag of queue) {
      try {
        const body = { bagId: bag.id, palletId: pallet.id, userId: this._currentUserId };
        if (this.isDummyPallet(pallet)) {
          //  Dummy ไม่มี unit_pallet -> add-bag / move-bag (SP 05/80) ไม่รับ ; SP 109 รับทั้งถุง orphan และถุงบนพาเลทอื่น
          await firstValueFrom(this.crudService.AddDummyPalletBag(body));
        } else if (bag.fromPalletNo) {
          await firstValueFrom(this.crudService.MovePalletManagementBag(body));
        } else {
          try {
            await firstValueFrom(this.crudService.AddPalletManagementBag(body));
          } catch (addErr: any) {
            //  ถุงเป็น orphan ตอนสแกน แต่ระหว่างรอยืนยัน auto-matching (job 1 นาที) จับคู่เข้าพาเลทอื่นไปแล้ว
            //  -> add-bag ตอบ 400 "ถุงนี้ถูกจับคู่กับพาเลทอื่นไปแล้ว" -- ย้ายด้วย move-bag แทน (SP 80 เช็ค Grade/Lot/ratio/พาเลทเดียวกันเอง)
            if (addErr?.status !== 400) throw addErr;
            try {
              await firstValueFrom(this.crudService.MovePalletManagementBag(body));
            } catch (moveErr: any) {
              //  ถุงยังเป็น orphan จริง (add-bag ล้มด้วยเหตุอื่น เช่น พาเลทเต็ม) -> แจ้ง error ของ add-bag
              throw String(moveErr?.error?.message ?? '').includes('ไม่ได้อยู่บนพาเลทใด') ? addErr : moveErr;
            }
          }
        }
        addedIds.push(bag.id);
      } catch (err) {
        failure = err;
        break;
      }
    }
    this.loadingService.hide();

    this._addQueue.update((q) => q.filter((b) => !addedIds.includes(b.id)));
    if (addedIds.length > 0) await this.reloadPallet(addedIds[addedIds.length - 1]);

    if (failure) {
      this.showError(`เพิ่มถุงสำเร็จ ${addedIds.length} จาก ${queue.length} ถุง`, failure);
      this.armWhenIdle('add');
      return;
    }

    this._showAddBagModal.set(false);
    this._isAddScanning.set(false);
    this.showSuccess(`เพิ่มถุงสำเร็จ ${addedIds.length} ถุง`);
    this.armWhenIdle('main', 150);
  }

  //  Edit Bag -- ต้องกรอกครบ 5 ช่อง
  async saveEditBag() {
    if (!this._pallet()) return;
    const form = this._addBagForm();

    const invalid = this.validateBagForm(form);
    if (invalid) {
      Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ', text: invalid, confirmButtonColor: '#283593' });
      return;
    }

    this.loadingService.show('กำลังบันทึก...');
    try {
      const bag = this._bagData();
      await firstValueFrom(this.crudService.EditPalletManagementBag({
        bagId: bag.id,
        costCenter: form.costCenter.trim(),
        bagNo: Number(form.bagNo),
        palletRunningNo: Number(form.tonNo),
        grade: form.grade.trim(),
        lot: form.lot.trim(),
        userId: this._currentUserId,
      }));
      this.loadingService.hide();
      this.closeAddBagModal();
      await this.reloadPallet(bag.id);
      this.showSuccess('แก้ไขข้อมูลสำเร็จ');
    } catch (err) {
      this.loadingService.hide();
      this.showError('แก้ไขข้อมูลไม่สำเร็จ', err);
    }
  }
}
