# Capture watermark configuration

Optional overlays for `@servicemind.tis/angular-image-and-file-picker`. A watermark is drawn into the pixels of a photograph taken with the library camera. It is not an HTML label and it is not written only into EXIF.

Gallery selection, drag-and-drop, the camera dialog's Upload button, the `getUserMedia` file-input fallback, and phone uploads are unchanged. They do not request location permission.

No configuration is required. Existing applications keep the previous behavior.

## Installation

```bash
npm install @servicemind.tis/angular-image-and-file-picker
```

The feature uses the browser Canvas, `Intl`, and Geolocation APIs. It does not add a date library or a maps SDK. Peer dependencies are unchanged.

Import the existing module or the standalone symbols from the package entry point:

```ts
import {
  AngularImageAndFilePickerModule,
  ImageCaptureWatermarkConfig,
  ImageCaptureWatermarkService,
} from '@servicemind.tis/angular-image-and-file-picker';
```

## Angular integration

```html
<angular-image-and-file-picker
  [urlConfig]="urlConfig"
  [isEnableCapture]="true"
  [captureWatermarkConfig]="watermarkConfig"
  (onUploaded)="onUploaded($event)"
  (onError)="onError($event)">
</angular-image-and-file-picker>
```

```ts
watermarkConfig: ImageCaptureWatermarkConfig = {
  dateTime: { enabled: true },
  location: { enabled: true },
};
```

`captureWatermarkConfig` is a normal input. Replace the object at any time; the next shutter reads the current value. The library does not mutate the object you pass.

`onUploaded` still emits the file list after the existing upload flow. The JPEG in that flow is the watermarked capture. `onError` still emits `true`. It does so for a capture only when location acquisition fails and `failurePolicy` is `cancel`.

`isEnableCapture` must be true (or file upload disabled) for the camera dialog to open. The watermark does not itself open the camera.

## Defaults

Omitted `captureWatermarkConfig`, or `enabled: false`, disables both overlays and does not call Geolocation.

| Setting | Default |
|---|---|
| `dateTime.enabled` | `false` |
| `dateTime.displayMode` | `dateTime` |
| `dateTime.dateFormat` | `DD-MM-YYYY` |
| `dateTime.timeFormat` | `HH:mm:ss` |
| `dateTime.timezone` | Browser local zone |
| `dateTime.position` | `bottom-left` |
| `location.enabled` | `false` |
| `location.displayFormat` | `multiline` |
| `location.latitudePrecision` / `longitudePrecision` | `4` |
| `location.position` | `bottom-right` |
| `location.highAccuracy` | `true` |
| `location.timeout` | `10000` ms |
| `location.maximumAge` | `0` (a cached fix is not used) |
| `location.showAccuracy` | `false` |
| `location.showLocationTimestamp` | `false` |
| `location.failurePolicy` | `continue` |
| `provider.type` | `browser` |
| Font | `sans-serif`, white `#ffffff` |
| Background | `#000000` at opacity `0.55` |
| Padding / margin / radius | `8` / `16` / `6` |
| Font size when omitted | `max(14, 2.2% of image width)` canvas pixels |

An explicit `style.fontSize` is used as canvas pixels and is reduced only when the line would otherwise run outside the image.

Invalid values fall back or clamp. An unknown position uses that overlay's default. Opacity is clamped to `0–1`. Precision is clamped to `0–8`. An invalid IANA time zone uses the browser zone. The capture still completes unless location `failurePolicy` is `cancel`.

## Date only

The stamp is the shutter time, taken when Capture is pressed, not the later upload time. `displayMode: 'date'` ignores `timeFormat` and `dateTimeFormat`.

```ts
const watermarkConfig: ImageCaptureWatermarkConfig = {
  dateTime: {
    enabled: true,
    displayMode: 'date',
    dateFormat: 'DD MMM YYYY',
    timezone: 'Asia/Bangkok',
    position: 'bottom-left',
  },
};
```

Example result: `31 Oct 2026`.

## Date and time

