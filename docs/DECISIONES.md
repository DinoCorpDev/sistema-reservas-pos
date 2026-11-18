# Registro de decisiones

Decisiones que el documento de requerimientos no cerraba, que lo contradicen o que fija el equipo técnico.
Cada una tiene fecha, quién decidió y qué requerimientos toca. Una decisión no se edita: si cambia, se agrega una nueva que la reemplaza.

## Tomadas con Juan Felipe (6 oct 2026, plan de la Fase 0)

### DEC-001 · Código nuevo; la auditoría de la Fase 0 del documento queda fuera

- **Contexto.** La sección 18 del documento define la Fase 0 como auditoría de Zitas y de un "repositorio externo" (licencia, KEEP/REFACTOR/REPLACE). El prompt maestro manda construir desde cero con un stack fijo.
- **Decisión.** Repositorio nuevo con el stack del prompt maestro. Zitas sigue en su propio repositorio y se conecta al Core solo por API (RF-E01…RF-E20). No se audita el repositorio externo; su licencia no aplica porque no se usa su código.
- **Toca.** Sección 18 (Fase 0), sección 20 (decisión "qué base de código manda": **cerrada, base nueva**).

### DEC-002 · MySQL de Laragon para desarrollo local; Docker Compose para CI y piloto

- **Contexto.** El equipo de desarrollo (Windows 10 Home) no tiene Docker ni WSL; sí MySQL 8.0.30 en Laragon.
- **Decisión.** En local, las bases `pos_cloud` y `pos_hub` viven en el MySQL de Laragon (`DATABASE_URL`, `HUB_DATABASE_URL`). `docker-compose.yml` define `mysql-cloud` (3306) y `mysql-hub` (3307) para quien tenga Docker, para el CI y para el piloto. Cambiar de uno a otro es solo cambiar `.env`.
- **Toca.** PA-12 (nada acoplado a un proveedor), RNF-13.

### DEC-003 · Pago online (TWINT/tarjeta en QR y web) como adaptador stub en el MVP

- **Contexto.** El documento marca DEBE el pago online (RF-D01, RF-E09, puerta de la Fase 5). El prompt maestro dice que en el MVP solo hay `cash` y `external-terminal`, con `online` como stub.
- **Decisión.** El adaptador `online` existe con su interfaz completa, pero sin proveedor real. RF-E09 y la parte online de RF-D01 quedan "DEBE · diferido por decisión" en la trazabilidad. Se retoma en la Fase 5, cuando se elija el proveedor (sección 20: wallee, Worldline u otro).
- **Toca.** RF-D01, RF-E09, RF-D25 (recibo de pedido pagado online), Flujo 2, puerta de la Fase 5.

### DEC-004 · Valores por defecto de la sección 20, configurables por sede

| Tema                              | Valor por defecto                                        | Dónde se cambia                                                              |
| --------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Región del piloto                 | Zúrich; idioma de sede y de cocina **DE**; soporte en ES | `locations.default_language`, `kitchen_language`                             |
| Descuento que pide PIN de gerente | > 20 %                                                   | `settings.managerApproval.discountAboveBp` (2000)                            |
| Anular un ítem ya enviado         | Pide PIN de gerente                                      | `settings.managerApproval.voidSentItem`                                      |
| Bloqueo de mesa reservada         | 15 min antes                                             | `settings.reservations.blockMinutesBefore`                                   |
| No-show                           | A los 20 min                                             | `settings.reservations.noShowAfterMinutes`                                   |
| Alerta de demora en cocina        | 12 min (cada estación puede tener el suyo)               | `settings.kitchen.alertAfterMinutes`, `kitchen_stations.alert_after_minutes` |
| Pagos en el MVP                   | `cash` y `external-terminal`; `online` stub (DEC-003)    | Adaptadores                                                                  |
| Hosting                           | Sin proveedor acoplado; todo corre con Docker Compose    | —                                                                            |
| Nombre en la UI                   | "Sistema Reservas POS" (marca blanca después)            | —                                                                            |

Los valores viven en `@pos/core` (`DEFAULT_LOCATION_SETTINGS`) y se guardan por sede en `locations.settings`.

## Decisiones técnicas de la Fase 0

### DEC-005 · UUID v7 guardados como `BINARY(16)`

UUID v7 generados en el dispositivo (PA-10). En MySQL se guardan en 16 bytes (no `CHAR(36)`): índices 2-4 veces más chicos y ordenados por tiempo, lo que importa al crecer a 500 sedes (RNF-09). En TypeScript siempre son strings; la conversión la hace el tipo `uuid` de `packages/db/src/columns.ts`. En SQL a mano se usa `BIN_TO_UUID(id)` / `UUID_TO_BIN(?)`.

### DEC-006 · Estados como `varchar` validados en el dominio, no `ENUM` de MySQL

Agregar un estado a un `ENUM` exige un `ALTER TABLE` que rompe a los terminales con versiones anteriores (RNF-17). Los valores válidos son uniones de TypeScript y esquemas Zod en `@pos/core`.

### DEC-007 · Claves foráneas solo en configuración y datos maestros

Las tablas de configuración y del catálogo tienen FK. Las tablas operativas que se crean sin conexión y se sincronizan (órdenes, ítems, pagos, tickets…) **no** tienen FK duras: la sincronización puede llegar fuera de orden entre terminales. Su integridad la valida el dominio al aplicar cada operación. Un test de invariantes vigila ambas reglas.

### DEC-008 · Datos de referencia como constantes del Core

Los 14 alérgenos, las claves de permiso, los nombres de eventos (sección 16), los canales y los estados son constantes en `@pos/core`. Las tablas puente (`product_allergens`, `role_permissions`) guardan la clave. Las **tasas y reglas de MWST no** son constantes: son datos con vigencia en la base (RN-02, RF-B13).

### DEC-009 · Nombre del cliente en el recibo desde CHF 400 inclusive

RF-D22 dice "cuando el total supera CHF 400"; RN-08 dice "para totales de CHF 400 o más". Se aplica RN-08 (≥ 400): las reglas de negocio mandan sobre la redacción del RF y es el criterio más conservador. Configurable en `settings.receipts.customerNameFromRappen` (40000).

### DEC-010 · TypeScript 5.9 y ESLint 9 fijados

TypeScript 7 (compilador nativo) y ESLint 10 ya existen, pero `typescript-eslint` solo soporta TypeScript < 6.1 y `eslint-config-next` 15 solo ESLint ≤ 9. Next.js se queda en 15.5 por decisión de stack. Se revisa al subir de versión mayor de Next.

### DEC-011 · Cursos numerados

Curso 0 = bebidas (salen de inmediato), 1 = entradas, 2 = platos fuertes, 3 = postres. Configurable por producto (`products.default_course`) y por ítem al tomar el pedido (RF-B11). _Podría_ volverse una tabla de cursos con nombre por sede si un piloto lo pide.

### DEC-012 · Cerveza sin alcohol como bebida sin alcohol en el seed

En el restaurante demo, la cerveza sin alcohol (≤ 0,5 % vol.) usa la categoría fiscal `non_alcoholic_beverage`, con tasa reducida para llevar. **Debe validarlo la fiduciaria del piloto** antes de usarlo con un cliente real; es un dato del catálogo, no del código.

