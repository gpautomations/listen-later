// SPDX-License-Identifier: GPL-3.0-or-later
// In-memory stand-in for the R2 binding used by tests.

function toBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new Error("unsupported object body");
}

function sliceBytes(bytes, offset, length) {
  const start = Math.max(0, offset);
  const end = Math.min(bytes.byteLength, start + length);
  return bytes.subarray(start, end);
}

export class MemoryBucket {
  constructor() {
    this.objects = new Map();
    this.seq = 1;
  }

  async put(key, value, opts = {}) {
    const current = this.objects.get(key);
    const cond = opts.onlyIf || {};
    if (cond.etagDoesNotMatch === "*" && current) {
      throw Object.assign(new Error("precondition failed"), { name: "PreconditionFailed" });
    }
    const bare = (value) => String(value || "").replace(/^W\//, "").replaceAll('"', "");
    if (cond.etagMatches && (!current || bare(current.etag) !== bare(cond.etagMatches))) {
      throw Object.assign(new Error("precondition failed"), { name: "PreconditionFailed" });
    }
    const bytes = toBytes(value);
    const etag = `"${this.seq++}"`;
    this.objects.set(key, {
      bytes,
      etag,
      httpMetadata: { ...(opts.httpMetadata || {}) },
    });
    return { etag };
  }

  objectView(key, opts = {}) {
    const obj = this.objects.get(key);
    if (!obj) return null;
    let offset = 0;
    let length = obj.bytes.byteLength;
    if (opts.range?.suffix) {
      length = Math.min(obj.bytes.byteLength, opts.range.suffix);
      offset = obj.bytes.byteLength - length;
    } else if (opts.range) {
      offset = opts.range.offset || 0;
      length = opts.range.length == null ? obj.bytes.byteLength - offset : opts.range.length;
    }
    const bytes = sliceBytes(obj.bytes, offset, length);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return {
      key,
      size: obj.bytes.byteLength,
      httpEtag: obj.etag,
      httpMetadata: obj.httpMetadata,
      range: opts.range ? { offset, length: copy.byteLength } : undefined,
      body: new Blob([copy]).stream(),
      arrayBuffer: async () => copy.buffer,
      text: async () => new TextDecoder().decode(copy),
      json: async () => JSON.parse(new TextDecoder().decode(copy)),
    };
  }

  async get(key, opts) {
    return this.objectView(key, opts);
  }

  async head(key) {
    const view = this.objectView(key);
    if (!view) return null;
    return { key, size: view.size, httpEtag: view.httpEtag, httpMetadata: view.httpMetadata };
  }

  async delete(key) {
    this.objects.delete(key);
  }
}
