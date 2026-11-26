import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

//  Components
import { LoginComponent } from './components/login/login.component';
import { WarehouseSelect } from './components/warehouse-select/warehouse-select';
import { SystemMenu } from './components/system-menu/system-menu';
import { JobAccept } from './components/job-accept/job-accept';
import { ScanPalletGetComponent } from './components/scan-pallet-get/scan-pallet-get.component';

import { ReportBrokenBag } from './components/report-broken-bag/report-broken-bag';
import { ScanLocationInfoComponent } from './components/scan-location-info/scan-location-info';
import { ScanPallet } from './components/scan-pallet/scan-pallet';
import { PalletManagement } from './components/pallet-management/pallet-management';
import { LoadingTruck } from './components/loading-truck/loading-truck';
import { LoadToTruck } from './components/load-to-truck/load-to-truck';

const routes: Routes = [
  { path: '', component: LoginComponent },
  { path: 'warehouse-select', component: WarehouseSelect },
  { path: 'system-menu', component: SystemMenu },
  { path: 'job-accept', component: JobAccept },
  { path: 'scan-pallet-GET', component: ScanPalletGetComponent },
  { path: 'scan-pallet', component: ScanPallet },
  { path: 'report-broken-bag', component: ReportBrokenBag },
  { path: 'scan-location-info', component: ScanLocationInfoComponent },
  { path: 'pallet-management', component: PalletManagement },
  { path: 'loading-truck', component: LoadingTruck },
  { path: 'load-to-truck', component: LoadToTruck }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
