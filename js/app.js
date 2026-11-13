const API = "/api";
const DAY_LABELS = { mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado" };
const MENU_STYLE = { potente: "potente", equilibrado: "equilibrado", light: "light", ninguno: "ninguno" };

const LS_EMPLOYEE = "cec_empresas_employee";
const LS_ADMIN = "cec_empresas_admin";

const $ = (sel) => document.querySelector(sel);
const state = { data: null, choices: {} };

let session = JSON.parse(localStorage.getItem(LS_EMPLOYEE) || "null");
let adminSession = JSON.parse(localStorage.getItem(LS_ADMIN) || "null");
let pushEndpoint = null;
let pushKey = null;
let currentView;

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (session?.token) headers["x-session-token"] = session.token;
  const res = await fetch(`${API}/${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && session?.token && currentView !== "admin") {
    localStorage.removeItem(LS_EMPLOYEE);
    session = null;
    show("join");
    throw new Error(body.error || "Tu sesión venció. Ingresá de nuevo.");
  }
  if (!res.ok) throw new Error(body.error || "Algo salió mal, probá de nuevo");
  return body;
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

function show(view) {
  currentView = view;
  for (const v of ["join", "login", "push", "employee", "admin"]) {
    $(`#view-${v}`).classList.toggle("hidden", v !== view);
  }
  $("#sticky-bar").classList.toggle("hidden", view !== "employee");
  $("#saturday-banner").classList.toggle("hidden", view !== "employee" || !isSaturday());
}

function isSaturday() {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short" }).format(new Date()) === "Sat";
}

/* ---------- Empleado ---------- */

function renderMenus(menus) {
  $("#menu-cards").innerHTML =
    menus
      .map(
        (m) => `
      <div class="menu-card">
        <h3>${m.emoji} ${m.name}</h3>
        <p class="tagline">${m.tagline}</p>
      </div>`
      )
      .join("") +
    `<p class="cycle-note">El plato de cada día cambia con el ciclo de 2 semanas: la semana que viene te toca la <strong>${state.data.week.cycle === "A" ? "Semana 1" : "Semana 2"}</strong> del menú 📅</p>`;
}

function renderWeek(week, menus, dayMenus) {
  $("#week-grid").innerHTML = week.days
    .map((day) => {
      const opts = dayMenus[day.key];
      const short = day.label.split(",").slice(1).join(",").trim();
      return `
      <div class="day-card" data-day="${day.key}">
        <div class="day-name"><span>${DAY_LABELS[day.key]} <span class="muted">· ${short}</span></span><span class="day-status muted">falta elegir</span></div>
        <div class="day-options">
          ${menus
            .map(
              (m) => `
            <button type="button" class="option" data-day="${day.key}" data-menu="${m.id}">
              <span class="option-name">${m.emoji} ${m.name}</span>
              <span class="option-dish">${opts[m.id]}</span>
            </button>`
            )
            .join("")}
          <button type="button" class="chip" data-day="${day.key}" data-menu="ninguno">⛔ No como este día</button>
        </div>
      </div>`;
    })
    .join("");

  document.querySelectorAll(".chip, .option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { day, menu } = btn.dataset;
      if (state.choices[day] === menu) delete state.choices[day];
      else state.choices[day] = menu;
      paintChips();
      updateSticky();
    });
  });
  paintChips();
}

function paintChips() {
  document.querySelectorAll(".chip, .option").forEach((btn) => {
    const selected = state.choices[btn.dataset.day];
    btn.classList.remove("selected-potente", "selected-equilibrado", "selected-light", "selected-ninguno");
    if (selected && selected === btn.dataset.menu) btn.classList.add(`selected-${MENU_STYLE[selected]}`);
  });
  document.querySelectorAll(".day-card").forEach((card) => {
    const picked = state.choices[card.dataset.day];
    const status = card.querySelector(".day-status");
    if (picked === "ninguno") status.textContent = "⛔ día libre";
    else if (picked) status.textContent = "✅ elegido";
    else status.textContent = "falta elegir";
  });
}

/* ---------- Encuesta ---------- */

const surveyState = { repeat: new Set(), remove: new Set() };

function surveyChip(dish, question) {
  return `<button type="button" class="chip survey-chip" data-q="${question}" data-dish="${dish}">${dish}</button>`;
}

