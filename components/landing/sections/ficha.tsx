/**
 * Folio · Landing — sección "La ficha del paciente" (#ficha).
 *
 * Responde a "el botón Ver cómo funciona no muestra la app": acá se ve la app
 * por dentro — la historia clínica por especialidad, el fuerte del producto.
 * Va entre la tira de especialidades y la bóveda (tras "esto es para mí" se
 * muestra "así se ve adentro", y entrega natural a "y todo esto, cifrado").
 * Server component; el mock (SceneFicha) es decorativo (aria-hidden) y hay un
 * resumen sr-only para crawlers/lectores de pantalla.
 */

import { SceneFicha } from "../scenes/scene-ficha";

export function Ficha() {
  return (
    <section id="ficha" className="fl-section fl-ficha-section" data-fl-section="ficha">
      <div className="fl-ficha-intro fl-reveal">
        <h2 className="fl-ficha-h2">La historia clínica, pensada para tu especialidad.</h2>
        <p className="fl-ficha-lead">
          Cada nota, estudio y escala en su lugar — y la ficha se adapta a lo que tu
          práctica necesita registrar.
        </p>
      </div>

      <div className="fl-ficha-stage fl-reveal">
        <SceneFicha />
      </div>

      <p className="sr-only">
        Ejemplo de ficha clínica de cardiología en Folio: panel cardiovascular con
        tensión arterial, frecuencia cardíaca, factores de riesgo y estudios, y un
        selector de especialidad entre cardiología, psicología y quiropraxia.
      </p>
    </section>
  );
}
