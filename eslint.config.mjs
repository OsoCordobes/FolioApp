import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "app/generated/**",
      "tests/visual/**-snapshots/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    // Root layout deliberadamente carga folio.css como static asset y Geist
    // via CDN para preservar fidelidad pixel-perfect con el prototipo Claude
    // Design (ver app/layout.tsx). Esos two warnings son irrelevantes en App
    // Router con root layout.
    files: ["app/layout.tsx"],
    rules: {
      "@next/next/no-page-custom-font": "off",
      "@next/next/no-css-tags": "off",
    },
  },
  {
    // Convencion: parametros y variables que empiezan con `_` son
    // intencionalmente sin usar (stubs, callbacks de interfaz, etc.).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Framer-motion: forzar import de `m` (no `motion`) para preservar el
    // bundle splitting de LazyMotion. Si alguien importa `motion`, todos los
    // features se incluyen full bundle (+25 KB). MotionProvider tiene strict
    // mode que también lo bloquea en runtime; el lint da feedback antes.
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "framer-motion",
          importNames: ["motion"],
          message: "Importá `m` en lugar de `motion`. Folio usa LazyMotion (ver components/motion/motion-provider.tsx) y `motion` rompe el tree-shaking.",
        }],
      }],
    },
  },
];

export default eslintConfig;
