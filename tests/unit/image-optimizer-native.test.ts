import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { getSharp, imageOptimizer } from "next/dist/server/image-optimizer";

// Resolve from the optimizer itself: a root-level sharp could hide a stale Next dependency.
const require = createRequire(import.meta.url);
const optimizerPath = require.resolve("next/dist/server/image-optimizer");
const fromNext = createRequire(optimizerPath);
const sharp: ReturnType<typeof getSharp> = fromNext("sharp");
const formats = ["png", "jpeg", "webp", "avif"] as const;
const fixtures = new Map<string, Buffer>();
let logo: Buffer;
let rotatedJpeg: Buffer;

before(async () => {
  const pixels = Buffer.alloc(96 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 96; x++) {
      const offset = (y * 96 + x) * 4;
      pixels.set(x < 48 ? [113, 58, 201, 255] : [40, 180, 130, 255], offset);
    }
  }
  for (const format of formats) {
    const buffer = await sharp(pixels, { raw: { width: 96, height: 64, channels: 4 } })
      .toFormat(format).toBuffer();
    // Decode AVIF before Next installs its loader allowlist. Next intentionally bypasses AVIF inputs.
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.width, 96);
    assert.equal(metadata.height, 64);
    fixtures.set(format, buffer);
  }
  rotatedJpeg = await sharp(fixtures.get("jpeg")!).withMetadata({ orientation: 6 }).toBuffer();
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 96; x++) {
      pixels[(y * 96 + x) * 4 + 3] = x >= 16 && x < 80 && y >= 16 && y < 48 ? 255 : 0;
    }
  }
  logo = await sharp(pixels, { raw: { width: 96, height: 64, channels: 4 } }).png().toBuffer();
});

async function optimize(buffer: Buffer, input: string, output: string) {
  const result = await imageOptimizer(
    { buffer, contentType: `image/${input}`, cacheControl: "max-age=120", etag: "synthetic" },
    { href: `/synthetic.${input}`, width: 48, quality: 80, mimeType: output },
    {
      experimental: {
        imgOptConcurrency: 1, imgOptMaxInputPixels: 10_000,
        imgOptSequentialRead: true, imgOptTimeoutInSeconds: 7,
      },
      images: { dangerouslyAllowSVG: false, minimumCacheTTL: 60 },
    },
    { silent: true },
  );
  // A fallback to the original image is not proof of successful processing.
  assert.equal(result.error, undefined);
  assert.equal(result.contentType, output);
  return result.buffer;
}

// AVIF decoding is blocked by Next's loader allowlist. Inspect its encoded output
// in a fresh, network-isolated Node process without changing Next's loader policy.
const decodeAvif = `
const {createRequire}=require('node:module');
const sharp=createRequire(process.argv[1])('sharp');
const chunks=[];
process.stdin.on('data',chunk=>chunks.push(chunk));
process.stdin.on('end',async()=>{
 try {
  const buffer=Buffer.concat(chunks);
  const metadata=await sharp(buffer).metadata();
  const {data,info}=await sharp(buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const pixel=(x,y)=>[...data.subarray((y*info.width+x)*4,(y*info.width+x)*4+4)];
  console.log(JSON.stringify({width:metadata.width,height:metadata.height,format:metadata.format,
   alpha:metadata.hasAlpha,left:pixel(8,info.height/2),right:pixel(info.width-9,info.height/2),
   corner:pixel(0,0),center:pixel(info.width/2,info.height/2)}));
 } catch(error){console.error(error);process.exitCode=1;}
});`;

async function inspect(buffer: Buffer, output: string) {
  if (output === "image/avif") {
    return JSON.parse(execFileSync(process.execPath, ["-e", decodeAvif, optimizerPath], {
      input: buffer, timeout: 30_000, maxBuffer: 1024 * 1024,
    }).toString()) as {
      width: number; height: number; format: string; alpha: boolean;
      left: number[]; right: number[]; corner: number[]; center: number[];
    };
  }
  const metadata = await sharp(buffer).metadata();
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
  return {
    width: metadata.width, height: metadata.height, format: metadata.format, alpha: metadata.hasAlpha,
    left: pixel(8, info.height / 2), right: pixel(info.width - 9, info.height / 2),
    corner: pixel(0, 0), center: pixel(info.width / 2, info.height / 2),
  };
}

test("Next uses patched native sharp, libvips and libheif on the executing platform", (t) => {
  assert.equal(getSharp(1), sharp);
  assert.equal(sharp.versions.sharp, "0.35.4");
  const semver = createRequire(fromNext.resolve("sharp"))("semver");
  assert.ok(semver.gte(sharp.versions.vips, "8.18.3"));
  assert.ok(semver.gte(sharp.versions.heif, "1.23.2"));
  t.diagnostic(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version,
    next: fromNext("next/package.json").version, sharpPath: fromNext.resolve("sharp"), versions: sharp.versions }));
});

for (const input of ["png", "jpeg", "webp"]) {
  for (const output of ["image/webp", "image/avif"]) {
    test(`Next resizes synthetic ${input} to ${output} and preserves image content`, async () => {
      const buffer = await optimize(fixtures.get(input)!, input, output);
      const decoded = await inspect(buffer, output);
      assert.equal(decoded.width, 48);
      assert.equal(decoded.height, 32);
      assert.equal(decoded.format, output === "image/avif" ? "heif" : "webp");
      for (const [actual, expected] of [[decoded.left, [113, 58, 201]], [decoded.right, [40, 180, 130]]] as const) {
        for (let channel = 0; channel < 3; channel++) {
          assert.ok(Math.abs(actual[channel] - expected[channel]) <= 15, "colour survived resize and compression");
        }
      }
    });
  }
}

test("Next preserves its intentional AVIF input passthrough", async () => {
  const input = fixtures.get("avif")!;
  const output = await optimize(input, "avif", "image/avif");
  assert.deepEqual(output, input);
});

for (const output of ["image/png", "image/webp", "image/avif"]) {
  test(`Next resizes a transparent synthetic logo to ${output} without losing alpha`, async () => {
    const decoded = await inspect(await optimize(logo, "png", output), output);
    assert.equal(decoded.width, 48);
    assert.equal(decoded.height, 32);
    assert.equal(decoded.alpha, true);
    assert.equal(decoded.corner[3], 0);
    assert.equal(decoded.center[3], 255);
  });
}

test("Next applies JPEG EXIF orientation before resize", async () => {
  const decoded = await inspect(await optimize(rotatedJpeg, "jpeg", "image/jpeg"), "image/jpeg");
  assert.equal(decoded.width, 48);
  assert.equal(decoded.height, 72);
  assert.equal(decoded.format, "jpeg");
});
