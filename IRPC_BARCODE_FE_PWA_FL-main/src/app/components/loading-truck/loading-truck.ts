import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { CrudService } from '../../service/crud.service';
import { OfflineStorageService } from '../../service/offline-storage.service';
import { ScanPalletLogicService } from '../../service/scan-pallet-logic.service';
import * as Type from '../../../models/variables-type';

interface PalletTargetLocation {
  location: string;
  placed: number;
  total: number;
}

interface PalletToPlaceItem {
  id: string | null;
  grade: string;
  lotNo: string;
  qty: number;
  documentJob: string;
  isActive: boolean;
  isChecked: boolean;
  isSelectedForPlacement: boolean;
  targetLocations: PalletTargetLocation[];
}

interface TotalPalletDisplayItem {
  key: string;
  documentJob: string;
  grade: string;
  lotNo: string;
  qty: number;
  id: string | null;
  status: 'pending' | 'waiting-location' | 'complete';
  locationName?: string;
}

interface TotalPalletGroup {
  groupName: string;
  completedCount: number;
  totalCount: number;
  isExpanded: boolean;
  items: TotalPalletDisplayItem[];
}

@Component({
  selector: 'app-loading-truck',
  standalone: false,
  templateUrl: './loading-truck.html',
  styleUrl: './loading-truck.css',
})

export class LoadingTruck implements OnInit, AfterViewInit {

  @ViewChild('scannerInput') scannerInputRef!: ElementRef<HTMLInputElement>;

  _jobDataRaw: any = null;

  job: any = {
    jobTag: 'OUT',
    jobNomber: 'SM- 20260001',
  };

  _bagRequiredCount: number;
  _bagCheckList: boolean[] = [];

  _scannerValue: string = '';
  _isScanning: boolean = false;

  _isMultiStep: boolean = false;
  _totalPalletCount: number = 0;
  _completedPalletCount: number = 0;
  _palletToPlaceList: PalletToPlaceItem[] = [
    {
      id: 'PL-DO30335272-12',
      documentJob: 'DO30335272',
      grade: 'H6410MX',
      lotNo: 'M3023G1',
      qty: 1500,
      isChecked: true,
      isActive: false,
      isSelectedForPlacement: false,
      targetLocations: [
        { location: 'L01-01', placed: 0, total: 1 },
        { location: 'L01-02', placed: 0, total: 1 }
      ]
    },
    {
      id: 'PL-DO30335272-12',
      documentJob: 'DO30335272',
      grade: 'H6410MX',
      lotNo: 'M3023G1',
      qty: 1500,
      isChecked: true,
      isActive: false,
      isSelectedForPlacement: false,
      targetLocations: [
        { location: 'L01-01', placed: 0, total: 1 },
        { location: 'L01-02', placed: 0, total: 1 }
      ]
    },
    {
      id: 'PL-DO30335272-13',
      documentJob: 'DO30335272',
      grade: 'H6410MX',
      lotNo: 'M3023G1',
      qty: 1500,
      isChecked: true,
      isActive: true,
      isSelectedForPlacement: false,
      targetLocations: [
        { location: 'L01-03', placed: 0, total: 1 }
      ]
    }
  ];
  _completedPalletList: PalletToPlaceItem[] = [];

  _currentUserId: number = 0;

  private _audioContext: AudioContext | null = null;

  constructor(
    private router: Router,
    private restService: CrudService,
    private scanLogic: ScanPalletLogicService,
  ) {
    this._bagRequiredCount = this.scanLogic.BAG_REQUIRED_COUNT;
  }

  //  Component Build Up Event
  ngOnInit(): void {
    this.loadJobData();
    this.initBagCheckList();

    this._currentUserId = Number(localStorage.getItem('userId')) || 0;
  }

  //  Component Destroy Event
  ngAfterViewInit(): void {
    this.focusScannerInput();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    setTimeout(() => this.focusScannerInput(), 0);
  }

  //  Focus scanner input field
  focusScannerInput(): void {
    this.scannerInputRef?.nativeElement?.focus();
  }

