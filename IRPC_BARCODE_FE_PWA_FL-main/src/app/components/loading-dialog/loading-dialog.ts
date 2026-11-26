import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

@Component({
  selector: 'app-dialogloading',
  standalone: false,
  templateUrl: './loading-dialog.html',
  styleUrl: './loading-dialog.css',
})
export class LoadingDialogComponent {
  //  ข้อความจาก LoadingService.show(message) -> เดิม template เขียนตายตัว "Please wait for loading ..." ข้อความที่ส่งมาเลยไม่เคยขึ้น
  readonly data = inject<{ message?: string } | null>(MAT_DIALOG_DATA, { optional: true });
}
