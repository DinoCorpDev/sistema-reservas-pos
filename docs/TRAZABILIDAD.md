# Trazabilidad de requerimientos

Fuente: [`docs/requerimientos.txt`](requerimientos.txt) (Requerimientos V1.0, 5 oct 2026).
Cada RF "Debe" se marca con el commit que lo cumple. `pnpm check:trace` falla si algún ID del documento
falta aquí o si una prioridad no coincide con el documento.

**Estados:** ⬜ Pendiente · 🟡 Base (estructura lista, falta el caso de uso o la pantalla) · ✅ Cumplido · ⏸ Diferido (decisión registrada en [DECISIONES.md](DECISIONES.md))

**Fases:** 0 Base · 1 Core · 2 POS y órdenes offline · 3 Cocina · 4 Caja y reportes · 5 Capa digital · 6 Piloto · Post = después del piloto

**Commits de la Fase 0:** `19d172c` core (dinero, IDs, eventos, permisos) · `303c48f` UID suizo · `db77434` esquema, migraciones y seed · `e0420fc` web · `4b272f6` hub

| Resumen | Total | Debe | Debería | Podría |
| ------- | ----: | ---: | ------: | -----: |
| RF      |   126 |   91 |      27 |      8 |
| RNF     |    23 |   20 |       2 |      1 |
| RN      |    24 |    — |       — |      — |
| PA      |    12 |    — |       — |      — |

## RF-A — Organización, sedes, usuarios y permisos

| ID     | Requerimiento                                                                           | Prioridad | Fase | Estado  | Evidencia                            |
| ------ | --------------------------------------------------------------------------------------- | --------- | ---- | ------- | ------------------------------------ |
| RF-A01 | Organización con una o varias sedes; todo dato pertenece a una organización y sede      | DEBE      | 1    | 🟡 Base | `db77434` esquema + invariantes      |
| RF-A02 | Configuración por sede: nombres, UID/MWST, CHF, zona horaria, idiomas, horarios, recibo | DEBE      | 1    | 🟡 Base | `db77434` `locations`, `303c48f` UID |
| RF-A03 | Áreas, mesas con capacidad, terminales y estaciones por sede                            | DEBE      | 1    | 🟡 Base | `db77434` esquema + seed             |
| RF-A04 | Usuarios con roles predefinidos; varios roles y varias sedes                            | DEBE      | 1    | 🟡 Base | `19d172c` roles, `db77434` tablas    |
| RF-A05 | Permisos por acción sensible; autorización de gerente con PIN en el mismo dispositivo   | DEBE      | 1    | 🟡 Base | `19d172c` permisos por rol           |
| RF-A06 | Ingreso al POS con PIN de 4-6 dígitos y cambio de usuario en < 3 s                      | DEBE      | 1    | ⬜      |                                      |
| RF-A07 | Backoffice con correo y contraseña; 2FA para administradores                            | DEBERÍA   | 1    | ⬜      |                                      |
| RF-A08 | Idioma de interfaz por usuario (DE, FR, IT, EN; ES soporte)                             | DEBE      | 1    | 🟡 Base | `db77434` `users.ui_language`        |
| RF-A09 | Fichaje simple de entrada y salida con reporte de horas (L-GAV)                         | PODRÍA    | Post | ⬜      |                                      |
| RF-A10 | Acceso de soporte DINOLABS con permiso del dueño, limitado y auditado                   | DEBERÍA   | 1    | ⬜      |                                      |
| RF-A11 | Montar un restaurante completo desde el backoffice con lista de verificación            | DEBE      | 1    | ⬜      |                                      |
| RF-A12 | Desactivar usuarios y terminales sin borrarlos                                          | DEBE      | 1    | 🟡 Base | `db77434` soft delete + `is_active`  |

## RF-B — Catálogo maestro e impuestos