### DEC-013 · Todo el entorno de desarrollo vive en el disco D: (reemplaza la parte local de DEC-002)

- **Contexto.** El disco C: del equipo de desarrollo tiene menos de 0,5 GB libres. La descarga de Chromium para Playwright falló por falta de espacio, y Laragon guarda los datos de MySQL en `C:\laragon\data`. Juan pidió que todo se haga en D: (6 oct 2026).
- **Decisión.** MySQL local se levanta con `pnpm mysql:start` (`scripts/dev-mysql.ps1`): usa los binarios de Laragon solo para leerlos, pero datos, configuración y logs van en `.data/mysql` dentro del repo, en `127.0.0.1:3310`, para no chocar con Laragon. Los navegadores de Playwright van en `.cache/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH` en `.env`; `pnpm e2e:install`). El store de pnpm ya está en `D:\.pnpm-store`. `.data/` y `.cache/` están en `.gitignore`. Las bases de prueba que se habían creado en el MySQL de Laragon (en C:) se borraron.
- **Toca.** DEC-002, `.env.example`, `CLAUDE.md`.

## Decisiones de la Fase 1 (Core)

### DEC-014 · API v1 con Hono + zod-openapi, en una capa de aplicación propia

- `packages/api` contiene los **casos de uso** (services) y la API REST v1. La API se escribe con Hono y `@hono/zod-openapi`: valida con Zod y genera OpenAPI 3.1 en `/api/v1/openapi.json`, con la documentación en `/api/v1/docs`.
- Next.js la monta en `apps/web/src/app/api/v1/[[...route]]` y el hub podrá montar las mismas rutas (PA-01, PA-02).
- El backoffice (Server Actions) llama **los mismos casos de uso** con el mismo actor y los mismos permisos que la API (RNF-10).
- Los errores tienen siempre la forma `{ error: { code, message, details } }`. Un recurso de otra organización responde 404, nunca 403.
- Los esquemas Zod de entrada viven en `@pos/core`. Nunca se llama `.openapi()` sobre ellos, porque Zod 4 fija los métodos por instancia.

### DEC-015 · El PIN solo identifica al usuario (HMAC por organización) y se verifica con argon2id

- RF-A06 pide que el usuario "solo se identifique". Por eso el POS no muestra lista de nombres: `users.pin_lookup = HMAC-SHA256(organizations.pin_key, PIN)` encuentra al usuario en O(1) y, con un índice único, garantiza que el PIN no se repita dentro de la organización. Después se verifica el hash argon2id.
- El terminal emparejado recibe `pin_key` y los hashes para desbloquear sin internet (`GET /terminals/offline-credentials`). Un PIN de 4-6 dígitos no resiste fuerza bruta si alguien obtiene esos datos; la protección real es tener el dispositivo y el bloqueo por intentos.
- El bloqueo (RNF-10) se cuenta por terminal con eventos de auditoría (`terminal.pin_failed` desde el último éxito, `terminal.unlocked` o `approval.granted`, dentro de `pinLockMinutes`). Vive en la base, así que funciona con varias instancias. Cada intento bloquea la fila del terminal (`FOR UPDATE`) para que los intentos simultáneos no salten el límite. Los campos `users.failed_pin_attempts` y `users.locked_until` ya no se usan y se pueden eliminar más adelante.
- La aprobación de un gerente es un token de un solo uso, válido 60 s y ligado a una acción concreta. Su control de uso único vive en memoria y pasa a un almacén compartido en la Fase 6.

### DEC-016 · Redondeo de la MWST por línea, mitad hacia arriba

- El impuesto de cada línea se extrae y se redondea al rappen (`round(bruto × tasa / (100 % + tasa))`, mitad hacia arriba, simétrico en negativos) y queda congelado en la línea (RN-04). El recibo y los reportes suman las líneas por tasa, así que el recibo siempre coincide con lo guardado.
- La diferencia frente a calcular el impuesto sobre el total de cada tasa es de, como máximo, unos pocos rappen por recibo. **Una fiduciaria suiza debe validar este criterio antes del piloto** (riesgo de la sección 20).

### DEC-017 · El alta de restaurantes la hace soporte; no hay registro público

- Lo hace la consola `/support`, con el staff de DINOLABS en `platform_staff` (Flujo 7). Se crean la organización, la sede, la plantilla suiza de roles y MWST y la cuenta del dueño, con una contraseña temporal que se muestra una sola vez y se cambia en el primer acceso.
- Soporte entra a una organización solo con un permiso del dueño, con vencimiento, y cada acción queda auditada con el staff que la hizo (RF-A10).

### DEC-018 · Lo que necesita el hub pasa a las Fases 2 y 3

- La impresión de prueba (RF-F17) necesita llegar a la impresora en la LAN, y eso lo hace el hub (Fase 3). En la Fase 1 queda la configuración de impresoras.
- La propagación de cambios a los terminales en menos de 1 minuto (RF-F23) se cumple con la sincronización de la Fase 2. El outbox ya registra los eventos que la alimentarán.

### DEC-019 · next-intl sin plugin y Auth.js v5 beta

- La interfaz se traduce con next-intl y el idioma no va en la URL: sale de la preferencia del usuario, de una cookie antes de iniciar sesión o del navegador. El alemán es el catálogo base: si falta una clave en otro idioma, se muestra en alemán.
- El plugin de next-intl carga `@swc/core`, cuyo binario nativo escribe una caché en C: (DEC-013). Por eso el alias `next-intl/config` se configura a mano en `next.config.ts`.
- Auth.js v5 sigue en beta (`5.0.0-beta.32`, fijado). Las sesiones son JWT; el cambio de sede u organización se vuelve a validar contra la base en el callback y nunca se confía en lo que manda el cliente.

### DEC-020 · La consola de soporte está en español por defecto

- El prompt maestro (§7) fija la interfaz de soporte en ES. El staff de DINOLABS no tiene idioma guardado (`platform_staff` no lo tiene): su sesión usa el idioma que elija en el selector (cookie) y, si no eligió ninguno, español. La página de inicio de sesión, antes de saber quién entra, sigue al navegador.

## Decisiones de la Fase 2 (POS y órdenes offline)

### DEC-021 · El motor de órdenes es un registro de operaciones con plegado determinista

- Cada acción del POS es una **operación inmutable** (UUID v7, que es también la clave de idempotencia) con un payload congelado: IDs nuevos, precios y MWST ya calculados, mesero de la propina. El estado de las órdenes se obtiene **plegando** las operaciones en orden canónico `(hlc, id)` con el mismo reductor puro de `@pos/core` en el dispositivo, en el hub y en la nube. Así los tres llegan al mismo resultado aunque las operaciones lleguen en distinto orden.
- El estado se guarda por ítem; `orderId` es un atributo del ítem, que cambian transferir, unir y dividir. Un reloj lógico híbrido (HLC) conserva la causalidad entre dispositivos.
- Las reglas completas de conflicto, numeración y niveles están en `docs/SYNC.md`.

### DEC-022 · Numeración de órdenes con autoridad y prefijo de respaldo

