/**
 * Folio · Normalización de teléfonos argentinos a E.164 (sin "+").
 *
 * Único punto de verdad para armar el destinatario de WhatsApp — tanto los
 * deep-links `wa.me/<digitos>` (botón de la ficha, WhatsApp masivo del
 * directorio, fallback del booking público) como el campo `to` del WhatsApp
 * Cloud API en el dispatcher de recordatorios. Antes cada call-site hacía su
 * propio `tel.replace(/[^0-9]/g,"")`, que dejaba los números locales AR sin el
 * `54`, sin el `9` de móvil y con el `0`/`15` de la marcación nacional → link
 * inválido (auditoría L4).
 *
 * ── Plan de numeración argentino ──────────────────────────────────────────
 * El Número Nacional Significativo (NSN) tiene SIEMPRE 10 dígitos:
 *   código de área (2, 3 o 4 dígitos) + número de abonado (8, 7 o 6).
 *   - 2 dígitos: solo "11" (CABA / Gran Buenos Aires).
 *   - 3 dígitos: capitales/ciudades grandes — empiezan con 2 o 3 (351, 341…).
 *   - 4 dígitos: localidades chicas — empiezan con 2 o 3 (2954, 3815…).
 *
 * Marcación de un MÓVIL:
 *   - nacional:      0 + área + 15 + abonado   (ej. 0351 15 555 1234)
 *   - internacional: +54 9 + área + abonado    (ej. +54 9 351 555 1234)
 *   El "15" nacional equivale al "9" que va tras el país en el formato
 *   internacional. WhatsApp exige el formato internacional: el "9" va y el
 *   "15" se descarta.
 *
 * E.164 que devolvemos (sin "+"):
 *   - móvil:  54 + 9 + NSN(10)  → 13 dígitos  (ej. 5493515551234)
 *   - fijo:   54 + NSN(10)      → 12 dígitos  (ej. 543514112233)
 *
 * Heurística móvil/fijo: si hay marcador explícito de móvil (el "9" tras el
 * país, o el "15" tras el área) → móvil. Si el número vino con prefijo de país
 * o troncal "0" pero SIN marcador → lo tratamos como fijo (así se escribe un
 * fijo). Un número local "pelado" (sin país ni "0" ni "15") se asume móvil:
 * los teléfonos de pacientes lo son casi siempre y WhatsApp solo entrega a
 * móviles. (Mismo criterio que usaba el dispatcher: `0…`→sin 9, pelado→con 9.)
 *
 * La función es idempotente: `toWhatsappE164(toWhatsappE164(x)) === toWhatsappE164(x)`,
 * importante porque re-normalizamos valores ya guardados/normalizados.
 */

const COUNTRY = "54";

/**
 * Detecta y quita el prefijo móvil "15" que va inmediatamente después del
 * código de área en la marcación nacional. Recibe el NSN ya sin país/troncal;
 * solo actúa cuando hay un "15" insertado (largo 12 = NSN(10) + "15").
 *
 * Devuelve el NSN de 10 dígitos sin el "15", o null si no había "15" que sacar.
 *
 * El orden (2 → 3 → 4 dígitos de área) es seguro, no solo heurístico: dado un
 * input AR válido, el "15" tras un área de 4 dígitos nunca cae en la posición
 * que mira la rama de 3 (el char siguiente a un área de 4 es el "1" del "15"),
 * y viceversa.
 */
function stripMobile15(nsnConPosible15: string): string | null {
  const d = nsnConPosible15;
  if (d.length !== 12) return null; // sin "15", el NSN nacional es de 10 dígitos
  // Área de 2 dígitos: el único código es "11".
  if (d.startsWith("11") && d.slice(2, 4) === "15") {
    return "11" + d.slice(4);
  }
  // Área de 3 o 4 dígitos: empiezan con 2 o 3.
  if (/^[23]/.test(d)) {
    if (d.slice(3, 5) === "15") return d.slice(0, 3) + d.slice(5); // área de 3
    if (d.slice(4, 6) === "15") return d.slice(0, 4) + d.slice(6); // área de 4
  }
  return null;
}

/**
 * Normaliza un teléfono argentino a E.164 sin "+", listo para `wa.me/<n>` o el
 * campo `to` del WhatsApp Cloud API.
 *
 * Acepta cualquier formato razonable: local ("351 411-2233"), con troncal
 * ("0351 15 555 1234"), ya internacional ("+54 9 351 555 1234", "5493515551234"),
 * con paréntesis/espacios/guiones, etc.
 *
 * Devuelve null si la entrada no se puede reducir a un NSN argentino válido de
 * 10 dígitos (vacío, basura, número extranjero) — el call-site debería
 * deshabilitar el link en ese caso.
 */
export function toWhatsappE164(rawPhone: string | null | undefined): string | null {
  if (rawPhone == null) return null;
  let d = String(rawPhone).replace(/\D/g, "");
  if (!d) return null;

  // Prefijo de acceso internacional "00" (ej. 0054…) → descartar.
  if (d.startsWith("00")) d = d.slice(2);

  let isMobile = false; // marcador explícito de móvil (9 o 15)
  let explicitLandline = false; // vino con país/troncal pero sin marcador móvil

  if (d.startsWith(COUNTRY)) {
    // Ningún código de área AR empieza con "5": un "54" inicial es el país.
    d = d.slice(COUNTRY.length);
    if (d.startsWith("9")) {
      d = d.slice(1);
      isMobile = true;
    } else {
      explicitLandline = true;
    }
  } else {
    if (d.startsWith("0")) {
      d = d.slice(1); // prefijo troncal nacional
      explicitLandline = true;
    }
    // "9" móvil sin país (ej. "9 351 555 1234"): el NSN nunca empieza con 9
    // (las áreas empiezan con 1/2/3), así que un 9 inicial sobre 11 dígitos es
    // el marcador de móvil.
    if (d.length === 11 && d.startsWith("9")) {
      d = d.slice(1);
      isMobile = true;
      explicitLandline = false;
    }
  }

  // Quitar el "15" móvil de la marcación nacional, si está.
  const without15 = stripMobile15(d);
  if (without15) {
    d = without15;
    isMobile = true;
    explicitLandline = false;
  }

  // En este punto `d` debe ser el NSN de 10 dígitos. Si no, no es un número AR
  // que podamos normalizar con confianza.
  if (d.length !== 10) return null;

  const mobile = isMobile || !explicitLandline;
  return COUNTRY + (mobile ? "9" : "") + d;
}

/**
 * Arma un deep-link `https://wa.me/<E.164>` para un teléfono AR, con texto
 * opcional. Devuelve null si el teléfono no se pudo normalizar (el call-site
 * debería deshabilitar/ocultar el link).
 */
export function waMeLink(rawPhone: string | null | undefined, message?: string): string | null {
  const phone = toWhatsappE164(rawPhone);
  if (!phone) return null;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${phone}${text}`;
}