  //  Enable scanning mode and focus scanner input
  onClickScanButton(): void {
    this._isScanning = true;
    this.focusScannerInput();
  }

  //  Handle barcode scanner input on Enter key
  onScannerEnter(): void {
    const code = this._scannerValue.trim();
    this._scannerValue = '';

    if (!code) {
      return;
    }

    console.log('Scanned code:', code);
    
    // Core business logic removed as requested
    
    this.focusScannerInput();
  }



  _expandedGroups: Set<string> = new Set();
  
  toggleGroup(groupName: string): void {
      if (this._expandedGroups.has(groupName)) {
          this._expandedGroups.delete(groupName);
      } else {
          this._expandedGroups.add(groupName);
      }
  }

  expandAll(): void {
      this._totalPalletDisplayGroups.forEach(g => this._expandedGroups.add(g.groupName));
  }

  collapseAll(): void {
      this._expandedGroups.clear();
  }

  trackByGroupName(index: number, group: TotalPalletGroup): string {
      return group.groupName;
  }

  get _totalPalletDisplayGroups(): TotalPalletGroup[] {
      return [
          {
              groupName: "DO303XXXX : GA501RP1 5200/650 • 1234567890 • 10000",
              completedCount: 3,
              totalCount: 10,
              isExpanded: this._expandedGroups.has("DO303XXXX : GA501RP1 5200/650 • 1234567890 • 10000"),
              items: [
                  { key: '1', documentJob: 'DO303XXXX', grade: 'GA501RP1 5200/650', lotNo: '1234567890', qty: 1000, id: '1234567890', status: 'pending' },
                  { key: '2', documentJob: 'DO303XXXX', grade: 'GA501RP1 5200/650', lotNo: '1234567890', qty: 1000, id: '1234567891', status: 'pending' },
                  { key: '3', documentJob: 'DO303XXXX', grade: 'GA501RP1 5200/650', lotNo: '1234567890', qty: 1000, id: '1234567892', status: 'complete' }
              ]
          },
          {
              groupName: "DO303XXXX : GA601RP1 5200/650 • 1234567890 • 10000 + 1 more",
              completedCount: 1,
              totalCount: 10,
              isExpanded: this._expandedGroups.has("DO303XXXX : GA601RP1 5200/650 • 1234567890 • 10000 + 1 more"),
              items: [
                  { key: '4', documentJob: 'DO303XXXX', grade: 'GA601RP1 5200/650', lotNo: '1234567890', qty: 1000, id: '1234567893', status: 'complete' }
              ]
          }
      ];
  }

  get _totalPalletAllCount(): number {
    return this._totalPalletDisplayGroups.reduce((acc, g) => acc + g.items.length, 0);
  }

  //  Initialize bag verification checklist
  initBagCheckList(count: number = this._bagRequiredCount): void {
    this._bagRequiredCount = count;
    this._bagCheckList = Array.from({ length: count }, () => false);
  }

  //  Load job data from navigation state or session storage
 private loadJobData(): void {
  const state = this.router.getCurrentNavigation()?.extras?.state ?? history.state;

  let rawJob: any = null;

  if (state && state['job']) {
    rawJob = state['job'];
  } else {
    const saved = sessionStorage.getItem('loadingTruckJobData');
    if (saved) {
      rawJob = JSON.parse(saved).job;
    }
  }

  if (!rawJob) {
    return;
  }

  this._jobDataRaw = rawJob;

  this.job = {
    jobTag: this.mapJobTag(rawJob.type_topic),
    jobNomber: this.fallback(rawJob.system_no),
  };

  this._isMultiStep = rawJob.is_multi_fl === 'Y';
  this._totalPalletCount = rawJob.total_pallet ?? 0;

  const items = rawJob.items ?? [];

  // ✅ รวม complete_pallet จากทุก item (ไม่ใช้ job-level ตรงๆ)
  this._completedPalletCount = items.reduce(
    (sum: number, item: any) => sum + (item.complete_pallet ?? 0),
    0
  );

  // ✅ สร้าง placeholder pallet ด้านซ้ายจาก receive_pallet ของแต่ละ item
  // (verify/get สำเร็จแล้ว แต่ยังไม่ put-away — ไม่ว่าจะ get จากเครื่องไหน)
  this._palletToPlaceList = [];
  items.forEach((item: any) => {
    const pendingCount = item.receive_pallet ?? 0;
    for (let i = 0; i < pendingCount; i++) {
      this._palletToPlaceList.push({
        id: null, // ไม่ทราบ Pallet ID จริง เพราะ verify มาจากเครื่อง/เซสชันอื่น
        grade: this.fallback(item.grade),
        lotNo: this.fallback(item.lot_no),
        qty: item.qty ?? 0,
        documentJob: this.fallback(item.document_job),
        isActive: true,
        isChecked: true,
        isSelectedForPlacement: false,
        targetLocations: this.mapTargetLocations(item),
      });
    }
  });

  if (!rawJob.items || rawJob.items.length === 0) {
    this.SweetAlert('warning', 'ไม่พบรายการสินค้าของงานนี้ กรุณากลับไปเลือกงานใหม่');
  }
}

