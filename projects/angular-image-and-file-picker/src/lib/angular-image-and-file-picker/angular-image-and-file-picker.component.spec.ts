import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularImageAndFilePickerComponent } from './angular-image-and-file-picker.component';

describe('AngularImageAndFilePickerComponent', () => {
  let component: AngularImageAndFilePickerComponent;
  let fixture: ComponentFixture<AngularImageAndFilePickerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AngularImageAndFilePickerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AngularImageAndFilePickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
