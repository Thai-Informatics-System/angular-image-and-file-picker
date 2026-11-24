import { acceptsAnything, decodeApiUrl, guessMimeType, isFileTypeAccepted, resolveMimeType, toInputAccept } from './upload-helpers';

const file = (name: string, type = '') => new File(['x'], name, { type });

describe('upload-helpers', () => {
  describe('accept handling', () => {
    it('treats empty, "*" and "*/*" as accept-all (the desktop sends "*" for file fields)', () => {
      expect(acceptsAnything('')).toBeTrue();
      expect(acceptsAnything(null)).toBeTrue();
      expect(acceptsAnything('*')).toBeTrue();
      expect(acceptsAnything('*/*')).toBeTrue();
      expect(acceptsAnything('image/*, *')).toBeTrue();
      expect(acceptsAnything('image/*')).toBeFalse();

      expect(isFileTypeAccepted(file('report.pdf', 'application/pdf'), '*')).toBeTrue();
      expect(isFileTypeAccepted(file('report.pdf', 'application/pdf'), '*/*')).toBeTrue();
    });

    it('matches wildcards, exact MIME types and extensions', () => {
      expect(isFileTypeAccepted(file('a.jpg', 'image/jpeg'), 'image/*')).toBeTrue();
      expect(isFileTypeAccepted(file('a.pdf', 'application/pdf'), 'image/*')).toBeFalse();
      expect(isFileTypeAccepted(file('a.pdf', 'application/pdf'), 'image/*,application/pdf')).toBeTrue();
      expect(isFileTypeAccepted(file('A.PDF', 'application/pdf'), '.pdf')).toBeTrue();
    });

    it('guesses the type from the extension when the picker left file.type empty', () => {
      expect(isFileTypeAccepted(file('IMG_0001.HEIC'), 'image/*')).toBeTrue();
      expect(resolveMimeType(file('photo.jpeg'))).toBe('image/jpeg');
      expect(resolveMimeType(file('blob'))).toBe('application/octet-stream');
      expect(resolveMimeType(file('x.png', 'image/png'))).toBe('image/png');
      expect(guessMimeType('noextension')).toBe('');
    });

    it('builds the input accept attribute (null = no filter)', () => {
      expect(toInputAccept('*')).toBeNull();
      expect(toInputAccept('')).toBeNull();
      expect(toInputAccept(' image/* ')).toBe('image/*');
    });
  });

  describe('decodeApiUrl', () => {
    const url = 'https://api.example.com/api';

    it('returns a plain URL unchanged (older desktops do not encode it)', () => {
      expect(decodeApiUrl(url)).toBe(url);
    });

    it('decodes the extra encoding newer desktops add', () => {
      expect(decodeApiUrl(encodeURIComponent(url))).toBe(url);
      expect(decodeApiUrl(encodeURIComponent(encodeURIComponent(url)))).toBe(url);
    });

    it('never throws on malformed input', () => {
      expect(decodeApiUrl('https%3A%2F%2Fapi%ZZ')).toBe('https%3A%2F%2Fapi%ZZ');
      expect(decodeApiUrl('%E0%A4%A')).toBe('%E0%A4%A');
      expect(decodeApiUrl(null)).toBe('');
    });
  });
});
