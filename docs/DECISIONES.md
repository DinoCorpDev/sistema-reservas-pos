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

## Decisiones abiertas (sección 20), por cerrar antes de la fase indicada

| Decisión                                               | Antes de | Quién decide |
| ------------------------------------------------------ | -------- | ------------ |
| Proveedor de hosting en Suiza                          | Fase 6   | Juan y socio |
| Proveedor de pago online (TWINT y tarjeta en QR/web)   | Fase 5   | Juan y socio |
| Precio por sede en CHF y qué incluye                   | Piloto   | Juan y socio |
| Hardware recomendado por sede y quién lo instala       | Fase 6   | Juan y socio |
| Modelo de soporte del piloto (horario, canal, persona) | Fase 6   | Juan y socio |
| Nombre comercial definitivo en Suiza                   | Piloto   | Juan y socio |
