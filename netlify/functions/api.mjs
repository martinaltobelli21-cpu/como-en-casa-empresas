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
} from "./lib/shared.mjs";

export const config = { path: "/api/*" };

const MENU_IDS = new Set([...CATEGORY_META.map((m) => m.id), "ninguno"]);
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

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
    return json(200, { publicKey: process.env.VAPID_PUBLIC_KEY || null });
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
    for await (const blob of employees().list({ prefix: `${code}__` })) {
      const emp = await employees().get(blob.key, { type: "json" });
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
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return json(400, { error: "Falta un email válido" });
    const id = crypto.randomUUID();
    await employees().setJSON(employeeKey(cleanCode, id), {
      id,
      code: cleanCode,
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      pinHash: null,
      salt: null,
      pushSubscriptions: [],
      reminderOptIn: false,
      createdAt: new Date().toISOString(),
    });
    return json(200, { ok: true, employeeId: id });
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
    for await (const blob of choicesStore().list({ prefix: `${cleanCode}__` })) {
      if (blob.key.endsWith(`__${employeeId}`)) await choicesStore().delete(blob.key);
    }
    for await (const blob of surveys().list({ prefix: `${cleanCode}__` })) {
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
    if (String(email || "").trim().toLowerCase() !== emp.email) {
      return json(403, { error: "El email no coincide con el que cargó tu empresa. Revisalo o avisale al admin." });
    }
    if (!/^\d{4}$/.test(String(pin || ""))) return json(400, { error: "El PIN debe tener 4 dígitos" });
    emp.salt = crypto.randomBytes(8).toString("hex");
    emp.pinHash = hashPin(cleanCode, employeeId, String(pin), emp.salt);
    await employees().setJSON(employeeKey(cleanCode, employeeId), emp);
    return json(200, { ok: true, name: emp.name });
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
    return json(200, { ok: true, name: emp.name });
  }

  if (method === "GET" && route === "state") {
    const code = (url.searchParams.get("code") || "").toUpperCase();
    const employeeId = url.searchParams.get("employee") || "";
    const company = await companies().get(code, { type: "json" });
    if (!company) return json(404, { error: "Empresa no encontrada" });
    const employee = await employees().get(employeeKey(code, employeeId), { type: "json" });
    if (!employee) return json(404, { error: "Empleado no encontrado" });
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
    });
  }

  if (method === "POST" && route === "choices") {
    const { code, employee: employeeId, week, choices } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const employee = await employees().get(employeeKey(cleanCode, employeeId), { type: "json" });
    if (!employee) return json(404, { error: "Empleado no encontrado" });
    if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(String(week))) return json(400, { error: "Semana inválida" });
    const clean = {};
    for (const [day, menu] of Object.entries(choices || {})) {
      if (!DAY_KEYS.includes(day)) return json(400, { error: `Día inválido: ${day}` });
      if (!MENU_IDS.has(menu)) return json(400, { error: `Menú inválido: ${menu}` });
      clean[day] = menu;
    }
    await choicesStore().setJSON(choiceKey(cleanCode, week, employeeId), {
      choices: clean,
      updatedAt: new Date().toISOString(),
    });
    return json(200, { ok: true, choices: clean });
  }

  if (method === "POST" && route === "push-subscribe") {
    const { code, employee: employeeId, subscription, optIn } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const key = employeeKey(cleanCode, employeeId);
    const employee = await employees().get(key, { type: "json" });
    if (!employee) return json(404, { error: "Empleado no encontrado" });
    employee.reminderOptIn = Boolean(optIn);
    if (subscription?.endpoint) {
      const rest = (employee.pushSubscriptions || []).filter((s) => s.endpoint !== subscription.endpoint);
      employee.pushSubscriptions = [...rest, subscription];
    }
    await employees().setJSON(key, employee);
    return json(200, { ok: true, reminderOptIn: employee.reminderOptIn });
  }

  if (method === "POST" && route === "survey") {
    const { code, employee: employeeId, week, repeat, remove, ideas } = await readBody(req);
    const cleanCode = String(code || "").toUpperCase();
    const employee = await employees().get(employeeKey(cleanCode, employeeId), { type: "json" });
    if (!employee) return json(404, { error: "Empleado no encontrado" });
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

  if (method === "GET" && route === "summary") {
    const code = (url.searchParams.get("code") || "").toUpperCase();
    const adminKey = url.searchParams.get("key") || "";
    const company = await companies().get(code, { type: "json" });
    if (!company) return json(404, { error: "Empresa no encontrada" });
    if (adminKey !== company.adminKey) return json(401, { error: "Clave de administrador incorrecta" });
    const week = nextWeek(artToday());
    const lastWeekKey = previousWeekKey(week.key);
    const list = employees().list({ prefix: `${code}__` });
    const people = [];
    const counts = Object.fromEntries(DAY_KEYS.map((d) => [d, Object.fromEntries([...CATEGORY_META.map((m) => m.id), "ninguno"].map((id) => [id, 0]))]));
    for await (const blob of list) {
      const emp = await employees().get(blob.key, { type: "json" });
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
        reminderOptIn: emp.reminderOptIn,
        choices,
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
    });
  }

  return json(404, { error: "Ruta no encontrada" });
};