| ID     | Requerimiento                                                                    | Prioridad | Fase | Estado  | Evidencia                             |
| ------ | -------------------------------------------------------------------------------- | --------- | ---- | ------- | ------------------------------------- |
| RF-B01 | Un catálogo maestro por organización; activar y precio propio por sede           | DEBE      | 1    | 🟡 Base | `db77434` `product_location_settings` |
| RF-B02 | Categorías, productos, variantes y grupos de modificadores con mín./máx. y costo | DEBE      | 1    | 🟡 Base | `db77434` esquema + seed              |
| RF-B03 | Combos y menú del día (Tagesmenü) con precio fijo, publicado en un paso          | DEBERÍA   | 1    | ⬜      |                                       |
| RF-B04 | Precio en CHF con MWST incluida; precio por canal                                | DEBE      | 1    | 🟡 Base | `db77434` `channel_prices`            |
| RF-B05 | Los 14 alérgenos por producto y modificador, visibles en POS, QR, web y comanda  | DEBE      | 1    | 🟡 Base | `19d172c` alérgenos, `db77434`        |
| RF-B06 | Origen de carne, aves y pescado por producto                                     | DEBE      | 1    | 🟡 Base | `db77434` `product_origins`           |
| RF-B07 | Traducciones DE/FR/IT/EN con respaldo al idioma de la sede                       | DEBE      | 1    | 🟡 Base | `db77434` `translations` + seed       |
| RF-B08 | Disponibilidad por franja, día y canal                                           | DEBE      | 1    | 🟡 Base | `db77434` `availability_rules`        |
| RF-B09 | Agotar en un toque ("86") con vuelta programada                                  | DEBE      | 1    | 🟡 Base | `db77434` `sold_out_until`            |
| RF-B10 | Imagen por producto y categoría                                                  | DEBERÍA   | 1    | 🟡 Base | `db77434` `image_url`                 |
| RF-B11 | Estación de cocina y curso por defecto por producto                              | DEBE      | 1    | 🟡 Base | `db77434` `product_station_routes`    |
| RF-B12 | Categoría fiscal; tasa por categoría + canal + tipo de consumo                   | DEBE      | 1    | 🟡 Base | `db77434` `tax_rules`                 |
| RF-B13 | Tasas y reglas MWST editables con fecha de vigencia, sin desplegar código        | DEBE      | 1    | 🟡 Base | `db77434` `tax_rates` con vigencia    |
| RF-B14 | Importar catálogo desde CSV/Excel y desde Zitas con vista previa                 | DEBERÍA   | 1    | ⬜      |                                       |
| RF-B15 | Publicar desde una ficha a POS, QR y web Zitas                                   | DEBE      | 1    | ⬜      |                                       |
| RF-B16 | Carta imprimible PDF por idioma                                                  | DEBERÍA   | 4    | ⬜      |                                       |
| RF-B17 | Historial de cambios de precio, impuesto y disponibilidad                        | DEBE      | 1    | 🟡 Base | `db77434` `audit_events`              |
| RF-B18 | Duplicar producto o categoría                                                    | DEBERÍA   | 1    | ⬜      |                                       |

## RF-C — Mesas, órdenes y cocina

