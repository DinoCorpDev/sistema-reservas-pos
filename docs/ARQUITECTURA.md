# Arquitectura · Sistema Reservas POS

Este documento explica cómo está construido el sistema y cómo cumple los 12 principios de arquitectura (PA-01…PA-12) del [documento de requerimientos](requerimientos.txt). Las decisiones puntuales están en [DECISIONES.md](DECISIONES.md); el estado de cada requerimiento, en [TRAZABILIDAD.md](TRAZABILIDAD.md). Las reglas detalladas de sincronización están en [SYNC.md](SYNC.md).

## 1. Vista general

```
                       ┌──────────────────────── NUBE (región suiza) ─────────────────────────┐
  Zitas (otro repo) ──▶│  apps/web  (Next.js 15)                                               │
  Integradores      ──▶│    /api/v1/*   API REST pública (OpenAPI desde Zod)                   │
  Cliente (QR)      ──▶│    /qr/[code]  menú QR público                                        │
  Dueño / gerente   ──▶│    /backoffice                                                        │
                       │  MySQL 8 "pos_cloud"  ◀── fuente de verdad global                     │
                       └───────────────────────────────▲───────────────────────────────────────┘
                                                       │ cola de sincronización (outbox, idempotente)
                       ┌───────────────────────────────┴──── SEDE (LAN) ───────────────────────┐
                       │  apps/hub  (Node: Hono + ws)  en mini-PC o tablet                     │
                       │    WebSocket tiempo real · impresión ESC/POS (TCP 9100) · cola a nube │
                       │  MySQL 8 "pos_hub"  ◀── verdad de la sede                             │
                       │        ▲              ▲                ▲                              │
                       │   POS caja (PWA)   Handhelds (PWA)   KDS (PWA)                        │
                       │   IndexedDB/Dexie + outbox en cada terminal                           │
                       └───────────────────────────────────────────────────────────────────────┘
```

Las apps de la sede (`/pos`, `/kds`) son la misma app Next.js instalada como PWA. Funcionan contra el hub en la LAN y siguen sin él con su base local (IndexedDB).

## 2. Monorepo

| Paquete           | Qué es                                                                                                                                                                           | Puede depender de  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `packages/core`   | Dominio puro: entidades, reglas MWST, máquinas de estado, dinero, eventos, permisos. **Sin frameworks**: ESLint prohíbe importar Next, React, Drizzle, mysql2, Hono, Dexie o ws. | `zod`, `uuidv7`    |
| `packages/db`     | Esquema Drizzle (MySQL), migraciones versionadas en `packages/db/drizzle/`, cliente, seed y scripts `db:*`.                                                                      | `core`             |
| `packages/ui`     | Componentes táctiles (Tailwind v4 + shadcn/ui), objetivos ≥ 44 px.                                                                                                               | —                  |
| `packages/config` | `tsconfig` base (strict, `noUncheckedIndexedAccess`).                                                                                                                            | —                  |
| `apps/web`        | Next.js 15: POS, KDS, backoffice, QR y API `/api/v1`.                                                                                                                            | `core`, `db`, `ui` |
| `apps/hub`        | Nodo local de la sede; se empaqueta en un solo archivo (`tsup`).                                                                                                                 | `core`, `db`       |

Los paquetes internos se publican como TypeScript fuente (sin build propio): Next los transpila (`transpilePackages`) y el hub los empaqueta.

## 3. Módulos del dominio (PA-01)

Cada módulo vive en `packages/core/src/<módulo>` y expone sus casos de uso. Toda función existe primero como caso de uso del dominio y como endpoint de la API, y después como pantalla.

