/**
 * Tests de lib/config/app-url.ts — dominio único de la app (ítem 1.3).
 *
 * getAppUrl() lee env en call-time, así que cada caso manipula process.env
 * con save/restore (withEnv). El caso browser inyecta globalThis.window y lo
 * limpia en finally — si queda, contamina el resto de los casos del archivo.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { getAppHost, getAppUrl } from "../../lib/config/app-url";

const ENV_KEYS = ["NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] as const;

/** Corre `fn` con las tres envs limpias + los overrides dados; restaura siempre. */
function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("getAppUrl: NEXT_PUBLIC_APP_URL seteada → la devuelve tal cual", () => {
  withEnv({ NEXT_PUBLIC_APP_URL: "https://folio.app" }, () => {
    assert.equal(getAppUrl(), "https://folio.app");
  });
});

test("getAppUrl: env con trailing slash → lo stripea", () => {
  withEnv({ NEXT_PUBLIC_APP_URL: "https://folio.app/" }, () => {
    assert.equal(getAppUrl(), "https://folio.app");
  });
});

test("getAppUrl: sin env, con window → window.location.origin", () => {
  withEnv({}, () => {
    (globalThis as Record<string, unknown>).window = {
      location: { origin: "https://preview-x.vercel.app" },
    };
    try {
      assert.equal(getAppUrl(), "https://preview-x.vercel.app");
    } finally {
      delete (globalThis as Record<string, unknown>).window;
    }
  });
});

test("getAppUrl: sin env ni window, VERCEL_PROJECT_PRODUCTION_URL → agrega https://", () => {
  withEnv({ VERCEL_PROJECT_PRODUCTION_URL: "folio-app-ten.vercel.app" }, () => {
    assert.equal(getAppUrl(), "https://folio-app-ten.vercel.app");
  });
});

test("getAppUrl: sin env/window/PROD_URL, VERCEL_URL → agrega https://", () => {
  withEnv({ VERCEL_URL: "folio-abc123.vercel.app" }, () => {
    assert.equal(getAppUrl(), "https://folio-abc123.vercel.app");
  });
});

test("getAppUrl: nada seteado → localhost:3010", () => {
  withEnv({}, () => {
    assert.equal(getAppUrl(), "http://localhost:3010");
  });
});

test("getAppUrl: precedencia — NEXT_PUBLIC_APP_URL gana sobre las VERCEL_*", () => {
  withEnv(
    {
      NEXT_PUBLIC_APP_URL: "https://folio.app",
      VERCEL_PROJECT_PRODUCTION_URL: "folio-app-ten.vercel.app",
      VERCEL_URL: "folio-abc123.vercel.app",
    },
    () => {
      assert.equal(getAppUrl(), "https://folio.app");
    },
  );
});

test("getAppHost: con env → host sin protocolo", () => {
  withEnv({ NEXT_PUBLIC_APP_URL: "https://folio.app" }, () => {
    assert.equal(getAppHost(), "folio.app");
  });
});

test("getAppHost: nada seteado → localhost:3010 (sin protocolo)", () => {
  withEnv({}, () => {
    assert.equal(getAppHost(), "localhost:3010");
  });
});
