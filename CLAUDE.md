# CLAUDE.md · Zitas POS (DINOLABS)

POS para restaurantes en Suiza. El restaurante opera **mesa → pedido → cocina → pago → cierre**, 24/7 y **sin internet**. El Core POS es la única fuente de verdad y todo se expone por API. Zitas (otro repositorio) es solo una capa digital que lee y escribe en el Core por API: **no se reimplementa aquí**.

- **Alcance:** `docs/requerimientos.txt` manda (126 RF, 23 RNF, 24 RN, 12 PA). El MVP es todo lo "Debe" de las secciones 7 a 14. Si algo no está en el documento, se propone la opción más simple que respete los principios y se marca como _Podría_.
- **Fuera del MVP:** inventario, fidelización, nómina, delivery e integración directa con terminales de pago.
- **Documentos:** `docs/ARQUITECTURA.md` (cómo está hecho), `docs/DECISIONES.md` (decisiones DEC-xxx), `docs/TRAZABILIDAD.md` (estado de cada requerimiento), `docs/PROMPT_MAESTRO_POS.md` (encargo original y plan por fases).

## Forma de trabajar

- Responder **en español**. El código, los comentarios, los nombres de tablas y columnas y los nombres de eventos van **en inglés**. Los textos de la interfaz salen de i18n (DE por defecto; FR, IT, EN; ES para soporte).
- Antes de codificar cada fase: modo plan con el diseño (archivos, módulos, endpoints, tablas, tests) y esperar el OK de Juan. No pasar de fase sin cumplir su puerta.
- Si el documento y Juan se contradicen, preguntar una sola vez, registrar la decisión en `docs/DECISIONES.md` y seguir.
- Commits pequeños por funcionalidad; nunca dejar `main` sin compilar. Cada RF "Debe" cumplido se marca en `docs/TRAZABILIDAD.md` con su commit.
- **Toda RN y todo cálculo de dinero o MWST tiene test unitario antes de tener pantalla.**

## Principios no negociables (PA-01…PA-12)

1. **Monolito modular + API-first.** Módulos en `packages/core`: `organization`, `catalog`, `tax`, `tables`, `orders`, `kitchen`, `payments`, `cash`, `receipts`, `customers`, `reservations`, `reports`, `audit`, `sync`. Cada función existe primero como caso de uso del dominio y como endpoint de la API, y después como pantalla. `packages/core` es puro: sin Next, React, Drizzle, mysql2, Hono, Dexie ni ws (lo vigila ESLint).
2. **Una sola fuente de verdad.** Productos, clientes, órdenes y pagos viven una vez, en el Core.
3. **Offline-first en la sede.** Cada terminal guarda localmente (IndexedDB/Dexie) y sincroniza por cola. KDS e impresoras funcionan en la LAN sin nube. Tomar pedidos, enviar a cocina, cobrar en efectivo o con terminal independiente, imprimir y abrir/cerrar turno funcionan al menos 24 h sin conexión (RNF-02).
4. **Pagos desacoplados.** El motor de órdenes no conoce al proveedor. Interfaz `PaymentAdapter` con `cash`, `external-terminal` y `online` (stub, DEC-003). Agregar un proveedor no toca órdenes ni caja.
5. **Estado de cocina ≠ estado de pago.** Ítem: `pending → sent → preparing → ready → served`, y `voided` desde cualquier estado con motivo. Orden: `unpaid → partial → paid → refunded`. La orden se cierra sola cuando todo está servido o anulado y el pago está completo (RN-12).
6. **Nada se borra.** Anulaciones, devoluciones y correcciones son registros nuevos con usuario, motivo y hora. Soft delete en todo. `audit_events`, `receipts` y `daily_closings` son append-only (con triggers en MySQL).
7. **La IA interpreta, el Core decide.** La IA nunca crea, modifica ni anula órdenes, pagos, precios ni impuestos.
8. **Dinero en enteros (rappen).** Nunca `float` ni `decimal`. Tipo `Rappen` de `@pos/core`. El redondeo a 0,05 CHF se aplica **solo** al total pagado en efectivo y se registra como `rounding`, no como descuento (RN-06).
9. **Multi-tenant desde el día uno.** Toda entidad lleva `organization_id` (y `location_id` si es de la sede). Ninguna consulta corre sin ese filtro: se usa el helper de repositorio con tenant (Fase 1) y hay un test que intenta cruzar organizaciones y debe fallar (RNF-12).
10. **Eventos confiables e idempotencia.** Cada cambio importante escribe su evento (`order.created`, `payment.completed`, `day.closed`… catálogo cerrado en `packages/core/src/shared/events.ts`) en `outbox_events` **en la misma transacción**. IDs UUID v7 generados en el dispositivo. Toda operación de sincronización lleva `idempotencyKey`.
11. **Configurable sin código.** Un restaurante se monta completo desde el backoffice, con una lista de verificación de lo que falta (RF-A11).
12. **Datos en Suiza.** Nada acoplado a un proveedor de nube; todo corre con Docker Compose.