| ID     | Requerimiento                                                                      | Prioridad | Fase | Estado  | Evidencia                          |
| ------ | ---------------------------------------------------------------------------------- | --------- | ---- | ------- | ---------------------------------- |
| RF-C01 | Mapa de mesas por área con estado derivado de la orden en tiempo real              | DEBE      | 2    | 🟡 Base | `19d172c` `TABLE_STATES`           |
| RF-C02 | Abrir mesa con comensales y mesero                                                 | DEBE      | 2    | ⬜      |                                    |
| RF-C03 | Unir, separar, mover cuenta y cambiar mesero sin perder ítems ni pagos             | DEBE      | 2    | ⬜      |                                    |
| RF-C04 | Vincular mesa con reserva (check-in) y visita; ver historial                       | DEBE      | 5    | ⬜      |                                    |
| RF-C05 | Varias órdenes abiertas en una misma mesa                                          | DEBERÍA   | 2    | ⬜      |                                    |
| RF-C06 | Áreas de temporada activables sin borrar mesas                                     | PODRÍA    | 2    | 🟡 Base | `db77434` `areas.is_active`        |
| RF-C07 | Órdenes mesa, barra, takeaway, QR y web; el tipo define canal y tasa               | DEBE      | 2    | 🟡 Base | `19d172c` canales                  |
| RF-C08 | Ítems con variante, modificadores, nota, asiento y curso; cantidad antes de enviar | DEBE      | 2    | ⬜      |                                    |
| RF-C09 | Enviar a cocina todo o un curso; marchar el siguiente                              | DEBE      | 2    | ⬜      |                                    |
| RF-C10 | Anular ítem con motivo y permiso; tachado en KDS; nunca se borra                   | DEBE      | 2    | ⬜      |                                    |
| RF-C11 | Descuentos por ítem u orden, % o monto, con motivo; botones frecuentes             | DEBE      | 2    | ⬜      |                                    |
| RF-C12 | Dividir la cuenta por partes iguales, ítems o asientos                             | DEBE      | 2    | ⬜      |                                    |
| RF-C13 | Transferir ítems entre órdenes y unir órdenes                                      | DEBE      | 2    | ⬜      |                                    |
| RF-C14 | Reabrir orden cerrada con permiso de gerente y motivo                              | DEBE      | 2    | ⬜      |                                    |
| RF-C15 | Número de orden corto por sede y día + UUID del dispositivo                        | DEBE      | 2    | 🟡 Base | `db77434` `order_number_sequences` |
| RF-C16 | Dos estados independientes; cierre automático                                      | DEBE      | 2    | 🟡 Base | `19d172c` estados                  |
| RF-C17 | Prepago o pago posterior con el mismo flujo de cocina                              | DEBE      | 2    | ⬜      |                                    |
| RF-C18 | Todo funciona sin internet y sincroniza sin duplicados ni pérdidas                 | DEBE      | 2    | ⬜      |                                    |
| RF-C19 | Vista "mis mesas" y "todas las órdenes abiertas" con tiempo desde el último envío  | DEBE      | 2    | ⬜      |                                    |
| RF-C20 | KDS por estación con mesa, hora, ítems, modificadores, notas, alérgenos y mesero   | DEBE      | 3    | ⬜      |                                    |
| RF-C21 | Ruteo automático por estación; un ítem puede ir a varias                           | DEBE      | 3    | 🟡 Base | `db77434` rutas + seed             |
| RF-C22 | Estado por ítem o ticket; marcar servido desde KDS o POS                           | DEBE      | 3    | ⬜      |                                    |
| RF-C23 | Aviso al mesero cuando un ticket está listo                                        | DEBERÍA   | 3    | ⬜      |                                    |
| RF-C24 | Tiempos y alerta de color por umbral por estación                                  | DEBE      | 3    | 🟡 Base | `db77434` `alert_after_minutes`    |
| RF-C25 | Ticket en el idioma de cocina                                                      | DEBERÍA   | 3    | 🟡 Base | `db77434` `kitchen_language`       |
| RF-C26 | Comanda impresa ESC/POS como alternativa al KDS; reimpresión                       | DEBERÍA   | 3    | ⬜      |                                    |
| RF-C27 | KDS, ruteo e impresión en la LAN sin nube                                          | DEBE      | 3    | 🟡 Base | `4b272f6` hub + WebSocket          |
| RF-C28 | Recall de tickets terminados                                                       | DEBERÍA   | 3    | ⬜      |                                    |

## RF-D — Pagos, caja y recibos

