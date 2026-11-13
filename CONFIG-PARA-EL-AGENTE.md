# 🤖 Handoff: configuración final en Netlify

App: **Como en Casa · Empresas** (viandas para la empresa Kalis). Repo ya deployable, sin build.

## Qué hacer

### 1. Deploy
- Entrar a: https://app.netlify.com/start/deploy?repository=https://github.com/martinaltobelli21-cpu/como-en-casa-empresas
- Autorizar GitHub, seleccionar el repo `como-en-casa-empresas`, dejar todo por defecto (el `netlify.toml` define publish, funciones y crons) y deployar.

### 2. Variables de entorno
En **Netlify → Site configuration → Environment variables** crear:

| Variable | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | El usuario ya las tiene generadas (se las pasó el asistente anterior por chat). Pedírselas. |
| `VAPID_PRIVATE_KEY` | Ídem. |
| `ADMIN_EMAIL` | `martinaltobelli21@gmail.com` |
| `RESEND_API_KEY` | Crear cuenta gratis en https://resend.com → API Keys → Create API Key |
| `EMAIL_FROM` | `Como en Casa <onboarding@resend.dev>` |
| `SITE_URL` | La URL pública del sitio (ej. `https://como-en-casa-empresas.netlify.app`) |

⚠️ Si no se dispone de las claves VAPID, generarlas nuevas con `npx web-push generate-vapid-keys` y usar esas (el usuario deberá volver a activar el botón 🔔 en la app, no pasa nada).

⚠️ No commitear las claves: el repo es público. Van solo como variables de entorno de Netlify.

### 3. Redeploy
Después de cargar las variables: **Deploys → Trigger deploy → Deploy site** (sin esto las funciones no las ven).

### 4. Verificación (checklist)
- [ ] El sitio carga y muestra los logos "Como en Casa × KALIS"
- [ ] `/#admin` → Crear empresa "Kalis" → devuelve código de 6 caracteres + clave de admin (mostrársela al usuario para que la guarde)
- [ ] En el panel, "Sumar gente": agregar 1 empleado de prueba (nombre + email)
- [ ] Entrar como empleado: código → desplegable de nombres → email + PIN de 4 dígitos → debe entrar a la pantalla de elección
- [ ] Elegir menús lunes a sábado → Confirmar semana → toast de confirmación
- [ ] Botón 🔔 Activar: si pide permiso de notificaciones y queda "✅ Activado", el push funciona
- [ ] GET `/api/push-public-key` devuelve la clave pública (no null)

### 5. Crons ya configurados (no tocar)
- Jueves y viernes 11:00 ART — recordatorio a quienes falta elegir
- Sábado 10:00 ART — "EY, ES HORA DE ORGANIZAR TU PRÓXIMA SEMANA 👀" a todos
- Sábado 14:00 ART — cierre: días sin elección → Equilibrado + mail consolidado a `ADMIN_EMAIL`

## Arquitectura (referencia rápida)
- Frontend estático en la raíz (PWA: `manifest.webmanifest` + `sw.js`).
- Backend: Netlify Functions en `netlify/functions/` (`api.mjs` con path `/api/*` + 3 funciones programadas).
- Datos: Netlify Blobs (stores: `companies`, `employees`, `choices`, `surveys`) — se activa solo, no requiere configuración.
- Menú de 12 días editable en `netlify/functions/lib/shared.mjs` (`MENU_CYCLE`); alineación del ciclo en `CYCLE_EPOCH`.
