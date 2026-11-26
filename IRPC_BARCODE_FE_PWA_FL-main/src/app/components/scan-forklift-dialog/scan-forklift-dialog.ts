import { AfterViewInit, Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

type ScanStatus = 'idle' | 'error' | 'success';

//  Modal บังคับสแกน QR Code รถ Forklift ก่อนเข้าใช้งาน (เปิดหลัง login สำเร็จ)
//  รูปแบบ QR: id|forklift_name -> ปิด dialog พร้อมส่ง { id, name } กลับให้ผู้เรียกใช้ไปยิง API ด้วย id
//  แล้วเทียบ name ที่สแกนได้กับชื่อจริงของ Forklift คันนั้นอีกชั้น (กันพิมพ์/สแกนชื่ออะไรก็ได้ต่อท้าย id ที่ถูกต้อง)
//  UX เดียวกับหน้า scan-pallet: ต้องกดปุ่ม "กดปุ่มเพื่อสแกน" ก่อนถึงรับค่าจากเครื่องสแกนจริง
//  หรือสลับ toggle ไปโหมดพิมพ์เองได้ถ้าไม่มีเครื่องสแกน
@Component({
  selector: 'app-scan-forklift-dialog',
  standalone: false,
  templateUrl: './scan-forklift-dialog.html',
  styleUrl: './scan-forklift-dialog.css',
})
export class ScanForkliftDialog implements AfterViewInit {
  @ViewChild('scannerInput') scannerInputRef!: ElementRef<HTMLInputElement>;

  _isManualInputMode = false;
  _isScanning = false;
  _scannerValue = '';
  _manualInputValue = '';

  _status: ScanStatus = 'idle';
  _errorMessage = '';
  _lastCode: { id: string; name: string } | null = null;

  constructor(private dialogRef: MatDialogRef<ScanForkliftDialog, { id: string; name: string }>) { }

  ngAfterViewInit(): void {
    //  เปิด modal มาพร้อมสแกนได้เลย ไม่ต้องกดปุ่มก่อนรอบแรก (armed ตั้งแต่เปิด)
    this._isScanning = true;
    this.focusScannerInput();
  }

  //  โฟกัสหลุดจากช่องสแกน (เช่นผู้ใช้แตะที่อื่น) -> ไม่ดึงโฟกัสกลับให้อัตโนมัติ
  //  ต้องกดปุ่ม "กดปุ่มเพื่อสแกน" เองใหม่ถึงจะกลับมาโฟกัส/พร้อมรับค่าอีกครั้ง
  onInputBlur(): void {
    this._isScanning = false;
  }

  //  ดักตอนสลับหน้าต่าง/แอป -> ต้องกดปุ่มสแกนใหม่ (กันรับค่าค้างตอนกลับมา)
  @HostListener('window:blur')
  onWindowBlur(): void {
    this._isScanning = false;
  }

  onClickScanButton(): void {
    this._isScanning = true;
    this.focusScannerInput();
  }

  onToggleManualInputMode(checked: boolean): void {
    this._isManualInputMode = checked;
    this._manualInputValue = '';

    if (!this._isManualInputMode) {
      this.focusScannerInput();
    }
  }

  //  ยืนยันโค้ดที่พิมพ์เอง -> ใช้ logic เดียวกับตอนสแกนจริงทุกอย่าง (onScannerEnter)
  onClickSubmitManualInput(): void {
    const code = this._manualInputValue.trim();
    if (!code) return;

    this._isScanning = true;   //  บังคับเปิดโหมดสแกนไปด้วย เพราะ manual input ข้ามปุ่ม "กดเพื่อสแกน" ไป
    this._scannerValue = code;
    this._manualInputValue = '';

    this.onScannerEnter();
  }

  //  เครื่องสแกนพิมพ์โค้ดเข้าช่องนี้แล้วปิดท้ายด้วย Enter เสมอ (คีย์บอร์ดจำลอง)
  onScannerEnter(): void {
    const code = this._scannerValue.trim();
    this._scannerValue = '';

    if (!code || !this._isScanning || this._status === 'success') return;

    const [rawId, rawName] = code.split('|').map((p) => p.trim());
    if (!rawId || !rawName) {
      this.showError('กรุณาสแกน QR Code รถ Forklift ให้ถูกต้อง');
      return;
    }

    //  โชว์ผลสำเร็จให้เห็นสั้นๆ ก่อนปิด dialog กันความรู้สึกว่าสแกนไม่ติด
    //  ส่งทั้ง id และ name กลับไป — ฝั่งที่เรียกใช้เอา id ไปยิง GetProcessForklift ค้นตรงๆ ได้เลย แล้วเทียบ name
    //  ที่สแกนได้กับชื่อจริงของ Forklift คันนั้นอีกชั้น (ดู login.component.ts)
    this._lastCode = { id: rawId, name: rawName };
    this._status = 'success';
    setTimeout(() => this.dialogRef.close(this._lastCode ?? undefined), 500);
  }

  //  ยกเลิกกลับไปหน้า login ใหม่ (เช่น เข้าผิด account) -> ปิด dialog โดยไม่มีผลลัพธ์ ฝั่ง login.component.ts
  //  (promptForkliftScan) ตีความ "ปิดโดยไม่มี scanned" นี้เป็นสัญญาณยกเลิกแล้วเคลียร์ session ให้เอง
  //  (ปกติปิดแบบนี้ไม่เคยเกิดได้เลยเพราะ disableClose: true กันไว้ นอกจากกดปุ่มนี้)
  onClickCancel(): void {
    this.dialogRef.close();
  }

  private showError(message: string): void {
    this._errorMessage = message;
    this._status = 'error';
    setTimeout(() => {
      this._status = 'idle';
      this.focusScannerInput();
    }, 1500);
  }

  private focusScannerInput(): void {
    this.scannerInputRef?.nativeElement?.focus();
  }
}
