import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Satori accepts TTF. Bundle static weights so link images need no font request.
// The OFL license lives beside these server-only files.
let fontsPromise: ReturnType<typeof readFonts> | undefined;

async function readFonts() {
  const [regular, semibold] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/PlusJakartaSans-Regular.ttf")),
    readFile(join(process.cwd(), "assets/fonts/PlusJakartaSans-SemiBold.ttf")),
  ]);
  return [
    { name: "Plus Jakarta Sans", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Plus Jakarta Sans", data: semibold, weight: 600 as const, style: "normal" as const },
  ];
}

export function loadFolioOgFonts() {
  fontsPromise ??= readFonts();
  return fontsPromise;
}
