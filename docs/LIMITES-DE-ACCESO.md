# Límite de intentos de acceso y reservas

El contador de Upstash ahora incrementa y fija su vencimiento en una sola
operación Lua. Una respuesta HTTP perdida no deja un contador sin vencimiento.
Es una ventana fija que comienza con el primer intento; los intentos rechazados
también cuentan. El límite conserva la duración y cantidad configuradas por flujo.

Redis recibe una identidad opaca HMAC con contexto y scope, usando la clave
HMAC actual. No recibe el correo, dirección IP o identificador original como
nombre del contador. No se activa rotación ni se modifica ningún índice clínico.
El prefijo nuevo es `rl:v2`; al desplegar comienza una ventana nueva. Los contadores
anteriores que tengan TTL vencen normalmente; cualquier contador antiguo sin TTL
requiere revisión administrativa separada y no se borra como parte del despliegue.

Los valores de contador/TTL malformados se tratan como fallo del proveedor, nunca
como permiso válido. Hay timeout de dos segundos. Se conserva la matriz de fallo
existente: con Upstash configurado, producción rechaza por defecto ante error;
la excepción operativa explícita `UPSTASH_FAIL_CLOSED=false` permite el acceso.
Sin configuración, el comportamiento heredado permite acceso y avisa una vez,
salvo `UPSTASH_FAIL_CLOSED=true`. El lanzamiento requiere proveedor configurado,
comprobado y sin la excepción que desactiva esta protección.

27 pruebas enfocadas pasan, incluidas respuestas corruptas, identidad opaca,
ventanas vencidas, configuración inválida y la matriz de fallo. Son pruebas con
transporte controlado; no acreditan una prueba de concurrencia en Redis real.
El ensayo alojado debe verificar el comando EVAL y los límites reales del proveedor.
