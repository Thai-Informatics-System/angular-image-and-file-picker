import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularFileViewerComponent } from './angular-file-viewer.component';

describe('AngularFileViewerComponent', () => {
  let component: AngularFileViewerComponent;
  let fixture: ComponentFixture<AngularFileViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AngularFileViewerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AngularFileViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
