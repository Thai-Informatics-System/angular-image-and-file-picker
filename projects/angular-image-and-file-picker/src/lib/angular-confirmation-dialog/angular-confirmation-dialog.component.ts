import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

@Component({
  selector: 'angular-confirmation-dialog',
  standalone: false,
  templateUrl: './angular-confirmation-dialog.component.html',
  styleUrl: './angular-confirmation-dialog.component.css'
})
export class AngularConfirmationDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<AngularConfirmationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
  ) {
    this.dialogRef.addPanelClass(['md-angular-w-400-px']);
  }

  onClose(status: boolean | null): void {
    this.dialogRef.close(status);
  }
}
