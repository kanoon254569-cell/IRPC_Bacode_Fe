import { ScanPalletLogicService, SessionPalletLists } from './scan-pallet-logic.service';

describe('ScanPalletLogicService outbound verification reservations', () => {
  const service = new ScanPalletLogicService();

  const makeLists = (outboundVerificationPallets: SessionPalletLists['outboundVerificationPallets'] = []): SessionPalletLists => ({
    palletToPlaceList: [],
    palletsAwaitingSourceLocation: [],
    completedPalletList: [],
    outboundVerificationPallets,
  });

  const item = {
    id: 1,
    grade: 'GRADE-A',
    lot_no: 'LOT-1',
    total_qty: 2,
    complete_qty: 0,
    locations: {
      from_locations: [{ location_id: 7, location_name: 'A-01', total_qty: 2, complete_qty: 0 }],
    },
  };

  const reservation = (id: string, code: string) => ({
    id,
    grade: 'GRADE-A',
    lotNo: 'LOT-1',
    qty: 0,
    isActive: true,
    isChecked: true,
    isSelectedForPlacement: false,
    targetLocations: [],
    sourceLocation: 'A-01',
    itemId: 1,
    fromLocationId: 7,
    qrCode: code,
    bagCodes: [code],
  });

  it('counts an in-flight pallet while allowing the second pallet within quota', () => {
    const firstCode = '1234|GRADE-A|LOT-1|01|001';
    const lists = makeLists([reservation('1', firstCode)]);

    const result = service.resolveItemForScan(
      service.parseScanCode('1234|GRADE-A|LOT-1|02|002')!,
      { items: [item] },
      null,
      lists,
      true,
    );

    expect(result.item).toBe(item);
    expect(service.checkFromLocationQuota(item, 'LOT-1', lists)?.remaining).toBe(1);
    expect(service.checkPalletIdConflict(firstCode, {}, lists)?.message).toContain('กำลังตรวจสอบ');
  });

  it('blocks another pallet after in-flight reservations consume the remaining quota', () => {
    const lists = makeLists([
      reservation('1', '1234|GRADE-A|LOT-1|01|001'),
      reservation('2', '1234|GRADE-A|LOT-1|02|002'),
    ]);

    const result = service.resolveItemForScan(
      service.parseScanCode('1234|GRADE-A|LOT-1|03|003')!,
      { items: [item] },
      null,
      lists,
      true,
    );

    expect(result.item).toBeNull();
    expect(service.checkFromLocationQuota(item, 'LOT-1', lists)?.remaining).toBe(0);
  });
});
