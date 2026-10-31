import type {
  ImageCaptureLocationFix,
  ImageCaptureLocationProviderFn,
  ImageCaptureWatermarkConfig,
  ImageOverlayPosition,
  ImageOverlayStyle,
} from '../interfaces/image-capture-watermark.type';

export const OVERLAY_POSITIONS: readonly ImageOverlayPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/** ponytail: same-position overlays stack off the shared edge. A third overlay needs a real layout pass. */
export const OVERLAY_STACK_GAP = 8;
export const OVERLAY_LINE_HEIGHT_RATIO = 1.3;

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const TOKEN_PATTERN = /YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|hh|mm|ss|A/g;

export interface ResolvedOverlayStyle {
  fontSize?: number;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  padding: number;
  margin: number;
  borderRadius: number;
}

export interface ResolvedImageCaptureWatermarkConfig {
  dateTime: {
    enabled: boolean;
    displayMode: 'date' | 'dateTime';
    dateFormat: string;
    timeFormat: string;
    dateTimeFormat?: string;
    timezone?: string;
    position: ImageOverlayPosition;
    style: ResolvedOverlayStyle;
  };
  location: {
    enabled: boolean;
    displayFormat: 'multiline' | 'singleline' | 'compact';
    latitudePrecision: number;
    longitudePrecision: number;
    position: ImageOverlayPosition;
    style: ResolvedOverlayStyle;
    highAccuracy: boolean;
    timeout: number;
    maximumAge: number;
    showAccuracy: boolean;
    showLocationTimestamp: boolean;
    failurePolicy: 'continue' | 'cancel';
  };
  provider: {
    type: 'browser' | 'google' | 'custom';
    apiKey?: string;
    options: Record<string, unknown>;
    getCurrentPosition?: ImageCaptureLocationProviderFn;
  };
}

export interface OverlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayPlacement {
  position: ImageOverlayPosition;
  width: number;
  height: number;
  margin: number;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function resolveImageCaptureWatermarkConfig(
  input: ImageCaptureWatermarkConfig | null | undefined
): ResolvedImageCaptureWatermarkConfig {
  const source = input ?? {};
  const masterOff = input == null || source.enabled === false;
  const dateTime = source.dateTime;
  const location = source.location;
  const provider = source.provider;
  const options = { ...(provider?.options ?? {}) };
  const directProvider = provider?.getCurrentPosition;
  const optionProvider = options['getCurrentPosition'];

  return {
    dateTime: {
      enabled: !masterOff && dateTime?.enabled === true,
      displayMode: dateTime?.displayMode === 'date' ? 'date' : 'dateTime',
      dateFormat: text(dateTime?.dateFormat, 'DD-MM-YYYY'),
      timeFormat: text(dateTime?.timeFormat, 'HH:mm:ss'),
      dateTimeFormat: textOrUndefined(dateTime?.dateTimeFormat),
      timezone: textOrUndefined(dateTime?.timezone),
      position: position(dateTime?.position, 'bottom-left'),
      style: style(dateTime?.style),
    },
    location: {
      enabled: !masterOff && location?.enabled === true,
      displayFormat: locationFormat(location?.displayFormat),
      latitudePrecision: precision(location?.latitudePrecision),
      longitudePrecision: precision(location?.longitudePrecision),
      position: position(location?.position, 'bottom-right'),
      style: style(location?.style),
      highAccuracy: location?.highAccuracy !== false,
      timeout: positive(location?.timeout, 10000),
      maximumAge: nonNegative(location?.maximumAge, 0),
      showAccuracy: location?.showAccuracy === true,
      showLocationTimestamp: location?.showLocationTimestamp === true,
      failurePolicy: location?.failurePolicy === 'cancel' ? 'cancel' : 'continue',
    },
    provider: {
      type: providerType(provider?.type),
      apiKey: textOrUndefined(provider?.apiKey),
      options,
      getCurrentPosition: typeof directProvider === 'function'
        ? directProvider
        : typeof optionProvider === 'function'
          ? optionProvider as ImageCaptureLocationProviderFn
          : undefined,
    },
  };
}

export function formatCaptureDateTime(
  date: Date,
  options: {
    displayMode: 'date' | 'dateTime';
    dateFormat: string;
    timeFormat: string;
    dateTimeFormat?: string;
    timezone?: string;
  }
): string {
  const pattern = options.displayMode === 'date'
    ? text(options.dateFormat, 'DD-MM-YYYY')
    : text(options.dateTimeFormat, `${text(options.dateFormat, 'DD-MM-YYYY')} ${text(options.timeFormat, 'HH:mm:ss')}`);
  return applyDateTokens(date, pattern, options.timezone);
}

export function formatCaptureLocation(
  fix: ImageCaptureLocationFix,
  options: {
    displayFormat: 'multiline' | 'singleline' | 'compact';
    latitudePrecision: number;
    longitudePrecision: number;
    showAccuracy: boolean;
    showLocationTimestamp: boolean;
    timezone?: string;
  }
): string {
  const latitude = fix.latitude.toFixed(options.latitudePrecision);
  const longitude = fix.longitude.toFixed(options.longitudePrecision);
  let textValue: string;
  if (options.displayFormat === 'singleline') {
    textValue = `Lat: ${latitude} | Long: ${longitude}`;
  } else if (options.displayFormat === 'compact') {
    textValue = `${latitude}, ${longitude}`;
  } else {
    textValue = `Latitude: ${latitude}\nLongitude: ${longitude}`;
  }

  if (options.showAccuracy && typeof fix.accuracy === 'number' && Number.isFinite(fix.accuracy)) {
    const accuracy = `±${Math.round(fix.accuracy)} m`;
    textValue = options.displayFormat === 'multiline'
      ? `${textValue}\nAccuracy: ${accuracy}`
      : `${textValue} (${accuracy})`;
  }

  if (options.showLocationTimestamp && typeof fix.timestamp === 'number' && Number.isFinite(fix.timestamp)) {
    const stamp = applyDateTokens(new Date(fix.timestamp), 'DD-MM-YYYY HH:mm:ss', options.timezone);
    textValue = options.displayFormat === 'multiline' ? `${textValue}\n${stamp}` : `${textValue} ${stamp}`;
  }

  return textValue;
}

export function isValidCaptureCoordinate(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return false;
  }
  return !(latitude === 0 && longitude === 0);
}

