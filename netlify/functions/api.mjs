import crypto from "node:crypto";
import {
  CATEGORY_META,
  MENU_CYCLE,
  DAY_KEYS,
  DEFAULT_MENU,
  json,
  artToday,
  nextWeek,
  cycleWeek,
  previousWeekKey,
  companies,
  employees,
  choicesStore,
  surveys,
  employeeKey,
  choiceKey,
  surveyKey,
  hashPin,
  verifyPin,
  sendPushToEmployee,
  sendEmail,
  emailTemplate,
} from "./lib/shared.mjs";

export const config = { path: "/api/*" };

// Cierre: sábado 14:00 (ART) anterior al lunes de la semana elegida.
function weekStatus(week) {
  const monday = new Date(`${week.key}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - 2);
  const deadline = `${monday.toISOString().slice(0, 10)}T14:00:00-03:00`;
  return { deadline, locked: Date.now() >= Date.parse(deadline) };
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAY_NAMES = { mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado" };

function orderEmailHtml(employee, week, choices) {
  const dayMenus = MENU_CYCLE[week.cycle];
  const rows = week.days.map((day) => {
    const menu = choices[day.key];
    const meta = CATEGORY_META.find((m) => m.id === menu);
    const dish = menu === "ninguno" ? "Sin vianda" : meta ? `${meta.emoji} ${meta.name} · ${esc(dayMenus?.[day.key]?.[menu] || "")}` : "Sin elegir (queda Equilibrado al cierre)";
    return `<tr><td style="padding:8px 10px;border-bottom:1px solid #eadfc8;font-weight:bold;color:#40301f">${DAY_NAMES[day.key]} ${day.iso.slice(8)}</td><td style="padding:8px 10px;border-bottom:1px solid #eadfc8;color:#40301f">${dish}</td></tr>`;
  }).join("");
  return `Hola ${esc(employee.name.split(" ")[0])}, este es tu pedido para la ${esc(week.label)}:<br><br><table style="border-collapse:collapse;width:100%;background:#fff9ee;border-radius:12px">${rows}</table><br>Podés modificarlo desde la app hasta el sábado a las 14:00.`;
}

const MENU_IDS = new Set([...CATEGORY_META.map((m) => m.id), "ninguno"]);
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SESSION_ERROR = "Tu sesión venció. Ingresá de nuevo con tu email y PIN.";
const PUSH_ERROR = "Activá las notificaciones de este dispositivo para continuar.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizedName(name) {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function pushPublicKey() {
  return process.env.VAPID_PRIVATE_KEY && process.env.VAPID_PUBLIC_KEY || null;
}

function hasPush(employee, endpoint) {
  return Boolean(pushPublicKey() && employee.reminderOptIn && endpoint &&
    employee.pushSubscriptions?.some((subscription) => subscription.endpoint === endpoint));
}

async function authenticate(req, code, employeeId) {
  const token = req.headers.get("x-session-token") || "";
  if (!token) return null;
  const emp = await employees().get(employeeKey(code, employeeId), { type: "json" });
  if (!emp?.sessionToken) return null;
  const given = Buffer.from(token);
  const stored = Buffer.from(emp.sessionToken);
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) return null;
  return emp;
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "");
  const method = req.method.toUpperCase();

  if (method === "OPTIONS") return json(200, { ok: true });

  if (method === "GET" && route === "push-public-key") {
    return json(200, { publicKey: pushPublicKey() });
  }

  if (method === "POST" && route === "company") {
    const { name } = await readBody(req);
    if (!name || String(name).trim().length < 2) return json(400, { error: "Falta el nombre de la empresa" });
    const code = Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
    const adminKey = crypto.randomBytes(16).toString("hex");
    await companies().setJSON(code, { code, name: String(name).trim(), adminKey, createdAt: new Date().toISOString() });
    return json(200, { code, adminKey, name: String(name).trim() });
  }

  if (method === "GET" && route === "roster") {
    const code = (url.searchParams.get("code") || "").toUpperCase();
    const company = await companies().get(code, { type: "json" });
    if (!company) return json(404, { error: "No encontramos esa empresa. Revisá el código." });
    const people = [];
    const { blobs } = await employees().list({ prefix: `${code}__` });
    for (const blob of blobs) {
      const emp = await employees().get(blob.key, { type: "json" });
      if (!emp) continue;
      people.push({ id: emp.id, name: emp.name, hasPin: Boolean(emp.pinHash) });
    }
    people.sort((a, b) => a.name.localeCompare(b.name, "es"));
    return json(200, { company: company.name, people });
  }

  if (method === "POST" && route === "roster-add") {
    const { code, key, name, email } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const company = await companies().get(cleanCode, { type: "json" });
    if (!company) return json(404, { error: "Empresa no encontrada" });
    if (key !== company.adminKey) return json(401, { error: "Clave de administrador incorrecta" });
    if (!name || String(name).trim().length < 2) return json(400, { error: "Falta el nombre" });
    if (email && !EMAIL_PATTERN.test(String(email).trim())) return json(400, { error: "Ingresá un email válido o dejalo vacío" });
    const id = crypto.randomUUID();
    await employees().setJSON(employeeKey(cleanCode, id), {
      id,
      code: cleanCode,
      name: String(name).trim(),
      email: String(email || "").trim().toLowerCase() || null,
      pinHash: null,
      salt: null,
      pushSubscriptions: [],
      reminderOptIn: false,
      createdAt: new Date().toISOString(),
    });
    return json(200, { ok: true, employeeId: id });
  }

  if (method === "POST" && route === "roster-import") {
    const { code, key, names } = await readBody(req);
    const cleanCode = String(code || "").trim().toUpperCase();
    const company = await companies().get(cleanCode, { type: "json" });
    if (!company) return json(404, { error: "Empresa no encontrada" });
    if (key !== company.adminKey) return json(401, { error: "Clave de administrador incorrecta" });
    if (!Array.isArray(names) || names.length === 0 || names.length > 100 ||
        names.some((name) => typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120)) {
      return json(400, { error: "Ingresá entre 1 y 100 nombres, uno por renglón." });
    }
    const store = employees();
    const { blobs } = await store.list({ prefix: `${cleanCode}__` });
    const existing = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json", consistency: "strong" })));
    const known = new Set(existing.filter(Boolean).map((employee) => normalizedName(employee.name)));
    let added = 0;
    const pending = [];
    for (const value of names) {
      const name = value.trim().replace(/\s+/g, " ");
      const normalized = normalizedName(name);
      if (known.has(normalized)) continue;
      known.add(normalized);
      const id = crypto.createHash("sha256").update(`${cleanCode}\n${normalized}`).digest("hex");
      pending.push({ id, name });
    }
    for (let offset = 0; offset < pending.length; offset += 10) {
      const created = await Promise.all(pending.slice(offset, offset + 10).map(async ({ id, name }) => {
        const recordKey = employeeKey(cleanCode, id);
        if (await store.get(recordKey, { type: "json", consistency: "strong" })) return 0;
        await store.setJSON(recordKey, {
          id, code: cleanCode, name, email: null, pinHash: null, salt: null,
          pushSubscriptions: [], reminderOptIn: false, createdAt: new Date().toISOString(),
        });
        return 1;
      }));
      added += created.reduce((sum, count) => sum + count, 0);
    }
    return json(200, { added, skipped: names.length - added });
  }

  if (method === "POST" && route === "roster-remove") {
    const { code, key, employee: employeeId } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const company = await companies().get(cleanCode, { type: "json" });
    if (!company) return json(404, { error: "Empresa no encontrada" });
    if (key !== company.adminKey) return json(401, { error: "Clave de administrador incorrecta" });
    const empKey = employeeKey(cleanCode, employeeId);
    const emp = await employees().get(empKey, { type: "json" });
    if (!emp) return json(404, { error: "Empleado no encontrado" });
    await employees().delete(empKey);
    const { blobs: choiceBlobs } = await choicesStore().list({ prefix: `${cleanCode}__` });
    for (const blob of choiceBlobs) {
      if (blob.key.endsWith(`__${employeeId}`)) await choicesStore().delete(blob.key);
    }
    const { blobs: surveyBlobs } = await surveys().list({ prefix: `${cleanCode}__` });
    for (const blob of surveyBlobs) {
      if (blob.key.endsWith(`__${employeeId}`)) await surveys().delete(blob.key);
    }
    return json(200, { ok: true });
  }

  if (method === "POST" && route === "enroll") {
    const { code, employee: employeeId, email, pin } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const emp = await employees().get(employeeKey(cleanCode, employeeId), { type: "json" });
    if (!emp) return json(404, { error: "Empleado no encontrado" });
    if (emp.pinHash) return json(400, { error: "Ya tenés PIN creado. Ingresá con tu PIN." });
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleanEmail)) return json(400, { error: "Ingresá un email válido." });
    if (emp.email && cleanEmail !== emp.email) {
      return json(403, { error: "El email no coincide con el que cargó tu empresa. Revisalo o avisale al admin." });
    }
    if (!/^\d{4}$/.test(String(pin || ""))) return json(400, { error: "El PIN debe tener 4 dígitos" });
    emp.email = cleanEmail;
    emp.salt = crypto.randomBytes(8).toString("hex");
    emp.pinHash = hashPin(cleanCode, employeeId, String(pin), emp.salt);
    emp.sessionToken = crypto.randomBytes(24).toString("base64url");
    emp.sessionCreatedAt = new Date().toISOString();
    await employees().setJSON(employeeKey(cleanCode, employeeId), emp);
    return json(200, { ok: true, name: emp.name, token: emp.sessionToken });
  }

  if (method === "POST" && route === "login") {
    const { code, employee: employeeId, email, pin } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const emp = await employees().get(employeeKey(cleanCode, employeeId), { type: "json" });
    if (!emp) return json(404, { error: "Empleado no encontrado" });
    if (!emp.pinHash) return json(400, { error: "Todavía no creaste tu PIN" });
    if (String(email || "").trim().toLowerCase() !== emp.email) {
      return json(403, { error: "El email no coincide. Revisalo o avisale al admin." });
    }
    if (!verifyPin(emp, cleanCode, String(pin || ""))) return json(403, { error: "PIN incorrecto" });
    emp.sessionToken = crypto.randomBytes(24).toString("base64url");
    emp.sessionCreatedAt = new Date().toISOString();
    await employees().setJSON(employeeKey(cleanCode, employeeId), emp);
    return json(200, { ok: true, name: emp.name, token: emp.sessionToken });
  }

  if (method === "GET" && route === "state") {
    const code = (url.searchParams.get("code") || "").toUpperCase();
    const employeeId = url.searchParams.get("employee") || "";
    const company = await companies().get(code, { type: "json" });
    if (!company) return json(404, { error: "Empresa no encontrada" });
    const employee = await authenticate(req, code, employeeId);
    if (!employee) return json(401, { error: SESSION_ERROR });
    const week = nextWeek(artToday());
    const saved = await choicesStore().get(choiceKey(code, week.key, employeeId), { type: "json" });
    const lastWeekKey = previousWeekKey(week.key);
    const lastChoices = await choicesStore().get(choiceKey(code, lastWeekKey, employeeId), { type: "json" });
    const lastCycle = MENU_CYCLE[cycleWeek(lastWeekKey)];
    const eaten = [];
    for (const day of DAY_KEYS) {
      const menu = lastChoices?.choices?.[day] || DEFAULT_MENU;
      if (menu === "ninguno") continue;
      const dish = lastCycle?.[day]?.[menu];
      if (dish) eaten.push(dish);
    }
    const savedSurvey = await surveys().get(surveyKey(code, lastWeekKey, employeeId), { type: "json" });
    return json(200, {
      company: { code: company.code, name: company.name },
      employee: { id: employee.id, name: employee.name, email: employee.email, reminderOptIn: employee.reminderOptIn },
      week,
      menus: CATEGORY_META,
      dayMenus: MENU_CYCLE[week.cycle],
      choices: saved?.choices || {},
      lastWeek: { key: lastWeekKey, dishes: eaten },
      surveyDone: Boolean(savedSurvey),
      submittedAt: saved?.updatedAt || null,
      ...weekStatus(week),
    });
  }

  if (method === "POST" && route === "choices") {
    const { code, employee: employeeId, pushEndpoint, week, choices } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const employee = await authenticate(req, cleanCode, employeeId);
    if (!employee) return json(401, { error: SESSION_ERROR });
    if (!hasPush(employee, pushEndpoint)) return json(403, { error: PUSH_ERROR });
    if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(String(week))) return json(400, { error: "Semana inválida" });
    const current = nextWeek(artToday());
    if (String(week) !== current.key) return json(409, { error: "La semana cambió. Recargá la app para ver la nueva." });
    if (weekStatus(current).locked) return json(423, { error: "La elección de esta semana ya cerró (sábado 14:00)." });
    const clean = {};
    for (const [day, menu] of Object.entries(choices || {})) {
      if (!DAY_KEYS.includes(day)) return json(400, { error: `Día inválido: ${day}` });
      if (!MENU_IDS.has(menu)) return json(400, { error: `Menú inválido: ${menu}` });
      clean[day] = menu;
    }
    const previous = await choicesStore().get(choiceKey(cleanCode, week, employeeId), { type: "json" });
    const updatedAt = new Date().toISOString();
    await choicesStore().setJSON(choiceKey(cleanCode, week, employeeId), {
      choices: clean,
      updatedAt,
      firstSubmittedAt: previous?.firstSubmittedAt || previous?.updatedAt || updatedAt,
    });
    let emailed = false;
    if (employee.email) {
      try {
        const title = previous ? "✏️ Modificaste tu pedido de viandas" : "✅ Recibimos tu pedido de viandas";
        emailed = await sendEmail(employee.email, title, emailTemplate(title, orderEmailHtml(employee, current, clean), "Ver mi pedido"));
      } catch (err) {
        console.error(`[order email] ${employee.email}: ${err?.message}`);
      }
    }
    return json(200, { ok: true, choices: clean, updatedAt, modified: Boolean(previous), emailed });
  }

  if (method === "POST" && route === "push-status") {
    const { code, employee: employeeId, pushEndpoint } = await readBody(req);
    const employee = await authenticate(req, String(code || "").toUpperCase(), employeeId);
    if (!employee) return json(401, { error: SESSION_ERROR });
    return json(200, { active: hasPush(employee, pushEndpoint) });
  }

  if (method === "POST" && route === "push-subscribe") {
    const { code, employee: employeeId, subscription, optIn } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const key = employeeKey(cleanCode, employeeId);
    const employee = await authenticate(req, cleanCode, employeeId);
    if (!employee) return json(401, { error: SESSION_ERROR });
    if (!pushPublicKey()) return json(503, { error: "Las notificaciones todavía no están configuradas." });
    if (optIn !== true || typeof subscription?.endpoint !== "string" ||
        !subscription.endpoint.startsWith("https://") || !subscription.keys?.auth || !subscription.keys?.p256dh) {
      return json(400, { error: "No se pudo registrar la suscripción de este dispositivo." });
    }
    employee.reminderOptIn = true;
    const rest = (employee.pushSubscriptions || []).filter((s) => s.endpoint !== subscription.endpoint);
    employee.pushSubscriptions = [...rest, subscription];
    await employees().setJSON(key, employee);
    return json(200, { ok: true, reminderOptIn: employee.reminderOptIn });
  }

  if (method === "POST" && route === "survey") {
    const { code, employee: employeeId, pushEndpoint, week, repeat, remove, ideas } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const employee = await authenticate(req, cleanCode, employeeId);
    if (!employee) return json(401, { error: SESSION_ERROR });
    if (!hasPush(employee, pushEndpoint)) return json(403, { error: PUSH_ERROR });
    if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(String(week))) return json(400, { error: "Semana inválida" });
    const cleanList = (arr) =>
      Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x.trim()).slice(0, 20).map((s) => s.trim().slice(0, 200)) : [];
    await surveys().setJSON(surveyKey(cleanCode, week, employeeId), {
      repeat: cleanList(repeat),
      remove: cleanList(remove),
      ideas: String(ideas || "").trim().slice(0, 500),
      updatedAt: new Date().toISOString(),
    });
    return json(200, { ok: true });
  }

  if (method === "POST" && route === "demo-notify") {
    const { code, employee: employeeId, pushEndpoint } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const employee = await authenticate(req, cleanCode, employeeId);
    if (!employee) return json(401, { error: SESSION_ERROR });
    if (employee.name.trim().toLowerCase().replace(/\s+/g, "") !== "usuariodeprueba") {
      return json(403, { error: "Solo el usuario de prueba puede enviar la demo 🧪" });
    }
    if (!hasPush(employee, pushEndpoint)) return json(403, { error: PUSH_ERROR });
    const title = "EY, ES HORA DE ORGANIZAR TU PRÓXIMA SEMANA 👀";
    const body = "Esto es una prueba de la app de viandas 🧪 Si estás viendo esto, la notificación funciona.";
    const pushes = await sendPushToEmployee(employee, employeeKey(cleanCode, employeeId), title, body);
    const emailed = await sendEmail(
      process.env.DEMO_EMAIL || "martinaltobelli41@gmail.com",
      `${title} (prueba 🧪)`,
      emailTemplate(title, `${body}<br><br>Usuario de prueba: <strong>${employee.name}</strong> · Empresa: ${cleanCode}`, "Abrir la app")
    );
    return json(200, { ok: true, pushes, emailed });
  }

  if (method === "GET" && route === "summary") {
    const code = (url.searchParams.get("code") || "").toUpperCase();
    const adminKey = url.searchParams.get("key") || "";
    const company = await companies().get(code, { type: "json" });
    if (!company) return json(404, { error: "Empresa no encontrada" });
    if (adminKey !== company.adminKey) return json(401, { error: "Clave de administrador incorrecta" });
    const week = nextWeek(artToday());
    const lastWeekKey = previousWeekKey(week.key);
    const { blobs } = await employees().list({ prefix: `${code}__` });
    const people = [];
    const counts = Object.fromEntries(DAY_KEYS.map((d) => [d, Object.fromEntries([...CATEGORY_META.map((m) => m.id), "ninguno"].map((id) => [id, 0]))]));
    for (const blob of blobs) {
      const emp = await employees().get(blob.key, { type: "json" });
      if (!emp) continue;
      const saved = await choicesStore().get(choiceKey(code, week.key, emp.id), { type: "json" });
      const choices = saved?.choices || {};
      for (const day of DAY_KEYS) {
        const menu = choices[day];
        if (menu && counts[day][menu] !== undefined) counts[day][menu] += 1;
      }
      const sv = await surveys().get(surveyKey(code, lastWeekKey, emp.id), { type: "json" });
      people.push({
        id: emp.id,
        name: emp.name,
        email: emp.email,
        hasPin: Boolean(emp.pinHash),
        reminderOptIn: Boolean(emp.reminderOptIn && emp.pushSubscriptions?.length),
        choices,
        submittedAt: saved?.updatedAt || null,
        completed: DAY_KEYS.every((d) => choices[d]),
        survey: sv ? { repeat: sv.repeat || [], remove: sv.remove || [], ideas: sv.ideas || "" } : null,
      });
    }
    people.sort((a, b) => a.name.localeCompare(b.name, "es"));
    return json(200, {
      company: { code: company.code, name: company.name },
      week,
      menus: CATEGORY_META,
      dayMenus: MENU_CYCLE[week.cycle],
      counts,
      people,
      ...weekStatus(week),
    });
  }

  if (method === "POST" && route === "admin-remind") {
    const { code, key: adminKey } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const company = await companies().get(cleanCode, { type: "json" });
    if (!company) return json(404, { error: "Empresa no encontrada" });
    if (adminKey !== company.adminKey) return json(401, { error: "Clave de administrador incorrecta" });
    const week = nextWeek(artToday());
    if (weekStatus(week).locked) return json(423, { error: "La elección de esta semana ya cerró." });
    const { blobs } = await employees().list({ prefix: `${cleanCode}__` });
    let reminded = 0;
    let pushes = 0;
    for (const blob of blobs) {
      const emp = await employees().get(blob.key, { type: "json" });
      if (!emp) continue;
      const saved = await choicesStore().get(choiceKey(cleanCode, week.key, emp.id), { type: "json" });
      if (saved?.updatedAt) continue;
      const title = "⏰ Te falta elegir tus viandas";
      const body = `Elegí tu menú para la ${week.label}. Cerramos el sábado a las 14:00.`;
      pushes += await sendPushToEmployee(emp, blob.key, title, body);
      if (emp.email) await sendEmail(emp.email, title, emailTemplate(title, body)).catch(() => false);
      reminded += 1;
    }
    return json(200, { ok: true, reminded, pushes });
  }

  return json(404, { error: "Ruta no encontrada" });
};
