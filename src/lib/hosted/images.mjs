// SPDX-License-Identifier: GPL-3.0-or-later
// Pictures that sit with the article blocks. Cross-origin images that the page will not
// let us read are skipped. The upload still works without them.

const TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

function extFor(type) {
  return TYPES[type] || "";
}

function findImg(el) {
  if (!el || el.nodeType !== 1) return null;
  if (el.tagName === "IMG") return el;
  return el.querySelector?.("img") || null;
}

async function readBlob(blob) {
  const type = (blob.type || "").split(";")[0].trim().toLowerCase();
  if (!TYPES[type]) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > 1_500_000) return null;
  return { bytes, type };
}

async function readImage(img) {
  const src = img.currentSrc || img.src || "";
  if (!src) return null;
  try {
    if (src.startsWith("data:")) {
      const res = await fetch(src);
      return readBlob(await res.blob());
    }
    const res = await fetch(src);
    if (!res.ok) return null;
    return readBlob(await res.blob());
  } catch (e) {
    return null;
  }
}

export async function imagesBeforeBlocks(blockEls) {
  const images = [];
  const seen = new Set();
  const before = [];
  for (const el of blockEls || []) {
    const img = findImg(el.previousElementSibling);
    if (!img || seen.has(img)) {
      before.push(null);
      continue;
    }
    seen.add(img);
    const got = await readImage(img);
    if (!got) {
      before.push(null);
      continue;
    }
    const name = `img-${images.length + 1}.${extFor(got.type)}`;
    const image = { ...got, name, alt: (img.alt || "").slice(0, 300) };
    images.push(image);
    before.push(image);
  }
  return { images, before };
}
