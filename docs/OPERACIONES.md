# OPERACIONES · Sistema Reservas POS

Runbook para soporte y operación de DINOLABS: cómo se instala, se actualiza, se vigila y se respalda la nube, y cómo se da de alta un restaurante.

Para cada tarea se indica qué hacer, con qué comando y cómo verificar que salió bien.

> **Estado:** este equipo de desarrollo no tiene Docker (DEC-002). El compose de producción, `deploy.sh` y los respaldos se verifican en el primer servidor (§10). Hasta entonces, todo lo que dependa de Docker está **pendiente de verificar**.

---

## 1. Qué corre en producción

| Pieza            | Dónde                 | Qué hace                                                                                   |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `caddy`          | nube                  | HTTPS automático (Let's Encrypt) para `DOMAIN`; reparte el tráfico entre `web-1` y `web-2` |
| `web-1`, `web-2` | nube                  | Next.js: backoffice, `/pos`, `/kds`, `/support`, `/help` y la API `/api/v1`                |
| `worker`         | nube                  | outbox, monitor (alertas por correo), archivo legal mensual y certificados de los hubs     |
| `mysql`          | nube                  | MySQL 8.4 con binlog; base `pos_cloud`                                                     |
| `backup`         | nube                  | restic cada hora hacia S3 en Suiza; test de restauración mensual                           |
| hub              | local del restaurante | sincroniza la sede en la LAN, imprime y sigue sin internet (`apps/hub`)                    |

- Todo está en `deploy/`: `docker-compose.prod.yml`, `Dockerfile`, `Caddyfile`, `deploy.sh`, `backup/` y `.env.example`.
- Los secretos van en `deploy/.env`, que nunca se sube al repositorio.

---

## 2. Primer servidor

**Requisitos:**

- Linux con Docker Engine y el plugin `docker compose`, con 2 vCPU y 4 GB de RAM como mínimo.
- Puertos 80 y 443 abiertos.
- Un registro DNS `A` de `DOMAIN` que apunte al servidor.
- Un bucket S3 en una región suiza para los respaldos.
- Una cuenta SMTP para las alertas.

**Pasos:**

```bash
git clone git@github.com:ingJuanMolano/sistema-reservas-pos.git
cd sistema-reservas-pos
cp deploy/.env.example deploy/.env      # completar TODO: dominio, contraseñas, SMTP, restic
deploy/deploy.sh
```

1. `deploy.sh` compila las imágenes, migra la base y levanta los contenedores (§3).
2. Se crea la primera cuenta de soporte. La contraseña se muestra **una sola vez**; si se pierde, el mismo comando da una nueva:

   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env run --rm --no-deps worker pnpm --filter @pos/db staff:add ana@dinolabs.dev "Ana Muster"
   ```

3. **Se verifica:**
   - `https://DOMAIN/api/v1/health` responde `200` con la versión;
   - se puede entrar a `https://DOMAIN/support` con la cuenta de soporte;
   - en `/support/status` no hay problemas abiertos, salvo el de respaldos durante la primera hora (todavía no corrió ninguno).

---

## 3. Desplegar una versión nueva (sin corte)

```bash
cd sistema-reservas-pos
git pull
deploy/deploy.sh
```

**Qué hace `deploy.sh`:**

1. Compila las imágenes con la versión `AAAA.MM.DD+commit`.
2. Aplica las migraciones.
3. Reinicia `web-1`, espera a que esté sano y luego reinicia `web-2`. Mientras uno se reinicia, Caddy atiende con el otro.
4. Reinicia `worker`, `backup` y `caddy`.

Si un contenedor no queda sano, el despliegue se detiene y el otro sigue atendiendo.

**Reglas que mantienen el despliegue sin corte:**

- **Las migraciones solo agregan** (tablas, columnas con valor por defecto, índices). Nunca se borra ni se renombra una columna en uso en el mismo despliegue: primero se deja de usar y se quita en una versión posterior. Nunca se edita una migración ya aplicada.
- **La API solo agrega** campos y rutas. Las terminales con una versión anterior siguen funcionando: sus operaciones van versionadas.
- **Las tablets no se actualizan solas.** Muestran «Jetzt aktualisieren» y el personal actualiza cuando nadie está cobrando. En `/support/status` se ve la versión de cada aparato.

**Verificar que no hubo corte:** durante el despliegue, en otra terminal:

```bash
while true; do curl -s -o /dev/null -w '%{http_code}\n' https://DOMAIN/api/v1/health; sleep 0.5; done
```

No debe aparecer ningún código distinto de `200`.

**Volver atrás:** `git checkout <commit-anterior> && deploy/deploy.sh`. Como las migraciones solo agregan, la versión anterior funciona con la base nueva.

---

## 4. Respaldos y restauración (RNF-13, RNF-14, RNF-15)

| Qué                                                                           | Cuándo                                  | Retención                             |
| ----------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------- |
| `mysqldump` de `pos_cloud` (restic, cifrado)                                  | cada hora, en el minuto `BACKUP_MINUTE` | 48 horarios, 30 diarios, 12 mensuales |
| Archivo legal por sede (recibos, cierres Z, libro de caja, auditoría en JSON) | mensual                                 | **10 años**, etiqueta `legal`         |
| Test de restauración                                                          | día `RESTORE_TEST_DAY` de cada mes      | resultado en `platform_job_runs`      |

- **RPO 1 h:** se pierde como máximo la última hora de la nube. Los datos del día también están en el hub y en las tablets, que los vuelven a enviar.
- **RTO 4 h.**

**Ver los respaldos:**

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env run --rm backup restic snapshots
```

**Restaurar para revisar**, sin tocar producción (por defecto en la base `pos_restore`):

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env run --rm backup restore.sh latest
```

**Restaurar producción** (solo ante una pérdida real de datos):

1. Avisar a los restaurantes. Las tablets siguen trabajando sin conexión y guardan todo.
2. Detener la aplicación:
   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env stop web-1 web-2 worker
   ```
3. Restaurar sobre `pos_cloud`. Con `restic snapshots` se elige otro respaldo que no sea `latest`:
   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env run --rm backup restore.sh latest pos_cloud
   ```
4. Levantar todo con `deploy/deploy.sh`. Las tablets y los hubs reenvían lo que la nube no tiene (son idempotentes).
5. Revisar `/support/status` y la página de conflictos de cada organización afectada.

**Test mensual:** restaura el último respaldo en `pos_restore_check` y compara los recibos y los cierres Z (ids y hash) con producción. Si falla, el monitor envía un correo («restore test failed»).

---

## 5. Monitoreo y alertas (RNF-16, RNF-01)

El `monitor` (dentro de `worker`) revisa cada 60 s. Cuando un problema dura más que su umbral, envía **un** correo a `SUPPORT_ALERT_EMAIL`, y otro cuando se resuelve.

| Problema                                  | Umbral                                   |
| ----------------------------------------- | ---------------------------------------- |
| Hub de una sede sin señal                 | 5 min                                    |
| Impresora con error                       | según su último informe                  |
| Conflictos de sincronización sin resolver | al aparecer                              |
| Outbox atrasado                           | evento más viejo > 5 min                 |
| Último respaldo                           | > 2 h (si `MONITOR_EXPECT_BACKUPS=true`) |
| Test de restauración                      | falló, o tiene más de 35 días            |

- Las organizaciones de práctica nunca alertan.
- Las tablets apagadas de noche tampoco; solo el hub, que debe estar siempre encendido.
- **`/support/status`** muestra en vivo los problemas abiertos de todas las organizaciones y, por organización: la última señal del hub, los aparatos con su versión, las impresoras, los conflictos y el outbox.

**Cuando cae el servidor completo**, el monitor no puede avisar. Por eso hay que configurar un **chequeo externo**:

- Usar un servicio gratuito de uptime (UptimeRobot, Better Stack o similar).
- Hacer un `GET https://DOMAIN/api/v1/health` cada minuto y avisar por correo a soporte si falla dos veces seguidas.
- Ese servicio mide también la disponibilidad. La meta es 99,9 %, unos 43 minutos de caída al mes como máximo (RNF-01).

**Probar una alerta** en el servidor nuevo: detener el hub de prueba más de 5 minutos. Debe llegar un correo y la alerta debe verse en `/support/status`; al volver el hub llega el correo de resuelto.

---

## 6. Logs (RNF-18)

- **Formato:** cada servicio escribe una línea JSON por evento con estos campos: `time`, `level`, `service`, `msg`, `requestId`, `organizationId`, `locationId`, `terminalId`, `userId`, `route`, `status` y `durationMs`.
- **Sin secretos:** nunca se registran PIN, contraseñas, tokens ni secretos. El logger los reemplaza (está cubierto por tests).
- **Dónde quedan:**
  - en la salida estándar: `docker compose -f deploy/docker-compose.prod.yml logs -f web-1`;
  - en archivos diarios en el volumen `logs`: `/logs/<servicio>-AAAA-MM-DD.jsonl` (`web`, `worker`, `monitor`), que se borran a los 90 días.

**Consultas con `jq`** (en el servidor):

```bash
# Atajo: el archivo de hoy de un servicio
logs() { docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec -T worker cat "/logs/$1-$(date -u +%F).jsonl"; }

# Errores de hoy
logs web | jq -c 'select(.level == "error")'

# Todo lo de una organización
logs web | jq -c 'select(.organizationId == "<uuid>")'

# Una petición completa a partir del id que vio el usuario (cabecera x-request-id)
logs web | jq -c 'select(.requestId == "<id>")'

# Peticiones lentas (> 1 s)
logs web | jq -c 'select(.durationMs > 1000) | {time, route, status, durationMs}'

# Respuestas 5xx por ruta
logs web | jq -r 'select(.status >= 500) | .route' | sort | uniq -c | sort -rn
```

---

## 7. Alta de un restaurante

1. **`/support` → «Nuevo restaurante».** Se completan:
   - el tipo de negocio (**Café** o **Restaurante**);
   - la organización y la primera sede;
   - el dueño, con su correo.

   Según el tipo, el asistente deja:
   - **Café:** plan Café, venta en mostrador (no exige plano de mesas) y un rol «Team» que vende y cobra sin reportes, sin cierre Z ni autorizaciones.
   - **Restaurante:** plan Restaurante y servicio a la mesa.

2. **Contraseña temporal del dueño.** Se muestra una vez y se entrega por un canal seguro (en persona o por teléfono). Al primer ingreso el dueño la cambia.
3. **Plan y add-ons.** En la lista de `/support`, el ícono de tarjeta abre el plan, los add-ons y el estado de pago. El cobro es manual: se marca `past_due` si no paga y `suspended` si hay que frenar el crecimiento. Vender, cobrar y cerrar el Z nunca se bloquean.
4. **Configuración.** El dueño (o soporte, con su acceso) completa la lista de verificación del «Resumen» del backoffice: sede y UID, carta, MWST, mesas, personal con PIN, aparatos y estaciones. La carta se puede cargar en lote con `pnpm --filter @pos/api menu:import <archivo.json>`.
5. **Práctica antes de abrir.**
   - En «Mi plan» → «Modo práctica» (o con el ícono del birrete en `/support`) se crea una copia del restaurante con los mismos PIN.
   - El personal practica en aparatos vinculados a esa copia, que muestran la franja naranja «Übungsmodus», y sus recibos dicen «ÜBUNG — KEIN GÜLTIGER BELEG».
   - Para empezar de nuevo, se copia otra vez.
6. **Manuales.** `https://DOMAIN/help/de` (alemán) y `/help/es` (español), uno por rol. Se abren desde el botón «?» de la caja y la cocina, y desde «Hilfe» en el backoffice. Se pueden imprimir.

---

## 8. Instalación en el local

- **Red:**
  - wifi propia para los aparatos del POS, separada de la de clientes;
  - impresoras y hub con IP fija (reserva DHCP).
- **Tablets y teléfonos:**
  - abrir `https://DOMAIN/pos` (o `/kds` para la cocina);
  - vincular con el código de «Dispositivos y estaciones» (válido 15 min);
  - instalar con «Agregar a pantalla de inicio»: la app queda como «Kasse» o «Küche», con su propio ícono.
  - **Nunca** borrar los datos del navegador de una tablet: ahí se guarda lo pendiente de enviar.
- **Impresoras:** térmicas ESC/POS por red (TCP 9100). Se dan de alta en «Dispositivos y estaciones» con su IP y se prueban con «Testdruck».
- **Hub:** un mini PC Linux (Debian o Ubuntu) siempre encendido en la LAN, con Docker y su plugin `compose`.
  1. En el backoffice, en «Dispositivos y estaciones», crear un aparato de tipo «Hub» y generar su código de vinculación (válido 15 min).
  2. En el mini PC:
     ```bash
     git clone https://github.com/ingJuanMolano/sistema-reservas-pos.git
     cd sistema-reservas-pos
     sudo deploy/hub/install-hub.sh
     ```
     El script pide la URL de la nube y el código, genera `deploy/hub/.env` con contraseñas al azar, compila y levanta el hub con su MySQL, espera a que quede vinculado y borra el código del archivo.
  3. Dar al mini PC una IP fija en el router. Docker lo vuelve a levantar solo después de un corte de luz.
  4. **Actualizar:** `git pull && sudo deploy/hub/install-hub.sh`.
  5. **Reinstalar o cambiar de equipo:** desvincular el hub en el backoffice, generar un código nuevo, borrar `deploy/hub/.env` y correr el script otra vez.
  - Mientras no haya hub, las tablets sincronizan directo con la nube. Para imprimir y para trabajar sin internet hace falta el hub.
- **HTTPS del hub (DEC-028):** la caja vive en HTTPS y el navegador no deja llamar por HTTP a la LAN, así que cada hub recibe un nombre y un certificado.
  - **Una vez, en la nube** (`deploy/.env`):
    - `HUB_DNS_ZONE`: una zona solo para los hubs, por ejemplo `hub.pos.example.ch`, administrada en Cloudflare (gratis). Si el dominio está en otro proveedor, se delega ese subdominio a Cloudflare con registros `NS`.
    - `CLOUDFLARE_ZONE_ID` y `CLOUDFLARE_API_TOKEN`: un token con permiso «DNS edit» solo sobre esa zona.
    - `ACME_DIRECTORY=staging` para la primera prueba (certificados no confiables, sin límites estrictos); luego `production`.
  - **Qué pasa solo:**
    1. el hub informa su IP de la LAN y un CSR (su clave privada nunca sale del equipo);
    2. el worker publica `h-<id>.<zona>` → IP de la LAN, obtiene el certificado de Let's Encrypt (DNS-01) y lo renueva 30 días antes de vencer;
    3. el hub sirve HTTPS en el puerto 4443;
    4. la sede recibe `https://h-<id>.<zona>:4443` como primer hub en sus ajustes, y las tablets lo usan desde su próxima configuración.
  - **Si falla:** los logs del worker (`hub certificate failed`) dicen el motivo; se reintenta solo, cada vez con más espera (máximo 6 h).
  - **Routers con protección contra DNS rebinding** (FRITZ!Box y otros) bloquean un nombre público que apunta a una IP privada. Se agrega la zona de los hubs a las excepciones del router (en FRITZ!Box: «DNS-Rebind-Schutz»). Se prueba desde una tablet abriendo `https://h-<id>.<zona>:4443/health`.
  - El instalador de Windows para un equipo «todo en uno» queda para cuando se elija ese hardware.

---

## 9. Modelo de soporte del piloto (RNF-20)

> **Pendiente de definir por Juan y su socio.** Se completa antes del primer piloto.

| Tema                                                                            | Decisión    |
| ------------------------------------------------------------------------------- | ----------- |
| Quién atiende                                                                   | _pendiente_ |
| Horario (servicio de noche y fines de semana)                                   | _pendiente_ |
| Canal (teléfono, WhatsApp, correo)                                              | _pendiente_ |
| Tiempo de respuesta según gravedad (no se puede cobrar / un aparato / consulta) | _pendiente_ |
| Quién recibe las alertas por correo (`SUPPORT_ALERT_EMAIL`)                     | _pendiente_ |

**Primer diagnóstico cuando llama un restaurante:**

1. Revisar `/support/status`: ¿la nube está sana? ¿el hub tiene señal? ¿hay impresoras con error?
2. Si se necesita entrar a la organización, pedir al dueño el **acceso de soporte** (backoffice → «Acceso de soporte»). Todo lo que hace soporte queda registrado con su nombre.
3. Para un error de la API, buscar en los logs por `requestId` u `organizationId` (§6).
4. Si la tablet funciona pero no envía («Pendientes: n» crece), revisar la red del local. Lo pendiente no se pierde mientras no se borren los datos del navegador.

---

## 10. Verificación pendiente en el primer servidor

- [ ] `deploy/deploy.sh` dos veces seguidas con el bucle de `curl` (§3): sin ningún código distinto de `200`.
- [ ] Un respaldo horario aparece en `restic snapshots` y en `/support/status`.
- [ ] `restore.sh latest` restaura en `pos_restore` y los conteos coinciden.
- [ ] `restore-test.sh` termina con éxito y deja su fila en `platform_job_runs`.
- [ ] Una alerta de prueba llega por correo y se resuelve (§5).
- [ ] El chequeo externo de `/api/v1/health` está configurado y avisa.
- [ ] HTTPS válido en `DOMAIN` (Caddy).
- [ ] `install-hub.sh` en un mini PC: se vincula, sobrevive a un reinicio y aparece con señal en `/support/status`.
- [ ] HTTPS del hub con `ACME_DIRECTORY=staging` y después `production`: la tablet abre `https://h-<id>.<zona>:4443/health` en la red del local (también con el router del piloto).
