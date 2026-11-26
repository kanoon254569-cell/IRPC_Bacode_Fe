import { Component } from '@angular/core';
import { Observable } from 'rxjs';
import { NewJobAlert, NewJobAlertService } from '../../service/new-job-alert.service';

//  ปุ่มกระดิ่งลอยมุมจอ (mount จาก app.html -> เห็นทุกหน้าหลัง login) โชว์ badge จำนวนงานใหม่ที่ยังไม่ได้ดู
//  ค้างอยู่ตลอดไม่หายไปเอง (ต่างจาก toast/popup เดิมที่เด้งแล้วหายถ้าพลาดจังหวะ) กดดูได้เองตอนสะดวก
@Component({
  selector: 'app-new-job-badge',
  standalone: false,
  templateUrl: './new-job-badge.html',
  styleUrl: './new-job-badge.css',
})
export class NewJobBadge {
  readonly unseenJobs$: Observable<NewJobAlert[]>;
  isPanelOpen = false;

  //  วันที่ปัจจุบัน โชว์ใต้หัว panel -> รูปแบบ dd/mm/yyyy เดียวกับที่หน้า job-accept ใช้แสดงผลทั้งแอป
  readonly todayDisplay: string;

  constructor(
    private newJobAlertService: NewJobAlertService,
  ) {
    this.unseenJobs$ = this.newJobAlertService.unseenJobs$;

    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    this.todayDisplay = `${day}/${month}/${today.getFullYear()}`;
  }

  togglePanel(): void {
    this.isPanelOpen = !this.isPanelOpen;
  }

  onClickClearAll(): void {
    this.newJobAlertService.dismissAll();
    this.isPanelOpen = false;
  }
}
