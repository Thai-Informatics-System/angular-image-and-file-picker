import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';

import { AngularExcelFileViewerComponent } from './angular-excel-file-viewer.component';
import { AngularImageAndFilePickerModule } from '../../angular-image-and-file-picker.module';

describe('AngularExcelFileViewerComponent', () => {
  let component: AngularExcelFileViewerComponent;
  let fixture: ComponentFixture<AngularExcelFileViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AngularImageAndFilePickerModule]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AngularExcelFileViewerComponent);
    component = fixture.componentInstance;

    // src is @Input({ required: true }), and the sanitised iframe URL is built
    // in ngOnChanges — which Angular does not call when an input is assigned
    // directly on the instance. Without this the iframe binds a null resource
    // URL and change detection throws NG0904.
    const src = 'https://example.com/sheet.xlsx';
    component.src = src;
    component.ngOnChanges({ src: new SimpleChange(undefined, src, true) });

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
