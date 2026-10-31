import type { ImageOverlayPosition } from '../interfaces/image-capture-watermark.type';
import {
  decodeCapturedImage,
  formatCaptureDateTime,
  formatCaptureLocation,
  isValidCaptureCoordinate,
  placeCaptureOverlays,
  placeOverlay,
  resolveImageCaptureWatermarkConfig,
} from './image-capture-watermark.logic';

const UTC = '2026-10-31T14:05:06Z';

describe('image capture watermark formatting', () => {
  const capturedAt = new Date(UTC);

  it('formats date only and omits the time', () => {
    const text = formatCaptureDateTime(capturedAt, {
      displayMode: 'date',
      dateFormat: 'DD-MM-YYYY',
      timeFormat: 'HH:mm:ss',
      dateTimeFormat: 'DD-MM-YYYY HH:mm:ss',
      timezone: 'UTC',
    });
    expect(text).toBe('31-10-2026');
    expect(text).not.toContain(':');
  });

  it('formats the supported date patterns in UTC', () => {
    const format = (dateFormat: string) => formatCaptureDateTime(capturedAt, {
      displayMode: 'date',
      dateFormat,
      timeFormat: 'HH:mm:ss',
      timezone: 'UTC',
    });
    expect(format('DD-MM-YYYY')).toBe('31-10-2026');
    expect(format('DD/MM/YYYY')).toBe('31/10/2026');
    expect(format('MM-DD-YYYY')).toBe('10-31-2026');
    expect(format('YYYY-MM-DD')).toBe('2026-10-31');
    expect(format('DD MMM YYYY')).toBe('31 Oct 2026');
  });

  it('formats a combined date and time pattern', () => {
    expect(formatCaptureDateTime(capturedAt, {
      displayMode: 'dateTime',
      dateFormat: 'DD-MM-YYYY',
      timeFormat: 'HH:mm:ss',
      timezone: 'UTC',
    })).toBe('31-10-2026 14:05:06');

    expect(formatCaptureDateTime(capturedAt, {
      displayMode: 'dateTime',
      dateFormat: 'DD-MM-YYYY',
      timeFormat: 'HH:mm:ss',
      dateTimeFormat: 'DD MMM YYYY, hh:mm A',
      timezone: 'UTC',
    })).toBe('31 Oct 2026, 02:05 PM');
  });

  it('uses a custom time format and a 12-hour clock', () => {
    expect(formatCaptureDateTime(new Date('2026-10-31T00:05:00Z'), {
      displayMode: 'dateTime',
      dateFormat: 'YYYY-MM-DD',
      timeFormat: 'hh:mm A',
      timezone: 'UTC',
    })).toBe('2026-10-31 12:05 AM');
  });

  it('shifts the capture time into the configured time zone', () => {
    expect(formatCaptureDateTime(new Date('2026-10-31T02:49:05Z'), {
      displayMode: 'dateTime',
      dateFormat: 'DD-MM-YYYY',
      timeFormat: 'HH:mm:ss',
      timezone: 'Asia/Bangkok',
    })).toBe('31-10-2026 09:49:05');

    expect(formatCaptureDateTime(new Date('2026-10-31T02:49:05Z'), {
      displayMode: 'dateTime',
      dateFormat: 'DD-MM-YYYY',
      timeFormat: 'HH:mm:ss',
      dateTimeFormat: 'DD MMM YYYY, hh:mm A',
      timezone: 'America/New_York',
    })).toBe('30 Oct 2026, 10:49 PM');
  });

  it('uses the browser zone when no time zone is supplied', () => {
    const date = new Date('2026-01-15T00:30:00Z');
    const expected = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-') + ` ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

    expect(formatCaptureDateTime(date, {
      displayMode: 'dateTime',
      dateFormat: 'YYYY-MM-DD',
      timeFormat: 'HH:mm',
    })).toBe(expected);
  });

  it('falls back to the browser zone for an invalid time zone', () => {
    const date = new Date('2026-01-15T00:30:00Z');
    const local = formatCaptureDateTime(date, {
      displayMode: 'dateTime',
      dateFormat: 'YYYY-MM-DD',
      timeFormat: 'HH:mm',
    });
    expect(formatCaptureDateTime(date, {
      displayMode: 'dateTime',
      dateFormat: 'YYYY-MM-DD',
      timeFormat: 'HH:mm',
      timezone: 'Not/AZone',
    })).toBe(local);
  });

  it('formats every coordinate layout and the default precision', () => {
    const fix = { latitude: 26.8467123, longitude: 80.9462123, accuracy: 12.4, timestamp: Date.parse('2026-10-31T02:49:05Z') };
    expect(formatCaptureLocation(fix, {
      displayFormat: 'multiline',
      latitudePrecision: 4,
      longitudePrecision: 4,
      showAccuracy: false,
      showLocationTimestamp: false,
    })).toBe('Latitude: 26.8467\nLongitude: 80.9462');
    expect(formatCaptureLocation(fix, {
      displayFormat: 'singleline',
      latitudePrecision: 4,
      longitudePrecision: 4,
      showAccuracy: false,
      showLocationTimestamp: false,
    })).toBe('Lat: 26.8467 | Long: 80.9462');
    expect(formatCaptureLocation(fix, {
      displayFormat: 'compact',
      latitudePrecision: 2,
      longitudePrecision: 2,
      showAccuracy: false,
      showLocationTimestamp: false,
    })).toBe('26.85, 80.95');
  });

  it('appends accuracy and the location timestamp', () => {
    const text = formatCaptureLocation({
      latitude: 26.8467,
      longitude: 80.9462,
      accuracy: 12.4,
      timestamp: Date.parse('2026-10-31T02:49:05Z'),
    }, {
      displayFormat: 'multiline',
      latitudePrecision: 4,
      longitudePrecision: 4,
      showAccuracy: true,
      showLocationTimestamp: true,
      timezone: 'UTC',
    });
    expect(text).toBe('Latitude: 26.8467\nLongitude: 80.9462\nAccuracy: ±12 m\n31-10-2026 02:49:05');
  });

  it('rejects null-island, out-of-range, and non-finite coordinates', () => {
    expect(isValidCaptureCoordinate(0, 0)).toBeFalse();
    expect(isValidCaptureCoordinate(0, 80.9462)).toBeTrue();
    expect(isValidCaptureCoordinate(26.8467, 0)).toBeTrue();
    expect(isValidCaptureCoordinate(90, 180)).toBeTrue();
    expect(isValidCaptureCoordinate(-90, -180)).toBeTrue();
    expect(isValidCaptureCoordinate(90.0001, 0)).toBeFalse();
    expect(isValidCaptureCoordinate(10, 180.0001)).toBeFalse();
    expect(isValidCaptureCoordinate(Number.NaN, 1)).toBeFalse();
    expect(isValidCaptureCoordinate(1, Number.POSITIVE_INFINITY)).toBeFalse();
  });
});

