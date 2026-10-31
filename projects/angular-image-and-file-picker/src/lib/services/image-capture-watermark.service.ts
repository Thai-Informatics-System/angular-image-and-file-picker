import { Injectable } from '@angular/core';
import type {
  ImageCaptureLocationFix,
  ImageCaptureLocationRequest,
  ImageCaptureWatermarkConfig,
  ImageCaptureWatermarkContext,
} from '../interfaces/image-capture-watermark.type';
import {
  decodeCapturedImage,
  defaultOverlayFontSize,
  formatCaptureDateTime,
  formatCaptureLocation,
  isValidCaptureCoordinate,
  measureOverlayBlock,
  placeCaptureOverlays,
  resolveImageCaptureWatermarkConfig,
  type ResolvedImageCaptureWatermarkConfig,
  type ResolvedOverlayStyle,
} from './image-capture-watermark.logic';

export type ImageCaptureWatermarkErrorCode =
  | 'permission-denied'
  | 'unavailable'
  | 'timeout'
  | 'unsupported'
  | 'invalid-coordinates'
  | 'provider'
  | 'processing';

export class ImageCaptureWatermarkError extends Error {
  readonly code: ImageCaptureWatermarkErrorCode;

  constructor(code: ImageCaptureWatermarkErrorCode, message: string) {
    super(message);
    this.name = 'ImageCaptureWatermarkError';
    this.code = code;
  }
}

interface PreparedOverlay {
  resolved: ResolvedImageCaptureWatermarkConfig;
  dateLines: string[];
  locationLines: string[];
}

@Injectable({
  providedIn: 'root'
})
export class ImageCaptureWatermarkService {
  /**
   * Draws enabled overlays onto the canvas that already holds the captured frame.
   * Does nothing — and does not request location — when watermarking is inactive.
   */
  async paint(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    config: ImageCaptureWatermarkConfig | null | undefined,
    capturedAt: Date,
    knownFix?: ImageCaptureLocationFix | null
  ): Promise<void> {
    const prepared = await this.prepare(config, capturedAt, knownFix);
    if (!prepared) {
      return;
    }
    this.render(canvas, ctx, prepared);
  }

  /** Draws the overlays with the location already in hand. Never requests a location. */
  paintLive(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    config: ImageCaptureWatermarkConfig | null | undefined,
    at: Date,
    fix: ImageCaptureLocationFix | null
  ): void {
    const prepared = this.compose(resolveImageCaptureWatermarkConfig(config), fix, at);
    if (prepared) {
      this.render(canvas, ctx, prepared);
    }
  }

  isLocationEnabled(config: ImageCaptureWatermarkConfig | null | undefined): boolean {
    return resolveImageCaptureWatermarkConfig(config).location.enabled;
  }

  /** True when a photo must not be taken without a location. */
  isLocationRequired(config: ImageCaptureWatermarkConfig | null | undefined): boolean {
    const { location } = resolveImageCaptureWatermarkConfig(config);
    return location.enabled && location.failurePolicy === 'cancel';
  }

  /** Requests one location fix. Rejects with ImageCaptureWatermarkError whatever the failure policy. */
  async getLocationFix(config: ImageCaptureWatermarkConfig | null | undefined): Promise<ImageCaptureLocationFix> {
    try {
      return await this.readFix(resolveImageCaptureWatermarkConfig(config));
    } catch (error) {
      throw this.asLocationError(error);
    }
  }