```ts
const watermarkConfig: ImageCaptureWatermarkConfig = {
  dateTime: {
    enabled: true,
    displayMode: 'dateTime',
    dateTimeFormat: 'DD MMM YYYY, hh:mm A',
    timezone: 'Asia/Bangkok',
    position: 'top-left',
    style: {
      fontSize: 28,
      fontFamily: 'sans-serif',
      color: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.55,
      padding: 8,
      margin: 16,
      borderRadius: 6,
    },
  },
};
```

When `dateTimeFormat` is omitted, the text is `dateFormat` plus a space plus `timeFormat`, for example `31-10-2026 21:49:05`.

Supported tokens:

| Token | Meaning |
|---|---|
| `YYYY`, `YY` | Year |
| `MMMM`, `MMM`, `MM`, `M` | Month name or number. Names are English |
| `DD`, `D` | Day |
| `HH` | Hour, 00–23 |
| `hh` | Hour, 01–12 |
| `mm`, `ss` | Minute, second |
| `A` | `AM` or `PM` |

`timezone` is an IANA name such as `UTC` or `Asia/Bangkok`.

## GPS only

```ts
const watermarkConfig: ImageCaptureWatermarkConfig = {
  location: {
    enabled: true,
    displayFormat: 'multiline',
    latitudePrecision: 4,
    longitudePrecision: 4,
    position: 'bottom-right',
    highAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
    showAccuracy: true,
    showLocationTimestamp: false,
    failurePolicy: 'continue',
  },
};
```

| `displayFormat` | Example |
|---|---|
| `multiline` | `Latitude: 26.8467` / `Longitude: 80.9462` |
| `singleline` | `Lat: 26.8467 \| Long: 80.9462` |
| `compact` | `26.8467, 80.9462` |

`showAccuracy` adds `±12 m`. `showLocationTimestamp` adds the fix time in `DD-MM-YYYY HH:mm:ss`, using `dateTime.timezone` when that field is set.

`0, 0` and coordinates outside `[-90, 90]` / `[-180, 180]` are treated as missing. A real position on the equator or the prime meridian, where only one value is zero, is kept.

## Combined

Date/time and GPS are independent. Each has its own `enabled` flag, position, and style.

```ts
const watermarkConfig: ImageCaptureWatermarkConfig = {
  dateTime: {
    enabled: true,
    displayMode: 'dateTime',
    dateTimeFormat: 'DD-MM-YYYY HH:mm:ss',
    position: 'top-left',
  },
  location: {
    enabled: true,
    displayFormat: 'compact',
    position: 'bottom-right',
  },
};
```

`enabled: false` on the root object turns both off even if a child says `enabled: true`.

If both overlays use the same position, the location block is moved off that edge (upward for a bottom anchor, downward otherwise) with an 8px gap so the lines do not cover each other.

## Positions

`top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center`, `bottom-right`.

The box is kept inside the image. Portrait and landscape frames use the same rules.

## Styling

`ImageOverlayStyle` applies to one overlay:

- `fontSize` — canvas pixels. Omit it to scale with width.
- `fontFamily` — CSS family, default `sans-serif`.
- `color` — text fill, default `#ffffff`.
- `backgroundColor` — default `#000000`.
- `backgroundOpacity` — `0` draws text with no plate. `1` is opaque.
- `padding`, `margin`, `borderRadius` — canvas pixels.

The default plate is the contrast against a bright or dark scene. Set `backgroundOpacity` to `0` only when the text color already contrasts with the photograph.

## Location permission and failure policy

The browser prompts for location only when the location overlay is enabled and the master switch is not off. Date-only watermarks do not prompt.

The camera dialog draws the enabled overlays on the video with a canvas at the capture's pixel size, so the view matches the saved photo. The time updates every second. When `location.enabled` is true, the dialog requests a location as it opens and refreshes it every 5 seconds. The shutter uses the latest fix. When location is off, the dialog does not request one.

With `cancel`, Capture is disabled until a location arrives. If the location is denied or unavailable, the dialog shows the reason and a Try again button. Upload stays available unless `disableFileUpload` is set. A slow refresh keeps the last fix. A denied refresh clears it and disables Capture.

