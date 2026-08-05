import { Component, Inject, ViewChild } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { DomSanitizer } from '@angular/platform-browser';
import type { FileViewerDialogData } from '../interfaces';
import { AngularPdfViewerComponent } from './angular-pdf-viewer/angular-pdf-viewer.component';

@Component({
  selector: 'angular-file-viewer',
  standalone: false,
  templateUrl: './angular-file-viewer.component.html',
  styleUrl: './angular-file-viewer.component.css'
})
export class AngularFileViewerComponent {
  safeUrl!: string;

  @ViewChild(AngularPdfViewerComponent, { static: false }) private pdfViewer!: AngularPdfViewerComponent;

  constructor(
    public dialogRef: MatDialogRef<AngularFileViewerComponent>,
    @Inject(MAT_DIALOG_DATA) public data: FileViewerDialogData,
    private sanitizer: DomSanitizer
  ) {
    console.log('File Viewer Data:', data);

    this.safeUrl = this.data.src;
    console.log('FileViewer SafeUrl:', this.safeUrl);

    dialogRef.beforeClosed().subscribe((result) => {
      console.log('The dialog is about to be closed');
      // Here's the interesting bit:
      if (this.pdfViewer) {
        this.pdfViewer.destroyPdfViewer();
        console.log('PDF Viewer Destroyed.');
      }
    });
  }

  downloadFile() {
    var el = document.createElement("a");
    el.setAttribute("href", this.safeUrl);
    el.setAttribute("download", 'Video-' + new Date().valueOf());
    document.body.appendChild(el);
    el.click();
    el.remove();
  }

  onClose(status: boolean | null): void {
    this.dialogRef.close(status);
  }
}
