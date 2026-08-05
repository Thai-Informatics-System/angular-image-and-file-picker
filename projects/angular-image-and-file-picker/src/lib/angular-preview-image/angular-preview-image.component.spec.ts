import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularPreviewImageComponent } from './angular-preview-image.component';

describe('AngularPreviewImageComponent', () => {
  let component: AngularPreviewImageComponent;
  let fixture: ComponentFixture<AngularPreviewImageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AngularPreviewImageComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AngularPreviewImageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
