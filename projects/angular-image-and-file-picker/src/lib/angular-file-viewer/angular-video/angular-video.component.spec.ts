import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularVideoComponent } from './angular-video.component';

describe('AngularVideoComponent', () => {
  let component: AngularVideoComponent;
  let fixture: ComponentFixture<AngularVideoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AngularVideoComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AngularVideoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
