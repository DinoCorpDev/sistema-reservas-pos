# SYNC.md · Sincronización offline-first

Este documento define cómo el POS sigue operando sin internet y cómo se pone de acuerdo después (RNF-02 a RNF-05, RF-C18, RF-F23, RN-16). Lo exigía el prompt maestro (§4) antes de implementar la Fase 2. Las decisiones de fondo están en `docs/DECISIONES.md` (DEC-021 a DEC-028).

**Meta:** cero órdenes o pagos perdidos o duplicados, sin importar en qué orden ni por qué camino lleguen las operaciones.

## 1. Niveles

| Nivel                | Cuándo                                    | Quién numera (RN-16)     | Cómo se ven los demás dispositivos      |
| -------------------- | ----------------------------------------- | ------------------------ | --------------------------------------- |
| **1. Terminal sola** | No alcanza ni hub ni nube                 | La terminal, con prefijo | No los ve hasta reconectar              |
| **2. Hub en la LAN** | Alcanza un hub de la sede                 | El hub (autoridad)       | Aviso por WebSocket, < 2 s (RNF-07)     |
| **3. Nube**          | No hay hub (o no responde) y hay internet | La nube, si es autoridad | Consulta cada 2 s mientras el POS opera |

- La terminal prueba los nodos en orden: los hubs de la sede (`settings.sync.hubUrls`, en orden), después la nube. Usa el primero que responda a un latido HTTP (`GET /api/v1/sync/ping` con 2 s de espera, cada 5 s). Si ninguno responde, opera sola. No se usa el cierre del WebSocket para detectar el corte.
- **La autoridad de numeración** es el primer hub de la lista si la sede tiene hubs; si no, la nube. Solo la autoridad entrega números sin prefijo.
- **Indicador (todas las pantallas del POS):** el nivel actual (sola, hub, nube) y, aparte, "pendiente: N". N es la cantidad de operaciones de este dispositivo que **la nube** todavía no confirmó. Con hub y sin internet, N crece aunque el hub ya las tenga.

## 2. Operaciones

Cada acción del POS genera una **operación inmutable**. Nunca se edita ni se borra; una corrección es otra operación.

### 2.1 Envoltura

| Campo                                                  | Contenido                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                   | UUID v7 generado en el dispositivo. Es también la **clave de idempotencia**.                                             |
| `type`                                                 | Tipo de operación (tabla 2.2).                                                                                           |
| `schemaVersion`                                        | Versión del payload. El servidor acepta versiones anteriores: una tablet que estuvo 24 h sin conexión trae código viejo. |
| `hlc`                                                  | Reloj lógico híbrido (§3).                                                                                               |
| `deviceAt`                                             | Hora del dispositivo, ya corregida con el desfase medido contra el servidor.                                             |
| `organizationId`, `locationId`, `terminalId`, `userId` | Quién y dónde. El usuario se autenticó con PIN en el dispositivo (§7).                                                   |
| `orderId`                                              | Orden principal afectada.                                                                                                |
| `relatedOrderId`                                       | Segunda orden afectada (destino de una transferencia, unión o división).                                                 |
| `approval`                                             | `{ approverUserId, permissions, reason? }` cuando la acción necesitó un gerente (RN-15).                                 |
| `payload`                                              | Datos del tipo, **congelados** (§2.3).                                                                                   |

### 2.2 Tipos

