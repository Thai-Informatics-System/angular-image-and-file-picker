import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { of } from 'rxjs';

import { AngularPdfViewerComponent } from './angular-pdf-viewer.component';
import { AngularImageAndFilePickerModule } from '../../angular-image-and-file-picker.module';

describe('AngularPdfViewerComponent', () => {
  let component: AngularPdfViewerComponent;
  let fixture: ComponentFixture<AngularPdfViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // Import the library module rather than declaring the component alone, so
      // child components and third-party modules (ngx-extended-pdf-viewer,
      // angularx-qrcode) resolve.
      imports: [AngularImageAndFilePickerModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MatDialogRef,
          useValue: {
            close: () => {},
            addPanelClass: () => {},
            removePanelClass: () => {},
            afterClosed: () => of(undefined),
            beforeClosed: () => of(undefined),
            updateSize: () => {},
          },
        },
        { provide: MAT_DIALOG_DATA, useValue: {} },
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AngularPdfViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
