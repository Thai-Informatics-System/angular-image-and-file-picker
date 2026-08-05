import { TestBed } from '@angular/core/testing';

import { AngularImageAndFilePickerService } from './angular-image-and-file-picker.service';

describe('AngularImageAndFilePickerService', () => {
  let service: AngularImageAndFilePickerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AngularImageAndFilePickerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