  /**
   * Returns a watermarked file. An inactive config returns the original file
   * without decoding it. JPEG is encoded once; PNG keeps its mime type.
   */
  async apply(
    image: Blob,
    config: ImageCaptureWatermarkConfig | null | undefined,
    context: ImageCaptureWatermarkContext = {}
  ): Promise<File> {
    const capturedAt = context.capturedAt ?? new Date();
    const prepared = await this.prepare(config, capturedAt);
    if (!prepared) {
      return this.asFile(image, context, capturedAt);
    }

    let bitmap: ImageBitmap | undefined;
    const canvas = document.createElement('canvas');
    try {
      try {
        bitmap = await decodeCapturedImage(image);
      } catch {
        throw new ImageCaptureWatermarkError('processing', 'Could not process the captured image.');
      }
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new ImageCaptureWatermarkError('processing', 'Could not process the captured image.');
      }
      ctx.drawImage(bitmap, 0, 0);
      this.render(canvas, ctx, prepared);
      const mime = image.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const quality = mime === 'image/jpeg' ? this.jpegQuality(context.quality) : undefined;
      const blob = await this.canvasToBlob(canvas, mime, quality);
      const extension = mime === 'image/png' ? 'png' : 'jpg';
      return new File(
        [blob],
        context.fileName || `capture-${capturedAt.getTime()}.${extension}`,
        { type: mime, lastModified: capturedAt.getTime() }
      );
    } finally {
      bitmap?.close();
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  private async prepare(
    config: ImageCaptureWatermarkConfig | null | undefined,
    capturedAt: Date,
    knownFix?: ImageCaptureLocationFix | null
  ): Promise<PreparedOverlay | null> {
    const resolved = resolveImageCaptureWatermarkConfig(config);
    if (!resolved.dateTime.enabled && !resolved.location.enabled) {
      return null;
    }

    const fix = resolved.location.enabled && knownFix ? knownFix : await this.acquireLocation(resolved);
    return this.compose(resolved, fix, capturedAt);
  }

  private compose(
    resolved: ResolvedImageCaptureWatermarkConfig,
    fix: ImageCaptureLocationFix | null,
    capturedAt: Date
  ): PreparedOverlay | null {
    if (!resolved.dateTime.enabled && !resolved.location.enabled) {
      return null;
    }
    const dateText = resolved.dateTime.enabled ? formatCaptureDateTime(capturedAt, resolved.dateTime) : '';
    const locationText = fix && resolved.location.enabled
      ? formatCaptureLocation(fix, { ...resolved.location, timezone: resolved.dateTime.timezone })
      : '';
    const dateLines = dateText ? dateText.split('\n') : [];
    const locationLines = locationText ? locationText.split('\n') : [];
    if (!dateLines.length && !locationLines.length) {
      return null;
    }
    return { resolved, dateLines, locationLines };
  }

  private async acquireLocation(resolved: ResolvedImageCaptureWatermarkConfig): Promise<ImageCaptureLocationFix | null> {
    if (!resolved.location.enabled) {
      return null;
    }

    try {
      return await this.readFix(resolved);
    } catch (error) {
      if (resolved.location.failurePolicy === 'cancel') {
        throw this.asLocationError(error);
      }
      return null;
    }
  }

  private async readFix(resolved: ResolvedImageCaptureWatermarkConfig): Promise<ImageCaptureLocationFix> {
    const fix = await this.requestLocation(resolved);
    if (!fix || !isValidCaptureCoordinate(fix.latitude, fix.longitude)) {
      throw new ImageCaptureWatermarkError('invalid-coordinates', 'Location coordinates are invalid.');
    }
    return {
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: typeof fix.accuracy === 'number' && Number.isFinite(fix.accuracy) ? fix.accuracy : undefined,
      timestamp: typeof fix.timestamp === 'number' && Number.isFinite(fix.timestamp) ? fix.timestamp : undefined,
    };
  }

  private requestLocation(resolved: ResolvedImageCaptureWatermarkConfig): Promise<ImageCaptureLocationFix> {
    const request: ImageCaptureLocationRequest = {
      highAccuracy: resolved.location.highAccuracy,
      timeout: resolved.location.timeout,
      maximumAge: resolved.location.maximumAge,
    };
    if (resolved.provider.type === 'custom') {
      return this.requestCustom(resolved, request);
    }
    if (resolved.provider.type === 'google') {
      return this.requestGoogle(resolved, request);
    }
    return this.requestBrowser(request);
  }

  private requestBrowser(request: ImageCaptureLocationRequest): Promise<ImageCaptureLocationFix> {
    return new Promise((resolve, reject) => {
      const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
      if (!geolocation) {
        reject(new ImageCaptureWatermarkError('unsupported', 'Geolocation is not supported in this browser.'));
        return;
      }
      geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        }),
        (error) => {
          const code = error?.code === 1 ? 'permission-denied' : error?.code === 3 ? 'timeout' : 'unavailable';
          const message = code === 'permission-denied'
            ? 'Location permission was denied.'
            : code === 'timeout'
              ? 'Location request timed out.'
              : 'Location is unavailable.';
          reject(new ImageCaptureWatermarkError(code, message));
        },
        {
          enableHighAccuracy: request.highAccuracy,
          timeout: request.timeout,
          maximumAge: request.maximumAge,
        }
      );
    });
  }

  private async requestCustom(
    resolved: ResolvedImageCaptureWatermarkConfig,
    request: ImageCaptureLocationRequest
  ): Promise<ImageCaptureLocationFix> {
    if (!resolved.provider.getCurrentPosition) {
      throw new ImageCaptureWatermarkError('provider', 'A custom location provider requires getCurrentPosition.');
    }
    return resolved.provider.getCurrentPosition(request);
  }

  private async requestGoogle(
    resolved: ResolvedImageCaptureWatermarkConfig,
    request: ImageCaptureLocationRequest
  ): Promise<ImageCaptureLocationFix> {
    const apiKey = resolved.provider.apiKey;
    if (!apiKey) {
      throw new ImageCaptureWatermarkError('provider', 'A Google location provider requires an API key.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeout);
    try {
      const response = await fetch(
        `https://www.googleapis.com/geolocation/v1/geolocate?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.googleBody(resolved.provider.options)),
          signal: controller.signal,
        }
      );
      if (!response.ok) {
        throw new ImageCaptureWatermarkError('provider', 'Location provider request failed.');
      }
      const payload = await response.json() as {
        location?: { lat?: unknown; lng?: unknown };
        accuracy?: unknown;
      };
      return {
        latitude: Number(payload.location?.lat),
        longitude: Number(payload.location?.lng),
        accuracy: Number.isFinite(Number(payload.accuracy)) ? Number(payload.accuracy) : undefined,
        timestamp: Date.now(),
      };
    } catch (error) {
      if (error instanceof ImageCaptureWatermarkError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ImageCaptureWatermarkError('timeout', 'Location request timed out.');
      }
      throw new ImageCaptureWatermarkError('unavailable', 'Location is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }

  private googleBody(options: Record<string, unknown>): Record<string, unknown> {
    const body = options['body'];
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {};
    }
    const payload: Record<string, unknown> = {};
    for (const key of Object.keys(body as Record<string, unknown>)) {
      if (key.toLowerCase() === 'key' || key.toLowerCase() === 'apikey') {
        continue;
      }
      payload[key] = (body as Record<string, unknown>)[key];
    }
    return payload;
  }

  private render(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    prepared: PreparedOverlay
  ): void {
    if (!canvas.width || !canvas.height) {
      throw new ImageCaptureWatermarkError('processing', 'Could not process the captured image.');
    }

    try {
      const dateStyle = prepared.resolved.dateTime.style;
      const locationStyle = prepared.resolved.location.style;
      const dateSize = this.fitFont(ctx, prepared.dateLines, dateStyle, canvas.width);
      const locationSize = this.fitFont(ctx, prepared.locationLines, locationStyle, canvas.width);
      const measure = (lines: string[], fontSize: number, fontFamily: string, padding: number) =>
        measureOverlayBlock(lines, fontSize, padding, (line) => {
          ctx.font = `${fontSize}px ${fontFamily}`;
          return ctx.measureText(line || ' ').width;
        });

      const dateBlock = prepared.dateLines.length
        ? measure(prepared.dateLines, dateSize, dateStyle.fontFamily, dateStyle.padding)
        : null;
      const locationBlock = prepared.locationLines.length
        ? measure(prepared.locationLines, locationSize, locationStyle.fontFamily, locationStyle.padding)
        : null;
      const placed = placeCaptureOverlays(
        canvas.width,
        canvas.height,
        dateBlock ? { ...dateBlock, position: prepared.resolved.dateTime.position, margin: dateStyle.margin } : null,
        locationBlock ? { ...locationBlock, position: prepared.resolved.location.position, margin: locationStyle.margin } : null
      );

      if (placed.date && dateBlock) {
        this.paintBlock(ctx, prepared.dateLines, placed.date, dateStyle, dateSize, dateBlock.lineHeight);
      }
      if (placed.location && locationBlock) {
        this.paintBlock(ctx, prepared.locationLines, placed.location, locationStyle, locationSize, locationBlock.lineHeight);
      }
    } catch (error) {
      if (error instanceof ImageCaptureWatermarkError) {
        throw error;
      }
      throw new ImageCaptureWatermarkError('processing', 'Could not process the captured image.');
    }
  }

  private fitFont(
    ctx: CanvasRenderingContext2D,
    lines: string[],
    style: ResolvedOverlayStyle,
    canvasWidth: number
  ): number {
    if (!lines.length) {
      return style.fontSize ?? defaultOverlayFontSize(canvasWidth);
    }
    const maxWidth = Math.max(1, canvasWidth - style.margin * 2);
    let size = Math.round(style.fontSize ?? defaultOverlayFontSize(canvasWidth));
    while (size > 10) {
      const block = measureOverlayBlock(lines, size, style.padding, (line) => {
        ctx.font = `${size}px ${style.fontFamily}`;
        return ctx.measureText(line || ' ').width;
      });
      if (block.width <= maxWidth) {
        return size;
      }
      size -= 1;
    }
    return size;
  }

  private paintBlock(
    ctx: CanvasRenderingContext2D,
    lines: string[],
    box: { x: number; y: number; width: number; height: number },
    style: ResolvedOverlayStyle,
    fontSize: number,
    lineHeight: number
  ): void {
    if (style.backgroundOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = style.backgroundOpacity;
      ctx.fillStyle = style.backgroundColor;
      this.fillRoundedRect(ctx, box.x, box.y, box.width, box.height, style.borderRadius);
      ctx.restore();
    }

    ctx.save();
    ctx.font = `${fontSize}px ${style.fontFamily}`;
    ctx.fillStyle = style.color;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    lines.forEach((line, index) => {
      ctx.fillText(line, box.x + style.padding, box.y + style.padding + index * lineHeight);
    });
    ctx.restore();
  }

  private fillRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    const corner = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    if (corner > 0 && typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, width, height, corner);
    } else {
      ctx.rect(x, y, width, height);
    }
    ctx.fill();
  }

  private jpegQuality(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0.92;
    }
    return Math.min(1, Math.max(0.01, value));
  }

  private canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number | undefined): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new ImageCaptureWatermarkError('processing', 'Could not process the captured image.'));
          return;
        }
        resolve(blob);
      }, mime, quality);
    });
  }

  private asFile(image: Blob, context: ImageCaptureWatermarkContext, capturedAt: Date): File {
    if (image instanceof File && !context.fileName) {
      return image;
    }
    return new File(
      [image],
      context.fileName || (image instanceof File ? image.name : `capture-${capturedAt.getTime()}`),
      { type: image.type || 'application/octet-stream', lastModified: capturedAt.getTime() }
    );
  }

  private asLocationError(error: unknown): ImageCaptureWatermarkError {
    if (error instanceof ImageCaptureWatermarkError) {
      return error;
    }
    return new ImageCaptureWatermarkError('unavailable', 'Location is unavailable.');
  }
}
