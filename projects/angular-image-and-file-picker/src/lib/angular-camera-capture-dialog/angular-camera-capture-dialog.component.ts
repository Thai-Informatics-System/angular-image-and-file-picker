import { Component, Inject, OnInit, OnDestroy, ViewChild, ElementRef, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { ImageCaptureLocationFix, ImageCaptureWatermarkConfig } from '../interfaces/image-capture-watermark.type';
import { ImageCaptureWatermarkError, ImageCaptureWatermarkService } from '../services/image-capture-watermark.service';

export interface CameraCaptureDialogData {
  stream: MediaStream;
  videoDevices?: MediaDeviceInfo[];
  isMobile: boolean;
  allowFileUpload?: boolean;
  captureWatermarkConfig?: ImageCaptureWatermarkConfig | null;
  /** Read at shutter time so a later binding applies without reopening the dialog. */
  getCaptureWatermarkConfig?: () => ImageCaptureWatermarkConfig | null | undefined;
  onCaptureError?: (message: string, cancelled: boolean) => void;
}

export type CameraLocationStatus = 'off' | 'pending' | 'ready' | 'failed';

const LIVE_REDRAW_MS = 1000;
const LOCATION_REFRESH_MS = 5000;

export interface CameraCaptureResult {
  action: 'capture' | 'upload' | 'cancel';
  file?: File;
}

@Component({
  selector: 'angular-camera-capture-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './angular-camera-capture-dialog.component.html',
  styleUrls: ['./angular-camera-capture-dialog.component.css']
})
export class AngularCameraCaptureDialogComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement', { static: false }) videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement', { static: false }) canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('liveOverlayElement', { static: false }) liveOverlayElement?: ElementRef<HTMLCanvasElement>;

  currentStream: MediaStream;
  currentDeviceIndex = 0;
  isCapturing = signal(false);
  isSwitching = signal(false);
  showFlash = signal(false);
  captureError = signal<string | null>(null);
  locationStatus = signal<CameraLocationStatus>('off');
  locationRequired = signal(false);
  locationError = signal<string | null>(null);
  /** Capture stays disabled until a required location is available. */
  captureBlocked = computed(() => this.locationRequired() && this.locationStatus() !== 'ready');
  hasMultipleCameras = false;
  private destroyed = false;
  private locationFix: ImageCaptureLocationFix | null = null;
  private locationRequestId = 0;
  private liveTimer?: ReturnType<typeof setInterval>;
  private locationTimer?: ReturnType<typeof setTimeout>;

  constructor(
    public dialogRef: MatDialogRef<AngularCameraCaptureDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CameraCaptureDialogData,
    private watermark: ImageCaptureWatermarkService
  ) {
    this.currentStream = data.stream;
    this.hasMultipleCameras = (data.videoDevices?.length ?? 0) > 1;
  }

  ngOnInit(): void {
    // Wait for view to initialize before setting video source
    setTimeout(() => {
      if (this.videoElement) {
        this.videoElement.nativeElement.srcObject = this.currentStream;
      }
      this.syncLiveOverlay();
    });
    this.liveTimer = setInterval(() => this.syncLiveOverlay(), LIVE_REDRAW_MS);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    clearInterval(this.liveTimer);
    clearTimeout(this.locationTimer);
    this.stopStream();
  }

  /** Applies the current config: starts or stops location, then redraws the overlay on the video. */
  syncLiveOverlay(): void {
    if (this.destroyed) {
      return;
    }
    const config = this.readWatermarkConfig();
    this.locationRequired.set(this.watermark.isLocationRequired(config));
    if (!this.watermark.isLocationEnabled(config)) {
      this.stopLocation();
    } else if (this.locationStatus() === 'off') {
      void this.requestLocation();
    }
    this.drawLiveOverlay(config);
  }

  retryLocation(): void {
    void this.requestLocation();
  }

  private async requestLocation(): Promise<void> {
    const requestId = ++this.locationRequestId;
    clearTimeout(this.locationTimer);
    if (!this.locationFix) {
      this.locationStatus.set('pending');
      this.locationError.set(null);
    }
    try {
      const fix = await this.watermark.getLocationFix(this.readWatermarkConfig());
      if (this.destroyed || requestId !== this.locationRequestId) {
        return;
      }
      this.locationFix = fix;
      this.locationStatus.set('ready');
      this.locationError.set(null);
      this.drawLiveOverlay(this.readWatermarkConfig());
    } catch (error) {
      if (this.destroyed || requestId !== this.locationRequestId) {
        return;
      }
      const denied = error instanceof ImageCaptureWatermarkError && error.code === 'permission-denied';
      // A slow refresh keeps the last fix. Revoked permission does not.
      if (!this.locationFix || denied) {
        this.locationFix = null;
        this.locationStatus.set('failed');
        this.locationError.set(error instanceof Error ? error.message : 'Location is unavailable.');
        this.drawLiveOverlay(this.readWatermarkConfig());
        return;
      }
    }
    this.locationTimer = setTimeout(() => void this.requestLocation(), LOCATION_REFRESH_MS);
  }

  private stopLocation(): void {
    this.locationRequestId++;
    clearTimeout(this.locationTimer);
    this.locationFix = null;
    this.locationError.set(null);
    this.locationStatus.set('off');
  }

  private drawLiveOverlay(config: ImageCaptureWatermarkConfig | null): void {
    const video = this.videoElement?.nativeElement;
    const canvas = this.liveOverlayElement?.nativeElement;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!video || !canvas || !ctx || !video.videoWidth || !video.videoHeight) {
      return;
    }
    // Same pixel size as the capture, so the view matches the saved photo.
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    try {
      this.watermark.paintLive(canvas, ctx, config, new Date(), this.locationFix);
    } catch {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  async switchCamera(): Promise<void> {
    if (!this.data.videoDevices || this.data.videoDevices.length <= 1) {
      return;
    }

    this.isSwitching.set(true);

    try {
      // Stop current stream
      this.stopStream();

      // Move to next camera
      this.currentDeviceIndex = (this.currentDeviceIndex + 1) % this.data.videoDevices.length;

      // Get new stream
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: this.data.videoDevices[this.currentDeviceIndex].deviceId,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      this.currentStream = newStream;
      if (this.videoElement) {
        this.videoElement.nativeElement.srcObject = newStream;
      }
    } catch (error) {
      console.error('Error switching camera:', error);
      // Could emit an error event here if needed
    } finally {
      // Add a small delay to show the switching state
      setTimeout(() => {
        this.isSwitching.set(false);
      }, 500);
    }
  }

  async capturePhoto(): Promise<void> {
    if (this.captureBlocked()) {
      return;
    }
    const capturedAt = new Date();
    this.isCapturing.set(true);
    this.captureError.set(null);
    this.showFlash.set(true);

    // The timestamp is the shutter time. GPS and encoding happen after the flash.
    setTimeout(() => {
      this.showFlash.set(false);
      void this.exportCapture(capturedAt);
    }, 300);
  }

  private async exportCapture(capturedAt: Date): Promise<void> {
    if (this.destroyed) {
      return;
    }

    const video = this.videoElement?.nativeElement;
    const canvas = this.canvasElement?.nativeElement;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!video || !canvas || !ctx || !video.videoWidth || !video.videoHeight) {
      this.isCapturing.set(false);
      this.reportError('Could not capture the photo.', false);
      return;
    }

    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      try {
        await this.watermark.paint(canvas, ctx, this.readWatermarkConfig(), capturedAt, this.locationFix);
      } catch (error) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch {
          // The clean frame is already on the canvas when a redraw is not possible.
        }
        if (this.destroyed) {
          return;
        }
        const watermarkError = error instanceof ImageCaptureWatermarkError ? error : null;
        const cancelled = !!watermarkError && watermarkError.code !== 'processing';
        this.reportError(
          cancelled && watermarkError
            ? watermarkError.message
            : 'Could not apply the capture watermark. The photo will be used without it.',
          cancelled
        );
        if (cancelled) {
          this.isCapturing.set(false);
          this.releaseCanvas(canvas);
          return;
        }
      }

      if (this.destroyed) {
        return;
      }

      const blob = await this.canvasToJpeg(canvas);
      this.releaseCanvas(canvas);
      if (this.destroyed || !blob) {
        this.isCapturing.set(false);
        return;
      }

      const file = new File([blob], `camera-capture-${Date.now()}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now()
      });
      this.dialogRef.close({ action: 'capture', file });
      this.isCapturing.set(false);
    } catch {
      if (!this.destroyed) {
        this.isCapturing.set(false);
        this.reportError('Could not capture the photo.', false);
      }
    }
  }

  private readWatermarkConfig(): ImageCaptureWatermarkConfig | null {
    if (this.data.getCaptureWatermarkConfig) {
      return this.data.getCaptureWatermarkConfig() ?? null;
    }
    return this.data.captureWatermarkConfig ?? null;
  }

  private reportError(message: string, cancelled: boolean): void {
    this.captureError.set(message);
    this.data.onCaptureError?.(message, cancelled);
  }

  private canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
    });
  }

  private releaseCanvas(canvas: HTMLCanvasElement): void {
    canvas.width = 0;
    canvas.height = 0;
  }

  openUpload(): void {
    this.destroyed = true;
    this.dialogRef.close({ action: 'upload' });
  }

  cancel(): void {
    this.destroyed = true;
    this.dialogRef.close({ action: 'cancel' });
  }

  private stopStream(): void {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => track.stop());
    }
  }
}
