# Marca de la imagen para compartir

12 de septiembre de 2026. Cambio limitado a `app/(marketing)/opengraph-image.tsx`: sustituye las tres hojas superpuestas y la F tipográfica por el componente compartido `FolioMark`, con tamaño 43 px y colores explícitos `#6255C5` / `#FFFFFF`. Se mantienen el marco de marca de 43 × 45, la imagen de 1200 × 630, los textos, la agenda ficticia y las fuentes locales.

## Validación

- El endpoint real de Next en desarrollo aislado, `/opengraph-image-pwu6ef`, respondió **200**, `image/png`, **1200 × 630**, 68.425 bytes. `ImageResponse` acepta el SVG del componente compartido. [Registro](evidence/polish-marketing-opengraph.json).
- Se abrió e inspeccionó el [PNG generado](evidence/polish-marketing-opengraph.png): símbolo Hoja clara visible, tipografía y composición legibles, sin recortes.
- ESLint del archivo y `pnpm typecheck`: correctos.
- El cargador `lib/opengraph-fonts.ts` sigue leyendo únicamente las TTF locales Regular y SemiBold. La traza del **build intermedio de las 19:11 UTC**, anterior a este cambio de símbolo, incluye ambos archivos y se verificó que existen. [Constancia de trazas](evidence/polish-opengraph-font-tracing.json). El siguiente build integrado debe volver a confirmar esas trazas para su propio snapshot.

No se editó la imagen de reservas, la marca compartida, la landing ni sus estilos. No se reinició el servidor ni se realizó un build desde esta subrevisión.
