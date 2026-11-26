import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { OfflineStorageService } from './offline-storage.service';

export interface QueueCounts {
  get: number;
  putAway: number;
  reset: number;
}

//  รอบแรก: เฉพาะงานธรรมดา (Inbound/Outbound/Request/Picking/Shipping) เท่านั้น ยังไม่รองรับ Special/BK/IT
export type QueueActionType = 'get' | 'putAway' | 'reset';

export interface QueuedAction {
  id: string;
  jobId: number;
  //  เลขงานที่อ่านง่าย (system_no) เก็บไว้ตั้งแต่ตอน queue เพื่อโชว์สรุปตอน sync เสร็จ ไม่ต้องไปหาใหม่
  systemNo: string;
  //  โค้ด pallet (normalizeQrCode แล้ว) ใช้ผูก chain dependency: Put/Reset ต้องรอ Get ของ pallet เดียวกัน sync ก่อนเสมอ
  palletCode: string;
  actionType: QueueActionType;
  //  request body ที่จะส่งให้ callJobApi ตอน sync จริง (สร้างไว้ล่วงหน้าตั้งแต่ตอนสแกน ไม่ต้องสร้างใหม่ตอน sync)
  requestData: any;
  //  JobTypeFlags ของตอนสแกน ใช้ resolveJobApi ตอน sync ให้ยิงเส้นถูกต้องเหมือนตอนออนไลน์
  jobTypeFlags: any;
  //  เวลาที่สแกนจริง (สำหรับแสดงผล/debug เท่านั้น) -> ห้ามใช้เทียบลำดับ เพราะ Date.now() ชนกันได้ถ้าสแกน 2 ครั้งในมิลลิวินาทีเดียวกัน
  queuedAt: number;
  //  เลขลำดับที่นับขึ้นเรื่อยๆ ไม่มีวันชนกัน -> ใช้เทียบลำดับ/chain dependency แทน queuedAt เสมอ
  seq: number;
}

const STORAGE_KEY = '_OFFLINE_ACTION_QUEUE';

//  Service เก็บคิวแอคชั่น (Get/Put/Reset) ที่ยิงไม่สำเร็จเพราะไม่มีเน็ต ไว้ replay ตอนกลับมา online
//  ไม่มี logic ตรวจสอบ/เรียก API เอง (นั่นเป็นหน้าที่ของ sync runner ที่เรียกใช้ service นี้) แค่เก็บ/อ่าน/นับ/ลบ
//  ใช้ OfflineStorageService (IndexedDB) ที่มีอยู่แล้วในระบบเป็นชั้นเก็บข้อมูลจริง แทนการยิง localStorage เอง
//  กันมีกลไก offline storage 2 แบบปนกันในแอปเดียว
@Injectable({
  providedIn: 'root',
})
export class OfflineQueueService {

  //  แจ้งจำนวนที่รอ sync แบบ real-time -> HeaderComponent subscribe ไว้โชว์ badge ไม่ต้อง poll เอง
  private readonly _counts$ = new BehaviorSubject<QueueCounts>({ get: 0, putAway: 0, reset: 0 });
  readonly counts$: Observable<QueueCounts> = this._counts$.asObservable();

  //  กัน enqueue/remove/clear ชนกันตอนเรียกพร้อมกัน (เช่น Put-away หลาย pallet ยิงพร้อมกันผ่าน forkJoin)
  //  ทุก mutation เรียงคิวผ่านตัวเดียวนี้ กันปัญหา read-modify-write ทับกันจนข้อมูลหาย (lost update)
  private _mutationLock: Promise<void> = Promise.resolve();

  constructor(private offlineStorage: OfflineStorageService) {
    this.refreshCounts();
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this._mutationLock.then(fn, fn);
    this._mutationLock = run.then(() => undefined, () => undefined);
    return run;
  }

  private async readQueue(): Promise<QueuedAction[]> {
    const data = await this.offlineStorage.load<QueuedAction[]>(STORAGE_KEY);
    return data ?? [];
  }

  private async writeQueue(queue: QueuedAction[]): Promise<void> {
    await this.offlineStorage.save(STORAGE_KEY, queue);
    await this.refreshCounts(queue);
  }