| ID     | Requerimiento                                                      | Prioridad | Fase | Estado    | Evidencia                           |
| ------ | ------------------------------------------------------------------ | --------- | ---- | --------- | ----------------------------------- |
| RF-D01 | Efectivo, tarjeta y TWINT en terminal, y pago online para QR y web | DEBE      | 2, 5 | ⏸ Parcial | Online diferido: DEC-003            |
| RF-D02 | Pagos mixtos y parciales con saldo pendiente visible               | DEBE      | 2    | ⬜        |                                     |
| RF-D03 | Efectivo con redondeo a 0,05 CHF y registro de la diferencia       | DEBE      | 2    | 🟡 Base   | `19d172c` `roundCashTo5`            |
| RF-D04 | Terminal independiente: monto digitado y confirmado en el POS      | DEBE      | 2    | ⬜        |                                     |
| RF-D05 | Integración directa con Worldline, wallee y SumUp                  | DEBERÍA   | Post | ⬜        | Fuera del MVP (sección 5)           |
| RF-D06 | Propina al mesero, reportada por persona, fuera de la venta        | DEBE      | 2    | 🟡 Base   | `db77434` `tips`                    |
| RF-D07 | Devolución total o parcial ligada al pago original                 | DEBE      | 2    | 🟡 Base   | `db77434` `refunds`                 |
| RF-D08 | Pago en EUR con tasa de cambio de la sede                          | PODRÍA    | Post | ⬜        |                                     |
| RF-D09 | Vales de comida (Lunch-Check) como medio manual                    | PODRÍA    | Post | ⬜        |                                     |
| RF-D10 | Pagos como adaptador: un proveedor nuevo no toca órdenes ni caja   | DEBE      | 2    | 🟡 Base   | `19d172c` `PAYMENT_ADAPTERS`        |
| RF-D11 | Conciliación con el cierre del terminal; diferencias con motivo    | DEBE      | 4    | 🟡 Base   | `db77434` `payment_reconciliations` |
| RF-D12 | Apertura de turno con fondo, por terminal o cajero                 | DEBE      | 4    | 🟡 Base   | `db77434` `shifts`                  |
| RF-D13 | Movimientos de caja con motivo y comprobante opcional              | DEBE      | 4    | 🟡 Base   | `db77434` `cash_movements`          |
| RF-D14 | Arqueo por denominación con diferencia comentada                   | DEBE      | 4    | 🟡 Base   | `19d172c` denominaciones CHF        |
| RF-D15 | Cierre de turno y cierre Z con resumen completo                    | DEBE      | 4    | ⬜        |                                     |
| RF-D16 | Libro de caja diario automático, exportable PDF y CSV              | DEBE      | 4    | ⬜        |                                     |
| RF-D17 | Un cierre no se edita; correcciones como movimientos nuevos        | DEBE      | 4    | 🟡 Base   | `db77434` trigger append-only       |
| RF-D18 | Apertura del cajón al cobrar en efectivo o con permiso             | DEBERÍA   | 3    | ⬜        |                                     |
| RF-D19 | No cerrar el día con turnos u órdenes abiertas; listarlas          | DEBE      | 4    | ⬜        |                                     |
| RF-D20 | Recibo válido MWST con UID, detalle, tasas y montos por tasa       | DEBE      | 2    | 🟡 Base   | `db77434` `receipts`, `303c48f`     |
| RF-D21 | Recibo digital por QR, correo o WhatsApp                           | DEBERÍA   | 5    | ⬜        |                                     |
| RF-D22 | Nombre y dirección del cliente; obligatorio desde CHF 400          | DEBE      | 2    | 🟡 Base   | `19d172c` umbral en settings        |
| RF-D23 | Recibo en el idioma del cliente                                    | DEBERÍA   | 2    | ⬜        |                                     |
| RF-D24 | Reimpresión marcada como copia y auditada                          | DEBE      | 2    | 🟡 Base   | `db77434` `copy_number`             |
| RF-D25 | Un recibo por pago dividido y por pedido QR/takeaway pagado online | DEBE      | 2    | ⬜        |                                     |

## RF-E — Capa Zitas: reservas, menú QR, takeaway y clientes

