import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import crypto from "node:crypto";

export const TZ = "America/Argentina/Buenos_Aires";
export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_LABELS = { mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado" };

export const CATEGORY_META = [
  { id: "potente", name: "Potente", emoji: "🍖", tagline: "Para rendir toda la tarde" },
  { id: "equilibrado", name: "Equilibrado", emoji: "🥘", tagline: "Clásicos de la abu, bien completos" },
  { id: "light", name: "Light", emoji: "🌿", tagline: "Livianos, frescos y rendidores" },
];

// Ciclo de 2 semanas (lunes a sábado): A = días 1-6 (Semana 1), B = días 7-12 (Semana 2).
// El ciclo arranca la semana del CYCLE_EPOCH (un lunes). Cambiar acá si hace falta.
const CYCLE_EPOCH = "2025-11-17";

// Menú real: ciclo de 2 semanas (lunes a sábado), 3 opciones por día.
export const MENU_CYCLE = {
  A: {
    mon: {
      potente: "Milanesa de carne al horno con papas rústicas",
      equilibrado: "Fusilli con pollo al verdeo",
      light: "Wrap Caesar con papas asadas en cubos",
    },
    tue: {
      potente: "Guiso de lentejas con chorizo colorado",
      equilibrado: "Pechuga grillada con arroz integral y vegetales",
      light: "Hamburguesa casera de pollo y espinaca al horno con ensalada de hojas, parmesano y tomate",
    },
    wed: {
      potente: "Sándwich de milanesa completo (lechuga, tomate, jamón, queso y huevo) con papas al horno",
      equilibrado: "Pastel de papa tradicional",
      light: "Sorrentinos de verdura con filetto",
    },
    thu: {
      potente: "Tallarines caseros con estofado de carne",
      equilibrado: "Milanesa de pollo al horno con puré de calabaza y zanahoria",
      light: "Tarta de zapallitos y queso con ensalada mixta",
    },
    fri: {
      potente: "Ñoquis caseros con salsa bolognesa",
      equilibrado: "Pollo a la mostaza y miel con salteado de zapallitos, zanahoria y morrón",
      light: "Ensalada de pollo, palta, huevo, tomate cherry y almendras",
    },
    sat: {
      potente: "Sándwich de bondiola braseada con cebolla caramelizada y papas fritas",
      equilibrado: "Pan de carne con brócoli gratinado",
      light: "Wok de vegetales con pollo y arroz yamaní",
    },
  },
  B: {
    mon: {
      potente: "Milanesa napolitana con papas al horno",
      equilibrado: "Ternera braseada con vegetales grillados (berenjena, zapallito y morrón)",
      light: "Tarta de espinaca y ricota con ensalada caprese",
    },
    tue: {
      potente: "4 empanadas (2 carne, 2 pollo)",
      equilibrado: "Canelones de verdura con salsa blanca y filetto",
      light: "Pollo al limón con puré de calabaza y chauchas",
    },
    wed: {
      potente: "Lasaña de carne y verdura",
      equilibrado: "Albóndigas caseras en salsa de tomate con arroz",
      light: "Tarta de calabaza y queso con ensalada de hojas",
    },
    thu: {
      potente: "Sándwich de pollo napolitano con papas fritas",
      equilibrado: "Costillas de cerdo con vegetales asados y papas",
      light: "Ñoquis de espinaca con filetto",
    },
    fri: {
      potente: "Goulash con spätzle",
      equilibrado: "Milanesa de pollo al horno con puré de papa y ensalada de tomate",
      light: "Bondiola magra al horno con vegetales asados",
    },
    sat: {
      potente: "Sándwich de lomito completo con papas fritas",
      equilibrado: "Wok de carne con arroz frito",
      light: "Wrap Cobb con batata asada en cubos",
    },
  },
};

export function cycleWeek(mondayISO) {
  const weeks = Math.round((Date.parse(`${mondayISO}T00:00:00Z`) - Date.parse(`${CYCLE_EPOCH}T00:00:00Z`)) / (7 * 86400000));
  return ((weeks % 2) + 2) % 2 === 0 ? "A" : "B";
}

export const DEFAULT_MENU = "equilibrado";
export const DEADLINE_LABEL = "sábado a las 14:00";

export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    },
  });

