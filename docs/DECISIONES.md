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

## Decisiones abiertas (sección 20), por cerrar antes de la fase indicada

| Decisión                                                | Antes de | Quién decide      |
| ------------------------------------------------------- | -------- | ----------------- |
| Proveedor de hosting en Suiza                           | Fase 6   | Juan y socio      |
| Proveedor de pago online (TWINT y tarjeta en QR/web)    | Fase 5   | Juan y socio      |
| Redondeo a 0,05 de las devoluciones en efectivo (RN-06) | Fase 4   | Juan y fiduciaria |
| Precio por sede en CHF y qué incluye                    | Piloto   | Juan y socio      |
| Hardware recomendado por sede y quién lo instala        | Fase 6   | Juan y socio      |
| Impresoras del piloto: ¿hacen falta ePOS o CloudPRNT?   | Fase 6   | Juan y socio      |
| Modelo de soporte del piloto (horario, canal, persona)  | Fase 6   | Juan y socio      |
| Nombre comercial definitivo en Suiza                    | Piloto   | Juan y socio      |
