# Comprobar un sobre portátil de configuración

Esta herramienta comprueba localmente la autenticación del sobre y cuenta sus entradas. No muestra nombres ni valores, no restaura configuración y no abre respaldos clínicos. No necesita red, DPAPI ni dependencias adicionales: sólo Node.js con soporte para módulos `.mjs` en una terminal interactiva (por ejemplo, PowerShell con Node 22).

En el otro equipo o perfil autorizado, conserve juntos `verify-portable.mjs` y el lector existente `envelope.mjs`. En el repositorio están en `scripts/recovery/`; para un paquete ya extraído, copie únicamente el nuevo asistente junto a su `envelope.mjs`, sin reemplazar el lector ni los archivos de recuperación. Seleccione el sobre JSON y la clave privada **cifrada** PEM. Obtenga el contexto esperado de la evidencia de captura aprobada, independientemente del contenido del sobre.

```powershell
node .\verify-portable.mjs --envelope '.\sobre.json' --private-key '.\privada-cifrada.pem' --operation-id 'operacion-esperada' --project-id 'proyecto-esperado' --environment 'production'
```

Los tres identificadores son obligatorios; reemplace los ejemplos por el contexto aprobado. No copie automáticamente el contexto desde el sobre. Puede consultar la sintaxis con `node .\verify-portable.mjs --help`.

La herramienta solicita la frase en la terminal sin eco ni máscara. Escríbala directamente y pulse Enter; Ctrl+C cancela. No envíe la frase al chat, no la añada al comando ni a una variable de entorno, no la guarde en un archivo de texto y no use pipes/redirecciones para introducirla. Evite grabar o compartir la sesión. La entrada y el aviso requieren terminal interactiva; si falta, falla sin intentar leer una frase. Se restaura el estado previo de la terminal al terminar, cancelar o recibir fin de entrada.

El resultado satisfactorio es una sola línea como `{"authenticated":true,"secretCount":42}` (el conteo depende del sobre), con código de salida 0. Cualquier error devuelve código 1 y un mensaje genérico, sin stack, rutas, nombres, valores ni explicación criptográfica. No genera recibos ni archivos. Un proceso supervisor puede registrar únicamente el resultado público y la fecha/equipo/perfil de la comprobación según el procedimiento de custodia autorizado.

El límite del sobre es 2.100.000 bytes, el de la privada cifrada 65.536 bytes y el de la frase 4.096 bytes UTF-8. Los archivos de entrada se abren sólo para lectura. El lector `openEnvelope` conserva el algoritmo original y recibe siempre el contexto esperado explícito. La frase se mantiene en buffers de memoria y éstos se sobrescriben al terminar; Node/JavaScript y el lector pueden crear otras representaciones en memoria, por lo que esto **no promete borrado seguro absoluto de memoria**. Tampoco protege contra capturas de teclado, volcados de memoria ni terminación forzada del proceso.

Las pruebas sintéticas sólo demuestran el comportamiento del asistente. La custodia externa requiere además una copia contrastada y una apertura en el equipo/perfil independiente real. Autenticar el snapshot del 08/09 no acredita vigencia de sus credenciales ni permite reaplicar configuraciones obsoletas; no demuestra restauración integral de DB/Auth/Storage. Este asistente no modifica el ZIP existente ni realiza esa prueba real por sí solo.
