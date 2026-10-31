import { TestBed } from '@angular/core/testing';
import type { ImageCaptureWatermarkConfig, ImageOverlayPosition } from '../interfaces/image-capture-watermark.type';
import { measureOverlayBlock, placeCaptureOverlays, placeOverlay } from './image-capture-watermark.logic';
import { ImageCaptureWatermarkError, ImageCaptureWatermarkService } from './image-capture-watermark.service';

describe('ImageCaptureWatermarkService', () => {
  let service: ImageCaptureWatermarkService;
  let geolocation: { getCurrentPosition: jasmine.Spy };
  let restoreGeolocation: () => void;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ImageCaptureWatermarkService);
    geolocation = {
      getCurrentPosition: jasmine.createSpy('getCurrentPosition').and.callFake((success: PositionCallback) => {
        success(position(26.8467, 80.9462, 12));
      }),
    };
    restoreGeolocation = installGeolocation(geolocation);
  });

  afterEach(() => {
    restoreGeolocation();
  });

  it('does not request location or decode an image when watermarking is off', async () => {
    const fetchSpy = spyOn(window, 'fetch');
    const decodeSpy = spyOn(window, 'createImageBitmap');
    const original = new File([new Uint8Array([1, 2, 3])], 'gallery.png', { type: 'image/png' });

    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 20;
    const ctx = canvas.getContext('2d')!;
    const fillText = spyOn(ctx, 'fillText');

    await service.paint(canvas, ctx, null, new Date());
    await service.paint(canvas, ctx, { enabled: false, location: { enabled: true } }, new Date());
    const returned = await service.apply(original, { dateTime: { enabled: false } });

    expect(fillText).not.toHaveBeenCalled();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(returned).toBe(original);
  });

  it('draws the capture timestamp and not the later clock', async () => {
    const { ctx, fillText } = drawingContext(400, 200);
    await service.paint(ctx.canvas, ctx, {
      dateTime: { enabled: true, displayMode: 'dateTime', dateTimeFormat: 'YYYY-MM-DD HH:mm:ss', timezone: 'UTC', position: 'top-left' },
    }, new Date('2026-10-31T02:49:05Z'));

    expect(fillText.calls.mostRecent().args[0]).toBe('2026-10-31 02:49:05');
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('draws date only when that mode is selected', async () => {
    const { ctx, fillText } = drawingContext(400, 200);
    await service.paint(ctx.canvas, ctx, {
      dateTime: { enabled: true, displayMode: 'date', dateFormat: 'DD MMM YYYY', timezone: 'UTC' },
    }, new Date('2026-10-31T02:49:05Z'));
    expect(fillText.calls.mostRecent().args[0]).toBe('31 Oct 2026');
  });

  it('places each overlay on its own anchor', async () => {
    const positions: ImageOverlayPosition[] = [
      'top-left', 'top-center', 'top-right',
      'center-left', 'center', 'center-right',
      'bottom-left', 'bottom-center', 'bottom-right',
    ];

    for (const position of positions) {
      const { ctx, fillText } = drawingContext(800, 600);
      await service.paint(ctx.canvas, ctx, {
        dateTime: {
          enabled: true,
          displayMode: 'date',
          dateFormat: 'Photo',
          position,
          style: { fontSize: 20, padding: 4, margin: 10, fontFamily: 'sans-serif' },
        },
      }, new Date());
      const block = measureOverlayBlock(['Photo'], 20, 4, (line) => {
        ctx.font = '20px sans-serif';
        return ctx.measureText(line).width;
      });
      const box = placeOverlay(position, 800, 600, block.width, block.height, 10);
      const call = fillText.calls.mostRecent().args;
      expect(call[1]).toBe(box.x + 4);
      expect(call[2]).toBe(box.y + 4);
    }
  });

  it('draws date and location at different positions and stacks a shared position', async () => {
    const capturedAt = new Date('2026-10-31T00:00:00Z');
    const style = { fontSize: 20, padding: 4, margin: 10, fontFamily: 'sans-serif' };
    const split = drawingContext(800, 600);
    await service.paint(split.ctx.canvas, split.ctx, {
      dateTime: { enabled: true, displayMode: 'date', dateFormat: 'Photo', position: 'top-left', style, timezone: 'UTC' },
      location: { enabled: true, displayFormat: 'compact', position: 'bottom-right', style, latitudePrecision: 4, longitudePrecision: 4 },
    }, capturedAt);

    const texts = split.fillText.calls.allArgs().map((args) => args[0]);
    expect(texts).toContain('Photo');
    expect(texts).toContain('26.8467, 80.9462');
    const dateCall = split.fillText.calls.all().find((call) => call.args[0] === 'Photo')!;
    const locationCall = split.fillText.calls.all().find((call) => call.args[0] === '26.8467, 80.9462')!;
    expect(dateCall.args[1]).toBeLessThan(200);
    expect(locationCall.args[1]).toBeGreaterThan(400);

    const stacked = drawingContext(800, 600);
    await service.paint(stacked.ctx.canvas, stacked.ctx, {
      dateTime: { enabled: true, displayMode: 'date', dateFormat: 'Photo', position: 'bottom-left', style, timezone: 'UTC' },
      location: { enabled: true, displayFormat: 'compact', position: 'bottom-left', style },
    }, capturedAt);
    const placed = placeCaptureOverlays(800, 600,
      measured(stacked.ctx, ['Photo'], 'bottom-left'),
      measured(stacked.ctx, ['26.8467, 80.9462'], 'bottom-left')
    );
    const stackedDate = stacked.fillText.calls.all().find((call) => call.args[0] === 'Photo')!;
    const stackedLocation = stacked.fillText.calls.all().find((call) => call.args[0] === '26.8467, 80.9462')!;
    expect(stackedDate.args[2]).toBe(placed.date!.y + 4);
    expect(stackedLocation.args[2]).toBe(placed.location!.y + 4);
    expect(stackedLocation.args[2]).toBeLessThan(stackedDate.args[2] as number);
  });

  it('passes browser geolocation options and refuses a stale fix unless maximumAge allows it', async () => {
    let seen: PositionOptions | undefined;
    geolocation.getCurrentPosition.and.callFake((success: PositionCallback, _error: PositionErrorCallback, options: PositionOptions) => {
      seen = options;
      success(position(13.75, 100.5, 8));
    });
    const { ctx } = drawingContext(200, 100);
    await service.paint(ctx.canvas, ctx, {
      location: { enabled: true, highAccuracy: false, timeout: 2500, maximumAge: 0 },
    }, new Date());
    expect(seen).toEqual({ enableHighAccuracy: false, timeout: 2500, maximumAge: 0 });

    geolocation.getCurrentPosition.calls.reset();
    await service.paint(ctx.canvas, ctx, { location: { enabled: true, maximumAge: 5000 } }, new Date());
    expect(geolocation.getCurrentPosition.calls.mostRecent().args[2]).toEqual(jasmine.objectContaining({ maximumAge: 5000 }));
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('continues without a location line when permission, timeout, or the browser API fails', async () => {
    const { ctx, fillText } = drawingContext(400, 200);
    const config: ImageCaptureWatermarkConfig = {
      dateTime: { enabled: true, displayMode: 'date', dateFormat: 'Photo', timezone: 'UTC' },
      location: { enabled: true, failurePolicy: 'continue' },
    };

    geolocation.getCurrentPosition.and.callFake((_success: PositionCallback, error: PositionErrorCallback) => {
      error(geoError(1));
    });
    await service.paint(ctx.canvas, ctx, config, new Date());
    expect(fillText.calls.allArgs().map((args) => args[0])).toEqual(['Photo']);

    geolocation.getCurrentPosition.and.callFake((_success: PositionCallback, error: PositionErrorCallback) => {
      error(geoError(3));
    });
    await expectAsync(service.paint(ctx.canvas, ctx, {
      location: { enabled: true, failurePolicy: 'continue' },
    }, new Date())).toBeResolved();

    restoreGeolocation();
    restoreGeolocation = installGeolocation(undefined);
    await expectAsync(service.paint(ctx.canvas, ctx, {
      location: { enabled: true, failurePolicy: 'continue' },
    }, new Date())).toBeResolved();
  });

  it('cancels with a typed error for permission denial, timeout, and an unavailable position', async () => {
    const { ctx, fillText } = drawingContext(200, 100);
    const cases: Array<[number, ImageCaptureWatermarkError['code'], string]> = [
      [1, 'permission-denied', 'Location permission was denied.'],
      [2, 'unavailable', 'Location is unavailable.'],
      [3, 'timeout', 'Location request timed out.'],
    ];

    for (const [code, expected, message] of cases) {
      fillText.calls.reset();
      geolocation.getCurrentPosition.and.callFake((_success: PositionCallback, error: PositionErrorCallback) => {
        error(geoError(code));
      });
      await expectAsync(service.paint(ctx.canvas, ctx, {
        location: { enabled: true, failurePolicy: 'cancel' },
      }, new Date())).toBeRejectedWith(jasmine.objectContaining({ code: expected, message }));
      expect(fillText).not.toHaveBeenCalled();
    }
  });

  it('rejects an unsupported browser when cancellation is requested', async () => {
    restoreGeolocation();
    restoreGeolocation = installGeolocation(undefined);
    const { ctx } = drawingContext(80, 40);
    await expectAsync(service.paint(ctx.canvas, ctx, {
      location: { enabled: true, failurePolicy: 'cancel' },
    }, new Date())).toBeRejectedWith(jasmine.objectContaining({
      code: 'unsupported',
      message: 'Geolocation is not supported in this browser.',
    }));
  });

  it('does not draw 0,0 or other invalid coordinates', async () => {
    geolocation.getCurrentPosition.and.callFake((success: PositionCallback) => success(position(0, 0, 1)));
    const { ctx, fillText } = drawingContext(200, 100);
    await service.paint(ctx.canvas, ctx, {
      dateTime: { enabled: true, displayMode: 'date', dateFormat: 'Photo' },
      location: { enabled: true, failurePolicy: 'continue' },
    }, new Date());
    expect(fillText.calls.allArgs().map((args) => args[0]).join(' ')).not.toContain('0.0000');

    await expectAsync(service.paint(ctx.canvas, ctx, {
      location: { enabled: true, failurePolicy: 'cancel' },
    }, new Date())).toBeRejectedWith(jasmine.objectContaining({ code: 'invalid-coordinates' }));
  });

  it('uses a custom provider and does not call the browser API', async () => {
    const getCurrentPosition = jasmine.createSpy('getCurrentPosition').and.resolveTo({
      latitude: 1.23456,
      longitude: 2.34567,
      accuracy: 5,
      timestamp: Date.parse('2026-10-31T02:49:05Z'),
    });
    const { ctx, fillText } = drawingContext(400, 160);
    await service.paint(ctx.canvas, ctx, {
      location: {
        enabled: true,
        displayFormat: 'singleline',
        latitudePrecision: 4,
        longitudePrecision: 4,
        showAccuracy: true,
        showLocationTimestamp: true,
      },
      provider: { type: 'custom', options: { getCurrentPosition } },
    }, new Date());

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(getCurrentPosition).toHaveBeenCalledWith({ highAccuracy: true, timeout: 10000, maximumAge: 0 });
    expect(fillText.calls.allArgs().map((args) => args[0]).join('\n')).toContain('Lat: 1.2346 | Long: 2.3457');
    expect(fillText.calls.allArgs().map((args) => args[0]).join('\n')).toContain('±5 m');
  });

  it('calls Google only with the consumer key and never logs that key', async () => {
    const logs: string[] = [];
    spyOn(console, 'log').and.callFake((...args: unknown[]) => logs.push(args.join(' ')));
    spyOn(console, 'warn').and.callFake((...args: unknown[]) => logs.push(args.join(' ')));
    spyOn(console, 'error').and.callFake((...args: unknown[]) => logs.push(args.join(' ')));
    const fetchSpy = spyOn(window, 'fetch').and.resolveTo(new Response(JSON.stringify({
      location: { lat: 13.7563, lng: 100.5018 },
      accuracy: 40,
    }), { status: 200 }));

    const { ctx, fillText } = drawingContext(400, 160);
    await service.paint(ctx.canvas, ctx, {
      location: { enabled: true, displayFormat: 'compact' },
      provider: { type: 'google', apiKey: 'SECRET_KEY', options: { body: { considerIp: true, apiKey: 'SECRET_KEY' } } },
    }, new Date());

    const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
    expect(url).toContain('key=SECRET_KEY');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ considerIp: true }));
    expect(fillText.calls.mostRecent().args[0]).toContain('13.7563, 100.5018');
    expect(logs.join('\n')).not.toContain('SECRET_KEY');
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('reports a Google failure without the API key', async () => {
    spyOn(window, 'fetch').and.resolveTo(new Response('no', { status: 403 }));
    const { ctx } = drawingContext(80, 40);
    try {
      await service.paint(ctx.canvas, ctx, {
        location: { enabled: true, failurePolicy: 'cancel' },
        provider: { type: 'google', apiKey: 'SECRET_KEY' },
      }, new Date());
      fail('expected the provider error');
    } catch (error) {
      expect(error).toEqual(jasmine.objectContaining({ code: 'provider' }));
      expect(String((error as Error).message)).not.toContain('SECRET_KEY');
    }
  });

  it('keeps the original pixel size for portrait, landscape, JPEG, and PNG output', async () => {
    const landscape = await blobOf(320, 180, 'image/jpeg');
    const portrait = await blobOf(180, 320, 'image/png');
    const capturedAt = new Date('2026-10-31T00:00:00Z');
    const jpeg = await service.apply(landscape, {
      dateTime: { enabled: true, displayMode: 'date', dateFormat: 'YYYY', timezone: 'UTC' },
    }, { capturedAt, quality: 0.8 });
    const png = await service.apply(portrait, {
      dateTime: { enabled: true, displayMode: 'date', dateFormat: 'YYYY', timezone: 'UTC' },
    }, { capturedAt });

    expect(jpeg.type).toBe('image/jpeg');
    expect(png.type).toBe('image/png');
    const jpegBitmap = await createImageBitmap(jpeg);
    const pngBitmap = await createImageBitmap(png);
    expect(jpegBitmap.width).toBe(320);
    expect(jpegBitmap.height).toBe(180);
    expect(pngBitmap.width).toBe(180);
    expect(pngBitmap.height).toBe(320);
    jpegBitmap.close();
    pngBitmap.close();

    const transparent = document.createElement('canvas');
    transparent.width = 200;
    transparent.height = 200;
    const source = transparent.getContext('2d')!;
    source.fillStyle = '#ff0000';
    source.fillRect(0, 0, 4, 4);
    const pngBlob = await new Promise<Blob>((resolve) => transparent.toBlob((blob) => resolve(blob!), 'image/png'));
    const watermarked = await service.apply(pngBlob, {
      dateTime: { enabled: true, displayMode: 'date', dateFormat: 'YYYY', position: 'bottom-left', timezone: 'UTC' },
    }, { capturedAt });
    const check = document.createElement('canvas');
    const bitmap = await createImageBitmap(watermarked);
    check.width = bitmap.width;
    check.height = bitmap.height;
    const checkCtx = check.getContext('2d')!;
    checkCtx.drawImage(bitmap, 0, 0);
    expect(checkCtx.getImageData(check.width - 1, 0, 1, 1).data[3]).toBe(0);
    bitmap.close();
  });

  it('encodes once at the requested JPEG quality and leaves a large frame at its own size', async () => {
    const source = await blobOf(16, 16, 'image/jpeg');
    const bitmap = { width: 1920, height: 1080, close: jasmine.createSpy('close') } as unknown as ImageBitmap;
    spyOn(window, 'createImageBitmap').and.resolveTo(bitmap);
    spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.stub();
    let seen: { width: number; height: number; type?: string; quality?: number; calls: number } = {
      width: 0, height: 0, calls: 0,
    };
    spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (this: HTMLCanvasElement, callback, type, quality) {
      seen = { width: this.width, height: this.height, type, quality, calls: seen.calls + 1 };
      callback(new Blob([new Uint8Array([1])], { type }));
    });

    const file = await service.apply(source, {
      dateTime: { enabled: true, displayMode: 'date', dateFormat: 'YYYY', timezone: 'UTC' },
    }, { capturedAt: new Date('2026-10-31T00:00:00Z'), quality: 0.8 });

    expect(file.type).toBe('image/jpeg');
    expect(seen).toEqual({ width: 1920, height: 1080, type: 'image/jpeg', quality: 0.8, calls: 1 });
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('does not mutate the consumer configuration', async () => {
    const config: ImageCaptureWatermarkConfig = {
      dateTime: { enabled: true, displayMode: 'date', dateFormat: 'YYYY', style: { color: '#fff' } },
    };
    const snapshot = JSON.parse(JSON.stringify(config));
    const { ctx } = drawingContext(80, 40);
    await service.paint(ctx.canvas, ctx, config, new Date());
    expect(config).toEqual(snapshot);
  });

  it('throws a processing error when the canvas cannot be read', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    canvas.height = 0;
    await expectAsync(service.paint(canvas, canvas.getContext('2d')!, {
      dateTime: { enabled: true },
    }, new Date())).toBeRejectedWith(jasmine.objectContaining<ImageCaptureWatermarkError>({ code: 'processing' }));
  });
});

function drawingContext(width: number, height: number): { ctx: CanvasRenderingContext2D; fillText: jasmine.Spy } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const fillText = spyOn(ctx, 'fillText').and.callThrough();
  return { ctx, fillText };
}

function measured(ctx: CanvasRenderingContext2D, lines: string[], position: ImageOverlayPosition) {
  const block = measureOverlayBlock(lines, 20, 4, (line) => {
    ctx.font = '20px sans-serif';
    return ctx.measureText(line).width;
  });
  return { ...block, position, margin: 10 };
}

function position(latitude: number, longitude: number, accuracy: number): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON() { return this; },
    },
    timestamp: Date.parse('2026-10-31T02:49:05Z'),
    toJSON() { return this; },
  };
}

function geoError(code: number): GeolocationPositionError {
  return {
    code,
    message: 'failed',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };
}

function installGeolocation(value: { getCurrentPosition: jasmine.Spy } | undefined): () => void {
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'geolocation')
    ?? Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value });
  return () => {
    if (original) {
      Object.defineProperty(navigator, 'geolocation', original);
    } else {
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    }
  };
}

function blobOf(width: number, height: number, type: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = type === 'image/png' ? 'rgba(0, 128, 255, 0.4)' : '#2266aa';
  ctx.fillRect(0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), type, 0.9));
}
