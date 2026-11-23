// Shrink an article picture and turn it into a data URL so a saved episode
// does not ask the network for images. The caller skips pictures that are too
// small to be content (icons, tracking pixels).

export const IMAGE_MAX_EDGE = 1280;
export const IMAGE_MIN_EDGE = 48;
const IMAGE_QUALITY = 0.72;
const IMAGE_BYTE_CAP = 450000;

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch (e) {
      reject(e);
    }
  });
}

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) binary += String.fromCharCode(...buf.subarray(i, i + step));
  const type = blob.type === "image/webp" ? "image/webp" : blob.type === "image/png" ? "image/png" : "image/jpeg";
  return `data:${type};base64,${btoa(binary)}`;
}

function draw(source, edge) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  if (!sw || !sh) throw new Error("empty image");
  const scale = Math.min(1, edge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

async function pickBlob(canvas) {
  const webp = await canvasBlob(canvas, "image/webp", IMAGE_QUALITY);
  const jpeg = await canvasBlob(canvas, "image/jpeg", IMAGE_QUALITY);
  const usable = [webp, jpeg].filter((blob) => blob && blob.size > 0);
  if (!usable.length) throw new Error("could not encode image");
  usable.sort((a, b) => a.size - b.size);
  return usable[0];
}

export async function encodeImageSource(source) {
  let canvas = draw(source, IMAGE_MAX_EDGE);
  let blob = await pickBlob(canvas);
  if (blob.size > IMAGE_BYTE_CAP) {
    canvas = draw(source, 960);
    const smaller = await canvasBlob(canvas, "image/jpeg", 0.55);
    if (smaller && smaller.size > 0 && smaller.size < blob.size) blob = smaller;
  }
  const dataUrl = await blobToDataUrl(blob);
  return { dataUrl, bytes: dataUrl.length, width: canvas.width, height: canvas.height, type: blob.type || "image/jpeg" };
}

export async function encodeImageBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    return await encodeImageSource(bitmap);
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}
