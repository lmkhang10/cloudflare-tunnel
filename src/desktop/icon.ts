import { deflateSync } from 'node:zlib';

/**
 * Draws the menu bar cloud as a black-on-transparent PNG (a macOS template image).
 * `filled` marks "tunnels running"; the outline marks "idle". Generated in code so the package ships no binary assets.
 */
export function cloudIconPng(size = 32, options: { filled?: boolean } = {}): Buffer {
  const scale = size / 16; const samples = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let hits = 0;
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const px = (x + (sx + 0.5) / samples) / scale, py = (y + (sy + 0.5) / samples) / scale;
      if (inCloud(px, py, 0) && (options.filled || !inCloud(px, py, 1.5))) hits++;
    }
    pixels[(y * size + x) * 4 + 3] = Math.round(255 * hits / (samples * samples));
  }
  return encodePng(size, size, pixels);
}

function inCloud(x: number, y: number, inset: number): boolean {
  const circle = (cx: number, cy: number, r: number) => (x - cx) ** 2 + (y - cy) ** 2 <= (r - inset) ** 2;
  const body = x >= 4.6 + inset && x <= 12.4 - inset && y >= 9 && y <= 13 - inset;
  return circle(4.6, 10, 3) || circle(8.4, 7.2, 4.2) || circle(12.2, 9.8, 3.2) || body;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buffer: Buffer): number { let c = 0xffffffff; for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6; // 8-bit RGBA
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