| Tipo                                        | Qué hace                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `order.open`                                | Abre una orden: canal, tipo de consumo, mesa, comensales, mesero, número asignado.                                              |
| `order.update`                              | Cambia campos de la orden (comensales, mesero, mesa, mesas unidas, nombre del cliente, nota). Solo trae los campos que cambian. |
| `order.change_channel`                      | Cambia el canal antes de pagar y recalcula la MWST de las líneas (RN-05). Trae el mapa de tasas.                                |
| `items.add`                                 | Agrega líneas con su precio, modificadores, nota, asiento, curso y MWST ya calculados.                                          |
| `item.update`                               | Cambia cantidad, nota, asiento o curso de una línea **pendiente**.                                                              |
| `items.send`                                | Envía a cocina las líneas indicadas (todo lo pendiente o un curso; "marchar" es enviar el curso siguiente).                     |
| `items.serve`                               | Marca servidas o entregadas las líneas (también "entregado" en barra y takeaway, RF-C17).                                       |
| `item.void`                                 | Anula una línea o parte de su cantidad, con motivo (RF-C10). Una anulación parcial trae el ID de la línea nueva.                |
| `discount.apply` / `discount.remove`        | Descuento por línea u orden, en % o monto, con motivo (RF-C11).                                                                 |
| `payment.record`                            | Registra un pago ya completado (efectivo o terminal independiente) **con su recibo congelado**.                                 |
| `refund.record`                             | Devolución ligada a un pago, con motivo (RF-D07, RN-14).                                                                        |
| `receipt.reprint`                           | Reimpresión marcada como copia (RF-D24).                                                                                        |
| `items.transfer`                            | Mueve líneas a otra orden (RF-C13).                                                                                             |
| `order.merge`                               | Une una orden en otra (RF-C13).                                                                                                 |
| `order.split`                               | Crea una orden hija con las líneas elegidas o las de un asiento (RF-C12).                                                       |
| `order.reopen`                              | Reabre una orden cerrada, con permiso de gerente y motivo (RF-C14).                                                             |
| `order.void`                                | Anula una orden sin pagos (RN-12: una orden sin ítems válidos ni pagos se anula, no se cierra).                                 |
| `terminal.unlocked` / `terminal.pin_failed` | Desbloqueos e intentos fallidos de PIN en la terminal: solo dejan auditoría.                                                    |
| `kitchen.start` / `kitchen.ready`           | La estación empieza o termina ítems de un ticket (RF-C22, DEC-029). El estado es por ítem **y por estación**.                   |
| `kitchen.recall`                            | Devuelve al tablero ítems que estaban listos (RF-C28).                                                                          |
| `kitchen.reprint`                           | Reimprime un ticket en su estación (RF-C26). Un ticket es `(items.send, estación)`.                                             |
| `receipt.print`                             | Pide al hub imprimir el recibo original en la impresora de la terminal (DEC-031). No cambia el estado.                          |
| `drawer.open`                               | Abre el cajón sin venta, con permiso o aprobación (RF-D18). No pertenece a una orden.                                           |

**Versión 2 (Fase 3).** `items.send` trae `tickets: [{ ticketId, stationId, language }]`: una entrada por estación activa que recibe ítems, con el ID y el idioma de cocina congelados (RF-C21, RF-C25). Una operación de versión 1 (sin `tickets`) va a todas las estaciones del ítem, con tickets sin ID. `receipt.reprint` trae `hubPrint`: el hub imprime la copia solo si el POS lo pidió.

### 2.3 Payload congelado

El reductor tiene que dar el mismo resultado en cualquier dispositivo y en cualquier momento. Por eso **todo lo que no sea determinista va en el payload**:

- Todos los IDs nuevos: líneas, modificadores, descuentos, la línea que nace de una anulación parcial, la orden hija de una división, pagos, propinas, recibos.
- El precio y la MWST de cada línea (tasa, código, bp y monto), calculados en el dispositivo con el catálogo y las reglas vigentes al vender (RN-04).
- El mesero que recibe la propina, fijado al cobrar (RN-07).
- El mapa `{categoría fiscal → tasa}` en un cambio de canal.
- El número de orden y su día de negocio.

El reductor (`@pos/core`) no lee la hora ni genera IDs: `Date.now()`, `new Date()` y `newId()` están prohibidos en esos archivos por ESLint.

## 3. Reloj lógico híbrido (HLC)

- Formato: `"<milisegundos, 13 dígitos>.<contador, 4 dígitos>"`, por ejemplo `1791234567890.0003`. Tiene ancho fijo, así que se ordena como texto.
- Al **generar** una operación: `físico = max(hora corregida, hlc anterior.físico)`. Si es igual al anterior, el contador sube; si no, vuelve a 0.
- Al **recibir** operaciones (pull o WebSocket), el HLC local avanza hasta el mayor HLC visto. Así, si una terminal ve una operación y después actúa sobre ella, su operación siempre queda después (causalidad).
- **Hora corregida** = hora del dispositivo + desfase. El desfase es la mediana de `serverTime − hora local` en las últimas sincronizaciones.
- **Reloj adelantado:** si un HLC llega más de 5 min por delante de la hora del servidor que lo recibe, el servidor lo limita a su propia hora, guarda el original y registra un conflicto `clock_skew`. Los dispositivos reciben el HLC limitado en el pull y convergen.

## 4. Plegado