- Solo la autoridad de la sede (el hub si la sede tiene uno; si no, la nube) asigna números sin prefijo (`0042`). Una terminal que no la alcanza usa su prefijo (`K1-0007`) y su propio contador (RN-16).
- El día de negocio empieza a la hora configurada por la sede (`businessDayStartsAt`, por defecto 04:00): un servicio que pasa de medianoche sigue en el mismo día.

### DEC-023 · El PIN y las aprobaciones del POS se verifican en el dispositivo

- El POS verifica el PIN y la aprobación del gerente siempre en el dispositivo, con o sin conexión: un solo camino de código. El argon2id corre en un Web Worker (hash-wasm).
- El dispositivo no recibe el `pin_lookup` completo, que con `pin_key` permitiría probar todos los PIN en un segundo; recibe solo un **bucket de 4 bits** del HMAC para elegir los candidatos que verifica con argon2id. El bloqueo por intentos se cuenta en la terminal y se registra en la auditoría con operaciones `terminal.pin_failed` y `terminal.unlocked`.
- El servidor vuelve a validar los permisos del aprobador al plegar. Si no los tenía, la operación se aplica igual (ya ocurrió en la sala) y queda como conflicto para el gerente. Los endpoints `/terminals/unlock` y `/terminals/approve` (DEC-015) siguen para otros clientes de la API.

### DEC-024 · Un recibo por pago, congelado en el dispositivo

- Cada pago genera su recibo (RN-09). El contenido se arma y congela en el dispositivo en el momento de cobrar, porque es lo que se imprimió, y el servidor lo guarda tal cual (con su hash).
- Número: `<prefijo de la terminal>-<AAMMDD>-<contador de la terminal>`, único sin coordinación. Una reimpresión dice "KOPIE" con la hora; el número de copia lo asigna el servidor.
- El recibo de un pago parcial se sostiene solo: el monto se reparte por tasa según el bruto de la orden (mayor resto) y la MWST se extrae por tasa. Un pago único usa las sumas de las líneas (DEC-016). **La fiduciaria debe validar este criterio junto con DEC-016.**

### DEC-025 · Dividir, transferir y unir

- Dividir por ítems o por asiento crea una **orden hija** (`split_from_order_id`) que se paga aparte. Dividir en partes iguales no crea órdenes: son pagos con etiqueta (`split_label`, "1/3") sobre la misma orden.
- Transferir ítems, unir órdenes y dividir solo se permiten si la orden de origen no tiene pagos, porque un pago no se mueve (RN-14). Si dos terminales sin conexión lo violan, queda como conflicto.

### DEC-026 · Los turnos llegan con la caja (Fase 4)

- La apertura y el cierre de turno, el arqueo y la regla RN-19 ("no se cobra en efectivo sin turno abierto") se construyen en la Fase 4, junto con el resto de la caja. En la Fase 2 los pagos se registran sin turno (`shift_id` nulo) y RNF-02 queda parcial hasta entonces.

### DEC-027 · En la Fase 2 el recibo se imprime con el navegador

- Decidido con Juan. El recibo se muestra en pantalla y se imprime con el diálogo del navegador en formato de 80 mm. En la Fase 3 el hub imprime recibos y comandas por ESC/POS con el mismo contenido congelado.

### DEC-028 · El hub de la Fase 2: guarda, reenvía, numera y avisa

- El hub guarda las operaciones de la sede en `pos_hub`, las reenvía a la nube con las mismas claves de idempotencia, es la autoridad de numeración y avisa por WebSocket a las terminales. No mantiene proyección de órdenes en la Fase 2.
- Cada dispositivo guarda toda operación que conoce hasta que la nube la confirma y la reenvía al nodo que alcance. Si el hub muere, nada se pierde y no hace falta replicar entre hubs.
- La PWA vive en HTTPS y el navegador bloquea las conexiones sin cifrar hacia la red local. En producción cada hub tendrá un nombre DNS público que apunta a su IP de la LAN, con un certificado emitido por la nube (ACME DNS-01), automatizado en la Fase 6. Hasta entonces el hub corre en `localhost`. **Juan debe validarlo con hardware real**: routers con protección contra DNS rebinding y el permiso de red local de Chrome.

## Decisiones de la Fase 3 (Cocina, 7 oct 2026)

### DEC-029 · El estado de cocina es por ítem y por estación

- La cocina escribe sus propias operaciones (`kitchen.start`, `kitchen.ready`, `kitchen.recall`, `kitchen.reprint`) en el mismo registro que el POS. Un ítem avanza **en cada estación** por separado. Por ejemplo, un menú que va a cocina y a postres solo está listo cuando ambas terminaron. Su `prepStatus` se deriva de esas estaciones hasta que se sirve o se anula.
- **El ticket es (envío, estación).** `items.send` (versión 2 de las operaciones) congela el ID y el idioma de cocina de cada ticket. Una operación de la versión 1 sigue valiendo: va a todas las estaciones del ítem, sin ID de ticket. El estado del ticket no se guarda: se deriva de sus ítems. Así un ticket no puede cambiar si no lo cambia una operación, y eso es lo que comprueba la puerta de la fase.
- **Carreras entre cocina y sala.** Si la sala sirve o anula algo que la cocina marca después, no es un conflicto: la marca no tiene efecto. Solo es conflicto una operación de cocina sobre un ítem no enviado o sobre una estación que no le corresponde.
- **Permisos.** Mover tickets requiere `kitchen.operate`. Servir acepta `order.create` o `kitchen.operate`, porque la cocina también puede marcar servido (RF-C22).

### DEC-030 · El KDS es otro cliente del registro de operaciones

- `/kds` es una app cliente igual que `/pos`: pliega las operaciones de la sede con el mismo Core y escribe las suyas.
- **Runtime compartido** en `apps/web/src/device`: base local, motor, sincronización, PIN y textos. Cada app tiene su propia base IndexedDB (`sistema-reservas-pos` y `sistema-reservas-kds`), así que en un mismo navegador son dos dispositivos.
- **Un código en la app equivocada no se pierde.** Si se ingresa en el POS un código de KDS (o al revés), la vinculación pasa a la app correcta.
- **Desbloqueo.** El KDS se desbloquea una vez con el PIN de una persona con permiso de cocina (`kitchen.operate`) y no se bloquea solo; cada marca queda con su usuario. El PIN de alguien sin ese permiso (un mesero) se rechaza con un aviso.
- **Toda estación necesita salida.** Una estación activa sin KDS ni impresora deja sus comandas invisibles. La lista de verificación del montaje lo marca (`station_output`, RF-A11) y la lista de estaciones lo señala.
- **Conexión.** En la LAN funciona a través del hub (RF-C27). Sin hub funciona a través de la nube, con la consulta cada 2 s.

### DEC-031 · Solo el hub imprime; en la Fase 3, ESC/POS por TCP 9100

- **Origen de los trabajos.** Los trabajos se derivan de las operaciones (envío, anulación después de enviar, reimpresión, recibo, cajón).
  - Cada uno tiene una clave idempotente, así que una operación repetida o un reinicio del hub no imprimen dos veces.
  - Una operación más vieja que `settings.printing.maxDelayMinutes` (por defecto 15) queda `expired` y no se imprime. El cajón tiene un límite de 1 minuto.
  - Si los ítems de un envío todavía no llegaron, el trabajo espera; nunca imprime a medias.
