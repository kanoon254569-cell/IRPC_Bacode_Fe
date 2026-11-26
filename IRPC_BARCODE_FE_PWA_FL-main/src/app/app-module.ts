import { NgModule, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing-module';
import { App } from './app';
import { HttpClientModule } from '@angular/common/http';

//  Service Worker
import { ServiceWorkerModule } from '@angular/service-worker';

//  สแกน QR ด้วยกล้อง (หน้า Pallet Management) -- แบบเดียวกับแอป Checker
import { ZXingScannerModule } from '@zxing/ngx-scanner';

//  Components
import { LoginComponent } from './components/login/login.component';
import { WarehouseSelect } from './components/warehouse-select/warehouse-select';
import { SystemMenu } from './components/system-menu/system-menu';
import { JobAccept } from './components/job-accept/job-accept';
import { LoadingDialogComponent } from './components/loading-dialog/loading-dialog';
import { HeaderComponent } from './components/header/header.component';
import { ScanPalletGetComponent } from './components/scan-pallet-get/scan-pallet-get.component';
// import { BkJobComponent } from './components/scan-pallet-get/bk-job/bk-job.component';
import { ReportBrokenBag } from './components/report-broken-bag/report-broken-bag';
import { ScanLocationInfoComponent } from './components/scan-location-info/scan-location-info';
import { Dialogloading } from './components/dialogloading/dialogloading';
import { ScanForkliftDialog } from './components/scan-forklift-dialog/scan-forklift-dialog';
import { ScanPallet } from './components/scan-pallet/scan-pallet';
import { PalletManagement } from './components/pallet-management/pallet-management';
import { LoadingTruck } from './components/loading-truck/loading-truck';
import { LoadToTruck } from './components/load-to-truck/load-to-truck';
import { NewJobBadge } from './components/new-job-badge/new-job-badge';

//  Angular Material
import { MatCardModule } from '@angular/material/card';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTableModule } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatGridListModule } from '@angular/material/grid-list';
import { MatProgressBarModule } from '@angular/material/progress-bar';

@NgModule({
  declarations: [
    App,
    LoginComponent,
    WarehouseSelect,
    SystemMenu,
    JobAccept,
    LoadingDialogComponent,
    HeaderComponent,
    ScanPalletGetComponent,
    // BkJobComponent,
    ReportBrokenBag,
    ScanLocationInfoComponent,
    Dialogloading,
    ScanForkliftDialog,
    ScanPallet,
    PalletManagement,
    LoadingTruck,
    LoadToTruck,
    NewJobBadge,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    ServiceWorkerModule.register('ngsw-worker.js', {
      enabled: !isDevMode(),
      //  ลงทะเบียนทันทีตอนเปิดแอป -> เริ่ม cache ไฟล์แอปตั้งแต่ครั้งแรกที่เปิด ไม่ต้องรอแอป stable
      //  (ถ้าปิดแอปก่อน SW ลงทะเบียนเสร็จ รอบถัดไปที่ offline จะเปิดไม่ขึ้น)
      registrationStrategy: 'registerImmediately',
    }),
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatSidenavModule,
    MatToolbarModule,
    MatIconModule,
    MatListModule,
    MatTableModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatMenuModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatBottomSheetModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatExpansionModule,
    MatTooltipModule,
    MatTimepickerModule,
    MatPaginatorModule,
    MatGridListModule,
    MatProgressBarModule,
    ZXingScannerModule,
  ],
  providers: [provideBrowserGlobalErrorListeners()],
  bootstrap: [App],
})
export class AppModule {}
