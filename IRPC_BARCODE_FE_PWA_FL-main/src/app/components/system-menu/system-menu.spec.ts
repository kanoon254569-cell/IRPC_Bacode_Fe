import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { SystemMenu } from './system-menu';

describe('SystemMenu', () => {
  let component: SystemMenu;
  let fixture: ComponentFixture<SystemMenu>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SystemMenu],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(SystemMenu);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
