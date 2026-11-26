import { Injectable, Optional } from '@angular/core';
import { filter, firstValueFrom } from 'rxjs';
import { OfflineQueueService, QueueActionType, QueuedAction } from './offline-queue.service';
import { ScanPalletApiService } from './scan-pallet-api.service';
import { NetworkService } from './network.service';

export interface SyncJobSummary {
  jobId: number;
  systemNo: string;
  get: number;
  putAway: number;
  reset: number;
}

//  รายการที่ sync ไม่สำเร็จ แยกเป็นรายพาเลทพร้อม message จาก BE (หรือเหตุผลที่โดน chain-block) ไม่ใช่แค่นับจำนวนรวม
//  เหมือน succeeded เพราะ operator ต้องรู้ว่า "พาเลทไหน" "เพราะอะไร" ถึงจะตามเรื่องถูก
export interface SyncFailedItem {
  jobId: number;
  systemNo: string;
  palletCode: string;
  actionType: QueueActionType;
  message: string;
}

export interface SyncResult {
  succeeded: SyncJobSummary[];
  failed: SyncFailedItem[];
}

//  Sync runner: ไล่ queue ที่ OfflineQueueService เก็บไว้ ยิง API จริงทีละรายการตามลำดับที่สแกนจริง (seq) เท่านั้น
//  ถ้าแอคชั่นไหนของ pallet ไหน sync ไม่ผ่าน (เน็ตหลุดอีกรอบ หรือ backend reject เช่นโควต้าเต็ม) -> ตัดแอคชั่นถัดไปของ
//  pallet เดียวกันทิ้งทันทีในรอบ sync นี้เลย ไม่ลองยิงต่อ เพราะรู้อยู่แล้วว่าต้อง fail ซ้ำ (เช่น Put ที่ยังไม่มี Get ยืนยัน)
//  รอบแรก: เฉพาะงานธรรมดา (ยังไม่รองรับ Special/BK/IT ตามขอบเขตที่ตกลงกันไว้)
@Injectable({
  providedIn: 'root',
})
export class OfflineSyncService {

  //  กัน syncAll() ถูกเรียกซ้อนกัน (เช่น HeaderComponent หลาย instance จากการเปลี่ยนหน้า หรือ startup check
  //  ชนกับ event 'online' พอดี) ไม่งั้นแต่ละ call จะอ่าน queue ชุดเดิมที่ยังไม่ถูกลบแล้วยิง API ซ้ำ backend
  //  reject รายการที่ซ้ำ (Pallet is already assigned...) เพราะ call แรกได้ไปแล้ว -> service นี้เป็น singleton
  //  (providedIn: 'root') อยู่แล้ว เก็บ flag ไว้ที่นี่เพียงจุดเดียวครอบคลุมทุกจุดที่เรียก
  private _syncInFlight: Promise<SyncResult> | null = null;

  //  กัน popup auto-sync เด้งซ้ำๆ ตอนยัง online อยู่เดิม (header ถูกสร้างใหม่ทุกครั้งที่เปลี่ยนหน้า + บาง browser
  //  ยิง event 'online' ซ้ำได้เองด้วย) -> auto-sync ให้ทำแค่ "ครั้งแรก" ของการกลับมา online แต่ละรอบเท่านั้น
  //  ถ้าอยากลองใหม่อีกจากตรงนี้ไปต้องกดปุ่ม "ลองส่งอีกครั้ง" เอง (onClickQueueList) ซึ่งไม่ผ่าน flag นี้
  //  เก็บใน sessionStorage ไม่ใช่ field เฉยๆ เพราะ refresh หน้า (F5) รีสตาร์ท Angular app ทั้งตัว รวม service
  //  singleton ด้วย -> field ธรรมดารีเซ็ตเป็น false ทุกครั้งที่ refresh ทำให้ popup ขึ้นซ้ำได้เหมือนเดิม
  private readonly AUTO_SYNC_FLAG_KEY = '_OFFLINE_AUTO_SYNCED_THIS_STREAK';

  //  เรียกตอน browser แจ้งว่า offline -> reset flag กันรอบ online ถัดไปไม่ auto-sync เลย
  markOffline(): void {
    sessionStorage.removeItem(this.AUTO_SYNC_FLAG_KEY);
  }