- **Protocolo.** **Decidido con Juan:** en la Fase 3 solo ESC/POS por TCP 9100, que cubre las Epson TM y las Star en modo ESC/POS. Epson ePOS y Star CloudPRNT entran en la Fase 6, detrás de la misma interfaz, cuando se elija el hardware y se pueda probar con impresoras reales.
- **Sin hub:** el recibo se imprime con el navegador (DEC-027) y no hay comandas impresas; el KDS sigue funcionando a través de la nube.
- **Copias.** Una copia la imprime el hub solo si el POS lo pidió (`receipt.reprint` con `hubPrint`), para que no salga dos veces.

### DEC-032 · Prueba de impresión y estado de las impresoras

- La prueba se pide en el backoffice (`printers.test_requested_at`) y llega al hub con la configuración. El hub la imprime e informa el resultado con `POST /sync/printer-status`.
- El estado de cada impresora vive en `printer_status`, fuera de `configVersion`, para que una impresora que falla no haga descargar la configuración a todas las terminales.
- Las terminales se enteran por WebSocket (`printer.status`) y avisan en pantalla.

### DEC-033 · Estación sin nadie: sus comandas van al reemplazo (pedido de Juan, _Podría_)

No está en el documento: extiende RF-C21. Juan lo pidió después de que unos postres y una carne no aparecieran en cocina.

- **Configuración, sin código.** Cada estación tiene «Si no hay nadie, enviar a…» (`kitchen_stations.fallback_station_id`): otra estación activa de la sede, o ninguna. No puede apuntar a sí misma. Una estación que sirve de reemplazo no se puede borrar. En la demo, Bar y Patisserie → Küche.
- **«Hay alguien» significa** que una tablet KDS de la estación se vio en los últimos 45 s y está desbloqueada con el PIN de una persona. Cuentan todas las KDS activas configuradas para la estación, vinculadas o no: una tablet configurada pero apagada es «no hay nadie».
- **Presencia.** El KDS la dice en cada pull (encabezados `x-presence` y `x-presence-user`) y no baja su ritmo de 2 s aunque quede en segundo plano. Cada nodo la guarda en `terminal_presence`, fuera de `configVersion`. El pull la devuelve a todas las terminales, y el hub y la nube se la pasan (`POST /sync/presence`, solo el hub y solo sus terminales).
- **Decide la caja al enviar** (`routeSend()` en `@pos/core/kitchen/routing.ts`):

  | Estación                                             | Destino     |
  | ---------------------------------------------------- | ----------- |
  | Inactiva                                             | Reemplazo   |
  | Con tablets, alguien desbloqueado hace menos de 45 s | La estación |
  | Con tablets, presencia fresca y nadie desbloqueado   | Reemplazo   |
  | Con tablets y sin presencia fresca (caja sin red)    | La estación |
  | Sin tablets, con impresora activa                    | La estación |
  | Sin tablets ni impresora                             | Reemplazo   |
  - Un solo salto: el reemplazo recibe aunque tampoco haya nadie. Sin reemplazo, todo queda como antes.
  - Sin conexión no se adivina: la caja descarta la presencia y envía a la estación propia.

- **Confirmación (pedido de Juan).** Si la estación está activa pero nadie inició sesión en su tablet, la caja pregunta antes de enviar: «No hay nadie en Bar… ¿Seguro? Se enviará a Küche». Si el mesero cancela, no sale nada. Antes de pulsar Enviar ya se ve el aviso en el pedido, y después un mensaje dice qué se fue a otra estación.
- **Queda congelado** (DEC-021). Cada ticket de `items.send` lleva `replaces: [estaciones]`, con valor por defecto `[]`, así que las operaciones ya guardadas no cambian. El reductor asigna a ese ticket los ítems de las estaciones que reemplaza.
- **En cocina** el ítem muestra su origen («für Bar») en el KDS y en la comanda impresa.
- **Lista de verificación.** Una estación sin pantalla ni impresora deja de ser un problema (`station_output`) si tiene un reemplazo activo.

### DEC-034 · Globitos de «listo» y pantalla de Barra y Para llevar (pedido de Juan, _Podría_)

No está en el documento: mejora RF-C17, RF-C19 y RF-C23. Juan lo pidió después de probar la caja: el aviso de cocina se pierde en unos segundos y Barra y Para llevar abrían pedidos con un toque suelto.

- **Globito en el encabezado.** Mesas, Barra y Para llevar muestran cuántos de **sus** pedidos (los del mesero desbloqueado) tienen algo listo para entregar: `readyToServe()` en `@pos/core/tables/ready.ts`.
  - «Listo» es lo mismo que la mesa verde del mapa (`orderTableState`).
  - En Mesas se cuentan mesas: una mesa con dos pedidos cuenta una vez. En Barra y Para llevar se cuentan pedidos.
  - Desaparece cuando se sirve o se entrega. El aviso emergente sigue igual.
- **Barra y Para llevar abren una pantalla**, no un pedido.
  - La pantalla muestra los pedidos abiertos de ese tipo, de todos los meseros (en la barra se atiende lo de todos), primero los listos.
  - Un cuadro grande «+ Neue Bestellung» abre uno nuevo y se bloquea mientras abre, para que un doble toque no cree dos.
  - Se sigue cumpliendo RNF-22: Barra → + → producto.
- **Avisos.** Un toque en cualquier parte de un aviso lo cierra; ya no hay una X pequeña a la que apuntar. Vale para la caja, el KDS y el backoffice (`@pos/ui/toaster`).
- **Decidido con Juan:** los pedidos vacíos no se descartan solos ni se pregunta por ellos. El editor del salón queda para más adelante.

### DEC-035 · Un dispositivo desactivado se bloquea hasta un código nuevo (corrección de RF-A06 y RF-A12)

Juan desactivó una caja en el backoffice: la caja siguió funcionando y solo mostró «Sin conexión». Al reactivarla, nada cambió. El servidor ya rechazaba su token (`401`), pero la caja lo tomaba como falta de red.

- **La nube decide.** Un `401` de la nube al token del dispositivo significa «desvinculado».
  - La caja o el KDS guarda `revoked` en su base local, cierra la sesión y deja de sincronizar.
  - Muestra «Dispositivo desvinculado» con el campo del código de vinculación, también tras recargar.
- **Un hub no decide.** Puede tardar unos segundos en conocer un dispositivo recién vinculado, así que su `401` solo hace que el dispositivo pregunte a la nube y vuelva a probar ese hub en el siguiente latido (5 s).
- **Sin red no se puede saber.** El dispositivo sigue trabajando (RNF-02) y se bloquea en cuanto la nube responde.
- **Nada se pierde.**
  - Las operaciones sin enviar quedan en el dispositivo y salen al vincularlo de nuevo a la misma sede.
  - Un código de otra sede se rechaza mientras queden pendientes. Sin pendientes, se borran los datos locales de la sede anterior.
