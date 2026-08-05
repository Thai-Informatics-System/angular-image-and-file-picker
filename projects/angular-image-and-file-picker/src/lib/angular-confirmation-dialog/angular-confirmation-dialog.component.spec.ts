import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularConfirmationDialogComponent } from './angular-confirmation-dialog.component';

describe('AngularConfirmationDialogComponent', () => {
  let component: AngularConfirmationDialogComponent;
  let fixture: ComponentFixture<AngularConfirmationDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AngularConfirmationDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AngularConfirmationDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
