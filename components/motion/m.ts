"use client";

/**
 * Folio · motion · re-export de componentes `m.*` tipados correctamente.
 *
 * Issue conocido en framer-motion 11.11.0 con LazyMotion + strict mode:
 * `m.div`, `m.aside`, etc. quedan tipados como `unknown` en TS porque el
 * proxy lazy no preserva la inferencia del element type. Resultado: errores
 * "Property 'className' does not exist on type '<unknown, unknown>'" en cada
 * JSX usage.
 *
 * Workaround: castear cada componente con su tipo correcto (HTMLMotionProps).
 * El runtime es idéntico a usar `m.X` directamente (LazyMotion sigue lazy
 * cargando las features); solo cambia la inferencia TS.
 *
 * Uso en componentes:
 *   import { MAside, MDiv } from "@/components/motion/m";
 *   <MAside className="..." initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
 *
 * Si se necesita otro element (article, section, etc.), agregarlo acá con
 * el mismo patrón. No agregar wrappers innecesarios — solo los que se usan.
 */

import { m } from "framer-motion";
import type * as React from "react";
import type { ComponentType } from "react";
import type { HTMLMotionProps } from "framer-motion";

/**
 * FIXME(framer-motion#11.11): los componentes `m.X` están tipados como
 * `<unknown, unknown>` por un bug en LazyMotion+strict combinado con la
 * version 11.11.0 pinneada. El cast a `ComponentType<HTMLMotionProps<X>>`
 * tampoco resuelve porque el tipo helper mismo está roto. Workaround:
 * cast a `any` para que el JSX acepte className/initial/animate/etc.
 *
 * El runtime no se ve afectado — LazyMotion sigue cargando lazy las features.
 * Solo perdemos type-safety dentro de estos wrappers.
 *
 * REMOVER cuando bumpeamos a framer-motion@12.x (donde el typing está fix).
 * Mientras tanto, type-safety en runtime vía LazyMotion strict + ESLint guard.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MotionFor<T extends keyof React.JSX.IntrinsicElements> = ComponentType<HTMLMotionProps<T> & any>;

export const MAside  = m.aside  as MotionFor<"aside">;
export const MDiv    = m.div    as MotionFor<"div">;
export const MSpan   = m.span   as MotionFor<"span">;
export const MUl     = m.ul     as MotionFor<"ul">;
export const MLi     = m.li     as MotionFor<"li">;
export const MArticle = m.article as MotionFor<"article">;

export { m, AnimatePresence } from "framer-motion";
