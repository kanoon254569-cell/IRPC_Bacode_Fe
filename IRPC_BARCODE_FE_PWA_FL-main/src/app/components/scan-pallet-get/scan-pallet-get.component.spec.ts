import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScanPalletGetComponent } from './scan-pallet-get.component';

describe('ScanPalletGetComponent', () => {
  let component: ScanPalletGetComponent;
  let fixture: ComponentFixture<ScanPalletGetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ScanPalletGetComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(ScanPalletGetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
