# Trazabilidad de requerimientos

Fuente: [`docs/requerimientos.txt`](requerimientos.txt) (Requerimientos V1.0, 5 oct 2026).
Cada requerimiento cumplido cita la prueba que lo demuestra (archivo de prueba o E2E). `pnpm check:trace`
falla si algún ID del documento falta aquí o si una prioridad no coincide con el documento.

Rutas de las pruebas: dominio en `packages/core/src/**/*.test.ts`; integración de base en
`packages/db/src/*.int.test.ts`; integración de la API en `packages/api/src/http/*.int.test.ts`; E2E en
`apps/web/e2e/*.spec.ts`.

**Estados:** ⬜ Pendiente · 🟡 Base (estructura lista, falta el caso de uso o la pantalla) · ✅ Cumplido · ⏸ Diferido (decisión registrada en [DECISIONES.md](DECISIONES.md))

**Fases:** 0 Base · 1 Core · 2 POS y órdenes offline · 3 Cocina · 4 Caja y reportes · 5 Capa digital · 6 Piloto · Post = después del piloto

**Commits de la Fase 0:** `19d172c` core (dinero, IDs, eventos, permisos) · `303c48f` UID suizo · `db77434` esquema, migraciones y seed · `e0420fc` web · `4b272f6` hub

**Fase 1 (Core):** puerta cumplida. `e2e/setup-restaurant.spec.ts` monta un restaurante completo desde el backoffice, sin código, y activa la operación (RF-A11). Las pruebas de RN-01…RN-07 pasan.

**Fase 2 (POS y órdenes offline):** puerta cumplida. `e2e/pos-offline.spec.ts` cubre todo el servicio con la red cortada (`setOffline(true)`):

- mesa, pedido con variante y modificadores, envío por gang y servido;
- pago mixto con tarjeta y propina, más efectivo con redondeo, con sus dos recibos MWST;
- cierre automático y recarga de la página sin red.

Al volver la conexión, la cola se vacía sola, la nube tiene exactamente una orden, dos pagos y dos recibos, y reenviar todo devuelve solo duplicados.

Otras pruebas de la fase:

- **Reductor:** `orders/reducer.test.ts`.
- **Propiedades:** `orders/sync-properties.test.ts`. Cualquier orden de llegada da el mismo estado, y plegar un grupo da lo mismo que plegar toda la sede.
- **Sincronización en la nube:** `sync.int.test.ts`.
- **Hub con dos bases:** `apps/hub/src/hub.int.test.ts`.
- **E2E con conexión:** `pos-online.spec.ts`, `pos-config.spec.ts` y `sync-conflicts.spec.ts`.

| Resumen | Total | Debe | Debería | Podría |
| ------- | ----: | ---: | ------: | -----: |
| RF      |   126 |   91 |      27 |      8 |
| RNF     |    23 |   20 |       2 |      1 |
| RN      |    24 |    — |       — |      — |
| PA      |    12 |    — |       — |      — |

## RF-A — Organización, sedes, usuarios y permisos

| ID     | Requerimiento                                                                           | Prioridad | Fase | Estado  | Evidencia                                                                                                 |
| ------ | --------------------------------------------------------------------------------------- | --------- | ---- | ------- | --------------------------------------------------------------------------------------------------------- |
| RF-A01 | Organización con una o varias sedes; todo dato pertenece a una organización y sede      | DEBE      | 1    | ✅      | `admin.int.test.ts` (alta), `tenancy.int.test.ts`, `e2e/setup-restaurant.spec.ts`                         |
| RF-A02 | Configuración por sede: nombres, UID/MWST, CHF, zona horaria, idiomas, horarios, recibo | DEBE      | 1    | ✅      | `locations.int.test.ts`, `e2e/setup-restaurant.spec.ts`                                                   |
| RF-A03 | Áreas, mesas con capacidad, terminales y estaciones por sede                            | DEBE      | 1    | ✅      | `locations.int.test.ts`, `people.int.test.ts`, `e2e/setup-restaurant.spec.ts`                             |
| RF-A04 | Usuarios con roles predefinidos; varios roles y varias sedes                            | DEBE      | 1    | ✅      | `people.int.test.ts`                                                                                      |
| RF-A05 | Permisos por acción sensible; autorización de gerente con PIN en el mismo dispositivo   | DEBE      | 1    | 🟡 Base | Dominio + API (`authorization.test.ts`, `people.int.test.ts`: aprobación con PIN); pantalla POS en Fase 2 |
| RF-A06 | Ingreso al POS con PIN de 4-6 dígitos y cambio de usuario en < 3 s                      | DEBE      | 1    | 🟡 Base | API: emparejar, desbloquear con PIN, credenciales offline (`people.int.test.ts`); pantalla POS en Fase 2  |
| RF-A07 | Backoffice con correo y contraseña; 2FA para administradores                            | DEBERÍA   | 1    | ✅      | Auth.js + 2FA TOTP (`apps/web/src/auth.ts`, Mi cuenta)                                                    |
| RF-A08 | Idioma de interfaz por usuario (DE, FR, IT, EN; ES soporte)                             | DEBE      | 1    | ✅      | next-intl DE/FR/IT/EN/ES por usuario; `e2e/setup-restaurant.spec.ts`                                      |
| RF-A09 | Fichaje simple de entrada y salida con reporte de horas (L-GAV)                         | PODRÍA    | Post | ⬜      |                                                                                                           |
| RF-A10 | Acceso de soporte DINOLABS con permiso del dueño, limitado y auditado                   | DEBERÍA   | 1    | ✅      | `admin.int.test.ts` (permisos de soporte), consola `/support`, auditoría con `support_staff_id`           |
| RF-A11 | Montar un restaurante completo desde el backoffice con lista de verificación            | DEBE      | 1    | ✅      | `e2e/setup-restaurant.spec.ts` (puerta de la Fase 1), `admin.int.test.ts`                                 |
| RF-A12 | Desactivar usuarios y terminales sin borrarlos                                          | DEBE      | 1    | ✅      | `people.int.test.ts` (desactivar usuarios y terminales)                                                   |

