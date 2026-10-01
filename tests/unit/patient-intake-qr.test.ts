import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import { qrContainsExactUrl } from "../e2e/patient-intake-qr";

test("decodes a synthetic QR raster and requires the exact URL", () => {
  const url = "https://example.test/aporte#token=" + "a".repeat(64);
  const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
  const margin = 2, width = 224, qrWidth = modules.size + margin * 2;
  const data = new Array<number>(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const moduleX = Math.floor(x * qrWidth / width) - margin;
      const moduleY = Math.floor(y * qrWidth / width) - margin;
      const dark = moduleX >= 0 && moduleY >= 0 && moduleX < modules.size && moduleY < modules.size && Boolean(modules.get(moduleY, moduleX));
      const offset = (y * width + x) * 4;
      data[offset] = dark ? 98 : 255;
      data[offset + 1] = dark ? 85 : 255;
      data[offset + 2] = dark ? 197 : 255;
      data[offset + 3] = 255;
    }
  }
  const raster = { width, height: width, data };
  assert.equal(qrContainsExactUrl(raster, url), true);
  assert.equal(qrContainsExactUrl(raster, url + "changed"), false);
  assert.equal(qrContainsExactUrl({ ...raster, width: 0 }, url), false);
});
