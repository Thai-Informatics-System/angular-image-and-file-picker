import { ComponentFixture, TestBed } from '@angular/core/testing';
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
});