| ID     | Requerimiento                                                          | Prioridad | Fase | Estado     | Evidencia                           |
| ------ | ---------------------------------------------------------------------- | --------- | ---- | ---------- | ----------------------------------- |
| RF-E01 | Reservas vinculadas a áreas y mesas reales con tiempos de ocupación    | DEBE      | 5    | 🟡 Base    | `db77434` `reservations`            |
| RF-E02 | Check-in: crea visita, ocupa mesa, abre orden                          | DEBE      | 5    | ⬜         |                                     |
| RF-E03 | Estados de reserva; walk-ins como visita sin reserva                   | DEBE      | 5    | 🟡 Base    | `19d172c` estados                   |
| RF-E04 | Confirmaciones y recordatorios por WhatsApp o correo (ya en Zitas)     | DEBE      | 5    | ⬜         | Lo envía Zitas con eventos del Core |
| RF-E05 | Depósito o prepago para grupos grandes                                 | PODRÍA    | Post | ⬜         |                                     |
| RF-E06 | Menú QR por mesa con catálogo en el idioma del cliente                 | DEBE      | 5    | 🟡 Base    | `db77434` `qr_code`, `e0420fc` ruta |
| RF-E07 | Pedido QR entra como orden del Core en la mesa correcta                | DEBE      | 5    | ⬜         |                                     |
| RF-E08 | Modo QR por área o mesa: ver, pedir, pedir y pagar                     | DEBE      | 5    | 🟡 Base    | `db77434` `qr_mode`                 |
| RF-E09 | Pago online del pedido QR (TWINT o tarjeta) o "pagar en caja"          | DEBE      | 5    | ⏸ Diferido | DEC-003: adaptador stub             |
| RF-E10 | Llamar al mesero o pedir la cuenta desde el QR                         | DEBERÍA   | 5    | ⬜         |                                     |
| RF-E11 | Takeaway desde el portal web con hora de recogida y tasa reducida      | DEBE      | 5    | ⬜         |                                     |
| RF-E12 | Takeaway en mostrador con número para llamar                           | DEBE      | 5    | ⬜         |                                     |
| RF-E13 | Aviso de pedido listo por WhatsApp o SMS                               | DEBERÍA   | 5    | ⬜         |                                     |
| RF-E14 | Cliente único por teléfono o correo compartido por todos los canales   | DEBE      | 1    | 🟡 Base    | `db77434` `customers`               |
| RF-E15 | Historial por cliente: visitas, gasto, platos, mesero, notas, alergias | DEBE      | 5    | ⬜         |                                     |
| RF-E16 | Consentimiento al crear; exportar o anonimizar sin tocar ventas        | DEBE      | 1    | 🟡 Base    | `db77434` `consents`                |
| RF-E17 | Etiquetas y búsqueda rápida desde el POS                               | DEBERÍA   | 2    | 🟡 Base    | `db77434` `customers.tags`          |
| RF-E18 | Fidelización simple después del piloto                                 | PODRÍA    | Post | ⬜         |                                     |
| RF-E19 | WhatsApp para recibos y avisos reutilizando Zitas                      | DEBERÍA   | 5    | ⬜         |                                     |
| RF-E20 | Zita IA responde sobre la carta con datos del Core, sin crear pedidos  | DEBE      | 5    | ⬜         |                                     |

## RF-F — Reportes, auditoría, integraciones, IA y backoffice

