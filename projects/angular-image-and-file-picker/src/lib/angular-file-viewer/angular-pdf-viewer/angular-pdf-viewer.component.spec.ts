import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularPdfViewerComponent } from './angular-pdf-viewer.component';

describe('AngularPdfViewerComponent', () => {
  let component: AngularPdfViewerComponent;
  let fixture: ComponentFixture<AngularPdfViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AngularPdfViewerComponent]
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