## RF-B — Catálogo maestro e impuestos

| ID     | Requerimiento                                                                    | Prioridad | Fase | Estado  | Evidencia                                                                                          |
| ------ | -------------------------------------------------------------------------------- | --------- | ---- | ------- | -------------------------------------------------------------------------------------------------- |
| RF-B01 | Un catálogo maestro por organización; activar y precio propio por sede           | DEBE      | 1    | ✅      | `catalog.int.test.ts` (ajustes por sede)                                                           |
| RF-B02 | Categorías, productos, variantes y grupos de modificadores con mín./máx. y costo | DEBE      | 1    | ✅      | `catalog.int.test.ts`                                                                              |
| RF-B03 | Combos y menú del día (Tagesmenü) con precio fijo, publicado en un paso          | DEBERÍA   | 1    | ⬜      |                                                                                                    |
| RF-B04 | Precio en CHF con MWST incluida; precio por canal                                | DEBE      | 1    | ✅      | `catalog.int.test.ts`, `rules.test.ts` (`resolvePrice`)                                            |
| RF-B05 | Los 14 alérgenos por producto y modificador, visibles en POS, QR, web y comanda  | DEBE      | 1    | ✅      | `catalog.int.test.ts`, `e2e/setup-restaurant.spec.ts`                                              |
| RF-B06 | Origen de carne, aves y pescado por producto                                     | DEBE      | 1    | ✅      | `catalog.int.test.ts`                                                                              |
| RF-B07 | Traducciones DE/FR/IT/EN con respaldo al idioma de la sede                       | DEBE      | 1    | ✅      | `catalog.int.test.ts`, `rules.test.ts` (`translate`), `e2e/setup-restaurant.spec.ts`               |
| RF-B08 | Disponibilidad por franja, día y canal                                           | DEBE      | 1    | ✅      | `catalog.int.test.ts`, `rules.test.ts` (`checkOrderable`)                                          |
| RF-B09 | Agotar en un toque ("86") con vuelta programada                                  | DEBE      | 1    | ✅      | `catalog.int.test.ts` (86 con vuelta programada); botón en POS/KDS en Fases 2-3                    |
| RF-B10 | Imagen por producto y categoría                                                  | DEBERÍA   | 1    | 🟡 Base | URL de imagen por producto y categoría; subida de archivos pendiente                               |
| RF-B11 | Estación de cocina y curso por defecto por producto                              | DEBE      | 1    | ✅      | `catalog.int.test.ts`, `e2e/setup-restaurant.spec.ts`                                              |
| RF-B12 | Categoría fiscal; tasa por categoría + canal + tipo de consumo                   | DEBE      | 1    | ✅      | `calculation.test.ts`, `admin.int.test.ts`                                                         |
| RF-B13 | Tasas y reglas MWST editables con fecha de vigencia, sin desplegar código        | DEBE      | 1    | ✅      | `admin.int.test.ts` (tasas y reglas con vigencia)                                                  |
| RF-B14 | Importar catálogo desde CSV/Excel y desde Zitas con vista previa                 | DEBERÍA   | 1    | ⬜      |                                                                                                    |
| RF-B15 | Publicar desde una ficha a POS, QR y web Zitas                                   | DEBE      | 1    | 🟡 Base | Carta por API desde una sola ficha (`catalog.int.test.ts`: `/catalog/menu`); QR y portal en Fase 5 |
| RF-B16 | Carta imprimible PDF por idioma                                                  | DEBERÍA   | 4    | ⬜      |                                                                                                    |
| RF-B17 | Historial de cambios de precio, impuesto y disponibilidad                        | DEBE      | 1    | ✅      | `catalog.int.test.ts` (auditoría de precio, impuesto y disponibilidad)                             |
| RF-B18 | Duplicar producto o categoría                                                    | DEBERÍA   | 1    | ✅      | `catalog.int.test.ts` (duplicar producto)                                                          |

## RF-C — Mesas, órdenes y cocina

