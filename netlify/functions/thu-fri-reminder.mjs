import {
  DAY_KEYS,
  DEADLINE_LABEL,
  artToday,
  nextWeek,
  companies,
  employees,
  choicesStore,
  employeeKey,
  choiceKey,
  notifyEmployee,
} from "./lib/shared.mjs";

export default async () => {
  const todayISO = artToday();
  const dow = new Date(`${todayISO}T12:00:00Z`).getUTCDay();
  const deadlineWord = dow === 4 ? "El sábado a las 14:00 cerramos" : "¡Mañana es el último día! Cerramos sábado 14:00";
  const week = nextWeek(todayISO);
  const title = dow === 4 ? "EY, YA PODES ELEGIR TU MENÚ DE LA SEMANA QUE VIENE 👀" : "EY, MAÑANA CIERRA LA ELECCIÓN DE TU MENÚ 👀";
  const body = `Elegí Potente 🍖, Equilibrado 🥘 o Light 🌿 para la ${week.label}. ${deadlineWord}: si no elegís, los días sin elección quedan con Equilibrado.`;

  let pushes = 0;
  let emails = 0;

  for await (const blob of companies.list()) {
    const code = blob.key;
    for await (const empBlob of employees.list({ prefix: `${code}__` })) {
      const emp = await employees.get(empBlob.key, { type: "json" });
      const saved = await choicesStore.get(choiceKey(code, week.key, emp.id), { type: "json" });
      const done = DAY_KEYS.every((d) => saved?.choices?.[d]);
      if (done) continue;
      const res = await notifyEmployee(emp, empBlob.key, title, body, "Elegir ahora");
      pushes += res.pushes;
      emails += res.emailed ? 1 : 0;
    }
  }

  console.log(`[thu-fri-reminder] ${todayISO}: ${pushes} pushes, ${emails} emails a quienes falta elegir. Semana objetivo: ${week.key}`);
  return new Response("ok");
};
