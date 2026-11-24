# ReKids · Paquete instalable de integración — sandbox

Versión 0.3.0 · 23/11/2026. **Solo pruebas con datos ficticios. No conectado a ReKids real.**

## Qué prepara su desarrollador

1. Un **proyecto Supabase nuevo, vacío y de su propia cuenta**. Si tiene cupo gratuito, puede usarlo; verificar el plan antes de crear recursos. No hay obligación de contratar servicios con nosotros. No usar bases compartidas con otra aplicación.
2. Hosting de su infraestructura que ejecute **Node.js 24 o superior**, o un contenedor Docker, con una URL HTTPS accesible desde su backend Java. No hace falta hospedar la aplicación privada ReKids ni tener acceso a nuestra infraestructura.
3. Un canal privado/gestor de secretos para su credencial. El token se genera en su equipo; no viene dentro de este ZIP.

Este paquete no crea proyectos, contrata planes, hace despliegues remotos ni utiliza cuentas nuestras. Los comandos siguientes actúan en el entorno que ustedes elijan. Cualquier costo de infraestructura elegida por ustedes debe ser evaluado y asumido por ustedes.

## Alcance funcional real

- `GET /integrations/v1/branches`: dos sucursales DEMO autorizadas.
- `GET /integrations/v1/products?branch_id=UUID&limit=50`: catálogo comercial paginado.
- `GET /integrations/v1/products/{product_id}`: ficha de producto autorizado.
- `GET /health`: estado del proceso; no prueba conectividad con la base.

Solo lectura. **No registra ventas ni pagos, no modifica precios o stock, no recibe fotos, pedidos o webhooks y no accede a producción.** Eso requiere etapas posteriores; instalar este sandbox no habilita esas funciones en ReKids real.

La disponibilidad y el precio se obtienen de las prendas ficticias en la base de pruebas. Los textos comerciales se publican explícitamente. La prenda oculta y la sucursal de control sirven para probar rechazo de acceso. Ninguna persona, cuenta bancaria, foto o código procede de la tienda real. Los códigos antiguos DEMO compartidos ilustran que un código anterior no equivale al UUID de una prenda.

## Instalación de la base — 4 pasos

En el SQL Editor del **nuevo proyecto vacío de ustedes**, ejecutar cada archivo completo y en este orden:

1. `sql/01-base-vacia.sql`: crea la estructura mínima sintética. Se cancela si hay tablas de aplicación previas. No elimina ni limpia nada.
2. `sql/02-api-lectura.sql`: crea permisos, catálogo, rate limit y función limitada. Comprueba el marcador de sandbox y utiliza una transacción.
3. `sql/03-datos-ficticios.sql`: carga 3 sucursales de prueba y 6 prendas; el acceso sigue cerrado. No es un script de reinicio: se cancela si ya se cargaron datos.
4. En una terminal de **su equipo**, ejecutar `npm run credential`. Crea dos archivos locales privados:
   - `.secrets/sandbox-credential.json`: token de pruebas, UUID y vencimiento. No se muestra el token en consola.
   - `.secrets/04-credential.sql`: contiene solo el hash del token y permisos de lectura. Ejecutar este archivo en el mismo SQL Editor para habilitar el acceso.

El acceso dura 30 días y permite únicamente `branches:read` y `catalog:read` para las dos sucursales DEMO. No es un usuario administrador ni una sesión del personal. En Windows, mantener `.secrets` en una carpeta privada de su usuario y revisar ACL: el modo POSIX 0600 no sustituye los permisos de Windows.

Después, ejecutar `sql/05-verificar.rollback.sql`: comprueba estructura y privilegios sin cambiar datos. Revisar también los Security Advisors del proyecto. Las tablas privadas tienen RLS y cero políticas de acceso a clientes por diseño; no hay que abrirlas para quitar avisos del asesor. No exponer el esquema `rekids_integrations` en la Data API. No se requieren tablas de proveedoras, bancos, liquidaciones o pagos.

No reejecutar los pasos ya exitosos como si fuera un restablecimiento. Ante un error, revisar la transacción y la base elegida; no desactivar las protecciones ni borrar tablas. No ejecutar estos archivos en ninguna base productiva.

## Arranque del gateway

No hay dependencias externas de ejecución; no necesita `npm install`. El runtime usa las APIs nativas de Node 24 y soporta el módulo TypeScript incluido. No requiere compilar Angular o instalar Java para servir esta API.

Configurar las variables de `.env.example` en el gestor de variables de su hosting, o copiarlo a `.env` para una prueba en su máquina:

```text
REKIDS_SANDBOX_ENABLED=true
SUPABASE_STAGING_REF=referencia_de_su_proyecto_vacio
SUPABASE_ANON_KEY=clave_publica_anon_o_publishable_de_su_proyecto
PORT=8080
```

`SUPABASE_STAGING_REF` es el identificador de 20 caracteres que muestra su panel Supabase. La URL se construye a partir de él. Usar la clave **pública anon/publishable**, nunca `service_role`, `sb_secret_*`, una contraseña de Postgres o una sesión de personal. El gateway rechaza esos secretos. El token de integración no se instala en el gateway: su backend Java lo envía en cada llamada.

```sh
npm test
npm start
```

Para hosting con contenedores:

```sh
docker build -t rekids-api-sandbox .
docker run --env-file .env -p 8080:8080 rekids-api-sandbox
```

