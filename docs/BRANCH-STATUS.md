# Folio · estado de ramas al 02/10/2026

## Actualización vigente · 02/10/2026, 08:17 Copenhague (06:17 UTC)

Consulta paginada de las ramas remotas: cuatro heads reales. `master` está en **f30388f100d4e32fc85910130b96dce2f0c2c87f**, con [PR196 integrada](https://github.com/OsoCordobes/FolioApp/pull/196). `codex/launch-checkpoints` estaba en87e25945 al corte; `codex/market-ready` conserva ae1d9bd7 y `codex/patient-intake-proof` conserva eb5ebd93. PR188 sigue retenida por H3; no se vuelve a integrar una rama histórica para vaciar la lista.

La documentación se entregará selectivamente desde master. D prepara un arreglo local de recuperación de horarios desde f30388f1; todavía no existe una PR publicada de ese paquete. Esta fotografía no incluye futuras ramas que se creen para esas entregas. Se preservan todas las copias y evidencias; recibo `C:/Users/amiun/Documents/Codex/folio-manager-evidence/checkpoint-close-20261002/heads.json`.

## Corte histórico · 01/10/2026, 20:50 Copenhague (18:50 UTC)

Consulta única de heads remotos y PRs en GitHub. Master **182919288301f474fa88f1d02eb0bb2d985ea702**. Los cuatro heads reales son:

| Rama remota · head | Estado y destino |
|---|---|
| `master` · `18291928` | Base integrada en Git. [PR192 documental](https://github.com/OsoCordobes/FolioApp/pull/192), [PR193 recuperación](https://github.com/OsoCordobes/FolioApp/pull/193), [PR194 CSS](https://github.com/OsoCordobes/FolioApp/pull/194) y [PR195 CI documental](https://github.com/OsoCordobes/FolioApp/pull/195) **MERGED**; PR195 terminó el squash a las20:48:01 Copenhague. |
| `codex/launch-checkpoints` · `b603e698` | Coordinación activa. Este documento y nuevos avances se entregan selectivamente; la rama no es una cola de producto sin integrar. |
| `codex/market-ready` · `ae1d9bd7` | Historial de producto ya absorbido por [PR165](https://github.com/OsoCordobes/FolioApp/pull/165); no hay merge de código pendiente. Prueba de absorción reutilizada del informe de reconciliación, sin repetir la investigación. |
| `codex/patient-intake-proof` · `eb5ebd93` | [PR188](https://github.com/OsoCordobes/FolioApp/pull/188) **OPEN**, retenida por H3. Head vigente distinto del corte histórico inferior; antes de cualquier rollout deben revisarse candidato/base/pins/ledger actuales. |

**Sin integrar realmente:** PR188 y el paquete local de incorporación M148/M149 + editores M150 + UI (`007cff6c`), dependientes de H3 y rollout/CI exactos; también P1/L4 requieren decisiones humanas. Ninguna de esas entregas se libera por los cuatro merges anteriores. Los wrappers de ensayo quedan fuera. Ramas locales y tracking residuales no prueban trabajo remoto pendiente; privacidad y diseño ya se integraron por PR190/191.

El corte sólo acredita estado Git/PR; no vuelve a verificar despliegue, CI, ledger ni contrato. No se eliminó ninguna rama, worktree o evidencia. Recibo privado: `C:/Users/amiun/Documents/Codex/folio-manager-evidence/branch-reconciliation-20261001/current-map/`, con SHA master, snapshot y hash final. A revisará y publicará esta actualización junto a los avances.

## Corte histórico conservado · documento publicado por PR192

Texto del corte anterior preservado a continuación. Sus heads y pendientes fechados no sustituyen la sección vigente.

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
