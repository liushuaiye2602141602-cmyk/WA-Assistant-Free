/**
 * Minimal ZIP (store method) builder for browser.
 * Enough for packaging exported chat HTML + media without external deps.
 */
(function (global) {
  "use strict";

  function crc32(buf) {
    let c;
    const table = crc32.table || (crc32.table = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })());
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const d = date || new Date();
    const time =
      ((d.getHours() & 31) << 11) |
      ((d.getMinutes() & 63) << 5) |
      ((d.getSeconds() / 2) & 31);
    const day =
      (((d.getFullYear() - 1980) & 127) << 9) |
      (((d.getMonth() + 1) & 15) << 5) |
      (d.getDate() & 31);
    return { time, day };
  }

  function strToU8(str) {
    return new TextEncoder().encode(str);
  }

  class ZipWriter {
    constructor() {
      this.entries = [];
    }

    /**
     * @param {string} name path inside zip
     * @param {Uint8Array|ArrayBuffer|Blob|string} data
     */
    async add(name, data) {
      let bytes;
      if (data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
      else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
      else if (data instanceof Uint8Array) bytes = data;
      else bytes = strToU8(String(data));
      this.entries.push({ name, bytes, crc: crc32(bytes) });
      return this;
    }

    build() {
      const { time, day } = dosDateTime();
      const parts = [];
      const central = [];
      let offset = 0;

      for (const e of this.entries) {
        const nameBytes = strToU8(e.name);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true); // UTF-8 filenames
        local.setUint16(8, 0, true); // store
        local.setUint16(10, time, true);
        local.setUint16(12, day, true);
        local.setUint32(14, e.crc, true);
        local.setUint32(18, e.bytes.length, true);
        local.setUint32(22, e.bytes.length, true);
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);

        parts.push(new Uint8Array(local.buffer), nameBytes, e.bytes);

        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true);
        cd.setUint16(4, 20, true);
        cd.setUint16(6, 20, true);
        cd.setUint16(8, 0x0800, true);
        cd.setUint16(10, 0, true);
        cd.setUint16(12, time, true);
        cd.setUint16(14, day, true);
        cd.setUint32(16, e.crc, true);
        cd.setUint32(20, e.bytes.length, true);
        cd.setUint32(24, e.bytes.length, true);
        cd.setUint16(28, nameBytes.length, true);
        cd.setUint16(30, 0, true);
        cd.setUint16(32, 0, true);
        cd.setUint16(34, 0, true);
        cd.setUint16(36, 0, true);
        cd.setUint32(38, 0, true);
        cd.setUint32(42, offset, true);
        central.push(new Uint8Array(cd.buffer), nameBytes);

        offset += 30 + nameBytes.length + e.bytes.length;
      }

      let cdSize = 0;
      for (const p of central) cdSize += p.length;

      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(4, 0, true);
      end.setUint16(6, 0, true);
      end.setUint16(8, this.entries.length, true);
      end.setUint16(10, this.entries.length, true);
      end.setUint32(12, cdSize, true);
      end.setUint32(16, offset, true);
      end.setUint16(20, 0, true);

      const blobParts = parts.concat(central, [new Uint8Array(end.buffer)]);
      return new Blob(blobParts, { type: "application/zip" });
    }
  }

  global.WAZip = { ZipWriter };
})(typeof self !== "undefined" ? self : globalThis);
