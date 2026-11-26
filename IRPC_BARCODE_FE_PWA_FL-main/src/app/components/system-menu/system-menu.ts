import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { driver, DriveStep } from 'driver.js';
import { LoadingService } from '../../service/loading.service';
import { CrudService } from '../../service/crud.service';
import { TourService } from '../../service/tour.service';
import * as Type from '../../../models/variables-type';

@Component({
  selector: 'app-system-menu',
  standalone: false,
  templateUrl: './system-menu.html',
  styleUrl: './system-menu.css',
})

export class SystemMenu implements OnInit, OnDestroy {
  private router = inject(Router);
  private loadingService = inject(LoadingService);
  private crudService = inject(CrudService);
  private tourService = inject(TourService);

  protected readonly forkliftId = signal(
    sessionStorage.getItem('_FORKLIFT_ID') || 'FL-01'
  );
  protected readonly selectedWarehouse = signal(
    sessionStorage.getItem('_SELECTED_WAREHOUSE') || 'None'
  );

  //  Permission ที่ decode มาจาก JWT ตอน login (เก็บไว้ที่ sessionStorage '_USER_INFO')
  private readonly userPermission = this.loadUserPermission();

  protected readonly menuItems = [
    {
      title: 'Job',
      //  label = ข้อความที่โชว์จริงบนปุ่ม (ภาษาไทย) ส่วน title เดิมคงไว้เป็น key ที่ onSelectMenu() ใช้เทียบ/routing
      //  เท่านั้น ห้ามแปล title ตรงๆ เด็ดขาด ไม่งั้น onSelectMenu() หา menuTitle ไม่เจอ กดแล้วไม่ไปไหนเลย
      label: 'งาน',
      description: 'ดูแลและจัดการงานที่ได้รับ',
      icon: 'assets/images/Jobs.png',
      //  ครอบคลุมทุก job type ที่หน้า Job จัดการ -> มีสิทธิ์อย่างใดอย่างหนึ่งก็เข้าได้
      isAvailable: this.hasAnyPermission(['transferSlip', 'putAway', 'picking', 'shipmentDelivery', 'requestOther', 'specialPackage']),
    },
    {
      title: 'Pallet Management',
      label: 'จัดการ Pallet',
      description: 'ตรวจสอบและจัดการ Pallet',
      icon: 'assets/images/PalletManagement.png',
      isAvailable: this.hasPermission('palletManagement'),
    },
    {
      title: 'Scan Location Info',
      label: 'สแกนข้อมูล Location',
      description: 'สแกนเพื่อดูข้อมูล Location',
      icon: 'assets/images/ScanLocationInfo.png',
      //  ครอบคลุมทั้งโหมด Truck และ Location ในหน้านี้ -> มีสิทธิ์อย่างใดอย่างหนึ่งก็เข้าได้
      isAvailable: this.hasAnyPermission(['truckInfo', 'locationInfo']),
    },
    {
      title: 'Report Broken Bag',
      label: 'แจ้งถุงแตก',
      description: 'แจ้งถุงแตก',
      icon: 'assets/images/ReportBrokenBag.png',
      isAvailable: this.hasPermission('breakageReplacement'),
    }
  ];

  //  โหลด permission จาก session (เก็บไว้ตอน login ใน login.component.ts)
  private loadUserPermission(): Type.JwtPermission | null {
    try {
      const raw = sessionStorage.getItem('_USER_INFO');
      if (!raw) return null;
      const userInfo: Type.UserSessionInfo = JSON.parse(raw);
      return userInfo?.permission ?? null;
    } catch (err) {
      console.error('ไม่สามารถอ่านข้อมูล user permission จาก session ได้:', err);
      return null;
    }
  }

  private hasPermission(key: keyof Type.JwtPermission): boolean {
    return this.userPermission?.[key] === 'Y';
  }

  private hasAnyPermission(keys: (keyof Type.JwtPermission)[]): boolean {
    return keys.some((key) => this.hasPermission(key));
  }

  ngOnInit(): void {
    this.tourService.register(() => this.startTour());
  }

  ngOnDestroy(): void {
    this.tourService.register(null);
  }

