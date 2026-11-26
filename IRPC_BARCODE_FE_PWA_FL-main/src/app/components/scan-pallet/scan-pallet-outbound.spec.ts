import { ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { CrudService } from '../../service/crud.service';
import { NetworkService } from '../../service/network.service';
import { OfflineQueueService } from '../../service/offline-queue.service';
import { OfflineSyncService } from '../../service/offline-sync.service';
import { ScanPalletApiService } from '../../service/scan-pallet-api.service';
import { ScanPalletLogicService } from '../../service/scan-pallet-logic.service';
import { TourService } from '../../service/tour.service';
import { ScanPallet } from './scan-pallet';

describe('ScanPallet outbound scanning', () => {
  afterEach(() => vi.useRealTimers());

  it('releases the first pallet scan group so a second pallet can be scanned before source location', () => {
    vi.useFakeTimers();

    const scanLogic = new ScanPalletLogicService();
    const scanApi = {
      getProcessPallet: vi.fn(() => NEVER),
    } as unknown as ScanPalletApiService;
    const component = new ScanPallet(
      {} as Router,
      { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
      scanLogic,
      scanApi,
      {} as OfflineQueueService,
      {} as CrudService,
      {} as NetworkService,
      {} as OfflineSyncService,
      {} as TourService,
    );

    const item = {
      id: 1,
      grade: 'GRADE-A',
      lot_no: 'LOT-1',
      total_qty: 2,
      complete_qty: 0,
      scan_qty: 1,
      locations: {
        from_locations: [{ location_id: 7, location_name: 'A-01', total_qty: 2, complete_qty: 0 }],
        to_locations: [],
      },
    };
    component._isOutbound = true;
    component._isScanning = true;
    component._jobDataRaw = {
      id: 1,
      items: [item],
      pallets: { awaiting_source_pallet: [], receive_pallet: [], complete_pallet: [] },
    };

    vi.spyOn(component, 'SweetAlert').mockImplementation(() => Promise.resolve({} as any));
    vi.spyOn(component, 'focusScannerInput');
    vi.spyOn(component as any, 'showScanSuccessToast').mockImplementation(() => {});

    component._scannerValue = '1234|GRADE-A|LOT-1|01|001';
    component.onScannerEnter();
    expect((component as any)._currentGroup).toBeNull();

    component._scannerValue = '1234|GRADE-A|LOT-1|02|002';
    component.onScannerEnter();

    expect((component as any)._currentGroup).toBeNull();
    expect((component as any)._outboundVerificationPallets).toHaveLength(2);

    component._scannerValue = '1234|GRADE-A|LOT-1|03|003';
    component.onScannerEnter();

    expect((component as any)._outboundVerificationPallets).toHaveLength(2);
    expect(component.SweetAlert).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('ไม่เกิน 2 พาเลท'),
    );
  });

  it('keeps scanning after warning about a duplicate source pallet while one pallet is pending', () => {
    vi.useFakeTimers();

    const scanLogic = new ScanPalletLogicService();
    const scanApi = {
      getProcessPallet: vi.fn(() => NEVER),
    } as unknown as ScanPalletApiService;
    const component = new ScanPallet(
      {} as Router,
      { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
      scanLogic,
      scanApi,
      {} as OfflineQueueService,
      {} as CrudService,
      {} as NetworkService,
      {} as OfflineSyncService,
      {} as TourService,
    );
    const item = {
      id: 1,
      grade: 'GRADE-A',
      lot_no: 'LOT-1',
      total_qty: 20000,
      receive_qty: 0,
      complete_qty: 0,
      locations: {
        from_locations: [{ location_id: 7, location_name: 'A-01', total_qty: 20000 }],
      },
    };
    const firstCode = '1234|GRADE-A|LOT-1|01|001';
    const firstParsed = scanLogic.parseScanCode(firstCode)!;

    component._isOutbound = true;
    component._isSpecialJob = true;
    component._isRequestJob = true;
    component._isScanning = true;
    component._jobDataRaw = {
      id: 1,
      type_name: 'Request',
      items: [item],
      pallets: { awaiting_source_pallet: [], receive_pallet: [], complete_pallet: [] },
    };
    (component as any)._specialAwaitingSourceLocation = [{
      code: firstCode,
      parsed: firstParsed,
      item,
      remaining: 20000,
      sourceLocation: 'A-01',
      isFullPallet: false,
      fullPalletRecord: { qty: 1000 },
      palletSeq: 1,
    }];

    vi.spyOn(component, 'SweetAlert').mockImplementation(() => Promise.resolve({} as any));
    vi.spyOn(component, 'focusScannerInput');
    vi.spyOn(component as any, 'claimNextSpecialSeq').mockReturnValue(2);
    vi.spyOn(component as any, 'saveJobDataToSession').mockImplementation(() => {});
    vi.spyOn(component as any, 'refreshDisplayList').mockImplementation(() => {});

    component._scannerValue = '1234|GRADE-A|LOT-1|02|001';
    component.onScannerEnter();
    expect(component.SweetAlert).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('ถุงนี้รอสแกน Location ต้นทางอยู่แล้ว'),
    );

    component._scannerValue = '1234|GRADE-A|LOT-1|03|002';
    component.onScannerEnter();

    expect(component.SweetAlert).toHaveBeenCalledTimes(1);
    expect(scanApi.getProcessPallet).toHaveBeenCalledTimes(1);
  });

  it('opens the bag quantity modal for Breakage & Replacement and waits for user confirmation', () => {
    const scanLogic = new ScanPalletLogicService();
    const component = new ScanPallet(
      {} as Router,
      { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
      scanLogic,
      { getProcessPallet: vi.fn(() => NEVER) } as unknown as ScanPalletApiService,
      {} as OfflineQueueService,
      {} as CrudService,
      {} as NetworkService,
      {} as OfflineSyncService,
      {} as TourService,
    );
    const item = { id: 1, grade: 'GRADE-A', lot_no: 'LOT-1' };
    const code = '1234|GRADE-A|LOT-1|01|001';

    component._isBkJob = true;
    component._jobDataRaw = { type_name: 'Breakage & Replacement' };
    (component as any)._specialActiveSeq = 28;
    const confirmSpy = vi.spyOn(component, 'onConfirmSpecialQty').mockImplementation(() => {});
    const lockSpy = vi.spyOn(component, 'onLockSpecialQtyForLocationScan').mockImplementation(() => {});

    (component as any).queueSpecialAwaitingSourceLocation(
      code,
      scanLogic.parseScanCode(code)!,
      item,
      { location: { location_name: 'WH35B02' }, remaining: 1000 },
      false,
      { qty: 1000 },
    );

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(lockSpy).not.toHaveBeenCalled();
    expect((component as any)._specialQtyModal.scannedCodes).toEqual([code]);
  });

  it('keeps the bag quantity modal open for outbound special jobs until the user confirms', () => {
    const scanLogic = new ScanPalletLogicService();
    const component = new ScanPallet(
      {} as Router,
      { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
      scanLogic,
      { getProcessPallet: vi.fn(() => NEVER) } as unknown as ScanPalletApiService,
      {} as OfflineQueueService,
      {} as CrudService,
      {} as NetworkService,
      {} as OfflineSyncService,
      {} as TourService,
    );
    const item = { id: 1, grade: 'GRADE-A', lot_no: 'LOT-1' };
    const code = '1234|GRADE-A|LOT-1|01|001';

    component._isOutbound = true;
    component._isSpecialJob = true;
    component._isRequestJob = true;
    component._jobDataRaw = { type_name: 'Request' };
    (component as any)._specialActiveSeq = 28;
    const confirmSpy = vi.spyOn(component, 'onConfirmSpecialQty');
    const lockSpy = vi.spyOn(component, 'onLockSpecialQtyForLocationScan');

    (component as any).queueSpecialAwaitingSourceLocation(
      code,
      scanLogic.parseScanCode(code)!,
      item,
      { location: { location_name: 'WH35B02' }, remaining: 1000 },
      false,
      { qty: 1000 },
    );

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(lockSpy).not.toHaveBeenCalled();
    expect((component as any)._specialQtyModal.scannedCodes).toEqual([code]);
    expect((component as any)._specialAwaitingSourceLocation[0].lockedCodes).toBeUndefined();
  });

  it('automatically opens the quantity modal for an outbound pallet larger than the remaining job quantity', () => {
    const scanLogic = new ScanPalletLogicService();
    const scanApi = {
      getProcessPallet: vi.fn(() => of({
        data: [{ pallet_id: '001', qty: 1000, unit_ratio: 500, is_full_pallet: 'Y' }],
      })),
    } as unknown as ScanPalletApiService;
    const component = new ScanPallet(
      {} as Router,
      { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
      scanLogic,
      scanApi,
      {} as OfflineQueueService,
      {} as CrudService,
      {} as NetworkService,
      {} as OfflineSyncService,
      {} as TourService,
    );
    const item = {
      id: 1,
      grade: 'GRADE-A',
      lot_no: 'LOT-1',
      total_qty: 500,
      receive_qty: 0,
      complete_qty: 0,
      locations: {
        from_locations: [{ location_id: 7, location_name: 'WH35B02', total_qty: 500, complete_qty: 0 }],
      },
    };
    const code = '1234|GRADE-A|LOT-1|01|001';

    component._isOutbound = true;
    component._isSpecialJob = true;
    component._isShippingJob = true;
    component._isScanning = true;
    component._jobDataRaw = {
      id: 1,
      type_name: 'Shipping',
      type_topic: 'Outbound',
      items: [item],
      pallets: { awaiting_source_pallet: [], receive_pallet: [], complete_pallet: [] },
    };
    vi.spyOn(component, 'SweetAlert').mockImplementation(() => Promise.resolve({} as any));
    vi.spyOn(component, 'focusScannerInput');
    vi.spyOn(component as any, 'saveJobDataToSession').mockImplementation(() => {});
    vi.spyOn(component as any, 'refreshDisplayList').mockImplementation(() => {});

    component._scannerValue = code;
    component.onScannerEnter();

    expect(scanApi.getProcessPallet).toHaveBeenCalledTimes(1);
    expect((component as any)._specialQtyModal).toMatchObject({
      scannedCodes: [code],
      remaining: 500,
      sourceRecord: { qty: 1000 },
    });
  });

  it('uses the server remaining quantity after an over-limit response and retries Get after bag edits', () => {
    const scanLogic = new ScanPalletLogicService();
    const errorMessage = 'จำนวนเกินที่กำหนด (กำหนด 25500, รับแล้ว 25000, ครั้งนี้ 975)';
    const scanApi = {
      callJobApi: vi.fn(() => throwError(() => ({ error: { message: errorMessage } }))),
    } as unknown as ScanPalletApiService;
    const component = new ScanPallet(
      {} as Router,
      { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
      scanLogic,
      scanApi,
      {} as OfflineQueueService,
      {} as CrudService,
      {} as NetworkService,
      {} as OfflineSyncService,
      {} as TourService,
    );
    const code = '1234|GRADE-A|LOT-1|01|001';
    const item = {
      id: 1,
      grade: 'GRADE-A',
      lot_no: 'LOT-1',
      total_qty: 25500,
      receive_qty: 0,
      complete_qty: 0,
      locations: { from_locations: [{ location_id: 7, location_name: 'WH35B02' }] },
    };

    component._isOutbound = true;
    component._isSpecialJob = true;
    component._isRequestJob = true;
    component._jobDataRaw = { id: 1, type_name: 'Request', items: [item] };
    (component as any)._specialQtyModal = {
      code,
      parsed: scanLogic.parseScanCode(code),
      item,
      remaining: 25500,
      scannedCodes: Array.from({ length: 20 }, (_, index) => `bag-${index}`),
      hint: null,
      mode: 'take',
      canSendToStep2: false,
      isStep2Continuation: false,
      palletSeq: 28,
      sourceRecord: { qty: 1000, unit_ratio: 48.75 },
      sourceLocation: 'WH35B02',
      sourceLocationConfirmed: true,
    };
    vi.spyOn(component, 'SweetAlert').mockImplementation(() => Promise.resolve({} as any));
    const lockSpy = vi.spyOn(component, 'onLockSpecialQtyForLocationScan');

    component.onClickSpecialQtyConfirm();

    expect((component as any)._specialQtyModal).toMatchObject({
      remaining: 500,
      serverRemaining: 500,
    });
    expect((component as any)._specialQtyModal.hint).toContain('เหลือ 500 กก.');

    for (const codeToRemove of (component as any)._specialQtyModal.scannedCodes.slice(10)) {
      component.onRemoveSpecialScannedBag(codeToRemove);
    }
    component.onClickSpecialQtyConfirm();

    expect(scanApi.callJobApi).toHaveBeenCalledTimes(2);
    expect(lockSpy).not.toHaveBeenCalled();
  });
});
