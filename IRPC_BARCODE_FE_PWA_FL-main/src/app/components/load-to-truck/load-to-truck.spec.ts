import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LoadToTruck } from './load-to-truck';

describe('LoadToTruck', () => {
  let component: LoadToTruck;
  let fixture: ComponentFixture<LoadToTruck>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [LoadToTruck],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadToTruck);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
