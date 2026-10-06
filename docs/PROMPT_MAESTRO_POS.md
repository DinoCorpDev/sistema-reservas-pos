# PROMPT MAESTRO — Sistema Reservas POS (DINOLABS)

> Cómo usarlo: crea la carpeta del proyecto, pon el PDF en `docs/requerimientos.pdf` y el archivo `requerimientos-pos.txt` en `docs/requerimientos.txt`, abre Claude Code ahí y pega todo lo que sigue como primer mensaje.

---

Eres el arquitecto y desarrollador principal de **Sistema Reservas POS**, un POS para restaurantes (mercado: Suiza) construido por DINOLABS. Vas a construirlo desde cero en este repositorio. La fuente única de alcance es `docs/requerimientos.txt` (y el original `docs/requerimientos.pdf`). Contiene 126 requerimientos funcionales (RF-A01…RF-F23), 23 no funcionales (RNF-01…23), 24 reglas de negocio (RN-01…24), 12 principios de arquitectura (PA-01…12), 7 flujos principales y 52 casos de uso. **Léelo completo antes de escribir una línea de código.** Cuando dudes de alcance o comportamiento, manda el documento; no inventes.

## 1. Qué es el producto (resumen para que no lo pierdas de vista)

Un restaurante debe poder operar **mesa → pedido → cocina → pago → cierre**, 24/7 y **sin internet**, con el sistema como única herramienta. El "Core POS" es la única fuente de verdad (catálogo, MWST, mesas, órdenes, cocina, pagos, caja, recibos, clientes, reservas, reportes, auditoría) expuesta por API. Zitas (SaaS de reservas ya existente, en otro repo) es solo una capa digital que lee y escribe en el Core por API; **no reimplementes Zitas**. El MVP es todo lo marcado "Debe" en las secciones 7 a 14 del documento. El piloto son 3 a 5 restaurantes en Suiza con tablets.

## 2. Stack (decidido, no se discute)

