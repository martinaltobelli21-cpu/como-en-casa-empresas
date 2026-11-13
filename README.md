# 🥘 Como en Casa · Empresas

App de viandas para empresas, con la misma estética cálida de [Como en Casa](https://comoencasa-pedidos.netlify.app/). El menú es un **ciclo de 2 semanas (lunes a sábado): 12 días × 3 opciones** que se repite. Cada empleado elige **un menú por día** entre:

- 🍖 **Potente** — para rendir toda la tarde
- 🥘 **Equilibrado** — clásicos de la abu, bien completos
- 🌿 **Light** — livianos, frescos y rendidores

Los 12 días del ciclo están precargados con el menú real (Semana 1 y Semana 2) en `netlify/functions/lib/shared.mjs` (`MENU_CYCLE`). Para saber qué semana del ciclo le toca a cada semana calendario, la app compara contra `CYCLE_EPOCH` (un lunes); si la alineación se corre, basta cambiar esa constante.

El ciclo semanal de notificaciones (push + email, hora de Argentina):

| Cuándo | Qué recibe | Quién |
|---|---|---|
| **Jueves 11:00** | "EY, YA PODÉS ELEGIR TU MENÚ DE LA SEMANA QUE VIENE 👀" | Solo a quienes falta elegir |
| **Viernes 11:00** | "EY, MAÑANA CIERRA LA ELECCIÓN DE TU MENÚ 👀" | Solo a quienes falta elegir |
| **Sábado 10:00** | "EY, ES HORA DE ORGANIZAR TU PRÓXIMA SEMANA 👀" | Todos |
| **Sábado 14:00** | Se cierra la semana: los días (lunes a sábado) sin elección quedan con **Equilibrado 🥘** y se avisa | Automático |

El **sábado 14:00 es el último día** para elegir. Después de esa hora, la función `deadline-autofill` completa los días faltantes con Equilibrado, notifica al empleado y **envía el mail consolidado** a `ADMIN_EMAIL` (por defecto `martinaltobelli21@gmail.com`; configurable con la variable `ADMIN_EMAIL`) con: viandas por día y menú, quién completó y las respuestas de la encuesta.

## Encuesta de satisfacción 📋

Junto al formulario de la semana nueva, cada empleado ve una encuesta breve sobre la semana que termina:

1. 🙌 ¿Qué platos te gustaría que se repitan más? *(selección múltiple sobre los platos que comió)*
2. 🚫 ¿Qué platos te gustaría que dejen de estar? *(selección múltiple)*
3. ✨ ¿Qué platos nuevos sumarías? *(texto libre)*

Las respuestas se ven en el panel de admin y llegan incluidas en el mail consolidado del sábado.

## Cómo funciona

1. **El admin** entra a `/#admin`, crea la empresa y le da el **código de 6 caracteres** a los empleados. En el panel carga a cada empleado (nombre + email).
2. **Cada empleado** entra, pone el código y se elige de un **desplegable con la lista de empleados**. El primer ingreso pone su email (tiene que coincidir con el cargado por la empresa) y **crea un PIN de 4 dígitos**; los siguientes ingresos entran con email + PIN. Así nadie entra con la cuenta de otro.
3. Al ingresar, el servidor entrega un **token de sesión** que el navegador guarda y manda en cada llamada. Todas las rutas de empleado (`state`, `choices`, `push-subscribe`, `survey`) lo validan: sin token o con token inválido, el servidor responde 401 y la app vuelve a la pantalla de ingreso.
4. Elige **un menú por día** (lunes a sábado) para la semana próxima y toca **Confirmar semana**. Puede cambiarla cuando quiera.
5. El admin ve el **resumen semanal**: cuántas viandas de cada menú pedir por día y quién ya armó su semana, con botón para copiar el resumen por WhatsApp.
6. El **sábado**, la función programada envía el recordatorio a todos (push + email), avisando quién ya tiene la semana lista.

## Stack (100% gratis o incluido en tu plan de Netlify)

- **Frontend:** HTML/CSS/JS puro, PWA instalable (manifest + service worker). Sin build.
- **Backend:** Netlify Functions (serverless).
- **Datos:** Netlify Blobs (incluido en Netlify, sin base de datos externa).
- **Push:** `web-push` con claves VAPID (gratis).
- **Email:** [Resend](https://resend.com) (gratis hasta 100 emails/día).

## Puesta en marcha

1. Conectá el repo a Netlify (o `netlify deploy`). No hace falta build: publica la raíz.
2. Instalá dependencias (Netlify lo hace solo): `npm install`.
3. Generá las claves VAPID para las notificaciones push:

   ```bash
   npx web-push generate-vapid-keys
   ```

4. En **Netlify → Site configuration → Environment variables** cargá:

   | Variable | Para qué |
   |---|---|
   | `VAPID_PUBLIC_KEY` | Clave pública VAPID (push) |
   | `VAPID_PRIVATE_KEY` | Clave privada VAPID (push) |
   | `SITE_URL` | URL final del sitio, ej. `https://tu-site.netlify.app` |
   | `RESEND_API_KEY` | API key de Resend (emails) |
   | `EMAIL_FROM` | Ej. `Como en Casa <hola@tudominio.com>` |
   | `ADMIN_EMAIL` | Email que recibe el consolidado del sábado (por defecto `martinaltobelli21@gmail.com`) |

   Si no cargás `RESEND_API_KEY`, los emails se omiten (el push sigue funcionando). Si no cargás las VAPID, el push se omite y el recordatorio queda solo por email.

5. Listo. Los recordatorios corren solos:
   - `0 14 * * 4,5` UTC = jueves y viernes 11:00 (solo a quienes falta elegir)
   - `0 13 * * 6` UTC = sábado 10:00 (todos)
   - `0 17 * * 6` UTC = sábado 14:00 (cierre + autocompletar con Equilibrado)

## Probar el recordatorio sin esperar al sábado

Netlify dispara `weekly-reminder` según el cron. Para probarlo manualmente podés ejecutar la función desde el tablero de Netlify (Functions → weekly-reminder → Invoke) o esperar al sábado 😄.

Además hay un **modo demo**: si el admin carga a una persona llamada **Usuario de Prueba** (cualquier variante con o sin espacios), al entrar como esa persona aparece un botoncito discreto `·demo·` al pie de la pantalla. Al tocarlo, el servidor envía la push real (si activó el 🔔) y un email de prueba a `martinaltobelli41@gmail.com` (configurable con la variable `DEMO_EMAIL`). Solo ese usuario puede usarlo.

## Estructura

```
index.html                  App (empleado + admin con #admin)
css/styles.css              Estética Como en Casa (crema, terracota, Fraunces + Nunito)
js/app.js                   Lógica de elección semanal, push y admin
netlify/functions/api.mjs   API: empresa, roster, PIN/login, elecciones, encuesta, resumen
netlify/functions/lib/shared.mjs  Código compartido (menús, blobs, push, email)
netlify/functions/thu-fri-reminder.mjs  Recordatorio jueves y viernes
netlify/functions/weekly-reminder.mjs  Recordatorio del sábado 10:00
netlify/functions/deadline-autofill.mjs  Cierre sábado 14:00 (Equilibrado por defecto)
netlify.toml                Config de Netlify (crons)
manifest.webmanifest / sw.js  PWA + notificaciones push
```
