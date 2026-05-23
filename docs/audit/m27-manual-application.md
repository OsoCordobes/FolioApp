# M27 storage buckets — aplicación manual requerida

**Estado**: la migración `20260524000027_M27_storage_clinical.sql` está commiteada
en el repo pero **NO se puede aplicar via `scripts/push-pending-migrations.mjs`**
porque crea policies sobre `storage.objects` y ese table es owned por
`supabase_storage_admin`, no por `postgres`. Intento via service_role devuelve:

```
must be owner of relation objects
```

## Cómo aplicar (founder one-shot)

1. Abrir el Supabase Dashboard del proyecto.
2. Ir a **SQL Editor** → **New query**.
3. Copiar el contenido completo de `supabase/migrations/20260524000027_M27_storage_clinical.sql`.
4. Ejecutar. El SQL Editor corre con permisos elevados que sí pueden tocar
   `storage.objects`.
5. Marcar como aplicada en `schema_migrations`:

   ```sql
   INSERT INTO supabase_migrations.schema_migrations (version, name)
   VALUES ('20260524000027', 'M27_storage_clinical')
   ON CONFLICT (version) DO NOTHING;
   ```

6. Verificar correctas las RLS:

   ```sql
   SELECT policyname FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
   ORDER BY policyname;
   ```

   Deberían aparecer 4 policies nuevas: clinical read/write para
   `documentos-clinicos` y `consentimientos-firmados`.

## Por qué importa

M07 (consentimientos) y M08 (documentos_clinicos) tienen CHECK constraints
sobre paths en estos buckets pero el bucket nunca fue creado por código —
sin M27 los uploads fallan en runtime con "Bucket not found". Worse case:
si los buckets se crearon manualmente desde el Dashboard SIN RLS,
cualquiera con la URL puede bajarse PHI directa (fuga Ley 26.529).

M27 cierra ambos casos: crea los buckets como privados y los gates por
`can_read_clinical(org)` en cada path.

## Seguimiento

Una vez aplicada, ejecutar la spec:

```bash
node --env-file=.env.local scripts/push-pending-migrations.mjs
```

(debería pasar M27 sin reintentar, y aplicar M28 a continuación)
