import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { JobAccept } from './job-accept';

describe('JobAccept', () => {
  let component: JobAccept;
  let fixture: ComponentFixture<JobAccept>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [JobAccept],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(JobAccept);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show the first two locations and the remaining count when there are more than two', () => {
    const jobCard = component.mapJobCard({
      id: 1,
      type_name: 'Request',
      type_topic: 'Inbound',
      system_no: 'JOB-001',
      status_name: 'Pending',
      complete_pallet: 1,
      total_pallet: 2,
      status_id: 1,
      is_urgent: 'N',
      is_multi_fl: 'N',
      items: [
        {
          document_job: 'DOC-1',
          locations: {
            from_locations: [
              { location_name: 'A01' },
              { location_name: 'A02' },
              { location_name: 'A03' },
            ],
            to_locations: [
              { location_name: 'B01' },
              { location_name: 'B02' },
              { location_name: 'B03' },
            ],
          },
        },
      ],
    } as any);

    expect(jobCard.getLocation).toBe('A01, A02, +1 more');
    expect(jobCard.putLocation).toBe('B01, B02, +1 more');
  });

  it('marks a grade/lot green only when its completed quantity reaches its total', () => {
    expect(component.isGradeLotComplete({ complete_pallet: '9000', total_pallet: '15000' })).toBe(false);
    expect(component.isGradeLotComplete({ complete_pallet: '2000', total_pallet: '2000' })).toBe(true);
    expect(component.isGradeLotComplete({ complete_pallet: '0', total_pallet: '0' })).toBe(false);
  });

  it('uses completed pallet records per grade/lot instead of the repeated item-level total', () => {
    const jobCard = component.mapJobCard({
      id: 1,
      type_name: 'Request',
      type_topic: 'Outbound',
      system_no: 'JOB-001',
      status_name: 'In Progress',
      complete_qty: 9000,
      total_qty: 10000,
      status_id: 1,
      is_urgent: 'N',
      is_multi_fl: 'N',
      movement_unit: 'Kg',
      items: [
        { id: 1, grade: '1126NK', lot_no: 'LOT-1', document_job: '1126NK LOT-1 2000', qty: 2000, complete_qty: 9000, total_qty: 2000, locations: {} },
        { id: 2, grade: '1126NK', lot_no: 'LOT-2', document_job: '1126NK LOT-2 2000', qty: 2000, complete_qty: 9000, total_qty: 2000, locations: {} },
        { id: 3, grade: '1126NK', lot_no: 'LOT-3', document_job: '1126NK LOT-3 6000', qty: 6000, complete_qty: 9000, total_qty: 6000, locations: {} },
      ],
      pallets: {
        receive_pallet: [],
        complete_pallet: [
          { grade: '1126NK', lot: 'LOT-1', qty: 2000 },
          { grade: '1126NK', lot: 'LOT-2', qty: 2000 },
          { grade: '1126NK', lot: 'LOT-3', qty: 5000 },
        ],
      },
    } as any);

    expect(jobCard.jobGradeLot.map((item: any) => component.isGradeLotComplete(item))).toEqual([
      true,
      true,
      false,
    ]);
  });
});
