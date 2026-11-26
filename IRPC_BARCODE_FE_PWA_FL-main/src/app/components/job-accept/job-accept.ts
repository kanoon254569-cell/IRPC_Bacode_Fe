import { Component, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';
import { driver, DriveStep } from 'driver.js';
import { DateAdapter, NativeDateAdapter } from '@angular/material/core';
import { CrudService } from '../../service/crud.service';
import { OfflineStorageService } from '../../service/offline-storage.service';
import { ScanPalletLogicService } from '../../service/scan-pallet-logic.service';
import { NewJobAlertService } from '../../service/new-job-alert.service';
import { NetworkService } from '../../service/network.service';
import { TourService } from '../../service/tour.service';
import * as Type from '../../../models/variables-type';

//  บังคับ format วันที่ในช่อง datepicker เป็น dd/mm/yyyy ตรงๆ (ไม่พึ่ง Intl locale เพราะ en-GB บาง browser
//  ไม่ได้ format เป็น dd/mm/yyyy เสมอไป)
class DdMmYyyyDateAdapter extends NativeDateAdapter {
  override format(date: Date, _displayFormat: unknown): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}

@Component({
  selector: 'app-job-accept',
  standalone: false,
  templateUrl: './job-accept.html',
  styleUrl: './job-accept.css',
  providers: [{ provide: DateAdapter, useClass: DdMmYyyyDateAdapter }],
})

export class JobAccept implements OnDestroy {

  //  ข้อความแทนที่ Location ที่ backend ไม่ได้ส่งมาให้ (เดิมใช้ "-" เปลี่ยนเป็นข้อความนี้ให้อ่านง่ายกว่า)
  private readonly NO_LOCATION_LABEL = 'ไม่ระบุ';

  //  คำอธิบาย Tag แต่ละแบบ (กดที่ Tag บนการ์ดงานเพื่อดู) จับคู่ตาม mapJobTag ด้านล่าง
  //  BK ในทางปฏิบัติหมายถึง Breakage & Replacement อย่างเดียว (เคส typeTopic 'Booking' ใน mapJobTag เป็นโค้ดตาย ไม่เคยถูกใช้จริง)
  //  bg/fg ก๊อปสีมาจาก .tag-* ใน job-accept.css ตรงๆ (modal ของ SweetAlert ไม่กิน style encapsulation ของ Angular
  //  เลยอ้างอิง class เดิมไม่ได้ ต้องแปะสีซ้ำที่นี่ -> แก้สี Tag ใน css แล้วอย่าลืมแก้ตรงนี้ด้วย)
  private readonly JOB_TAG_INFO: Record<string, { name: string; desc: string; bg: string; fg: string }> = {
    IN: { name: 'Inbound', desc: 'งานรับสินค้าเข้าคลัง', bg: '#14a318', fg: '#fff' },
    OUT: { name: 'Outbound', desc: 'งานนำสินค้าออกจากคลัง', bg: '#f8c538', fg: '#000' },
    RQ: { name: 'Request', desc: 'งานเบิกสินค้า', bg: '#1d4ed8', fg: '#fff' },
    SP: { name: 'Special Package', desc: 'งาน Special Package', bg: '#6236C9', fg: '#fff' },
    BK: { name: 'Breakage & Replacement', desc: 'งานเปลี่ยนเเตก', bg: '#f87b38', fg: '#000' },
    IT: { name: 'Internal Transfer', desc: 'งานย้ายสินค้าในคลังเดียวกัน', bg: '#0d9488', fg: '#fff' },
    TW: { name: 'Transfer WH', desc: 'งานย้ายสินค้าข้ามคลัง', bg: '#db2777', fg: '#fff' },
  };

  _jobCardData: any[] = [];
  _isLoading = true;

  //  Filter State (multiple select -> ว่าง = ไม่กรอง/ทั้งหมด)
  _selectedStatus: number[] = [];
  _selectedJobType: number[] = [];
  //  default วันที่ปัจจุบัน ตอนเข้าหน้าครั้งแรก (ไม่ต้องรอ API เหมือน default status เพราะรู้ค่าอยู่แล้ว)
  _selectedDate: Date | null = new Date();

  //  API
  _ResponseProcessGetForkliftJob!: Type.ResponseProcessGetForkliftJob;
  _ResponseProcessCbJobStatus?: Type.ResponseProcessCbJobStatus;
  _ResponseProcessCbJobType?: Type.ResponseProcessCbJobType;

  //  Offline Cache Key (Unique Per Page/Feature)
  private readonly CACHE_KEY = 'forklift_job_data';

  //  ค่า Default ของ Dropdown Status ตอนเข้าหน้าครั้งแรก (จับคู่จาก status.name ที่ backend ส่งมา)
  private readonly DEFAULT_STATUS_NAMES = ['WH Approved', 'In Progress'];

  private newJobSub?: Subscription;
  private reconnectSub?: Subscription;

  //  Condtructor
  constructor(
    private router: Router,
    private restService: CrudService,
    private cdr: ChangeDetectorRef,
    private offlineStorage: OfflineStorageService,
    private scanLogic: ScanPalletLogicService,
    private newJobAlertService: NewJobAlertService,
    private network: NetworkService,
    private tourService: TourService,
  ) { }

  //  ngOnInit
  ngOnInit() {
    //  Call API
    this.fetchProcessGetForkliftJob();
    this.fetchProcessCbJobStatus();
    this.fetchProcessCbJobType();

    //  Auto Re-fetch When Back Online (health check กลับมาผ่าน) -> unsubscribe ตอน destroy กัน fetch ซ้อนหลายรอบ
    this.reconnectSub = this.network.reconnected$.subscribe(() => this.fetchProcessGetForkliftJob());

    //  งานใหม่เข้ามาตอนเปิดหน้านี้อยู่พอดี (NewJobAlertService poll เจอ) -> โผล่การ์ดขึ้นมาในลิสต์ตรงนี้เลย ไม่ต้องรอ
    //  fetch รอบถัดไป ไม่ต้องเปิดดูผ่าน badge ลอยก่อน เงื่อนไข: ต้องตรงกับ filter (Status/Job Type/วันที่) ที่กำลังดูอยู่
    //  เท่านั้น (เหมือนงานเก่าที่ไม่ตรง filter ก็ไม่โผล่เหมือนกัน) ไม่ตรง -> ยังเห็นผ่าน badge/กระดิ่งได้ตามปกติ
    this.newJobSub = this.newJobAlertService.newJob$.subscribe((alert) => {
      if (!alert.raw || !this.jobMatchesCurrentFilters(alert.raw)) return;
      if (this._jobCardData.some((j) => j._raw?.id === alert.raw.id)) return;

      this._jobCardData = this.sortJobCards([this.mapJobCard(alert.raw), ...this._jobCardData]);
      this.cdr.markForCheck();
    });

    //  บอก header (component กลาง) ว่าหน้านี้มี tour ให้โชว์ปุ่ม "?" ให้ -> ดู TourService
    this.tourService.register(() => this.startTour());
  }

  ngOnDestroy(): void {
    this.newJobSub?.unsubscribe();
    this.reconnectSub?.unsubscribe();
    this.tourService.register(null);
  }

  //  เช็คว่า raw job ตรงกับตัวกรอง (Status/Job Type/วันที่) ที่กำลังเลือกดูอยู่ในหน้านี้หรือไม่
  //  วันที่: create_datetime เป็น พ.ศ. (เช่น "8/10/2569") ต้องลบ 543 ก่อนเทียบกับ _selectedDate (ค.ศ. จริง)
  //  ห้ามใช้ parseThaiDatetime เดิม (ด้านบน) เพราะตัวนั้นตั้งใจไม่แปลง พ.ศ.->ค.ศ. ใช้แค่เรียงลำดับเทียบกันเองได้พอ
  private jobMatchesCurrentFilters(raw: any): boolean {
    if (this._selectedStatus.length > 0 && !this._selectedStatus.includes(raw.status_id)) return false;
    if (this._selectedJobType.length > 0 && !this._selectedJobType.includes(raw.type_id)) return false;

    if (this._selectedDate) {
      const [day, month, buddhistYear] = String(raw.create_datetime ?? '').split(' ')[0].split('/').map(Number);
      if (!day || !month || !buddhistYear) return false;

      const sameDay = (buddhistYear - 543) === this._selectedDate.getFullYear()
        && (month - 1) === this._selectedDate.getMonth()
        && day === this._selectedDate.getDate();
      if (!sameDay) return false;
    }

    return true;
  }

  //  Fetch CB Job Status
  //  ใช้ department_id ของ user ที่ login (เก็บไว้ใน sessionStorage '_USER_INFO') เป็น query param userType
  fetchProcessCbJobStatus() {
    const departmentId = this.loadUserDepartmentId();

    this.restService.GetProcessCbJobStatus(departmentId).subscribe({
      next: (data: Type.ResponseProcessCbJobStatus) => {
        try {
          if (data == undefined) return;

          if (data.status == 'success') {
            this._ResponseProcessCbJobStatus = data;
            this.applyDefaultStatusFilter(data.data);
            this.cdr.markForCheck();
          } else {
            this.SweetAlert('warning', 'ไม่สามารถโหลดตัวกรองสถานะงานได้: ' + data.message);
          }
        } catch (error) {
          console.log(error);
        }
      },
      //  เส้นนี้ (CBSites job-status) คนละ service กับ forklift job list -> ล้มแค่ dropdown filter นี้ ไม่กระทบ
      //  รายการงานจริง ห้าม fallback ไปโหลด cache ของ job list (loadFromCacheAndRender) หรือแตะ _isLoading ของหน้า
      //  (เป็นของ fetchProcessGetForkliftJob เท่านั้น) กันโชว์ modal "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" ที่หมายถึงงาน ทั้งที่จริงๆ
      //  โหลดงานได้ปกติ แค่ dropdown นี้พังเฉยๆ (เคยเกิดจริง: backend เส้นนี้ SQL connection error แต่เส้น job list ปกติ)
      error: (error: any) => {
        console.log(error);
        this.SweetAlert('warning', 'ไม่สามารถโหลดตัวกรองสถานะงานได้ กรุณาลองใหม่อีกครั้ง');
      }
    });
  }

  //  ตั้งค่า default ของ dropdown Status เป็น "WH Approved" + "In Progress" ตอนโหลดหน้าครั้งแรกเท่านั้น
  //  (ถ้าผู้ใช้เลือกเองไปแล้วจะไม่ทับ) แล้วยิง fetch งานใหม่ตามค่า default นี้
  private applyDefaultStatusFilter(statusList: Type.ResultProcessCbJobStatus[]): void {
    if (this._selectedStatus.length > 0) return;

    const defaultIds = statusList
      .filter((s) => this.DEFAULT_STATUS_NAMES.some((name) => name.toLowerCase() === (s.name ?? '').trim().toLowerCase()))
      .map((s) => s.id);

    if (defaultIds.length === 0) return;

    this._selectedStatus = defaultIds;
    this.fetchProcessGetForkliftJob();
  }

  //  Fetch CB Job Type
  fetchProcessCbJobType() {
    this.restService.GetProcessCbJobType().subscribe({
      next: (data: Type.ResponseProcessCbJobType) => {
        try {
          if (data == undefined) return;

          if (data.status == 'success') {
            this._ResponseProcessCbJobType = data;
            this.cdr.markForCheck();
          } else {
            this.SweetAlert('warning', 'ไม่สามารถโหลดตัวกรองประเภทงานได้: ' + data.message);
          }
        } catch (error) {
          console.log(error);
        }
      },
      //  เส้นนี้ (CBSites job-type) คนละ service กับ forklift job list เหมือนกัน -> ดู comment เดียวกันใน
      //  fetchProcessCbJobStatus ด้านบน
      error: (error: any) => {
        console.log(error);
        this.SweetAlert('warning', 'ไม่สามารถโหลดตัวกรองประเภทงานได้ กรุณาลองใหม่อีกครั้ง');
      }
    });
  }

  //  กัน race condition: ngOnInit ยิง fetch งานแบบไม่กรองไปก่อน แล้ว default status filter (applyDefaultStatusFilter)
  //  ยิงซ้ำอีกรอบแบบกรองตามหลัง -> ถ้ารอบแรก (ไม่กรอง) ตอบช้ากว่ารอบหลัง (กรองแล้ว) จะทับผลลัพธ์ที่กรองแล้วทิ้ง
  //  ให้ยึด requestId ล่าสุดเท่านั้น ผลตอบกลับของ request ที่เก่ากว่าปัจจุบันทิ้งไปเลย
  private _jobFetchRequestId = 0;

  //  Fetch Forklift Job API
  fetchProcessGetForkliftJob() {
    this._isLoading = true;
    const requestId = ++this._jobFetchRequestId;

    //  Offline -> Load From Cache Directly, Skip API Call
    if (!this.offlineStorage.isOnline()) {
      this.loadFromCacheAndRender('ออฟไลน์ — แสดงข้อมูลล่าสุดที่บันทึกไว้');
      return;
    }

    const forkliftId = Number(sessionStorage.getItem('_FORKLIFT_ID') || '1');
    const typeIds = this._selectedJobType.length ? this._selectedJobType.join(',') : undefined;
    const statusIds = this._selectedStatus.length ? this._selectedStatus.join(',') : undefined;
    const date = this._selectedDate ? this.formatDateParam(this._selectedDate) : undefined;

    this.restService.GetJobByForklift(forkliftId, typeIds, statusIds, date).subscribe({
      next: async (data: Type.ResponseProcessGetForkliftJob) => {
        if (requestId !== this._jobFetchRequestId) return;   //  มี fetch ใหม่กว่าแซงไปแล้ว ทิ้งผลลัพธ์นี้

        try {
          if (data == undefined) return;

          if (data.status != 'success') {
            this._isLoading = false;
            this.SweetAlert('error', 'Message : CBSites ' + data.message);
            return;
          }

          this._ResponseProcessGetForkliftJob = data;
          this._isLoading = false;

          //  Map API Response -> Template Data -> Sort (Urgent -> สถานะ -> วันที่สร้าง)
          this._jobCardData = this.mapAndSortJobs(data.data);

          //  Save Latest Data Into Offline Cache
          await this.offlineStorage.save(this.CACHE_KEY, data);

          //  แจ้ง Change Detector ให้เช็ครอบใหม่ (ทุก fetch ในหน้านี้ใช้ markForCheck ร่วมกัน กัน NG0100
          //  จากการที่ response ของ fetch อื่นมาถึงแล้วแต่ยังไม่เคยถูกเช็ค แล้วมาโผล่พร้อมกันตอน detectChanges แบบ sync)
          this.cdr.markForCheck();

        } catch (error) {
          this._isLoading = false;
          console.log(error);
        }
      },
      error: async (error: any) => {
        if (requestId !== this._jobFetchRequestId) return;   //  มี fetch ใหม่กว่าแซงไปแล้ว ทิ้งผลลัพธ์นี้

        console.log(error);
        this._isLoading = false;

        const apiErrorBody = error?.error;
        if (apiErrorBody && Array.isArray(apiErrorBody.data)) {
          this._jobCardData = [];
          this.cdr.markForCheck();
          return;
        }

        //  Fetch Failed (Network Error) -> Fallback To Cache
        await this.loadFromCacheAndRender('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — แสดงข้อมูลล่าสุดที่บันทึกไว้');
      }
    });
  }

  //  เปลี่ยนค่า Dropdown (Status / Job Type) -> ยิง API ใหม่ด้วย query param ที่เลือก
  onFilterChange(): void {
    this.fetchProcessGetForkliftJob();
  }

  //  แปลงเป็น YYYY-MM-DD ตามเวลา local (ไม่ใช้ toISOString() เพราะแปลงเป็น UTC วันที่อาจเพี้ยนได้)
  private formatDateParam(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  //  อ่าน department_id ของ user ที่ login จาก session (เก็บไว้ตอน login ใน login.component.ts)
  private loadUserDepartmentId(): string | undefined {
    try {
      const raw = sessionStorage.getItem('_USER_INFO');
      if (!raw) return undefined;
      const userInfo: Type.UserSessionInfo = JSON.parse(raw);
      return userInfo?.departmentId || undefined;
    } catch (err) {
      console.log(err);
      return undefined;
    }
  }

  //  ─── Map + Sort Helper (ใช้ร่วมกันทั้ง Fetch สด และ Fallback จาก Cache) ────

  private mapAndSortJobs(jobs: Type.ResultProcessGetForkliftJob[] | undefined): any[] {
    const mapped = (jobs || []).map((job) => this.mapJobCard(job));
    return this.sortJobCards(mapped);
  }

  //  ─── Sort Helpers ────────────────────────────────────────────

  //  จัดลำดับ Job Card: Urgent (ที่ยังไม่ complete) มาก่อน -> กลุ่มตามสถานะ (Complete ท้ายสุด) -> เรียงตามวันที่สร้าง
  private sortJobCards<T extends { isUrgent?: string; isComplete?: boolean; _raw?: any }>(list: T[]): T[] {
    return list.sort((a, b) => {
      //  1) Urgent (Y) มาก่อนเสมอ เว้นแต่งานนั้น complete แล้ว -> ให้ไปรวมกลุ่มกับงาน complete ปกติ (ข้อ 2)
      const aUrgent = (a.isUrgent === 'Y' && !a.isComplete) ? 0 : 1;
      const bUrgent = (b.isUrgent === 'Y' && !b.isComplete) ? 0 : 1;
      if (aUrgent !== bUrgent) return aUrgent - bUrgent;

      //  2) จัดกลุ่มตามสถานะ: In Progress -> Pending/SP Approve -> WH Approved -> Complete (ท้ายสุด)
      const aRank = this.statusRank(a._raw?.status_name);
      const bRank = this.statusRank(b._raw?.status_name);
      if (aRank !== bRank) return aRank - bRank;

      //  3) ในกลุ่มเดียวกัน เรียงตามวันที่สร้างงาน (เก่า -> ใหม่)
      const aTime = this.parseThaiDatetime(a._raw?.create_datetime);
      const bTime = this.parseThaiDatetime(b._raw?.create_datetime);
      return aTime - bTime;
    });
  }

  //  Map ชื่อสถานะ -> Rank ลำดับ (เลขน้อย = อยู่ก่อน, Complete ให้เลขสูงสุด = ท้ายสุด)
  private statusRank(statusName?: string): number {
    //  BE เปลี่ยนมาส่ง status_name เป็นไทยแล้ว (ยืนยันจาก GetProcessCbJobStatus: name_th) -> เทียบด้วยค่าไทยที่ส่งมาจริง
    //  'SP Approve' ยังไม่ยืนยันว่า BE เปลี่ยนเป็นไทยด้วยหรือเปล่า (ไม่อยู่ใน response cb status ที่ได้มา) เก็บแบบเดิมไว้ก่อน
    const order: { [key: string]: number } = {
      'กำลังดำเนินการ': 1,
      'รอดำเนินการ': 2,
      'SP Approve': 3,
      'คลังอนุมัติแล้ว': 4,
      'เสร็จสิ้น': 5,
    };
    //  สถานะที่ไม่รู้จัก (เผื่อมีเพิ่มในอนาคต) ให้แทรกก่อน Complete เสมอ
    return order[statusName ?? ''] ?? 4;
  }

  //  แปลชื่อสถานะเป็นไทยสำหรับแสดงผลเท่านั้น (ค่าดิบ job.jobStatus ยังเก็บ string ภาษาอังกฤษไว้เหมือนเดิม
  //  ใช้เทียบ ngClass/statusRank ต่อ ไม่กระทบ) สถานะที่ไม่รู้จัก (เผื่อมีเพิ่มในอนาคต) โชว์ค่าดิบแทน
  translateJobStatus(statusName?: string): string {
    //  Pending/WH Approved/In Progress/Complete ตัดออกจาก map นี้แล้ว -> BE ส่งเป็นไทยอยู่แล้ว (ยืนยันจาก name_th)
    //  fallback ด้านล่างโชว์ค่าดิบตรงๆ ถูกอยู่แล้วโดยไม่ต้อง map เหลือแค่ตัวที่ยังไม่ยืนยันว่า BE เปลี่ยนเป็นไทยหรือยัง
    const labels: { [key: string]: string } = {
      'SP Approve': 'ขนส่งอนุมัติแล้ว',
      'Mapping Do': 'กำลังจับคู่ DO',
    };
    return labels[statusName ?? ''] ?? (statusName ?? '');
  }

  //  Parse วันที่ไทย "d/m/พ.ศ. H:mm:ss" -> timestamp เปรียบเทียบได้
  //  หมายเหตุ: ไม่ต้องแปลง พ.ศ. -> ค.ศ. เพราะ offset (+543) เท่ากันทุก record ไม่กระทบลำดับการเรียง
  private parseThaiDatetime(value?: string | null): number {
    if (!value) return 0;

    const [datePart, timePart] = value.split(' ');
    if (!datePart) return 0;

    const [day, month, year] = datePart.split('/').map(Number);

    let hour = 0, minute = 0, second = 0;
    if (timePart) {
      const t = timePart.split(':').map(Number);
      hour = t[0] ?? 0;
      minute = t[1] ?? 0;
      second = t[2] ?? 0;
    }

    return new Date(year || 0, (month || 1) - 1, day || 1, hour, minute, second).getTime();
  }

  //  Load Cached Data From Offline Storage & Render To Screen
  private async loadFromCacheAndRender(message: string) {
    const cachedData = await this.offlineStorage.load<Type.ResponseProcessGetForkliftJob>(this.CACHE_KEY);

    if (!cachedData) {
      this._isLoading = false;
      this.SweetAlert('error', 'ไม่มีข้อมูลที่บันทึกไว้ และไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
      return;
    }

    this._isLoading = false;
    this._ResponseProcessGetForkliftJob = cachedData;
    this._jobCardData = this.mapAndSortJobs(cachedData.data);

    this.cdr.markForCheck();
    this.SweetAlert('warning', message);
  }

  //  Map Job Object From API -> Template Card Format
  //  หมายเหตุ: API ใช้ field ชื่อ total_qty / complete_qty / receive_qty (เปลี่ยนจาก total_pallet / complete_pallet / receive_pallet เดิม)
  //  แต่ property ภายใน object ที่ map ออกไป (total_pallet, complete_pallet) ยังคงชื่อเดิมไว้ เพื่อไม่กระทบ template (.html)
  mapJobCard(job: Type.ResultProcessGetForkliftJob) {
    const isPickingJob = job.type_name === 'Picking';
    const putLocation = this.getPutLocationFromItems(job.items);
    const jobAny = job as any;

    return {
      id: this.fallback(job.id),
      jobTag: this.mapJobTag(job.type_name, job.type_topic),
      jobNomber: this.fallback(job.system_no),
      jobGradeLot: this.buildJobGradeLot(job.items, job.pallets?.complete_pallet),
      jobStep: job.is_multi_fl === 'Y' ? 2 : 1,
      getLocation: this.getLocationFromItems(job.items),
      //  งาน Picking ที่ยังไม่ได้ put พาเลตแรก -> ยังไม่มี to_locations มาให้ ให้ขึ้น "Preparing Zone" แทน
      putLocation: (isPickingJob && this.isEmptyLocation(putLocation))
        ? ['P.Zone']
        : putLocation,
      jobStatus: this.fallback(job.status_name),
      jobQtyProgress: `${this.fallback(jobAny.complete_qty)}/${this.fallback(jobAny.total_qty)}`,
      unit: job.movement_unit,
      isUrgent: job.is_urgent,
      isPickingJob: isPickingJob,   // <-- เก็บไว้เผื่อใช้ใน HTML ต่อ (เช่น style ต่างกัน)
      //  Put กดได้ ถ้ามี pallet ที่ get (receive) หรือ complete ไปแล้วอย่างน้อย 1
      //  งาน Special: หรือมีคนอื่นกด "ส่งให้ Step 2" เตรียมถุงไว้ให้แล้ว (อยู่ใน pallets.prepare_pallet) ก็กด Put ได้เหมือนกัน
      //  แม้ตัวเองยังไม่เคย Get เลยก็ตาม (คนละคนกับที่ Get ตอน Step 1)
      isPutDisabled: job.is_multi_fl === 'Y' && this.getTotalReceiveOrComplete(job) < 1 && !this.hasPreparedPallets(job),
      isComplete: this.isJobComplete(job),
      _raw: job,
    };
  }

  private isJobComplete(job: Type.ResultProcessGetForkliftJob): boolean {
    const jobAny = job as any;
    const total = jobAny.total_qty ?? 0;
    const complete = jobAny.complete_qty ?? 0;

    if (total > 0 && complete >= total) {
      return true;
    }

    const items = job.items ?? [];
    if (items.length > 0) {
      const itemTotal = items.reduce((sum: number, item: any) => sum + (item.total_qty ?? 0), 0);
      const itemComplete = items.reduce((sum: number, item: any) => sum + (item.complete_qty ?? 0), 0);
      if (itemTotal > 0 && itemComplete >= itemTotal) {
        return true;
      }
    }

    const statusName = (job.status_name || '').toString().toLowerCase();
    //  BE เปลี่ยนมาส่งไทยแล้ว ('เสร็จสิ้น') -> เช็คคำไทยเพิ่มด้วย เก็บเช็คอังกฤษเดิมไว้เผื่อข้อมูลเก่า/จุดอื่นยังเป็นอังกฤษอยู่
    return statusName.includes('complete') || statusName.includes('completed') || statusName.includes('finished') || statusName.includes('เสร็จ');
  }

  isGradeLotComplete(item: { complete_pallet?: unknown; total_pallet?: unknown }): boolean {
    const complete = Number(item.complete_pallet);
    const total = Number(item.total_pallet);
    return Number.isFinite(complete) && Number.isFinite(total) && total > 0 && complete >= total;
  }

  //  สร้างรายการ Grade/Lot สำหรับแสดงในการ์ด
  //  หมายเหตุ: ถ้า item ใด lot_no เป็นค่าว่าง (null) และมี addon_lot จาก from_locations (รองรับทั้ง string ค่าเดียว
  //  แบบเดิม และ array ของ {lot, qty} แบบใหม่ที่ 1 location มีได้หลาย Lot) -> แยกเป็นคนละ Grade/Lot คนละบรรทัด
  //  ถ้ามี Lot รวมทั้ง item แค่ 1 ค่า -> ใช้แทน lot_no บรรทัดเดียว ไม่ต้องแยก
  private buildJobGradeLot(items: Type.gradeLot[] | undefined, completePallets?: any[]): any[] {
    if (!items || items.length === 0) {
      return [];
    }

    const result: any[] = [];
    const completedPool = [...(completePallets ?? [])];
    const useCompletedPool = completedPool.length > 0;

    items.forEach((item: any) => {
      //  กรณีปกติ มี lot_no อยู่แล้ว -> ใช้ document_job จาก backend ตรงๆ เหมือนเดิม
      if (item.lot_no) {
        const totalQty = this.gradeLotTotalQty(item.total_qty, item.qty);
        result.push({
          documentJob: this.fallback(item.document_job),
          complete_pallet: useCompletedPool
            ? this.takeCompletedGradeLotQty(completedPool, item, item.lot_no, totalQty)
            : item.complete_qty,
          total_pallet: totalQty,
        });
        return;
      }

      //  lot_no ว่าง -> ไล่หา addon_lot จาก from_locations (1 location อาจมีได้หลาย Lot พร้อมกัน)
      const fromLocations = item?.locations?.from_locations ?? [];
      const lotRows: { lot: string; weight: number; loc: any }[] = [];
      fromLocations.forEach((loc: any) => {
        this.scanLogic.getLocationLots(loc).forEach((entry) => lotRows.push({ lot: entry.lot, weight: entry.qty, loc }));
      });

      //  ไม่เจอ addon_lot เลย (ไม่มี lot มาจริงๆ) -> ขึ้น "ไม่ระบุ lot" แทนที่จะโชว์ document_job ดิบจาก backend
      //  (ซึ่งบางทีช่องของ lot จะว่างเปล่า เช่น "1126NK  15000" ดูสับสน)
      if (lotRows.length === 0) {
        result.push({
          documentJob: `${item.grade ?? '-'} ไม่ระบุ lot ${item.qty ?? ''}`.trim(),
          complete_pallet: item.complete_qty,
          total_pallet: this.gradeLotTotalQty(item.total_qty, item.qty),
        });
        return;
      }

      //  เจอ Lot เดียวทั้ง item -> ใช้แทน lot_no บรรทัดเดียวเหมือนเดิม ไม่ต้องแยก
      if (lotRows.length === 1) {
        const row = lotRows[0];
        const totalQty = this.gradeLotTotalQty(row.loc.total_qty, row.weight || item.total_qty || item.qty);
        result.push({
          documentJob: `${item.grade ?? '-'} ${row.lot} ${row.weight || item.qty || ''}`.trim(),
          complete_pallet: useCompletedPool
            ? this.takeCompletedGradeLotQty(completedPool, item, row.lot, totalQty)
            : row.loc.complete_qty ?? item.complete_qty,
          total_pallet: totalQty,
        });
        return;
      }

      //  เจอหลาย Lot -> แยกเป็นคนละ Grade/Lot คนละบรรทัด
      //  ถ้า location เดียวกันมีหลาย Lot (addon_lot array) -> backend ไม่ได้บอกจำนวน Pallet ต่อ Lot มาตรงๆ
      //  total_pallet: เดาจากน้ำหนักของแต่ละ Lot ตรงๆ (ปัดขึ้นทุก 1000 กก. ต่อ 1 Pallet) แม่นกว่าหารสัดส่วนจาก loc.total_qty
      //  complete_pallet: ไม่รู้น้ำหนักที่วางสำเร็จแล้วแยกต่อ Lot -> ยังต้องแบ่งตามสัดส่วนน้ำหนักจาก loc.complete_qty ที่รู้จริงแทน
      const rowsByLocation = new Map<any, { lot: string; weight: number; loc: any }[]>();
      lotRows.forEach((row) => {
        const bucket = rowsByLocation.get(row.loc) ?? [];
        bucket.push(row);
        rowsByLocation.set(row.loc, bucket);
      });

      rowsByLocation.forEach((rows, loc) => {
        const completeSplit = this.scanLogic.splitCountByWeight(loc.complete_qty ?? 0, rows.map((r) => r.weight));

        rows.forEach((row, index) => {
          result.push({
            documentJob: `${item.grade ?? '-'} ${row.lot} ${row.weight || item.qty || ''}`.trim(),
            complete_pallet: useCompletedPool
              ? this.takeCompletedGradeLotQty(completedPool, item, row.lot, row.weight)
              : completeSplit[index] ?? 0,
            total_pallet: row.weight,
          });
        });
      });
    });

    return result;
  }

  private gradeLotTotalQty(totalQty: unknown, fallbackQty: unknown): number {
    const total = Number(totalQty);
    if (Number.isFinite(total) && total > 0) return total;
    const fallback = Number(fallbackQty);
    return Number.isFinite(fallback) ? fallback : 0;
  }

  private takeCompletedGradeLotQty(pool: any[], item: any, lot: string, totalQty: number): number {
    let completedQty = 0;
    const lotKey = String(lot ?? '').trim();

    for (let i = 0; i < pool.length && completedQty < totalQty;) {
      const pallet = pool[i];
      const palletLot = String(pallet?.lot ?? '').trim();
      const itemIdMatches = pallet?.item_id == null || Number(pallet.item_id) === Number(item.id);
      if (
        itemIdMatches
        && this.scanLogic.isPoolGradeMatch(pallet, String(item.grade ?? '').trim())
        && palletLot === lotKey
      ) {
        const [matched] = pool.splice(i, 1);
        const qty = Number(matched?.qty);
        if (Number.isFinite(qty) && qty > 0) completedQty += qty;
      } else {
        i++;
      }
    }

    return completedQty;
  }

  //  เช็คว่า Location List ว่างเปล่าหรือมีแต่ค่า placeholder "ไม่ระบุ"
  private isEmptyLocation(locations: string[]): boolean {
    return !locations || locations.length === 0 || (locations.length === 1 && locations[0] === this.NO_LOCATION_LABEL);
  }

  //  รวม receive_qty + complete_qty จากทุก item
  private getTotalReceiveOrComplete(job: any): number {
    const items = job.items ?? [];
    const totalReceive = items.reduce((sum: number, item: any) => sum + (item.receive_qty ?? 0), 0);
    const totalComplete = items.reduce((sum: number, item: any) => sum + (item.complete_qty ?? 0), 0);
    return totalReceive + totalComplete;
  }

  //  งาน Special: มีคนกด "ส่งให้ Step 2" เตรียมถุงไว้ค้างอยู่ใน pallets.prepare_pallet หรือไม่
  //  จำกัดเฉพาะ type_name === 'Special Package' กันกรณี field prepare_pallet มีค่าโผล่มาที่งานประเภทอื่นในอนาคต
  private hasPreparedPallets(job: any): boolean {
    if (job.type_name !== 'Special Package') return false;
    return (job.pallets?.prepare_pallet?.length ?? 0) > 0;
  }

  //  Fallback Helper -> Return '-' if value is null / undefined / empty string
  fallback(value: any): any {
    if (value === null || value === undefined || value === '') {
      return '-';
    }
    return value;
  }

  //  Extract source locations from all items
  private getLocationFromItems(items: Type.gradeLot[]): string[] {
    return this.formatLocations(items, 'from_locations');
  }

  //  Extract destination locations from all items
  private getPutLocationFromItems(items: Type.gradeLot[]): string[] {
    return this.formatLocations(items, 'to_locations');
  }

  //  Display เท่านั้น: Location code ที่ขึ้นต้นด้วย "M" (เช่น M42A0002) -> โชว์เป็น "WH42A0002" แทน (แนวทางเดียวกับหน้า scan-pallet)
  private formatLocationDisplay(code?: string | null): string {
    if (!code) return code ?? '';
    return code.startsWith('M') ? 'WH' + code.slice(1) : code;
  }

  private formatLocations(items: Type.gradeLot[] | undefined, key: 'from_locations' | 'to_locations'): string[] {
    if (!items || items.length === 0) {
      return [this.NO_LOCATION_LABEL];
    }

    const locations = new Set<string>();
    items.forEach((item) => {
      const list = item?.locations?.[key] ?? [];
      list.forEach((loc: any) => {
        if (loc.location_name) {
          locations.add(this.formatLocationDisplay(loc.location_name));
        }
      });
    });

    const uniqueLocations = Array.from(locations);
    if (uniqueLocations.length === 0) {
      return [this.NO_LOCATION_LABEL];
    }

    //  Line 1 = location แรก, Line 2 = location ที่สอง
    if (uniqueLocations.length <= 2) {
      return uniqueLocations;
    }

    //  Line 1, Line 2, Line 3 = "+n more"
    return [
      uniqueLocations[0],
      uniqueLocations[1],
      `+${uniqueLocations.length - 2} more`,
    ];
  }

  //  Map type_topic -> Job Tag (IN / OUT / RQ / BK)
  mapJobTag(typeName?: string, typeTopic?: string): string {
    if (typeName === 'Request') return 'RQ';

    if (typeName === 'Special Package') {
      return 'SP';
    }

    //  งานใหม่ concept เดียวกับ Special Package (unit กก. ไม่มีตัวเลือกเอาเต็ม pallet) — ใช้ tag BK เดียวกับ Booking
    if (typeName === 'Breakage & Replacement') {
      return 'BK';
    }

    //  type_topic จริงเป็น 'Outbound' เหมือนงาน Outbound ทั่วไป -> ต้องเช็คจาก type_name ก่อน ไม่งั้นจะไปโชว์ "OUT" ปนกับงาน Outbound ปกติ
    if (typeName === 'Internal Transfer') {
      return 'IT';
    }

    //  งานใหม่ (ยิง endpoint /transfer-wh/... ของตัวเอง) type_topic จริงเป็น 'Outbound' เหมือนกัน -> เช็คจาก type_name ก่อนเหมือน IT
    if (typeName === 'Transfer WH') {
      return 'TW';
    }

    switch (typeTopic) {
      case 'Inbound':
        return 'IN';

      case 'Outbound':
        return 'OUT';

      case 'Booking':
        return 'BK';

      default:
        return '-';
    }
  }

  //  Click Job Step Button -> Navigate To Scan Pallet Page With Job Data
  onClickJobStep(job: any, action: 'get' | 'put' | 'both' = 'both'): void {

    //  งานที่เสร็จสิ้นแล้ว (isComplete) ยังเข้าหน้า scan-pallet ได้ตามปกติ แต่เตือนไว้ก่อน
    //  เพราะโควต้าของ Location ต้นทาง/ปลายทางอาจเต็มไปแล้วตั้งแต่ตอนงานเสร็จจริง
    //  ทำให้เจอ error "Location ... ถูก Get ครบจำนวนแล้ว" ทั้งที่ item.complete_qty อาจยังไม่อัปเดตตาม
    if (job.isComplete) {
      this.SweetAlert('warning', 'งานนี้เสร็จสิ้นแล้ว');
    }

    //  Prepare Payload To Pass Along
    const payload = {
      job: job._raw,        // ข้อมูลดิบจาก API (ครบทุก field)
      jobCard: job,          // ข้อมูลที่ map ไว้แล้วสำหรับแสดงผล
      action: action,        // 'get' | 'put' | 'both' -> บอกว่าจะสแกนฝั่งไหน
    };

    //  Save To SessionStorage As Backup (กัน state หายตอน refresh หน้า scan-pallet)
    sessionStorage.setItem('scanPalletJobData', JSON.stringify(payload));

    //  Navigate With Router State (ไม่โผล่ใน URL, รับที่หน้า scan-pallet ผ่าน history.state)
    this.router.navigate(['scan-pallet'], { state: payload });
  }

  //  Back Button Event
  onClickBack(): void {
    //  Navigate To Warehouse Select Page
    this.router.navigate(['system-menu']);
  }

  //  Load To Truck Button Event
  //  เล่น animation รถวิ่งออกจากปุ่มก่อนค่อย navigate จริง (กันกดซ้ำระหว่างเล่น animation ด้วย disabled)
  _isLoadTruckDriving = false;

  onClickLoadTruck(): void {
    if (this._isLoadTruckDriving) return;
    this._isLoadTruckDriving = true;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => this.router.navigate(['load-to-truck']), prefersReducedMotion ? 0 : 550);
  }

  //  Refresh Button Event -> ดึงข้อมูลงานและ dropdown ใหม่ทั้งหมด
  onClickRefresh(): void {
    this.fetchProcessGetForkliftJob();
    this.fetchProcessCbJobStatus();
    this.fetchProcessCbJobType();
  }

  //  Click Job Tag -> Show Modal อธิบายทุก Tag พร้อมกัน ไฮไลต์อันที่กด (ไม่ timer auto-close เพราะอยากให้อ่านเอง)
  //  สไตล์ chip ก๊อปจาก .job-tag/.tag-* ใน job-accept.css มาตรงๆ ทุก property (padding/font-size/ไม่มี border-radius)
  //  เพราะ Swal inject HTML นอก Angular view encapsulation เลยอ้างอิง class เดิมไม่ได้ -> แก้ css แล้วอย่าลืมแก้ตรงนี้ด้วย
  onClickTagInfo(tag: string): void {
    const rows = Object.entries(this.JOB_TAG_INFO).map(([key, info]) => {
      const active = key === tag;
      return `
        <div style="box-sizing:border-box; width:100%; display:flex; align-items:center; gap:10px;
          padding:5px 6px; border:1.5px solid ${active ? info.bg : 'transparent'};
          background:${active ? info.bg + '1f' : 'transparent'};">
          <span style="box-sizing:border-box; flex-shrink:0; width:46px; display:inline-flex;
            align-items:center; justify-content:center; padding:2px 0; font-size:20px;
            font-weight:600; background:${info.bg}; color:${info.fg};">${key}</span>
          <span style="text-align:left; line-height:1.4;">
            <span style="font-size:24px; font-weight:600; color:#222;">${info.name}</span>
            <span style="font-size:18px; color:#666;"> — ${info.desc}</span>
          </span>
        </div>`;
    }).join('');

    Swal.fire({
      icon: undefined,
      title: 'ประเภทงาน (Tag)',
      //  list คอลัมน์เดียวแบบเดิม ชื่อ+คำอธิบายอยู่บรรทัดเดียวกัน (ไม่บังคับ <br>) ตัดคำสั้นลงด้วย ให้ 7 แถว
      //  รวมกันเตี้ยพอเห็นครบในจอเดียว ไม่ต้อง scroll ปกติ -> max-height/overflow เผื่อไว้เฉยๆ กันจอเตี้ยผิดปกติจริงๆ
      html: `<div style="display:flex; flex-direction:column; gap:4px; width:100%;
        box-sizing:border-box; max-height:75vh; overflow-y:auto; padding-right:4px;">${rows}</div>`,
      //  .swal2-popup ทุกจุดโดน global style บังคับ max-width:650px !important ไว้ (styles.css) -> ต้องมี
      //  customClass แยกชื่อ ค่า width ตรงนี้ถึงจะมีผลจริง (ดู .tag-info-popup ใน styles.css)
      customClass: { popup: 'tag-info-popup' },
      width: 800,
      confirmButtonText: 'OK',
    });
  }

  //  Step ที่อิงการ์ดงาน (Tag/รายการสินค้า/งานด่วน/แสดงรายการ/รับ-วาง/สถานะ) ข้ามไปเลยถ้าหน้านี้ไม่มีงานเลย (list ว่าง)
  //  ปุ่มรีเฟรชใช้ attribute selector (ไม่ใช่ .refresh-button) เพราะปุ่ม "?" ใช้ class เดียวกัน (สไตล์ร่วม) ถ้าใช้ class
  //  เฉยๆ จะชี้ปุ่ม "?" แทนโดยไม่ตั้งใจ (ปุ่ม "?" มาก่อนในลำดับ DOM)
  private startTour(): void {
    const hasJobCard = !!document.querySelector('.job-tag');
    const hasUrgentIcon = !!document.querySelector('.urgent-icon');
    //  งาน 2 ขั้นตอน (is_multi_fl='Y') ปุ่มรับ/วางแยกเป็นคนละ element กัน (.one-row ตัวฟ้า/ตัวเขียว) ต่างจากงาน
    //  1 ขั้นตอนที่รวมเป็นปุ่มเดียว (.two-row) -> เช็คจากการ์ดใบแรกที่เจอจริงบนจอ ไม่ใช่ทุกใบพร้อมกัน (เหมือน hasJobCard)
    const isTwoStepJob = !!document.querySelector('.job-step-btn.blue.one-row');

    const jobStepSteps: DriveStep[] = isTwoStepJob ? [
      {
        element: '.job-step-btn.blue.one-row',
        popover: {
          title: 'ปุ่มรับ',
          description: 'งานนี้แยกขั้นตอน (2 step) กดปุ่มนี้ก่อนเพื่อเริ่มสแกนรับสินค้าเข้ามา',
        },
      },
      {
        element: '.job-step-btn.green.one-row',
        popover: {
          title: 'ปุ่มวาง',
          description: 'กดปุ่มนี้เพื่อสแกนวางสินค้าหลังรับเข้ามาแล้ว ต้องกดปุ่มรับให้เสร็จก่อนปุ่มนี้ถึงจะกดได้ '
            + '(ถ้ายังเป็นสีเทาจางๆ แปลว่ายังกดไม่ได้)',
        },
      },
    ] : [
      {
        element: '.job-step',
        popover: {
          title: 'รับ / วาง',
          description: 'งานนี้เป็นแบบ 1 ขั้นตอน กดปุ่มเดียวทำทั้งรับและวางในรอบเดียว จะพาไปหน้าสแกน QR Code เพื่อเริ่มทำงานนี้',
        },
      },
    ];

    const cardSteps: DriveStep[] = hasJobCard ? [
      {
        element: '.job-card',
        popover: {
          title: 'การ์ดงาน',
          description: 'แต่ละกล่องคือ 1 งานที่ต้องทำ ข้างในจะมีประเภทงาน, รายการสินค้า, ปุ่มเริ่มสแกน และสถานะความคืบหน้าของงานนั้น '
            + 'ขอบจะเป็นสีแดงถ้าเป็นงานด่วน ไปดูทีละจุดกันต่อ',
        },
      },
      {
        element: '.job-tag',
        popover: {
          title: 'ประเภทงาน (Tag)',
          description: 'ตัวย่อสีต่างๆ บอกว่างานนี้เป็นประเภทไหน (เช่น IN=รับเข้า, OUT=ส่งออก, IT=ย้ายในคลัง ฯลฯ รวม 7 แบบ) '
            + 'กดที่ Tag นี้ได้ทุกเมื่อ จะเด้งขึ้นมาอธิบายความหมายของทุก Tag พร้อมไฮไลต์ตัวที่กดให้เอง',
        },
      },
      {
        element: '.job-grade-lot',
        popover: {
          title: 'รายการสินค้า',
          description: 'แสดง grade/lot ของสินค้าในงานนี้เรียงลงมาทุกรายการ '
            + 'มีเครื่องหมายถูกสีเขียวต่อท้าย ถ้ารายการนั้นทำครบจำนวนแล้ว',
        },
      },
      ...(hasUrgentIcon ? [{
        element: '.urgent-icon',
        popover: {
          title: 'งานด่วน',
          description: 'ไอคอนไซเรนนี้แสดงเมื่องานนี้เป็นงานเร่งด่วน (Urgent) ควรหยิบมาทำก่อนงานอื่นที่ไม่เร่งด่วน',
        },
      } as DriveStep] : []),
      {
        element: '.btn-show-list',
        popover: {
          title: 'แสดงรายการ',
          description: 'กดปุ่มนี้เพื่อเปิดดูรายละเอียดรายการสินค้าของงาน',
        },
      },
      ...jobStepSteps,
      {
        element: '.job-footer',
        popover: {
          title: 'สถานะงาน',
          description: 'แถบสีด้านล่างบอกสถานะปัจจุบันของงาน (เช่น รอดำเนินการ, กำลังดำเนินการ, เสร็จสิ้น) '
            + 'ตัวเลขข้างๆ บอกจำนวนที่ทำสำเร็จแล้ว เทียบกับจำนวนทั้งหมดที่ต้องทำของงานนี้',
        },
      },
    ] : [];

    const steps: DriveStep[] = [
      {
        element: '.back-button',
        popover: { title: 'ปุ่มย้อนกลับ', description: 'กลับไปหน้าเลือกคลัง (ก่อนหน้าหน้านี้)' },
      },
      {
        element: '.header-right mat-form-field:nth-of-type(1)',
        popover: { title: 'กรองสถานะงาน', description: 'เลือกได้หลายสถานะพร้อมกัน เพื่อกรองดูเฉพาะงานที่สถานะตรงกับที่เลือกไว้' },
      },
      {
        element: '.header-right mat-form-field:nth-of-type(2)',
        popover: {
          title: 'กรองประเภทงาน',
          description: 'เลือกได้หลายประเภทพร้อมกัน (Inbound, Outbound, Request, Special Package, Breakage & Replacement, '
            + 'Internal Transfer, Transfer WH)',
        },
      },
      {
        element: '.header-right mat-form-field:nth-of-type(3)',
        popover: {
          title: 'กรองวันที่',
          description: 'เลือกวันที่สร้างงานที่ต้องการดู กดตรงไหนของช่องก็เปิดปฏิทินได้เลย ไม่ต้องเล็งไปที่ไอคอนปฏิทินอย่างเดียว',
        },
      },
      {
        element: 'button[aria-label="Refresh"]',
        popover: { title: 'รีเฟรช', description: 'โหลดรายการงานและตัวกรองสถานะ/ประเภทงานใหม่ล่าสุดจาก server' },
      },
      {
        element: '.load-truck-button',
        popover: { title: 'Load ของขึ้นรถ', description: 'หลังจากวางสินค้าเสร็จแล้ว ใช้ปุ่มนี้เพื่อไปหน้าสแกนขนสินค้าที่จัดวางเสร็จขึ้นรถขนส่งต่อไป' },
      },
      ...cardSteps,
    ];

    driver({
      showProgress: true,
      nextBtnText: 'ถัดไป',
      prevBtnText: 'ย้อนกลับ',
      doneBtnText: 'เสร็จสิ้น',
      steps,
    }).drive();
  }

  //  Sweet Alert
  SweetAlert(iconn: any, alert_message: string) {
    Swal.fire({
      position: 'center',
      icon: iconn,
      title: 'ข้อความจากระบบ',
      text: alert_message,
      showConfirmButton: true,
      timer: 1500,
      timerProgressBar: true,
    });
  }
}