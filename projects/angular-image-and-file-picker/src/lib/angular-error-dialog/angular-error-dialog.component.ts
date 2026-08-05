import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'lib-angular-error-dialog',
  standalone: false,
  templateUrl: './angular-error-dialog.component.html',
  styleUrl: './angular-error-dialog.component.css'
})
export class AngularErrorDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<AngularErrorDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
  ) {}

  onClose(): void {
    this.dialogRef.close();
  }
}