- **Reactivar da el código.** En el backoffice, «Activar» genera el código nuevo y lo muestra de inmediato, porque desactivar anuló el anterior.
- **Vale para todos los dispositivos vinculados** (pedido de Juan).
  - La caja, el handheld y el KDS comparten el runtime `apps/web/src/device`.
  - El **hub**, cuando la nube rechaza su token:
    - olvida el token;
    - deja de atender a las terminales y de imprimir;
    - solo responde `/health` hasta reiniciarlo con `HUB_PAIRING_CODE=<código nuevo>`.
  - Las terminales pasan solas a la nube con todo lo que no estaba confirmado.

### DEC-036 · Los meseros trabajan desde su propio teléfono («Podría», amplía RF-A06 y RF-A12)

El cliente quiere que los meseros usen **su propio teléfono** en vez de handhelds del restaurante. El documento no lo prevé: los aparatos se crean a mano en el backoffice y cualquier PIN de la sede abre cualquiera. Decidido con Juan:

- **Vincular sin trabajo del gerente.**
  - La **caja** (terminal `pos`) muestra «Vincular teléfono» con un **QR** que abre `/pos?phone=<código>`. El backoffice también da el código.
  - El código dura **5 minutos** y sirve para **varios teléfonos**, pero cada uno pide el **PIN del mesero**. Con 5 PIN errados el código muere.
  - Solo un usuario con **rol de mesero** puede vincular su teléfono.
- **El teléfono es del mesero.**
  - Hay un tipo de terminal nuevo, `phone`, que nunca se crea a mano. Se crea una fila por mesero y sede la primera vez que vincula, guardando su dueño en `terminals.user_id`, y se reutiliza en cada turno.
  - Su prefijo para numerar sin conexión se asigna solo: `T1`, `T2`… (RN-16).
  - Si vincula otro teléfono, el anterior deja de funcionar.
  - Solo se abre con el PIN de su dueño.
  - Guarda únicamente las huellas de PIN de su dueño y de quienes autorizan (RN-15), no las de todo el personal.
- **Cerrar sesión desvincula en el acto, sin vencimiento automático.**
  - El botón de apagar envía primero todo a la nube. Si algo no llegó, se niega y pide conectarse al Wi-Fi del local, para que un pedido o un cobro no se vaya en el bolsillo.
  - Con todo enviado, el teléfono anula su token (`POST /terminals/logout`) y borra sus datos.
- **El gerente** ve en «Dispositivos» quién tiene cada teléfono y desde cuándo. Si un teléfono viene vinculado de un día anterior, se resalta.
  - **Desvincular** anula el token sin desactivar. El teléfono borra sus datos solo si no tiene pendientes.
  - **Desactivar** impide que ese mesero vuelva a vincular su teléfono.
- **Límite conocido:** sin internet, un teléfono que cargó la app desde la nube no alcanza al hub hasta que el hub tenga HTTPS (SYNC §11.5, Fase 6). Mientras tanto toma pedidos y cobra, pero sus pedidos llegan a cocina al volver la conexión. Para probar con teléfonos reales hace falta HTTPS.

### DEC-037 · Alergias en la mesa, avisadas en cada comanda («Podría», amplía RF-C20 y RF-B05)

Juan pidió poder anotar en el pedido que un comensal es alérgico a algo, aunque lo que pida no lo lleve, para que la cocina evite la **contaminación cruzada**. El documento solo prevé los alérgenos de cada plato (RF-B05, RF-C20).

- **Qué se anota:**
  - va en el pedido (`orders.allergies`, JSON);
  - se marca cualquiera de los 14 alérgenos y/o un texto libre de hasta 200 caracteres («kiwi», «asiento 2: fresa»);
  - se escribe con `order.update`; el último cambio gana y `null` lo quita.
- **Nunca se pierde:**
  - al dividir la cuenta, la parte nueva hereda las alergias;
  - al unir pedidos, se suman.
- **Cocina:**
  - el KDS muestra una franja roja en **cada ticket** del pedido («ALLERGIE AM TISCH … Kreuzkontamination vermeiden»), en el idioma de la estación;
  - lo lee del pedido en vivo, así que una alergia anotada tarde aparece al instante.
- **Papel:**
  - toda comanda impresa del pedido la lleva arriba, entre líneas de `*`;
  - si se anota **después** de enviar, el hub imprime un **aviso de alergia** por estación con impresora, con clave `allergy:<op>:<estación>`, sin duplicados.
- **Caja:**
  - botón «Alergias» en el pedido, a un toque, y franja roja mientras haya alergia;
  - escudo rojo en la mesa del salón;
  - aviso naranja, que **no bloquea**, al agregar un producto que contenga o pueda contener un alérgeno marcado.
- **Límite:** el aviso al agregar depende de que la carta tenga sus alérgenos cargados. La de Lalín todavía no los tiene; la franja en cocina funciona igual.

## Decisiones de la Fase 4 (Caja y reportes, 13 oct 2026)

### DEC-038 · Caja: quién cobra en efectivo, turnos sin conexión y un Z que sale del dinero

Juan pidió que el modo de cobro se elija en el backoffice. Las demás reglas resuelven lo que el documento no dice sobre turnos sin conexión y cierres.

- **Modo de cobro en efectivo** (`settings.shiftMode`, «Bargeld kassieren»):
  - `terminal` (por defecto): solo la caja. El turno es de la POS o el handheld; el teléfono del mesero no cobra efectivo, pero sí tarjeta y TWINT.
  - `cashier`: cada mesero con su cartera. El turno es de la persona, en cualquier dispositivo.
  - `mixed`: los dos a la vez. POS y handheld usan el turno de la caja; el teléfono, la cartera del mesero.
  - Lo decide `shiftOwnerFor()` de `@pos/core`. El rol de mesero puede abrir y cerrar su turno por defecto (migración 0009).
- **Turnos como operaciones** (versión 3 del esquema): `shift.open`, `cash.movement` y `shift.close`.
  - Funcionan **sin conexión** (RNF-02) y se pliegan con el mismo reductor que las órdenes.
  - Un pago o una devolución nombran su turno y su día de negocio.
  - El efectivo sin turno abierto se rechaza en la pantalla; si igual ocurre, queda como conflicto `cash_without_shift`.
  - Las reglas nunca rechazan, marcan conflictos: segundo turno abierto del mismo dueño (`shift_already_open`, RN-19), dinero en un turno cerrado, ajeno o desconocido, y un cierre cuyo esperado no coincide con lo que la nube sabe (`shift_count_mismatch`).
  - El cierre **congela** el esperado y el informe tal como los vio y firmó el cajero, como el recibo en DEC-024.
- **Día de negocio:** se congela al abrir el turno. Todo el dinero de ese turno cuenta en ese Z, aunque pase la medianoche o las 04:00. Un turno de otro día que sigue abierto avisa y bloquea su Z.
- **El Z sale del dinero**, no de las órdenes:
  - ventas, medios de pago y MWST se calculan con los pagos y los recibos del día, menos las devoluciones (el MWST de una devolución se reparte sobre el recibo que devuelve);
  - por eso cuadra al rappen con lo cobrado y con el reporte de MWST;
  - de las órdenes salen solo los descuentos, las anulaciones y la cuenta de órdenes.