### MWST (`packages/core/src/tax`, tests exhaustivos)

- Precios con MWST **incluida**: el impuesto se **extrae**, nunca se suma (RN-01).
- Las tasas son **datos con vigencia** en la base (`tax_rates.rate_bp`: 8,1 % = 810, 2,6 % = 260, 3,8 % = 380). **Nunca** van como constantes en el código (RN-02).
- La tasa de cada línea sale de categoría fiscal + canal + tipo de consumo: en el local, normal; comida y bebida sin alcohol para llevar o a domicilio, reducida; alcohol, siempre normal (RN-03).
- Tasa y monto de impuesto se **congelan en `order_items`** (RN-04). Un cambio de canal antes de pagar recalcula y se audita; después de pagar, no (RN-05).
- La propina va fuera de la venta y sin MWST (RN-07).

## Convenciones del repo

- **Estructura:** `apps/web` (Next.js 15: `/pos`, `/kds`, `/backoffice`, `/support`, `/qr/[tableCode]`, `/api/v1/*`), `apps/hub` (Hono + ws), `packages/core` (dominio puro), `packages/db` (esquema, tenancy, unidad de trabajo, outbox), `packages/api` (casos de uso + API REST v1), `packages/ui`, `packages/config`.
- **Casos de uso (DEC-014):** toda lógica de aplicación vive en `packages/api/src/services/*`, recibe `(deps, actor, input)` y la usan igual la API REST (`http/routes/*`) y las Server Actions del backoffice (`currentActor()` + `runAction()`). Nunca hay acceso directo a la base desde `apps/web`. Consultas siempre con `inOrg`/`inLocation` + `notDeleted`; los cambios sensibles van dentro de `runCommand` con `recorder.audit`/`recorder.event`. Un recurso de otra organización responde 404.
- **Zod 4:** los esquemas de entrada viven en `@pos/core/*/commands.ts`. Para un PATCH se usa `patchOf()` (sin `.default()`), nunca `.partial()` de un esquema con valores por defecto. Nunca se llama `.openapi()` sobre esquemas de `@pos/core`.
- **Órdenes (DEC-021, `docs/SYNC.md`):**
  - Una orden solo se escribe con operaciones (`@pos/core/orders/operations.ts`). Las operaciones las pliega `foldOperations()`, y la proyección la escribe `POST /api/v1/sync/push`.
  - Nunca se hace un `UPDATE` directo de `orders`, `payments` ni `receipts`.
  - El reductor no lee la hora ni crea IDs (lo vigila ESLint): todo va congelado en el payload.
  - Una regla rota no rechaza la operación: se aplica y queda como conflicto.
- **POS y KDS (`apps/web/src/pos`, `apps/web/src/kds`, DEC-030):**
  - Son apps cliente sin navegación de Next sobre el runtime compartido `apps/web/src/device`: base local por app (`sistema-reservas-pos` / `-kds`), motor (`engine.ts`), `sync.ts`, PIN y pantallas de vinculación.
  - Las pantallas llaman solo a su `actions.ts`, que despacha operaciones al motor local.
  - Los textos van en `messages/<idioma>/pos*.json` y `kds.json`.
  - `/pos` y `/kds` no pueden redirigir ni leer datos del servidor (los precachea el service worker).
