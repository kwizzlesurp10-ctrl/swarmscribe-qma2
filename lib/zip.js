/** Store-only ZIP writer (no compression, dependency-free). */

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return ~crc >>> 0;
}

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function concat(parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * @param {{ name: string, data: Uint8Array | string }[]} files
 * @returns {Uint8Array}
 */
export function createZip(files) {
  const enc = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const data =
      typeof file.data === "string" ? enc.encode(file.data) : file.data;
    const crc = crc32(data);
    const size = data.length;

    const localHeader = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);

    local.push(localHeader);

    const centralHeader = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);

    central.push(centralHeader);
    offset += localHeader.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  ]);

  return concat([...local, ...central, end]);
}

/**
 * @param {Uint8Array} bytes
 * @param {string} filename
 */
export function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
