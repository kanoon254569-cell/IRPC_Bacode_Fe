import { Component, OnInit, signal } from '@angular/core';
import { NewJobAlertService } from './service/new-job-alert.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly title = signal('IRPC_QRCODE_SYSTEM_FL_PWA');

  //  app-root อยู่นอกทุก route ไม่มีวันถูกทำลายตลอดอายุ SPA -> จุดเดียวที่เหมาะจะ start polling แจ้งเตือนงานใหม่
  //  ให้ทำงานทุกหน้า (ต่างจาก header ที่ build/destroy ใหม่ทุกครั้งที่เปลี่ยนหน้า)
  constructor(private newJobAlertService: NewJobAlertService) {}

  ngOnInit(): void {
    this.newJobAlertService.start();
    //  เปิดทาง test จาก console: (window as any).newJobAlertService.simulateNewJob({...})
    (window as any).newJobAlertService = this.newJobAlertService;
  }
}
