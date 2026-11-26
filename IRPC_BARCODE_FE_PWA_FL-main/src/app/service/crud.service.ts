import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpEvent,
  HttpHeaders,
  HttpRequest,
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import * as Type from '../../../src/models/variables-type';
import { environment } from '../../../src/environments/environment';

@Injectable({
  providedIn: 'root',
})

export class CrudService {

  // Define API
  url_ = 'assets/store.json';

  // Api configurations
  private headers = new HttpHeaders({ 'Content-Type': 'application/json' });
  private hostURL = environment.baseAPIURL;
  private apiURL = `${this.hostURL}/api/v1`;

  // Sub api
  private authUrl = `${this.apiURL}/Auth/`;
  private masterUrl = `${this.apiURL}/master/`;
  private plantUrl = `${this.apiURL}/PlantData/`;
  private processUrl = `${this.apiURL}/Process/`;
  private processCbUrl = `${this.apiURL}/process-cb/`;
  private reportUrl = `${this.apiURL}/Report/`;
  private emailUrl = `${this.apiURL}/Mail/`;
  http: any;

  constructor(private httpClient: HttpClient) { }

  // Http Options
  httpOptions = {
    headers: new HttpHeaders({
      'Content-Type': 'application/json',
    }),
  };

  private getAuthHeaders() {
    const token = sessionStorage.getItem('_ACCESS_TOKEN');

    return new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    });
  }

  /*------------------ Auth ---------------------*/
  Login(data: any): Observable<Type.ResponseLogin> {
    return this.httpClient.post<Type.ResponseLogin>(
      `${this.authUrl + 'login'}`,
      data,
      { headers: this.getAuthHeaders() }
    );
  }

  LoginQrCode(data: any): Observable<Type.ResponseLogin> {
    return this.httpClient.post<Type.ResponseLogin>(
      `${this.authUrl + 'login/scan-qr-code'}`,
      data,
      { headers: this.getAuthHeaders() }
    );
  }

  /*------------------ Process CB ---------------------*/
  GetProcessCbJobStatus(userType?: string): Observable<Type.ResponseProcessCbJobStatus> {
    const query = userType ? `?userType=${userType}` : '';

    return this.httpClient.get<Type.ResponseProcessCbJobStatus>(
      `${this.processCbUrl + 'job-status'}${query}`,
      { headers: this.getAuthHeaders() }
    );
  }

  GetProcessCbJobType(): Observable<Type.ResponseProcessCbJobType> {
    return this.httpClient.get<Type.ResponseProcessCbJobType>(
      `${this.processCbUrl + 'job-type'}`,
      { headers: this.getAuthHeaders() }
    );
  }

  /*------------------ Process ---------------------*/

  //  id (ใหม่): ค้นด้วย forklift id ตรงๆ จาก QR ที่สแกน (id|forklift_name) -> ไม่ต้องเอาชื่อไปหาอีกต่อไป (id = 0 = ไม่กรอง)
  GetProcessForklift(id: number, forkliftName: string, whCode: string, forkliftStatus: number, isActive: string, page: number, pageSize: number): Observable<Type.ResponseProcessGetForklift> {
    return this.httpClient.get<Type.ResponseProcessGetForklift>(
      `${this.masterUrl + 'forklift'}?id=${id}&forkliftName=${forkliftName}&whCode=${whCode}&forkliftStatus=${forkliftStatus}&isActive=${isActive}&page=${page}&pageSize=${pageSize}`,
      { headers: this.getAuthHeaders() }
    );
  }

  //  PATCH api/v1/master/forklift/{flId}/checkin — stamp ใช้งานรถ forklift (เรียกตอนกดยืนยันการใช้งานหลัง login สำเร็จ)
  CheckinForklift(flId: number, requestData: Type.ForkliftCheckModel): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.masterUrl}forklift/${flId}/checkin`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  PATCH api/v1/master/forklift/{flId}/checkout — stamp เลิกใช้งานรถ forklift (เรียกตอน logout)
  CheckoutForklift(flId: number, requestData: Type.ForkliftCheckModel): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.masterUrl}forklift/${flId}/checkout`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  GetJobByForklift(flId: number, typeIds?: string, statusIds?: string, date?: string): Observable<Type.ResponseProcessGetForkliftJob> {
    const queryParams: string[] = [];
    if (typeIds) queryParams.push(`typeIds=${typeIds}`);
    if (statusIds) queryParams.push(`statusIds=${statusIds}`);
    if (date) queryParams.push(`date=${date}`);
    const query = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

    return this.httpClient.get<Type.ResponseProcessGetForkliftJob>(
      `${this.processUrl}job/forklift/${flId}${query}`,
      { headers: this.getAuthHeaders() }
    );
  }

  updateInboundPalletGet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/inbound/get-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updateInboundPalletPutAway(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/inbound/put-away'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  resetInboundPallet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/inbound/reset-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updateRequestPalletGet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/request/get-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updateRequestPalletPutAway(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/request/put-away'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  resetRequestPallet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/request/reset-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updatePickingPalletGet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/picking/get-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updatePickingPalletPutAway(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/picking/put-away'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  resetShippingPallet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/shipping/reset-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updateShippingPalletGet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/shipping/get-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updateShippingPalletPutAway(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/shipping/put-away'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  resetPickingPallet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/picking/reset-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  GetPreZoneLocation(locationDesc: string): Observable<Type.ResponseStandard> {
    return this.httpClient.get<Type.ResponseStandard>(
      `${this.masterUrl}location/pre-zone`,
      {
        headers: this.getAuthHeaders(),
        params: { locationDesc }
      }
    );
  }

  updateLoadingPalletGet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/loading/get-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updateLoadingPalletPutAway(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/loading/put-away'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  resetLoadingPallet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/loading/reset-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updateSpecialPalletGet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/special/get-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  งาน Breakage & Replacement (BK) — payload แบบกลุ่ม kilo มี endpoint Get/Put ของตัวเอง (ไม่มี reset แยก ใช้ของ special)
  updateBrokenBagPalletGet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/broken-bag/get-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  BK ไม่มีขั้นสแกน Location ปลายทาง -> หน้า scan-pallet ยิง Put ต่อให้เองทันทีหลัง Get สำเร็จ (ดู putAwayBkPallets)
  updateBrokenBagPalletPutAway(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/broken-bag/put-away'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updateSpecialPalletPutAway(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/special/put-away'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  resetSpecalPallet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/special/reset-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  งาน Special 2-step: ส่งมอบยอดถุงที่เหลือให้คนทำ Step 2 มา Get/Put ต่อ (แยกจาก updateSpecialPalletGet)
  prepareSpecialPallet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/special/prepare-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  งาน Internal Transfer — ใช้ special-job flow ทั้งหมดฝั่ง client (Add Pallet, palletSeq, put-away) แต่ backend แยก endpoint ของตัวเอง
  updateInternalTransferPalletGet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/internal-transfer/get-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updateInternalTransferPalletPutAway(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/internal-transfer/put-away'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  resetInternalTransferPallet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/internal-transfer/reset-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updateTransferWhPalletGet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/transfer-wh/get-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  updateTransferWhPalletPutAway(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/transfer-wh/put-away'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  resetTransferWhPallet(jobId: number, requestData: any): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl + 'job/' + jobId + '/transfer-wh/reset-pallet'}`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  GetJobByLoadingTruck(licensePlate: string): Observable<Type.ResponseStandard> {
    return this.httpClient.get<Type.ResponseStandard>(
      `${this.processUrl}job/loading/${encodeURIComponent(licensePlate)}`,
      { headers: this.getAuthHeaders() }
    );
  }

  //  palletId (int, ตัวใหม่): ใช้หา pallet เจาะจงใบเดียว (id จริงในระบบ) ไม่งั้นถ้ามีหลาย pallet grade/lot เดียวกัน
  //  จะไม่รู้ว่าใบไหนคือใบที่สแกน เช็ค is_full_pallet ผิดใบได้ -> optional เพราะ endpoint อื่น (load-to-truck) ยังไม่ส่งมาก็ได้
  //  หมายเหตุ: query key จริงตาม swagger คือ locationType/locationId (ไม่ใช่ palletTypeID/palletLocationID ที่ใช้ตั้งชื่อ param ไว้เดิม)
  GetProcessPallet(
    id: number,
    palletNo: string,
    grade: string,
    lot: string,
    palletTypeID: number,
    palletLocationID: number,
    palletId: number = 0,
    qrCode: string = '',
  ): Observable<Type.ResponseProcessGetPallet> {
    //  locationType เป็น string ฝั่ง backend -> ถ้าไม่มีค่าจริงต้องส่งเป็นค่าว่าง ไม่ใช่เลข "0" (backend น่าจะเช็คแค่ IsNullOrEmpty
    //  ไม่ได้เช็คว่าเป็น "ไม่มีตัวกรอง" แบบ int -> ส่ง "0" ไปจะกลายเป็นกรอง location_type == "0" ซึ่งไม่ตรง record ไหนเลย หาไม่เจอทั้งที่มีข้อมูลจริง)
    const locationTypeParam = palletTypeID || '';
    return this.httpClient.get<Type.ResponseProcessGetPallet>(
      `${this.processUrl + 'pallet'}?id=${id}&palletId=${palletId}&palletNo=${palletNo}&grade=${grade}&lot=${lot}&locationType=${locationTypeParam}&locationId=${palletLocationID}&qrCode=${qrCode}`,
      { headers: this.getAuthHeaders() }
    );
  }

  /*------------------ Scan Location Info ---------------------*/
  //  GET api/v1/master/location/wh/MWH — ค้น location จากโค้ดที่สแกน (QR Location = location_desc)
  GetMasterWhLocation(locationDesc: string): Observable<Type.ResponseMasterWhLocation> {
    return this.httpClient.get<Type.ResponseMasterWhLocation>(
      `${this.masterUrl}location/wh/MWH?locationDesc=${encodeURIComponent(locationDesc)}&statusId=1&page=1&pageSize=1`,
      { headers: this.getAuthHeaders() }
    );
  }

  //  GET api/v1/process/pallet/by-location — Pallet ทั้งหมดที่อยู่ใน location นี้
  //  (tr_pallet.current_location_type = 'MWH' AND current_location_id = locationId)
  GetPalletByLocation(locationId: number, locationType: string = 'MWH'): Observable<Type.ResponsePalletByLocation> {
    return this.httpClient.get<Type.ResponsePalletByLocation>(
      `${this.processUrl}pallet/by-location?locationId=${locationId}&locationType=${locationType}&page=1&pageSize=1000`,
      { headers: this.getAuthHeaders() }
    );
  }

  /*------------------ Pallet Management ---------------------*/
  //  GET api/v1/process/pallet-management — qrCode = QR ถุงบนพาเลท หรือ pallet_no
  GetPalletManagement(qrCode: string): Observable<Type.ResponsePalletManagement> {
    return this.httpClient.get<Type.ResponsePalletManagement>(
      `${this.processUrl}pallet-management?qrCode=${encodeURIComponent(qrCode)}`,
      { headers: this.getAuthHeaders() }
    );
  }

  //  GET api/v1/process/pallet-management/bag — หาถุง orphan: สแกน (qrCode) หรือกรอกเอง (grade + lot + bagNo)
  //  กรอกเองต้องครบ 5 ส่วนของ QR ถุง: costCenter|grade|lot|bagNo|palletRunningNo (Ton No.)
  //  currentPalletId > 0 = Replace (สลับ): รับถุงที่อยู่บนพาเลทอื่นได้ แต่ห้ามอยู่บนพาเลทนี้
  FindPalletManagementBag(qrCode: string, costCenter: string = '', grade: string = '', lot: string = '', bagNo: number = 0, palletRunningNo: number = 0, currentPalletId: number = 0): Observable<Type.ResponsePalletManagementFindBag> {
    const swap = currentPalletId > 0 ? `&allowOnPallet=true&currentPalletId=${currentPalletId}` : '';
    return this.httpClient.get<Type.ResponsePalletManagementFindBag>(
      `${this.processUrl}pallet-management/bag?qrCode=${encodeURIComponent(qrCode)}&costCenter=${encodeURIComponent(costCenter)}&grade=${encodeURIComponent(grade)}&lot=${encodeURIComponent(lot)}&bagNo=${bagNo}&palletRunningNo=${palletRunningNo}${swap}`,
      { headers: this.getAuthHeaders() }
    );
  }

  //  POST api/v1/process/pallet-management/move-bag (pProcessPalletMgmtMoveBag) -- ย้ายถุงที่อยู่บนพาเลทอื่น
  //  เข้าพาเลทปลายทาง (Add Bag ด้วย QR พาเลท PL<code>|grade|lot|qty) body เหมือน add-bag
  MovePalletManagementBag(requestData: Type.PalletManagementAddBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.post<Type.ResponseStandard>(
      `${this.processUrl}pallet-management/move-bag`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  POST api/v1/process/pallet-management/merge-pallet (pProcessPalletMgmtMergePallet) -- รวมทั้งพาเลท
  //  ใช้เมื่อพาเลทต้นทางหรือปลายทางเป็น Manual (PLM) ; Auto -> Auto ยังใช้ move-bag ทีละถุง
  MergePalletManagementPallet(requestData: Type.PalletManagementMergePalletModel): Observable<Type.ResponseStandard> {
    return this.httpClient.post<Type.ResponseStandard>(
      `${this.processUrl}pallet-management/merge-pallet`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  POST api/v1/process/pallet-management/add-bag (sp_PalletAdjustment_AddBagIn เดียวกับหน้า Pallet Adjustment ของ WEB
  //  แต่ไม่ผูก permission data.pallet_management ของ WEB)
  AddPalletManagementBag(requestData: Type.PalletManagementAddBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.post<Type.ResponseStandard>(
      `${this.processUrl}pallet-management/add-bag`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  POST api/v1/process/pallet-management/pull-out-bag -- SP เดียวกับปุ่ม "ดึงถุงออกจากพาเลท" ของ Boardman
  //  (sp_PalletAdjustment_PullBagOut) ถุงกลายเป็น Orphan Bag + เรียงเลขถุงที่เหลือใหม่
  PullOutPalletManagementBag(requestData: Type.PalletManagementPullOutBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.post<Type.ResponseStandard>(
      `${this.processUrl}pallet-management/pull-out-bag`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  POST api/v1/process/pallet-management/dummy/add-bag -- ย้ายถุง 1 ใบ (orphan / บนพาเลท Auto หรือ Dummy อื่น) ลง Dummy Pallet
  AddDummyPalletBag(requestData: Type.PalletManagementAddBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.post<Type.ResponseStandard>(
      `${this.processUrl}pallet-management/dummy/add-bag`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  POST api/v1/process/pallet-management/dummy/transfer -- เบิกจากพาเลท Manual / Dummy อื่นตามจำนวนถุง ลง Dummy Pallet
  TransferDummyPalletBags(requestData: Type.PalletManagementDummyTransferModel): Observable<Type.ResponseStandard> {
    return this.httpClient.post<Type.ResponseStandard>(
      `${this.processUrl}pallet-management/dummy/transfer`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  POST api/v1/process/pallet-management/clear-dummy -- ล้าง Dummy Pallet (SP เดียวกับแท็บ Dummy Pallet ของ Boardman)
  ClearPalletManagementDummy(requestData: Type.PalletManagementClearDummyModel): Observable<Type.ResponseStandard> {
    return this.httpClient.post<Type.ResponseStandard>(
      `${this.processUrl}pallet-management/clear-dummy`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  POST api/v1/process/pallet-management/reject-bag -- SP เดียวกับปุ่ม "ถุง Reject" ของ Boardman
  //  (pProcessUpdateBagRejectStatus) ถุงถัดไปในพาเลทเลื่อนขึ้นมาแทนอัตโนมัติ
  RejectPalletManagementBag(requestData: Type.PalletManagementRejectBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.post<Type.ResponseStandard>(
      `${this.processUrl}pallet-management/reject-bag`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  ReplacePalletManagementBag(requestData: Type.PalletManagementReplaceBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.post<Type.ResponseStandard>(
      `${this.processUrl}pallet-management/replace-bag`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  EditPalletManagementBag(requestData: Type.PalletManagementEditBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.post<Type.ResponseStandard>(
      `${this.processUrl}pallet-management/edit-bag`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  /*------------------ Broken Bag List ---------------------*/
  //  Endpoint จริง: api/v1/Process/broken-bag (BrokenBagController) — signature
  //  ตรงกับ GetBrokenBagList/CreateBrokenBag ของ IRPC_BARCODE_FE_PWA_CHECKER
  //  date: รูปแบบ ISO yyyy-MM-dd — ส่ง &date= เสมอ (ว่าง = ทุกวัน); ฝั่ง API แปลงค่าว่างเป็น NULL ให้เอง
  GetBrokenBagList(
    whCode: string,
    docNo: string = '',
    statusId: number = 0,
    page: number = 1,
    pageSize: number = 100,
    date: string = '',
  ): Observable<Type.ResponseProcessBrokenBagListData> {
    return this.httpClient.get<Type.ResponseProcessBrokenBagListData>(
      `${this.processUrl}broken-bag?whCode=${encodeURIComponent(whCode)}&docNo=${docNo}&statusId=${statusId}&page=${page}&pageSize=${pageSize}&date=${encodeURIComponent(date)}`,
      { headers: this.getAuthHeaders() }
    );
  }

  CreateBrokenBag(requestData: Type.CreateBrokenBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.post<Type.ResponseStandard>(
      `${this.processUrl}broken-bag`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  GET api/v1/master/vehicle — ตรวจว่ามีรถคันนี้จริงไหมตอนสแกน QR รถ (แจ้งเปลี่ยนถุงแตก step สแกน Truck)
  GetMasterVehicle(licensePlate: string): Observable<Type.ResponseMasterVehicle> {
    return this.httpClient.get<Type.ResponseMasterVehicle>(
      `${this.masterUrl}vehicle?licensePlate=${encodeURIComponent(licensePlate)}&carrierName=&vehicleType=&isActive=&page=1&pageSize=20&sortBy=&sortOrder=`,
      { headers: this.getAuthHeaders() }
    );
  }

  //  GET api/v1/master/location/dock — endpoint ไม่มี param ค้นด้วย location_desc ตรงๆ เลยดึงทั้งหมดของ whCode มาหาเอง
  //  (ตรวจว่ามี dock นี้จริงไหมตอนสแกน QR dock)
  GetMasterLocationDock(whCode: string = ''): Observable<Type.ResponseMasterDock> {
    return this.httpClient.get<Type.ResponseMasterDock>(
      `${this.masterUrl}location/dock?whCode=${encodeURIComponent(whCode)}&areaCode=&levelCode=&locationCode=`,
      { headers: this.getAuthHeaders() }
    );
  }

  //  PATCH api/v1/Process/broken-bag/{jobId}/replace (BrokenBagController.ConfirmReplaceBrokenBag)
  //  ปุ่ม Submit ใน modal "เปลี่ยนของกับ Warehouse" — signature ตรงกับฝั่ง IRPC_BARCODE_FE_PWA_CHECKER
  ConfirmReplaceBrokenBag(jobId: number, requestData: Type.ConfirmReplaceBrokenBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl}broken-bag/${jobId}/replace`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  PATCH api/v1/Process/broken-bag/{jobId}/forklift-scan-broken-bag (BrokenBagController.ForkliftScanBrokenBag)
  //  ปุ่ม Submit ใน modal "เปลี่ยนของกับ Warehouse" — บันทึกการสแกนถุงแตกของ forklift
  //  -> pProcessForkliftScanBrokenBag (status log 3 "สแกนถุงแตกสำเร็จ", shipping_ready = 1)
  ForkliftScanBrokenBag(jobId: number, requestData: Type.ForkliftScanBrokenBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl}broken-bag/${jobId}/forklift-scan-broken-bag`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  PATCH api/v1/Process/broken-bag/{id}/shipping/scan-bag — แทน ForkliftScanBrokenBag เดิมในปุ่ม Submit ของ modal
  //  "เปลี่ยนของกับ Warehouse" (มี reason ต่อถุง + updateBy เพิ่มมาจาก endpoint เดิม)
  ShippingScanBrokenBag(jobId: number, requestData: Type.ShippingScanBrokenBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl}broken-bag/${jobId}/shipping/scan-bag`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }

  //  PATCH api/v1/process/broken-bag/{id}/complete — ปิดงาน หลังนำของขึ้นรถ (put-away) สำเร็จเท่านั้น
  CompleteBrokenBag(jobId: number, requestData: Type.CompleteBrokenBagModel): Observable<Type.ResponseStandard> {
    return this.httpClient.patch<Type.ResponseStandard>(
      `${this.processUrl}broken-bag/${jobId}/complete`,
      requestData,
      { headers: this.getAuthHeaders() }
    );
  }
}