| ID     | Requerimiento                                                                   | Prioridad | Fase | Estado  | Evidencia                           |
| ------ | ------------------------------------------------------------------------------- | --------- | ---- | ------- | ----------------------------------- |
| RF-F01 | Ventas por día, hora, sede, mesero, canal, categoría y producto con comparación | DEBE      | 4    | ⬜      |                                     |
| RF-F02 | Reporte MWST por tasa y periodo para la fiduciaria                              | DEBE      | 4    | ⬜      |                                     |
| RF-F03 | Cierres Z consultables, inalterables, exportables PDF y CSV                     | DEBE      | 4    | 🟡 Base | `db77434` trigger append-only       |
| RF-F04 | Exportación contable CSV genérico                                               | DEBE      | 4    | ⬜      |                                     |
| RF-F05 | Formatos nativos bexio, Abacus y Banana                                         | DEBERÍA   | Post | ⬜      |                                     |
| RF-F06 | Anulaciones, descuentos y devoluciones por usuario                              | DEBE      | 4    | ⬜      |                                     |
| RF-F07 | Propinas por persona y periodo                                                  | DEBE      | 4    | ⬜      |                                     |
| RF-F08 | Tiempos de cocina y de mesa                                                     | DEBERÍA   | 4    | ⬜      |                                     |
| RF-F09 | Reportes de reservas: ocupación, no-shows, origen                               | DEBERÍA   | 5    | ⬜      |                                     |
| RF-F10 | Tablero del dueño en el celular                                                 | DEBERÍA   | 4    | ⬜      |                                     |
| RF-F11 | Auditoría append-only de toda operación sensible                                | DEBE      | 1    | 🟡 Base | `db77434` `audit_events` + triggers |
| RF-F12 | Consulta de auditoría por filtros y exportación CSV                             | DEBE      | 4    | ⬜      |                                     |
| RF-F13 | Archivo de 10 años a prueba de modificaciones, exportable PDF/CSV/JSON          | DEBE      | 4, 6 | 🟡 Base | `db77434` triggers + `content_hash` |
| RF-F14 | API HTTP documentada con credenciales por organización                          | DEBE      | 1    | 🟡 Base | `e0420fc` `/api/v1`                 |
| RF-F15 | Webhooks de eventos                                                             | DEBERÍA   | 5    | 🟡 Base | `db77434` `outbox_events`           |
| RF-F16 | Importar pedidos de Uber Eats, Just Eat y Smood                                 | PODRÍA    | Post | ⬜      |                                     |
| RF-F17 | Impresoras de red (Epson ePOS, Star CloudPRNT, ESC/POS) con prueba              | DEBE      | 1, 3 | 🟡 Base | `db77434` `printers`                |
| RF-F18 | Preguntas en lenguaje natural sobre el negocio con datos del Core               | DEBERÍA   | Post | ⬜      |                                     |
| RF-F19 | Sugerencias operativas confirmadas por un humano                                | PODRÍA    | Post | ⬜      |                                     |
| RF-F20 | La IA nunca crea, modifica ni anula órdenes, pagos, precios ni impuestos        | DEBE      | 1    | ⬜      |                                     |
| RF-F21 | Backoffice web responsivo para RF-A, RF-B y RF-F17, usuarios y reportes         | DEBE      | 1    | 🟡 Base | `e0420fc` ruta `/backoffice`        |
| RF-F22 | Modo entrenamiento con datos ficticios separados                                | DEBERÍA   | 6    | 🟡 Base | `db77434` `is_training`             |
| RF-F23 | Cambios del backoffice en los terminales en < 1 min o al reconectar             | DEBE      | 2    | ⬜      |                                     |

## RNF — Requerimientos no funcionales

| ID     | Requerimiento                                                                | Prioridad | Fase | Estado  | Evidencia                                       |
| ------ | ---------------------------------------------------------------------------- | --------- | ---- | ------- | ----------------------------------------------- |
| RNF-01 | Disponibilidad nube 99,9 % mensual                                           | DEBE      | 6    | ⬜      |                                                 |
| RNF-02 | 24 h de operación de la sede sin internet                                    | DEBE      | 2    | ⬜      |                                                 |
| RNF-03 | Sincronización sin pérdidas ni duplicados; indicador de pendientes           | DEBE      | 2    | 🟡 Base | `db77434` claves idempotentes                   |
| RNF-04 | Conflictos resueltos por reglas escritas; lista al gerente                   | DEBE      | 2    | 🟡 Base | `db77434` `sync_operations`                     |
| RNF-05 | Red local con nodo principal y relevo sin configuración manual               | DEBE      | 2    | 🟡 Base | `4b272f6` hub                                   |
| RNF-06 | POS < 200 ms por ítem, mapa < 1 s, KDS < 2 s en LAN                          | DEBE      | 2    | ⬜      |                                                 |
| RNF-07 | Cambio de estado visible en todos los dispositivos en < 2 s                  | DEBE      | 2, 3 | 🟡 Base | `4b272f6` WebSocket                             |
| RNF-08 | 10 terminales, 50 mesas, 300 órdenes/día, 60 en hora pico por sede           | DEBE      | 3    | ⬜      |                                                 |
| RNF-09 | Crecer de 5 a 500 sedes sin rediseñar modelo ni arquitectura                 | DEBE      | 0    | 🟡 Base | `db77434` multi-tenant + UUID v7                |
| RNF-10 | HTTPS, hashes, PIN con bloqueo, permisos verificados en el servidor          | DEBE      | 1    | 🟡 Base | `db77434` intentos/bloqueo PIN                  |
| RNF-11 | Nunca guardar ni ver números de tarjeta                                      | DEBE      | 2    | 🟡 Base | Esquema sin datos de tarjeta                    |
| RNF-12 | Ninguna consulta sin filtro de organización; prueba de cruce que debe fallar | DEBE      | 1    | 🟡 Base | `db77434` invariante `organization_id`          |
| RNF-13 | Datos y respaldos en Suiza; consentimientos registrados                      | DEBE      | 6    | ⬜      |                                                 |
| RNF-14 | Respaldos cada hora, retención 30 días, RPO 1 h, RTO 4 h                     | DEBE      | 6    | ⬜      |                                                 |
| RNF-15 | Retención legal 10 años exportable aunque el restaurante se vaya             | DEBE      | 4, 6 | ⬜      |                                                 |
| RNF-16 | Monitoreo y alertas a soporte en < 5 min                                     | DEBE      | 6    | 🟡 Base | `e0420fc` `/api/v1/health`, `4b272f6` `/health` |
| RNF-17 | Despliegues sin corte y compatibles con terminales viejos                    | DEBE      | 6    | 🟡 Base | Estados como `varchar` (ARQUITECTURA)           |
| RNF-18 | Logs estructurados por organización, sede, terminal y usuario; 90 días       | DEBE      | 6    | ⬜      |                                                 |
| RNF-19 | Pruebas automáticas de toda RN, dinero, impuesto y sync offline              | DEBE      | 0+   | 🟡 Base | Vitest + Playwright + CI                        |
| RNF-20 | Soporte directo en horas pico durante el piloto                              | DEBE      | 6    | ⬜      |                                                 |
| RNF-21 | API documentada y manuales cortos por rol                                    | DEBERÍA   | 6    | ⬜      |                                                 |
| RNF-22 | Primer pedido tras 30 min de capacitación; botones ≥ 44 px; ≤ 3 toques       | DEBERÍA   | 2    | 🟡 Base | `e0420fc` `@pos/ui` Button + E2E                |
| RNF-23 | Interfaz DE/FR/IT/EN y formato suizo CHF 1'234.50                            | PODRÍA    | 1    | 🟡 Base | `19d172c` `formatChf`                           |