- El estado se calcula **plegando** operaciones en orden canónico `(hlc, id)` con `foldOperations()` de `@pos/core`. El mismo código corre en el navegador, en el hub y en la nube.
- **El estado es por ítem.** Cada línea guarda su `orderId`, que cambian `items.transfer`, `order.merge` y `order.split`. Una anulación o un "servido" que llega tarde se aplica a la línea esté donde esté.
- **En el dispositivo** se pliegan todas las órdenes de la ventana activa: las abiertas y las cerradas del día de negocio actual y del anterior. Son unas 300 órdenes × 30 operaciones; tarda milisegundos. Para devolver o reimprimir algo más antiguo, el POS trae esa orden de la nube (solo con conexión).
- **En la nube** se pliega el **grupo de órdenes conectadas** por transferencias, uniones o divisiones (casi siempre una sola orden). Si la operación nueva es la más reciente del grupo, se aplica sobre el estado guardado; si llegó tarde, se repliega el grupo entero desde sus operaciones.
- El cierre automático (RN-12) es un estado derivado: la orden se cierra cuando, en orden canónico, todas sus líneas quedan servidas o anuladas y el pago está completo. `closedAt` es el `deviceAt` de la operación que completó la condición.

## 5. Reglas de conflicto (RNF-04)

Un conflicto **nunca bloquea** la operación del restaurante: lo que pasó en la sala se registra y el gerente lo revisa después en "Conflictos de sincronización" (evento `sync.conflict_detected`, permiso `sync.resolve_conflicts`).

| Situación                                                                                                            | Regla                                                                                                       | Código                                   |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Dos terminales cambian el mismo campo de una orden                                                                   | **Gana el último cambio por campo** según el HLC.                                                           | (no es conflicto)                        |
| Dos terminales agregan ítems a la misma orden                                                                        | Se suman: cada línea tiene su propio ID.                                                                    | (no es conflicto)                        |
| Un pago llega a una orden ya pagada o cerrada, o el total pagado supera el total                                     | **El pago se aplica igual; nunca se pierde ni se rechaza.** El gerente decide la devolución.                | `overpayment`, `payment_on_closed_order` |
| Transferir, unir o dividir una orden que ya tiene pagos                                                              | No se mueve nada de lo pagado; la operación queda sin efecto y marcada.                                     | `source_has_payments`                    |
| Una operación sobre una línea que no existe o ya no lo permite (por ejemplo, cambiar la cantidad de algo ya enviado) | La operación queda sin efecto y marcada. Si la línea aparece después (llega tarde), el replegado la aplica. | `item_state`, `item_not_found`           |
| Se agregan ítems a una orden que ya estaba cerrada                                                                   | La orden se reabre implícitamente.                                                                          | `implicit_reopen`                        |
| La aprobación no la podía dar ese gerente, o el usuario estaba desactivado                                           | Se aplica igual (ya ocurrió) y se marca.                                                                    | `approval_invalid`, `user_inactive`      |
| Número de orden, de recibo o de copia repetido                                                                       | Nunca lanza error: se guarda con un sufijo y se marca.                                                      | `duplicate_number`                       |
| HLC más de 5 min adelantado                                                                                          | Se limita a la hora del servidor (§3).                                                                      | `clock_skew`                             |
| Operación con esquema inválido o de otra sede                                                                        | Se rechaza (`rejected`). El dispositivo la muestra al gerente; no se reintenta.                             | `invalid`                                |
| La cocina marca algo que la sala ya sirvió o anuló                                                                   | No tiene efecto: es la carrera normal entre cocina y sala (DEC-029).                                        | (no es conflicto)                        |
| Una operación de cocina sobre un ítem no enviado o en una estación que no es la suya                                 | Queda sin efecto y marcada.                                                                                 | `item_state`                             |

## 6. Protocolo

Todos los endpoints viven en `/api/v1/sync` y responden igual en el hub y en la nube.

### 6.1 `POST /sync/push`

