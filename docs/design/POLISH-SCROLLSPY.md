# Sección activa en la navegación pública

12 de septiembre de 2026. Revisión local y sintética de `LandingScrollspy`.

## Diagnóstico comprobado

La hipótesis de una banda vacía **no se reprodujo en el Chromium disponible**: con el código anterior se midió una banda de 54 px en 1920 × 1080 y de 72 px en 2560 × 1440. Producto, Cómo funciona y Precios se detectaban al entrar. El fallo confirmado fue otro: después de visitar Precios y volver al hero, el enlace conservaba `.is-active` y `aria-current="true"`. Además, el componente sólo actualizaba los enlaces de escritorio. [Medición anterior, HTML y snapshot AX](evidence/scrollspy-before.json).

La especificación publicada por W3C describe los porcentajes de `rootMargin` respecto del ancho del rectángulo. Esa descripción y el comportamiento medido de este navegador se registran por separado. Ahora se usan píxeles derivados de la altura para expresar la banda sin esa dependencia. [W3C, definición de rootMargin](https://www.w3.org/TR/intersection-observer/#dom-intersectionobserver-rootmargin).

## Cambio

- `components/landing/landing-scrollspy.tsx` mantiene el estado de todos los enlaces de una sección, tanto de escritorio como móviles; aplica juntos `.is-active` y `aria-current="location"`.
- Conserva las intersecciones entre notificaciones parciales y limpia el estado cuando ninguna sección observada ocupa la banda, incluido el regreso al hero.
- Reconstruye el observador al cambiar el tamaño, agrupando la actualización con un frame. No añade un listener continuo de scroll ni modifica la navegación, el hash o el desplazamiento del usuario.
- Desmontar desconecta el observador, retira el listener de tamaño, cancela el frame pendiente y limpia los enlaces. Se ignoran callbacks de observadores reemplazados.

La tarea principal añadió el estilo móvil correspondiente en su CSS reservado: fondo tenue y barra lateral, conservando la señal visual junto al atributo semántico.

## Validación y evidencia

**5/5 E2E**, ESLint de los archivos y revisión de tipos correctos. [Salida](evidence/scrollspy-e2e-results.txt). El spec separado `tests/e2e/design-scrollspy.spec.ts` cubre:

1. Producto → Cómo funciona → Precios → hero a 1920 × 1080, 2560 × 1440 y 390 × 844, incluidos ambos grupos de enlaces y menú móvil.
2. Cambio de escritorio a móvil y de nuevo a escritorio, con una sola instancia activa y banda recalculada.
3. Componente real en un documento sintético con React StrictMode: desmontaje, desconexión, limpieza de enlaces, resize posterior sin nuevas instancias y nuevo montaje.

[Medición posterior y nodos AX](evidence/scrollspy-after.json): bandas positivas de 54 / 72 / 43 px respectivamente, enlaces de ambas presentaciones sincronizados y cero enlaces activos al volver al hero. Se inspeccionaron los PNG de [escritorio](evidence/scrollspy-1920-precios-after.png) y [menú móvil](evidence/scrollspy-390-precios-after.png). La extracción AX conserva nombres, roles y destinos de enlaces; el estado `aria-current` se comprobó en el HTML. No se afirma una prueba con lector de pantalla real.

Pruebas contra el servidor de desarrollo aislado existente, con peticiones externas y envíos bloqueados. No se reinició el servidor ni se realizó un build desde esta ronda.
