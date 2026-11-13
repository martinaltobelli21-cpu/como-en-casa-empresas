import {
  DAY_KEYS,
  DEADLINE_LABEL,
  artToday,
  nextWeek,
  companies,
  employees,
  choicesStore,
  choiceKey,
  notifyEmployee,
} from "./lib/shared.mjs";

export default async () => {
  const todayISO = artToday();
  const week = nextWeek(todayISO);
  const title = "EY, ES HORA DE ORGANIZAR TU PRÓXIMA SEMANA 👀";
  const body = `Elegí tus viandas de Potente 🍖, Equilibrado 🥘 o Light 🌿 para la ${week.label}. Cerramos ${DEADLINE_LABEL}: si no elegís, quedan Equilibrados. Te espera también la encuesta rápida de la semana que termina 📋. Toca y elegí en 1 minuto.`;

  let pushes = 0;
  let emails = 0;

  for await (const blob of companies.list()) {
    const code = blob.key;
    for await (const empBlob of employees.list({ prefix: `${code}__` })) {
      const emp = await employees.get(empBlob.key, { type: "json" });
      const saved = await choicesStore.get(choiceKey(code, week.key, emp.id), { type: "json" });
      const done = DAY_KEYS.every((d) => saved?.choices?.[d]);
      const msg = done
        ? `Ya armaste tu semana ✅ Igual te dejamos el link por si querés cambiar algo antes del ${DEADLINE_LABEL} 🥘`
        : body;
      const res = await notifyEmployee(emp, empBlob.key, title, msg, "Elegir mi menú");
      pushes += res.pushes;
      emails += res.emailed ? 1 : 0;
    }
  }

  console.log(`[weekly-reminder] sábado ${todayISO}: ${pushes} pushes, ${emails} emails. Semana objetivo: ${week.key}`);
  return new Response("ok");
};
