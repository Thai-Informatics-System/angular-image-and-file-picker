import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularExcelFileViewerComponent } from './angular-excel-file-viewer.component';

describe('AngularExcelFileViewerComponent', () => {
  let component: AngularExcelFileViewerComponent;
  let fixture: ComponentFixture<AngularExcelFileViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AngularExcelFileViewerComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(AngularExcelFileViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
