# Image capture watermark analysis

Analysis of `@servicemind.tis/angular-image-and-file-picker` before adding optional date/time and GPS overlays. The overlays are burned into newly captured photographs. Existing consumers that do not pass configuration keep the current behavior.

## 1. Library architecture

The repository is an Angular 19 workspace.

| Item | Value |
|---|---|
| Package | `@servicemind.tis/angular-image-and-file-picker` |
| Published version before this change | `1.0.4` |
| Angular / CDK / Material | `^19.2` |
| TypeScript | `~5.7.2` |
| RxJS | `~7.8.0` |
| Packager | ng-packagr `^19.2.0` |
| Library entry | `projects/angular-image-and-file-picker/src/public-api.ts` |
| Package manifest | `projects/angular-image-and-file-picker/package.json` |
| ng-packagr config | `projects/angular-image-and-file-picker/ng-package.json` |
| Production build | `npm run build-library` (`ng build angular-image-and-file-picker --configuration=production`) |
| Library tests | `ng test angular-image-and-file-picker` (Karma + Jasmine) |
| Lint script | None |

`ng-package.json` allows only `browser-image-compression` as a non-peer dependency. Date formatting and geolocation stay on platform APIs (`Intl`, Canvas, `navigator.geolocation`) so no dependency is added.

The public component is `<angular-image-and-file-picker>` (`AngularImageAndFilePickerComponent`), declared by `AngularImageAndFilePickerModule`. The camera UI is the standalone `AngularCameraCaptureDialogComponent`, opened with `MatDialog`. Upload, compression, MIME checks, and preview live on the picker and `AngularHelperService`.

There is no existing watermark, EXIF parser, or geolocation code.

## 2. Existing camera capture flow

1. A click calls `onPickerClick()`. For `type === 'image'` and (`isEnableCapture` or `disableFileUpload`) it calls `openCameraCapture()`.
2. When `options.useAdvancedCamera` is true (the default) and `navigator.mediaDevices.getUserMedia` exists, `openCameraDialog()` enumerates video inputs and opens a rear-facing stream (`facingMode: 'environment'`, ideal 1920×1080, or 720×480 on a handset).
3. Permission and device failures use `AngularHelperService.showErrorMsg`. Unless the picker is camera-only (`disableFileUpload`), failure falls back to the hidden file input.
4. `showCameraModal()` opens `AngularCameraCaptureDialogComponent` with the live stream.
5. `capturePhoto()` waits 300ms for the flash, sizes a hidden canvas to `video.videoWidth` / `video.videoHeight`, draws the current frame with `drawImage`, and encodes `image/jpeg` at quality `0.9`.
6. The dialog closes with `{ action: 'capture', file }`. The file name is `camera-capture-<timestamp>.jpg`.
7. The picker builds a synthetic change event and calls `detectImages()`, the same method used for gallery selection.
8. `processImage()` copies the bytes (iOS Safari safety), optionally compresses with `browser-image-compression`, requests a pre-signed URL, previews a data URL, and `PUT`s the bytes.

Video frames are already oriented by the browser. The canvas path does not read EXIF.

## 3. Existing gallery selection flow

The hidden input is:

```html
<input type="file" (change)="type == 'file' ? detectFiles($event) : detectImages($event)" />
```

It has no `capture` attribute. Gallery selection, the camera dialog's Upload button, drag-and-drop (`onUploadDrop`), and the getUserMedia fallback all reach `detectImages()` or `detectFiles()` with the user's original file. Remote phone uploads update `filesArray` directly and do not pass through the camera canvas.

Those paths must not gain a watermark or a geolocation prompt.

## 4. Image processing implementation

| Concern | Where it happens |
|---|---|
| Capture encode | Camera dialog canvas, JPEG quality `0.9`, full video frame size |
| Byte snapshot | `processImage()` via `file.arrayBuffer()` before any upload |
| Compression | `AngularHelperService.compressFile()` only when `options.isCompressed` is true. Iterative quality, no resize (`maxWidthOrHeight` unset), 4MB ceiling |
| Preview | Data URL of the snapshotted file, then the S3 `resourceUrl` after PUT |
| MIME | Extension map plus the file's `type`. Camera output is always `image/jpeg` |
| EXIF orientation | Not implemented. `preserveExif: true` is only a compression option |
| Object URLs | Not used on the capture path |

The safe insertion point is the camera canvas **after** `drawImage` and **before** the single `toBlob`. Drawing there burns the overlay into the JPEG that `detectImages()` already uploads and previews. A second encode is avoided. Gallery bytes never hit that canvas.

## 5. Relevant source files

- `projects/angular-image-and-file-picker/src/public-api.ts`
- `projects/angular-image-and-file-picker/src/lib/angular-image-and-file-picker/angular-image-and-file-picker.component.ts`
- `projects/angular-image-and-file-picker/src/lib/angular-image-and-file-picker/angular-image-and-file-picker.component.html`
- `projects/angular-image-and-file-picker/src/lib/angular-camera-capture-dialog/angular-camera-capture-dialog.component.ts`
- `projects/angular-image-and-file-picker/src/lib/services/angular-helper.service.ts`
- `projects/angular-image-and-file-picker/src/lib/interfaces/config.type.ts`
- `projects/angular-image-and-file-picker/src/lib/interfaces/file-viewer-file-type.type.ts`
- `projects/angular-image-and-file-picker/package.json`
- `angular.json` (library project `angular-image-and-file-picker`)

## 6. Existing public APIs

Preserved as-is:

