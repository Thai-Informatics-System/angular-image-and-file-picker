import { Component, Inject, OnInit, OnDestroy, ViewChild, ElementRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { ImageCaptureWatermarkConfig } from '../interfaces/image-capture-watermark.type';
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

  currentStream: MediaStream;
  currentDeviceIndex = 0;
  isCapturing = signal(false);
  isSwitching = signal(false);
  showFlash = signal(false);
  captureError = signal<string | null>(null);
  hasMultipleCameras = false;
  private destroyed = false;

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
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopStream();
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
        await this.watermark.paint(canvas, ctx, this.readWatermarkConfig(), capturedAt);
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
