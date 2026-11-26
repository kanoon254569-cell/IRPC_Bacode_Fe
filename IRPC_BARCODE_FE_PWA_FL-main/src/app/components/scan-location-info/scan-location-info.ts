import { Component, inject, signal, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { firstValueFrom } from 'rxjs';
import { LoadingService } from '../../service/loading.service';
import { CrudService } from '../../service/crud.service';
import * as Type from '../../../models/variables-type';

@Component({
  selector: 'app-scan-location-info',
  standalone: false,
  templateUrl: './scan-location-info.html',
  styleUrl: './scan-location-info.css'
})
export class ScanLocationInfoComponent implements AfterViewInit {
  private router = inject(Router);
  private loadingService = inject(LoadingService);
  private crudService = inject(CrudService);

  @ViewChild('_scanInput') _scanInput!: ElementRef;

  protected readonly _forkliftId = signal(
    sessionStorage.getItem('_FORKLIFT_ID') || 'FL-01'
  );
  protected readonly _selectedWarehouse = signal(
    sessionStorage.getItem('_SELECTED_WAREHOUSE') || 'None'
  );

  //  Permission ที่ decode มาจาก JWT ตอน login (เก็บไว้ที่ sessionStorage '_USER_INFO')
  //  ใช้แยกปุ่ม Truck / Location ในหน้านี้ตามสิทธิ์ที่ผู้ใช้มี
  private readonly userPermission = this.loadUserPermission();
  protected readonly _hasTruckPermission = this.hasPermission('truckInfo');
  protected readonly _hasLocationPermission = this.hasPermission('locationInfo');

  // activeMode can be 'truck' or 'location' -> เริ่มที่ Location ก่อน (ถ้าไม่มีสิทธิ์ Location ค่อยเป็น Truck)
  _activeMode = signal<'truck' | 'location'>(this._hasLocationPermission || !this._hasTruckPermission ? 'location' : 'truck');

  // Scanning state (รูปแบบเดียวกับหน้า pallet-management: ช่องซ่อนรับปืนสแกน + toggle พิมพ์เอง)
  _isScanning = signal(false);
  _isManualInputMode = signal(false);

  // States to represent whether we have scanned the item yet
  _isTruckScanned = signal(false);
  _isLocationScanned = signal(false);

  // Mock data for Truck mode
  _truckData = signal({
    shipment: '123456XXX',
    do: '123456XXX',
    grade: '12JK21',
    lot: '120745',
    name: 'Driver 01',
    licensePlate: 'XX 1234',
    shipTo: 'N/A',
    soldTo: 'N/A',
    dock: 'DOCK A1',
    sealNo: '123456XXX'
  });

  //  ข้อมูล Location ที่สแกน + Pallet ที่อยู่ใน Location นั้น
  //  (tr_pallet.current_location_type = 'MWH' AND current_location_id = location_id ของ location ที่สแกน)
  _locationData = signal<{
    locationDesc: string;
    warehouse: string;
    zone: string;
    floor: string;
    area: string;
    pallets: Type.PalletByLocationItem[];
  }>({ locationDesc: '', warehouse: '-', zone: '-', floor: '-', area: '-', pallets: [] });

  _onBack() {
    this.router.navigate(['/system-menu']);
  }

  //  สลับโหมด Truck / Location -> ถ้าไม่มีสิทธิ์โหมดนั้น แจ้งเตือนแทนการสลับ
  _onSelectMode(mode: 'truck' | 'location'): void {
    const hasPermission = mode === 'truck' ? this._hasTruckPermission : this._hasLocationPermission;

    if (!hasPermission) {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่มีสิทธิ์ใช้งาน',
        text: `บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูล ${mode === 'truck' ? 'Truck' : 'Location'}`,
        confirmButtonText: 'ตกลง',
      });
      return;
    }

    this._activeMode.set(mode);
    this.armWhenIdle();
  }

  private focusInput(ref?: ElementRef) {
    setTimeout(() => ref?.nativeElement?.focus(), 0);
  }

  //  AUTO-ARM SCANNER (เหมือนหน้า pallet-management): ผู้ใช้ไม่ต้องกดปุ่มสแกนเอง
  //  โฟกัสหลุด (popup / loading / แตะที่ว่าง) -> รอจน popup/loading ปิดแล้ว arm กลับให้เอง
  //  ยกเว้นโหมดพิมพ์ หรือผู้ใช้ไปแตะช่องพิมพ์อื่น -> ไม่แย่งโฟกัส
  private isTypingField(el: Element | null): boolean {
    return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.classList.contains('hidden-scanner-field');
  }

  private armWhenIdle(delay = 0) {
    const tick = () => {
      if (this._isManualInputMode()) return;
      if (Swal.isVisible() || this.loadingService.isShowing) {
        setTimeout(tick, 300);
        return;
      }
      if (this.isTypingField(document.activeElement)) return;
      this._isScanning.set(true);
      this._scanInput?.nativeElement?.focus();
    };
    setTimeout(tick, delay);
  }

  onScannerBlur(event: FocusEvent) {
    this._isScanning.set(false);
    if (this.isTypingField(event.relatedTarget as Element | null)) return;
    this.armWhenIdle();
  }

  //  เข้าหน้านี้มาให้พร้อมสแกนได้ทันที ไม่ต้องกดปุ่มสแกนเองก่อน
  ngAfterViewInit(): void {
    this.onClickScanButton();
  }

  onClickScanButton() {
    this._isScanning.set(true);
    this.focusInput(this._scanInput);
  }

  onToggleManualInputMode(checked: boolean) {
    this._isManualInputMode.set(checked);
    this._isScanning.set(false);
    if (!checked) this.armWhenIdle(150);
  }

  //  ปืนสแกนยิงโค้ดเข้าช่องซ่อน + Enter
  async onScannerEnter(input: HTMLInputElement) {
    const code = (input.value ?? '').trim();
    input.value = '';
    if (!code || !this._isScanning()) return;
    await this.handleScanCode(code);
  }

  //  โหมดพิมพ์: ยืนยันโค้ดที่พิมพ์เอง -> logic เดียวกับสแกนจริง
  async onSubmitManualInput(input: HTMLInputElement) {
    const code = (input.value ?? '').trim();
    if (!code) return;
    input.value = '';
    await this.handleScanCode(code);
  }

  //  สแกนเสร็จ (สำเร็จหรือ error) -> arm กลับเองเมื่อ loading/popup ปิดหมด สแกนถัดไปได้เลย
  //  (โหมดพิมพ์ armWhenIdle ไม่ทำอะไร)
  private async handleScanCode(code: string) {
    if (this._activeMode() === 'truck') await this.loadTruck();
    else await this.loadLocation(code);
    this.armWhenIdle();
  }

  // Mock Scan (Truck ยังไม่ต่อ API)
  private async loadTruck(): Promise<boolean> {
    this.loadingService.show('กำลังโหลดข้อมูล...');
    await new Promise((resolve) => setTimeout(resolve, 500));
    this.loadingService.hide();
    this._isTruckScanned.set(true);
    return true;
  }

  //  QR Location ที่สแกนได้ขึ้นต้นด้วย 'M' (เช่น M42E05) แต่ location_desc ใน master เป็น 'WH' (WH42E05)
  //  -> แปลง 'M' ตัวหน้าเป็น 'WH' ก่อนค้น (ถ้าขึ้นต้นด้วย 'WH' อยู่แล้วใช้ตามเดิม)
  private toLocationDesc(code: string): string {
    const upper = code.trim().toUpperCase();
    if (upper.startsWith('WH')) return upper;
    return upper.startsWith('M') ? `WH${upper.substring(1)}` : upper;
  }

  //  QR Location -> location_desc -> หา location_id จาก master MWH ก่อน แล้วค่อยดึง Pallet ใน location นั้น
  private async loadLocation(code: string): Promise<boolean> {
    this.loadingService.show('กำลังโหลดข้อมูล...');
    try {
      const locationDesc = this.toLocationDesc(code);
      const locRes = await firstValueFrom(this.crudService.GetMasterWhLocation(locationDesc));
      const candidates = locRes?.data ?? [];
      //  locationDesc ฝั่ง WMS+ อาจค้นแบบ contains -> เลือกตัวที่ตรงเป๊ะก่อน ไม่งั้นใช้แถวแรก
      const location =
        candidates.find((l) => (l.location_desc ?? '').trim().toUpperCase() === locationDesc) ?? candidates[0];

      if (!location?.location_id) {
        this._isLocationScanned.set(false);
        this.showError('ไม่พบ Location', { message: `ไม่พบ Location "${code}" (${locationDesc}) ในระบบ` });
        return false;
      }

      const palletRes = await firstValueFrom(this.crudService.GetPalletByLocation(location.location_id, 'MWH'));

      this._locationData.set({
        locationDesc: location.location_desc || code,
        warehouse: location.wh_code || '-',
        zone: location.area_code || '-',
        floor: location.level_code || '-',
        area: location.location_code || '-',
        pallets: palletRes?.data ?? [],
      });
      this._isLocationScanned.set(true);
      return true;
    } catch (err) {
      this._isLocationScanned.set(false);
      this.showError('ไม่สามารถโหลดข้อมูล Location ได้', err);
      return false;
    } finally {
      this.loadingService.hide();
    }
  }

  private showError(title: string, err: any) {
    Swal.fire({
      icon: 'error',
      title,
      text: err?.error?.message ?? err?.message ?? 'กรุณาลองใหม่อีกครั้ง',
      confirmButtonColor: '#d32f2f',
    });
  }

  //  โหลด permission จาก session (เก็บไว้ตอน login ใน login.component.ts)
  private loadUserPermission(): Type.JwtPermission | null {
    try {
      const raw = sessionStorage.getItem('_USER_INFO');
      if (!raw) return null;
      const userInfo: Type.UserSessionInfo = JSON.parse(raw);
      return userInfo?.permission ?? null;
    } catch (err) {
      console.error('ไม่สามารถอ่านข้อมูล user permission จาก session ได้:', err);
      return null;
    }
  }

  private hasPermission(key: keyof Type.JwtPermission): boolean {
    return this.userPermission?.[key] === 'Y';
  }
}
