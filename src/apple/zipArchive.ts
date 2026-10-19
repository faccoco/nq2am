import { inflateRawSync } from "node:zlib";

/** Read stored (uncompressed or deflated) files from a ZIP buffer. */
export function unzipToMap(buffer: Uint8Array, accept?: (name: string) => boolean): Map<string, Buffer> {
  const data = Buffer.from(buffer);
  const files = new Map<string, Buffer>();
  const offset = findEndOfCentralDirectory(data);
  const entryCount = data.readUInt16LE(offset + 10);
  let central = data.readUInt32LE(offset + 16);

  for (let i = 0; i < entryCount; i += 1) {
    if (data.readUInt32LE(central) !== 0x02014b50) break;
    const compression = data.readUInt16LE(central + 10);
    const compressedSize = data.readUInt32LE(central + 20);
    const uncompressedSize = data.readUInt32LE(central + 24);
    const nameLength = data.readUInt16LE(central + 28);
    const extraLength = data.readUInt16LE(central + 30);
    const commentLength = data.readUInt16LE(central + 32);
    const localOffset = data.readUInt32LE(central + 42);
    const name = data.subarray(central + 46, central + 46 + nameLength).toString("utf8");
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const payloadStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = data.subarray(payloadStart, payloadStart + compressedSize);
    if (!name.endsWith("/") && (!accept || accept(name))) {
      files.set(name, inflateZipEntry(payload, compression, uncompressedSize));
    }
    central += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function inflateZipEntry(payload: Buffer, compression: number, uncompressedSize: number): Buffer {
  if (compression === 0) return Buffer.from(payload);
  if (compression !== 8) throw new Error(`Unsupported ZIP compression method ${compression}`);
  const inflated = inflateRawSync(payload);
  if (uncompressedSize && inflated.length !== uncompressedSize) {
    throw new Error("ZIP entry size mismatch");
  }
  return inflated;
}

function findEndOfCentralDirectory(data: Buffer): number {
  for (let offset = data.length - 22; offset >= 0; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end of central directory not found");
}
