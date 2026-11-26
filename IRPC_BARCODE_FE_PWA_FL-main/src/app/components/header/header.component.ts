import { ChangeDetectorRef, Component, Input, inject } from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { Subscription, skip } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { OfflineStorageService } from '../../service/offline-storage.service';
import { OfflineQueueService, QueueCounts, QueuedAction } from '../../service/offline-queue.service';
import { OfflineSyncService, SyncJobSummary, SyncFailedItem } from '../../service/offline-sync.service';
import { AutoLogoutService } from '../../service/auto-logout.service';
import { CrudService } from '../../service/crud.service';
import { NetworkService } from '../../service/network.service';
import { TourService } from '../../service/tour.service';
import { Dialogloading } from '../dialogloading/dialogloading';
import * as Type from '../../../models/variables-type';

@Component({
  selector: 'app-header',
  standalone: false,
  templateUrl: './header.component.html',
  styleUrl: './header.component.css'
})

export class HeaderComponent {

  private router = inject(Router);
  private dialog = inject(MatDialog);
  private offlineStorage = inject(OfflineStorageService);
  private offlineQueue = inject(OfflineQueueService);
  private offlineSync = inject(OfflineSyncService);
  private autoLogout = inject(AutoLogoutService);
  private cdr = inject(ChangeDetectorRef);
  private crudService = inject(CrudService);
  private network = inject(NetworkService);
  private tourService = inject(TourService);

  @Input() forkliftId: number | null = null;
  @Input() forkliftName = '';
  @Input() selectedWarehouse = '';

  //  Forklift บางคันอาจผูกได้หลาย WH (warehouse_code เป็น string เดียวคั่นด้วย comma) -> โชว์ตัวแรก + "+N more"
  //  กัน header พังถ้ามีหลายสิบ WH (เดิมโชว์ทั้งสตริงดิบตรงๆ) ดูทั้งหมดได้จาก title ตอน hover/กดค้าง
  private get _warehouseList(): string[] {
    return this.selectedWarehouse.split(',').map((w) => w.trim()).filter((w) => !!w);
  }

  //  แยกชื่อ WH หลักกับ "+N more" ออกจากกัน (คนละ getter) เพื่อให้ template ใส่ font-size เล็กกว่าเฉพาะส่วน +N more ได้
  //  (ใส่ font-size แยกกันไม่ได้ถ้ายังรวมเป็น string เดียวแบบเดิม)
  get warehousePrimary(): string {
    const list = this._warehouseList;
    return list.length > 1 ? list[0] : this.selectedWarehouse;
  }

  get warehouseMoreSuffix(): string {
    const list = this._warehouseList;
    return list.length > 1 ? `+${list.length - 1} more` : '';
  }

  get warehouseFullTitle(): string {
    return this._warehouseList.join(', ');
  }

  _clock: string = '';
  _timer: any;
  _isOnline = true;
  _lastSync = '-';
  _username = '';

  //  รอบแรก: เฉพาะงานธรรมดา (ดู scan-pallet.ts) — จำนวนแอคชั่นที่ยังไม่ได้ sync ขึ้นจริงกับ backend
  _queueCounts: QueueCounts = { get: 0, putAway: 0, reset: 0 };
  private _queueCountsSub?: Subscription;
  private _onlineSub?: Subscription;

  //  true = หน้าปัจจุบัน register tour ไว้กับ TourService (ดู comment ในนั้น) -> คุมโชว์/ซ่อนปุ่ม "?" ตรงนี้
  _hasTour = false;
  private _tourSub?: Subscription;

  //  เรียกจาก NetworkService.online$ ตอนสถานะเปลี่ยน (health check api/v1/health ไม่ใช่ navigator.onLine)
  //  auto-sync ผ่าน shouldAutoSync() -> ทำแค่ครั้งแรกของรอบ online นี้ กัน popup เด้งซ้ำๆ (header ถูกสร้างใหม่ทุก
  //  หน้า + บาง browser ยิง event online ซ้ำได้เอง) อยากลองใหม่อีกต้องกดปุ่ม "ลองส่งอีกครั้ง" เอง (onClickQueueList)
  private _onlineListener = () => {
    this._isOnline = true;
    this.updateClock();
    if (this.offlineSync.shouldAutoSync()) this.runOfflineSync();
  };

  private _offlineListener = () => {
    this._isOnline = false;
    this._lastSync = this._clock;
    this.offlineSync.markOffline();
  };

