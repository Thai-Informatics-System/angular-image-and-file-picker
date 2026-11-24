// Small pure helpers for the upload page (no Angular dependencies, so they are easy to unit test).

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  zip: 'application/zip',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

/** MIME type guessed from the file name's extension, or '' when unknown. */
export function guessMimeType(fileName: string): string {
  const ext = fileName?.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  return MIME_BY_EXTENSION[ext] || '';
}

/**
 * The file's MIME type. Some Android pickers/file providers leave `file.type` empty,
 * so fall back to the extension, then to a generic binary type.
 */
export function resolveMimeType(file: File): string {
  return (file.type || guessMimeType(file.name) || 'application/octet-stream').toLowerCase();
}

/** True when the accept string allows anything: '', '*' or '*' + '/*' (the desktop sends '*' for file fields). */
export function acceptsAnything(accept: string | null | undefined): boolean {
  const types = (accept || '').split(',').map(t => t.trim()).filter(Boolean);
  return types.length === 0 || types.some(t => t === '*' || t === '*/*');
}

/**
 * Value for the file input's `accept` attribute: null (no filter) when everything is allowed.
 * Known extensions also get their MIME type (".jpg" -> "image/jpeg"): phones only open their photo
 * library (and Android its camera option) for image MIME types, not for a bare ".png,.jpg" list.
 */
export function toInputAccept(accept: string | null | undefined): string | null {
  if (acceptsAnything(accept)) return null;
  const types = new Set<string>();
  for (const type of accept!.split(',').map(t => t.trim()).filter(Boolean)) {
    types.add(type);
    const mime = type.startsWith('.') ? MIME_BY_EXTENSION[type.slice(1).toLowerCase()] : '';
    if (mime) types.add(mime);
  }
  return [...types].join(',');
}

/** Whether a photo from the phone camera (JPEG) fits the field, i.e. whether to offer "Take Photo". */
export function acceptsCameraPhoto(accept: string | null | undefined): boolean {
  if (acceptsAnything(accept)) return true;
  const types = accept!.toLowerCase().split(',').map(t => t.trim());
  return types.some(t => t === 'image/*' || t === 'image/jpeg' || t === '.jpg' || t === '.jpeg');
}

/**
 * Whether the file matches the accept string.
 * Supports MIME types, wildcards (image/*, video/*), extensions (.pdf, .jpg) and accept-all.
 */
export function isFileTypeAccepted(file: File, accept: string | null | undefined): boolean {
  if (acceptsAnything(accept)) return true;

  const fileName = file.name.toLowerCase();
  const mimeType = resolveMimeType(file);
  const acceptTypes = accept!.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);

  return acceptTypes.some(acceptType => {
    // Wildcard MIME types (image/*, video/*)
    if (acceptType.endsWith('/*')) {
      return mimeType.startsWith(acceptType.slice(0, -1));
    }
    // Specific MIME types (image/jpeg, application/pdf)
    if (acceptType.includes('/')) {
      return mimeType === acceptType;
    }
    // Extensions (.pdf, .jpg)
    if (acceptType.startsWith('.')) {
      return fileName.endsWith(acceptType);
    }
    return false;
  });
}

/**
 * Decode the `apiUrl` QR parameter only as many times as needed (at most twice) and never throw.
 * Newer desktops encode it once more than URLSearchParams does, older ones do not,
 * so a value that already looks like a URL is returned unchanged.
 */
export function decodeApiUrl(value: string | null | undefined): string {
  let url = (value || '').trim();
  for (let i = 0; i < 2 && !url.includes('://') && /%[0-9a-f]{2}/i.test(url); i++) {
    try {
      url = decodeURIComponent(url);
    } catch {
      break;
    }
  }
  return url;
}
