import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WarehouseSelect } from './warehouse-select';

describe('WarehouseSelect', () => {
  let component: WarehouseSelect;
  let fixture: ComponentFixture<WarehouseSelect>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [WarehouseSelect],
    }).compileComponents();

    fixture = TestBed.createComponent(WarehouseSelect);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
