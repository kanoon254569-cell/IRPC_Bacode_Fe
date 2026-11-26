import { Injectable, inject } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { LoadingDialogComponent } from '../components/loading-dialog/loading-dialog';

@Injectable({
  providedIn: 'root',
})
export class LoadingService {
  private dialog = inject(MatDialog);
  private dialogRef: MatDialogRef<LoadingDialogComponent> | null = null;

  show(message: string = 'กำลังดำเนินการ กรุณารอสักครู่...'): void {
    if (this.dialogRef) return;
    this.dialogRef = this.dialog.open(LoadingDialogComponent, {
      disableClose: true,
      data: { message },
      panelClass: 'custom-loading-panel',
    });
  }

  get isShowing(): boolean {
    return !!this.dialogRef;
  }

  hide(): void {
    if (this.dialogRef) {
      this.dialogRef.close();
      this.dialogRef = null;
    }
  }
}
