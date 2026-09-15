/**
 * Minimal streaming ZIP writer (STORE method — MP3s are already compressed).
 * Produces spec-compliant archives with UTF-8 filenames (flag 0x0800).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(): { time: number; date: number } {
  const d = new Date();
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Local File Header for one stored entry. */
export function zipLocalHeader(nameUtf8: Buffer, crc: number, size: number): Buffer {
  const { time, date } = dosDateTime();
  const header = Buffer.alloc(30 + nameUtf8.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(crc >>> 0, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameUtf8.length, 26);
  header.writeUInt16LE(0, 28);
  nameUtf8.copy(header, 30);
  return header;
}

/** Central Directory entry for one stored file. */
export function zipCentralEntry(nameUtf8: Buffer, crc: number, size: number, offset: number): Buffer {
  const { time, date } = dosDateTime();
  const entry = Buffer.alloc(46 + nameUtf8.length);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(0, 10);
  entry.writeUInt16LE(time, 12);
  entry.writeUInt16LE(date, 14);
  entry.writeUInt32LE(crc >>> 0, 16);
  entry.writeUInt32LE(size, 20);
  entry.writeUInt32LE(size, 24);
  entry.writeUInt16LE(nameUtf8.length, 28);
  entry.writeUInt16LE(0, 30);
  entry.writeUInt16LE(0, 32);
  entry.writeUInt16LE(0, 34);
  entry.writeUInt16LE(0, 36);
  entry.writeUInt32LE(0, 38);
  entry.writeUInt32LE(offset, 42);
  nameUtf8.copy(entry, 46);
  return entry;
}

/** End Of Central Directory record. */
export function zipEOCD(count: number, cdSize: number, cdOffset: number): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return eocd;
}

/** Writes a buffer to the response honoring backpressure. */
export async function writeDrained(response: import('http').ServerResponse, buf: Buffer): Promise<void> {
  if (!response.write(buf)) await new Promise<void>(resolve => response.once('drain', resolve));
}
