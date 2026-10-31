import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { AngularCameraCaptureDialogComponent, CameraCaptureDialogData } from './angular-camera-capture-dialog.component';

describe('AngularCameraCaptureDialogComponent', () => {
  let component: AngularCameraCaptureDialogComponent;
  let fixture: ComponentFixture<AngularCameraCaptureDialogComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<AngularCameraCaptureDialogComponent>>;
  let mockStream: jasmine.SpyObj<MediaStream>;

  beforeEach(async () => {
    // Create mock MediaStream
    mockStream = jasmine.createSpyObj('MediaStream', ['getTracks']);
    mockStream.getTracks.and.returnValue([
      jasmine.createSpyObj('MediaStreamTrack', ['stop'])
    ]);

    // Create mock DialogRef
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    const mockData: CameraCaptureDialogData = {
      stream: mockStream,
      videoDevices: [],
      isMobile: false
    };

    await TestBed.configureTestingModule({
      imports: [AngularCameraCaptureDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockData }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AngularCameraCaptureDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should stop stream on destroy', () => {
    component.ngOnDestroy();
    expect(mockStream.getTracks).toHaveBeenCalled();
  });

  it('should close dialog on cancel', () => {
    component.cancel();
    expect(mockDialogRef.close).toHaveBeenCalledWith({ action: 'cancel' });
  });

  it('should close dialog on upload', () => {
    component.openUpload();
    expect(mockDialogRef.close).toHaveBeenCalledWith({ action: 'upload' });
  });

  it('should show the upload button by default', () => {
    const uploadBtn = fixture.nativeElement.querySelector('.upload-btn');
    expect(uploadBtn).toBeTruthy();
  });
});

describe('AngularCameraCaptureDialogComponent without file upload', () => {
  let fixture: ComponentFixture<AngularCameraCaptureDialogComponent>;
  let mockStream: jasmine.SpyObj<MediaStream>;

  beforeEach(async () => {
    mockStream = jasmine.createSpyObj('MediaStream', ['getTracks']);
    mockStream.getTracks.and.returnValue([
      jasmine.createSpyObj('MediaStreamTrack', ['stop'])
    ]);

    const mockData: CameraCaptureDialogData = {
      stream: mockStream,
      videoDevices: [],
      isMobile: false,
      allowFileUpload: false
    };

    await TestBed.configureTestingModule({
      imports: [AngularCameraCaptureDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: jasmine.createSpyObj('MatDialogRef', ['close']) },
        { provide: MAT_DIALOG_DATA, useValue: mockData }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AngularCameraCaptureDialogComponent);
    fixture.detectChanges();
  });

  it('should hide the upload button when allowFileUpload is false', () => {
    const uploadBtn = fixture.nativeElement.querySelector('.upload-btn');
    expect(uploadBtn).toBeNull();
  });
});

describe('AngularCameraCaptureDialogComponent capture watermark', () => {
  let component: AngularCameraCaptureDialogComponent;
  let fixture: ComponentFixture<AngularCameraCaptureDialogComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<AngularCameraCaptureDialogComponent>>;
  let geolocation: { getCurrentPosition: jasmine.Spy };
  let restoreGeolocation: () => void;

  beforeEach(async () => {
    const mockStream = jasmine.createSpyObj('MediaStream', ['getTracks']);
    mockStream.getTracks.and.returnValue([jasmine.createSpyObj('MediaStreamTrack', ['stop'])]);
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    geolocation = { getCurrentPosition: jasmine.createSpy('getCurrentPosition') };
    restoreGeolocation = installGeolocation(geolocation);

    const mockData: CameraCaptureDialogData = {
      stream: mockStream,
      videoDevices: [],
      isMobile: false,
    };

    await TestBed.configureTestingModule({
      imports: [AngularCameraCaptureDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockData }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AngularCameraCaptureDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    const video = component.videoElement.nativeElement;
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
  });

  afterEach(() => {
    restoreGeolocation();
  });

  it('encodes one JPEG at the existing quality and does not request GPS when watermarking is off', fakeAsync(() => {
    const toBlob = spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (this: HTMLCanvasElement, callback, type, quality) {
      callback!(new Blob(['frame'], { type: type || 'image/jpeg' }));
      void this;
      void quality;
      (toBlob as jasmine.Spy & { quality?: number }).quality = quality;
    });
    spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();

    component.capturePhoto();
    tick(300);
    flushMicrotasks();

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(toBlob).toHaveBeenCalledTimes(1);
    expect(toBlob.calls.mostRecent().args[1]).toBe('image/jpeg');
    expect(toBlob.calls.mostRecent().args[2]).toBe(0.9);
    const result = mockDialogRef.close.calls.mostRecent().args[0];
    expect(result.action).toBe('capture');
    expect(result.file.type).toBe('image/jpeg');
    expect(result.file.name).toMatch(/^camera-capture-\d+\.jpg$/);
  }));

  it('reads the watermark config at shutter time and still returns a capture when GPS is denied and the policy is continue', fakeAsync(() => {
    const getter = jasmine.createSpy('getCaptureWatermarkConfig').and.returnValue({
      dateTime: { enabled: true, displayMode: 'date' as const, dateFormat: 'YYYY', timezone: 'UTC' },
      location: { enabled: true, failurePolicy: 'continue' as const },
    });
    component.data.getCaptureWatermarkConfig = getter;
    geolocation.getCurrentPosition.and.callFake((_success: PositionCallback, error: PositionErrorCallback) => error(geoError(1)));
    spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake((callback, type) => {
      callback!(new Blob(['frame'], { type: type || 'image/jpeg' }));
    });
    spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();

    component.capturePhoto();
    expect(getter).not.toHaveBeenCalled();
    tick(300);
    flushMicrotasks();

    expect(getter).toHaveBeenCalled();
    expect(geolocation.getCurrentPosition).toHaveBeenCalled();
    expect(mockDialogRef.close).toHaveBeenCalledWith(jasmine.objectContaining({ action: 'capture' }));
  }));

  it('does not emit a capture if the user cancels while location is still pending', fakeAsync(() => {
    let succeed: PositionCallback | undefined;
    geolocation.getCurrentPosition.and.callFake((success: PositionCallback) => {
      succeed = success;
    });
    component.data.getCaptureWatermarkConfig = () => ({ location: { enabled: true } });
    spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake((callback, type) => {
      callback!(new Blob(['frame'], { type: type || 'image/jpeg' }));
    });
    spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();

    component.capturePhoto();
    tick(300);
    flushMicrotasks();
    component.cancel();
    succeed?.({
      coords: {
        latitude: 13.75,
        longitude: 100.5,
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON() { return this; },
      },
      timestamp: Date.now(),
      toJSON() { return this; },
    });
    flushMicrotasks();

    expect(mockDialogRef.close).toHaveBeenCalledTimes(1);
    expect(mockDialogRef.close).toHaveBeenCalledWith({ action: 'cancel' });
  }));

  it('keeps the camera open and reports a cancel-policy location failure', fakeAsync(() => {
    const onCaptureError = jasmine.createSpy('onCaptureError');
    component.data.getCaptureWatermarkConfig = () => ({
      location: { enabled: true, failurePolicy: 'cancel' },
    });
    component.data.onCaptureError = onCaptureError;
    geolocation.getCurrentPosition.and.callFake((_success: PositionCallback, error: PositionErrorCallback) => error(geoError(1)));
    const toBlob = spyOn(HTMLCanvasElement.prototype, 'toBlob');
    spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();

    component.capturePhoto();
    tick(300);
    flushMicrotasks();
    fixture.detectChanges();

    expect(toBlob).not.toHaveBeenCalled();
    expect(mockDialogRef.close).not.toHaveBeenCalled();
    expect(onCaptureError).toHaveBeenCalledWith('Location permission was denied.', true);
    expect(fixture.nativeElement.querySelector('.capture-error')?.textContent).toContain('Location permission was denied.');
  }));
});

function geoError(code: number): GeolocationPositionError {
  return {
    code,
    message: 'failed',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };
}

function installGeolocation(value: { getCurrentPosition: jasmine.Spy }): () => void {
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'geolocation')
    ?? Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value });
  return () => {
    if (original) {
      Object.defineProperty(navigator, 'geolocation', original);
    } else {
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    }
  };
}