| ID     | Requerimiento                                                                      | Prioridad | Fase | Estado  | Evidencia                                                                                                                              |
| ------ | ---------------------------------------------------------------------------------- | --------- | ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| RF-C01 | Mapa de mesas por área con estado derivado de la orden en tiempo real              | DEBE      | 2    | ✅      | `tables/state.test.ts` (estado derivado), `e2e/pos-offline.spec.ts` (puerta)                                                           |
| RF-C02 | Abrir mesa con comensales y mesero                                                 | DEBE      | 2    | ✅      | `e2e/pos-offline.spec.ts` (puerta) (mesa, comensales y mesero)                                                                         |
| RF-C03 | Unir, separar, mover cuenta y cambiar mesero sin perder ítems ni pagos             | DEBE      | 2    | ✅      | `reducer.test.ts` (`order.update`: mesa, mesero, mesas unidas); pantalla "Mehr"                                                        |
| RF-C04 | Vincular mesa con reserva (check-in) y visita; ver historial                       | DEBE      | 5    | ⬜      |                                                                                                                                        |
| RF-C05 | Varias órdenes abiertas en una misma mesa                                          | DEBERÍA   | 2    | ✅      | `tables/state.test.ts` (varias órdenes por mesa); mapa y "Weitere Bestellung"                                                          |
| RF-C06 | Áreas de temporada activables sin borrar mesas                                     | PODRÍA    | 2    | ✅      | Áreas inactivas fuera del mapa (`floor-view.tsx`), sin borrar mesas                                                                    |
| RF-C07 | Órdenes mesa, barra, takeaway, QR y web; el tipo define canal y tasa               | DEBE      | 2    | 🟡 Base | Mesa, barra y take-away en el POS con su canal y MWST (`reducer.test.ts`, `e2e/pos-online.spec.ts`); QR y web en la Fase 5             |
| RF-C08 | Ítems con variante, modificadores, nota, asiento y curso; cantidad antes de enviar | DEBE      | 2    | ✅      | `pricing.test.ts`, `e2e/pos-offline.spec.ts` (puerta) (variante, modificadores, nota, gang)                                            |
| RF-C09 | Enviar a cocina todo o un curso; marchar el siguiente                              | DEBE      | 2    | ✅      | `e2e/pos-offline.spec.ts` (puerta) (Senden, "Gang 2 schicken")                                                                         |
| RF-C10 | Anular ítem con motivo y permiso; tachado en KDS; nunca se borra                   | DEBE      | 2    | ✅      | `reducer.test.ts` (anulación parcial, motivo), `e2e/pos-online.spec.ts` (PIN de gerente); tachado en el KDS en la Fase 3               |
| RF-C11 | Descuentos por ítem u orden, % o monto, con motivo; botones frecuentes             | DEBE      | 2    | ✅      | `totals.test.ts`, `reducer.test.ts`, `e2e/pos-online.spec.ts` (botón "Personal" con aprobación)                                        |
| RF-C12 | Dividir la cuenta por partes iguales, ítems o asientos                             | DEBE      | 2    | ✅      | `reducer.test.ts` (orden hija), `receipts/build.test.ts` (partes iguales); pantalla de cobro                                           |
| RF-C13 | Transferir ítems entre órdenes y unir órdenes                                      | DEBE      | 2    | ✅      | `reducer.test.ts`, `sync-properties.test.ts` (transferir y unir con grupos)                                                            |
| RF-C14 | Reabrir orden cerrada con permiso de gerente y motivo                              | DEBE      | 2    | ✅      | `reducer.test.ts` (reabrir con motivo y auditoría); panel de órdenes cerradas                                                          |
| RF-C15 | Número de orden corto por sede y día + UUID del dispositivo                        | DEBE      | 2    | ✅      | `numbering.test.ts`, `sync.int.test.ts` (autoridad), `e2e/pos-offline.spec.ts` (puerta) (`H1-0001`), `e2e/pos-online.spec.ts` (`0001`) |
| RF-C16 | Dos estados independientes; cierre automático                                      | DEBE      | 2    | ✅      | `reducer.test.ts`, `totals.test.ts` (dos estados, cierre automático)                                                                   |
| RF-C17 | Prepago o pago posterior con el mismo flujo de cocina                              | DEBE      | 2    | ✅      | `reducer.test.ts` (prepago), `e2e/pos-online.spec.ts` (cobrar antes y "Ausgegeben")                                                    |
| RF-C18 | Todo funciona sin internet y sincroniza sin duplicados ni pérdidas                 | DEBE      | 2    | ✅      | `e2e/pos-offline.spec.ts` (puerta), `sync-properties.test.ts`, `sync.int.test.ts`, `hub.int.test.ts`                                   |
| RF-C19 | Vista "mis mesas" y "todas las órdenes abiertas" con tiempo desde el último envío  | DEBE      | 2    | ✅      | "Meine Tische" / "Alle offenen" con minutos desde el envío (`orders-view.tsx`, `tables/state.ts`)                                      |
| RF-C20 | KDS por estación con mesa, hora, ítems, modificadores, notas, alérgenos y mesero   | DEBE      | 3    | ⬜      |                                                                                                                                        |
| RF-C21 | Ruteo automático por estación; un ítem puede ir a varias                           | DEBE      | 3    | 🟡 Base | `db77434` rutas + seed                                                                                                                 |
| RF-C22 | Estado por ítem o ticket; marcar servido desde KDS o POS                           | DEBE      | 3    | ⬜      |                                                                                                                                        |
| RF-C23 | Aviso al mesero cuando un ticket está listo                                        | DEBERÍA   | 3    | ⬜      |                                                                                                                                        |
| RF-C24 | Tiempos y alerta de color por umbral por estación                                  | DEBE      | 3    | 🟡 Base | `db77434` `alert_after_minutes`                                                                                                        |
| RF-C25 | Ticket en el idioma de cocina                                                      | DEBERÍA   | 3    | 🟡 Base | `db77434` `kitchen_language`                                                                                                           |
| RF-C26 | Comanda impresa ESC/POS como alternativa al KDS; reimpresión                       | DEBERÍA   | 3    | ⬜      |                                                                                                                                        |
| RF-C27 | KDS, ruteo e impresión en la LAN sin nube                                          | DEBE      | 3    | 🟡 Base | `4b272f6` hub + WebSocket                                                                                                              |
| RF-C28 | Recall de tickets terminados                                                       | DEBERÍA   | 3    | ⬜      |                                                                                                                                        |

