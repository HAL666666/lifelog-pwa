(function (global) {
  'use strict';

  const MAX_EDGE = 1600;
  const THUMB_EDGE = 200;
  const JPEG_Q = 0.82;
  const THUMB_Q = 0.7;

  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('画像の読み込みに失敗しました'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality);
    });
  }

  async function resizeBlob(file, maxEdge, quality) {
    const img = await loadImageFromBlob(file);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvasToBlob(canvas, 'image/jpeg', quality);
  }

  async function importFiles(fileList, onProgress) {
    const files = Array.from(fileList || []);
    const results = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      const date = await ExifUtil.getPhotoDate(file);
      const dateKey = ExifUtil.toDateKey(date);
      const full = await resizeBlob(file, MAX_EDGE, JPEG_Q);
      const thumb = await resizeBlob(file, THUMB_EDGE, THUMB_Q);
      const record = {
        id: DB.uid(),
        dateKey,
        takenAt: date.toISOString(),
        createdAt: new Date().toISOString(),
        mime: 'image/jpeg',
        blob: full,
        thumb
      };
      await DB.put('photos', record);
      results.push(record);
      if (onProgress) onProgress(i + 1, files.length);
    }
    return results;
  }

  async function photosForDate(dateKey) {
    return DB.getByIndex('photos', 'byDate', dateKey);
  }

  async function allPhotos() {
    return DB.getAll('photos');
  }

  async function deletePhoto(id) {
    return DB.del('photos', id);
  }

  /** Map dateKey -> first thumb blob for calendar markers */
  async function thumbsByDate() {
    const all = await allPhotos();
    const map = {};
    for (const p of all) {
      if (!map[p.dateKey]) map[p.dateKey] = p;
    }
    return map;
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(dataURL) {
    const parts = dataURL.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  global.Photos = {
    importFiles, photosForDate, allPhotos, deletePhoto, thumbsByDate,
    blobToDataURL, dataURLToBlob, loadImageFromBlob
  };
})(typeof window !== 'undefined' ? window : self);
