import jsQR from "jsqr";

type QrRaster = { width: number; height: number; data: number[] };

/** Decode pixels, returning only whether the visible QR contains the expected URL. */
export function qrContainsExactUrl(raster: QrRaster, expectedUrl: string): boolean {
  const { width, height, data } = raster;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) return false;
  try {
    return jsQR(new Uint8ClampedArray(data), width, height, { inversionAttempts: "attemptBoth" })?.data === expectedUrl;
  } catch {
    return false;
  }
}
