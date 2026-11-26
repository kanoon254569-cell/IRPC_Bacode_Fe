import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { CrudService } from './crud.service';

//  Auto-logout เมื่อไม่มี Get/Put สำเร็จภายในเวลาที่กำหนด (default 60 นาที) -> ใช้ตรรกะเดียวกับหลังบ้านที่ auto
//  checkout forklift (ไม่มี Get/Put เกิน 1 ชม.) กันเคส client ยัง login ค้างอยู่ทั้งที่ backend เช็คเอาท์ forklift ไปแล้ว
//  เดิมผูกกับการแตะจอ (click/touchstart/keydown) เปลี่ยนมาผูกกับ Get/Put สำเร็จจริงแทน (ดู ScanPalletApiService.callJobApi
//  ที่เรียก recordAction() หลัง get/putAway สำเร็จ ไม่รวม reset และไม่รวม auto-fetch poll ที่ยิงคนละ endpoint)
//  เก็บ timestamp ไว้ใน sessionStorage (ไม่ใช่แค่ตัวแปรในหน่วยความจำ) ให้รอดข้าม reload หน้า -> ไม่รีเซ็ตเป็น 60 นาที
//  ใหม่ทุกครั้งที่ reload ทั้งที่ Get/Put ล่าสุดผ่านมานานแล้ว (ช่องโหว่ของ timer แบบเดิมที่เป็นแค่ตัวแปรในหน่วยความจำ)
@Injectable({
  providedIn: 'root',
})
export class AutoLogoutService {
  //  ปิดไว้ก่อนชั่วคราว (ยังไม่ลบ logic) -> true = เปิดกลับมาใช้งาน
  private enabled = true;
  private idleMs = 60 * 60 * 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly lastActionKey = '_LAST_JOB_ACTION_AT';

  constructor(private router: Router, private crudService: CrudService) {
    this.ensureArmed();
  }

  //  เปลี่ยนเวลา idle ได้ (นาที) -> apply ทันทีจาก timestamp ที่มีอยู่ (ไม่รีเซ็ตเป็นเต็มใหม่)
  setIdleMinutes(minutes: number): void {
    this.idleMs = minutes * 60 * 1000;
    this.ensureArmed();
  }

  //  เรียกทุกครั้งที่ Get/Put สำเร็จจริง -> บันทึกเวลาล่าสุดแล้วตั้งนับถอยหลังใหม่เต็ม idleMs
  recordAction(): void {
    if (!this.enabled) return;
    if (!sessionStorage.getItem('_ACCESS_TOKEN')) return;
    sessionStorage.setItem(this.lastActionKey, String(Date.now()));
    this.armTimer(this.idleMs);
  }

  //  เรียกซ้ำได้หลายรอบอย่างปลอดภัย (ดู header.component.ts ngOnInit ที่สร้างใหม่ทุกหน้า รวมถึงตอน login ใหม่โดยไม่ reload
  //  ทั้งแอป) ยังไม่มี timestamp เลย (เพิ่ง login/เพิ่ง clear ไปตอน logout) -> เริ่มนับจาก "ตอนนี้" เหมือน resetTimer เดิมตอน
  //  login ถ้ามีอยู่แล้ว (reload หน้ากลางเซสชัน) -> คำนวณเวลาที่เหลือจริงจาก timestamp เดิม ไม่รีเซ็ตเป็น idleMs เต็มใหม่
  ensureArmed(): void {
    if (!this.enabled) return;
    if (!sessionStorage.getItem('_ACCESS_TOKEN')) return;

    const stored = Number(sessionStorage.getItem(this.lastActionKey)) || 0;
    const lastActionAt = stored > 0 ? stored : Date.now();
    if (!stored) sessionStorage.setItem(this.lastActionKey, String(lastActionAt));

    const remaining = this.idleMs - (Date.now() - lastActionAt);
    if (remaining <= 0) {
      this.logout();
      return;
    }
    this.armTimer(remaining);
  }

