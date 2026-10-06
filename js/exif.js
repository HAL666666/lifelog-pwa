/**
 * Minimal EXIF DateTimeOriginal reader (JPEG APP1).
 * Returns Date or null. No external deps.
 */
(function (global) {
  'use strict';

  function readU16(view, offset, le) {
    return le ? view.getUint16(offset, true) : view.getUint16(offset, false);
  }
  function readU32(view, offset, le) {
    return le ? view.getUint32(offset, true) : view.getUint32(offset, false);
  }

  function parseExifDate(str) {
    // "YYYY:MM:DD HH:MM:SS"
    if (!str || typeof str !== 'string') return null;
    const m = str.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return isNaN(d.getTime()) ? null : d;
  }

  function readAscii(view, offset, length) {
    let s = '';
    for (let i = 0; i < length; i++) {
      const c = view.getUint8(offset + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  function findDateTimeOriginal(buf) {
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not JPEG

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2, false);
      if (marker === 0xe1) {
        // APP1
        const start = offset + 4;
        // "Exif\0\0"
        if (
          view.getUint8(start) === 0x45 &&
          view.getUint8(start + 1) === 0x78 &&
          view.getUint8(start + 2) === 0x69 &&
          view.getUint8(start + 3) === 0x66
        ) {
          const tiff = start + 6;
          const endian = view.getUint16(tiff, false);
          const le = endian === 0x4949;
          if (endian !== 0x4949 && endian !== 0x4d4d) return null;
          if (readU16(view, tiff + 2, le) !== 42) return null;
          const ifd0 = tiff + readU32(view, tiff + 4, le);
          const date = scanIfdForDate(view, tiff, ifd0, le);
          if (date) return date;
        }
      }
      if (marker === 0xda) break; // SOS
      offset += 2 + size;
    }
    return null;
  }

  function scanIfdForDate(view, tiff, ifdOffset, le) {
    if (ifdOffset + 2 > view.byteLength) return null;
    const count = readU16(view, ifdOffset, le);
    let exifOffset = null;
    let dateTime = null;

    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > view.byteLength) break;
      const tag = readU16(view, entry, le);
      const type = readU16(view, entry + 2, le);
      const num = readU32(view, entry + 4, le);
      const valOff = entry + 8;
      const typeSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type] || 1;
      const byteLen = typeSize * num;
      let dataOffset = byteLen <= 4 ? valOff : tiff + readU32(view, valOff, le);

      if (tag === 0x8769) {
        // Exif IFD pointer
        exifOffset = tiff + readU32(view, valOff, le);
      } else if (tag === 0x0132 && type === 2) {
        // DateTime
        dateTime = parseExifDate(readAscii(view, dataOffset, num));
      }
    }

    if (exifOffset != null) {
      const exifCount = readU16(view, exifOffset, le);
      for (let i = 0; i < exifCount; i++) {
        const entry = exifOffset + 2 + i * 12;
        if (entry + 12 > view.byteLength) break;
        const tag = readU16(view, entry, le);
        const type = readU16(view, entry + 2, le);
        const num = readU32(view, entry + 4, le);
        const valOff = entry + 8;
        const typeSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type] || 1;
        const byteLen = typeSize * num;
        let dataOffset = byteLen <= 4 ? valOff : tiff + readU32(view, valOff, le);
        if (tag === 0x9003 && type === 2) {
          // DateTimeOriginal
          const d = parseExifDate(readAscii(view, dataOffset, num));
          if (d) return d;
        }
      }
    }
    return dateTime;
  }

  async function getPhotoDate(file) {
    try {
      const buf = await file.arrayBuffer();
      const fromExif = findDateTimeOriginal(buf);
      if (fromExif) return fromExif;
    } catch (_) { /* ignore */ }
    return new Date(file.lastModified || Date.now());
  }

  function toDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  global.ExifUtil = { getPhotoDate, toDateKey, findDateTimeOriginal, parseExifDate };
})(typeof window !== 'undefined' ? window : self);
