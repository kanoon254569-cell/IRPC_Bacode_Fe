import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { CrudService } from '../../service/crud.service';
import { NetworkService } from '../../service/network.service';
import { AutoLogoutService } from '../../service/auto-logout.service';
import { Subscription } from 'rxjs';
import * as Type from '../../../models/variables-type';
import { MatDialog, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { Dialogloading } from '../dialogloading/dialogloading';
import { ScanForkliftDialog } from '../scan-forklift-dialog/scan-forklift-dialog';

@Component({
  selector: 'app-login',
  standalone: false,
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('qrScannerInput') qrScannerInputRef!: ElementRef<HTMLInputElement>;

  //  Constructor
  constructor(
    private router: Router,
    private restService: CrudService,
    public dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private network: NetworkService,
    private autoLogout: AutoLogoutService,
  ) { }

  //  Global Variables
  _isLoading: boolean = false;
  _mUsername = new FormControl('');
  _mPassword = new FormControl('');
  _GetLogin: Type.ResponseLogin | undefined;
  _showPassword: boolean = false;

  _passwordInput = new FormControl();

  //  Tab บน login card: 'normal' = username/password (เดิม), 'qr' = สแกน QR Code เข้าสู่ระบบ
  _loginMode: 'normal' | 'qr' = 'qr';
  _qrScannerValue = '';

  //  tab QR ต้องพร้อมรับค่าจากเครื่องสแกนตลอดเวลา -> โฟกัสหลุด (ไปกดที่อื่น) จะดึงโฟกัสกลับมาเองทันที
  //  ยกเว้นตอนมี dialog/Swal เปิดอยู่ (loading, แจ้ง error, สแกน forklift) -> ปิดเมื่อไหร่ค่อย re-arm ให้เอง
  _isQrScanning = false;

  //  สถานะเน็ต (pattern เดียวกับ header.component.ts) โชว์บนหน้า login เอง เพราะหน้านี้ไม่มี <app-header>
  _isOnline = true;

  //  สถานะจาก NetworkService (health check api/v1/health) แทน window online/offline
  //  cdr.detectChanges() บังคับ re-render ทันที (pattern เดียวกับ header.component.ts ที่ใช้ตรง queue counts$)
  //  แอปไม่มี zone.js -> ไม่งั้นสถานะไม่ขึ้นจนกว่าจะมี action อื่นมา trigger change detection เอง
  private _onlineSub?: Subscription;

  //  Component Build Up Event
  ngOnInit(): void {
    this._onlineSub = this.network.online$.subscribe((online) => {
      this._isOnline = online;
      this.cdr.detectChanges();
    });
  }

  //  Component Destroy Event
  ngOnDestroy(): void {
    this._onlineSub?.unsubscribe();
  }

  //  หน้า login เริ่มต้นที่ tab QR (_loginMode = 'qr') -> ต้อง arm + โฟกัสช่องสแกนตั้งแต่โหลดหน้าเลย
  //  เหมือนตอนสลับ tab เอง ไม่งั้นจะค้าง "กดปุ่มเพื่อสแกน" ทั้งที่เพิ่งเข้าหน้ามา ทั้งที่ ViewChild ของ input
  //  (อยู่ใน *ngIf) จะพร้อมใช้งานได้ก็ต่อเมื่อ view render รอบแรกเสร็จแล้วเท่านั้น จึงต้องทำใน ngAfterViewInit
  ngAfterViewInit(): void {
    setTimeout(() => this.armQrScanner(), 0);
  }

  //  สลับ tab บน login card -> โหมด QR arm การสแกนและโฟกัสช่องรับสแกนให้พร้อมสแกนได้ทันที
  onSelectLoginMode(mode: 'normal' | 'qr'): void {
    this._loginMode = mode;

    if (mode === 'qr') {
      //  แอปนี้ไม่มี zone.js -> setTimeout ไม่การันตีว่า render เสร็จก่อน ช่อง input (อยู่ใน *ngIf) อาจยังไม่ถูกสร้าง
      //  ทำให้ focus() ไม่โดนอะไรเลย (โฟกัสหลุดตอนสลับกลับมาจาก tab "เข้าสู่ระบบ") -> บังคับ render ก่อนค่อย arm
      this.cdr.detectChanges();
      this.armQrScanner();
    }
  }

  onClickQrScanButton(): void {
    this.armQrScanner();
  }

  //  arm โหมดสแกน + โฟกัสช่องรับค่า (เฉพาะ tab QR และไม่มี dialog/Swal บังอยู่ ไม่งั้นจะไปแย่งโฟกัสจากปุ่มใน dialog)
  //  คืนค่า true ถ้า arm สำเร็จ
  private armQrScanner(): boolean {
    if (this._loginMode !== 'qr' || this.dialog.openDialogs.length > 0 || Swal.isVisible()) return false;

    this._isQrScanning = true;
    this.cdr.detectChanges();   //  ไม่มี zone.js -> ถูกเรียกจาก setTimeout/didClose ต้องสั่ง render เอง (ปุ่มเปลี่ยนเป็น "กำลังสแกน…")
    this.qrScannerInputRef?.nativeElement?.focus();
    return true;
  }

  //  โฟกัสหลุดจากช่องสแกน (เช่นผู้ใช้แตะที่อื่น) -> ดึงโฟกัสกลับมาทันที ให้พร้อมสแกนตลอดเวลา
  //  setTimeout รอให้ dialog/Swal ที่เป็นต้นเหตุของ blur เปิดเสร็จก่อน ถึงจะเช็คได้ว่าควร re-arm ไหม
  onQrInputBlur(): void {
    setTimeout(() => {
      if (!this.armQrScanner()) {
        this._isQrScanning = false;
        this.cdr.markForCheck();
      }
    }, 0);
  }

  //  เครื่องสแกนพิมพ์โค้ดเข้าช่องนี้แล้วปิดท้ายด้วย Enter เสมอ (คีย์บอร์ดจำลอง)
  onQrScannerEnter(): void {
    const code = this._qrScannerValue.trim();
    this._qrScannerValue = '';

    if (!code || !this._isQrScanning) return;

    //  ปิดโหมดสแกนทันทีตอนยิง API กันสแกนซ้ำ/เครื่องสแกนยิงซ้ำระหว่างรอผลลัพธ์ -> re-arm เองหลังปิด popup ผลลัพธ์
    this._isQrScanning = false;
    this.loginWithQrCode(code);
  }

  //  Login ผ่าน QR Code -> ยิงคนละ endpoint กับ username/password (LoginQrCode) แต่ประมวลผล response ร่วมกัน
  private loginWithQrCode(code: string): void {
    const screenWidth = window.innerWidth;
    const dialogWidth = screenWidth < 600 ? '95%' : '60%';

    const dialogRef = this.dialog.open(Dialogloading, {
      width: dialogWidth,
      height: 'auto',
      maxHeight: '90vh',
      disableClose: true,
    });

    const dialogOpenTime = Date.now();

    this.restService.LoginQrCode({ qrCode: code }).subscribe({
      next: (res: Type.ResponseLogin) => this.handleLoginResponse(dialogRef, dialogOpenTime, res),
      error: (err) => {
        console.error('QR login error:', err);
        const errMsg = this.extractErrorMessage(err, 'QR Code เข้าสู่ระบบไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
        this.closeDialogWithMinDelay(dialogRef, dialogOpenTime, () => this.SweetAlert('error', errMsg));
      },
    });
  }

  //  Click Submit To Check Username & Password
  onClickSubmit() {
    //  Check Username
    if (!this._mUsername.value?.trim()) {
      this.SweetAlert('warning', 'กรุณาใส่ Username ในช่องที่กำหนด');
      return;
    }

    //  Check Password
    if (!this._mPassword.value?.trim()) {
      this.SweetAlert('warning', 'กรุณาใส่ Password ในช่องที่กำหนด');
      return;
    }

    //  Open loading dialog
    const screenWidth = window.innerWidth;
    const dialogWidth = screenWidth < 600 ? '95%' : '60%';

    const dialogRef = this.dialog.open(Dialogloading, {
      width: dialogWidth,
      height: 'auto',
      maxHeight: '90vh',
      disableClose: true, // กันไม่ให้ปิดเองระหว่างรอ API
    });

    //  จับเวลาตอนเปิด dialog เพื่อคำนวณระยะเวลาหน่วงขั้นต่ำ
    const dialogOpenTime = Date.now();

    //  Encrypt username:password -> base64
    const mEncode = btoa(`${this._mUsername.value}:${this._mPassword.value}`);

    //  Request body ตาม swagger spec
    const requestLogin = {
      userId: this._mUsername.value,
      isAd: 'N',
      hash: mEncode,
    };

    this.restService.Login(requestLogin).subscribe({
      next: (res: Type.ResponseLogin) => this.handleLoginResponse(dialogRef, dialogOpenTime, res),
      error: (err) => {
        console.error('Login error:', err);
        const errMsg = this.extractErrorMessage(err, 'Username หรือ Password ไม่ถูกต้อง');
        this.closeDialogWithMinDelay(dialogRef, dialogOpenTime, () => this.SweetAlert('error', errMsg));
      },
    });
  }

  //  ประมวลผล response หลัง login สำเร็จ (ใช้ร่วมกันทั้ง username/password และ QR Code)
  //  decode JWT ก่อนเก็บอะไรลง session ทั้งนั้น เพื่อเช็คสิทธิ์ tabletPwa ก่อน
  //  (permission.tabletPwa = 'Y' เท่านั้นถึงจะให้ใช้แอปนี้ได้ — บัญชีที่ไม่มีสิทธิ์ต้องดักตั้งแต่ตอน login)
  private handleLoginResponse(dialogRef: MatDialogRef<any>, dialogOpenTime: number, res: Type.ResponseLogin): void {
    this._GetLogin = res;

    if (!res?.token) {
      this.closeDialogWithMinDelay(dialogRef, dialogOpenTime, () => this.SweetAlert('error', 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
      return;
    }

    const userInfo = this.buildUserInfoFromToken(res.token);

    if (!userInfo || userInfo.permission?.tabletPwa !== 'Y') {
      this.closeDialogWithMinDelay(dialogRef, dialogOpenTime, () => this.SweetAlert('error', 'บัญชีนี้ไม่มีสิทธิ์ใช้งานแอปนี้ (Tablet PWA)'));
      return;
    }

    //  ผ่านเช็คสิทธิ์แล้ว ค่อยเก็บ access token + ข้อมูล user ไว้ที่ session
    sessionStorage.setItem('_ACCESS_TOKEN', res.token);
    sessionStorage.setItem('_USER_INFO', JSON.stringify(userInfo));
    //  เริ่มนับ auto-logout ใหม่ทุกครั้งที่ login -> ล้างเวลา Get/Put ล่าสุด + ตัวนับของรอบก่อนที่ไม่ได้กด logout (เข้าหน้านี้
    //  ด้วยปุ่ม back/เปลี่ยนคนขับ) ไม่งั้นนับต่อจากรอบก่อน หลุดทั้งที่เพิ่ง login ไม่นาน header เริ่มนับใหม่จากตอนนี้เอง
    this.autoLogout.stop();
    localStorage.setItem('userId', userInfo.userId ?? userInfo.id ?? '');
    //  ล้างโหมดสแกนที่ user ก่อนหน้าสลับไว้ -> หน้า Pallet Management กลับไปใช้ค่าเริ่มต้นตาม department (PLBG = กล้อง)
    sessionStorage.removeItem('_PM_CAMERA_MODE');

    //  Role "Admin" หรือ Department "PLBG" ไม่ต้องสแกน QR Forklift -> เข้า system-menu ได้เลย (ไม่ผูกกับรถคันไหน ไม่ยิง check-in)
    //  department ใน JWT = department_name (ดู JwtService.cs ฝั่ง API)
    //  เคลียร์ค่า forklift เก่าใน session กันค้างจากรอบก่อน -> header/logout จะเห็นเป็น "ไม่มี forklift" (ข้าม checkout)
    const isAdmin = (userInfo.role ?? '').trim().toLowerCase() === 'admin';
    const isPlbg = (userInfo.department ?? '').trim().toUpperCase() === 'PLBG';
    if (isAdmin || isPlbg) {
      sessionStorage.removeItem('_FORKLIFT_NAME');
      sessionStorage.removeItem('_FORKLIFT_ID');
      sessionStorage.removeItem('_SELECTED_WAREHOUSE');
      this.closeDialogWithMinDelay(dialogRef, dialogOpenTime, () => {
        this.SweetAlertLoginSuccess();
        this.router.navigate(['system-menu']);
      });
      return;
    }

    //  บังคับสแกน QR Code รถ Forklift ก่อนเข้าหน้า system-menu ทุกครั้งที่ login สำเร็จ
    this.closeDialogWithMinDelay(dialogRef, dialogOpenTime, () => this.promptForkliftScan());
  }

  //  ดึงข้อความ error จาก response ให้ปลอดภัย -> err.error.message บางเคสเป็น object (เช่น .NET validation error)
  //  ไม่ใช่ string ตรงๆ ถ้าใช้ดื้อๆ SweetAlert จะขึ้น "[object Object]" ให้ user งงว่าอะไรผิด
  private extractErrorMessage(err: any, fallback: string): string {
    const raw = err?.error?.message ?? err?.error?.title ?? err?.error;
    return typeof raw === 'string' && raw.trim() ? raw : fallback;
  }

  //  หน่วงปิด dialog ขั้นต่ำกันภาพกระพริบ ถ้า API ตอบเร็วกว่า MIN_LOADING_TIME
  private readonly MIN_LOADING_TIME = 800; // ms
  private closeDialogWithMinDelay(dialogRef: MatDialogRef<any>, openTime: number, callback: () => void): void {
    const elapsed = Date.now() - openTime;
    const remaining = this.MIN_LOADING_TIME - elapsed;

    if (remaining > 0) {
      setTimeout(() => {
        dialogRef.close();
        callback();
      }, remaining);
    } else {
      dialogRef.close();
      callback();
    }
  }

  //  เปิด modal บังคับสแกน QR Code รถ Forklift (รูปแบบ id|forklift_name) -> เอา id ไปยิง
  //  GetProcessForklift ค้นด้วย id ก่อน แล้วเทียบ name ที่สแกนได้กับ forklift_name จริงของคันนั้นอีกชั้น
  //  (กันพิมพ์/สแกน id ที่ถูกต้องแต่ต่อท้ายด้วยชื่ออะไรก็ได้ แล้วหลุดผ่านไป)
  //  ไม่พบ Forklift / ชื่อไม่ตรง -> แจ้ง error แล้วเปิด modal สแกนใหม่ทันที
  //  พบ Forklift และชื่อตรง -> ไปต่อที่ confirmForkliftUsage() โชว์ข้อมูลให้ตรวจสอบก่อนกดยืนยันเสมอ (เช็คสถานะพร้อมใช้งานตรงนั้น)
  private promptForkliftScan(): void {
    const scanDialogRef = this.dialog.open(ScanForkliftDialog, {
      width: '90%',
      maxWidth: '560px',
      disableClose: true,
      //  ปิด autoFocus default ('first-tabbable' -> ไปเจอ mat-slide-toggle ก่อน input ที่ซ่อนไว้)
      //  ไม่งั้น CDK จะแย่งโฟกัสไปจาก focusScannerInput() ในตัว component เอง ทำให้ scan ไม่ armed ตั้งแต่เปิด
      autoFocus: false,
    });

    scanDialogRef.afterClosed().subscribe((scanned?: { id: string; name: string }) => {
      //  ปิด dialog โดยไม่มีผลลัพธ์ -> ปกติไม่เกิดเองเพราะ disableClose: true กันไว้ นอกจากกดปุ่ม "ยกเลิก" ใน dialog เอง
      //  (ScanForkliftDialog.onClickCancel) ถือเป็นสัญญาณยกเลิก -> เคลียร์ session ที่เพิ่ง login ไว้ กลับไปหน้า login ใหม่
      if (!scanned) {
        this.cancelLoginAfterForkliftGate();
        return;
      }

      const screenWidth = window.innerWidth;
      const dialogWidth = screenWidth < 600 ? '95%' : '60%';
      const loadingRef = this.dialog.open(Dialogloading, {
        width: dialogWidth,
        height: 'auto',
        maxHeight: '90vh',
        disableClose: true,
      });
      const loadingOpenTime = Date.now();

      this.restService.GetProcessForklift(Number(scanned.id) || 0, '', '', 0, '', 1, 1).subscribe({
        next: (forkliftRes: Type.ResponseProcessGetForklift) => {
          const forklift = forkliftRes?.data?.[0];

          if (!forklift) {
            this.closeDialogWithMinDelay(loadingRef, loadingOpenTime, () => {
              this.SweetAlert('error', `ไม่มี Forklift id "${scanned.id}" ในระบบ กรุณาตรวจสอบ QR Code แล้วลองใหม่อีกครั้ง`)
                .then(() => this.promptForkliftScan());
            });
            return;
          }

          //  เทียบชื่อแบบ trim ตัด whitespace หัวท้ายเท่านั้น -> สนตัวพิมพ์เล็ก/ใหญ่ด้วย ต้องตรงเป๊ะทุกตัวอักษร
          const scannedName = scanned.name.trim();
          const realName = (forklift.forklift_name ?? '').trim();
          if (scannedName !== realName) {
            this.closeDialogWithMinDelay(loadingRef, loadingOpenTime, () => {
              this.SweetAlert('error', `ชื่อ Forklift ไม่ตรงกับ id "${scanned.id}" ในระบบ กรุณาตรวจสอบ QR Code แล้วลองใหม่อีกครั้ง`)
                .then(() => this.promptForkliftScan());
            });
            return;
          }

          //  โชว์ข้อมูล Forklift ให้เห็นก่อนเสมอ (แม้สถานะไม่พร้อมใช้งาน) แล้วค่อยเช็คสถานะจริงตอนกดยืนยัน
          this.closeDialogWithMinDelay(loadingRef, loadingOpenTime, () => this.confirmForkliftUsage(forklift));
        },
        error: (err) => {
          console.error('Get forklift error:', err);
          this.closeDialogWithMinDelay(loadingRef, loadingOpenTime, () => {
            this.SweetAlert('error', 'ไม่สามารถตรวจสอบข้อมูล Forklift ได้ กรุณาลองใหม่อีกครั้ง')
              .then(() => this.promptForkliftScan());
          });
        },
      });
    });
  }

  //  กด "ยกเลิก" ใน ScanForkliftDialog -> ล้าง session ที่เพิ่ง login ไว้ (token/user info/forklift เก่าถ้ามี) ทั้งหมด
  //  แล้วกลับไปโชว์ฟอร์ม login ปกติ (ไม่ต้อง navigate เพราะ dialog/Swal ทั้งชุดนี้เปิดจาก LoginComponent เอง -> ยังอยู่
  //  หน้า /login ตลอดเวลาอยู่แล้ว แค่มี dialog ซ้อนทับอยู่) เคลียร์ช่องรหัสผ่านด้วยกันเผื่อคนขับคนถัดไปมาใช้เครื่องต่อ
  private cancelLoginAfterForkliftGate(): void {
    sessionStorage.removeItem('_ACCESS_TOKEN');
    sessionStorage.removeItem('_USER_INFO');
    sessionStorage.removeItem('_FORKLIFT_NAME');
    sessionStorage.removeItem('_FORKLIFT_ID');
    sessionStorage.removeItem('_SELECTED_WAREHOUSE');
    localStorage.removeItem('userId');
    this._mPassword.setValue('');
    //  กลับมาหน้า login (tab QR) -> พร้อมสแกนต่อทันที (setTimeout รอ CDK คืนโฟกัสหลังปิด dialog ก่อน)
    setTimeout(() => this.armQrScanner(), 0);
  }

  //  Step ก่อนเข้า system-menu: โชว์ข้อมูล Forklift ที่สแกนได้ทั้งหมด ให้ผู้ใช้ตรวจสอบก่อนกดยืนยันการใช้งาน
  //  เช็คสถานะพร้อมใช้งานตอนกดยืนยัน (ไม่ใช่ตอนสแกนเสร็จ) -> ผู้ใช้เห็นก่อนว่าสแกนถูกคัน แต่ใช้ไม่ได้เพราะอะไร
  //  ดีไซน์ให้เป็นชุดเดียวกับ modal ตอนสแกน (ScanForkliftDialog/fl-gate): ใช้ CSS variable, motif ไอคอน+วงแหวน,
  //  และ asset (forklift-1.png) ชุดเดียวกัน แทนที่จะเป็นกล่อง Swal ธรรมดา -> reskin ผ่าน customClass เพราะ
  //  Swal.fire ใช้งานอยู่แล้ว (มี logic confirm/cancel/then ครบ) ไม่ต้องสร้าง MatDialog component ใหม่ซ้ำ
  private confirmForkliftUsage(forklift: Type.ResultProcessGetForklift): void {
    const isReady = (forklift.forklift_status ?? '').trim() === 'พร้อมใช้งาน';
    const remark = typeof forklift.remark === 'string' && forklift.remark.trim() ? forklift.remark : '';
    const lastUsed = this.formatDateTime(forklift.lasted_used_datetime);

    //  Forklift บางคันผูกได้หลาย WH (warehouse_code เป็น string เดียวคั่นด้วย comma) -> โชว์ 3 ตัวแรก + "+N more"
    //  ดูทั้งหมดได้จาก title ตอน hover/กดค้าง
    const warehouseList = (forklift.warehouse_code ?? '').split(',').map((w) => w.trim()).filter((w) => !!w);
    const warehouseDisplay = warehouseList.length > 3
      ? `${warehouseList.slice(0, 3).join(', ')} +${warehouseList.length - 3} more`
      : (warehouseList.join(', ') || '-');
    const warehouseFullTitle = warehouseList.join(', ');

    //  ข้อมูลคนขับฝั่งซ้าย: อ่านจาก session ตรงๆ (เก็บไว้แล้วตั้งแต่ handleLoginResponse ก่อนจะมาถึงจุดนี้เสมอ)
    //  ไม่มี field "ชื่อไทย" จริงจาก backend ให้ใช้ (JwtPayload ไม่มี) -> ใช้ username/department/role ตามที่ตกลงกันแทน
    let driverUsername = '-';
    let driverDepartment = '-';
    let driverRole = '-';
    try {
      const raw = sessionStorage.getItem('_USER_INFO');
      const userInfo: Type.UserSessionInfo | null = raw ? JSON.parse(raw) : null;
      driverUsername = userInfo?.userId || userInfo?.userName || '-';
      driverDepartment = userInfo?.department || '-';
      driverRole = userInfo?.role || '-';
    } catch (err) {
      console.error('ไม่สามารถอ่านข้อมูลผู้ใช้จาก session ได้:', err);
    }

    Swal.fire({
      html: `
        <style>
          /* styles.css มี .swal2-popup { width: 90vw !important; max-width: 650px; } แบบ global ทุก Swal ในแอป
             (ตั้งใจจำกัดไว้ กัน modal ทั่วไปกว้างเกิน) ต้องชนด้วย selector เจาะจงกว่า (2 class) ถึงจะทับได้ */
          .swal2-popup.fl-info-popup {
            width: 960px !important;
            max-width: 94vw !important;
          }
          .fl-info-popup {
            --ink: #181365;
            --ink-2: #283278;
            --accent: #25a3dd;
            --surface-dim: #f3f5fb;
            --ink-soft: #6b70a0;
            --border: #e2e5f5;
            --ok: #14a318;
            --ok-tint: #e8f8ea;
            --danger: #d92d20;
            --danger-tint: #fbeae9;
            border-radius: 28px !important;
            padding: 44px 44px 36px !important;
            box-shadow: 0 24px 60px rgba(24, 19, 101, .22) !important;
            background: linear-gradient(180deg, #ffffff, #fafbff) !important;
          }
          .fl-info-html { margin: 0 !important; padding: 0 !important; text-align: left; }
          .fl-info-actions { margin-top: 30px !important; gap: 14px !important; }
          .fl-info-confirm, .fl-info-cancel {
            border-radius: 16px !important;
            padding: 20px 26px !important;
            font-size: 21px !important;
            font-weight: 600 !important;
            box-shadow: none !important;
          }
          .fl-info-confirm { background: #0e8f2e !important; }
          .fl-info-confirm:hover { background: #0b7526 !important; }
          .fl-info-cancel { background: var(--surface-dim) !important; color: var(--ink) !important; }

          .fl-info-eyebrow-row { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 6px; }
          .fl-info-eyebrow-rule { height: 1px; width: 32px; background: linear-gradient(to right, transparent, var(--border)); }
          .fl-info-eyebrow-rule--r { background: linear-gradient(to left, transparent, var(--border)); }
          .fl-info-eyebrow { font-size: 20px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--accent); }
          .fl-info-sub { margin: 8px 0 32px; font-size: 24px; color: var(--ink-soft); text-align: center; }

          /* 2 การ์ด (คนขับ / forklift) วางคู่กัน -> ให้ตรวจทั้งคู่พร้อมกันก่อนกดยืนยัน (ตั้งใจให้สมมาตร: ทั้งสองฝั่งมี
             icon + ชื่อ + chip สถานะ + meta เหมือนกันทุก slot แม้คนขับไม่มี "สถานะ" จริงจัง ก็ใส่ชิป "เข้าสู่ระบบแล้ว"
             แทน กันฝั่งซ้ายดูโหว่/เตี้ยกว่าฝั่งขวา และสื่อว่าทั้งคู่ "ผ่านการตรวจสอบแล้ว" เหมือนกัน -- ทำเป็นการ์ดพื้นสีอ่อน
             คนละโทน (ฟ้า/เขียว-แดงตามสถานะ) แทนคอลัมน์ลอยเปล่าๆ ให้เต็มพื้นที่ที่กว้างขึ้นจริง ไม่ใช่แค่ขยาย container
             แล้วปล่อยให้เนื้อหาลอยกลางที่ว่างเยอะเกิน) */
          .fl-info-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
          .fl-info-col {
            display: flex; flex-direction: column; align-items: center; text-align: center; min-width: 0;
            border-radius: 22px; padding: 30px 28px 26px;
          }
          .fl-info-col--user { background: linear-gradient(170deg, #f3f6fd, #eef2fb); }
          .fl-info-col--fl { background: linear-gradient(170deg, ${isReady ? '#f1faf2, #ecf7ed' : '#fdf2f1, #fbebe9'}); }
          .fl-info-col-label { font-size: 20px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 18px; }
          .fl-info-col-label--user { color: var(--accent); }
          .fl-info-col-label--fl { color: ${isReady ? 'var(--ok)' : 'var(--danger)'}; }
          .fl-info-name {
            margin: 0 0 16px; font-size: 30px; font-weight: 700; color: var(--ink); letter-spacing: -.3px;
            max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          }

          .fl-info-icon-stage { position: relative; display: flex; align-items: center; justify-content: center; height: 128px; width: 128px; margin-bottom: 18px; }
          .fl-info-icon-ring {
            position: absolute; width: 128px; height: 128px; border-radius: 28px;
            animation: fl-info-pulse-ring 2.2s cubic-bezier(.2, .7, .4, 1) infinite;
          }
          .fl-info-icon-ring--user { border: 2px solid var(--accent); }
          .fl-info-icon-ring--fl { border: 2px solid ${isReady ? 'var(--ok)' : 'var(--danger)'}; }
          .fl-info-icon-ring--delay { animation-delay: 1.1s; }
          .fl-info-icon-circle {
            position: relative; width: 100px; height: 100px; border-radius: 24px;
            display: flex; align-items: center; justify-content: center;
            background: #ffffff;
            box-shadow: 0 2px 10px rgba(24, 19, 101, .08), inset 0 0 0 1px rgba(24, 19, 101, .04);
          }
          .fl-info-icon-circle img { width: 66px; height: 66px; object-fit: contain; }
          .fl-info-icon-circle .material-icons { font-size: 50px; color: var(--ink-2); }

          .fl-info-chip { font-size: 16px; font-weight: 700; padding: 8px 20px; border-radius: 999px; margin-bottom: 24px; }
          .fl-info-chip--user { color: var(--accent); background: #ffffff; }
          .fl-info-chip--ok { color: var(--ok); background: #ffffff; }
          .fl-info-chip--err { color: var(--danger); background: #ffffff; }

          .fl-info-meta { width: 100%; border-top: 1px solid rgba(24, 19, 101, .08); padding-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px 12px; }
          .fl-info-meta-full { grid-column: 1 / -1; }
          .fl-info-meta-label { font-size: 13px; color: #9aa0c9; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
          .fl-info-meta-value {
            font-size: 19px; font-weight: 600; color: var(--ink-2);
            max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          }
          /* Remark เป็นข้อความอิสระที่คนพิมพ์เอง อาจมีข้อมูลสำคัญเกี่ยวกับสภาพรถ -> ห้ามตัดด้วย ... เด็ดขาด
             กันพลาดข้อมูลที่ควรรู้ก่อนใช้งานจริง ปล่อยให้ wrap ลงบรรทัดใหม่แทน (เป็น field เดียวที่ยกเว้น) */
          .fl-info-meta-value--wrap { white-space: normal; overflow: visible; text-overflow: clip; word-break: break-word; }

          @keyframes fl-info-pulse-ring {
            0% { transform: scale(.8); opacity: .85; }
            100% { transform: scale(1.3); opacity: 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            .fl-info-icon-ring { display: none; }
          }
        </style>

        <div class="fl-info-eyebrow-row">
          <span class="fl-info-eyebrow-rule"></span>
          <span class="fl-info-eyebrow">Forklift check-in</span>
          <span class="fl-info-eyebrow-rule fl-info-eyebrow-rule--r"></span>
        </div>
        <p class="fl-info-sub">ตรวจสอบข้อมูลก่อนใช้งาน</p>

        <div class="fl-info-columns">
          <div class="fl-info-col fl-info-col--user">
            <div class="fl-info-col-label fl-info-col-label--user">คนขับ</div>
            <div class="fl-info-icon-stage">
              <span class="fl-info-icon-ring fl-info-icon-ring--user"></span>
              <span class="fl-info-icon-ring fl-info-icon-ring--user fl-info-icon-ring--delay"></span>
              <div class="fl-info-icon-circle">
                <span class="material-icons">person</span>
              </div>
            </div>
            <h2 class="fl-info-name" title="${driverUsername}">${driverUsername}</h2>
            <span class="fl-info-chip fl-info-chip--user">เข้าสู่ระบบแล้ว</span>
            <div class="fl-info-meta">
              <div>
                <div class="fl-info-meta-label">แผนก</div>
                <div class="fl-info-meta-value" title="${driverDepartment}">${driverDepartment}</div>
              </div>
              <div>
                <div class="fl-info-meta-label">ตำแหน่ง</div>
                <div class="fl-info-meta-value" title="${driverRole}">${driverRole}</div>
              </div>
            </div>
          </div>

          <div class="fl-info-col fl-info-col--fl">
            <div class="fl-info-col-label fl-info-col-label--fl">Forklift</div>
            <div class="fl-info-icon-stage">
              ${isReady ? '<span class="fl-info-icon-ring fl-info-icon-ring--fl"></span><span class="fl-info-icon-ring fl-info-icon-ring--fl fl-info-icon-ring--delay"></span>' : ''}
              <div class="fl-info-icon-circle">
                <img src="assets/images/forklift-1.png" alt="" />
              </div>
            </div>
            <h2 class="fl-info-name" title="${forklift.forklift_name ?? '-'}">${forklift.forklift_name ?? '-'}</h2>
            <span class="fl-info-chip ${isReady ? 'fl-info-chip--ok' : 'fl-info-chip--err'}">${forklift.forklift_status ?? '-'}</span>
            <div class="fl-info-meta">
              <div>
                <div class="fl-info-meta-label">คลังสินค้า</div>
                <div class="fl-info-meta-value" title="${warehouseFullTitle}">${warehouseDisplay}</div>
              </div>
              <div>
                <div class="fl-info-meta-label">ใช้งานล่าสุด</div>
                <div class="fl-info-meta-value" title="${lastUsed}">${lastUsed}</div>
              </div>
              <div class="fl-info-meta-full">
                <div class="fl-info-meta-label">Remark</div>
                <div class="fl-info-meta-value fl-info-meta-value--wrap">${remark || '-'}</div>
              </div>
            </div>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'ยืนยันการใช้งาน',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
      allowOutsideClick: false,
      allowEscapeKey: false,
      width: 960,
      customClass: {
        popup: 'fl-info-popup',
        htmlContainer: 'fl-info-html',
        actions: 'fl-info-actions',
        confirmButton: 'fl-info-confirm',
        cancelButton: 'fl-info-cancel',
      },
    }).then((result) => {
      if (!result.isConfirmed) {
        this.promptForkliftScan();
        return;
      }

      if (!isReady) {
        this.SweetAlert('error', 'ไม่สามารถใช้รถที่ไม่พร้อมใช้งานได้').then(() => this.promptForkliftScan());
        return;
      }

      sessionStorage.setItem('_FORKLIFT_NAME', forklift.forklift_name);
      sessionStorage.setItem('_FORKLIFT_ID', String(forklift.id));
      sessionStorage.setItem('_SELECTED_WAREHOUSE', forklift.warehouse_code);

      //  stamp check-in กับหลังบ้าน (fire-and-forget — ไม่บล็อก flow เข้าระบบถ้าเส้นนี้ล่ม)
      const currentUserId = Number(localStorage.getItem('userId')) || 0;
      this.restService.CheckinForklift(forklift.id, { updateBy: currentUserId }).subscribe({
        error: (err) => console.error('Checkin forklift error:', err),
      });

      this.SweetAlertLoginSuccess();
      this.router.navigate(['system-menu']);
    });
  }

  //  แปลง ISO datetime ดิบจาก API ("2026-08-23T17:25:22.313") ให้อ่านง่าย -> "23/08/2026 17:25"
  private formatDateTime(iso: string): string {
    const d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '-';

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  //  Decode JWT payload (base64url) -> สร้างข้อมูล user (ไม่เขียนอะไรลง session ที่นี่
  //  เพราะต้องเช็ค permission.tabletPwa ก่อนที่ onClickSubmit ถึงค่อยตัดสินใจว่าจะเก็บ session จริงไหม)
  private buildUserInfoFromToken(token: string): Type.UserSessionInfo | null {
    const payload = this.decodeJwt(token);
    console.log('Decoded JWT payload:', payload);
    if (!payload) return null;

    let permission: Type.JwtPermission | null = null;
    try {
      permission = payload.permission ? JSON.parse(payload.permission) : null;
    } catch (err) {
      console.error('ไม่สามารถ parse permission จาก token ได้:', err);
    }

    console.log('User permission:', permission);

    return {
      id: payload.id,
      userId: payload.user_id,
      userName: payload.user_name,
      empId: payload.emp_id,
      departmentId: payload.department_id,
      department: payload.department,
      roleId: payload.role_id,
      role: payload.role,
      permission,
      exp: payload.exp,
    };
  }

  private decodeJwt(token: string): Type.JwtPayload | null {
    try {
      const payloadSegment = token.split('.')[1];
      const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      return JSON.parse(atob(padded));
    } catch (err) {
      console.error('ไม่สามารถ decode JWT token ได้:', err);
      return null;
    }
  }

  //  On Key 'Enter" Down
  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      setTimeout(() => {
        this.onClickSubmit();
      }, 300);
    }
  }

  //  Hide & Show Password
  public togglePasswordVisibility(): void {
    this._showPassword = !this._showPassword;
  }

  //  Sweet Alert (return promise -> เรียกต่อได้หลังผู้ใช้กดปิด popup)
  SweetAlert(iconn: any, alert_message: string) {
    return Swal.fire({
      position: 'center',
      icon: iconn,
      title: 'ข้อความจากระบบ',
      text: alert_message,
      showConfirmButton: true,
      //  didClose ยิงหลัง Swal คืนโฟกัสเดิมเสร็จแล้ว -> tab QR กลับมาพร้อมสแกนต่อทันที (armQrScanner เช็ค tab/dialog เอง)
      didClose: () => this.armQrScanner(),
    });
  }

  //  popup เข้าสู่ระบบสำเร็จ -> ปิดเองอัตโนมัติ ไม่ต้องกด OK (แจ้งให้เห็นแวบเดียวแล้วเข้าหน้าถัดไปเลย)
  private SweetAlertLoginSuccess() {
    return Swal.fire({
      position: 'center',
      icon: 'success',
      title: 'ข้อความจากระบบ',
      text: 'เข้าสู่ระบบสำเร็จ',
      showConfirmButton: false,
      timer: 1500,
      timerProgressBar: true,
    });
  }
}