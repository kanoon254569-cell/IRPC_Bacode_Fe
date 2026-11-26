import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ScanPallet } from './scan-pallet';

describe('ScanPallet', () => {
  let component: ScanPallet;
  let fixture: ComponentFixture<ScanPallet>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ScanPallet],
    }).compileComponents();

    fixture = TestBed.createComponent(ScanPallet);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