  //  โชว์ queue ตลอด (ค่าจริงจาก counts$) รวมถึงตอนเป็น 0 -> ไม่ซ่อน ไม่ mock
  get _queueSummaryText(): string {
    return `รับ ${this._queueCounts.get} • วาง ${this._queueCounts.putAway} • ลบ ${this._queueCounts.reset}`;
  }

  get _queuePendingTotal(): number {
    return this._queueCounts.get + this._queueCounts.putAway + this._queueCounts.reset;
  }

  //  Component Build Up Event
  async ngOnInit() {
    this._isOnline = this.network.isOnline;

    //  header สร้างใหม่ทุกหน้า (ไม่ใช่ shell เดียวทั้งแอป) รวมถึงตอน login ใหม่โดยไม่ reload ทั้งแอป -> ต้องเรียกซ้ำ
    //  ทุกครั้งเพื่อ arm timer ให้ถูกต้อง (AutoLogoutService เป็น singleton, constructor รันแค่ครั้งแรกครั้งเดียว)
    this.autoLogout.ensureArmed();

    const storedUserInfo = sessionStorage.getItem('_USER_INFO');
    if (storedUserInfo) {
      try {
        const userInfo: Type.UserSessionInfo = JSON.parse(storedUserInfo);
        this._username = userInfo.userId || userInfo.userName || '';
      } catch (err) {
        console.error('ไม่สามารถ parse ข้อมูล user จาก session ได้:', err);
      }
    }

    const storedForkliftId = sessionStorage.getItem('_FORKLIFT_ID');

    if (this.forkliftId == null && storedForkliftId) {
      const parsedForkliftId = Number(storedForkliftId);

      if (!Number.isNaN(parsedForkliftId)) {
        this.forkliftId = parsedForkliftId;
      }
    }

    this.forkliftName =
      this.forkliftName ||
      sessionStorage.getItem('_FORKLIFT_NAME') ||
      'None';

    this.selectedWarehouse =
      this.selectedWarehouse ||
      sessionStorage.getItem('_SELECTED_WAREHOUSE') ||
      'None';

    this.updateClock();

    this._timer = setInterval(() => {
      this.updateClock();
    }, 1000);

    //  แสดง badge จำนวนแอคชั่นที่รอ sync แบบ real-time (มาจาก OfflineQueueService โดยตรง ไม่ต้อง poll เอง)
    this._queueCountsSub = this.offlineQueue.counts$.subscribe((counts) => {
      this._queueCounts = counts;
      this.cdr.detectChanges();
    });

    //  <app-header> อยู่แยกทุกหน้า -> เปลี่ยนหน้าทีคือสร้าง HeaderComponent ใหม่ทุกที ต้อง unsubscribe ตอน destroy
    //  เสมอ ไม่งั้น subscription ค้างสะสม ทำให้กลับมา online 1 ครั้งจริง กลับ trigger sync ซ้อนกันหลายรอบ
    //  skip(1): ข้ามค่าปัจจุบันที่ BehaviorSubject ส่งมาตอน subscribe (ตั้ง _isOnline ไว้ข้างบนแล้ว) รับเฉพาะตอนเปลี่ยน
    this._onlineSub = this.network.online$.pipe(skip(1)).subscribe((online) => {
      if (online) this._onlineListener();
      else this._offlineListener();
      this.cdr.detectChanges();
    });

    this._tourSub = this.tourService.hasTour$.subscribe((has) => {
      this._hasTour = has;
      this.cdr.detectChanges();
    });

    //  เผื่อเปิดแอปขึ้นมาใหม่ตอนออนไลน์อยู่แล้ว แต่มี queue ค้างจากรอบก่อน (เช่นปิดแอประหว่าง offline) -> ลอง sync
    //  ทันทีตั้งแต่เปิดหน้า แต่ผ่าน shouldAutoSync() เหมือนกัน กัน popup เด้งซ้ำทุกครั้งที่เปลี่ยนหน้า (header ถูก
    //  สร้างใหม่ทุกหน้า ngOnInit นี้เลยรันบ่อยกว่าที่คิด ไม่ใช่แค่ตอนเปิดแอปจริงๆ)
    //  ping health ก่อนเสมอ -> ตอนเปิดแอปใหม่ _isOnline ยังเป็นค่าจาก navigator.onLine (health check รอบแรกยังไม่กลับมา)
    //  ถ้า sync เลยตอน WiFi ต่อได้แต่ไปไม่ถึง server ทุกรายการจะ fail แล้วโชว์ popup ซิงค์ไม่สำเร็จ + เสีย flag รอบนี้ไปฟรีๆ
    if (await this.network.check() && this.offlineSync.shouldAutoSync()) {
      this.runOfflineSync();
    }
  }