Los comandos Docker construyen/ejecutan en su infraestructura; no publican una imagen o un servicio en nuestras cuentas. El contenedor excluye `.env`, `.secrets` y pruebas. La imagen usa la rama Node 24; fijar su digest según la política de su infraestructura. Su hosting debe terminar TLS/HTTPS; no exponer HTTP público ni desactivar validaciones de certificados. Configurar un límite de solicitudes en el proxy para contener abuso antes de llegar a la base.

## Conexión desde Java / Feign

Importar `openapi.json` en sus herramientas y configurar la URL real de SU gateway. El archivo conserva un servidor ficticio `.invalid`: reemplazarlo únicamente después de desplegar su entorno y probarlo.

Cada consulta al gateway envía:

```text
Authorization: Bearer <token_del_archivo_privado>
```

No mandar el token a Angular, WhatsApp, capturas, Git o bitácoras. No necesitan nuestra clave de Supabase, nuestra contraseña, acceso al panel ni credenciales de administrador. No llamar directamente a tablas o RPC desde Angular.

Prendas DEMO:

| Caso | UUID |
| --- | --- |
| Sucursal DEMO La Paz, autorizada | `10000000-0000-4000-8000-000000000001` |
| Sucursal DEMO Santa Cruz, autorizada | `10000000-0000-4000-8000-000000000002` |
| Sucursal control, debe devolver 403 en listado | `10000000-0000-4000-8000-000000000003` |
| Prenda disponible, Bs 55 ficticios | `20000000-0000-4000-8000-000000000001` |
| Prenda vendida, disponibilidad unavailable | `20000000-0000-4000-8000-000000000002` |
| Prenda oculta, debe devolver 404 | `20000000-0000-4000-8000-000000000005` |
| Prenda de control, debe devolver 404 | `20000000-0000-4000-8000-000000000006` |

`next_cursor` es opaco y solo sirve para la misma sucursal. El cliente debe recorrer todas las páginas para reconciliar su caché. No hay snapshot entre páginas, feed de bajas ni garantía de tiempo real en esta etapa; repetir la reconciliación ante cambios concurrentes. Una disponibilidad publicada no garantiza una futura venta.

## Prueba de aceptación online

En su equipo de pruebas, mantener el archivo de credencial fuera del hosting y configurar:

```text
API_BASE_URL=https://url-de-su-gateway
REKIDS_CREDENTIAL_FILE=.secrets/sandbox-credential.json
```

Ejecutar `npm run smoke`. Verifica token obligatorio, dos tiendas autorizadas, paginación, rechazo de sucursal ajena, productos ocultos, rechazo de escrituras y ausencia de campos privados. No hace ventas ni movimientos financieros. No imprime el token. Evitar ejecutarlo más de unas pocas veces por minuto: el límite compartido es 60 consultas por minuto y credencial.

Errores: 400 parámetros inválidos; 401 sin token/vencido/revocado; 403 permiso o sucursal no autorizada; 404 oculto/ajeno/inexistente; 405 escritura no admitida; 429 límite; 503 gateway deshabilitado o backend no disponible. No reintentar 400/401/403/404 ciegamente. Ante 429/503 respetar `Retry-After`. Guardar `X-Request-Id` para soporte, sin registrar cabeceras de autenticación.

## Revocar y mantener

- Para cerrar todo el sandbox: el operador ejecuta `update rekids_integrations.configuration set enabled=false where environment='test';`. Esto bloquea también el RPC, no solo el gateway.
- Para revocar una credencial: actualizar `revoked_at=now()` en `rekids_integrations.clients` **filtrando por el UUID exacto** `client_id` del archivo privado. No tocar otras credenciales.
- Para rotar: revocar la anterior, guardar los archivos viejos en un gestor privado y volver a generar. El generador no sobrescribe archivos existentes. No se entregan cuentas de administración al consumidor de la API.
- La bitácora guarda IDs técnicos y resultado, no tokens, hashes, datos personales ni cuerpos de solicitudes. Programar retención y monitoreo según su política. No hay tarea automática de purga en el paquete.

## Qué nos deben devolver

La URL HTTPS del gateway, resultado de `npm run smoke`, versión del paquete y, si falló, `X-Request-Id` y código de error. **No nos envíen el token ni contraseñas.** La integración con stock real de ReKids se coordinará después y requiere aprobación y configuración propias; este sandbox no la habilita.

Las credenciales y los datos de prueba se generan durante su instalación; el ZIP no contiene secretos. Esta entrega no contrata infraestructura, no genera gastos en cuentas nuestras ni toca producción.

## Validación de esta entrega

Verificada con Node.js 24.15.0: pruebas del gateway, generador de credenciales, validación OpenAPI, instalación SQL y smoke HTTP completo con la base PostgreSQL embebida PGlite 0.6.0, totalmente aislada. En esa prueba, `pgcrypto` se sustituyó exclusivamente por un adaptador al SHA-256 nativo de PostgreSQL, comparado con Node; el instalador distribuido utiliza `pgcrypto` real en Supabase. También se comprobaron stock/precio/versiones, bloqueo de tablas privadas, expiración, revocación, interruptor global, rate limit y rechazo de una base no vacía.

No se ejecutó ni publicó este paquete en una cuenta cloud. La aceptación final sobre SU Supabase y SU URL HTTPS se completa con `sql/05-verificar.rollback.sql`, revisión de Security Advisors y `npm run smoke`. No confundir esta entrega con un acceso ya habilitado a producción.
