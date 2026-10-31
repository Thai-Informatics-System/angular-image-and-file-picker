import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { AngularCameraCaptureDialogComponent, CameraCaptureDialogData } from './angular-camera-capture-dialog.component';
import { ImageCaptureWatermarkService } from '../services/image-capture-watermark.service';

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

describe('AngularCameraCaptureDialogComponent live watermark and location gate', () => {
  let component: AngularCameraCaptureDialogComponent;
  let fixture: ComponentFixture<AngularCameraCaptureDialogComponent>;
  let geolocation: { getCurrentPosition: jasmine.Spy };
  let restoreGeolocation: () => void;

  const position = (): GeolocationPosition => ({
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
  const captureButton = (): HTMLButtonElement => fixture.nativeElement.querySelector('.capture-btn');
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  const sync = async () => {
    component.syncLiveOverlay();
    await settle();
  };

  beforeEach(async () => {
    geolocation = { getCurrentPosition: jasmine.createSpy('getCurrentPosition') };
    restoreGeolocation = installGeolocation(geolocation);

    await TestBed.configureTestingModule({
      imports: [AngularCameraCaptureDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: jasmine.createSpyObj('MatDialogRef', ['close']) },
        { provide: MAT_DIALOG_DATA, useValue: { stream: new MediaStream(), videoDevices: [], isMobile: false } }
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
    fixture.destroy();
    restoreGeolocation();
  });

  it('does not ask for location or block capture when GPS is off', async () => {
    component.data.getCaptureWatermarkConfig = () => ({ enabled: true, location: { enabled: false, failurePolicy: 'cancel' } });

    await sync();

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(captureButton().disabled).toBeFalse();
  });

  it('does not ask for location when the master switch is off', async () => {
    component.data.getCaptureWatermarkConfig = () => ({ enabled: false, location: { enabled: true, failurePolicy: 'cancel' } });

    await sync();

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(captureButton().disabled).toBeFalse();
  });

  it('blocks capture while the location prompt is unanswered', async () => {
    component.data.getCaptureWatermarkConfig = () => ({ location: { enabled: true, failurePolicy: 'cancel' } });

    await sync();

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(captureButton().disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('.location-status')).toBeTruthy();
  });

  it('keeps capture blocked and offers a retry when location is denied', async () => {
    component.data.getCaptureWatermarkConfig = () => ({ location: { enabled: true, failurePolicy: 'cancel' } });
    geolocation.getCurrentPosition.and.callFake((_s: PositionCallback, error: PositionErrorCallback) => error(geoError(1)));
    const toBlob = spyOn(HTMLCanvasElement.prototype, 'toBlob');

    await sync();
    await component.capturePhoto();

    expect(captureButton().disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('.location-error')?.textContent).toContain('Location permission was denied.');
    expect(toBlob).not.toHaveBeenCalled();

    geolocation.getCurrentPosition.and.callFake((success: PositionCallback) => success(position()));
    (fixture.nativeElement.querySelector('.location-retry-btn') as HTMLButtonElement).click();
    await settle();

    expect(captureButton().disabled).toBeFalse();
  });

  it('enables capture once location is allowed and draws it on the live overlay', async () => {
    component.data.getCaptureWatermarkConfig = () => ({
      dateTime: { enabled: true },
      location: { enabled: true, failurePolicy: 'cancel' },
    });
    geolocation.getCurrentPosition.and.callFake((success: PositionCallback) => success(position()));
    const fillText = spyOn(CanvasRenderingContext2D.prototype, 'fillText').and.callThrough();

    await sync();

    const overlay = component.liveOverlayElement!.nativeElement;
    expect(captureButton().disabled).toBeFalse();
    expect(overlay.width).toBe(640);
    expect(overlay.height).toBe(480);
    expect(fillText.calls.allArgs().map((args) => args[0])).toContain('Latitude: 13.7500');
  });

  it('uses the held location at the shutter instead of asking again', async () => {
    component.data.getCaptureWatermarkConfig = () => ({ location: { enabled: true, failurePolicy: 'cancel' } });
    geolocation.getCurrentPosition.and.callFake((success: PositionCallback) => success(position()));
    await sync();
    const watermark = TestBed.inject(ImageCaptureWatermarkService);
    const paint = spyOn(watermark, 'paint').and.resolveTo();
    spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake((callback, type) => {
      callback!(new Blob(['frame'], { type: type || 'image/jpeg' }));
    });
    spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();

    await component.capturePhoto();
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(paint.calls.mostRecent().args[4]).toEqual(jasmine.objectContaining({ latitude: 13.75, longitude: 100.5 }));
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('does not block capture under the continue policy', async () => {
    component.data.getCaptureWatermarkConfig = () => ({ location: { enabled: true, failurePolicy: 'continue' } });

    await sync();

    expect(captureButton().disabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('.location-status')).toBeNull();
  });
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