## RF-D — Pagos, caja y recibos

| ID     | Requerimiento                                                      | Prioridad | Fase | Estado    | Evidencia                                                                                                 |
| ------ | ------------------------------------------------------------------ | --------- | ---- | --------- | --------------------------------------------------------------------------------------------------------- |
| RF-D01 | Efectivo, tarjeta y TWINT en terminal, y pago online para QR y web | DEBE      | 2, 5 | ⏸ Parcial | Online diferido: DEC-003                                                                                  |
| RF-D02 | Pagos mixtos y parciales con saldo pendiente visible               | DEBE      | 2    | ✅        | `e2e/pos-offline.spec.ts` (puerta) (tarjeta + efectivo, saldo visible)                                    |
| RF-D03 | Efectivo con redondeo a 0,05 CHF y registro de la diferencia       | DEBE      | 2    | ✅        | `adapters.test.ts`, `e2e/pos-offline.spec.ts` (puerta) (redondeo 0.02)                                    |
| RF-D04 | Terminal independiente: monto digitado y confirmado en el POS      | DEBE      | 2    | ✅        | `e2e/pos-offline.spec.ts` (puerta) (monto confirmado del terminal)                                        |
| RF-D05 | Integración directa con Worldline, wallee y SumUp                  | DEBERÍA   | Post | ⬜        | Fuera del MVP (sección 5)                                                                                 |
| RF-D06 | Propina al mesero, reportada por persona, fuera de la venta        | DEBE      | 2    | ✅        | `adapters.test.ts`, `e2e/pos-offline.spec.ts` (puerta) (propina en el terminal, `tips`)                   |
| RF-D07 | Devolución total o parcial ligada al pago original                 | DEBE      | 2    | ✅        | `reducer.test.ts`, `e2e/pos-online.spec.ts` (devolución ligada al pago, con aprobación)                   |
| RF-D08 | Pago en EUR con tasa de cambio de la sede                          | PODRÍA    | Post | ⬜        |                                                                                                           |
| RF-D09 | Vales de comida (Lunch-Check) como medio manual                    | PODRÍA    | Post | ⬜        |                                                                                                           |
| RF-D10 | Pagos como adaptador: un proveedor nuevo no toca órdenes ni caja   | DEBE      | 2    | ✅        | `adapters.test.ts` (`PaymentAdapter`: cash, external-terminal, online stub)                               |
| RF-D11 | Conciliación con el cierre del terminal; diferencias con motivo    | DEBE      | 4    | 🟡 Base   | `db77434` `payment_reconciliations`                                                                       |
| RF-D12 | Apertura de turno con fondo, por terminal o cajero                 | DEBE      | 4    | 🟡 Base   | `db77434` `shifts`                                                                                        |
| RF-D13 | Movimientos de caja con motivo y comprobante opcional              | DEBE      | 4    | 🟡 Base   | `db77434` `cash_movements`                                                                                |
| RF-D14 | Arqueo por denominación con diferencia comentada                   | DEBE      | 4    | 🟡 Base   | `19d172c` denominaciones CHF                                                                              |
| RF-D15 | Cierre de turno y cierre Z con resumen completo                    | DEBE      | 4    | ⬜        |                                                                                                           |
| RF-D16 | Libro de caja diario automático, exportable PDF y CSV              | DEBE      | 4    | ⬜        |                                                                                                           |
| RF-D17 | Un cierre no se edita; correcciones como movimientos nuevos        | DEBE      | 4    | 🟡 Base   | `db77434` trigger append-only                                                                             |
| RF-D18 | Apertura del cajón al cobrar en efectivo o con permiso             | DEBERÍA   | 3    | ⬜        |                                                                                                           |
| RF-D19 | No cerrar el día con turnos u órdenes abiertas; listarlas          | DEBE      | 4    | ⬜        |                                                                                                           |
| RF-D20 | Recibo válido MWST con UID, detalle, tasas y montos por tasa       | DEBE      | 2    | ✅        | `receipts/build.test.ts`, `render.test.ts`, `e2e/pos-offline.spec.ts` (puerta)                            |
| RF-D21 | Recibo digital por QR, correo o WhatsApp                           | DEBERÍA   | 5    | ⬜        |                                                                                                           |
| RF-D22 | Nombre y dirección del cliente; obligatorio desde CHF 400          | DEBE      | 2    | ✅        | `receipts/build.test.ts` (nombre desde CHF 400, dirección opcional)                                       |
| RF-D23 | Recibo en el idioma del cliente                                    | DEBERÍA   | 2    | ✅        | `receipts/labels.ts` + `build.test.ts` (DE/FR/IT/EN); selector en el cobro                                |
| RF-D24 | Reimpresión marcada como copia y auditada                          | DEBE      | 2    | ✅        | `e2e/pos-online.spec.ts` (copia con `copy_number` 1, auditada)                                            |
| RF-D25 | Un recibo por pago dividido y por pedido QR/takeaway pagado online | DEBE      | 2    | 🟡 Base   | Un recibo por pago y por parte (`e2e/pos-offline.spec.ts` (puerta)); pago online de QR y web en la Fase 5 |