function renderSurvey(lastWeek, done) {
  const section = $("#survey-section");
  if (done) {
    section.innerHTML = `<h2 class="section-title">Encuesta rápida 📋</h2><div class="card"><strong>¡Gracias por responder! 🙏</strong><p class="muted" style="margin:4px 0 0">Tus respuestas de la semana que terminó ya fueron enviadas.</p></div>`;
    section.classList.remove("hidden");
    return;
  }
  if (!lastWeek.dishes.length) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  $("#survey-repeat").innerHTML = lastWeek.dishes.map((d) => surveyChip(d, "repeat")).join("");
  $("#survey-remove").innerHTML = lastWeek.dishes.map((d) => surveyChip(d, "remove")).join("");
  document.querySelectorAll(".survey-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const set = surveyState[chip.dataset.q];
      if (set.has(chip.dataset.dish)) {
        set.delete(chip.dataset.dish);
        chip.classList.remove("selected-survey");
      } else {
        set.add(chip.dataset.dish);
        chip.classList.add("selected-survey");
      }
    });
  });
  $("#survey-submit").onclick = async () => {
    const btn = $("#survey-submit");
    btn.disabled = true;
    btn.textContent = "Enviando…";
    try {
      await api("survey", {
        method: "POST",
        body: {
          code: session.code,
          employee: session.employeeId,
          pushEndpoint,
          week: state.data.lastWeek.key,
          repeat: [...surveyState.repeat],
          remove: [...surveyState.remove],
          ideas: $("#survey-ideas").value,
        },
      });
      renderSurvey(null, true);
      toast("¡Encuesta enviada, gracias! 🙏");
    } catch (err) {
      toast(err.message);
      btn.textContent = "Enviar encuesta";
      btn.disabled = false;
    }
  };
}

function updateSticky() {
  const count = Object.keys(state.choices).length;
  const total = state.data.week.days.length;
  const viandas = Object.values(state.choices).filter((m) => m && m !== "ninguno").length;
  $("#sticky-count").textContent = `${count} de ${total} días elegidos`;
  $("#sticky-total").textContent = viandas ? `${viandas} vianda${viandas === 1 ? "" : "s"}` : "Sin viandas todavía";
  $("#confirm-btn").disabled = count === 0;
}

async function loadEmployee() {
  const data = await api(`state?code=${session.code}&employee=${session.employeeId}`);
  state.data = data;
  state.choices = { ...data.choices };
  if (!await checkPush()) return;
  renderEmployee();
}

function renderEmployee() {
  const data = state.data;
  $("#hello-line").textContent = `¡Hola, ${data.employee.name.split(" ")[0]}!`;
  $("#week-title").textContent = `Armá tu semana del ${data.week.days[0].iso.slice(8)} al ${data.week.days[5].iso.slice(8)}`;
  $("#week-sub").textContent = "Elegí un menú por día (lunes a sábado): Potente 🍖, Equilibrado 🥘 o Light 🌿. Podés cambiarlo hasta el sábado a las 14:00; después, los días sin elección quedan con Equilibrado.";
  renderMenus(data.menus);
  renderSurvey(data.lastWeek, data.surveyDone);
  renderWeek(data.week, data.menus, data.dayMenus);
  updateSticky();
  $("#demo-btn")?.classList.toggle("hidden", data.employee.name.trim().toLowerCase().replace(/\s+/g, "") !== "usuariodeprueba");
  show("employee");
}

$("#confirm-btn")?.addEventListener("click", async () => {
  const btn = $("#confirm-btn");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await api("choices", {
      method: "POST",
      body: { code: session.code, employee: session.employeeId, pushEndpoint, week: state.data.week.key, choices: state.choices },
    });
    toast("¡Listo! Tu semana quedó guardada 🥘");
    btn.textContent = "✅ Semana confirmada";
    setTimeout(() => {
      btn.textContent = "Confirmar semana";
      updateSticky();
    }, 2200);
  } catch (err) {
    toast(err.message);
    btn.textContent = "Confirmar semana";
    updateSticky();
  }
});

/* ---------- Push ---------- */

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;