export const artToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export function nextWeek(todayISO) {
  const [y, m, d] = todayISO.split("-").map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  const dow = today.getUTCDay();
  const offset = (8 - dow) % 7 || 7;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() + offset);
  const days = DAY_KEYS.map((key, i) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + i);
    return {
      key,
      iso: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("es-AR", {
        timeZone: "UTC",
        weekday: "long",
        day: "numeric",
        month: "short",
      }).format(date),
    };
  });
  return {
    key: monday.toISOString().slice(0, 10),
    cycle: cycleWeek(monday.toISOString().slice(0, 10)),
    days,
    label: `semana del ${days[0].iso.slice(8)} al ${days[5].iso.slice(8)} de ${new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", month: "long" }).format(monday)}`,
  };
}

export const companies = () => getStore("companies");
export const employees = () => getStore("employees");
export const choicesStore = () => getStore("choices");
export const surveys = () => getStore("surveys");

export const employeeKey = (code, id) => `${code}__${id}`;
export const choiceKey = (code, week, id) => `${code}__${week}__${id}`;
export const surveyKey = (code, week, id) => `${code}__${week}__${id}`;

export function previousWeekKey(weekKey) {
  const d = new Date(`${weekKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function hashPin(code, id, pin, salt) {
  return crypto.createHash("sha256").update(`${code}:${id}:${salt}:${pin}`).digest("hex");
}

export function verifyPin(emp, code, pin) {
  if (!emp?.pinHash || !emp?.salt) return false;
  const candidate = Buffer.from(hashPin(code, emp.id, pin, emp.salt));
  const stored = Buffer.from(emp.pinHash);
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

export function siteUrl() {
  return process.env.SITE_URL || "https://comoencasa-pedidos.netlify.app";
}

export async function sendEmail(to, subject, html) {
  if (!to) return false;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email skipped, sin RESEND_API_KEY] ${to}: ${subject}`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Como en Casa <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    console.error(`[email error] ${to}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

function pushReady() {
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) return false;
  webpush.setVapidDetails("mailto:hola@comoencasa.com.ar", vapidPublic, vapidPrivate);
  return true;
}

export async function sendPushToEmployee(emp, empStoreKey, title, body) {
  if (!pushReady() || !emp.reminderOptIn) return 0;
  let sent = 0;
  for (const sub of emp.pushSubscriptions || []) {
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title, body, url: siteUrl() }), { TTL: 172800 });
      sent += 1;
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        emp.pushSubscriptions = (emp.pushSubscriptions || []).filter((s) => s.endpoint !== sub.endpoint);
        await employees().setJSON(empStoreKey, emp);
      } else {
        console.error(`[push error] ${emp.email}: ${err?.message}`);
      }
    }
  }
  return sent;
}

export function emailTemplate(title, body, cta = "Elegir mi menú") {
  return `<div style="font-family:Arial,sans-serif;background:#fbf3e4;padding:24px">
    <h2 style="color:#c2542b;margin:0 0 8px">${title}</h2>
    <p style="color:#40301f;margin:0 0 16px">${body}</p>
    <a href="${siteUrl()}" style="background:#c2542b;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${cta}</a>
    <p style="color:#8a7a66;font-size:12px;margin-top:20px">Como en Casa · Empresas · Viandas caseras para tu oficina</p>
  </div>`;
}

export async function notifyEmployee(emp, empStoreKey, title, body, cta) {
  const pushes = await sendPushToEmployee(emp, empStoreKey, title, body);
  const emailed = await sendEmail(emp.email, title, emailTemplate(title, body, cta));
  return { pushes, emailed };
}
