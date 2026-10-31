export type ImageOverlayPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface ImageOverlayStyle {
  /** Canvas pixels. When omitted, the size scales with the image width. */
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  /** 0–1. Multiplies the background fill. */
  backgroundOpacity?: number;
  padding?: number;
  margin?: number;
  borderRadius?: number;
}

export interface ImageCaptureLocationFix {
  latitude: number;
  longitude: number;
  /** Accuracy radius in meters, when the provider supplies it. */
  accuracy?: number;
  /** Provider timestamp in milliseconds since the epoch. */
  timestamp?: number;
}

export interface ImageCaptureLocationRequest {
  highAccuracy: boolean;
  timeout: number;
  maximumAge: number;
}

export type ImageCaptureLocationProviderFn = (
  request: ImageCaptureLocationRequest
) => Promise<ImageCaptureLocationFix>;

export interface ImageCaptureWatermarkConfig {
  /** Master switch. `false` disables every overlay. Omitted means each overlay follows its own flag. */
  enabled?: boolean;

  dateTime?: {
    enabled?: boolean;
    displayMode?: 'date' | 'dateTime';
    dateFormat?: string;
    timeFormat?: string;
    /** Used only when `displayMode` is `dateTime`. Overrides `dateFormat` + `timeFormat`. */
    dateTimeFormat?: string;
    /** IANA time zone such as `Asia/Bangkok`. Omitted uses the browser zone. */
    timezone?: string;
    position?: ImageOverlayPosition;
    style?: ImageOverlayStyle;
  };

  location?: {
    enabled?: boolean;
    displayFormat?: 'multiline' | 'singleline' | 'compact';
    latitudePrecision?: number;
    longitudePrecision?: number;
    position?: ImageOverlayPosition;
    style?: ImageOverlayStyle;
    highAccuracy?: boolean;
    timeout?: number;
    /** Maximum age of a cached browser fix, in milliseconds. `0` refuses a cached fix. */
    maximumAge?: number;
    showAccuracy?: boolean;
    showLocationTimestamp?: boolean;
    failurePolicy?: 'continue' | 'cancel';
  };

  provider?: {
    type?: 'browser' | 'google' | 'custom';
    /** Required for `google`. Sent only to that provider. Never written into the image. */
    apiKey?: string;
    options?: Record<string, unknown>;
    getCurrentPosition?: ImageCaptureLocationProviderFn;
  };
}

export interface ImageCaptureWatermarkContext {
  /** Shutter time. Do not use the later upload time. */
  capturedAt?: Date;
  fileName?: string;
  /** JPEG encoder quality for `apply()`. Ignored for PNG. Defaults to 0.92. */
  quality?: number;
}
