# Recuperación verificada de claves — 8 de septiembre de 2026

Las claves de cifrado se recuperaron. La copia local perdida no era la única
forma autorizada de acceder a ellas: Vercel todavía las inyectaba en sus procesos.
No se rotaron claves ni se modificaron pacientes durante la recuperación.

## Evidencia y alcance

- Configuración local previa protegida con Windows DPAPI y permisos restringidos,
  fuera del repositorio; comprobación del contenido después de descifrar.
- Vercel CLI oficial 54.1.0 instalada y autenticada. Ensayo aislado con valores
  ficticios antes de acceder a la lista explícita de credenciales de Folio.
- Paquete AES-256-GCM con clave de contenido envuelta mediante RSA-OAEP-SHA256
  y destinatario RSA de 3072 bits. La clave privada permaneció cifrada en la PC;
  durante las tareas sólo se cargó la clave pública.
- Compilaciones sin código de Folio, dependencias ni conexión a pacientes.
  Se ejecutaron con variables de producción, sin promoción ni asignación del
  dominio, y terminaron deliberadamente con error antes de publicar una app.
- Archivo cifrado reconstruido de los registros privados y descifrado localmente.
  Se verificaron claves AES/HMAC de 32 bytes y doce credenciales principales.
  Una segunda captura del inventario completo recuperó las **42 variables de
  producción**, incluidas la configuración y las claves de Auth y observabilidad.
  Los 42 nombres coinciden con el inventario de Vercel: no quedó ninguno ausente.
- Lectura posterior, limitada a cinco filas existentes, sin escrituras: ocho
  campos descifrados y cuatro índices HMAC coincidentes. Dos campos de otra
  fila no se autenticaron; no se alteraron. La muestra prueba la utilidad de
  las claves, no la integridad de toda la base.
- Las tres tareas administrativas (ensayo y dos capturas) fueron eliminadas.
  Sus URL respondieron 404.
  `foliosalud.com/api/health` respondió 200, con el despliegue y configuración
  originales conservados.

## Credenciales principales y configuración

`FOLIO_ENC_KEY`, `FOLIO_ENC_HMAC_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL`,
`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`TURNSTILE_SECRET_KEY`, `CRON_SECRET`, `UPSTASH_REDIS_REST_TOKEN`.

El paquete completo agrega `SUPABASE_JWT_SECRET`, `SUPABASE_SECRET_KEY`,
`POSTGRES_PASSWORD`, `SENTRY_AUTH_TOKEN`, credenciales de Redis y los parámetros
de configuración de los servicios. El inventario privado conserva solamente
los nombres, tipos y entornos; el archivo de valores permanece cifrado.

No había claves `_NEXT` en esa compilación. `RESEND_API_KEY` y las credenciales
opcionales de WhatsApp no estaban presentes. Cada integración debe verificarse
con su proveedor; la ausencia no se resuelve inventando o rotando otros secretos.

Los nombres anteriores son públicos para revisión; ningún valor se incorpora
al repositorio, al informe o a mensajes.

## Custodia y pendientes

El directorio privado del propietario contiene el paquete verificado, su clave
privada cifrada, la clave pública y los comprobantes. La frase está protegida
por Windows DPAPI para el usuario actual. **DPAPI por sí solo no permite recuperar
en otra computadora**: el propietario debe conservar la frase separadamente
del paquete y del dispositivo. Los archivos de recuperación no son una copia
de las historias clínicas ni de Storage.

Se preparó `Folio-claves-recuperadas-20260908.zip`, con el paquete completo,
clave privada cifrada, clave pública, lector y explicación. El acceso local
`Guardar mi llave de Folio.cmd` abre una ventana privada para guardar la frase
en otro lugar; no se abrió automáticamente ni se mostró la frase al agente.
Un archivo de confirmación representa la declaración del propietario, no una
verificación independiente del lugar físico donde la guardó.

Pendientes: custodia independiente de la frase, copia física del paquete, prueba
de recuperación en un entorno aislado con datos y archivos, y revisión de los
dos campos de la muestra que no se pudieron autenticar. No marcar la etapa de
recuperación completa antes de comprobar esos entregables.

## Herramientas y repetición

`scripts/recovery/` contiene el formato, extractor, ensayo y verificación.
`pnpm test:recovery` comprueba el formato con claves ficticias, alteraciones y
registros fragmentados. La sonda de datos existente es un procedimiento puntual
del propietario, requiere un argumento explícito y nunca forma parte del test
automático ni de una ruta de la aplicación. Una nueva recuperación debe usar
otro identificador y directorio, revisar destinatario/lista/entorno/caducidad y
ensayar primero; no reutilizar ciegamente los manifiestos de esta sesión.
