import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

//  เชื่อมปุ่ม "?" เดียวใน header (component กลาง ใช้ร่วมทุกหน้า) เข้ากับ guided tour ของ "หน้าปัจจุบัน" โดยไม่ต้อง
//  รวมศูนย์ step list ไว้ที่นี่ -> แต่ละหน้าที่มี tour เก็บ step/logic ของตัวเองไว้ในคอมโพเนนต์หน้านั้นเลย แค่ register
//  ฟังก์ชัน "เริ่ม tour" ไว้ตอน ngOnInit แล้ว unregister (null) ตอน ngOnDestroy กันเรียก tour หน้าเก่าค้างหลังเปลี่ยน
//  หน้าไปแล้ว (header ไม่ถูกทำลาย/สร้างใหม่ตามการเปลี่ยนหน้าเหมือนกับ query param อื่นๆ)
//  หน้าที่ยังไม่มี tour -> ไม่ register อะไรเลย ปุ่มใน header จะซ่อนไปเอง (ดู hasTour$)
@Injectable({ providedIn: 'root' })
export class TourService {
  private _starter: (() => void) | null = null;
  readonly hasTour$ = new BehaviorSubject<boolean>(false);

  register(starter: (() => void) | null): void {
    this._starter = starter;
    this.hasTour$.next(!!starter);
  }

  start(): void {
    this._starter?.();
  }
}