function pushIssue() {
  if (appleMobile && !standalone) return "En iPhone o iPad, agregá la página a la pantalla de inicio y abrila desde el ícono nuevo.";
  if (!("Notification" in window && "serviceWorker" in navigator && "PushManager" in window)) {
    return "Este navegador no admite notificaciones push. Abrí la app en Chrome o, en iPhone, instalala desde Safari.";
  }
  if (Notification.permission === "denied") {
    return "Las notificaciones están bloqueadas. Permitilas en la configuración del sitio o de la app y volvé a intentarlo.";
  }
  return "";
}

function showPush(message, disabled = false) {
  show("push");
  $("#push-status").textContent = message;
  $("#push-btn").disabled = disabled;
}

async function checkPush() {
  pushEndpoint = null;
  const issue = pushIssue();
  if (issue) {
    showPush(issue, appleMobile && !standalone || !("Notification" in window && "PushManager" in window));
    return false;
  }
  showPush("Comprobando las notificaciones de este dispositivo…", true);
  try {
    ({ publicKey: pushKey } = await api("push-public-key"));
    if (!pushKey) {
      showPush("Las notificaciones todavía no están configuradas. Avisale a quien administra la app.", true);
      return false;
    }
    if (Notification.permission === "granted") {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription && samePushKey(subscription, urlBase64ToUint8Array(pushKey)) && state.data.employee.reminderOptIn) {
        const result = await api("push-status", {
          method: "POST",
          body: { code: session.code, employee: session.employeeId, pushEndpoint: subscription.endpoint },
        });
        if (result.active) {
          pushEndpoint = subscription.endpoint;
          return true;
        }
      }
    }
    showPush("Tocá el botón y permití las notificaciones para continuar.");
  } catch (err) {
    if (session) showPush(err.message);
  }
  return false;
}

document.querySelectorAll("[data-install-guide]").forEach((button) => {
  button.addEventListener("click", () => $("#install-guide").showModal());
});

$("#push-btn").addEventListener("click", async () => {
  const btn = $("#push-btn");
  btn.disabled = true;
  try {
    const issue = pushIssue();
    if (issue) return showPush(issue);
    if (!pushKey) {
      if (await checkPush()) renderEmployee();
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return showPush(pushIssue() || "Permití las notificaciones para continuar.");
    }
    await navigator.serviceWorker.register("/sw.js");
    const reg = await navigator.serviceWorker.ready;
    const applicationServerKey = urlBase64ToUint8Array(pushKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !samePushKey(sub, applicationServerKey)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    await api("push-subscribe", {
      method: "POST",
      body: { code: session.code, employee: session.employeeId, subscription: sub, optIn: true },
    });
    state.data.employee.reminderOptIn = true;
    pushEndpoint = sub.endpoint;
    renderEmployee();
    toast("¡Notificaciones activadas! 🔔");
  } catch (err) {
    if (session) showPush(err.message);
  } finally {
    btn.disabled = false;
  }
});

function samePushKey(subscription, key) {
  const current = new Uint8Array(subscription.options?.applicationServerKey || []);
  return current.length === key.length && current.every((byte, i) => byte === key[i]);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentView === "employee" && Notification.permission !== "granted") {
    pushEndpoint = null;
    showPush(pushIssue() || "Volvé a activar las notificaciones para continuar.");
  }
});

/* ---------- Demo (solo usuariodeprueba) ---------- */

$("#demo-btn")?.addEventListener("click", async () => {
  const btn = $("#demo-btn");
  btn.disabled = true;
  try {
    const res = await api("demo-notify", {
      method: "POST",
      body: { code: session.code, employee: session.employeeId, pushEndpoint },
    });
    if (res.pushes > 0 && res.emailed) toast("Prueba enviada 🧪 Revisá la notificación y tu mail");
    else if (res.pushes > 0) toast("Notificación de prueba enviada. El email de prueba no se pudo enviar.");
    else if (res.emailed) toast("Email enviado. No se pudo entregar la notificación de prueba.");
    else toast("No se pudo enviar la prueba. Avisale a quien administra la app.");
  } catch (err) {
    toast(err.message);
  }
  btn.disabled = false;
});

/* ---------- Login con roster + PIN ---------- */

let roster = null;