| Módulo         | Responsabilidad                                                                                                          | Requerimientos        | Fase |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------- | ---- |
| `organization` | Organización, sedes, áreas, terminales, estaciones, impresoras, usuarios, roles, permisos, PIN, settings por sede        | RF-A01…A12            | 1    |
| `catalog`      | Catálogo maestro, variantes, modificadores, alérgenos, origen, traducciones, disponibilidad, precios por canal, agotados | RF-B01…B18            | 1    |
| `tax`          | MWST con vigencia; tasa por categoría + canal + consumo; congelada en la línea                                           | RF-B12, B13, RN-01…07 | 1    |
| `tables`       | Mapa, estado derivado, unir/separar/mover                                                                                | RF-C01…C06            | 2    |
| `orders`       | Motor de órdenes offline, cursos, anulaciones, descuentos, dividir/transferir/unir, cierre automático                    | RF-C07…C19            | 2    |
| `kitchen`      | Tickets por estación, ruteo, tiempos, alertas, idioma de cocina, recall                                                  | RF-C20…C28            | 3    |
| `payments`     | Adaptadores de pago, mixtos, propinas, devoluciones                                                                      | RF-D01…D10            | 2    |
| `cash`         | Turnos, movimientos, arqueo, cierre Z, libro de caja, conciliación                                                       | RF-D11…D19            | 4    |
| `receipts`     | Recibo MWST congelado, copias, idioma                                                                                    | RF-D20…D25            | 2    |
| `customers`    | Cliente único, historial, consentimiento, anonimización                                                                  | RF-E14…E17            | 1, 5 |
| `reservations` | Reservas sobre mesas reales, check-in, visitas, no-show                                                                  | RF-E01…E05            | 5    |
| `reports`      | Ventas, MWST, cierres, propinas, exportaciones (alimentado por eventos)                                                  | RF-F01…F10            | 4    |
| `audit`        | Auditoría append-only y su consulta                                                                                      | RF-F11…F13            | 1    |
| `sync`         | Outbox del dispositivo, operaciones idempotentes, conflictos, numeración offline                                         | RNF-02…05, RN-16      | 2    |

## 4. Niveles de operación y sincronización (PA-03)

El sistema siempre opera en el nivel más alto disponible y baja de nivel solo, sin configuración manual.

| Nivel                 | Cuándo                      | Cómo opera                                                                                                                                                                                                                                                                   |
| --------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 · Terminal solo** | Sin hub y sin internet      | La terminal guarda todo en IndexedDB (Dexie) y encola cada cambio en su outbox. Numera órdenes con su prefijo (`terminals.order_number_prefix`, p. ej. `H1-0042`) para no chocar (RN-16). Sin hub no hay comandas impresas; el recibo se imprime con el navegador (DEC-031). |
| **2 · LAN con hub**   | Hay hub, haya o no internet | Las terminales hablan con el hub por WebSocket (`/ws`). El hub numera (`0042`), avisa a POS y KDS, imprime comandas, stornos, recibos y abre el cajón por ESC/POS, y acumula la cola hacia la nube. Meta: < 2 s en todas las pantallas (RNF-07).                             |
| **3 · Nube**          | Hay internet                | Fuente de verdad global: backoffice, API pública, menú QR, reportes. Los cambios del backoffice llegan a las terminales en < 1 min o al reconectar (RF-F23).                                                                                                                 |

**Cómo funciona** (el detalle completo está en [SYNC.md](SYNC.md)):

- **Registro de operaciones (DEC-021):** cada acción del POS es una operación inmutable con ID UUID v7 del dispositivo (también su clave de idempotencia), un reloj lógico híbrido y un payload congelado (precios, MWST, IDs nuevos). El estado de las órdenes es el plegado determinista de sus operaciones en orden `(hlc, id)`, con el mismo reductor de `@pos/core` en la terminal, el hub y la nube.
- **Dónde vive cada cosa:**
  - **Terminal:** Dexie guarda las operaciones y la configuración, y la terminal pliega todo en memoria.
  - **Hub:** guarda y reenvía las operaciones, sin proyección. Para imprimir pliega bajo demanda el grupo de la orden y deriva trabajos idempotentes de las operaciones (`print_jobs`, DEC-031).
  - **KDS:** es otra app cliente como el POS (`/kds`, DEC-030): pliega las operaciones de la sede y escribe las de cocina (`kitchen.*`, DEC-029). Su tablero sale de `stationBoard()` en `@pos/core`.
  - **Nube:** guarda el registro en `sync_operations` (con `seq` por sede como cursor), repliega el grupo de órdenes afectado y escribe la proyección (`orders`, `order_items`, `payments`…), la auditoría y el outbox en la misma transacción.
- **Conflictos por regla (RNF-04):** los pagos nunca se pierden, el último cambio por campo gana, y lo que rompe una regla se aplica igual y queda como conflicto para el gerente (página "Konflikte" del backoffice).
- **Relevo del hub (RNF-05):** cada terminal prueba los hubs de la sede en orden, luego la nube; sin ninguno opera en nivel 1. Toda operación se guarda en cada dispositivo hasta que la nube la confirma, así que si el hub muere nada se pierde.

## 5. Convenciones de datos

