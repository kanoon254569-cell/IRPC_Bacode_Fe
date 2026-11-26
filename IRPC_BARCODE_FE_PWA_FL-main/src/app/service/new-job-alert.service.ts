import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { CrudService } from './crud.service';
import { ScanPalletLogicService } from './scan-pallet-logic.service';
import { OfflineStorageService } from './offline-storage.service';

export interface NewJobAlert {
  id: number;
  systemNo: string;
  typeName: string;
  //  'IN' | 'OUT' | 'RQ' | 'BK' | 'SP' | 'IT' -> ใช้ค่าเดียวกับ job.jobTag หน้า job-accept (ผ่าน mapJobTag ตัวเดิม)
  jobTag: string;
  //  ตรงกับ job.isUrgent === 'Y' หน้า job-accept (is_urgent ดิบจาก backend เป็น string 'Y'/'N')
  isUrgent: boolean;
  //  animation-delay (ค่าติดลบ) ของขอบแดงกระพริบ -> คำนวณจาก timestamp จริงตอนสร้าง object นี้ครั้งเดียว (หาร modulo
  //  คาบ animation 1s ใน new-job-badge.css) ให้ item ทุกตัวอิงเวลาสัมบูรณ์เดียวกัน กระพริบพร้อมกันไม่ว่าจะเข้า list
  //  ตอนไหนก็ตาม (ต่างจากปล่อยให้ CSS เริ่มนับเองตอน element ถูกสร้าง ซึ่งจะไม่ตรงกันถ้า item เข้ามาคนละจังหวะ)
  pulseDelay: string;
  //  raw job object เต็มจาก GetJobByForklift (ตัวเดียวกับที่ job-accept ใช้เป็น job._raw) -> ให้หน้า job-accept
  //  เอาไป mapJobCard ขึ้นการ์ดเองตรงๆ ถ้ากำลังเปิดหน้านั้นอยู่พอดี ไม่ต้องรอ fetch รอบถัดไป ไม่มีให้ตอน simulateNewJob
  //  (ทดสอบผ่าน console ไม่มี raw จริง)
  raw?: any;
}

const POLL_INTERVAL_MS = 20000;
const CHIME_LOOP_INTERVAL_MS = 5000;

//  key เดียวกับที่หน้า job-accept ใช้เซฟ cache ของตัวเอง (job-accept.ts: CACHE_KEY) -> ตั้งใจใช้ร่วมกัน
//  ไม่สร้าง key แยก เพื่อให้ offline fallback ของ job-accept เห็นงานล่าสุดเสมอ แม้ไม่เคยเข้าหน้านั้นเลยสักครั้ง
const JOB_LIST_CACHE_KEY = 'forklift_job_data';

//  แจ้งเตือนงานใหม่ (ระดับ 1: แจ้งได้แค่ตอนแอปยังเปิดอยู่ ไม่รองรับตอนปิดแอปไปแล้ว -> นั่นต้องใช้ Push API ที่มี
//  backend ช่วยส่ง ยังไม่ทำตอนนี้) poll GetJobByForklift เป็นช่วงๆ เทียบ job id ที่เคยเห็นแล้วกับรอบใหม่
//  เริ่มทำงานจาก app.ts (root component อยู่นอกทุก route ไม่มีวันถูกทำลายตลอดอายุ SPA) -> ทำงานทุกหน้า ไม่ใช่แค่ job-accept
@Injectable({
  providedIn: 'root',
})
export class NewJobAlertService {

  //  เผื่อหน้าไหนอยากรู้ด้วย (เช่น job-accept จะ highlight การ์ดใหม่) ไม่ได้บังคับต้อง subscribe
  private readonly _newJob$ = new Subject<NewJobAlert>();
  readonly newJob$: Observable<NewJobAlert> = this._newJob$.asObservable();

  //  list งานใหม่ที่ "ยังไม่ได้ดู" ค้างไว้ให้ปุ่มกระดิ่งลอย (new-job-badge) อ่านได้ตลอด ไม่หายไปเองจนกว่าจะถูก dismiss
  //  ต่างจาก newJob$ ด้านบนที่เป็นแค่ event ครั้งเดียวผ่านไปแล้วจบ ไม่มีใครมาดูทีหลังได้อีก
  private readonly _unseenJobs$ = new BehaviorSubject<NewJobAlert[]>([]);
  readonly unseenJobs$: Observable<NewJobAlert[]> = this._unseenJobs$.asObservable();