- Selector `angular-image-and-file-picker`.
- Required input `urlConfig`. Optional inputs include `isEnableCapture`, `disableFileUpload`, `options` (`OptionConfig`, including `useAdvancedCamera` and `isCompressed`), `accept`, `type`, and `remoteUploadConfig`.
- Outputs: `onFileSelect` (selection mode click, not the upload payload), `uploadInProgress`, `onUploaded`, `onFileRemoved`, `onError` (emits `true`), `onRemoteUpload`, `dataSequenceChange`.
- Dialog contracts: `CameraCaptureDialogData`, `CameraCaptureResult` (`capture` | `upload` | `cancel`).
- `AngularHelperService` upload and compression methods.

`onUploaded` is the event that carries the uploaded file list. The watermarked JPEG enters that pipeline as the captured `File`. No output payload changes.

## 7. Proposed configuration API

New optional input on the picker: `captureWatermarkConfig`.

`null` / omitted means the feature is off. `enabled: false` forces both overlays off. Each overlay still requires its own `enabled: true`, so date/time and GPS are independent. All fields are optional. Resolved values are copied; the consumer's object is not mutated. The dialog reads a getter at shutter time, so a later input binding applies without a rebuild.

The TypeScript shape matches the requested `ImageCaptureWatermarkConfig`, plus an optional `provider.getCurrentPosition` callback for a custom provider.

## 8. Proposed watermark service architecture

`ImageCaptureWatermarkService` (`providedIn: 'root'`):

1. `prepare` resolves config, records the caller-supplied capture time, and acquires GPS when that overlay is enabled.
2. `paint` draws on the canvas the camera already used for the frame.
3. `apply` is the programmatic path: GPS, then decode, then one encode. Inactive config returns the original `File` without decoding.

Pure formatting and placement live in `image-capture-watermark.logic.ts` and are not a second public entry. Date tokens are applied with `Intl.DateTimeFormat` (IANA time zone, English month names). Moment and date-fns are not added.

Default placement: date/time bottom-left, GPS bottom-right. The same anchor stacks the location block away from that edge with an 8px gap.

## 9. GPS acquisition approach

- Default provider `browser`: `navigator.geolocation.getCurrentPosition`.
- `google`: POST `https://www.googleapis.com/geolocation/v1/geolocate?key=...` only when the consumer supplies `provider.apiKey`. The key is not logged and is not written into the photo.
- `custom`: `provider.getCurrentPosition` or `provider.options.getCurrentPosition`.
- No request is made when the location overlay is off or the master switch is off.
- `maximumAge` defaults to `0` (no cached fix unless the consumer allows one).
- Coordinates must be finite and inside range. Exactly `0, 0` is rejected.
- `failurePolicy: 'continue'` (default) exports the photo without a location line. `cancel` leaves the camera open, shows the existing snackbar, emits `onError`, and does not return a file.

## 10. Browser compatibility

| API | Requirement |
|---|---|
| Camera | Secure context and `getUserMedia` (already required) |
| Geolocation | Secure context. Permission is requested only when the location overlay is enabled |
| Canvas text | Widely available. `roundRect` is used when present; otherwise a plain rectangle |
| Time zone | `Intl` IANA zones. An invalid zone falls back to the browser zone |
| `createImageBitmap` orientation | `imageOrientation: 'from-image'` on the programmatic `apply()` path, with a retry without options. The live camera path does not use EXIF |

The file-input fallback cannot tell a camera shot from a gallery pick, so it is not watermarked.

## 11. Backward compatibility risks

| Risk | Mitigation |
|---|---|
| New required input or changed selector | Input is optional and defaults to `null` |
| Watermark on gallery, drop, or phone uploads | Only `capturePhoto()` calls `paint` |
| Extra geolocation prompt | `acquireLocation` returns immediately when the overlay is off |
| Second JPEG encode | Overlays are drawn before the existing quality `0.9` `toBlob` |
| Compression change | `processImage()` is unchanged; it compresses the already watermarked file only when `isCompressed` is set |
| Dialog result union | Still `capture` \| `upload` \| `cancel`. New `CameraCaptureDialogData` fields are optional |
| `onError` payload | Still emits `true`, and only when a cancel-policy location failure aborts the capture |

No breaking change was found, so implementation proceeds.

## 12. Testing strategy

Karma + Jasmine, library project only. Extend the camera and picker specs; do not delete existing tests.

- Pure tests for formats, time zones, precision, nine positions, same-position stacking, invalid config, and object immutability.
- Service tests with a fake geolocation, a fake `fetch`, and a canvas `fillText` spy.
- Dialog tests: shutter JPEG quality stays `0.9`; GPS is not requested when disabled; cancel policy does not close with a file; continue policy does.
- Picker tests: dialog data getter tracks input changes; gallery `detectImages` does not paint and still calls `compressFile`.

## 13. Files expected to change

Created:

- `docs/image-capture-watermark-analysis.md`
- `docs/image-capture-watermark-configuration.md`
- `projects/angular-image-and-file-picker/src/lib/interfaces/image-capture-watermark.type.ts`
- `projects/angular-image-and-file-picker/src/lib/services/image-capture-watermark.logic.ts`
- `projects/angular-image-and-file-picker/src/lib/services/image-capture-watermark.logic.spec.ts`
- `projects/angular-image-and-file-picker/src/lib/services/image-capture-watermark.service.ts`
- `projects/angular-image-and-file-picker/src/lib/services/image-capture-watermark.service.spec.ts`

Modified:

- Camera dialog component, template, stylesheet, and spec
- Picker component and spec
- `interfaces/index.ts`
- `public-api.ts`
- Library `package.json` version `1.0.4` → `1.1.0`
- Root and package READMEs

Not modified: the ServiceMind consuming application, compression, gallery input, upload HTTP contract, and unrelated libraries.
