# Operaciones administrativas retiradas de la aplicación

La implementación de preparación de mercado retira las rutas HTTP
`/api/admin/migrate`, `/api/admin/confirm-user`, `/api/admin/seed-demo` y
`/api/admin/seed-hoy-demo`. También retira el workflow manual `seed-demo.yml`
que llamaba a una de esas rutas. No elimina pacientes, organizaciones,
historias, cuentas ni archivos existentes.

Las rutas de demostración incluían opciones para borrar o volver a crear datos;
la confirmación administrativa permitía acreditar un correo sin que su titular
completara la verificación. Un secreto compartido con los trabajos programados y
una variable de habilitación no corresponden a la verificación de identidad de
una persona. Las funciones de generación de datos sintéticos se conservan para
pruebas aisladas, sin una puerta de escritura en la aplicación publicada.

Para recuperar acceso se seguirá el flujo de autenticación del proveedor y el
procedimiento de identidad y segundo factor de `MFA-ROLLOUT.md`. No se dará por
verificado un correo sólo porque alguien solicite acceso a una ficha con ese
contacto. El soporte supervisado y su evidencia siguen siendo una condición de
lanzamiento pendiente.

Las migraciones se revisan, se prueban localmente y se aplican por la conexión
administrativa autorizada, con copia previa y orden de despliegue registrado en
`LAUNCH-RUNBOOK.md`. Los nuevos conjuntos de prueba se crearán con herramientas
locales que rechacen producción por defecto. La futura campaña alojada tiene su
propio límite, copia previa y bloqueo permanente de comunicaciones externas.

El historial de Git conserva las herramientas retiradas como antecedentes; no
se deben restaurar esas rutas para resolver una incidencia. Después de desplegar,
comprobar que las cuatro URL no ejecutan operaciones con ningún verbo HTTP y que
la configuración de crones contiene únicamente trabajadores revisados. El cambio
todavía es local y no convierte despliegues anteriores en versiones protegidas.