- **Auth:** solo `X-Terminal-Token`, el token del dispositivo emparejado. El usuario de cada operación se autenticó con PIN en el dispositivo; el servidor vuelve a validar sus permisos al plegar (§5). Se acepta una operación hecha en **cualquier terminal de la misma sede**, porque cada dispositivo reenvía también lo que hicieron los demás (difusión, §11.4); el hub reenvía con su propio token (terminal de tipo `hub`).
- **Body:** `{ operations: Operation[] }`, como máximo 200 operaciones, en el orden en que se crearon.
- **Proceso, en una transacción por lote:**
  1. Bloquea la fila de la sede (`SELECT … FROM locations WHERE id = ? FOR UPDATE`): los lotes de una sede se aplican de a uno, aunque la misma operación llegue a la vez por el hub y directa.
  2. Busca las claves que ya existen (bajo el bloqueo) e inserta solo las nuevas en `sync_operations`, con su `seq` (correlativo por sede, `MAX + 1`). Una clave conocida es un duplicado: no se vuelve a aplicar.
  3. Repliega los grupos de órdenes afectados y escribe la proyección (`orders`, `order_items`, `order_item_modifiers`, `discounts`, `payments`, `refunds`, `tips`) con upsert por ID. Inserta los recibos del payload si no existen.
  4. Escribe auditoría (una por operación nueva) y eventos de outbox (uno por operación nueva que tuvo efecto, más los que salen de la diferencia entre la proyección anterior y la nueva, como `order.closed`).
- **Claves únicas:** el upsert de la proyección nunca debe chocar con otra clave única que no sea el ID. `ON DUPLICATE KEY UPDATE` también salta con el índice del número de orden y sobrescribiría una orden con otra; por eso los números repetidos se resuelven antes, también dentro del mismo lote (§5, `duplicate_number`).
- **Respuesta:** `{ results: [{ id, status: 'applied' | 'duplicate' | 'conflict' | 'rejected', seq, conflicts? }], serverTime }`.

### 6.2 `GET /sync/pull?after=<seq>&limit=500`

- Devuelve las operaciones de la sede con `seq > after`, en orden de `seq`: `{ operations: [{ ...op, seq, status, cloudAcked }], cursor, hasMore, configVersion, serverTime, presence }`.
- **Presencia (DEC-033).** Un KDS manda `x-presence: unlocked | locked` (y `x-presence-user` si está desbloqueado). El nodo lo guarda en `terminal_presence` con su propia hora, y gana el reporte más nuevo. `presence` trae las KDS de la sede vistas en los últimos 10 min: `{ terminalId, unlocked, userId, lastSeenAt }`. La caja mide la edad con `serverTime` y descarta la presencia si se queda sin conexión.
- Como el `seq` se asigna bajo el bloqueo de la sede, una operación nunca aparece con un `seq` menor que el cursor de alguien que ya leyó: no se pierde nada.
- `cloudAcked` dice si la nube ya tiene la operación. En la nube siempre es `true`; en el hub, cuando la nube confirmó su reenvío.

### 6.3 `POST /sync/order-numbers`

- Solo responde la autoridad. Body `{ orderId }`. Respuesta `{ businessDate, number, display }`.
- Es idempotente por `orderId` (`order_number_claims`): repetir la petición devuelve el mismo número.

### 6.4 `GET /pos/bootstrap`

- Foto **cruda** de la configuración de la sede para operar sin conexión: catálogo completo (productos, variantes, grupos de modificadores, precios por canal, ajustes por sede, disponibilidad, traducciones, estaciones), categorías fiscales, tasas y reglas de MWST con vigencia, la sede (datos del recibo, idiomas, zona horaria, ajustes), áreas, mesas, usuarios activos con sus nombres, y los contadores del día de esta terminal (órdenes con prefijo y recibos).
- El dispositivo calcula precios, disponibilidad, traducción y MWST con las mismas funciones de `@pos/core` que usa el servidor (`buildMenu`, `resolvePrice`, `checkOrderable`, `resolveTaxRate`).
- Para la cocina trae las estaciones con su reemplazo (`fallbackStationId`) y `kitchenDisplays`, las KDS activas de cada estación, con las que la caja decide a dónde enviar (DEC-033).
- `configVersion` resume la configuración (máximo `updated_at` y cantidad de filas de cada tabla de configuración de la sede). Se memoriza unos 10 s.

## 7. PIN y aprobaciones (DEC-023)