  //  อัปเดต counts$ ให้ตรงกับ queue ปัจจุบันเสมอ -> await ได้เพื่อกัน race (caller เช็ค counts$ ทันทีหลัง enqueue/remove ต้องเห็นค่าล่าสุดแน่ๆ)
  private async refreshCounts(queue?: QueuedAction[]): Promise<void> {
    const q = queue ?? (await this.readQueue());
    this._counts$.next({
      get: q.filter((x) => x.actionType === 'get').length,
      putAway: q.filter((x) => x.actionType === 'putAway').length,
      reset: q.filter((x) => x.actionType === 'reset').length,
    });
  }

  //  เพิ่มแอคชั่นเข้า queue -> เรียกตอนยิง callJobApi ไม่สำเร็จเพราะไม่มีเน็ต (ไม่ใช่ backend reject ปกติ)
  //  ผ่าน withLock เสมอ เพราะ Put-away หลาย pallet ยิง enqueue() พร้อมกันได้ (forkJoin) ถ้าไม่ล็อก อ่าน queue ชุดเดิม
  //  ซ้อนกันแล้วเขียนทับกัน จะทำให้ entry ของอีกฝั่งหายไปเงียบๆ
  async enqueue(action: Omit<QueuedAction, 'id' | 'queuedAt' | 'seq'>): Promise<QueuedAction> {
    return this.withLock(async () => {
      const queue = await this.readQueue();
      const maxSeq = queue.reduce((max, q) => Math.max(max, q.seq), 0);
      const entry: QueuedAction = {
        ...action,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        queuedAt: Date.now(),
        seq: maxSeq + 1,
      };
      queue.push(entry);
      await this.writeQueue(queue);
      return entry;
    });
  }

  //  รายการทั้งหมด เรียงตามลำดับที่สแกนจริง (seq) -> sync runner ต้องไล่ตามลำดับนี้เท่านั้น ห้ามสลับ
  async getAll(): Promise<QueuedAction[]> {
    return (await this.readQueue()).sort((a, b) => a.seq - b.seq);
  }

  //  นับจำนวนที่รอ sync แยกตามประเภท -> ใช้โชว์ badge บน header
  async getCounts(): Promise<{ get: number; putAway: number; reset: number }> {
    const queue = await this.readQueue();
    return {
      get: queue.filter((q) => q.actionType === 'get').length,
      putAway: queue.filter((q) => q.actionType === 'putAway').length,
      reset: queue.filter((q) => q.actionType === 'reset').length,
    };
  }

  //  ลบรายการที่ sync สำเร็จแล้ว หรือถูกตัดทิ้งเพราะ chain ก่อนหน้าพัง
  async remove(id: string): Promise<void> {
    return this.withLock(async () => {
      const queue = await this.readQueue();
      await this.writeQueue(queue.filter((q) => q.id !== id));
    });
  }

  //  เช็คว่า pallet นี้ยังมีแอคชั่นที่สแกน "ก่อนหน้า" ค้างอยู่ในคิวไหม (ยังไม่ sync)
  //  ใช้กัน Put/Reset วิ่งแซง Get ของ pallet เดียวกันที่ยังไม่ยืนยันกับ backend (เทียบด้วย seq ไม่ใช่ queuedAt กัน Date.now() ชนกัน)
  async hasEarlierPendingActionFor(palletCode: string, beforeSeq: number): Promise<boolean> {
    const queue = await this.readQueue();
    return queue.some((q) => q.palletCode === palletCode && q.seq < beforeSeq);
  }

  async clear(): Promise<void> {
    return this.withLock(async () => {
      await this.offlineStorage.remove(STORAGE_KEY);
      await this.refreshCounts([]);
    });
  }
}

