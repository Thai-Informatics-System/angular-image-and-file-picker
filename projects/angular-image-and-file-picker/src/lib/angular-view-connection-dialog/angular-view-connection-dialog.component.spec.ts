import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AngularViewConnectionDialogComponent } from './angular-view-connection-dialog.component';

describe('AngularViewConnectionDialogComponent', () => {
  let component: AngularViewConnectionDialogComponent;
  let fixture: ComponentFixture<AngularViewConnectionDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AngularViewConnectionDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AngularViewConnectionDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