describe('image capture watermark configuration', () => {
  it('stays inactive and does not mutate a missing or partial config', () => {
    const input = {
      dateTime: { enabled: true, style: { color: '#fff' } },
      provider: { options: { body: { considerIp: true } } },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const resolved = resolveImageCaptureWatermarkConfig(input);

    expect(input).toEqual(snapshot);
    expect(resolved.dateTime.enabled).toBeTrue();
    expect(resolved.location.enabled).toBeFalse();
    expect(resolved.dateTime.style.color).toBe('#fff');
    expect(resolved.dateTime.position).toBe('bottom-left');
    expect(resolved.location.position).toBe('bottom-right');
    expect(resolved.location.latitudePrecision).toBe(4);
    expect(resolved.location.longitudePrecision).toBe(4);
    expect(resolved.location.maximumAge).toBe(0);
    expect(resolved.location.timeout).toBe(10000);
    expect(resolved.location.highAccuracy).toBeTrue();
    expect(resolved.location.failurePolicy).toBe('continue');
    expect(resolved.provider.type).toBe('browser');
    expect(resolveImageCaptureWatermarkConfig(undefined).dateTime.enabled).toBeFalse();
    expect(resolveImageCaptureWatermarkConfig(null).location.enabled).toBeFalse();
  });

  it('lets the master switch disable both overlays', () => {
    const resolved = resolveImageCaptureWatermarkConfig({
      enabled: false,
      dateTime: { enabled: true },
      location: { enabled: true },
    });
    expect(resolved.dateTime.enabled).toBeFalse();
    expect(resolved.location.enabled).toBeFalse();
  });

  it('clamps invalid style, precision, and enum values', () => {
    const resolved = resolveImageCaptureWatermarkConfig({
      dateTime: {
        enabled: true,
        displayMode: 'nope' as 'date',
        position: 'middle' as 'center',
        dateFormat: '   ',
        style: { backgroundOpacity: 5, fontSize: -4, padding: -2, fontFamily: 'bad";font' },
      },
      location: {
        enabled: true,
        displayFormat: 'grid' as 'compact',
        latitudePrecision: 12.9,
        longitudePrecision: -1,
        failurePolicy: 'ignore' as 'continue',
        timeout: 0,
      },
    });
    expect(resolved.dateTime.displayMode).toBe('dateTime');
    expect(resolved.dateTime.position).toBe('bottom-left');
    expect(resolved.dateTime.dateFormat).toBe('DD-MM-YYYY');
    expect(resolved.dateTime.style.backgroundOpacity).toBe(1);
    expect(resolved.dateTime.style.fontSize).toBeUndefined();
    expect(resolved.dateTime.style.padding).toBe(0);
    expect(resolved.dateTime.style.fontFamily).toBe('sans-serif');
    expect(resolved.location.displayFormat).toBe('multiline');
    expect(resolved.location.latitudePrecision).toBe(8);
    expect(resolved.location.longitudePrecision).toBe(0);
    expect(resolved.location.failurePolicy).toBe('continue');
    expect(resolved.location.timeout).toBe(10000);
  });
});

describe('image capture watermark placement', () => {
  const positions: ImageOverlayPosition[] = [
    'top-left', 'top-center', 'top-right',
    'center-left', 'center', 'center-right',
    'bottom-left', 'bottom-center', 'bottom-right',
  ];
  const expected: Record<ImageOverlayPosition, { x: number; y: number }> = {
    'top-left': { x: 10, y: 10 },
    'top-center': { x: 450, y: 10 },
    'top-right': { x: 890, y: 10 },
    'center-left': { x: 10, y: 230 },
    'center': { x: 450, y: 230 },
    'center-right': { x: 890, y: 230 },
    'bottom-left': { x: 10, y: 450 },
    'bottom-center': { x: 450, y: 450 },
    'bottom-right': { x: 890, y: 450 },
  };

  positions.forEach((position) => {
    it(`places a single overlay at ${position}`, () => {
      const box = placeOverlay(position, 1000, 500, 100, 40, 10);
      expect(box.x).toBe(expected[position].x);
      expect(box.y).toBe(expected[position].y);
      expect(box.width).toBe(100);
      expect(box.height).toBe(40);
    });
  });

  it('keeps independent positions when the overlays do not collide', () => {
    const placed = placeCaptureOverlays(
      1000,
      500,
      { position: 'top-left', width: 100, height: 40, margin: 10 },
      { position: 'bottom-right', width: 80, height: 30, margin: 10 }
    );
    expect(placed.date).toEqual({ x: 10, y: 10, width: 100, height: 40 });
    expect(placed.location).toEqual({ x: 910, y: 460, width: 80, height: 30 });
  });

  it('stacks a shared bottom anchor upward and a shared top anchor downward', () => {
    const bottom = placeCaptureOverlays(
      1000,
      500,
      { position: 'bottom-left', width: 100, height: 40, margin: 10 },
      { position: 'bottom-left', width: 80, height: 30, margin: 10 }
    );
    expect(bottom.date?.y).toBe(450);
    expect(bottom.location).toEqual({ x: 10, y: 412, width: 80, height: 30 });

    const top = placeCaptureOverlays(
      1000,
      500,
      { position: 'top-right', width: 100, height: 40, margin: 10 },
      { position: 'top-right', width: 80, height: 30, margin: 10 }
    );
    expect(top.date?.y).toBe(10);
    expect(top.location?.y).toBe(58);
  });

  it('keeps a portrait frame and a landscape frame inside the canvas', () => {
    const portrait = placeOverlay('bottom-right', 480, 800, 200, 60, 16);
    const landscape = placeOverlay('bottom-right', 800, 480, 200, 60, 16);
    expect(portrait.x + portrait.width).toBeLessThanOrEqual(480);
    expect(portrait.y + portrait.height).toBeLessThanOrEqual(800);
    expect(landscape.x + landscape.width).toBeLessThanOrEqual(800);
    expect(landscape.y + landscape.height).toBeLessThanOrEqual(480);
  });
});

describe('decodeCapturedImage', () => {
  it('requests EXIF orientation and retries without options when that fails', async () => {
    const calls: unknown[][] = [];
    const bitmap = { width: 2, height: 4, close() {} } as ImageBitmap;
    spyOn(window, 'createImageBitmap').and.callFake(((...args: unknown[]) => {
      calls.push(args);
      if (args.length > 1) {
        return Promise.reject(new Error('options unsupported'));
      }
      return Promise.resolve(bitmap);
    }) as typeof createImageBitmap);

    const image = new Blob(['img'], { type: 'image/jpeg' });
    await expectAsync(decodeCapturedImage(image)).toBeResolvedTo(bitmap);
    expect(calls[0][1]).toEqual({ imageOrientation: 'from-image' });
    expect(calls[1].length).toBe(1);
  });
});