- `GET /terminals/offline-credentials` entrega `pinKey` y, por usuario: hash argon2id, permisos e idioma, y **solo 4 bits** del `pin_lookup`. Nunca el lookup completo: con `pinKey` permitiría probar todos los PIN en un segundo.
- **Desbloqueo:** el dispositivo calcula `HMAC(pinKey, PIN)`, toma sus 4 primeros bits, verifica con argon2id solo a los usuarios de ese bucket (casi siempre 1 o 2), en un Web Worker. Funciona igual con o sin conexión.
- **Bloqueo:** tras `maxPinAttempts` intentos fallidos la terminal se bloquea `pinLockMinutes`. Los intentos y los desbloqueos se registran como operaciones (`terminal.pin_failed`, `terminal.unlocked`) y quedan en la auditoría.
- **Aprobación de gerente (RN-15):** el gerente digita su PIN en el mismo dispositivo; se verifica igual y la operación lleva `approval.approverUserId`. La nube revalida los permisos al plegar (§5).
- Las credenciales se renuevan con cada cambio de configuración (usuarios desactivados, PIN nuevos). Si pasan más de 7 días sin renovarse, el POS pide conexión.

## 8. Numeración (RN-16)

- **Día de negocio:** fecha local de la sede contando desde `settings.businessDayStartsAt` (por defecto 04:00). A las 01:30 del sábado sigue siendo el viernes.
- **Con la autoridad:** la terminal pide el número al abrir la orden (`order-numbers`) si su estado de conexión dice que la alcanza. Formato `0042`.
- **Sin la autoridad:** la terminal usa su prefijo y su contador local (`K1-0007`). No espera a que venza un tiempo de espera: decide según el último latido.
- **Contadores:** viven en Dexie por día de negocio. El bootstrap devuelve lo que la nube ya vio de esta terminal y se usa `max(local, nube)`. Al emparejar se pide `navigator.storage.persist()`; si el navegador lo niega, el POS lo avisa.
- **En la nube:** al aplicar un `order.open` con prefijo, `order_number_sequences` guarda `GREATEST(last_number, n)` para ese prefijo. Un número repetido (dispositivo borrado sin sincronizar) se guarda con sufijo y se marca (§5).
- Los números nunca se reutilizan. Puede haber huecos: un número pedido para una orden que no se llegó a usar.

## 9. Recibos (DEC-024)

- Cada pago genera su recibo (RN-09). El dispositivo arma el contenido completo al cobrar (sede, UID con sufijo MWST, fecha y hora, líneas, MWST por tasa, total, medio de pago, propina, cliente desde CHF 400), lo congela con su hash y lo manda dentro de `payment.record`. La nube lo guarda tal cual: es lo que se imprimió.
- **Número:** `<prefijo>-<AAMMDD>-<contador>` (por ejemplo `K1-261006-0012`), con el contador por terminal. Es único sin coordinar con nadie.
- **Copia:** `receipt.reprint` imprime el mismo contenido con "KOPIE" y la hora. El `copy_number` lo asigna la nube (máximo + 1, bajo el bloqueo de la sede).
- **MWST de un pago parcial:** el monto pagado se reparte entre las tasas según el bruto de la orden (mayor resto) y la MWST se extrae por tasa. Cada recibo se sostiene solo, sin depender del orden de los pagos. Un pago único usa las sumas de las líneas (DEC-016).

## 10. Eventos y auditoría

- **Auditoría:** una entrada por operación nueva que lo requiera (anular, descontar, reabrir, devolver, reimprimir, cambiar canal, PIN), con la hora del dispositivo, la terminal, el usuario y el aprobador de la operación.
- **Eventos:** los escribe solo la nube, en el outbox, a partir de la **diferencia** entre la proyección guardada y la nueva, en la misma transacción. Por eso `order.closed` se emite una vez aunque el replegado recalcule el estado. Si una operación tardía reabre una orden, se emite `sync.conflict_detected` (no `order.reopened`, que es la acción del gerente).

## 11. Hub (DEC-028)

### 11.1 Qué hace en la Fase 2

- Guarda las operaciones de su sede en `pos_hub.sync_operations`, con el mismo contrato `push`/`pull`.
- Es la autoridad de numeración (`order-numbers`) si es el primero de la lista.
- Avisa por WebSocket a las terminales.
- Reenvía a la nube lo que recibe, con las mismas claves de idempotencia, y trae de la nube lo que llegó directo (de terminales que no lo alcanzaban).
- No mantiene proyección de órdenes.

### 11.1b Qué agrega la Fase 3: cocina e impresión (DEC-029 a DEC-032)