## RF-E — Capa Zitas: reservas, menú QR, takeaway y clientes

| ID     | Requerimiento                                                          | Prioridad | Fase | Estado     | Evidencia                                                                                       |
| ------ | ---------------------------------------------------------------------- | --------- | ---- | ---------- | ----------------------------------------------------------------------------------------------- |
| RF-E01 | Reservas vinculadas a áreas y mesas reales con tiempos de ocupación    | DEBE      | 5    | 🟡 Base    | `db77434` `reservations`                                                                        |
| RF-E02 | Check-in: crea visita, ocupa mesa, abre orden                          | DEBE      | 5    | ⬜         |                                                                                                 |
| RF-E03 | Estados de reserva; walk-ins como visita sin reserva                   | DEBE      | 5    | 🟡 Base    | `19d172c` estados                                                                               |
| RF-E04 | Confirmaciones y recordatorios por WhatsApp o correo (ya en Zitas)     | DEBE      | 5    | ⬜         | Lo envía Zitas con eventos del Core                                                             |
| RF-E05 | Depósito o prepago para grupos grandes                                 | PODRÍA    | Post | ⬜         |                                                                                                 |
| RF-E06 | Menú QR por mesa con catálogo en el idioma del cliente                 | DEBE      | 5    | 🟡 Base    | `db77434` `qr_code`, `e0420fc` ruta                                                             |
| RF-E07 | Pedido QR entra como orden del Core en la mesa correcta                | DEBE      | 5    | ⬜         |                                                                                                 |
| RF-E08 | Modo QR por área o mesa: ver, pedir, pedir y pagar                     | DEBE      | 5    | 🟡 Base    | `db77434` `qr_mode`                                                                             |
| RF-E09 | Pago online del pedido QR (TWINT o tarjeta) o "pagar en caja"          | DEBE      | 5    | ⏸ Diferido | DEC-003: adaptador stub                                                                         |
| RF-E10 | Llamar al mesero o pedir la cuenta desde el QR                         | DEBERÍA   | 5    | ⬜         |                                                                                                 |
| RF-E11 | Takeaway desde el portal web con hora de recogida y tasa reducida      | DEBE      | 5    | ⬜         |                                                                                                 |
| RF-E12 | Takeaway en mostrador con número para llamar                           | DEBE      | 5    | ⬜         |                                                                                                 |
| RF-E13 | Aviso de pedido listo por WhatsApp o SMS                               | DEBERÍA   | 5    | ⬜         |                                                                                                 |
| RF-E14 | Cliente único por teléfono o correo compartido por todos los canales   | DEBE      | 1    | ✅         | `admin.int.test.ts` (cliente único por teléfono o correo)                                       |
| RF-E15 | Historial por cliente: visitas, gasto, platos, mesero, notas, alergias | DEBE      | 5    | 🟡 Base    | Notas y alergias; historial de visitas y gasto con las órdenes (Fases 2 y 5)                    |
| RF-E16 | Consentimiento al crear; exportar o anonimizar sin tocar ventas        | DEBE      | 1    | ✅         | `admin.int.test.ts` (consentimiento, exportación, anonimización)                                |
| RF-E17 | Etiquetas y búsqueda rápida desde el POS                               | DEBERÍA   | 2    | 🟡 Base    | Etiquetas y búsqueda en backoffice; búsqueda desde el POS pendiente (solo con conexión, revDSG) |
| RF-E18 | Fidelización simple después del piloto                                 | PODRÍA    | Post | ⬜         |                                                                                                 |
| RF-E19 | WhatsApp para recibos y avisos reutilizando Zitas                      | DEBERÍA   | 5    | ⬜         |                                                                                                 |
| RF-E20 | Zita IA responde sobre la carta con datos del Core, sin crear pedidos  | DEBE      | 5    | ⬜         |                                                                                                 |

## RF-F — Reportes, auditoría, integraciones, IA y backoffice

