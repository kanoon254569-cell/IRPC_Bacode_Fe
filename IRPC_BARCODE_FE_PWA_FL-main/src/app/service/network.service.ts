import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Subject, firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../environments/environment';

//  ตรวจสถานะ online/offline จริงด้วยการ ping api/v1/health ทุก 15 วิ
//  navigator.onLine บอกแค่ว่าเครื่องต่อ WiFi/LAN อยู่ ไม่ได้บอกว่าไปถึง backend ได้จริง (WiFi โกดังต่อได้แต่ไม่มี route)
//  -> ทุกจุดที่เคยเช็ค navigator.onLine ให้ใช้ isOnline / online$ จาก service นี้แทน
@Injectable({ providedIn: 'root' })
export class NetworkService implements OnDestroy {
  private readonly healthUrl = `${environment.baseAPIURL}/api/v1/health`;
  private readonly POLL_INTERVAL_MS = 15000;
  private readonly TIMEOUT_MS = 5000;
  //  ต้องไปไม่ถึง server ติดกันกี่ครั้งถึงจะถือว่า offline -> กัน WiFi กระพริบ/ping ช้าครั้งเดียวแล้วสถานะสลับไปมา
  //  (ทุกครั้งที่สลับ offline -> online header จะ auto-sync + popup สรุปใหม่) ส่วน online ยืนยันครั้งเดียวพอ
  private readonly FAILS_BEFORE_OFFLINE = 2;
  private _failCount = 0;

  //  emit เฉพาะตอนสถานะเปลี่ยน (subscribe แล้วได้ค่าปัจจุบันทันที 1 ครั้งตาม BehaviorSubject)
  private readonly _online$ = new BehaviorSubject<boolean>(navigator.onLine);
  readonly online$ = this._online$.asObservable();

  //  emit เมื่อเปลี่ยนจาก offline -> online เท่านั้น (ใช้ trigger sync / re-fetch แทน window 'online')
  private readonly _reconnected$ = new Subject<void>();
  readonly reconnected$ = this._reconnected$.asObservable();

  private _timer: ReturnType<typeof setInterval> | null = null;
  private _checkInFlight: Promise<boolean> | null = null;

  private _onlineListener = () => { this.check(); };
  //  browser ยืนยันว่าหลุดจริง (ไม่มี network interface) -> offline ทันที ไม่ต้องรอนับครั้ง
  private _offlineListener = () => {
    this._failCount = this.FAILS_BEFORE_OFFLINE;
    this.setOnline(false);
  };

  constructor(private httpClient: HttpClient) {
    window.addEventListener('online', this._onlineListener);
    window.addEventListener('offline', this._offlineListener);
    this._timer = setInterval(() => this.check(), this.POLL_INTERVAL_MS);
    this.check();
  }

  ngOnDestroy(): void {
    if (this._timer) clearInterval(this._timer);
    window.removeEventListener('online', this._onlineListener);
    window.removeEventListener('offline', this._offlineListener);
  }

  //  สถานะล่าสุดจาก health check (ไม่ยิง request เพิ่ม)
  //  DEBUG: บังคับจำลอง offline ได้จาก Console -> window.__forceOffline = true / false
  get isOnline(): boolean {
    return this._online$.value && !(window as any).__forceOffline;
  }

  //  ping health ทันทีแล้วรอผล (กันยิงซ้อนกันถ้ามีหลายจุดเรียกพร้อมกัน)
  //  คืนค่า = รอบนี้ไปถึง server จริงไหม (ไม่ผ่านตัวนับ FAILS_BEFORE_OFFLINE) -> ใช้ตัดสินใจ "ยิงตอนนี้เลยไหม" ได้แม่นกว่า isOnline
  check(): Promise<boolean> {
    if (this._checkInFlight) return this._checkInFlight;

    this._checkInFlight = this.ping()
      .then((ok) => { this.applyPingResult(ok); return ok && !(window as any).__forceOffline; })
      .finally(() => { this._checkInFlight = null; });
    return this._checkInFlight;
  }

  //  request API จริงไปไม่ถึง server (status 0) -> นับเป็นหลักฐาน 1 ครั้ง แล้ว ping ยืนยันทันที
  //  ไม่ต้องรอรอบ poll ถัดไป (สูงสุด 15 วิ) ระหว่างนั้น request ใบถัดๆ ไปจะได้เข้า queue ตรงๆ เลย
  reportUnreachable(): void {
    this._failCount++;
    this.check();
  }

  private applyPingResult(ok: boolean): void {
    if (ok) {
      this._failCount = 0;
      this.setOnline(true);
      return;
    }
    this._failCount++;
    if (this._failCount >= this.FAILS_BEFORE_OFFLINE || !navigator.onLine) this.setOnline(false);
  }

  private async ping(): Promise<boolean> {
    if (!navigator.onLine) return false;
    try {
      //  ?t= กัน browser/proxy cache response เก่า
      await firstValueFrom(
        this.httpClient.get(`${this.healthUrl}?t=${Date.now()}`).pipe(timeout(this.TIMEOUT_MS)),
      );
      return true;
    } catch {
      return false;
    }
  }

  private setOnline(value: boolean): void {
    const prev = this._online$.value;
    if (prev === value) return;
    this._online$.next(value);
    if (!prev && value) this._reconnected$.next();
  }
}