export function measureOverlayBlock(
  lines: string[],
  fontSize: number,
  padding: number,
  measureWidth: (line: string, fontSize: number) => number
): { width: number; height: number; lineHeight: number } {
  const lineHeight = Math.ceil(fontSize * OVERLAY_LINE_HEIGHT_RATIO);
  const textWidth = lines.reduce((max, line) => Math.max(max, measureWidth(line, fontSize)), 0);
  return {
    width: Math.ceil(textWidth + padding * 2),
    height: Math.ceil(lines.length * lineHeight + padding * 2),
    lineHeight,
  };
}

export function placeOverlay(
  overlayPosition: ImageOverlayPosition,
  canvasWidth: number,
  canvasHeight: number,
  boxWidth: number,
  boxHeight: number,
  margin: number
): OverlayBox {
  const width = Math.min(Math.max(0, boxWidth), Math.max(0, canvasWidth));
  const height = Math.min(Math.max(0, boxHeight), Math.max(0, canvasHeight));
  const safeMarginX = Math.min(Math.max(0, margin), Math.max(0, canvasWidth - width));
  const safeMarginY = Math.min(Math.max(0, margin), Math.max(0, canvasHeight - height));

  let x = safeMarginX;
  if (overlayPosition.endsWith('right')) {
    x = canvasWidth - safeMarginX - width;
  } else if (!overlayPosition.endsWith('left')) {
    x = (canvasWidth - width) / 2;
  }

  let y = safeMarginY;
  if (overlayPosition.startsWith('bottom')) {
    y = canvasHeight - safeMarginY - height;
  } else if (!overlayPosition.startsWith('top')) {
    y = (canvasHeight - height) / 2;
  }

  return {
    x: clamp(x, 0, Math.max(0, canvasWidth - width)),
    y: clamp(y, 0, Math.max(0, canvasHeight - height)),
    width,
    height,
  };
}

export function placeCaptureOverlays(
  canvasWidth: number,
  canvasHeight: number,
  date: OverlayPlacement | null,
  location: OverlayPlacement | null
): { date: OverlayBox | null; location: OverlayBox | null } {
  const dateBox = date
    ? placeOverlay(date.position, canvasWidth, canvasHeight, date.width, date.height, date.margin)
    : null;
  let locationBox = location
    ? placeOverlay(location.position, canvasWidth, canvasHeight, location.width, location.height, location.margin)
    : null;

  if (dateBox && locationBox && location && overlaps(dateBox, locationBox, OVERLAY_STACK_GAP)) {
    locationBox = separateOverlay(location.position, dateBox, locationBox, canvasWidth, canvasHeight);
  }

  return { date: dateBox, location: locationBox };
}

export async function decodeCapturedImage(image: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(image, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(image);
  }
}

export function defaultOverlayFontSize(canvasWidth: number): number {
  return Math.max(14, Math.round(canvasWidth * 0.022));
}

