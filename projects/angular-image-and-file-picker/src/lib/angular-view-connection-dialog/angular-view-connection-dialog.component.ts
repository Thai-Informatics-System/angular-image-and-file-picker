import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AngularRemoteUploadService, DevicesOnlineStatus } from '../services/angular-remote-upload.service';
import { Subject, takeUntil } from 'rxjs';

// MobileConnectionInfo is internal to the service, so we use any for now
// or we could export it from the service
interface MobileConnectionInfo {
  mobileDeviceId: string;
  connectedAt: number;
  lastActivity: number;
}

export interface AngularViewConnectionDialogData {
  title?: string;
}

@Component({
  selector: 'angular-view-connection-dialog',
  standalone: false,
  templateUrl: './angular-view-connection-dialog.component.html',
  styleUrl: './angular-view-connection-dialog.component.css'
})
export class AngularViewConnectionDialogComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  mobileConnection: MobileConnectionInfo | null = null;
  devicesStatus: DevicesOnlineStatus | null = null;
  isCheckingStatus = false;
  disconnecting = false;

  constructor(
    public dialogRef: MatDialogRef<AngularViewConnectionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AngularViewConnectionDialogData,
    private remoteUploadService: AngularRemoteUploadService
  ) {}

  ngOnInit(): void {
    // Subscribe to mobile connection info
    this.remoteUploadService.getMobileConnection()
      .pipe(takeUntil(this.destroy$))
      .subscribe(connection => {
        this.mobileConnection = connection;
        
        // If connection is lost, close dialog
        if (!connection) {
          this.dialogRef.close('disconnected');
        }
      });

    // Subscribe to devices status
    this.remoteUploadService.getDevicesStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        this.devicesStatus = status;
      });

    // Subscribe to checking status
    this.remoteUploadService.getIsCheckingStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe(checking => {
        this.isCheckingStatus = checking;
      });

    // Refresh status on open
    this.refreshStatus();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Refresh device online status
   */
  async refreshStatus(): Promise<void> {
    await this.remoteUploadService.refreshDevicesStatus();
  }

  /**
   * Disconnect from mobile device
   */
  async disconnect(): Promise<void> {
    this.disconnecting = true;
    try {
      await this.remoteUploadService.disconnect();
      this.dialogRef.close('disconnected');
    } catch (error) {
      console.error('Disconnect failed:', error);
      this.disconnecting = false;
    }
  }

  /**
   * Close dialog without disconnecting
   */
  close(): void {
    this.dialogRef.close();
  }

  /**
   * Truncate device ID to show first 8 and last 8 characters
   */
  truncateDeviceId(deviceId: string): string {
    if (!deviceId || deviceId.length <= 20) {
      return deviceId;
    }
    return `${deviceId.substring(0, 8)}...${deviceId.substring(deviceId.length - 8)}`;
  }
}