$("#join-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const errEl = $("#join-error");
  errEl.classList.add("hidden");
  try {
    roster = await api(`roster?code=${String(form.get("code")).trim().toUpperCase()}`);
    roster.code = String(form.get("code")).trim().toUpperCase();
    const select = $("#login-select");
    select.innerHTML = roster.people
      .map((p) => `<option value="${p.id}">${p.name}${p.hasPin ? "" : " · primer ingreso"}</option>`)
      .join("");
    $("#login-company").textContent = `Empresa: ${roster.company}`;
    updatePinMode();
    show("login");
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

function selectedPerson() {
  return roster?.people.find((p) => p.id === $("#login-select").value) || null;
}

function updatePinMode() {
  const person = selectedPerson();
  const first = person ? !person.hasPin : false;
  $("#pin2-label").classList.toggle("hidden", !first);
  $("#login-pin2").required = first;
  $("#login-title").textContent = first ? `¡Hola, ${person?.name.split(" ")[0]}! Creá tu PIN` : "¿Quién sos?";
  $("#login-submit").textContent = first ? "Crear mi PIN e ingresar" : "Ingresar";
}

$("#login-select")?.addEventListener("change", updatePinMode);

$("#login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const errEl = $("#login-error");
  errEl.classList.add("hidden");
  const person = selectedPerson();
  if (!person) return;
  const pin = String(form.get("pin") || "");
  if (!/^\d{4}$/.test(pin)) {
    errEl.textContent = "El PIN debe tener 4 dígitos";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    let res;
    if (!person.hasPin) {
      const pin2 = String(form.get("pin2") || "");
      if (pin !== pin2) throw new Error("Los PIN no coinciden");
      res = await api("enroll", {
        method: "POST",
        body: { code: roster.code, employee: person.id, email: form.get("email"), pin },
      });
    } else {
      res = await api("login", {
        method: "POST",
        body: { code: roster.code, employee: person.id, email: form.get("email"), pin },
      });
    }
    localStorage.setItem(LS_EMPLOYEE, JSON.stringify({ code: roster.code, employeeId: person.id, name: person.name, token: res.token }));
    session = JSON.parse(localStorage.getItem(LS_EMPLOYEE));
    await loadEmployee();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

document.querySelectorAll("[data-switch-user]").forEach((button) => {
  button.addEventListener("click", () => {
    localStorage.removeItem(LS_EMPLOYEE);
    session = null;
    pushEndpoint = null;
    show("join");
  });
});

/* ---------- Admin ---------- */

function renderAdmin(data) {
  $("#admin-login").classList.add("hidden");
  $("#admin-panel").classList.remove("hidden");
  $("#admin-company-name").textContent = data.company.name;
  $("#admin-week-label").textContent = `Resumen para la ${data.week.label} · ${data.week.cycle === "A" ? "Semana 1" : "Semana 2"} del ciclo`;
  $("#admin-code").textContent = data.company.code;

  const head = `<tr><th>Día</th>${data.menus.map((m) => `<th class="num">${m.emoji} ${m.name}</th>`).join("")}<th class="num">⛔ No</th><th class="num">Total</th></tr>`;
  const rows = data.week.days
    .map((day) => {
      const c = data.counts[day.key];
      const total = Object.values(c).reduce((a, b) => a + b, 0);
      return `<tr><td>${DAY_LABELS[day.key]}</td>${data.menus.map((m) => `<td class="num">${c[m.id] || 0}</td>`).join("")}<td class="num">${c.ninguno || 0}</td><td class="num"><strong>${total}</strong></td></tr>`;
    })
    .join("");
  $("#counts-table").innerHTML = `<table>${head}${rows}</table>`;

  const peopleRows = data.people
    .map(
      (p) => `
      <tr>
        <td><strong>${p.name}</strong><br><span class="muted">${p.email}</span></td>
        <td>${p.completed ? '<span class="pill-ok">Semana lista</span>' : '<span class="pill-no">Falta elegir</span>'}</td>
        <td>${p.hasPin ? "✅" : "⏳"}</td>
        <td>${p.reminderOptIn ? "🔔" : "—"}</td>
        <td><button type="button" class="link-btn remove-emp" data-id="${p.id}">Quitar</button></td>
      </tr>`
    )
    .join("");
  $("#people-table").innerHTML = `<table><tr><th>Empleado</th><th>Estado</th><th>PIN</th><th>Recordatorio</th><th></th></tr>${peopleRows || '<tr><td colspan="5" class="muted">Todavía no sumaste gente. Cargá a tu equipo arriba.</td></tr>'}</table>`;
  document.querySelectorAll(".remove-emp").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Quitar a esta persona de la lista?")) return;
      try {
        await api("roster-remove", {
          method: "POST",
          body: { code: adminSession.code, key: adminSession.adminKey, employee: btn.dataset.id },
        });
        toast("Persona quitada");
        await loadAdmin();
      } catch (err) {
        toast(err.message);
      }
    });
  });

  const withSurvey = data.people.filter((p) => p.survey && (p.survey.repeat.length || p.survey.remove.length || p.survey.ideas));
  const surveyRows = withSurvey
    .map(
      (p) => `
      <tr>
        <td><strong>${p.name}</strong></td>
        <td>${p.survey.repeat.length ? `🙌 ${p.survey.repeat.join(" · ")}` : "—"}</td>
        <td>${p.survey.remove.length ? `🚫 ${p.survey.remove.join(" · ")}` : "—"}</td>
        <td>${p.survey.ideas || "—"}</td>
      </tr>`
    )
    .join("");
  $("#surveys-table").innerHTML = `<table><tr><th>Empleado</th><th>Que se repitan</th><th>Que dejen de estar</th><th>Nuevos</th></tr>${surveyRows || '<tr><td colspan="4" class="muted">Sin respuestas todavía.</td></tr>'}</table>`;

  $("#copy-summary").onclick = () => {
    const lines = [`🥘 Como en Casa · ${data.company.name}`, `Semana del ${data.week.days[0].iso} al ${data.week.days[5].iso} (${data.week.cycle === "A" ? "Semana 1" : "Semana 2"} del ciclo)`, ""];
    for (const day of data.week.days) {
      const c = data.counts[day.key];
      const parts = data.menus.filter((m) => c[m.id]).map((m) => `${c[m.id]} ${m.name}`);
      if (c.ninguno) parts.push(`${c.ninguno} sin vianda`);
      const total = Object.values(c).reduce((a, b) => a + b, 0);
      lines.push(`${DAY_LABELS[day.key]}: ${parts.length ? parts.join(" · ") : "sin pedidos"} (total ${total})`);
    }
    navigator.clipboard.writeText(lines.join("\n"));
    toast("Resumen copiado 📋");
  };
}