- **KDS.** El KDS (`/kds`) es un cliente más, igual que el POS. Pull, push y avisos van por el hub, así que la cocina funciona en la LAN sin nube (RF-C27). Su tablero sale del mismo plegado: `stationBoard()` en `@pos/core`.
- **Configuración de impresión.** Además de `hub-config`, el hub trae `/pos/bootstrap`: impresoras, estaciones, mesas, usuarios y catálogo, para los nombres y alérgenos en el idioma de cocina. Lo guarda en `.hub-config.json`, así que imprime aunque arranque sin internet.
- **Cola de impresión** (`print_jobs` en `pos_hub`):
  - **Planificar.** Recorre `sync_operations` por `seq` y pliega bajo demanda el grupo de la orden. Guarda un trabajo por documento con una clave idempotente:
    - `kitchen:<ticket>`
    - `storno:<operación>:<ticket>`
    - `reprint:<operación>`
    - `receipt:<operación>`
    - `drawer:<operación>`
    - `test:<impresora>:<pedido>`
  - **Enviar.** Manda los trabajos en orden por impresora, con reintentos (2, 5, 10 y 30 s, durante 10 min).
  - **Límite de antigüedad.** Lo que tiene más de `printing.maxDelayMinutes` (por defecto 15) se marca `expired` y no se imprime; para el cajón el límite es 1 min.
  - **Envío incompleto.** Si los ítems de un envío todavía no llegaron, el trabajo espera.
- **Protocolo.** ESC/POS por TCP 9100, con página de códigos 858 para DE, FR, IT y €. ePOS y CloudPRNT llegan en la Fase 6.
- **Estado de las impresoras.** Cada cambio se avisa por WebSocket (`printer.status`) y se informa a la nube con `POST /sync/printer-status`, que lo guarda en `printer_status`, fuera de `configVersion`. La prueba de impresión pedida en el backoffice llega con la configuración (`printers.testRequestedAt`).
- **Quién está en las KDS (DEC-033).** En cada ciclo el hub sube a la nube su `terminal_presence` reciente (`POST /sync/presence`) y guarda la que trae el pull de la nube. Así una caja conectada a cualquiera de los dos ve todas las tablets.

### 11.2 Emparejamiento y autenticación

- El hub se empareja como una terminal de tipo `hub`, con un código del backoffice (`HUB_PAIRING_CODE` en el primer arranque). Guarda su token y sus cursores en un archivo de estado (`HUB_STATE_FILE`, por defecto `.hub-state.json`).
- Copia de la nube (`GET /sync/hub-config`, solo para el hub) los datos mínimos para autenticar y numerar: organización, sede (zona horaria y ajustes) y terminales de la sede con sus hashes de token. Los renueva con cada cambio de configuración. Así verifica `X-Terminal-Token` sin internet, y una terminal dada de baja en la nube pierde el acceso al hub.
- Variables: `HUB_DATABASE_URL` (su MySQL, mismo esquema), `HUB_CLOUD_URL`, `HUB_AUTHORITY=false` para un hub de reserva que no numera, `HUB_ALLOWED_ORIGINS` (origen del POS para CORS). El hub responde el preflight de "Private Network Access" de Chrome.
- En los `pull`, el hub entrega el `configVersion` de la nube que vio por última vez (vacío si aún no lo conoce): las terminales comparan contra la configuración real y la traen de la nube.

### 11.3 WebSocket `/ws`

| Dirección      | Mensaje                                                            | Para qué                                             |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| terminal → hub | `{ type: 'hello', token, cursor }`                                 | Autenticarse y decir hasta dónde tiene.              |
| hub → terminal | `{ type: 'hub.hello', serverTime, protocolVersion: 2, authority }` | Saludo; dice si numera.                              |
| hub → terminal | `{ type: 'sync.applied', seq }`                                    | Hay operaciones nuevas: la terminal hace pull.       |
| hub → terminal | `{ type: 'config.changed', configVersion }`                        | La configuración cambió: la terminal pide bootstrap. |
| hub → terminal | `{ type: 'cloud.status', online }`                                 | El hub perdió o recuperó internet.                   |
| hub → terminal | `{ type: 'printer.status', printerId, ok, error }`                 | Una impresora dejó de imprimir o volvió (DEC-031).   |

### 11.4 Difusión y relevo (RNF-05)