  //  Return default '-' if value is empty or null
  private fallback(value: any): any {
    if (value === null || value === undefined || value === '') {
      return '-';
    }
    return value;
  }

  //  Extract target locations from item
  private mapTargetLocations(item: any): PalletTargetLocation[] {
    const toLocations = item?.locations?.to_locations ?? [];

    if (toLocations.length === 0) {
      return [];
    }

    return toLocations.map((loc: any) => ({
      location: this.fallback(loc.location_name),
      placed: loc.complete_pallet ?? 0,
      total: loc.total_pallet ?? 0,
    }));
  }

  //  Convert job type topic to display tag
  private mapJobTag(typeTopic: string): string {
    switch (typeTopic) {
      case 'Inbound': return 'IN';
      case 'Outbound': return 'OUT';
      case 'Request': return 'RQ';
      case 'Booking': return 'BK';
      default: return this.fallback(typeTopic);
    }
  }

  //  Calculate total verified and pending pallets for progress tracking
  get _getPalletCount(): number {
    return this._completedPalletCount + this._palletToPlaceList.length;
  }

  get _getPercent(): number {
    if (this._totalPalletCount === 0) {
      return 0;
    }
    return Math.min(100, Math.round((this._getPalletCount / this._totalPalletCount) * 100));
  }

  //  Calculate completion percentage
  get _completePercent(): number {
    if (this._totalPalletCount === 0) {
      return 0;
    }
    return Math.min(100, Math.round((this._completedPalletCount / this._totalPalletCount) * 100));
  }

  //  สร้างเสียง beep ด้วยความถี่ที่กำหนดเอง (ไม่ต้องใช้ไฟล์เสียง)
  private playBeep(frequency: number = 800, duration: number = 200): void {
    try {
      if (!this._audioContext) {
        this._audioContext = new AudioContext();
      }

      const oscillator = this._audioContext.createOscillator();
      const gainNode = this._audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this._audioContext.destination);

      oscillator.type = 'square';
      oscillator.frequency.value = frequency;

      gainNode.gain.setValueAtTime(0.3, this._audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.001,
        this._audioContext.currentTime + duration / 1000
      );

      oscillator.start(this._audioContext.currentTime);
      oscillator.stop(this._audioContext.currentTime + duration / 1000);
    } catch (err) {
      console.error('ไม่สามารถเล่นเสียงได้:', err);
    }
  }

  //  เสียง error (โทนต่ำ ยาวกว่าปกติ)
  private playErrorBeep(): void {
    this.playBeep(100, 500);
  }

  //  เสียง success (โทนสูง สั้น)
  private playSuccessBeep(): void {
    this.playBeep(1000, 500);
  }

  //  Navigate back to job selection
  onClickBack(): void {
    this.router.navigate(['job-accept']);
  }

  //  Display system alert message
  SweetAlert(iconn: any, alert_message: string) {
    Swal.fire({
      position: 'center',
      icon: iconn,
      title: 'ข้อความจากระบบ',
      text: alert_message,
      showConfirmButton: true,
    });
  }
}
