import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LoadingTruck } from './loading-truck';

describe('LoadingTruck', () => {
  let component: LoadingTruck;
  let fixture: ComponentFixture<LoadingTruck>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [LoadingTruck],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadingTruck);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
