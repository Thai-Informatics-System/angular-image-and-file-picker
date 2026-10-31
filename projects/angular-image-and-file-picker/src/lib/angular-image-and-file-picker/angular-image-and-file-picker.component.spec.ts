import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { of } from 'rxjs';

import { CameraCaptureDialogData } from '../angular-camera-capture-dialog/angular-camera-capture-dialog.component';
import { AngularImageAndFilePickerComponent } from './angular-image-and-file-picker.component';
import { AngularImageAndFilePickerModule } from '../angular-image-and-file-picker.module';
import { ImageCaptureWatermarkService } from '../services/image-capture-watermark.service';

describe('AngularImageAndFilePickerComponent', () => {
  let component: AngularImageAndFilePickerComponent;
  let fixture: ComponentFixture<AngularImageAndFilePickerComponent>;

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

    fixture = TestBed.createComponent(AngularImageAndFilePickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('leaves capture watermarking off unless the consumer opts in', () => {
    expect(component.captureWatermarkConfig).toBeNull();
  });

  it('gives the camera dialog the latest watermark config and reports cancel failures through onError', () => {
    const stream = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
    const open = spyOn(component.dialog, 'open').and.returnValue({
      afterClosed: () => of(undefined),
    } as never);
    component.captureWatermarkConfig = { dateTime: { enabled: true } };

    (component as unknown as { showCameraModal: (stream: MediaStream, devices?: MediaDeviceInfo[]) => void })
      .showCameraModal(stream, []);

    const dialogConfig = open.calls.mostRecent().args[1];
    expect(dialogConfig).toBeTruthy();
    const data = dialogConfig!.data as CameraCaptureDialogData;
    expect(data.getCaptureWatermarkConfig?.()).toEqual({ dateTime: { enabled: true } });
    component.captureWatermarkConfig = { location: { enabled: true } };
    expect(data.getCaptureWatermarkConfig?.()).toEqual({ location: { enabled: true } });

    const helper = (component as unknown as { helper: { showErrorMsg: jasmine.Spy } }).helper;
    spyOn(helper, 'showErrorMsg');
    const onError = spyOn(component.onError, 'emit');
    data.onCaptureError?.('Location permission was denied.', true);
    expect(helper.showErrorMsg).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(true);
    onError.calls.reset();
    data.onCaptureError?.('Could not apply the capture watermark. The photo will be used without it.', false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('sends a camera capture through the existing image pipeline', () => {
    const file = new File([new Uint8Array([1])], 'camera-capture-1.jpg', { type: 'image/jpeg' });
    const detectImages = spyOn(component, 'detectImages');
    spyOn(component.dialog, 'open').and.returnValue({
      afterClosed: () => of({ action: 'capture', file }),
    } as never);
    const stream = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;

    (component as unknown as { showCameraModal: (stream: MediaStream) => void }).showCameraModal(stream);

    expect(detectImages).toHaveBeenCalled();
    const event = detectImages.calls.mostRecent().args[0];
    expect(event.target.files[0]).toBe(file);
  });

  it('does not watermark a gallery upload opened from the camera dialog', () => {
    const paint = spyOn(TestBed.inject(ImageCaptureWatermarkService), 'paint');
    const openImageSelector = spyOn(component, 'openImageSelector');
    spyOn(component.dialog, 'open').and.returnValue({
      afterClosed: () => of({ action: 'upload' }),
    } as never);
    const stream = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;

    (component as unknown as { showCameraModal: (stream: MediaStream) => void }).showCameraModal(stream);

    expect(openImageSelector).toHaveBeenCalled();
    expect(paint).not.toHaveBeenCalled();
  });

  it('compresses a gallery image and does not paint a watermark onto it', async () => {
    component.urlConfig = {
      getUploadUrl: '/upload',
      attachToEntity: null,
      updateTag: null,
      updateSequence: null,
      removeImage: '/remove',
    };
    component.config.isCompressed = true;
    const helper = (component as unknown as {
      helper: {
        compressFile: (file: File, mimeType: string) => Promise<Blob>;
        getUploadUrl: () => unknown;
        putFile: () => unknown;
        getDataUrlFromFile: () => Promise<string>;
      };
    }).helper;
    const compress = spyOn(helper, 'compressFile').and.callFake(async (file) => file);
    spyOn(helper, 'getUploadUrl').and.returnValue(of({
      data: { uploadUrlData: { uploadURL: 'https://example.test/put', uploadPath: '/x', resourceUrl: 'https://example.test/x.jpg' } },
    }));
    spyOn(helper, 'putFile').and.returnValue(of({}));
    spyOn(helper, 'getDataUrlFromFile').and.resolveTo('data:image/jpeg;base64,AA==');
    const paint = spyOn(TestBed.inject(ImageCaptureWatermarkService), 'paint');
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'gallery.jpg', { type: 'image/jpeg' });

    await component.detectImages({
      preventDefault() {},
      target: { files: [file], value: '' },
    });

    expect(paint).not.toHaveBeenCalled();
    expect(compress).toHaveBeenCalled();
  });
});