## RN — Reglas de negocio

Cada RN debe convertirse en una prueba automática del Core (RNF-19).

| ID    | Regla                                                                         | Prioridad | Fase | Estado  | Evidencia                                         |
| ----- | ----------------------------------------------------------------------------- | --------- | ---- | ------- | ------------------------------------------------- |
| RN-01 | Precios con MWST incluida; el impuesto se extrae, nunca se suma               | Regla     | 1    | ⬜      |                                                   |
| RN-02 | Tasas 8,1/2,6/3,8 % como datos con vigencia, no constantes                    | Regla     | 1    | 🟡 Base | `db77434` `tax_rates` + seed                      |
| RN-03 | Tasa por categoría fiscal + canal + tipo de consumo                           | Regla     | 1    | 🟡 Base | `db77434` `tax_rules` + seed                      |
| RN-04 | Tasa y monto de impuesto congelados en la línea                               | Regla     | 1    | 🟡 Base | `db77434` invariante `order_items`                |
| RN-05 | Cambio de canal antes de pagar recalcula y audita; después no                 | Regla     | 2    | ⬜      |                                                   |
| RN-06 | Rappen enteros; redondeo 0,05 solo al efectivo, registrado como redondeo      | Regla     | 1    | 🟡 Base | `19d172c` `roundCashTo5` + tests                  |
| RN-07 | Propina fuera de la venta, sin MWST, asignada al mesero                       | Regla     | 2    | 🟡 Base | `db77434` `tips`, `tip_rappen`                    |
| RN-08 | Contenido obligatorio del recibo; nombre del cliente desde CHF 400            | Regla     | 2    | 🟡 Base | `303c48f` UID, `19d172c` umbral                   |
| RN-09 | Cada pago genera un recibo; la reimpresión es copia                           | Regla     | 2    | ⬜      |                                                   |
| RN-10 | Recibos, cierres, libro de caja y auditoría: 10 años, sin modificar ni borrar | Regla     | 0, 4 | 🟡 Base | `db77434` triggers + test de integración          |
| RN-11 | Nada se borra: anulaciones y correcciones son registros nuevos                | Regla     | 2    | 🟡 Base | `db77434` invariante soft delete                  |
| RN-12 | Cierre automático con ítems servidos/anulados y pago completo                 | Regla     | 2    | ⬜      |                                                   |
| RN-13 | Ítem anulado tras enviarse avisa en el KDS                                    | Regla     | 3    | ⬜      |                                                   |
| RN-14 | Un pago registrado no se modifica; se devuelve y se registra otro             | Regla     | 2    | ⬜      |                                                   |
| RN-15 | Descuentos, anulaciones y devoluciones sobre el umbral piden PIN de gerente   | Regla     | 2    | 🟡 Base | `19d172c` umbrales DEC-004                        |
| RN-16 | Números de orden secuenciales, nunca reutilizados; prefijo sin conexión       | Regla     | 2    | 🟡 Base | `db77434` índice único + prefijos                 |
| RN-17 | Solo se pide lo disponible para canal, franja y no agotado; valida el Core    | Regla     | 1    | ⬜      |                                                   |
| RN-18 | Sin alérgenos u origen no se publica a QR ni web                              | Regla     | 1    | 🟡 Base | `db77434` `allergens_complete`, `requires_origin` |
| RN-19 | Un turno abierto por terminal o cajero; sin turno no hay efectivo             | Regla     | 4    | ⬜      |                                                   |
| RN-20 | No se cierra el día con turnos u órdenes abiertas                             | Regla     | 4    | ⬜      |                                                   |
| RN-21 | Un cierre es definitivo; correcciones referencian el cierre                   | Regla     | 4    | 🟡 Base | `db77434` trigger + `daily_closing_id`            |
| RN-22 | Bloqueo de mesa antes de la reserva y no-show tras la espera configurada      | Regla     | 5    | 🟡 Base | `19d172c` settings DEC-004                        |
| RN-23 | Cliente con consentimiento; anonimización conserva ventas                     | Regla     | 1    | 🟡 Base | `db77434` `consents`, `anonymized_at`             |
| RN-24 | Pedido QR solo si la mesa y el modo QR lo permiten                            | Regla     | 5    | ⬜      |                                                   |