- **Bloqueos del cierre** (RF-D19, RN-20): turnos abiertos de ese día o antes, órdenes del día **con saldo pendiente** y un día anterior sin Z (solo cuando ya existe algún Z). Una orden pagada cuyos ítems nadie marcó servidos no bloquea.
- **Conciliación** (RF-D11): cada medio cobrado con terminal externo se compara con el total del terminal; una diferencia exige motivo.
- **Correcciones** (RF-D17, RN-21): el Z nunca se edita (trigger). El dinero de un día ya cerrado que llega después se aplica igual, queda como conflicto `day_closed` y aparece como corrección de ese Z, nunca dentro de él.
- **Devoluciones en efectivo:** se redondean a 0,05 como el cobro y la diferencia queda como redondeo de la devolución (RN-06). Decidido con Juan; falta la validación de la fiduciaria.
- **Impresión:** el hub abre el cajón al abrir turno, en cada movimiento y en cada devolución en efectivo, e imprime el informe de turno congelado. El Z lo imprime el navegador, porque es un dato de la nube.

### DEC-039 · Quién atiende cada mesa: abierto o asignado, y pasar una mesa con PIN («Podría», amplía RF-C02 y RF-C03)

Juan preguntó qué pasa si el mesero de una mesa no está y la mesa llama a otro. El documento no lo dice. Se configura por sede en el backoffice («Zuständigkeit für Tische», `settings.tableOwnership`):

- **Abierto (por defecto):** cualquier mesero toma pedidos, envía y cobra en cualquier mesa, para que el cliente no espere.
  - La mesa sigue siendo de quien la abrió: su nombre en el mapa y su propina.
  - Cada línea guarda quién la agregó, y el mesero de la mesa recibe un aviso: «Lea agregó 2 productos a tu mesa 1».
- **Asignado:** en una mesa ajena, el mesero ve el pedido en solo lectura con el botón «Tomar la mesa».
  - Trabajan en cualquier mesa quienes tienen el permiso nuevo `order.any_table`, que por defecto tienen caja, gerencia y admin.
  - Los pedidos de barra y para llevar se comparten siempre.
  - Si igual ocurre (por ejemplo, sin conexión), se aplica y queda el conflicto `not_table_owner`.
- **Pasar una mesa a otro mesero**, por ejemplo en el cambio de turno: en los dos modos pide el permiso nuevo `order.reassign`, que por defecto solo tienen gerencia y admin. En la práctica pide el **PIN de un gerente o del administrador**. Queda en la auditoría (`order.waiter_changed`, con quién la autorizó), y desde ese momento la mesa y su propina son del nuevo mesero.
- Los roles existentes reciben los permisos con la migración 0012. Se pueden ajustar por rol en el backoffice.

### DEC-040 · Una persona, un dispositivo a la vez; los errores de acceso en un modal («Podría», amplía RF-A06 y RNF-10)

Juan pidió que la misma persona no pueda tener sesión en dos dispositivos, y que los errores de PIN y de vinculación salgan en un modal.

- **Presencia de todos los dispositivos.** En cada sincronización, cada dispositivo dice si hay alguien dentro y quién: cada 2 s en uso y cada 30 s en una pestaña oculta. Antes solo lo hacían las pantallas de cocina (DEC-033). El hub y la nube se lo pasan, y cada dispositivo recibe la lista con el nombre de cada uno.
- **Al entrar con el PIN:**
  - el dispositivo pide la presencia más fresca (hasta 1,5 s);
  - si esa persona está dentro de **otro** dispositivo visto en los últimos 90 s, no la deja entrar y muestra en un modal dónde está: «Luca Rossi ya tiene la sesión abierta en “Handheld 1”»;
  - al bloquear con el candado, el dispositivo lo informa enseguida, así la persona puede entrar en otro al instante;
  - si el dispositivo se apagó sin bloquear, su sesión vence a los 90 s como máximo.
- **Sin conexión no se sabe nada y el PIN abre.** El restaurante nunca se detiene por la red. Es una regla de uso, no de seguridad del dinero: cada operación sigue llevando su persona.
- **Ajuste por sede**, «Eine Person nur auf einem Gerät gleichzeitig» (`security.oneDevicePerPerson`), activado por defecto. Las pruebas automáticas lo apagan, salvo la que lo verifica.
- **Errores en un modal.** PIN incorrecto, bloqueo por intentos, teléfono de otro mesero, sin permiso de cocina, otro dispositivo y los errores de vinculación salen en un modal con «OK» que vuelve al teclado.

## DEC-041 · Un dispositivo vinculado no se le quita a otro aparato

Antes, un código nuevo vinculaba el dispositivo en el aparato nuevo y el anterior quedaba desvinculado sin aviso. Juan pidió que no se pueda vincular otro aparato mientras el dispositivo esté ocupado, que salga una alerta y que se vuelva al menú inicial.

- **Kasse, Handheld y Küche** tienen un solo espacio cada una. Mientras están vinculadas:
  - el backoffice no genera códigos para ellas (409 `already_paired`);
  - un código que haya quedado de antes se rechaza igual.
- **En el aparato nuevo** sale la alerta «Keine freien Plätze» con el nombre del dispositivo y qué hacer. El botón lleva al menú inicial (`/`), donde se elige Kasse, Küche o Backoffice.
- **Para liberar el espacio** hay dos caminos:
  - «Entkoppeln» en el backoffice (Geräte), nuevo para estos dispositivos;
  - el botón de desvincular en la propia Kasse.

  Después se genera el código y se vincula el aparato nuevo. Las órdenes y los recibos se conservan.

- **Para más aparatos** se crea un dispositivo nuevo en el backoffice.
- **El hub y los teléfonos de meseros siguen igual:**
  - el hub lo instala un administrador, y reinstalarlo lo vuelve a vincular;
  - el teléfono de un mesero lo reemplaza su nuevo teléfono (DEC-036).

## DEC-042 · La pantalla de cocina pregunta la estación antes del PIN; el menú inicial en varios idiomas

Juan pidió que sea a prueba de errores: al tocar «Küche» el sistema pregunta qué estación (Küche, Bar, Patisserie…), y el PIN se ingresa ya sabiendo dónde se trabaja. También pidió el menú inicial en varios idiomas, porque el producto va para cualquier país.

- **Los dos modos.** En el backoffice (Geräte), cada pantalla de cocina:
  - se fija a una estación: va directo al PIN, con el nombre de la estación en grande;
  - o queda en «Beim Anmelden wählen»: antes del PIN muestra las estaciones activas con botones grandes, y el PIN muestra en grande la estación elegida, con la opción de cambiarla.
- **Al bloquear,** la pantalla vuelve a preguntar la estación para la persona siguiente.
- **Quién entra:** cualquiera con el permiso de cocina (`kitchen.operate`) entra a cualquier estación. Por defecto lo tienen el rol de cocina, el gerente y el admin. Un mesero sigue rechazado. Juan prefirió no atar personas a estaciones.
- **El ruteo sigue a la pantalla.**
  - Cada sincronización informa la estación elegida (`x-presence-station`, columna `terminal_presence.station_id`), y el hub la pasa a la nube.
  - La caja manda cada categoría a la estación que alguien eligió: bebidas al Bar, postres a Patisserie, comidas a Küche.
  - Una estación que nadie eligió va a su reemplazo, como en DEC-033.
