# Folio · estado de ramas al 01/10/2026

Corte de reconciliación anterior a esta entrega documental, sobre `master` **6bfcaa13307fe6f52fac619368d082eeb685fe9a**. Es una fotografía fechada; el [tablero activo del manager](https://github.com/OsoCordobes/FolioApp/blob/codex/launch-checkpoints/docs/LAUNCH-BOARD.md) mantiene la coordinación y los cambios posteriores. La [copia del tablero](LAUNCH-BOARD.md) y [AVANCES](AVANCES.md) en master no sustituyen una comprobación nueva antes de publicar.

| Rama remota en ese corte | Qué contiene | Destino |
|---|---|---|
| `master` · `6bfcaa13` | PR191 publicada; candidato y squash tienen árbol idéntico. | Base publicada. El checkout Desktop fue actualizado a ese SHA el01/10; se conservaron archivos ajenos. |
| `codex/launch-checkpoints` · `27d847dd` | Coordinación activa y documentación, con actualizaciones publicadas por el manager el01/10. Su delta desde merge-base no añade producto. | Integrar documentos vigentes por lotes selectivos; conservar la rama de coordinación. |
| `codex/market-ready` · `ae1d9bd7` | Producto ya absorbido por PR165. Sólo quedó como delta propio posterior un handoff fechado12/09. | Antecedente conservado; no hay merge de código pendiente. |
| `codex/patient-intake-proof` · `56a15725` | PR188 abierta, ficha pública y recuperación M147. | Retenida por H3 contractual; preflight y rollout exactos antes del merge. |

La integración por squash explica por qué una rama puede conservar commits que no figuran como ancestros de master. Para `market-ready`, su producto coincide con el ancestro `11f0206` del candidato PR165; candidato `58f534bb` y squash `c5c5fed5` comparten árbol **6a90000e1aad768e0f73484f3b7a26ff72dc7665**. No se usó `git --merged` como única prueba.

Privacidad y diseño ya entraron por [PR190](https://github.com/OsoCordobes/FolioApp/pull/190) y [PR191](https://github.com/OsoCordobes/FolioApp/pull/191), con árboles idénticos a sus candidatos. Los tracking locales `origin/codex/privacy-release` y `origin/codex/design-coherence` eran residuos: `ls-remote` no los mostró como ramas reales. Las propuestas visuales descartadas se conservan como antecedentes, sin contarlas como mejoras pendientes.

**Pendiente real:** incorporación de ficha M148/M149, editores M150 y UI reunidos en `007cff6c1a0ac3e6ed2dad64965f643fa3d931ca`, árbol `d6466114070328caaba9f1963812c2048a2096af`. El ensayo integrado aprobado y sus límites constan en el [tablero](LAUNCH-BOARD.md); el paquete sigue sin publicar y depende de PR188/H3 y de preparar rollout/CI exactos. Los hijos operativos `1de1721c` y `ac73a7af` sólo añaden el workflow de ensayo y quedan excluidos del release.

**Legal P1/L4:** preferencias y textos preparados en `codex/public-policy-alignment`, pendientes de decisiones sobre aviso, vigencia y responsable. Pro informado por el titular no acredita la cobertura contractual H3. No fusionar ese trabajo como si las decisiones ya estuvieran resueltas.

Esta entrega no aplica migraciones, publica la ficha, envía consultas, modifica proveedores ni borra ramas/worktrees. Cada paquete tiene su destino; conservar una rama histórica no significa trabajo sin integrar.