| ID     | Requerimiento                                                                   | Prioridad | Fase | Estado  | Evidencia                                                                                    |
| ------ | ------------------------------------------------------------------------------- | --------- | ---- | ------- | -------------------------------------------------------------------------------------------- |
| RF-F01 | Ventas por día, hora, sede, mesero, canal, categoría y producto con comparación | DEBE      | 4    | ⬜      |                                                                                              |
| RF-F02 | Reporte MWST por tasa y periodo para la fiduciaria                              | DEBE      | 4    | ⬜      |                                                                                              |
| RF-F03 | Cierres Z consultables, inalterables, exportables PDF y CSV                     | DEBE      | 4    | 🟡 Base | `db77434` trigger append-only                                                                |
| RF-F04 | Exportación contable CSV genérico                                               | DEBE      | 4    | ⬜      |                                                                                              |
| RF-F05 | Formatos nativos bexio, Abacus y Banana                                         | DEBERÍA   | Post | ⬜      |                                                                                              |
| RF-F06 | Anulaciones, descuentos y devoluciones por usuario                              | DEBE      | 4    | ⬜      |                                                                                              |
| RF-F07 | Propinas por persona y periodo                                                  | DEBE      | 4    | ⬜      |                                                                                              |
| RF-F08 | Tiempos de cocina y de mesa                                                     | DEBERÍA   | 4    | ⬜      |                                                                                              |
| RF-F09 | Reportes de reservas: ocupación, no-shows, origen                               | DEBERÍA   | 5    | ⬜      |                                                                                              |
| RF-F10 | Tablero del dueño en el celular                                                 | DEBERÍA   | 4    | ⬜      |                                                                                              |
| RF-F11 | Auditoría append-only de toda operación sensible                                | DEBE      | 1    | ✅      | `tenancy.int.test.ts`, `admin.int.test.ts`, triggers append-only                             |
| RF-F12 | Consulta de auditoría por filtros y exportación CSV                             | DEBE      | 4    | 🟡 Base | Consulta con filtros (`admin.int.test.ts`, pantalla Protokoll); CSV en Fase 4                |
| RF-F13 | Archivo de 10 años a prueba de modificaciones, exportable PDF/CSV/JSON          | DEBE      | 4, 6 | 🟡 Base | `db77434` triggers + `content_hash`                                                          |
| RF-F14 | API HTTP documentada con credenciales por organización                          | DEBE      | 1    | ✅      | API v1 + OpenAPI (`/api/v1/docs`), API keys (`people.int.test.ts`, `catalog.int.test.ts`)    |
| RF-F15 | Webhooks de eventos                                                             | DEBERÍA   | 5    | 🟡 Base | `db77434` `outbox_events`                                                                    |
| RF-F16 | Importar pedidos de Uber Eats, Just Eat y Smood                                 | PODRÍA    | Post | ⬜      |                                                                                              |
| RF-F17 | Impresoras de red (Epson ePOS, Star CloudPRNT, ESC/POS) con prueba              | DEBE      | 1, 3 | 🟡 Base | Configuración de impresoras (`people.int.test.ts`); impresión de prueba con el hub en Fase 3 |
| RF-F18 | Preguntas en lenguaje natural sobre el negocio con datos del Core               | DEBERÍA   | Post | ⬜      |                                                                                              |
| RF-F19 | Sugerencias operativas confirmadas por un humano                                | PODRÍA    | Post | ⬜      |                                                                                              |
| RF-F20 | La IA nunca crea, modifica ni anula órdenes, pagos, precios ni impuestos        | DEBE      | 1    | ⬜      |                                                                                              |
| RF-F21 | Backoffice web responsivo para RF-A, RF-B y RF-F17, usuarios y reportes         | DEBE      | 1    | ✅      | Backoffice completo; `e2e/setup-restaurant.spec.ts`                                          |
| RF-F22 | Modo entrenamiento con datos ficticios separados                                | DEBERÍA   | 6    | 🟡 Base | `db77434` `is_training`                                                                      |
| RF-F23 | Cambios del backoffice en los terminales en < 1 min o al reconectar             | DEBE      | 2    | ✅      | `e2e/pos-config.spec.ts` (precio nuevo en la terminal en < 1 min)                            |

## RNF — Requerimientos no funcionales

