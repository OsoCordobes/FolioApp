import { quotaState, type OperationsSnapshot, type QueueKey, type MetricKey } from "@/lib/operations/model";
import styles from "./panel.module.css";
const queues: Record<QueueKey,string> = {billing_followup:"Avisos de facturación",email_delivery:"Correo",google_outbound:"Google Calendar",booking_followup:"Avisos de reservas",billing_provider:"Operaciones de cobro",billing_webhook:"Notificaciones de cobro"};
const metrics: Record<MetricKey,{label:string;source:string}> = {
 database_bytes:{label:"Base de datos",source:"Tamaño total informado por PostgreSQL; puede diferir de la medida facturada."},
 storage_bytes:{label:"Archivos",source:"Suma del inventario de Storage. Si falta un tamaño, la medición queda desconocida."},
 active_members:{label:"Miembros activos",source:"Membresías vigentes de organizaciones activas; incluye cuentas internas y sintéticas."},
 email_accepted_month:{label:"Correos aceptados este mes",source:"Aceptados registrados por Folio, mes calendario UTC. No incluye envíos fuera de esta cola ni verifica la factura del proveedor."},
};
const amount=(key:MetricKey,value:number)=>key.endsWith("_bytes")?`${(value/1024/1024).toLocaleString("es-AR",{maximumFractionDigits:2})} MiB`:value.toLocaleString("es-AR");
const date=(value:string|null)=>value?new Date(value).toLocaleString("es-AR",{timeZone:"America/Argentina/Cordoba"}):"Desconocido";
export function OperationsPanel({snapshot}:{snapshot:OperationsSnapshot}) {
 return <main className={styles.panel}>
  <header className={styles.header}><div><p className={styles.eyebrow}>Folio · acceso de operación</p><h1>Estado de operación</h1><p>Lectura de colas, capacidad y reportes. Actualizado: {date(snapshot.generatedAt)}.</p></div><a className="fi-btn fi-btn-primary" href="/operacion">Actualizar</a></header>
  <section aria-labelledby="ops-queues"><h2 id="ops-queues">Trabajo pendiente</h2><p>Los estados describen la cola local; no certifican que los servicios externos estén disponibles. Los terminales incluyen bloqueos y casos que necesitan revisión.</p>
   <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Estado de las colas"><table><thead><tr><th scope="col">Fuente</th><th scope="col">Pendientes</th><th scope="col">En proceso</th><th scope="col">Listos para procesar</th><th scope="col">Terminales</th><th scope="col">Resultado incierto</th><th scope="col">Pendiente más antiguo</th></tr></thead><tbody>
    {snapshot.queues.map(q=><tr key={q.key}><th scope="row">{queues[q.key]}</th>{q.state==="unknown"?<td colSpan={6} className={styles.unknown}>Desconocido · no se pudo leer esta fuente</td>:<><td>{q.pending}</td><td>{q.leased}</td><td>{q.due}</td><td>{q.terminal}</td><td className={q.uncertain?styles.attention:undefined}>{q.uncertain}</td><td>{q.oldestPendingAt?date(q.oldestPendingAt):"Sin pendientes"}</td></>}</tr>)}
   </tbody></table></div>
  </section>
  <section aria-labelledby="ops-capacity"><h2 id="ops-capacity">Capacidad y consumo</h2><p>{snapshot.warningPercent!==null&&snapshot.pausePercent!==null?`Política configurada: aviso al ${snapshot.warningPercent}%; evaluar detener altas e importaciones masivas al ${snapshot.pausePercent}%, o antes según la proyección. Este panel no aplica un bloqueo automático.`:"Umbrales desconocidos: no se pudo leer la política."}</p>
   <div className={styles.cards}>{snapshot.metrics.map(m=>{const state=quotaState(m,snapshot);return <article className={styles.card} key={m.key}><h3>{metrics[m.key].label}</h3><p className={styles.value}>{m.state==="known"?amount(m.key,m.value):"Desconocido"}</p><p>{m.state==="known"&&m.limit!==null?`Límite verificado: ${amount(m.key,m.limit)}`:"Sin límite verificado vigente"}</p><p className={state==="pause"?styles.attention:state==="warning"?styles.warning:styles.unknown}>{state==="pause"?"Umbral de pausa alcanzado":state==="warning"?"Umbral de aviso alcanzado":state==="within"?"Debajo del umbral configurado":"Capacidad disponible: desconocida"}</p><p className={styles.note}>{metrics[m.key].source}</p>{m.state==="known"&&m.limitValidUntil?<p className={styles.note}>Límite vigente hasta {date(m.limitValidUntil)}.</p>:null}</article>})}</div>
   <p className={styles.note}>Consumo total y cuota facturada por el proveedor de correo: desconocidos. No se presume un plan contratado ni su capacidad.</p>
  </section>
  <section aria-labelledby="ops-backup"><h2 id="ops-backup">Copias y recuperación</h2>
   {snapshot.backup.state==="no_report"?<p className={styles.unknown}>Sin reporte del proceso de copias. No hay confirmación recibida en este panel.</p>:snapshot.backup.state==="unknown"?<p className={styles.unknown}>Desconocido · no se pudo consultar el reporte.</p>:<div className={styles.card}>
    <p>Último intento reportado: {date(snapshot.backup.finishedAt)}.</p>
    <p className={snapshot.backup.stale?styles.attention:undefined}>Última copia con integridad declarada: {snapshot.backup.lastVerifiedAt?date(snapshot.backup.lastVerifiedAt):"Sin copia verificada reportada"}. {snapshot.backup.stale?"Atención: falta una copia verificada de las últimas 24 horas.":"Dentro de las últimas 24 horas; revisá también su alcance de recuperación."}</p>
    <p>Resultado declarado: {snapshot.backup.outcome==="success"?"copia finalizada":snapshot.backup.outcome==="partial"?"parcial":"falló"}. Archivo: {(snapshot.backup.archiveBytes/1024/1024).toLocaleString("es-AR",{maximumFractionDigits:2})} MiB. Objetos: {snapshot.backup.objectCount}.</p>
    <p>Integridad declarada: {snapshot.backup.integrityVerified?"verificada":"sin verificar"}. Restauración declarada: {snapshot.backup.restoreScope==="full"?"completa":snapshot.backup.restoreScope==="structure"?"sólo estructura":"sin prueba"}{snapshot.backup.restoreVerifiedAt?` (${date(snapshot.backup.restoreVerifiedAt)})`:""}.</p>
   </div>}
   <p className={styles.note}>El panel muestra metadatos recibidos; no realiza una restauración ni verifica por sí mismo el archivo. Copia fuera del equipo: sin reporte.</p>
  </section>
 </main>;
}