## PA — Principios de arquitectura

Se cumplen en todo el código; la evidencia es cómo se vigilan.

| ID    | Principio                         | Prioridad | Fase | Estado     | Cómo se vigila                                            |
| ----- | --------------------------------- | --------- | ---- | ---------- | --------------------------------------------------------- |
| PA-01 | Monolito modular + API-first      | Principio | 0+   | 🟢 Vigente | Módulos en `@pos/core`; ESLint prohíbe frameworks en core |
| PA-02 | Una sola fuente de verdad         | Principio | 0+   | 🟢 Vigente | Un esquema compartido por nube y hub                      |
| PA-03 | Offline-first en la sede          | Principio | 2    | 🟡 Base    | UUID del dispositivo, columnas de sync, hub               |
| PA-04 | Pagos desacoplados                | Principio | 2    | 🟡 Base    | `PAYMENT_ADAPTERS`; `payments.adapter`                    |
| PA-05 | Estado de cocina ≠ estado de pago | Principio | 2    | 🟡 Base    | `prep_status` por ítem, `payment_status` por orden        |
| PA-06 | Nada se borra                     | Principio | 0+   | 🟢 Vigente | Test de invariantes: soft delete; triggers append-only    |
| PA-07 | La IA interpreta, el Core decide  | Principio | 1+   | ⬜         |                                                           |
| PA-08 | Dinero en enteros                 | Principio | 0+   | 🟢 Vigente | Tipo `Rappen`; test: ninguna columna decimal/float        |
| PA-09 | Multi-tenant desde el día uno     | Principio | 0+   | 🟢 Vigente | Test: toda tabla con `organization_id` NOT NULL           |
| PA-10 | Eventos confiables e idempotencia | Principio | 0+   | 🟡 Base    | `outbox_events`, `idempotency_key` únicos, UUID v7        |
| PA-11 | Configurable sin código           | Principio | 1    | 🟡 Base    | Settings por sede con Zod                                 |
| PA-12 | Datos en Suiza                    | Principio | 6    | 🟢 Vigente | Sin proveedor de nube acoplado; todo corre en Docker      |