  private armTimer(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.logout(), delay);
  }

  //  เรียกตอน logout เอง กัน timer เก่ายิงซ้ำหลัง user ออกจากระบบไปแล้ว + เคลียร์ timestamp กันเซสชันถัดไปเห็นเวลาเก่า
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    sessionStorage.removeItem(this.lastActionKey);
  }

  //  เหมือน onLogout() ปุ่มจริงทุกอย่าง: ยิง checkout stamp ก่อน (รอผลไม่ว่าสำเร็จ/ล้มเหลว) แล้วค่อยเคลียร์ session
  //  เดียวกัน (ไม่เคลียร์ IndexedDB/offline queue เหมือนปุ่มจริงเหมือนกัน เพราะงานที่ยังไม่ sync ต้องรอ sync ทีหลัง)
  private logout(): void {
    const forkliftId = Number(sessionStorage.getItem('_FORKLIFT_ID')) || 0;
    const currentUserId = Number(localStorage.getItem('userId')) || 0;
    const idleMinutes = this.idleMs / 60000;
    //  อ่านเวลาที่ใช้นับไว้ก่อน finishLogout ล้างทิ้ง -> โชว์ใน popup ว่านับจากตอนไหน (Get/Put ล่าสุด หรือตอน login ถ้ายังไม่เคย)
    //  ช่วยคนขับ/ทีมดูได้ทันทีว่าทำไมหลุด เช่นเวลาอยู่ก่อนตอนที่ตัวเอง login = นับต่อจากรอบก่อน ข้ามวันโชว์วันที่ด้วย
    const lastActionAt = Number(sessionStorage.getItem(this.lastActionKey)) || 0;
    const pad = (n: number) => String(n).padStart(2, '0');
    const since = new Date(lastActionAt);
    const sinceTime = `${pad(since.getHours())}:${pad(since.getMinutes())}`;
    const sinceText = since.toDateString() === new Date().toDateString()
      ? sinceTime
      : `${pad(since.getDate())}/${pad(since.getMonth() + 1)} ${sinceTime}`;
    const reasonLine = lastActionAt
      ? `ไม่มีการรับหรือวางพาเลทตั้งแต่ <b>${sinceText} น.</b> (เกิน ${idleMinutes} นาที)`
      : `ไม่มีการรับหรือวางพาเลทเกิน <b>${idleMinutes} นาที</b>`;

    const finishLogout = () => {
      sessionStorage.removeItem('_ACCESS_TOKEN');
      sessionStorage.removeItem('_SELECTED_WAREHOUSE');
      sessionStorage.removeItem('_FORKLIFT_NAME');
      sessionStorage.removeItem('_FORKLIFT_ID');
      sessionStorage.removeItem(this.lastActionKey);
      this.timer = null;

      this.router.navigate(['/']);

      Swal.fire({
        html: `
          <style>
            /* styles.css มี .swal2-popup { width: 90vw !important; max-width: 650px; } แบบ global ทุก Swal
               ในแอป ต้องชนด้วย selector เจาะจงกว่า (2 class) ถึงจะทับได้ */
            .swal2-popup.auto-logout-popup {
              width: 620px !important;
              max-width: 92vw !important;
              padding: 40px 36px 32px !important;
            }
            .auto-logout-icon {
              width: 76px;
              height: 76px;
              margin: 0 auto 18px;
              border-radius: 50%;
              background: #fef3c7;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .auto-logout-icon .material-icons {
              font-size: 44px;
              color: #b45309;
            }
          </style>
          <div style="text-align:center;font-family:inherit;">
            <div class="auto-logout-icon"><span class="material-icons">timer_off</span></div>
            <div style="font-size:32px;font-weight:700;color:#b45309;margin-bottom:12px;">ออกจากระบบอัตโนมัติ</div>
            <div style="font-size:24px;color:#374151;">
              ${reasonLine}<br/>
              ${forkliftId ? 'ระบบออกจากระบบและเช็คเอาท์รถให้อัตโนมัติ' : 'ระบบออกจากระบบให้อัตโนมัติ'}<br/>
              กรุณาเข้าสู่ระบบใหม่เพื่อทำงานต่อ
            </div>
          </div>
        `,
        confirmButtonText: 'ตกลง',
        customClass: { popup: 'auto-logout-popup' },
      });
    };

    if (!forkliftId) {
      finishLogout();
      return;
    }

    this.crudService.CheckoutForklift(forkliftId, { updateBy: currentUserId }).subscribe({
      next: finishLogout,
      error: (err) => {
        console.error('Checkout forklift error (auto-logout):', err);
        finishLogout();
      },
    });
  }
}
