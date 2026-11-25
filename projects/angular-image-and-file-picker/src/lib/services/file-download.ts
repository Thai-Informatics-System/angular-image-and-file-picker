/**
 * Saves a remote file (S3 / CDN URL) to the user's device instead of opening it in a new tab.
 *
 * The `download` attribute is ignored on cross-origin links, so the file is fetched and saved
 * from a blob URL. The fetch must skip the HTTP cache: the thumbnail `<img>` already loaded the
 * same URL without an `Origin` header, and S3 answers such a request without CORS headers and
 * without `Vary: Origin`. A cached copy of that answer fails the CORS check, which used to send
 * every download to the "open in a new tab" fallback.
 *
 * @returns true when the file was saved, false when the browser could only open it in a new tab.
 */
export async function downloadFileFromUrl(url: string, fileName?: string | null): Promise<boolean> {
  try {
    // No custom headers: a plain GET needs no preflight.
    const response = await fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit' });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    if (!blob.size) {
      throw new Error('File is empty or could not be fetched');
    }
    saveBlob(blob, downloadFileName(url, fileName));
    return true;
  } catch (error) {
    // The server does not allow cross-origin reads: let the browser show the file instead.
    console.error('Download failed, opening the file in a new tab instead:', error);
    window.open(url, '_blank', 'noopener');
    return false;
  }
}

/** Saves a blob under the given file name. */
export function saveBlob(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = blobUrl;
  el.download = fileName;
  el.style.display = 'none';
  document.body.appendChild(el);
  el.click();
  document.body.removeChild(el);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/**
 * The name to save under: the given title (or the URL's file name), with the URL's extension
 * added when the title has none, e.g. "Image 1" + ".../abc.webp" -> "Image 1.webp".
 */
export function downloadFileName(url: string, fileName?: string | null): string {
  let urlName = '';
  try {
    urlName = decodeURIComponent(new URL(url, 'http://x').pathname.split('/').pop() || '');
  } catch {
    urlName = '';
  }
  const ext = /\.([a-z0-9]{1,8})$/i.exec(urlName)?.[1] || '';
  const base = (fileName || '').trim().replace(/[\\/:*?"<>|]+/g, '_') || urlName || `file-${Date.now()}`;
  if (ext && !/\.[a-z0-9]{1,8}$/i.test(base)) {
    return `${base}.${ext}`;
  }
  return base;
}