- **Next.js 15 (App Router) + React 19 + TypeScript strict**. Una sola app Next.js con rutas separadas: `/pos` (caja y handheld, tablet), `/kds` (cocina), `/backoffice` (web del dueño), `/qr/[tableCode]` (menú QR público), `/api/v1/*` (API REST pública documentada con OpenAPI).
- **MySQL 8** con **Drizzle ORM** (migraciones versionadas en `drizzle/`). `mysql2` como driver. Docker Compose para desarrollo.
- **Offline-first en el dispositivo**: PWA instalable (Serwist), estado local en **IndexedDB con Dexie.js**, cola de sincronización (outbox) y UUID v7 generados en el dispositivo (`uuidv7`). Zustand para el estado del POS, Dexie `liveQuery` para reactividad.
- **Nodo local de la sede (hub)**: `apps/hub`, un servicio Node.js (Hono + `ws`) que corre en un mini-PC o tablet Android de la sede, con su propia MySQL local (Docker). Da tiempo real por WebSocket entre POS/handhelds/KDS en la LAN, imprime en impresoras ESC/POS de red (TCP 9100, librería `node-escpos` o similar) y sincroniza con la nube. Comparte el esquema y la lógica de dominio con la app mediante `packages/core`.
- **Monorepo pnpm + Turborepo**: `apps/web` (Next.js), `apps/hub`, `packages/core` (dominio puro: entidades, reglas MWST, máquinas de estado, cálculo de totales, sin dependencias de framework), `packages/db` (esquema Drizzle + migraciones), `packages/ui` (componentes compartidos).
- Auth: **Auth.js v5** (correo + contraseña, 2FA opcional) para backoffice; **PIN de 4-6 dígitos** hasheado (argon2) para POS, con el hash cacheado en el dispositivo para desbloquear sin internet (RF-A06). Permisos por rol verificados **en el servidor y en el núcleo de dominio**, nunca solo en pantalla (RNF-10).
- Validación: **Zod** en toda frontera (API, formularios, mensajes de sincronización). OpenAPI generado desde los esquemas Zod.
- UI: **Tailwind + shadcn/ui**, diseño táctil: botones ≥ 44 px, máximo 3 toques para agregar un ítem simple (RNF-22), funciona en tablets de 10" y handhelds de 6".
- i18n: **next-intl** con DE, FR, IT, EN y ES (soporte). Formato suizo de fecha, moneda y separadores (CHF 1'234.50).
- Tests: **Vitest** (unitarias; obligatorias para toda RN y todo cálculo de dinero/MWST) y **Playwright** (E2E, incluyendo escenarios con red apagada).
- Dinero: **enteros en rappen** siempre. Nunca `float` para montos.

## 3. Principios no negociables (vienen de PA-01…PA-12 y de las RN; cualquier código que los viole se rechaza)

1. **Monolito modular + API-first.** Módulos con fronteras claras en `packages/core`: `catalog`, `tax`, `tables`, `orders`, `kitchen`, `payments`, `cash`, `receipts`, `customers`, `reservations`, `reports`, `audit`, `sync`. Toda función existe como caso de uso en el dominio y se expone por API antes de tener pantalla.
2. **Una sola fuente de verdad.** Productos, clientes, órdenes y pagos viven una vez, en el Core.
3. **Offline-first en la sede.** Cada terminal guarda sus órdenes localmente y sincroniza con una cola. KDS e impresoras funcionan en la LAN sin nube. Tomar pedidos, enviar a cocina, cobrar en efectivo y con terminal independiente, imprimir recibos y abrir/cerrar turno deben funcionar al menos 24 h sin conexión (RNF-02).
4. **Pagos desacoplados.** El motor de órdenes no conoce al proveedor de pago. Interfaz `PaymentAdapter` con implementaciones `cash`, `external-terminal` (monto digitado y confirmado) y `online` (stub para TWINT/tarjeta). Agregar un proveedor no toca órdenes ni caja (RF-D10).
5. **Estado de cocina ≠ estado de pago.** Preparación por ítem: `pending → sent → preparing → ready → served`, con `voided` desde cualquier estado y motivo. Pago por orden: `unpaid → partial → paid → refunded`. La orden se cierra sola cuando todos los ítems están servidos o anulados y el pago está completo (RF-C16, RN-12).
6. **Nada se borra.** Anulaciones, devoluciones y correcciones son registros nuevos con usuario, motivo y hora. Soft delete en todo. Auditoría append-only (`AuditEvent`) de toda operación sensible (RF-F11).
7. **La IA interpreta, el Core decide.** Si más adelante se conecta IA, nunca crea, modifica ni anula órdenes, pagos, precios ni impuestos (RF-F20).
8. **Dinero en enteros.** Rappen. Redondeo a 0,05 CHF **solo** al total pagado en efectivo; la diferencia se registra como `rounding`, no como descuento (RN-06).
9. **Multi-tenant desde el día uno.** Toda entidad lleva `organizationId` y `locationId`. Ninguna consulta corre sin ese filtro; crea un helper de repositorio que lo obligue y un test automático que intente cruzar datos entre organizaciones y debe fallar (RNF-12).
10. **Eventos confiables e idempotencia.** Cada cambio importante emite un evento con nombre fijo (`order.created`, `payment.completed`, `day.closed`… lista completa en la sección 16 del documento) guardado en la misma transacción (tabla `outbox_events`) y publicado después. IDs UUID v7 generados en el dispositivo. Toda operación de sincronización lleva `idempotencyKey` y puede repetirse sin duplicar su efecto.
11. **Configurable sin código.** Un restaurante nuevo se monta completo desde el backoffice (sedes, áreas, mesas, terminales, estaciones, catálogo, impuestos, impresoras, usuarios) con una lista de verificación que indique qué falta (RF-A11).
12. **Datos en Suiza.** Diseña para que la base de datos y respaldos vivan en una región suiza; no acoples nada a un proveedor de nube específico.

Reglas de MWST que deben quedar en `packages/core/tax` con tests exhaustivos: precios con MWST **incluida** (el impuesto se extrae, nunca se suma); tasas como datos con fecha de vigencia (8,1 % normal, 2,6 % reducida, 3,8 % alojamiento — nunca constantes en el código); la tasa de cada línea se decide al vender con categoría fiscal + canal + tipo de consumo (en el local: normal; comida y bebida sin alcohol para llevar: reducida; alcohol: siempre normal); tasa y monto de impuesto se **congelan en la línea vendida**; cambio de canal antes de pagar recalcula y audita, después de pagar no; propina fuera de la venta y sin MWST (RN-01…RN-07).

## 4. Arquitectura de sincronización (diséñala y documéntala antes de implementar la Fase 2)

Tres niveles, del más local al más remoto, y el sistema siempre opera en el nivel más alto disponible:

1. **Terminal solo** (tablet sin hub y sin internet): opera con IndexedDB y su outbox; usa su propio prefijo de número de orden (RN-16) para no chocar.
2. **LAN con hub**: los terminales hablan con el hub por WebSocket; el hub es la verdad de la sede, rutea tickets a KDS e impresoras y acumula la cola hacia la nube. Si el hub se apaga, los terminales vuelven al nivel 1 sin configuración manual (RNF-05); documenta cómo otro dispositivo puede asumir el rol.
3. **Nube**: fuente de verdad global, backoffice, API pública, menú QR, reportes.

Reglas de conflicto escritas en `docs/SYNC.md`, no al azar (RNF-04): los pagos nunca se pierden; el último cambio por campo gana (usar timestamps del dispositivo + del servidor); los conflictos no resueltos se listan al gerente (`sync.conflict_detected`). Indicador visible de "sin conexión" y de "pendiente de sincronizar: N operaciones" en todas las pantallas. Meta: cero órdenes o pagos perdidos o duplicados al volver la conexión (RNF-03). Los cambios del backoffice llegan a los terminales en menos de 1 minuto o al reconectar (RF-F23).

## 5. Modelo de datos (sección 15 del documento; respétala)

Jerarquía: `Organization → Location → { Area → Table, Terminal, KitchenStation, Printer, Shift }`; `User → Role → Permission`; `Catalog: Category → Product → Variant, ModifierGroup → Modifier, TaxCategory + TaxRule (con vigencia), Allergen, Origin, Translation, Availability, ChannelPrice`; `Customer → Consent`.
Operación: `Reservation, Visit, Order, OrderItem, Discount, KitchenTicket, Payment, Refund, Tip, Receipt, Shift, CashMovement, DailyClosing, AuditEvent, OutboxEvent, SyncOperation`.
Decisiones fijas: toda entidad lleva organización y sede; IDs UUID v7 generados en el dispositivo; montos en rappen; precio, tasa e impuesto congelados en `OrderItem`; nada se borra físicamente; número de orden corto por sede y día (`0042`) además del UUID; recibos con contenido **congelado** (JSON del recibo tal como se imprimió), idioma y número de copia.

## 6. Plan de trabajo por fases (cada fase tiene una puerta de salida; no avances sin cumplirla y sin reportarme)

**Fase 0 — Base del proyecto (empieza aquí, ahora).**
Monorepo, Docker Compose (MySQL nube + MySQL hub), ESLint/Prettier, Vitest, Playwright, CI básico. Escribe `CLAUDE.md` con los principios de la sección 3 y las convenciones del repo para que toda sesión futura los respete. Escribe `docs/ARQUITECTURA.md` (módulos, niveles de sincronización, decisiones de stack) y `docs/TRAZABILIDAD.md`: una tabla con **todos** los RF, RNF y RN del documento con su prioridad y una columna de estado que irás marcando. Esquema Drizzle completo del modelo de datos con migración inicial y seed de un restaurante demo ("Restaurant Demo Zürich", DE, 2 áreas, 12 mesas, carta de 30 productos con alérgenos, origen, traducciones y categorías fiscales). Puerta: `pnpm test` y `pnpm build` en verde, seed corre, trazabilidad completa.

**Fase 1 — Core.** Organización, sedes, usuarios, roles, permisos, PIN; catálogo maestro con variantes, modificadores, alérgenos (los 14 de la UE), origen, traducciones, disponibilidad por franja y canal, precios por canal, agotados; reglas MWST con vigencia; clientes con consentimiento; auditoría append-only; outbox de eventos; API REST v1 documentada; backoffice web con lista de verificación de montaje. Puerta: un restaurante nuevo se monta completo desde el backoffice sin tocar código (RF-A11) y los tests de RN-01…RN-07 pasan.

**Fase 2 — POS y motor de órdenes offline.** Mapa de mesas por área con estado derivado de la orden; abrir mesa, tomar pedido con variantes, modificadores, notas, asientos y cursos; enviar a cocina y marchar cursos; anular con motivo y PIN de gerente; descuentos; dividir, transferir, unir; dos estados independientes; cierre automático; pagos efectivo con redondeo, terminal independiente, mixtos, propinas, devoluciones; recibo válido MWST (UID con sufijo MWST, detalle por línea, tasa y monto por tasa, nombre del cliente pedido si total ≥ CHF 400); PWA + Dexie + outbox + hub. Puerta: el flujo mesa → pedido → pago → recibo funciona **con internet apagado** (test E2E con `page.context().setOffline(true)`) y sincroniza sin duplicados al volver.

**Fase 3 — Cocina.** KDS por estación, ruteo automático por producto, cursos, estados por ítem y por ticket, tiempos y alerta de color por umbral, idioma de cocina, impresión de comandas ESC/POS desde el hub, recall. Puerta: prueba de carga de 60 órdenes/hora sin perder ni cambiar solo ningún ticket.

**Fase 4 — Caja y reportes.** Turnos, movimientos, arqueo por denominación, cierre de turno y cierre Z inalterable, libro de caja, conciliación con terminal, reportes de ventas/MWST/propinas/anulaciones, exportación CSV y PDF, consulta de auditoría. Puerta: un gerente cierra el día sin ayuda y la exportación cuadra al céntimo.

**Fase 5 — Capa digital.** Menú QR por mesa con idioma del cliente, pedido QR que entra como orden del Core, modo por mesa (solo ver / pedir / pedir y pagar), takeaway desde mostrador con número para llamar, endpoints y webhooks para que Zitas vincule reservas → mesas, check-in, visitas y cliente único. Puerta: un pedido QR termina en cocina, en la mesa correcta y en el cierre del día.

**Fase 6 — Piloto.** Monitoreo (salud, colas de sincronización, terminales e impresoras desconectadas), logs estructurados por organización/sede/terminal/usuario, respaldos, despliegues sin corte, modo entrenamiento, manuales cortos por rol.

## 7. Decisiones pendientes del documento (sección 20): usa estos valores por defecto y hazlos configurables

- Región del piloto: Zúrich, idioma por defecto de sede y cocina **DE**; interfaz de soporte en ES.
- Pagos: solo `cash` y `external-terminal` en el MVP; `online` queda como adaptador stub con interfaz definida.
- Umbrales por defecto por sede: descuento > 20 % o anulación de ítem ya enviado requieren PIN de gerente; mesa reservada se bloquea 15 min antes; no-show a los 20 min; alerta de demora en cocina a los 12 min.
- Hosting: no acoplar a ningún proveedor; todo corre con Docker Compose.
- Nombre del producto en la UI: "Sistema Reservas POS" (configurable por marca blanca después).

## 8. Forma de trabajar

- Antes de codificar cada fase, entra en modo plan, propón el diseño de esa fase (archivos, módulos, endpoints, tablas, tests) y espera mi OK.
- Commits pequeños y descriptivos por funcionalidad; nunca dejes `main` sin compilar.
- Cada RN y cada cálculo de dinero tienen test unitario **antes** de la pantalla. Cada RF "Debe" se marca en `docs/TRAZABILIDAD.md` con el commit que lo cumple.
- Si el documento y yo nos contradecimos, pregúntame una sola vez y sigue. Si algo no está en el documento, propón la opción más simple que respete los principios y márcala como "Podría".
- No agregues nada fuera del alcance del MVP (sección 5 del documento: ni inventario, ni fidelización, ni nómina, ni delivery, ni integración directa con terminales de pago).
- Responde en español; código, comentarios, nombres de tablas y de eventos en inglés.

Empieza ahora con la Fase 0: lee `docs/requerimientos.txt` completo, confirma en 10 líneas que entendiste el producto y los principios, y presenta el plan de la Fase 0.