  //  true แค่ครั้งแรกที่เรียกหลัง markOffline() หรือตั้งแต่เปิดแท็บนี้ -> caller (header) ใช้เช็คก่อนเรียก runOfflineSync() อัตโนมัติ
  shouldAutoSync(): boolean {
    if (sessionStorage.getItem(this.AUTO_SYNC_FLAG_KEY) === '1') return false;
    sessionStorage.setItem(this.AUTO_SYNC_FLAG_KEY, '1');
    return true;
  }

  constructor(
    private queue: OfflineQueueService,
    private scanApi: ScanPalletApiService,
    @Optional() network?: NetworkService,
  ) {
    //  reset flag ที่ service เอง ไม่พึ่ง header อย่างเดียว -> หลุดตอนอยู่หน้าที่ไม่มี <app-header> (เช่นหน้า login
    //  หลัง auto-logout) แล้วกลับมา online ก็ยัง auto-sync ได้ตอน header ถูกสร้างครั้งถัดไป
    //  @Optional: self-check ด้านล่าง new service นี้เองโดยไม่มี DI
    network?.online$.pipe(filter((online) => !online)).subscribe(() => this.markOffline());
  }

  async syncAll(): Promise<SyncResult> {
    if (this._syncInFlight) return this._syncInFlight;
    this._syncInFlight = this.runSync().finally(() => { this._syncInFlight = null; });
    return this._syncInFlight;
  }

  private async runSync(): Promise<SyncResult> {
    const actions = await this.queue.getAll();
    const blockedPalletCodes = new Set<string>();
    const succeeded: QueuedAction[] = [];
    const failed: SyncFailedItem[] = [];

    for (const action of actions) {
      if (blockedPalletCodes.has(action.palletCode)) {
        failed.push({
          jobId: action.jobId,
          systemNo: action.systemNo,
          palletCode: action.palletCode,
          actionType: action.actionType,
          message: 'รอ action ก่อนหน้าของพาเลทนี้ sync ไม่สำเร็จ',
        });
        continue;
      }

      try {
        await firstValueFrom(
          this.scanApi.callJobApi(action.jobTypeFlags, action.actionType, action.jobId, action.requestData),
        );
        await this.queue.remove(action.id);
        succeeded.push(action);
      } catch (err: any) {
        //  ไม่ลบออกจาก queue -> เก็บไว้ให้ supervisor เช็ค/สั่ง sync ใหม่ทีหลังได้
        blockedPalletCodes.add(action.palletCode);
        failed.push({
          jobId: action.jobId,
          systemNo: action.systemNo,
          palletCode: action.palletCode,
          actionType: action.actionType,
          message: err?.error?.message ?? err?.message ?? 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ',
        });
      }
    }

    return {
      succeeded: this.groupByJob(succeeded),
      failed,
    };
  }

  private groupByJob(actions: QueuedAction[]): SyncJobSummary[] {
    const byJob = new Map<number, SyncJobSummary>();
    for (const a of actions) {
      const summary = byJob.get(a.jobId) ?? { jobId: a.jobId, systemNo: a.systemNo, get: 0, putAway: 0, reset: 0 };
      summary[a.actionType] += 1;
      byJob.set(a.jobId, summary);
    }
    return Array.from(byJob.values());
  }
}