| Tema                         | Regla                                                                                                                                                                                                                                             | Vigilado por                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-tenant (PA-09, RNF-12) | Toda tabla lleva `organization_id` NOT NULL (salvo `organizations`). Configuración y operación llevan además `location_id` NOT NULL. Los datos maestros de la organización (catálogo, usuarios, clientes) llevan `location_id` solo donde aplica. | `packages/db/src/schema.test.ts`. En la Fase 1, un helper de repositorio que exige el filtro y un test que intenta cruzar organizaciones y debe fallar. |
| IDs (PA-10)                  | UUID v7 del dispositivo en `BINARY(16)` (DEC-005).                                                                                                                                                                                                | Test de invariantes                                                                                                                                     |
| Dinero (PA-08)               | Enteros en rappen, columnas `*_rappen` (`int`). Nunca `decimal` ni `float`. Tipo `Rappen` en el dominio.                                                                                                                                          | Test de invariantes, tests de `money.ts`                                                                                                                |
| MWST                         | Tasas en puntos básicos (`rate_bp`: 8,1 % = 810) con vigencia `valid_from`/`valid_to`. Precio, tasa e impuesto se congelan en `order_items` (RN-04).                                                                                              | Test de invariantes; cálculo y tests en la Fase 1                                                                                                       |
| Tiempo                       | `DATETIME(3)` en UTC (pool con `timezone: 'Z'` y sesión `+00:00`). Las fechas de negocio (`business_date`) son `DATE` en la zona de la sede. Los eventos llevan hora del dispositivo y del servidor.                                              | —                                                                                                                                                       |
| Nada se borra (PA-06)        | Soft delete (`deleted_at`) en toda tabla que no es append-only. Anulaciones y correcciones son registros nuevos.                                                                                                                                  | Test de invariantes                                                                                                                                     |
| Append-only (RN-10)          | `audit_events`, `receipts` y `daily_closings`: sin `updated_at` ni `deleted_at`, y triggers MySQL que rechazan `UPDATE` y `DELETE`. Recibos y cierres guardan `content_hash` (SHA-256).                                                           | Test de invariantes y test de integración                                                                                                               |
| Estados                      | `varchar` validado en el dominio, no `ENUM` (DEC-006).                                                                                                                                                                                            | —                                                                                                                                                       |
| Claves foráneas              | En configuración y maestros; no en las tablas operativas que se sincronizan (DEC-007).                                                                                                                                                            | Test de invariantes                                                                                                                                     |
| Nombres                      | Tablas y columnas en inglés `snake_case`; código en `camelCase`; eventos `modulo.hecho` (sección 16).                                                                                                                                             | Test del catálogo de eventos                                                                                                                            |

Las tablas están clasificadas en `packages/db/src/table-groups.ts`: `root`, `config`, `master`, `operational`, `appendOnly` e `infrastructure`. Una tabla nueva sin clasificar hace fallar los tests.

## 6. Eventos y outbox (PA-10)

Cada cambio importante escribe una fila en `outbox_events` **dentro de la misma transacción** que el cambio: tipo (`order.created`…), versión de esquema, agregado, payload, organización y sede, usuario, terminal, hora del dispositivo y del servidor. Un publicador la entrega después a reportes, CRM, webhooks (RF-F15) e IA sin que esos consumidores toquen las tablas de operación. Un evento nunca se edita; si fue un error, se publica otro que lo corrige. El catálogo cerrado de eventos está en `packages/core/src/shared/events.ts`.

## 7. Seguridad

- **Backoffice:** Auth.js v5 (correo + contraseña; 2FA para administradores, RF-A07) en la Fase 1.
- **POS:** PIN de 4-6 dígitos hasheado con argon2id. El dispositivo emparejado recibe los hashes y un bucket de 4 bits del lookup (nunca el lookup completo) y verifica el PIN y las aprobaciones de gerente en un Web Worker, con o sin conexión; el bloqueo por intentos se cuenta en la terminal y queda en la auditoría (RF-A06, RNF-10, DEC-023). La nube vuelve a validar los permisos al plegar.
- **Permisos:** claves fijas en `@pos/core` (`PERMISSIONS`), asignadas por rol en `role_permissions`. Se verifican en el servidor y en el dominio, nunca solo en pantalla (RNF-10). Lo que el rol no permite pide PIN de gerente en el mismo dispositivo (RF-A05, RN-15).
- **Tarjetas:** el sistema nunca guarda ni ve números de tarjeta (RNF-11); el terminal o el proveedor los manejan.
- **IA:** interpreta y sugiere; nunca crea, modifica ni anula órdenes, pagos, precios ni impuestos (PA-07, RF-F20). Solo tendrá acceso de lectura a la API.

## 8. Stack

