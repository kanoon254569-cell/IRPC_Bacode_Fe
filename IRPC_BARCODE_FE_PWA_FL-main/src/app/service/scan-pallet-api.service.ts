import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CrudService } from './crud.service';
import { AutoLogoutService } from './auto-logout.service';

//  Action ของ API ที่ต้องเลือกให้ตรงประเภทงาน (Request / Picking / Shipping / Inbound ปกติ)
export type JobApiAction = 'get' | 'putAway' | 'reset';

//  Signature กลางของ Service Method ทั้ง 3 กลุ่ม (get / putAway / reset) — ทุกตัวรับพารามิเตอร์เหมือนกัน
type JobApiFn = (jobId: number, requestData: any) => Observable<any>;

//  Flag ประเภทงาน ใช้เลือก Service Method ของ CrudService ให้ตรงกับ endpoint
export interface JobTypeFlags {
  //  Request — isSpecialJob ก็เป็น true ด้วยเช่นกัน (ใช้ special-job flow ทั้งหมดฝั่ง client: นับถุง/Add Pallet/full-pallet)
  //  แต่ backend มี endpoint ของตัวเองแยกครบ (get/putAway/reset ที่ /request/...) ต้องเช็คตัวนี้ก่อน isSpecialJob เสมอ
  isRequestJob: boolean;
  isPickingJob: boolean;
  isShippingJob: boolean;
  isSpecialJob: boolean;
  //  Breakage & Replacement — isSpecialJob ก็เป็น true ด้วย (ใช้ special-job flow ทั้งหมด) แต่ต้องเช็คตัวนี้ก่อนเสมอ
  //  เพราะ Get/Put มี endpoint ของตัวเอง /broken-bag/... (ไม่มี reset แยก เลย fallback ไปใช้ของ special เหมือนเดิม)
  isBkJob: boolean;
  //  Internal Transfer — isSpecialJob ก็เป็น true ด้วยเช่นกัน (ใช้ special-job flow ทั้งหมดฝั่ง client) แต่ backend แยก endpoint
  //  ของตัวเองครบทั้ง get/putAway/reset (ต่างจาก BK ที่ไม่มี reset แยก) ต้องเช็คตัวนี้ก่อน isSpecialJob เสมอ
  isInternalTransferJob: boolean;
  //  Transfer WH — เหมือน Internal Transfer เป๊ะ: isSpecialJob เป็น true ด้วย (ใช้ special-job flow ทั้งหมดฝั่ง client
  //  นับถุง/full-pallet modeId ฯลฯ) แต่ backend แยก endpoint ของตัวเองครบทั้ง get/putAway/reset ที่ /transfer-wh/...
  //  ต้องเช็คตัวนี้ก่อน isSpecialJob เสมอ
  isTransferWh: boolean;
}

//  หมายเหตุ Shipping: ย้ายเข้า special-job flow ฝั่ง client เต็มรูปแบบแล้ว (isSpecialJob เป็น true ด้วยเช่นกัน เหมือน
//  Request/Picking/Transfer WH/Internal Transfer) แต่ backend แยก endpoint ของตัวเองที่ /shipping/... อยู่ก่อนแล้ว
//  (resetShippingPallet/updateShippingPalletGet/PutAway) ต้องเช็ค isShippingJob ก่อน isSpecialJob เสมอเหมือนกัน
//  (ดู resolveJobApi) BE ยังไม่อัปเดต endpoint พวกนี้ให้รองรับ payload แบบ special (modeId/qrCodes/palletSeq ฯลฯ)
//  ตอนนี้ -> ขึ้น client ไว้รอก่อนตามที่ตกลง ทดสอบจริงไม่ได้จนกว่า BE จะแก้ตาม

//  Service รวมจุดที่ scan-pallet ยิง API ทั้งหมด (เลือก endpoint ตามประเภทงาน + ดึงข้อมูล pallet/location ประกอบการสแกน)
@Injectable({
  providedIn: 'root',
})
export class ScanPalletApiService {

  constructor(private restService: CrudService, private autoLogout: AutoLogoutService) { }

  //  เลือก Service Method ของ CrudService ให้ตรงกับประเภทงาน (Request / Picking / Shipping / ปกติ) และ action (get/putAway/reset) แล้วยิง API
  //  get/putAway สำเร็จ -> แจ้ง AutoLogoutService ว่ามี action จริง (ใช้ตรรกะเดียวกับหลังบ้านที่ auto checkout forklift)
  //  ไม่รวม reset (ไม่ใช่ action ที่หลังบ้านนับ) และไม่กระทบ auto-fetch poll เพราะนั่นยิงคนละ endpoint ไม่ผ่านจุดนี้
  callJobApi(jobType: JobTypeFlags, action: JobApiAction, jobId: number, requestData: any): Observable<any> {
    const fn = this.resolveJobApi(jobType, action);
    const result$ = fn.call(this.restService, jobId, requestData);
    return action === 'get' || action === 'putAway'
      ? result$.pipe(tap(() => this.autoLogout.recordAction()))
      : result$;
  }