  //  Component Destroy Event
  ngOnDestroy() {
    if (this._timer) {
      clearInterval(this._timer);
    }
    this._queueCountsSub?.unsubscribe();
    this._onlineSub?.unsubscribe();
    this._tourSub?.unsubscribe();
  }

  //  ปุ่ม "?" เรียก tour ของหน้าปัจจุบัน (ถ้ามี register ไว้ -> ดู TourService) ไม่รู้/ไม่สนว่าหน้าไหนมี step อะไรบ้าง
  onClickHelpTour(): void {
    this.tourService.start();
  }

  //  ไล่ sync queue ที่ค้างอยู่ (รอบแรก: เฉพาะงานธรรมดา) แล้วสรุปผลด้วย SweetAlert ให้ operator เห็นชัดๆ ว่างานไหนสำเร็จ/ไม่สำเร็จกี่ pallet
  //  ถ้า queue ว่างอยู่แล้วไม่ต้องแจ้งอะไรเลย (ไม่ใช่ข้อมูลใหม่)
  private async runOfflineSync(): Promise<void> {
    const result = await this.offlineSync.syncAll();
    if (result.succeeded.length === 0 && result.failed.length === 0) return;

    //  format เดียวกับ modal รายการคิว (onClickQueueList) -> แถวเรียบๆ คั่นเส้นบาง ไม่มีการ์ดสี ให้ดู consistent กัน
    const formatSucceededRow = (s: SyncJobSummary): string => {
      const parts: string[] = [];
      if (s.get > 0) parts.push(`รับ ${s.get} พาเลท`);
      if (s.putAway > 0) parts.push(`วาง ${s.putAway} พาเลท`);
      if (s.reset > 0) parts.push(`ลบ ${s.reset} พาเลท`);
      return `<div style="text-align:left;padding:8px 0;border-bottom:1px solid #eee;">
        <b>งาน ${s.systemNo}</b><br>
        <span style="color:#666;font-size:14px;">${parts.join(', ')}</span>
      </div>`;
    };

    const actionLabel: Record<string, string> = { get: 'รับ', putAway: 'วาง', reset: 'ลบ' };
    //  รายตัว พร้อม message จาก BE (หรือเหตุผล chain-block) -> operator รู้ว่าพาเลทไหนพังเพราะอะไรจริงๆ
    //  ไม่ใช่แค่ตัวเลขรวมเหมือนฝั่งสำเร็จ (ซึ่งไม่จำเป็นต้องรู้รายละเอียดเพราะผ่านแล้ว)
    const formatFailedRow = (f: SyncFailedItem): string =>
      `<div style="text-align:left;padding:8px 0;border-bottom:1px solid #eee;">
        <b>งาน ${f.systemNo}</b> — ${actionLabel[f.actionType] ?? f.actionType}ไม่สำเร็จ<br>
        <span style="color:#666;font-size:17px;">${f.palletCode}</span><br>
        <span style="color:#d32f2f;font-size:17px;">เหตุผล: ${f.message}</span>
      </div>`;

    const sections: string[] = [];
    if (result.succeeded.length > 0) {
      sections.push('<div style="text-align:left;font-weight:700;margin:4px 0;">ซิงค์สำเร็จ</div>');
      sections.push(...result.succeeded.map(formatSucceededRow));
    }
    if (result.failed.length > 0) {
      sections.push('<div style="text-align:left;font-weight:700;color:#d32f2f;margin:14px 0 4px;">ซิงค์ไม่สำเร็จ (กรุณาตรวจสอบ)</div>');
      sections.push(...result.failed.map(formatFailedRow));
    }

    Swal.fire({
      icon: result.failed.length > 0 ? 'warning' : 'success',
      title: 'กลับมาออนไลน์แล้ว',
      html: `<div style="max-height:400px;overflow-y:auto;">${sections.join('')}</div>`,
      confirmButtonText: 'ตกลง',
      //  ใช้ class กว้างเดียวกับ modal รายการคิว (queue-list-popup ใน styles.css) กัน .swal2-popup global
      //  (width: 90vw !important; max-width: 650px;) บีบแคบเกินไปเหมือนที่เจอมาก่อนหน้า
      customClass: { popup: 'queue-list-popup' },
    });
  }