- **Cocina e impresión (DEC-029, DEC-031):**
  - El estado de cocina es por ítem y por estación, con operaciones `kitchen.*`.
  - El ticket (envío, estación) no guarda estado: se deriva con `ticketProgress()` y `stationBoard()` de `@pos/core`.
  - Solo el hub imprime: los trabajos se derivan de las operaciones con clave idempotente (`apps/hub/src/printing`).
- **Textos de la interfaz:** `apps/web/messages/<idioma>/<módulo>.json`. El alemán es la referencia; si falta una clave en otro idioma, se muestra en alemán.
- **Esquema:** una tabla nueva se clasifica en `packages/db/src/table-groups.ts` y debe pasar `schema.test.ts`. Migraciones solo con `pnpm db:generate` (nunca editar una migración ya aplicada). El SQL a mano va en una migración `--custom`.
- **Columnas:** `id`/FKs como `uuid()` (`BINARY(16)`), dinero como `rappen('x_rappen')`, tiempos con `utcDatetime()`, y `...timestamps()` y `...syncColumns()` de `packages/db/src/columns.ts`. Estados como `varchar` validados en el dominio (DEC-006). Sin FK en tablas operativas (DEC-007).
- **Validación:** Zod en toda frontera (API, formularios, mensajes de sync).
- **UI:** componentes de `@pos/ui`; objetivos táctiles ≥ 44 px; máximo 3 toques para agregar un ítem simple (RNF-22).
- **Versiones:** se fijan en `catalog:` de `pnpm-workspace.yaml`. Next 15.5, TypeScript 5.9 y ESLint 9 están fijados a propósito (DEC-010).

## Comandos

```bash
pnpm install
pnpm mysql:start         # Windows: MySQL 8 local en 127.0.0.1:3310 con datos en .data/mysql (también mysql:stop / mysql:status)
pnpm db:setup            # crea pos_cloud y pos_hub, migra y siembra "Restaurant Demo Zürich" (--reset para empezar de cero)
pnpm dev                 # web en :3000 y hub en :4100
pnpm lint                # ESLint (raíz)
pnpm typecheck
pnpm test                # unitarias (Vitest) + verificación de trazabilidad
pnpm test:integration    # contra MySQL real, en bases propias que se recrean (`<db>_test`; TEST_DATABASE_URL para aislar)
pnpm build
pnpm e2e:install         # una vez: Chromium de Playwright en .cache/ms-playwright (PLAYWRIGHT_BROWSERS_PATH del .env)
pnpm e2e                 # Playwright en :3100 contra su propia base `<db>_e2e` (requiere build y MySQL arriba)
pnpm --filter @pos/db outbox:work   # publicador del outbox (sin consumidores externos hasta la Fase 5)
pnpm --filter @pos/hub dev          # hub de la LAN en :4100 (HUB_PAIRING_CODE la primera vez; ver docs/SYNC.md §11.2)
pnpm --filter @pos/hub fake-printer # impresora ESC/POS simulada en :9100 que muestra las comandas en la consola
pnpm --filter @pos/api menu:import ../../scripts/menus/lalin-tapas.json --replace  # carga una carta (por SKU, repetible) con los casos de uso del backoffice
pnpm check:trace         # TRAZABILIDAD.md cubre todos los IDs del documento con su prioridad
```

## Entorno local (Windows)

- **Todo vive en D:** (DEC-013). C: está casi lleno: nada de datos, cachés ni descargas en C:. MySQL usa los binarios de Laragon pero guarda sus datos en `.data/mysql` (`pnpm mysql:start`); los navegadores de Playwright van a `.cache/ms-playwright`; el store de pnpm es `D:\.pnpm-store`. `.env` se copia de `.env.example`.
- Con Docker (otro equipo o CI): `docker compose up -d` y puertos 3306/3307 en `.env`.
- La terminal Bash de este equipo no trae coreutils (`cat`, `mkdir`): usar PowerShell o las herramientas de archivos.
- Los datos de prueba (usuarios, PIN, contraseña) están en `packages/db/src/seed/data/restaurant.ts`. Son solo para desarrollo.