  private _timer: ReturnType<typeof setInterval> | null = null;
  private _knownJobIds = new Set<number>();
  private _lastForkliftId: number | null = null;
  private _permissionRequested = false;
  private _audioContext: AudioContext | null = null;
  private _chimeLoopTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private crudService: CrudService,
    private scanLogic: ScanPalletLogicService,
    private offlineStorage: OfflineStorageService,
  ) {
    //  เล่นเสียงวนซ้ำไปเรื่อยๆ ตราบใดที่ยัง "มี" งานในลิสต์ที่ยังไม่ได้ดู ไม่ว่า list จะเปลี่ยนจากจุดไหนก็ตาม
    //  (poll เจอใหม่, simulateNewJob, dismissAll) -> เช็คจากค่าล่าสุดของ list ที่เดียวจบ
    //  ไม่ต้องเรียก start/stop เองกระจายอยู่ทุกจุดที่แก้ list กันพลาด
    this._unseenJobs$.subscribe((jobs) => {
      if (jobs.length > 0) this.startChimeLoop();
      else this.stopChimeLoop();
    });
  }

  //  ยิงแจ้งเตือนตรงๆ ไม่ผ่าน poll/diff จริง (ใช้ทดสอบเฉยๆ เช่นจาก console: ดู instance ผ่าน (window as any).newJobAlertService)
  //  ไม่ต้องใส่ pulseDelay เอง คำนวณให้อัตโนมัติเหมือนงานที่ poll เจอจริง
  simulateNewJob(input: Omit<NewJobAlert, 'pulseDelay'>): void {
    const alert: NewJobAlert = { ...input, pulseDelay: this.computePulseDelay() };
    this._newJob$.next(alert);
    this.setUnseenJobs([...this._unseenJobs$.value, alert]);
    this.notify(alert);
  }

  //  กระพริบขอบแดง (urgent) ของทุก item ต้องซิงค์เฟสเดียวกัน -> อิง timestamp จริง ณ ตอนสร้าง item นี้ หาร modulo
  //  คาบ animation 1s (new-job-badge-urgent-pulse ใน new-job-badge.css) ได้ค่าติดลบใส่เป็น animation-delay ตรงๆ
  private computePulseDelay(): string {
    return `-${(Date.now() % 1000) / 1000}s`;
  }

  //  ทุกจุดที่แก้ list ที่ยังไม่ได้ดู ต้องผ่านตรงนี้เสมอ -> เรียง "งานด่วนขึ้นก่อน" แบบเดียวกับหน้า job-accept
  //  (Array.sort เสถียร/stable ตาม spec ES2019+ แล้ว -> ลำดับเดิมของแต่ละกลุ่ม urgent/ไม่ urgent ไม่ถูกสลับมั่ว)
  private setUnseenJobs(jobs: NewJobAlert[]): void {
    const sorted = [...jobs].sort((a, b) => Number(b.isUrgent) - Number(a.isUrgent));
    this._unseenJobs$.next(sorted);
  }

  //  กด "อ่านแล้วทั้งหมด"
  dismissAll(): void {
    this._unseenJobs$.next([]);
  }

  start(): void {
    if (this._timer) return;   //  กัน start ซ้ำ
    this._timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    this.poll();
  }

  private poll(): void {
    if (!this.offlineStorage.isOnline()) return;

    const forkliftId = Number(sessionStorage.getItem('_FORKLIFT_ID')) || 0;
    if (!forkliftId) return;   //  ยังไม่ login/เลือก forklift -> ไม่มีอะไรให้เช็ค

    //  คนละ forklift จากรอบก่อน (เช่น logout แล้วคนอื่น login บนเครื่องเดียวกัน) -> เริ่มนับ baseline ใหม่
    //  กันเอา id งานเก่าของคนก่อนหน้ามาเทียบ/แจ้งเตือนผิดคน
    const isFirstPollForThisForklift = this._lastForkliftId !== forkliftId;
    if (isFirstPollForThisForklift) this._knownJobIds = new Set<number>();
    this._lastForkliftId = forkliftId;

    if (!this._permissionRequested && 'Notification' in window && Notification.permission === 'default') {
      this._permissionRequested = true;
      Notification.requestPermission();
    }

    this.crudService.GetJobByForklift(forkliftId).subscribe({
      next: (res) => {
        const jobs = res?.data ?? [];

        //  เซฟลง IndexedDB ทุกรอบที่ poll สำเร็จ (key เดียวกับ job-accept) กัน offline fallback ของหน้านั้นเห็น
        //  ข้อมูลเก่าค้างถ้าไม่เคยเข้าหน้า job-accept เองเลย (เช่นกดแจ้งเตือนแล้วพาไป scan-pallet ตรงๆ)
        //  ขอบเขตแค่ "วันนี้" เท่านั้น เพราะไม่ส่ง date param ไป -> backend default เป็นวันนี้เองเสมอ
        this.offlineStorage.save(JOB_LIST_CACHE_KEY, res);

        //  รอบแรกของ forklift นี้ -> แค่บันทึก baseline เงียบๆ ไม่แจ้งเตือน กันพอ refresh/login ใหม่แล้วโดนแจ้งเตือน
        //  รัวๆ ทุกงานที่มีอยู่แล้วตั้งแต่ก่อนหน้า (ไม่ใช่งาน "ใหม่" จริงๆ)
        if (isFirstPollForThisForklift) {
          jobs.forEach((j: any) => this._knownJobIds.add(j.id));
          return;
        }

        const newAlerts: NewJobAlert[] = [];
        jobs.forEach((j: any) => {
          if (this._knownJobIds.has(j.id)) return;
          this._knownJobIds.add(j.id);
          const alert: NewJobAlert = {
            id: j.id,
            systemNo: j.system_no,
            typeName: j.type_name,
            jobTag: this.scanLogic.mapJobTag(j.type_name, j.type_topic),
            isUrgent: j.is_urgent === 'Y',
            pulseDelay: this.computePulseDelay(),
            raw: j,
          };
          newAlerts.push(alert);
          this._newJob$.next(alert);
          this.notify(alert);
        });
        if (newAlerts.length > 0) this.setUnseenJobs([...this._unseenJobs$.value, ...newAlerts]);
      },
      error: () => { /* เงียบไว้ -> เน็ตสะดุดชั่วคราว ลองใหม่รอบถัดไปเอง */ },
    });
  }

  private notify(alert: NewJobAlert): void {
    if ('Notification' in window && Notification.permission === 'granted') {
      const title = 'งานใหม่เข้ามา';
      const options: NotificationOptions = { body: `${alert.systemNo} (${alert.typeName})` };

      //  ยิงผ่าน Service Worker (ngsw-worker.js ที่แอปนี้มีอยู่แล้ว) แทน `new Notification()` ตรงๆ เพราะบาง
      //  browser/OS จะไม่โชว์ popup เลยเงียบๆ ถ้ามี Service Worker คุมหน้าอยู่แต่ไม่ได้ยิงผ่านมันโดยตรง
      //  -> ยังเป็นพื้นฐานเดียวกับที่ต้องใช้ถ้าจะทำ push ตอนปิดแอปในอนาคตด้วย (serviceWorker.ready ใช้ร่วมกันได้)
      //  เช็ค .controller ก่อนเสมอ (true เฉพาะตอนมี SW คุมหน้าอยู่จริง) เพราะ dev mode (ng serve) ปิด SW ไว้
      //  (enabled: !isDevMode() ใน app-module.ts) -> ถ้าไม่เช็คก่อน .ready จะค้างรอตลอดกาลไม่มีวัน resolve
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready
          .then((registration) => registration.showNotification(title, options))
          .catch(() => new Notification(title, options));   //  SW ไม่พร้อม/error -> fallback วิธีเดิมแทนเงียบไปเฉยๆ
        return;
      }

      const n = new Notification(title, options);
      n.onclick = () => window.focus();
      return;
    }

    //  TEMP: ตัด popup/toast ในแอปออกก่อน (เอา Notification แบบปกติให้ได้ชัวร์ก่อน) permission ไม่ผ่าน/ไม่รองรับ
    //  ก็แค่ไม่มีอะไรขึ้นไปก่อน ไม่ error อะไร
  }

  //  เริ่มเล่นเสียงทันที 1 รอบ แล้ววนซ้ำทุก CHIME_LOOP_INTERVAL_MS ไปเรื่อยๆ จนกว่า list จะว่าง (stopChimeLoop ถูกเรียก)
  private startChimeLoop(): void {
    if (this._chimeLoopTimer) return;   //  วนอยู่แล้ว ไม่ต้อง restart ซ้ำ (กันงานใหม่ที่ 2 เข้ามาตัดจังหวะเสียงเดิม)
    this.playNewJobChime();
    this._chimeLoopTimer = setInterval(() => this.playNewJobChime(), CHIME_LOOP_INTERVAL_MS);
  }

  private stopChimeLoop(): void {
    if (!this._chimeLoopTimer) return;
    clearInterval(this._chimeLoopTimer);
    this._chimeLoopTimer = null;
  }

  //  เสียงแจ้งเตือนงานใหม่ -> 2 โทนสลับสูง-ต่ำ (1760Hz/1318Hz) แทนโทนเดียวซ้ำ 3 ที ฟังเป็น "แจ้งเตือน" มากกว่าเสียง
  //  เตือนภัยเดี่ยวๆ ซ้ำๆ แต่ยังดังเด่นเหมือนเดิม (triangle wave นุ่มกว่า square แต่ยังคมกว่า sine เฉยๆ)
  private playNewJobChime(): void {
    this.playBeep(1760, 120);
    setTimeout(() => this.playBeep(1318, 120), 160);
    setTimeout(() => this.playBeep(1760, 120), 320);
  }

  //  Web Audio API ล้วนๆ ไม่ต้องมีไฟล์เสียงแยก (pattern เดียวกับ playBeep ใน loading-truck.ts)
  private playBeep(frequency: number, duration: number): void {
    try {
      if (!this._audioContext) {
        this._audioContext = new AudioContext();
      }

      const oscillator = this._audioContext.createOscillator();
      const gainNode = this._audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this._audioContext.destination);

      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;

      gainNode.gain.setValueAtTime(0.25, this._audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.001,
        this._audioContext.currentTime + duration / 1000,
      );

      oscillator.start(this._audioContext.currentTime);
      oscillator.stop(this._audioContext.currentTime + duration / 1000);
    } catch (err) {
      console.error('ไม่สามารถเล่นเสียงแจ้งเตือนงานใหม่ได้:', err);
    }
  }
}
