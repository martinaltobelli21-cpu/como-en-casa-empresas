import {
  DEADLINE_LABEL,
  DEFAULT_MENU,
  CATEGORY_META,
  DAY_KEYS,
  DAY_LABELS,
  artToday,
  nextWeek,
  previousWeekKey,
  companies,
  employees,
  choicesStore,
  surveys,
  choiceKey,
  surveyKey,
  sendEmail,
  notifyEmployee,
} from "./lib/shared.mjs";

const DEFAULT = CATEGORY_META.find((m) => m.id === DEFAULT_MENU);

const th = 'style="padding:8px 10px;border:1px solid #eadfc8;background:#fdf6e9;font-size:12px;text-align:left"';
const td = 'style="padding:8px 10px;border:1px solid #eadfc8;font-size:13px"';

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default async () => {
  const todayISO = artToday();
  const week = nextWeek(todayISO);
  const adminEmail = process.env.ADMIN_EMAIL || "martinaltobelli21@gmail.com";

  let updated = 0;
  let pushes = 0;
  let emails = 0;

  const companyStore = companies();
  const employeeStore = employees();
  const choiceStore = choicesStore();
  const surveyStore = surveys();
  const { blobs: companyBlobs } = await companyStore.list();
  for (const blob of companyBlobs) {
    const code = blob.key;
    const company = await companyStore.get(code, { type: "json" });
    if (!company) continue;

    const people = [];
    const counts = Object.fromEntries(DAY_KEYS.map((d) => [d, Object.fromEntries([...CATEGORY_META.map((m) => m.id), "ninguno"].map((id) => [id, 0]))]));

    const { blobs: employeeBlobs } = await employeeStore.list({ prefix: `${code}__` });
    for (const empBlob of employeeBlobs) {
      const emp = await employeeStore.get(empBlob.key, { type: "json" });
      if (!emp) continue;
    const key = choiceKey(code, week.key, emp.id);
      const saved = await choiceStore.get(key, { type: "json" });
      const choices = { ...(saved?.choices || {}) };
      const missing = DAY_KEYS.filter((d) => !choices[d]);
      if (missing.length > 0) {
        for (const day of missing) choices[day] = DEFAULT_MENU;
        await choiceStore.setJSON(key, { choices, updatedAt: new Date().toISOString(), autoFilled: true });
        updated += 1;
        const filledDays = missing.map((d) => DAY_LABELS[d]).join(", ");
        const title = "Cerramos tu semana ✅";
        const body = `Los días que no elegiste quedaron con ${DEFAULT.emoji} ${DEFAULT.name}: ${filledDays}. Podés ver tu semana en la app. ¡Buen provecho!`;
        try {
          const res = await notifyEmployee(emp, empBlob.key, title, body, "Ver mi semana");
          pushes += res.pushes;
          emails += res.emailed ? 1 : 0;
        } catch (err) {
          console.error(`[deadline-autofill] aviso a ${emp.email}: ${err?.message}`);
        }
      }
      for (const day of DAY_KEYS) {
        const menu = choices[day];
        if (menu && counts[day][menu] !== undefined) counts[day][menu] += 1;
      }
      const sv = await surveyStore.get(surveyKey(code, previousWeekKey(week.key), emp.id), { type: "json" });
      people.push({
        name: emp.name,
        email: emp.email,
        completedBefore: missing.length === 0,
        choices,
        survey: sv ? { repeat: sv.repeat || [], remove: sv.remove || [], ideas: sv.ideas || "" } : null,
      });
    }

    people.sort((a, b) => a.name.localeCompare(b.name, "es"));

    const totalWeek = DAY_KEYS.reduce((acc, d) => acc + CATEGORY_META.reduce((sum, menu) => sum + counts[d][menu.id], 0), 0);
    const menuCols = CATEGORY_META.map((m) => `<th ${th}>${m.emoji} ${m.name}</th>`).join("");
    const countRows = DAY_KEYS.map((d) => {
      const c = counts[d];
      const total = CATEGORY_META.reduce((sum, menu) => sum + c[menu.id], 0);
      return `<tr><td ${td}><strong>${DAY_LABELS[d]}</strong></td>${CATEGORY_META.map((m) => `<td ${td} style="text-align:center">${c[m.id] || 0}</td>`).join("")}<td ${td} style="text-align:center">${c.ninguno || 0}</td><td ${td} style="text-align:center"><strong>${total}</strong></td></tr>`;
    }).join("");

    const peopleRows = people
      .map(
        (p) => `<tr><td ${td}><strong>${esc(p.name)}</strong><br><span style="color:#8a7a66;font-size:12px">${esc(p.email)}</span></td>
        <td ${td}>${p.completedBefore ? "✅ Eligieron todo" : `🥘 Autocompletado (${DEFAULT.name})`}</td></tr>`
      )
      .join("");

    const surveyRows = people
      .filter((p) => p.survey && (p.survey.repeat.length || p.survey.remove.length || p.survey.ideas))
      .map(
        (p) => `<tr><td ${td}><strong>${esc(p.name)}</strong></td>
        <td ${td}>${p.survey.repeat.length ? `🙌 ${esc(p.survey.repeat.join(" · "))}` : "—"}</td>
        <td ${td}>${p.survey.remove.length ? `🚫 ${esc(p.survey.remove.join(" · "))}` : "—"}</td>
        <td ${td}>${p.survey.ideas ? esc(p.survey.ideas) : "—"}</td></tr>`
      )
      .join("");

    const html = `<div style="font-family:Arial,sans-serif;background:#fbf3e4;padding:24px">
      <h2 style="color:#c2542b;margin:0 0 4px">🥘 ${esc(company.name)}</h2>
      <p style="color:#40301f;margin:0 0 16px">Pedidos consolidados para la ${week.label} (${week.cycle === "A" ? "Semana 1" : "Semana 2"} del ciclo) · cerrados ${DEADLINE_LABEL} · ${totalWeek} viandas en total</p>
      <h3 style="color:#40301f;margin:16px 0 8px">Viandas por día 🍱</h3>
      <table style="border-collapse:collapse;background:#fff9ee"><tr><th ${th}>Día</th>${menuCols}<th ${th}>⛔ No</th><th ${th}>Total</th></tr>${countRows}</table>
      <h3 style="color:#40301f;margin:20px 0 8px">Tu gente 👥 (${people.length})</h3>
      <table style="border-collapse:collapse;background:#fff9ee"><tr><th ${th}>Empleado</th><th ${th}>Estado</th></tr>${peopleRows}</table>
      ${
        surveyRows
          ? `<h3 style="color:#40301f;margin:20px 0 8px">Encuesta de la semana que termina 📋</h3>
      <table style="border-collapse:collapse;background:#fff9ee"><tr><th ${th}>Empleado</th><th ${th}>Que se repitan</th><th ${th}>Que dejen de estar</th><th ${th}>Nuevos</th></tr>${surveyRows}</table>`
          : ""
      }
      <p style="color:#8a7a66;font-size:12px;margin-top:20px">Como en Casa · Empresas</p>
    </div>`;

    await sendEmail(adminEmail, `🥘 ${company.name} · Pedidos para la ${week.label} (${totalWeek} viandas)`, html);
  }

  console.log(
    `[deadline-autofill] ${DEADLINE_LABEL} ${todayISO}: ${updated} semanas autocompletadas, ${pushes} pushes, ${emails} emails a empleados. Consolidado enviado a ${adminEmail}. Semana objetivo: ${week.key}`
  );
  return new Response("ok");
};