- Cada dispositivo guarda toda operación que conoce (propia o recibida) hasta que la nube la confirma (`cloudAcked`), y la reenvía al nodo que alcance. Si el hub se apaga con operaciones sin reenviar, las terminales las tienen y las mandan a la nube directamente. Los duplicados se descartan por la clave de idempotencia.
- **Si el hub se apaga**, las terminales lo notan en el siguiente latido (≤ 5 s) y pasan solas al siguiente nodo de la lista o al nivel 1. No hay que configurar nada.
- **Hub de reserva:** se instala otro equipo con el hub, se empareja con su propio código y se agrega en segundo lugar en `settings.sync.hubUrls` desde el backoffice. Mientras el primero funciona, el de reserva solo recibe tráfico de las terminales que no alcancen al primero; no numera (las terminales usan su prefijo). Para que **tome el rol de autoridad** de forma permanente, el gerente lo sube al primer lugar de la lista; las terminales lo adoptan en la siguiente actualización de configuración.

### 11.5 HTTPS en la LAN

- La PWA se sirve por HTTPS desde la nube, y el navegador bloquea `ws://` y `http://` hacia la red local (contenido mixto y "Local Network Access" de Chrome).
- **En producción**, cada hub tiene un nombre DNS público que resuelve a su IP de la LAN (por ejemplo `h-7f3a.hub.<dominio>`) y un certificado emitido por la nube con ACME DNS-01. Las tablets gestionadas permiten la red local por política de Chrome. Se automatiza en la Fase 6.
- **Riesgo conocido:** los routers con protección contra DNS rebinding (por ejemplo FRITZ!Box) bloquean ese nombre; hay que agregar una excepción. **Se valida con hardware real antes del piloto.**
- En desarrollo y en los E2E, el hub corre en `localhost`, que el navegador considera seguro.

## 12. Configuración en los terminales (RF-F23)

- Cada `pull` trae `configVersion`. Si cambió, la terminal pide el bootstrap y las credenciales.
- Con hub, el aviso llega por WebSocket (`config.changed`). Sin hub, la terminal consulta cada 2 s mientras el POS está en uso (cada 30 s si está en segundo plano). En ambos casos, un cambio del backoffice llega en menos de 1 minuto, o al reconectar.

## 13. Almacenamiento en el dispositivo

- **Dexie (IndexedDB):** una base por app, `sistema-reservas-pos` y `sistema-reservas-kds` (DEC-030), con dos tablas:
  - `meta`: terminal, token, cursores, desfase, HLC, bootstrap, credenciales y contadores de órdenes y recibos por día;
  - `ops`: todas las operaciones conocidas, con su estado (pendiente, confirmada por un nodo, confirmada por la nube).
- Las operaciones de órdenes cerradas fuera de la ventana activa (§4) y ya confirmadas por la nube se borran del dispositivo (la nube las conserva).
- **Service worker (Serwist):** precachea `/pos` y sus archivos con la revisión del build. `/api/*` nunca se cachea (son datos vivos y, en las credenciales, hashes de PIN). Una versión nueva del POS no se activa en medio de un cobro: el POS avisa y recarga cuando está libre.

## 14. Cómo se prueba (RNF-19)

- **Core:** cada tipo de operación y sus invariantes; dinero y MWST; numeración; HLC; **propiedad**: 1000 permutaciones del mismo conjunto de operaciones de 2 o 3 terminales dan la misma proyección; aplicar dos veces es aplicar una; un pago nunca lanza error.
- **API:** el mismo lote enviado dos veces y en paralelo no duplica; 404 entre organizaciones; colisiones como conflicto; auditoría y eventos una sola vez; la proyección guardada es la del Core.
- **Hub:** terminal → hub → nube exactamente una vez; lo mismo por el hub y directo no duplica; con el hub apagado las terminales siguen y resincronizan.
- **Cocina (puerta de la Fase 3):** `apps/hub/src/kitchen-load.int.test.ts`.
  - **Montaje:** 60 órdenes, 10 terminales, 3 KDS e impresoras simuladas. Llegan lotes tarde y duplicados, algunas terminales van directo a la nube y el hub se reinicia a mitad de la prueba.
  - **Se verifica:** ningún ticket se pierde, ninguno cambia de estado sin una operación sobre sus ítems, cada comanda y cada storno se imprime una sola vez, y la nube termina con los mismos tickets que la cocina.
  - **E2E `kds.spec.ts`:** POS → hub → KDS en menos de 2 s, impresión, storno, aviso al mesero y recall.
- **E2E:** el flujo mesa → pedido → pago → recibo con `setOffline(true)`, recargando la página sin conexión, y al volver exactamente una orden, sus pagos y sus recibos; "WAN colgada" (la API no responde) sin bloquear el POS.
