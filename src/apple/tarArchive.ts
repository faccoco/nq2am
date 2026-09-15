export type TarEntry = { name: string; data: Buffer };

export type TarStreamEntry = {
  name: string;
  size: number;
  read: (maxBytes: number) => Promise<Buffer>;
  skip: () => Promise<void>;
};

export function isXzBuffer(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 6 &&
    buffer[0] === 0xfd &&
    buffer[1] === 0x37 &&
    buffer[2] === 0x7a &&
    buffer[3] === 0x58 &&
    buffer[4] === 0x5a &&
    buffer[5] === 0x00
  );
}

export function parseTar(buffer: Uint8Array): TarEntry[] {
  const data = Buffer.from(buffer);
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarString(header.subarray(0, 100));
    const size = readTarNumber(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] ?? 0);
    offset += 512;
    const content = data.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if ((type === "0" || type === "\0") && name) entries.push({ name, data: Buffer.from(content) });
  }
  return entries;
}

export async function decompressXz(buffer: Uint8Array): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of xzChunks(buffer)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function* xzChunks(buffer: Uint8Array): AsyncGenerator<Uint8Array> {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(buffer);
      controller.close();
    }
  });
  yield* xzChunksFromWebStream(body);
}

export async function* xzChunksFromFile(path: string): AsyncGenerator<Uint8Array> {
  const { createReadStream } = await import("node:fs");
  const { Readable } = await import("node:stream");
  const node = createReadStream(path);
  try {
    yield* xzChunksFromWebStream(Readable.toWeb(node) as ReadableStream<Uint8Array>);
  } finally {
    node.destroy();
  }
}

async function* xzChunksFromWebStream(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const imported = await import("xz-decompress");
  // xz-decompress is CommonJS. Depending on the Node loader, its class is exposed either as a
  // synthetic named export or under default.
  const XzReadableStream =
    imported.XzReadableStream ??
    (imported.default as unknown as { XzReadableStream: typeof imported.XzReadableStream }).XzReadableStream;
  const reader = new XzReadableStream(body).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value?.byteLength) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* iterateTarStream(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<TarStreamEntry> {
  const reader = new ByteReader(chunks);
  let pendingName: string | undefined;
  for (;;) {
    const header = await reader.read(512);
    if (!header || header.length < 512 || header.every((byte) => byte === 0)) break;
    const type = String.fromCharCode(header[156] ?? 0);
    const size = readTarNumber(header.subarray(124, 136));
    const padded = Math.ceil(size / 512) * 512;
    const prefix = readTarString(header.subarray(345, 500));
    const base = readTarString(header.subarray(0, 100));
    const headerName = prefix ? `${prefix}/${base}` : base;
    const name = pendingName ?? headerName;
    pendingName = undefined;

    if (type === "L") {
      const raw = await reader.read(size);
      pendingName = raw.toString("utf8").replace(/\0.*$/u, "").trim();
      await reader.skip(padded - size);
      continue;
    }
    if (type === "x" || type === "g") {
      const raw = await reader.read(size);
      if (type === "x") {
        const path = paxPath(raw.toString("utf8"));
        if (path) pendingName = path;
      }
      await reader.skip(padded - size);
      continue;
    }

    let remaining = size;
    let paddedSkipped = false;
    const entry: TarStreamEntry = {
      name,
      size,
      read: async (maxBytes) => {
        const take = Math.min(remaining, maxBytes);
        if (take <= 0) return Buffer.alloc(0);
        const chunk = await reader.read(take);
        remaining -= chunk.length;
        return chunk;
      },
      skip: async () => {
        if (remaining > 0) await reader.skip(remaining);
        remaining = 0;
        if (!paddedSkipped) {
          await reader.skip(padded - size);
          paddedSkipped = true;
        }
      }
    };
    yield entry;
    await entry.skip();
  }
}

class ByteReader {
  private leftover = Buffer.alloc(0);
  private readonly iterator: AsyncIterator<Uint8Array>;

  constructor(chunks: AsyncIterable<Uint8Array>) {
    this.iterator = chunks[Symbol.asyncIterator]();
  }

  async read(n: number): Promise<Buffer> {
    while (this.leftover.length < n) {
      const next = await this.iterator.next();
      if (next.done) {
        const rest = this.leftover;
        this.leftover = Buffer.alloc(0);
        return rest;
      }
      this.leftover = Buffer.concat([this.leftover, Buffer.from(next.value)]);
    }
    const out = this.leftover.subarray(0, n);
    this.leftover = this.leftover.subarray(n);
    return Buffer.from(out);
  }

  async skip(n: number): Promise<void> {
    let left = n;
    while (left > 0) {
      if (this.leftover.length === 0) {
        const next = await this.iterator.next();
        if (next.done) return;
        this.leftover = Buffer.from(next.value);
      }
      const take = Math.min(left, this.leftover.length);
      this.leftover = this.leftover.subarray(take);
      left -= take;
    }
  }
}

function paxPath(text: string): string | undefined {
  for (const line of text.split(/\n/u)) {
    const match = /^\d+\s+path=(.*)$/u.exec(line.trimEnd());
    if (match) return match[1];
  }
  return undefined;
}

function readTarString(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  return bytes
    .subarray(0, end === -1 ? bytes.length : end)
    .toString("utf8")
    .trim();
}

/**
 * POSIX tar normally stores numbers as ASCII octal. GNU tar switches to a big-endian base-256
 * representation when a value no longer fits that field; current MusicBrainz artist dumps need
 * this because mbdump/artist is larger than 8 GiB when decompressed.
 */
function readTarNumber(bytes: Buffer): number {
  if (bytes.length === 0) return 0;
  if ((bytes[0] & 0x80) === 0) {
    const octal = readTarString(bytes);
    if (octal === "") return 0;
    if (!/^[0-7]+$/u.test(octal)) throw new Error(`Invalid tar numeric field: ${JSON.stringify(octal)}`);
    return Number.parseInt(octal, 8);
  }

  if ((bytes[0] & 0x40) !== 0) throw new Error("Negative tar entry size is not supported");
  let value = BigInt(bytes[0] & 0x3f);
  for (let index = 1; index < bytes.length; index += 1) {
    value = (value << 8n) | BigInt(bytes[index]);
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Tar entry size exceeds JavaScript's safe integer range: ${value}`);
  }
  return Number(value);
}