| Capa          | Elección                                                                                           | Versión fijada                    |
| ------------- | -------------------------------------------------------------------------------------------------- | --------------------------------- |
| Monorepo      | pnpm workspaces + Turborepo; versiones centralizadas con `catalog:` en `pnpm-workspace.yaml`       | pnpm 10.34, turbo 2.11            |
| Lenguaje      | TypeScript strict                                                                                  | 5.9 (DEC-010)                     |
| Web           | Next.js App Router + React                                                                         | 15.5 / 19.2                       |
| UI            | Tailwind CSS v4 + shadcn/ui                                                                        | 4.3                               |
| Base de datos | MySQL 8 + Drizzle ORM + mysql2                                                                     | Drizzle 0.45, drizzle-kit 0.31    |
| Hub           | Node.js + Hono + ws                                                                                | Hono 4.13, ws 8.22                |
| Offline       | PWA con Serwist (service worker), Dexie (IndexedDB), Zustand; argon2 en el navegador con hash-wasm | Serwist 9.5, Dexie 4.4, Zustand 5 |
| Validación    | Zod en toda frontera; OpenAPI desde Zod (Fase 1)                                                   | Zod 4.6                           |
| i18n (Fase 1) | next-intl: DE, FR, IT, EN y ES (soporte); formato suizo `CHF 1'234.50`                             | —                                 |
| Tests         | Vitest (unitarias e integración), Playwright (E2E, incluidos escenarios sin red)                   | Vitest 5, Playwright 1.63         |

## 9. Entornos

| Entorno                    | Base de datos                                                                                                 | Cómo se levanta                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Desarrollo local (Windows) | MySQL 8 con binarios de Laragon y datos en `.data/mysql` (D:), puerto 3310: `pos_cloud` y `pos_hub` (DEC-013) | `pnpm mysql:start`, `pnpm db:setup`, `pnpm dev` |
| Desarrollo con Docker      | `docker compose up -d`: `mysql-cloud` (3306) y `mysql-hub` (3307)                                             | Igual, ajustando `.env`                         |
| CI (GitHub Actions)        | Servicio MySQL 8                                                                                              | `.github/workflows/ci.yml`                      |
| Piloto                     | Docker Compose en un proveedor con región suiza (decisión abierta) y un hub por sede                          | Fase 6                                          |

## 10. Cómo se cumple cada principio

| PA                                 | Cómo se cumple hoy                                                                                                                                           | Qué falta                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| PA-01 Monolito modular + API-first | Módulos en `@pos/core`; casos de uso en `packages/api`, usados igual por la API REST v1 y el backoffice; ESLint impide que el dominio dependa de frameworks. | Módulos de caja, reservas y reportes (Fases 4-5).                        |
| PA-02 Una sola fuente de verdad    | Un único esquema y un único reductor de órdenes, compartidos por la nube, el hub y las terminales; Zitas solo por API (DEC-001).                             | —                                                                        |
| PA-03 Offline-first                | PWA con service worker, Dexie y registro de operaciones; hub en la LAN; E2E con la red cortada (DEC-021, SYNC.md).                                           | Turnos sin conexión (Fase 4); HTTPS hacia el hub en producción (Fase 6). |
| PA-04 Pagos desacoplados           | Interfaz `PaymentAdapter` con `cash`, `external-terminal` y `online` (stub); el motor de órdenes solo recibe pagos resueltos.                                | Proveedor online (Fase 5, DEC-003).                                      |
| PA-05 Cocina ≠ pago                | Estado por ítem (y por estación en cocina, DEC-029) y por orden independientes; cierre automático (RN-12) en el reductor; KDS por estación.                  | —                                                                        |
| PA-06 Nada se borra                | Soft delete obligatorio; triggers append-only; anulaciones y devoluciones son operaciones nuevas.                                                            | —                                                                        |
| PA-07 La IA interpreta             | Sin acceso de escritura previsto.                                                                                                                            | Credenciales de solo lectura cuando exista IA.                           |
| PA-08 Dinero en enteros            | Tipo `Rappen`, columnas `int`; MWST, descuentos, divisiones y redondeo con tests exhaustivos.                                                                | Validación de la fiduciaria (DEC-016, DEC-024).                          |
| PA-09 Multi-tenant                 | `organization_id` en toda tabla; `inOrg`/`inLocation` en toda consulta; tests de cruce entre organizaciones.                                                 | —                                                                        |
| PA-10 Eventos e idempotencia       | Outbox en la misma transacción; operaciones idempotentes por ID; propiedad: cualquier orden de llegada da el mismo estado.                                   | Consumidores (webhooks, Fase 5).                                         |
| PA-11 Configurable sin código      | Montaje completo desde el backoffice con lista de verificación (puerta de la Fase 1).                                                                        | —                                                                        |
| PA-12 Datos en Suiza               | Nada acoplado a un proveedor; todo corre con Docker Compose.                                                                                                 | Elegir hosting con región suiza (Fase 6).                                |