| ID     | Requerimiento                                                                | Prioridad | Fase | Estado  | Evidencia                                                                                                                                    |
| ------ | ---------------------------------------------------------------------------- | --------- | ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| RNF-01 | Disponibilidad nube 99,9 % mensual                                           | DEBE      | 6    | ⬜      |                                                                                                                                              |
| RNF-02 | 24 h de operación de la sede sin internet                                    | DEBE      | 2    | 🟡 Base | `e2e/pos-offline.spec.ts` (puerta) (servicio completo sin red y recarga); turnos sin conexión en la Fase 4 (DEC-026)                         |
| RNF-03 | Sincronización sin pérdidas ni duplicados; indicador de pendientes           | DEBE      | 2    | ✅      | `e2e/pos-offline.spec.ts` (puerta), `sync.int.test.ts`, `hub.int.test.ts`, `sync-properties.test.ts`                                         |
| RNF-04 | Conflictos resueltos por reglas escritas; lista al gerente                   | DEBE      | 2    | ✅      | `docs/SYNC.md` §5, `sync.int.test.ts`, `e2e/sync-conflicts.spec.ts`                                                                          |
| RNF-05 | Red local con nodo principal y relevo sin configuración manual               | DEBE      | 2    | 🟡 Base | Hub y relevo probados a nivel de protocolo (`hub.int.test.ts`); HTTPS en la LAN con hardware real en la Fase 6                               |
| RNF-06 | POS < 200 ms por ítem, mapa < 1 s, KDS < 2 s en LAN                          | DEBE      | 2    | 🟡 Base | Ítem < 200 ms medido en `e2e/pos-offline.spec.ts` (puerta); KDS < 2 s en la Fase 3                                                           |
| RNF-07 | Cambio de estado visible en todos los dispositivos en < 2 s                  | DEBE      | 2, 3 | 🟡 Base | `4b272f6` WebSocket                                                                                                                          |
| RNF-08 | 10 terminales, 50 mesas, 300 órdenes/día, 60 en hora pico por sede           | DEBE      | 3    | ⬜      |                                                                                                                                              |
| RNF-09 | Crecer de 5 a 500 sedes sin rediseñar modelo ni arquitectura                 | DEBE      | 0    | 🟡 Base | `db77434` multi-tenant + UUID v7                                                                                                             |
| RNF-10 | HTTPS, hashes, PIN con bloqueo, permisos verificados en el servidor          | DEBE      | 1    | 🟡 Base | argon2id, bloqueo de PIN por terminal y permisos en servidor (`people.int.test.ts`); HTTPS al desplegar (Fase 6)                             |
| RNF-11 | Nunca guardar ni ver números de tarjeta                                      | DEBE      | 2    | ✅      | Sin datos de tarjeta: el terminal independiente solo confirma el monto (RF-D04)                                                              |
| RNF-12 | Ninguna consulta sin filtro de organización; prueba de cruce que debe fallar | DEBE      | 1    | ✅      | `tenancy.int.test.ts`, 404 entre organizaciones en `locations.int.test.ts`, `people.int.test.ts`, `admin.int.test.ts`, `catalog.int.test.ts` |
| RNF-13 | Datos y respaldos en Suiza; consentimientos registrados                      | DEBE      | 6    | ⬜      |                                                                                                                                              |
| RNF-14 | Respaldos cada hora, retención 30 días, RPO 1 h, RTO 4 h                     | DEBE      | 6    | ⬜      |                                                                                                                                              |
| RNF-15 | Retención legal 10 años exportable aunque el restaurante se vaya             | DEBE      | 4, 6 | ⬜      |                                                                                                                                              |
| RNF-16 | Monitoreo y alertas a soporte en < 5 min                                     | DEBE      | 6    | 🟡 Base | `e0420fc` `/api/v1/health`, `4b272f6` `/health`                                                                                              |
| RNF-17 | Despliegues sin corte y compatibles con terminales viejos                    | DEBE      | 6    | 🟡 Base | Estados como `varchar` (ARQUITECTURA)                                                                                                        |
| RNF-18 | Logs estructurados por organización, sede, terminal y usuario; 90 días       | DEBE      | 6    | ⬜      |                                                                                                                                              |
| RNF-19 | Pruebas automáticas de toda RN, dinero, impuesto y sync offline              | DEBE      | 0+   | 🟡 Base | Vitest + Playwright + CI                                                                                                                     |
| RNF-20 | Soporte directo en horas pico durante el piloto                              | DEBE      | 6    | ⬜      |                                                                                                                                              |
| RNF-21 | API documentada y manuales cortos por rol                                    | DEBERÍA   | 6    | 🟡 Base | API documentada (OpenAPI 3.1 + `/api/v1/docs`); manuales por rol en Fase 6                                                                   |
| RNF-22 | Primer pedido tras 30 min de capacitación; botones ≥ 44 px; ≤ 3 toques       | DEBERÍA   | 2    | ✅      | `smoke.spec.ts` (≥ 44 px); ítem simple en 3 toques (mesa, abrir, producto)                                                                   |
| RNF-23 | Interfaz DE/FR/IT/EN y formato suizo CHF 1'234.50                            | PODRÍA    | 1    | ✅      | Interfaz DE/FR/IT/EN/ES, formato `CHF 1'234.50` (`money.test.ts`)                                                                            |

## RN — Reglas de negocio

Cada RN debe convertirse en una prueba automática del Core (RNF-19).

| ID    | Regla                                                                         | Prioridad | Fase | Estado  | Evidencia                                                                                                     |
| ----- | ----------------------------------------------------------------------------- | --------- | ---- | ------- | ------------------------------------------------------------------------------------------------------------- |
| RN-01 | Precios con MWST incluida; el impuesto se extrae, nunca se suma               | Regla     | 1    | ✅      | `calculation.test.ts`                                                                                         |
| RN-02 | Tasas 8,1/2,6/3,8 % como datos con vigencia, no constantes                    | Regla     | 1    | ✅      | `calculation.test.ts`, `admin.int.test.ts`                                                                    |
| RN-03 | Tasa por categoría fiscal + canal + tipo de consumo                           | Regla     | 1    | ✅      | `calculation.test.ts`, `admin.int.test.ts`                                                                    |
| RN-04 | Tasa y monto de impuesto congelados en la línea                               | Regla     | 1    | ✅      | `calculation.test.ts`                                                                                         |
| RN-05 | Cambio de canal antes de pagar recalcula y audita; después no                 | Regla     | 2    | ✅      | `channel.test.ts`, `reducer.test.ts` (`order.change_channel`)                                                 |
| RN-06 | Rappen enteros; redondeo 0,05 solo al efectivo, registrado como redondeo      | Regla     | 1    | ✅      | `money.test.ts`, `settlement.test.ts`                                                                         |
| RN-07 | Propina fuera de la venta, sin MWST, asignada al mesero                       | Regla     | 2    | ✅      | `settlement.test.ts`, `reducer.test.ts`, `e2e/pos-offline.spec.ts` (puerta)                                   |
| RN-08 | Contenido obligatorio del recibo; nombre del cliente desde CHF 400            | Regla     | 2    | ✅      | `receipts/build.test.ts`, `render.test.ts`                                                                    |
| RN-09 | Cada pago genera un recibo; la reimpresión es copia                           | Regla     | 2    | ✅      | `e2e/pos-offline.spec.ts` (puerta) (un recibo por pago), `e2e/pos-online.spec.ts` (copia)                     |
| RN-10 | Recibos, cierres, libro de caja y auditoría: 10 años, sin modificar ni borrar | Regla     | 0, 4 | 🟡 Base | `db77434` triggers + test de integración                                                                      |
| RN-11 | Nada se borra: anulaciones y correcciones son registros nuevos                | Regla     | 2    | ✅      | `reducer.test.ts` (anular parte de una línea crea otra; nada se borra)                                        |
| RN-12 | Cierre automático con ítems servidos/anulados y pago completo                 | Regla     | 2    | ✅      | `reducer.test.ts`, `e2e/pos-offline.spec.ts` (puerta) (cierre automático, mesa libre)                         |
| RN-13 | Ítem anulado tras enviarse avisa en el KDS                                    | Regla     | 3    | ⬜      |                                                                                                               |
| RN-14 | Un pago registrado no se modifica; se devuelve y se registra otro             | Regla     | 2    | ✅      | `reducer.test.ts`, `e2e/pos-online.spec.ts` (devolución, pago intacto)                                        |
| RN-15 | Descuentos, anulaciones y devoluciones sobre el umbral piden PIN de gerente   | Regla     | 2    | ✅      | `authorization.test.ts`, `reducer.test.ts`, `e2e/pos-online.spec.ts` (PIN de gerente en el mismo dispositivo) |
| RN-16 | Números de orden secuenciales, nunca reutilizados; prefijo sin conexión       | Regla     | 2    | ✅      | `numbering.test.ts`, `sync.int.test.ts` (número repetido con sufijo), `e2e/pos-offline.spec.ts` (puerta)      |
| RN-17 | Solo se pide lo disponible para canal, franja y no agotado; valida el Core    | Regla     | 1    | ✅      | `rules.test.ts`, `catalog.int.test.ts`                                                                        |
| RN-18 | Sin alérgenos u origen no se publica a QR ni web                              | Regla     | 1    | ✅      | `rules.test.ts`, `catalog.int.test.ts`                                                                        |
| RN-19 | Un turno abierto por terminal o cajero; sin turno no hay efectivo             | Regla     | 4    | ⬜      |                                                                                                               |
| RN-20 | No se cierra el día con turnos u órdenes abiertas                             | Regla     | 4    | ⬜      |                                                                                                               |
| RN-21 | Un cierre es definitivo; correcciones referencian el cierre                   | Regla     | 4    | 🟡 Base | `db77434` trigger + `daily_closing_id`                                                                        |
| RN-22 | Bloqueo de mesa antes de la reserva y no-show tras la espera configurada      | Regla     | 5    | 🟡 Base | `19d172c` settings DEC-004                                                                                    |
| RN-23 | Cliente con consentimiento; anonimización conserva ventas                     | Regla     | 1    | ✅      | `privacy.test.ts`, `admin.int.test.ts`                                                                        |
| RN-24 | Pedido QR solo si la mesa y el modo QR lo permiten                            | Regla     | 5    | ⬜      |                                                                                                               |

## PA — Principios de arquitectura

Se cumplen en todo el código; la evidencia es cómo se vigilan.

| ID    | Principio                         | Prioridad | Fase | Estado     | Cómo se vigila                                                                            |
| ----- | --------------------------------- | --------- | ---- | ---------- | ----------------------------------------------------------------------------------------- |
| PA-01 | Monolito modular + API-first      | Principio | 0+   | 🟢 Vigente | Módulos en `@pos/core`; ESLint prohíbe frameworks en core                                 |
| PA-02 | Una sola fuente de verdad         | Principio | 0+   | 🟢 Vigente | Un esquema compartido por nube y hub                                                      |
| PA-03 | Offline-first en la sede          | Principio | 2    | 🟢 Vigente | PWA + Dexie + registro de operaciones + hub; `e2e/pos-offline.spec.ts` (puerta)           |
| PA-04 | Pagos desacoplados                | Principio | 2    | 🟢 Vigente | `PaymentAdapter` (`adapters.test.ts`)                                                     |
| PA-05 | Estado de cocina ≠ estado de pago | Principio | 2    | 🟢 Vigente | Estado por ítem y por orden independientes (`reducer.test.ts`)                            |
| PA-06 | Nada se borra                     | Principio | 0+   | 🟢 Vigente | Test de invariantes: soft delete; triggers append-only                                    |
| PA-07 | La IA interpreta, el Core decide  | Principio | 1+   | ⬜         |                                                                                           |
| PA-08 | Dinero en enteros                 | Principio | 0+   | 🟢 Vigente | Tipo `Rappen`; test: ninguna columna decimal/float                                        |
| PA-09 | Multi-tenant desde el día uno     | Principio | 0+   | 🟢 Vigente | Invariante `organization_id` + `tenancy.int.test.ts` + 404 entre organizaciones en la API |
| PA-10 | Eventos confiables e idempotencia | Principio | 0+   | 🟡 Base    | `outbox_events`, `idempotency_key` únicos, UUID v7                                        |
| PA-11 | Configurable sin código           | Principio | 1    | 🟢 Vigente | `e2e/setup-restaurant.spec.ts`: montaje completo sin código                               |
| PA-12 | Datos en Suiza                    | Principio | 6    | 🟢 Vigente | Sin proveedor de nube acoplado; todo corre en Docker                                      |
