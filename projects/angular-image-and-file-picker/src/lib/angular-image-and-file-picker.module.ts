import { NgModule } from '@angular/core';
import { AngularImageAndFilePickerComponent } from './angular-image-and-file-picker/angular-image-and-file-picker.component';
import { AngularPreviewImageComponent } from './angular-preview-image/angular-preview-image.component';
import { CommonModule } from '@angular/common';
import { AngularFileViewerComponent } from './angular-file-viewer/angular-file-viewer.component';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { AngularErrorDialogComponent } from './angular-error-dialog/angular-error-dialog.component';
import { AngularConfirmationDialogComponent } from './angular-confirmation-dialog/angular-confirmation-dialog.component';
import { AngularExcelFileViewerComponent } from './angular-file-viewer/angular-excel-file-viewer/angular-excel-file-viewer.component';
import { AngularPdfViewerComponent } from './angular-file-viewer/angular-pdf-viewer/angular-pdf-viewer.component';
import { AngularVideoComponent } from './angular-file-viewer/angular-video/angular-video.component';
import { AngularQrCodeDialogComponent } from './angular-qr-code-dialog/angular-qr-code-dialog.component';
import { AngularViewConnectionDialogComponent } from './angular-view-connection-dialog/angular-view-connection-dialog.component';
import { TimeAgoPipe } from './pipes/time-ago.pipe';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';
import { MatInputModule } from '@angular/material/input';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { HttpClientModule } from '@angular/common/http';
import { QRCodeComponent } from 'angularx-qrcode';


const uiImports = [
  MatTooltipModule,
  MatIconModule,
  MatSnackBarModule,
  MatProgressSpinnerModule,
  MatInputModule,
  MatButtonModule,
  MatDialogModule,
  MatDividerModule,
];


@NgModule({
  declarations: [
    AngularImageAndFilePickerComponent,
    AngularPreviewImageComponent,
    AngularFileViewerComponent,
    AngularExcelFileViewerComponent,
    AngularPdfViewerComponent,
    AngularVideoComponent,
    AngularErrorDialogComponent,
    AngularConfirmationDialogComponent,
    AngularQrCodeDialogComponent,
    AngularViewConnectionDialogComponent,
    TimeAgoPipe
  ],
  imports: [
    CommonModule,
    HttpClientModule,
    NgxExtendedPdfViewerModule,
    FormsModule,
    ReactiveFormsModule,
    QRCodeComponent,
    ...uiImports,
    DragDropModule
  ],
  exports: [
    AngularImageAndFilePickerComponent,
    AngularQrCodeDialogComponent
  ]
})
export class AngularImageAndFilePickerModule { }