//  ponytail: self-check — mock ทั้ง OfflineQueueService และ ScanPalletApiService ไม่ต้องมี Angular DI/IndexedDB จริง
//  ครอบคลุม: sync สำเร็จลบออกจาก queue, sync fail ไม่ลบ, chain ถัดไปของ pallet เดียวกันโดนตัดอัตโนมัติ, สรุปแยกตาม job ถูก
export async function __offlineSyncServiceSelfCheck(): Promise<void> {
  const { of, throwError } = await import('rxjs');

  const store = new Map<string, any>();
  const fakeStorage = {
    save: async (key: string, data: any) => { store.set(key, data); },
    load: async (key: string) => store.get(key) ?? null,
    remove: async (key: string) => { store.delete(key); },
  } as any;

  const queueSvc = new OfflineQueueService(fakeStorage);

  await queueSvc.enqueue({ jobId: 1, systemNo: 'OUT001', palletCode: 'PLM-A', actionType: 'get', requestData: { code: 'A' }, jobTypeFlags: {} });
  const getB = await queueSvc.enqueue({ jobId: 2, systemNo: 'OUT002', palletCode: 'PLM-B', actionType: 'get', requestData: { code: 'B' }, jobTypeFlags: {} });
  await queueSvc.enqueue({ jobId: 2, systemNo: 'OUT002', palletCode: 'PLM-B', actionType: 'putAway', requestData: { code: 'B' }, jobTypeFlags: {} });
  await queueSvc.enqueue({ jobId: 1, systemNo: 'OUT001', palletCode: 'PLM-A', actionType: 'putAway', requestData: { code: 'A' }, jobTypeFlags: {} });

  const fakeApi = {
    callJobApi: (_flags: any, _action: string, _jobId: number, requestData: any) => {
      //  จำลอง: pallet B (job 2) sync ไม่ผ่านเสมอ (เช่น backend reject) ที่เหลือผ่านหมด
      return requestData.code === 'B' ? throwError(() => new Error('reject')) : of({ status: 'ok' });
    },
  } as any;

  const syncSvc = new OfflineSyncService(queueSvc, fakeApi);
  const result = await syncSvc.syncAll();

  console.assert(result.succeeded.length === 1 && result.succeeded[0].jobId === 1, 'job 1 (pallet A) ต้อง sync สำเร็จ');
  console.assert(result.succeeded[0].get === 1 && result.succeeded[0].putAway === 1, 'job 1 ต้องนับ get/putAway อย่างละ 1');

  console.assert(result.failed.length === 2 && result.failed.every((f) => f.jobId === 2 && f.palletCode === 'PLM-B'), 'job 2 (pallet B) ต้อง fail ทั้ง get และ putAway แยกเป็น 2 รายการ');
  console.assert(result.failed.find((f) => f.actionType === 'get')?.message === 'reject', 'get ต้อง fail ด้วย message จาก error จริง');
  console.assert(!!result.failed.find((f) => f.actionType === 'putAway')?.message.includes('รอ action ก่อนหน้า'), 'putAway ต้องถูกตัด chain ทิ้งด้วยข้อความเหตุผลที่ต่างจาก get');

  const remaining = await queueSvc.getAll();
  console.assert(remaining.length === 2, 'queue ต้องเหลือแค่ 2 รายการที่ fail (ของ pallet B) ส่วนที่ sync สำเร็จถูกลบออกแล้ว');
  console.assert(remaining.every((a) => a.palletCode === 'PLM-B'), 'ที่เหลือใน queue ต้องเป็นของ pallet B เท่านั้น');
  console.assert(remaining.find((a) => a.id === getB.id) !== undefined, 'get ของ pallet B ที่ fail ต้องยังอยู่ใน queue');

  //  จำลอง syncAll() ถูกเรียกซ้อนกันจริง (เช่น HeaderComponent 2 instance พร้อมกัน) -> ต้องยิง API แค่รอบเดียว
  //  ไม่งั้น backend จะเจอ get-pallet ซ้ำสำหรับ pallet เดียวกัน (root cause ของ "Pallet is already assigned...")
  await queueSvc.clear();
  let callCount = 0;
  const countingApi = {
    callJobApi: () => {
      callCount++;
      return of({ status: 'ok' });
    },
  } as any;
  await queueSvc.enqueue({ jobId: 3, systemNo: 'OUT003', palletCode: 'PLM-C', actionType: 'get', requestData: {}, jobTypeFlags: {} });
  const syncSvc2 = new OfflineSyncService(queueSvc, countingApi);
  const [r1, r2] = await Promise.all([syncSvc2.syncAll(), syncSvc2.syncAll()]);
  console.assert(callCount === 1, `syncAll ที่เรียกซ้อนกันต้องยิง API แค่ 1 ครั้ง ไม่ใช่ ${callCount}`);
  console.assert(r1 === r2, 'syncAll ที่เรียกซ้อนกันต้องได้ผลลัพธ์ (promise) เดียวกัน ไม่ประมวลผลซ้ำ');

  console.log('offlineSyncService self-check: PASS');
}