  //  ปุ่ม "?" ที่ header ผ่าน TourService (ดู job-accept.ts/scan-pallet.ts ที่ทำแบบเดียวกัน) หน้านี้เมนูคงที่
  //  4 ใบเสมอ ไม่ขึ้นกับ permission ของ user (การ์ดที่ไม่มีสิทธิ์แค่โชว์จาง ไม่ได้หายไปจาก DOM) เลยไม่ต้องเช็ค
  //  เงื่อนไขอะไรก่อนเหมือนหน้าอื่น ชี้ตรงๆ ได้เลยทุก element
  private startTour(): void {
    const steps: DriveStep[] = [
      {
        element: '.menu-card:nth-of-type(1)',
        popover: { title: 'งาน', description: 'ดูแลและจัดการงานที่ได้รับ เช่น รับเข้า/ส่งออก/ย้ายสินค้า เข้าไปดูรายการงานและเริ่มสแกนได้ที่นี่' },
      },
      {
        element: '.menu-card:nth-of-type(2)',
        popover: { title: 'จัดการ Pallet', description: 'ตรวจสอบและจัดการ Pallet ที่มีอยู่ในคลัง (เช่นแก้ไข/ย้าย/ลบ)' },
      },
      {
        element: '.menu-card:nth-of-type(3)',
        popover: { title: 'สแกนข้อมูล Location', description: 'สแกน QR Code เพื่อดูข้อมูลของ Location หรือรถขนส่งนั้นๆ' },
      },
      {
        element: '.menu-card:nth-of-type(4)',
        popover: { title: 'แจ้งถุงแตก', description: 'แจ้งเมื่อพบถุงสินค้าแตก/เสียหายระหว่างขนย้าย' },
      },
    ];

    driver({
      showProgress: true,
      nextBtnText: 'ถัดไป',
      prevBtnText: 'ย้อนกลับ',
      doneBtnText: 'เสร็จสิ้น',
      steps,
    }).drive();
  }

  onBack() {
    this.router.navigate(['/warehouse-select']);
    sessionStorage.removeItem('_SELECTED_WAREHOUSE');
  }

  onSelectMenu(menuTitle: string) {
    const selectedMenu = this.menuItems.find((item) => item.title === menuTitle);

    if (!selectedMenu?.isAvailable) {
      Swal.fire({
        icon: 'info',
        title: 'ไม่สามารถใช้งานได้',
        text: `Function ${menuTitle} ยังไม่เปิดให้บริการ หรือบัญชีนี้ไม่มีสิทธิ์เข้าใช้งาน`,
        confirmButtonText: 'ตกลง',
      });
      return;
    }

    // 1. MOCK INTEGRATION (Active during local layout & UX dev)
    this.loadingService.show('กำลังโหลดข้อมูล...');
    setTimeout(() => {
      this.loadingService.hide();
      if (menuTitle === 'Job') {
        this.router.navigate(['/job-accept']);
      }
      if (menuTitle === 'Pallet Management') {
        this.router.navigate(['/pallet-management']);
      }
      if (menuTitle === 'Scan Location Info') {
        this.router.navigate(['/scan-location-info']);
      }
      if (menuTitle === 'Report Broken Bag') {
        this.router.navigate(['report-broken-bag']);
      }
      // else {
      //   Swal.fire({
      //     icon: 'info',
      //     title: 'Feature นี้ยังไม่พร้อมใช้งาน',
      //     text: `ฟังก์ชัน ${menuTitle} ยังไม่เปิดให้บริการในขณะนี้`,
      //     confirmButtonText: 'ตกลง',
      //   });
      // }
    }, 500);

    /*
    // 2. .NET BACKEND INTEGRATION (Uncomment to enable real backend testing)
    // const payload = {
    //   menuTitle: menuTitle,
    //   forkliftId: this.forkliftId()
    // };
    // this.loadingService.show('กำลังตรวจสอบสิทธิ์การใช้งาน...');
    // this.crudService.ExecuteEndpoint(payload).subscribe({
    //   next: (res) => {
    //     this.loadingService.hide();
    //     if (res && res.status === 'SUCCESS') {
    //       if (menuTitle === 'Job') {
    //         this.router.navigate(['/job-accept']);
    //       } else {
    //         Swal.fire({
    //           icon: 'info',
    //           title: 'Coming Soon',
    //           text: `ฟังก์ชัน ${menuTitle} อยู่ในระหว่างการพัฒนา`
    //         });
    //       }
    //     } else {
    //       Swal.fire({ icon: 'error', title: 'ปฏิเสธการเข้าถึง', text: res.message });
    //     }
    //   },
    //   error: (err) => {
    //     this.loadingService.hide();
    //     Swal.fire({ icon: 'error', title: 'การเชื่อมต่อล้มเหลว', text: 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้' });
    //   }
    // });
    */
  }
}