- **La lista de verificación (RF-A11):** una pantalla que elige al entrar cuenta como salida para todas las estaciones.
- **Menú inicial en 5 idiomas** (DE, FR, IT, EN, ES), con selector:
  - arranca en el idioma del navegador;
  - la elección queda en la cookie `NEXT_LOCALE`, que también usan el login del backoffice y las pantallas de vinculación de la caja y la cocina.
  - Sumar otro idioma es agregar su carpeta en `apps/web/messages` y su código en `UI_LOCALES`.
- **Demo:** se agrega «KDS Allgemein» (D4), que pregunta la estación. Las tres pantallas fijas siguen igual.

## DEC-043 · Los reportes salen de las tablas proyectadas, con la regla del Z

Esta decisión reemplaza el comentario del módulo `reports` («alimentado por eventos»). Va con el plan aprobado de la Fase 4 (4b).

- **El dinero sale de la misma fuente que el Z** (DEC-038). Esto vale para las ventas, el MWST, el CSV contable y las propinas:
  - se toman los pagos completados de los días de negocio del período y las devoluciones de esos días;
  - cada uno lleva el MWST de su recibo.

  Así, un período de días enteros da exactamente la suma de sus Z. El cálculo de MWST lo comparten los dos (`netTaxes`) y las pruebas lo verifican al rappen.

- **Las ventas por categoría y producto** salen de las líneas de las órdenes **cerradas** del período. Una línea no tiene pago propio, así que no pueden coincidir siempre con el Z:
  - quedan afuera las devoluciones, los pagos parciales y las órdenes pagadas otro día;
  - el reporte muestra esa diferencia en vez de esconderla.
- **El tablero del dueño** (RF-F10) va en la portada del backoffice para quien tiene `report.view`. Se actualiza cada 30 s y está pensado para el celular.
- **Formatos:**
  - **CSV:** separador `;`, UTF-8 con BOM para Excel en Suiza, montos en CHF con dos decimales y encabezados en el idioma de quien exporta. Por la API, `/api/v1/reports/accounting.csv` lleva encabezados fijos en inglés.
  - **JSON:** recibos, cierres y auditoría, tal como se guardaron.
  - **PDF:** se saca desde la impresión del navegador; al imprimir se ocultan el menú y la barra superior.
  - No se agregó ninguna dependencia nueva.
- **Límites:**
  - un reporte cubre como máximo 366 días;
  - la exportación de auditoría trae como máximo 20 000 eventos por archivo.
- **Permisos:** se usan los que ya existían, `report.view` y `audit.view`; no se agregó ninguno.

## DEC-044 · Sin Zitas: el POS no se integra con Zitas

Juan lo decidió con su jefe (15 oct 2026): el producto no incluye nada de Zitas.

- **Qué queda diferido** (⏸ en TRAZABILIDAD), con su motivo:
  - las reservas vinculadas a mesas, el check-in y los walk-ins (RF-E01…E03), y su reporte (RF-F09);
  - las confirmaciones y los avisos por WhatsApp (RF-E04, E13, E19);
  - Zita IA (RF-E20).

  Las tablas y los estados de reservas que ya existen en el Core se quedan, pero no se usan. Nada se borra.

- **Qué sigue igual:**
  - la API v1 documentada (RF-F14): cualquier sistema externo se puede conectar por ella;
  - los clientes, su consentimiento y su historial dentro del Core (RF-E14…E17).
- **La Fase 5 queda sin Zitas:**
  - menú QR por mesa (RF-E06…E08, E10);
  - takeaway en mostrador con número (RF-E12) y por web (RF-E11).

  El pago online del QR sigue diferido (DEC-003).

- **Si un cliente quiere reservas más adelante,** se decide de nuevo: reservas propias del POS, o una integración por la API.
- **Adenda (Fase 6):** también quedan ⏸ los dos requisitos de la Fase 5 que dependían de las reservas: vincular la mesa con la reserva (RF-C04) y el bloqueo de mesa antes de la reserva con no-show (RN-22). Los ajustes de RN-22 siguen en `settings` (DEC-004), sin uso.

## DEC-045 · Fase 6: piloto con hosting neutral, alertas por correo, planes con cobro manual y modo práctica

Juan lo decidió el 15 oct 2026 al aprobar el plan de la Fase 6. La Fase 5 (QR y takeaway) va después del piloto.

- **Hosting neutral (RNF-10, RNF-13, RNF-17).**
  - La nube corre con Docker Compose en cualquier Linux (`deploy/`): Caddy con HTTPS automático, dos contenedores web, `worker` (outbox, monitor, archivo legal y certificados de los hubs), MySQL 8.4 con binlog y `backup`.
  - `deploy.sh` reinicia `web-1` y `web-2` de a uno. Las migraciones y la API solo agregan, así que las terminales viejas siguen funcionando.
  - Lo que vivía en memoria y rompería con dos instancias (las aprobaciones de un solo uso, DEC-015) pasó a la base (`approval_uses`).
  - El proveedor suizo, el bucket S3 y el dominio se eligen después. Nada depende de ellos.
- **Respaldos (RNF-14, RNF-15, RF-F13).** restic cifrado cada hora hacia S3 en Suiza (48 horarios, 30 diarios, 12 mensuales). El archivo legal mensual por sede va con la etiqueta `legal`, sin vencimiento. Un test de restauración mensual compara los recibos y los Z con producción.
- **Alertas a soporte por correo (RNF-16, RNF-01).**
  - La función pura `healthIssues()` decide los problemas: hub sin señal 5 min, impresora con error, conflictos, outbox atrasado, respaldos y test de restauración.
  - El `monitor` manda un correo al abrirse cada problema y otro al resolverse.
  - `/support/status` muestra el estado en vivo.
  - La caída del servidor completo la detecta un chequeo externo de uptime (`docs/OPERACIONES.md`).
- **Logs JSON (RNF-18):** con organización, sede, terminal, usuario y `requestId`, sin secretos, en archivos diarios que se borran a los 90 días.
- **Versión y latido (RNF-17):** cada aparato informa su versión (`x-app-version`). La nube guarda `lastSeenAt` como máximo una vez por minuto, también para el hub.
- **Planes y add-ons con cobro manual.**
  - `plans`, `plan_addons` y `plan_prices` (por país y moneda) son datos; `subscriptions` y `subscription_addons` van por organización.
  - **Los límites se aplican en los casos de uso** y responden 409 con su motivo (`plan_limit`, `plan_feature`, `subscription_suspended`): crear o activar aparatos según su tipo y los módulos del plan, códigos de teléfono, usuarios, claves de API, y la propiedad de mesas restringida.
  - **Lo legal nunca se bloquea:** vender, cobrar, imprimir recibos, cerrar el Z y exportar.
  - `past_due` muestra un aviso en el backoffice y en la caja; `suspended` además frena el crecimiento.
  - Las organizaciones anteriores quedaron en Pro (migración 0019).
  - DINOLABS edita el catálogo y las suscripciones en `/support`; el dueño ve «Mi plan».