//  ponytail: self-check เบื้องต้น (enqueue/getAll/getCounts/remove/chain-check) — mock เฉพาะ OfflineStorageService
//  (ไม่ใช้ IndexedDB จริง เพราะไม่มีให้ใช้นอก browser) รันด้วย node ได้ตรงๆ ถ้ามี ts-node/compile ไว้ก่อน
//  ไม่ครอบคลุม sync runner จริง (ยังไม่เขียน) — เพิ่ม integration test ตอนเชื่อมเข้ากับ scan-pallet.ts จริง
export async function __offlineQueueServiceSelfCheck(): Promise<void> {
  const store = new Map<string, any>();
  const fakeStorage = {
    save: async (key: string, data: any) => { store.set(key, data); },
    load: async (key: string) => store.get(key) ?? null,
    remove: async (key: string) => { store.delete(key); },
  } as OfflineStorageService;

  const svc = new OfflineQueueService(fakeStorage);

  console.assert((await svc.getAll()).length === 0, 'queue ต้องว่างตอนเริ่ม');

  const a = await svc.enqueue({ jobId: 1, systemNo: 'OUT001', palletCode: 'PLM001', actionType: 'get', requestData: {}, jobTypeFlags: {} });
  const b = await svc.enqueue({ jobId: 1, systemNo: 'OUT001', palletCode: 'PLM001', actionType: 'putAway', requestData: {}, jobTypeFlags: {} });

  console.assert((await svc.getAll()).length === 2, 'ต้องมี 2 รายการหลัง enqueue 2 ครั้ง');
  console.assert((await svc.getAll())[0].id === a.id, 'ต้องเรียงตาม seq (a มาก่อน b)');
  console.assert(a.seq < b.seq, 'seq ต้องเพิ่มขึ้นเรื่อยๆ ไม่ชนกันแม้ queuedAt (Date.now()) จะเท่ากัน');
  const counts1 = await svc.getCounts();
  console.assert(counts1.get === 1 && counts1.putAway === 1, 'นับแยกประเภทต้องถูก');
  console.assert((await svc.hasEarlierPendingActionFor('PLM001', b.seq)) === true, 'put ต้องเห็นว่า get ก่อนหน้ายังค้างอยู่');

  let latestCounts: any = null;
  const sub = svc.counts$.subscribe((c) => { latestCounts = c; });
  console.assert(latestCounts?.get === 1 && latestCounts?.putAway === 1, 'counts$ ต้องตรงกับ getCounts() (ใช้โดย header badge)');

  await svc.remove(a.id);
  console.assert(latestCounts?.get === 0 && latestCounts?.putAway === 1, 'counts$ ต้องอัปเดตทันทีหลัง remove โดยไม่ต้อง subscribe ใหม่');
  console.assert((await svc.getAll()).length === 1, 'ลบแล้วต้องเหลือ 1 รายการ');
  console.assert((await svc.hasEarlierPendingActionFor('PLM001', b.seq)) === false, 'พอ get sync แล้ว (ลบออก) put ต้องไม่ติด chain อีก');

  await svc.clear();
  console.assert((await svc.getAll()).length === 0, 'clear แล้วต้องว่าง');
  console.assert(latestCounts?.putAway === 0, 'counts$ ต้องเป็น 0 หมดหลัง clear');
  sub.unsubscribe();

  //  จำลอง Put-away หลาย pallet ยิง enqueue() พร้อมกันจริง (forkJoin) -> ไม่มี withLock จะ lost-update
  //  (อ่าน queue ชุดเดิมซ้อนกัน เขียนทับกันจนบาง entry หายไปเงียบๆ) ต้องได้ครบทุกใบเสมอ
  const concurrentResults = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      svc.enqueue({ jobId: 2, systemNo: 'OUT002', palletCode: `PLM00${i}`, actionType: 'putAway', requestData: {}, jobTypeFlags: {} }),
    ),
  );
  console.assert((await svc.getAll()).length === 5, `enqueue พร้อมกัน 5 ครั้งต้องเหลือครบ 5 รายการ (ไม่หายจาก race) ได้จริง ${(await svc.getAll()).length}`);
  const uniqueSeqs = new Set(concurrentResults.map((r) => r.seq));
  console.assert(uniqueSeqs.size === 5, 'seq ของแต่ละ entry ต้องไม่ซ้ำกันแม้ enqueue พร้อมกัน');
  await svc.clear();

  console.log('offlineQueueService self-check: PASS');
}