function separateOverlay(
  overlayPosition: ImageOverlayPosition,
  first: OverlayBox,
  second: OverlayBox,
  canvasWidth: number,
  canvasHeight: number
): OverlayBox {
  const next: OverlayBox = { ...second };
  next.y = overlayPosition.startsWith('bottom')
    ? first.y - OVERLAY_STACK_GAP - second.height
    : first.y + first.height + OVERLAY_STACK_GAP;
  next.y = clamp(next.y, 0, Math.max(0, canvasHeight - second.height));

  if (overlaps(first, next, 0)) {
    const toRight = first.x + first.width + OVERLAY_STACK_GAP;
    next.x = toRight + next.width <= canvasWidth
      ? toRight
      : Math.max(0, first.x - OVERLAY_STACK_GAP - next.width);
    next.x = clamp(next.x, 0, Math.max(0, canvasWidth - next.width));
  }

  return next;
}

function overlaps(a: OverlayBox, b: OverlayBox, gap: number): boolean {
  return a.x < b.x + b.width + gap
    && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap
    && a.y + a.height + gap > b.y;
}

function applyDateTokens(date: Date, pattern: string, timeZone?: string): string {
  const parts = zonedParts(date, timeZone);
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  const tokens: Record<string, string> = {
    YYYY: String(parts.year).padStart(4, '0'),
    YY: String(parts.year).slice(-2),
    MMMM: LONG_MONTHS[parts.month - 1] ?? '',
    MMM: SHORT_MONTHS[parts.month - 1] ?? '',
    MM: String(parts.month).padStart(2, '0'),
    M: String(parts.month),
    DD: String(parts.day).padStart(2, '0'),
    D: String(parts.day),
    HH: String(parts.hour).padStart(2, '0'),
    hh: String(hour12).padStart(2, '0'),
    mm: String(parts.minute).padStart(2, '0'),
    ss: String(parts.second).padStart(2, '0'),
    A: parts.hour < 12 ? 'AM' : 'PM',
  };
  return pattern.replace(TOKEN_PATTERN, (token) => tokens[token] ?? token);
}

function zonedParts(date: Date, timeZone?: string): ZonedParts {
  return readZonedParts(date, timeZone) ?? readZonedParts(date) ?? {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

function readZonedParts(date: Date, timeZone?: string): ZonedParts | null {
  try {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    };
    if (timeZone) {
      options.timeZone = timeZone;
    }
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const year = value('year');
    const month = value('month');
    const day = value('day');
    let hour = value('hour');
    const minute = value('minute');
    const second = value('second');
    if ([year, month, day, hour, minute, second].some((part) => !Number.isFinite(part))) {
      return null;
    }
    if (hour === 24) {
      hour = 0;
    }
    return { year, month, day, hour, minute, second };
  } catch {
    return null;
  }
}

function style(value: ImageOverlayStyle | undefined): ResolvedOverlayStyle {
  return {
    fontSize: typeof value?.fontSize === 'number' && Number.isFinite(value.fontSize) && value.fontSize > 0
      ? value.fontSize
      : undefined,
    fontFamily: safeFontFamily(value?.fontFamily),
    color: text(value?.color, '#ffffff'),
    backgroundColor: text(value?.backgroundColor, '#000000'),
    backgroundOpacity: clamp(typeof value?.backgroundOpacity === 'number' ? value.backgroundOpacity : 0.55, 0, 1),
    padding: nonNegative(value?.padding, 8),
    margin: nonNegative(value?.margin, 16),
    borderRadius: nonNegative(value?.borderRadius, 6),
  };
}

function safeFontFamily(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 80 || /["';{}]/.test(trimmed)) {
    return 'sans-serif';
  }
  return trimmed;
}

function position(value: unknown, fallback: ImageOverlayPosition): ImageOverlayPosition {
  return OVERLAY_POSITIONS.includes(value as ImageOverlayPosition) ? value as ImageOverlayPosition : fallback;
}

function locationFormat(value: unknown): 'multiline' | 'singleline' | 'compact' {
  if (value === 'singleline' || value === 'compact' || value === 'multiline') {
    return value;
  }
  return 'multiline';
}

function providerType(value: unknown): 'browser' | 'google' | 'custom' {
  if (value === 'google' || value === 'custom' || value === 'browser') {
    return value;
  }
  return 'browser';
}

function precision(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 4;
  }
  return clamp(Math.floor(value), 0, 8);
}

function positive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return value;
}

function nonNegative(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function text(value: string | undefined, fallback: string): string {
  return value?.trim() ? value : fallback;
}

function textOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