  //  กดที่ส่วน "คิว" บน header -> โชว์ list รายละเอียดของทุก action ที่ยังค้าง sync อยู่ ให้เห็นว่าค้างงานไหน/
  //  pallet ไหนบ้าง แทนที่จะเห็นแค่ตัวเลขสรุปบน badge + ปุ่ม "ลองส่งอีกครั้ง" สั่ง sync ทั้งคิวใหม่ได้เลยโดยไม่ต้อง
  //  รอ event online/reload หน้า (เรียก runOfflineSync() ตัวเดียวกับที่ auto sync ใช้ -> เรียง seq ถูกต้องอยู่แล้ว
  //  ไม่ทำ resend รายตัวแยก เพราะจะข้าม chain dependency ของ pallet เดียวกันได้)
  async onClickQueueList(): Promise<void> {
    const actions = await this.offlineQueue.getAll();
    const actionLabel: Record<string, string> = { get: 'รับ', putAway: 'วาง', reset: 'ลบ' };

    //  signature ใหม่: badge ไอคอน sync ไล่เฉดฟ้า-กรมท่า + checkmark ป๊อปขึ้นมุมล่างขวา (ต่างจากแบบ manifest board เดิม)
    //  inline ทั้งหมดเพราะ SweetAlert popup อยู่นอก view encapsulation ของ component ปกติ (prefix qlm2- กันชนกับ CSS จริง)
    const emptyStateHtml = `
      <style>
        .qlm2-wrap { text-align:center; padding:34px 12px 10px; }
        .qlm2-badge { position:relative; width:84px; height:84px; margin:0 auto 18px; border-radius:22px; background:linear-gradient(135deg,#25a3dd,#181365); display:flex; align-items:center; justify-content:center; box-shadow:0 10px 24px rgba(24,19,101,.22); animation: qlm2-pop .45s cubic-bezier(.34,1.56,.64,1) both; }
        .qlm2-badge .material-icons { font-size:40px; color:#fff; }
        .qlm2-check { position:absolute; bottom:-6px; right:-6px; width:30px; height:30px; border-radius:50%; background:#0e8f2e; border:3px solid #fff; display:flex; align-items:center; justify-content:center; opacity:0; animation: qlm2-check-in .35s ease-out .4s both; }
        .qlm2-check .material-icons { font-size:16px; color:#fff; }
        .qlm2-title { font-size:25px; font-weight:700; color:#181365; margin:0; }
        .qlm2-message { font-size:25px; color:#8890b5; margin:8px 0 0; }
        @keyframes qlm2-pop { 0% { opacity:0; transform:scale(.6) rotate(-8deg); } 100% { opacity:1; transform:scale(1) rotate(0); } }
        @keyframes qlm2-check-in { 0% { opacity:0; transform:scale(0); } 100% { opacity:1; transform:scale(1); } }
      </style>
      <div class="qlm2-wrap">
        <div class="qlm2-badge">
          <span class="material-icons">sync</span>
          <span class="qlm2-check"><span class="material-icons">check</span></span>
        </div>
        <h3 class="qlm2-title">ไม่มีรายการค้างซิงค์</h3>
        <p class="qlm2-message">ซิงค์ครบหมดแล้ว ทุกรายการอัปเดตขึ้นระบบแล้ว</p>
      </div>`;

    //  สรุปจำนวนแยกตามประเภท โชว์ไว้บนสุดก่อน list ให้เห็นภาพรวมเร็วๆ ไม่ต้องไล่นับเอง แยกสีตามความหมาย
    //  (รับ=ฟ้า เป็นกลาง, วาง=เขียว ใกล้เสร็จงาน, ลบ=แดง ให้เข้าชุดกับปุ่ม "ลบ" รายตัวด้านล่าง)
    const countOf = (type: 'get' | 'putAway' | 'reset') => actions.filter((a) => a.actionType === type).length;
    const summaryColor: Record<'get' | 'putAway' | 'reset', { bg: string; color: string }> = {
      get: { bg: '#eef6fc', color: '#1565c0' },
      putAway: { bg: '#eafaf0', color: '#0e8f2e' },
      reset: { bg: '#fdecea', color: '#d32f2f' },
    };
    const summaryHtml = actions.length === 0 ? '' : `
      <div style="display:flex;gap:10px;margin-bottom:14px;">
        ${(['get', 'putAway', 'reset'] as const).map((type) => `
          <div style="flex:1;text-align:center;padding:12px 6px;border-radius:10px;background:${summaryColor[type].bg};">
            <div style="font-size:18px;font-weight:600;color:${summaryColor[type].color};">${actionLabel[type]}</div>
            <div style="font-size:26px;font-weight:700;color:${summaryColor[type].color};">${countOf(type)}</div>
          </div>`).join('')}
      </div>`;

    const rows = actions.length === 0
      ? emptyStateHtml
      : actions.map((a) => {
        //  ปี ค.ศ. ตรงๆ (ไม่ใช่ พ.ศ. ที่ toLocaleDateString('th-TH') จะแปลงให้อัตโนมัติ) ใช้ pattern เดียวกับ
        //  formatDateTime ของหน้า login (DD/MM/YYYY)
        const queuedDate = new Date(a.queuedAt);
        const pad = (n: number) => String(n).padStart(2, '0');
        const date = `${pad(queuedDate.getDate())}/${pad(queuedDate.getMonth() + 1)}/${queuedDate.getFullYear()}`;
        const time = `${pad(queuedDate.getHours())}:${pad(queuedDate.getMinutes())}:${pad(queuedDate.getSeconds())}`;
        return `<div style="text-align:left;padding:8px 0;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="min-width:0;">
            <b>งาน ${a.systemNo}</b> — ${actionLabel[a.actionType] ?? a.actionType}<br>
            <span style="color:#666;font-size:18px;word-break:break-all;">${a.palletCode} • ${date} ${time}</span>
          </div>
          <button type="button" class="qlm-clear-btn" data-id="${a.id}" style="flex-shrink:0;border:none;background:#fdecea;color:#d32f2f;font-size:20px;font-weight:700;padding:16px 48px;border-radius:12px;cursor:pointer;">ลบ</button>
        </div>`;
      }).join('');

    const result = await Swal.fire({
      title: `รายการค้างซิงค์ (${actions.length})`,
      html: `${summaryHtml}<div style="max-height:400px;overflow-y:auto;">${rows}</div>`,
      confirmButtonText: 'ปิด',
      confirmButtonColor: '#6b7280',
      showDenyButton: actions.length > 0,
      denyButtonText: 'ลองส่งอีกครั้ง',
      denyButtonColor: '#181365',
      //  styles.css มี .swal2-popup { width: 90vw !important; max-width: 650px; } แบบ global ทุก Swal ในแอป
      //  (กัน modal ทั่วไปกว้างเกิน) ต้องชนด้วย customClass เจาะจงกว่าถึงจะทับได้ (ดู .queue-list-popup ใน styles.css
      //  ที่ตั้ง width จริงไว้ ไม่ใส่ width ตรงนี้ซ้ำเพราะ CSS !important ทับ inline style อยู่แล้ว)
      customClass: { popup: 'queue-list-popup' },
      //  ปุ่ม "ลบ" รายตัวเป็น <button> ดิบใน html ไม่ใช่ Angular template -> ผูก click event เองตอน popup เปิดเสร็จ
      didOpen: (popup) => {
        popup.querySelectorAll<HTMLButtonElement>('.qlm-clear-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.dataset['id'] ?? '';
            const target = actions.find((a) => a.id === id);
            if (target) this.onClickClearQueueItem(target);
          });
        });
      },
    });

    if (!result.isDenied) return;

    if (!this._isOnline) {
      Swal.fire({ icon: 'warning', title: 'ไม่มีสัญญาณ', text: 'กรุณาเชื่อมต่อเน็ตก่อนลองส่งใหม่อีกครั้ง' });
      return;
    }

    await this.runOfflineSync();
  }

  //  ลบรายการเดียวทิ้งจาก queue ถาวร (กู้คืนไม่ได้) -> ต้อง confirm ก่อนเสมอ พร้อมเตือนชัดๆ ว่าให้แก้ไขข้อมูลใน
  //  backend ให้ตรงกับความเป็นจริงก่อนเท่านั้น เพราะพาเลทอาจถูกวาง/สแกนจริงไปแล้ว ระบบแค่ยังไม่รู้ (คุยกันไว้ก่อนหน้า)
  //  ลบแค่รายการที่เลือกตัวเดียว ไม่พ่วง action อื่นของ pallet เดียวกัน (ตัดสินใจแล้วว่าไม่ต้อง cascade)
  private async onClickClearQueueItem(target: QueuedAction): Promise<void> {
    const actionLabel: Record<string, string> = { get: 'รับ', putAway: 'วาง', reset: 'ลบ' };

    const confirm = await Swal.fire({
      icon: 'warning',
      title: 'ยืนยันการลบรายการนี้?',
      html: `งาน ${target.systemNo} — ${actionLabel[target.actionType] ?? target.actionType}<br>`
        + `<span style="font-size:13px;color:#666;word-break:break-all;">${target.palletCode}</span>`
        + `<br><br><b style="color:#d32f2f;">ใช้เมื่อแก้ไขข้อมูลใน backend ให้ตรงกับความเป็นจริงแล้วเท่านั้น</b> ไม่งั้นระบบจะไม่มีบันทึกเลยว่าพาเลทนี้อยู่ที่ไหน`,
      showCancelButton: true,
      confirmButtonText: 'ยืนยันลบ',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#d32f2f',
    });

    if (!confirm.isConfirmed) return;

    await this.offlineQueue.remove(target.id);

    await Swal.fire({ icon: 'success', title: 'ลบแล้ว', timer: 1200, showConfirmButton: false });
    await this.onClickQueueList();
  }

  //  Update Clock Function If Online
  private updateClock() {
    if (this._isOnline) {
      this._clock = new Date().toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    }

    this.cdr.detectChanges();
  }

  //  Logout Button Event
  onLogout() {
    //  ยังมีแอคชั่นค้าง sync อยู่ -> ห้าม logout ก่อน กันเครื่องอื่น/คนอื่น login ทับแล้วลืมว่ามีงานค้างไม่ถูก sync ขึ้น backend
    //  (เช็คจากจำนวน queue ไม่ใช่สถานะ online เฉยๆ เพราะ queue ว่างแต่ offline ก็ logout ได้ปกติ ไม่มีอะไรจะเสีย)
    if (this._queuePendingTotal > 0) {
      Swal.fire({
        icon: 'warning',
        title: 'ยังออกจากระบบไม่ได้',
        text: `ยังมีรายการที่ยังไม่ได้ซิงค์ขึ้นระบบ (${this._queuePendingTotal} รายการ) กรุณากลับมาออนไลน์เพื่อซิงค์ให้เสร็จก่อนออกจากระบบ`,
      });
      return;
    }

    Swal.fire({
      title: 'ต้องการออกจากระบบหรือไม่?',
      text: 'คุณกำลังจะออกจากระบบการทำงาน',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#6a9fd1',
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true
    }).then((result) => {
      if (result.isConfirmed) {
        //  Open loading dialog
        const screenWidth = window.innerWidth;
        const dialogWidth = screenWidth < 600 ? '95%' : '60%';

        const dialogRef = this.dialog.open(Dialogloading, {
          width: dialogWidth,
          height: 'auto',
          maxHeight: '90vh',
          disableClose: true,
        });

        setTimeout(() => {
          //  ดึง forkliftId ไว้ก่อนเคลียร์ session -> ยิง checkout stamp กับหลังบ้าน (รอผลก่อนจบ logout จริง ไม่ว่าสำเร็จ/ล้มเหลว)
          const forkliftId = Number(sessionStorage.getItem('_FORKLIFT_ID')) || 0;
          const currentUserId = Number(localStorage.getItem('userId')) || 0;

          const finishLogout = () => {
            this.autoLogout.stop();
            sessionStorage.removeItem('_ACCESS_TOKEN');
            sessionStorage.removeItem('_SELECTED_WAREHOUSE');
            sessionStorage.removeItem('_FORKLIFT_NAME');
            sessionStorage.removeItem('_FORKLIFT_ID');
            dialogRef.close();
            // Swal.fire({
            //   icon: 'success',
            //   title: 'สำเร็จ',
            //   text: 'ออกจากระบบเรียบร้อยแล้ว',
            //   showConfirmButton: false,
            //   timer: 800,
            //   allowOutsideClick: false,
            //   allowEscapeKey: false
            // });
            this.router.navigate(['/']);
          };

          if (!forkliftId) {
            finishLogout();
            return;
          }

          this.crudService.CheckoutForklift(forkliftId, { updateBy: currentUserId }).subscribe({
            next: finishLogout,
            error: (err) => {
              console.error('Checkout forklift error:', err);
              finishLogout();
            },
          });
        }, 800);
      }
    });
  }
}