| Situation | `continue` (default) | `cancel` |
|---|---|---|
| Permission denied | Photo is kept, without a location line | Camera stays open, no file is returned |
| Position unavailable | Same | Same |
| Timeout | Same | Same |
| Browser has no Geolocation API | Same | Same |
| Invalid coordinates, including `0, 0` | Same | Same |
| Provider misconfigured | Same | Same |

`cancel` shows the library snackbar and emits `onError`. The date/time line is not a reason to drop the photo when location fails; the whole capture is skipped so a half-labeled image is not uploaded.

`maximumAge: 0` passes `maximumAge: 0` to `getCurrentPosition`, so the browser is not asked for a cached fix. Set a positive number only when an older fix is acceptable. The library does not keep its own coordinate cache.

## Location providers

### Browser

```ts
provider: { type: 'browser' }
```

This is the default. It calls `navigator.geolocation.getCurrentPosition` with `enableHighAccuracy`, `timeout`, and `maximumAge` from the location settings. Geolocation requires a secure context (HTTPS or localhost).

### Google

Used only when `provider.type` is `'google'`. The library POSTs to `https://www.googleapis.com/geolocation/v1/geolocate?key=YOUR_KEY`. It does not call Google Maps and it does not geocode an address.

```ts
provider: {
  type: 'google',
  apiKey: environment.googleGeolocationKey,
  options: {
    body: { considerIp: true },
  },
}
```

The key is whatever the application passes at runtime. Nothing is hardcoded and the key is not written into the image or logged. A browser-visible key can be copied from the page; restrict it by API, referrer, and quota. Do not ship an unrestricted server key. If `apiKey` is missing, the request is not sent and the failure policy applies.

`options.body` is the JSON body. `key` and `apiKey` fields inside that body are dropped.

### Custom

```ts
provider: {
  type: 'custom',
  getCurrentPosition: (request) => this.locationService.locate(request),
}
```

The same function may be placed at `provider.options.getCurrentPosition`. The request is `{ highAccuracy, timeout, maximumAge }`. Return `{ latitude, longitude, accuracy?, timestamp? }`. Throw `ImageCaptureWatermarkError` for a specific code; other failures use the failure policy and a generic message.

`ImageCaptureWatermarkService.apply(file, config, { capturedAt })` runs the same pipeline for a file you already hold. The camera dialog does not use `apply()`, so the live capture is encoded once at JPEG quality `0.9`. `apply()` uses quality `0.92` unless `context.quality` is set, and it keeps PNG as PNG, including transparent pixels. Inactive config returns the original `File` without decoding it.

## Camera and gallery

| Source | Watermark | GPS prompt |
|---|---|---|
| Library camera Capture button | Yes, when enabled | Only if the location overlay is enabled |
| Camera dialog Upload button | No | No |
| File input, drag-and-drop | No | No |
| Upload from phone | No | No |
| `getUserMedia` unavailable, file-input fallback | No | No |

The fallback cannot tell an operating-system camera shot from a gallery pick, so it stays on the existing path.

The live camera frame is already oriented by the browser. `apply()` decodes with `imageOrientation: 'from-image'` when the browser supports it.

## Error handling

Location errors use `ImageCaptureWatermarkError` with `code`:

`permission-denied`, `unavailable`, `timeout`, `unsupported`, `invalid-coordinates`, `provider`, `processing`.

A processing failure while painting redraws the clean frame and still returns the JPEG, with a snackbar. `onError` is not emitted for that case because a photo was produced.

## Backward compatibility

- Selector, existing inputs, and existing outputs are unchanged.
- `CameraCaptureResult` is still `capture`, `upload`, or `cancel`.
- Upload, compression, preview, MIME checks, and gallery selection are unchanged.
- With no watermark input, capture remains a single JPEG at quality `0.9` and Geolocation is not called.

## Publishing note

This behavior ships in `@servicemind.tis/angular-image-and-file-picker@1.1.0`. Do not publish until that release is approved.
