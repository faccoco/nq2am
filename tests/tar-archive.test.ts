import assert from "node:assert/strict";
import test from "node:test";
import { iterateTarStream, xzChunks } from "../src/apple/tarArchive.js";

test("XZ decompression supports the package's CommonJS export shape", async () => {
  const compressed = Buffer.from(
    "/Td6WFoAAATm1rRGBMANCSEBFgAAAAAAAAAAAF9PM+QBAAhoZWxsbyB4egoAAAAAwUk6+mNSFFoAASkJZJIcHR+2830BAAAAAARZWg==",
    "base64"
  );
  const output: Buffer[] = [];
  for await (const chunk of xzChunks(compressed)) output.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(output).toString("utf8"), "hello xz\n");
});

test("streaming tar reader decodes GNU base-256 sizes larger than 8 GiB", async () => {
  const expectedSize = 17_460_210_739;
  const header = Buffer.alloc(512);
  header.write("mbdump/artist", 0, "utf8");
  header[156] = "0".charCodeAt(0);
  writeBase256(header.subarray(124, 136), expectedSize);

  async function* chunks(): AsyncGenerator<Uint8Array> {
    yield header;
  }

  const entries = iterateTarStream(chunks());
  const first = await entries.next();
  assert.equal(first.done, false);
  assert.equal(first.value?.name, "mbdump/artist");
  assert.equal(first.value?.size, expectedSize);
  await entries.return(undefined);
});

function writeBase256(field: Buffer, number: number): void {
  let value = BigInt(number);
  for (let index = field.length - 1; index >= 0; index -= 1) {
    field[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  assert.equal(value, 0n);
  field[0] |= 0x80;
}
