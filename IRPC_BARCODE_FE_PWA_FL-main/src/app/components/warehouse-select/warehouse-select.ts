import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { LoadingService } from '../../service/loading.service';
import { CrudService } from '../../service/crud.service';

@Component({
  selector: 'app-warehouse-select',
  standalone: false,
  templateUrl: './warehouse-select.html',
  styleUrl: './warehouse-select.css',
})
export class WarehouseSelect implements OnInit {
  private router = inject(Router);
  private loadingService = inject(LoadingService);
  private crudService = inject(CrudService);

  protected readonly forkliftId = signal(
    sessionStorage.getItem('_FORKLIFT_ID') || 'FL-01'
  );
  protected readonly selectedWarehouse = signal(
    sessionStorage.getItem('_SELECTED_WAREHOUSE') || 'None'
  );

  // Dynamic signal containing the list of warehouse names to display
  protected readonly warehouses = signal<string[]>([]);

  ngOnInit() {
    // MOCK: Generate dynamic list of mock warehouses
    // Adjust totalMockWarehouses to display different numbers of cards (e.g., set to 5 for 5 cards)
    const totalMockWarehouses = 16;
    const mockList = Array.from(
      { length: totalMockWarehouses },
      (_, i) => `WH - ${String(i + 1).padStart(2, '0')}`
    );
    this.warehouses.set(mockList);

    /*
    // BACKEND API WAREHOUSE LOADING (Uncomment to activate)
    // this.loadingService.show('กำลังโหลดข้อมูล Warehouse...');
    // this.crudService.GetWarehouses().subscribe({
    //   next: (list: string[]) => {
    //     this.loadingService.hide();
    //     this.warehouses.set(list);
    //   },
    //   error: (err) => {
    //     this.loadingService.hide();
    //     console.error('Failed to load warehouses from backend:', err);
    //   }
    // });
    */
  }

  selectWarehouse(warehouse: string) {
    this.loadingService.show();

    // MOCK Warehouse Selection
    // To switch back to real backend selection check/save:
    // 1. Comment out/remove the MOCK block below.
    // 2. Uncomment the BACKEND API block further down.
    setTimeout(() => {
      sessionStorage.setItem('_SELECTED_WAREHOUSE', warehouse);
      this.selectedWarehouse.set(warehouse);
      this.loadingService.hide();
      this.router.navigate(['/system-menu']);
    }, 500);

    /*
    // BACKEND API WAREHOUSE SELECTION (Uncomment to activate)
    // Attempting backend call (e.g., to notify backend of selected warehouse or fetch warehouse metadata)
    const payload = {
      warehouse: warehouse,
      forkliftId: this.forkliftId()
    };
    console.log('Selecting warehouse with CrudService:', payload);

    // Example call (adjust method name once backend API is defined in CrudService):
    // this.crudService.SelectWarehouse(payload).subscribe({
    //   next: (res) => {
    //     this.loadingService.hide();
    //     sessionStorage.setItem('_SELECTED_WAREHOUSE', warehouse);
    //     this.selectedWarehouse.set(warehouse);
    //     this.router.navigate(['/system-menu']);
    //   },
    //   error: (err) => {
    //     this.loadingService.hide();
    //     console.warn('Backend warehouse select error:', err);
    //     Swal.fire({
    //       icon: 'error',
    //       title: 'Oops...',
    //       text: 'Failed to select warehouse. Please try again.',
    //     });
    //   }
    // });
    */
  }
}