- **Perfil del negocio en el alta.**
  - **Café:** plan Café, venta en mostrador (`pos.serviceStyle = counter`, sin plano de mesas en la lista de verificación) y un rol «Team» que vende, cobra, abre turnos y opera cocina, sin reportes, cierre Z ni autorizaciones.
  - **Restaurante:** plan Restaurante y servicio a la mesa.
- **Modo práctica (RF-F22).**
  - Es otra organización (`is_training`, `training_of_id`) copiada de la real: sedes, plano, estaciones, carta, MWST, roles y personal con los mismos PIN (misma `pin_key`).
  - Los ID se remapean, también dentro de JSON. Sin correo ni contraseña, sin vinculaciones, con QR nuevos y con las impresoras apagadas.
  - Sus aparatos se vinculan desde el backoffice real, muestran la franja naranja y sus recibos dicen «ÜBUNG — KEIN GÜLTIGER BELEG». No alerta ni cuenta en los planes.
  - Una copia nueva retira la anterior (soft delete) y desvincula sus aparatos.
- **PWA:** `/pos` y `/kds` se instalan cada una con su manifiesto e íconos («Kasse», «Küche»). Una app nativa no hace falta para el piloto.
- **Manuales y runbook (RNF-21, RNF-20).** `/help/{de,es}/{rol}` tiene los manuales cortos, imprimibles y disponibles sin conexión. `docs/OPERACIONES.md` es el runbook de soporte. El modelo de soporte del piloto queda por definir con Juan.
- **Hub en el local.**
  - Docker Compose con su MySQL e `install-hub.sh` para un mini PC Linux.
  - **HTTPS del hub (DEC-028):** la nube publica `h-<id>.<zona>` → IP de la LAN y emite el certificado por ACME DNS-01 (Let's Encrypt). El hub manda solo un CSR, porque su clave privada nunca sale del equipo. El hub sirve HTTPS en 4443 y la sede recibe esa dirección como primer hub.
  - El DNS va detrás de un adaptador; el primero es Cloudflare. Sin `HUB_DNS_ZONE`, el hub sigue en HTTP.
  - Se valida con el router y las tablets reales (protección contra DNS rebinding).
- **Lo que queda pendiente de Juan y su socio:** el hosting y el almacenamiento en Suiza, el dominio y la zona DNS de los hubs, la lista de hardware, el modelo de soporte, los precios reales de los planes y la validación de la fiduciaria.

## DEC-046 · El español es idioma de contenido, no solo de soporte

Juan lo pidió (15 oct 2026): el sistema debe servir fuera de Suiza. El documento solo traía DE, FR, IT y EN para la carta, los recibos y la cocina, y ES únicamente en la interfaz.

- `CONTENT_LANGUAGES` pasa a ser DE, FR, IT, EN y **ES**: idioma principal de la organización, de la sede y de la cocina, traducciones de la carta, recibos, comandas e informe de turno.
- La interfaz usa los mismos cinco idiomas.
- **Sigue siendo suizo** (pendiente, se decide con el primer cliente fuera de Suiza): el código postal de 4 dígitos, el cantón, la UID CHE, el CHF, la zona horaria y las tasas MWST de la plantilla.

## DEC-047 · Suiza y Colombia: el país de la sede decide moneda, impuesto y documento fiscal

Juan lo pidió para mostrar el sistema a clientes en Colombia (15 oct 2026).

- **Al crear un restaurante se elige el país.** El país fija para la sede la moneda (CHF o COP), la zona horaria, el formato del código postal (4 dígitos en Suiza; 6 en Colombia, opcional), el cantón (solo en Suiza) y el documento fiscal: UID con su dígito de control, o **NIT con el dígito de verificación de la DIAN**. Las mismas reglas se aplican al editar la sede.
- **Impuesto en Colombia:** al crear el restaurante se elige el régimen.
  - Impuesto al consumo (INC) 8 %, para la mayoría de restaurantes, cafés y bares.
  - IVA 19 %, para franquicias.
  - No responsable, 0 %.

  Es una sola tasa para todo lo que se vende (en el local, para llevar y a domicilio). Como siempre, es un dato con vigencia en `tax_rates`. Los precios incluyen el impuesto y el sistema lo extrae. El nombre del impuesto que sale en el recibo («INC», «IVA») está en `settings.tax.label`.

- **Dinero:**
  - Se guarda en enteros en la unidad menor (centavos para COP), así la aritmética no cambia.
  - En pesos se muestra `$ 15.000`; los centavos solo aparecen si los hay.
  - El efectivo se redondea a **$50**, la moneda más pequeña. La diferencia se registra como redondeo, igual que en RN-06.
  - El conteo de caja y los billetes rápidos usan las denominaciones colombianas.
- **Umbral del nombre del cliente en el recibo:** $1.000.000 por defecto en Colombia, editable por sede. En Suiza sigue en CHF 400 (RN-08).
- **Recibos:**
  - Llevan su moneda; un recibo sin moneda es CHF, así los recibos suizos conservan su contenido y su hash.
  - Se corrigió de paso que la UID suiza salía con el sufijo dos veces («MWST MWST»).
- **Demo:** «Café Demo Bogotá» (`pnpm --filter @pos/api demo:colombia`), con carta en español y precios en pesos.
- **Pendiente:**
  - facturación electrónica DIAN;
  - medios de pago locales (Nequi, Daviplata);
  - los periodos de declaración de Colombia en los reportes;
  - las sedes en dos países dentro de una misma organización.

## DEC-048 · El producto se llama «Zitas POS»

Juan le puso nombre al producto (18 nov 2026). Reemplaza al «Sistema Reservas POS» provisional (DEC-004) en la interfaz, los manifiestos de las apps instalables, la documentación de la API y la cuenta de 2FA. Lo interno (paquetes, repositorio y bases locales de los aparatos) conserva su nombre, así los aparatos vinculados no pierden nada. Es solo el nombre: no cambia DEC-044 (sin integración con la app Zitas de reservas).

## Decisiones abiertas (sección 20), por cerrar antes de la fase indicada

| Decisión                                                                               | Antes de | Quién decide |
| -------------------------------------------------------------------------------------- | -------- | ------------ |
| Proveedor de hosting y de almacenamiento S3 en Suiza (el software es neutral, DEC-045) | Piloto   | Juan y socio |
| Dominio y zona DNS de los hubs (HTTPS en la LAN, DEC-045)                              | Piloto   | Juan y socio |
| Precios reales de los planes y add-ons (el catálogo es un ejemplo, DEC-045)            | Piloto   | Juan y socio |
| Proveedor de pago online (TWINT y tarjeta en QR/web)                                   | Fase 5   | Juan y socio |
| Validar el redondeo de las devoluciones en efectivo (DEC-038) y el Z basado en recibos | Piloto   | Fiduciaria   |
| Precio por sede en CHF y qué incluye                                                   | Piloto   | Juan y socio |
| Hardware recomendado por sede y quién lo instala                                       | Fase 6   | Juan y socio |
| Impresoras del piloto: ¿hacen falta ePOS o CloudPRNT?                                  | Fase 6   | Juan y socio |
| Modelo de soporte del piloto (horario, canal, persona)                                 | Fase 6   | Juan y socio |
| Nombre comercial definitivo en Suiza                                                   | Piloto   | Juan y socio |