async function loadAdmin() {
  const data = await api(`summary?code=${adminSession.code}&key=${adminSession.adminKey}`);
  renderAdmin(data);
}

$("#add-employee-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    await api("roster-add", {
      method: "POST",
      body: { code: adminSession.code, key: adminSession.adminKey, name: form.get("name"), email: form.get("email") },
    });
    toast("Persona agregada ✅");
    e.target.reset();
    await loadAdmin();
  } catch (err) {
    toast(err.message);
  }
});

$("#create-company-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const errEl = $("#admin-error");
  errEl.classList.add("hidden");
  try {
    const res = await api("company", { method: "POST", body: { name: form.get("name") } });
    localStorage.setItem(LS_ADMIN, JSON.stringify({ code: res.code, adminKey: res.adminKey }));
    adminSession = JSON.parse(localStorage.getItem(LS_ADMIN));
    toast(`Empresa creada. Código: ${res.code}`);
    await loadAdmin();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

$("#admin-login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const errEl = $("#admin-error");
  errEl.classList.add("hidden");
  try {
    localStorage.setItem(LS_ADMIN, JSON.stringify({ code: form.get("code").trim().toUpperCase(), adminKey: form.get("key").trim() }));
    adminSession = JSON.parse(localStorage.getItem(LS_ADMIN));
    await loadAdmin();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

$("#copy-code")?.addEventListener("click", () => {
  navigator.clipboard.writeText($("#admin-code").textContent);
  toast("Código copiado 📋");
});

$("#admin-link")?.addEventListener("click", () => {
  show("admin");
  $("#admin-login").classList.toggle("hidden", Boolean(adminSession));
  $("#admin-panel").classList.toggle("hidden", !adminSession);
  if (adminSession) loadAdmin().catch(() => {});
});

/* ---------- Arranque ---------- */

(async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  if (window.location.hash === "#admin") {
    show("admin");
    $("#admin-login").classList.toggle("hidden", Boolean(adminSession));
    $("#admin-panel").classList.toggle("hidden", !adminSession);
    if (adminSession) loadAdmin().catch(() => {});
    return;
  }
  if (session) {
    try {
      await loadEmployee();
      return;
    } catch {
      localStorage.removeItem(LS_EMPLOYEE);
    }
  }
  show("join");
})();