  private resolveJobApi(jobType: JobTypeFlags, action: JobApiAction): JobApiFn {
    const table: Record<JobApiAction, { request: JobApiFn; picking: JobApiFn; shipping: JobApiFn; special: JobApiFn; bk: JobApiFn; internalTransfer: JobApiFn; transferWh: JobApiFn; default: JobApiFn }> = {

      //  Get Pallet
      get: {
        request: this.restService.updateRequestPalletGet,
        picking: this.restService.updatePickingPalletGet,
        shipping: this.restService.updateShippingPalletGet,
        special: this.restService.updateSpecialPalletGet,
        bk: this.restService.updateBrokenBagPalletGet,
        internalTransfer: this.restService.updateInternalTransferPalletGet,
        transferWh: this.restService.updateTransferWhPalletGet,
        default: this.restService.updateInboundPalletGet,
      },

      //  Put Pallet — BK ไม่มีขั้นสแกน location ปลายทาง แต่ยิง Put ต่อให้เองทันทีหลัง Get (ดู putAwayBkPallets ใน scan-pallet)
      putAway: {
        request: this.restService.updateRequestPalletPutAway,
        picking: this.restService.updatePickingPalletPutAway,
        shipping: this.restService.updateShippingPalletPutAway,
        special: this.restService.updateSpecialPalletPutAway,
        bk: this.restService.updateBrokenBagPalletPutAway,
        internalTransfer: this.restService.updateInternalTransferPalletPutAway,
        transferWh: this.restService.updateTransferWhPalletPutAway,
        default: this.restService.updateInboundPalletPutAway,
      },

      //  Delete — BK ไม่มี endpoint reset ของตัวเอง ใช้ของ special เหมือนกัน
      reset: {
        request: this.restService.resetRequestPallet,
        picking: this.restService.resetPickingPallet,
        shipping: this.restService.resetShippingPallet,
        special: this.restService.resetSpecalPallet,
        bk: this.restService.resetSpecalPallet,
        internalTransfer: this.restService.resetInternalTransferPallet,
        transferWh: this.restService.resetTransferWhPallet,
        default: this.restService.resetInboundPallet,
      },
    };

    const handlers = table[action];

    if (jobType.isBkJob) return handlers.bk;
    if (jobType.isInternalTransferJob) return handlers.internalTransfer;
    if (jobType.isTransferWh) return handlers.transferWh;
    if (jobType.isRequestJob) return handlers.request;
    //  Picking — isSpecialJob ก็เป็น true ด้วยเช่นกัน (เข้า special-job flow ฝั่ง client เหมือน RQ/Transfer WH/IT) แต่
    //  backend มี endpoint ของตัวเองแยกครบ (get/putAway/reset ที่ /picking/...) ต้องเช็คตัวนี้ก่อน isSpecialJob เสมอ
    if (jobType.isPickingJob) return handlers.picking;
    //  Shipping เหมือนกัน (isSpecialJob เป็น true ด้วยตั้งแต่ย้ายเข้ากลุ่มนี้) ต้องเช็คก่อน isSpecialJob เสมอ ไม่งั้นหลุด
    //  ไปเรียก /special/... ผิด endpoint (ของจริงคือ /shipping/... ที่มีอยู่ก่อนแล้ว)
    if (jobType.isShippingJob) return handlers.shipping;
    if (jobType.isSpecialJob) return handlers.special;
    return handlers.default;
  }

  //  ดึง qty จริงของ Pallet จาก Backend ตอนสแกนถุงครบ (ยืนยัน Pallet)
  //  แนบ palletId (ตัวเลขจริง, ตรงกับ pallet_id ที่ parse จาก QR) ไปด้วย ไม่งั้นถ้ามีหลาย pallet grade/lot เดียวกัน จะหาใบที่สแกนจริงไม่เจอ
  //  ห้ามส่ง palletNo (string) เป็นค่าเดียวกับ palletId เพราะ palletNo จริงๆ คือรหัส pallet_no เต็ม (เช่น "PLA2609070001")
  //  ไม่ใช่เลขสั้นๆจาก QR -> ส่งค่าไม่ตรงกัน backend AND filter เข้าด้วยกันแล้วจะไม่เจอ record เลย (ปล่อยว่างไว้แทน)
  getProcessPallet(palletId: string, grade: string, lot: string, qrCode: string = ''): Observable<any> {
    return this.restService.GetProcessPallet(0, '', grade, lot, 0, 0, Number(palletId) || 0, qrCode);
  }

  //  งาน Special 2-step เท่านั้น: ส่งมอบยอดถุงที่เหลือให้คนทำ Step 2 มา Get/Put ต่อ -> ไม่มี endpoint แยกตามประเภทงานอื่น
  prepareSpecialPallet(jobId: number, requestData: any): Observable<any> {
    return this.restService.prepareSpecialPallet(jobId, requestData);
  }

  //  ค้นหา Location จาก Pre-zone (งาน Picking ที่ยังไม่มี Location ปลายทางกำหนดไว้ล่วงหน้า)
  getPreZoneLocation(locationCode: string): Observable<any> {
    return this.restService.GetPreZoneLocation(locationCode);
  }
}
