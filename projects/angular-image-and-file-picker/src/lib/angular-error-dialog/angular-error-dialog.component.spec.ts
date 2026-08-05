import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularErrorDialogComponent } from './angular-error-dialog.component';

describe('AngularErrorDialogComponent', () => {
  let component: AngularErrorDialogComponent;
  let fixture: ComponentFixture<AngularErrorDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AngularErrorDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AngularErrorDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
