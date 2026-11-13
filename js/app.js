const API = "/api";
const DAY_LABELS = { mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado" };
const MENU_STYLE = { potente: "potente", equilibrado: "equilibrado", light: "light", ninguno: "ninguno" };

const LS_EMPLOYEE = "cec_empresas_employee";
const LS_ADMIN = "cec_empresas_admin";

const $ = (sel) => document.querySelector(sel);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const state = { data: null, choices: {}, saved: {}, editing: true };
const MENU_DOT = { potente: "#b5451f", equilibrado: "#7a8b5a", light: "#4e7d5b", ninguno: "#8a7a66" };
const sameChoices = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};
const isDirty = () => !sameChoices(state.choices, state.saved);
const buzz = () => { try { navigator.vibrate?.(12); } catch {} };
const fmtDateTime = (iso) => new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso));

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
    const view = roster ? "login" : "join";
    const error = $(`#${view}-error`);
    error.textContent = body.error || "Tu sesión venció. Ingresá de nuevo.";
    error.classList.remove("hidden");
    show(view);
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
  $("#sticky-bar").classList.toggle("hidden", view !== "employee" || !state.editing || Boolean(state.data?.locked));
  $("#loader")?.classList.add("hidden");
  $("#user-chip")?.classList.toggle("hidden", !(session && view === "employee"));
  $("#saturday-banner").classList.toggle("hidden", view !== "employee" || !isSaturday());
}

function isSaturday() {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short" }).format(new Date()) === "Sat";
}

/* ---------- Empleado ---------- */

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
      if (state.data?.locked) return;
      if (state.choices[day] === menu) delete state.choices[day];
      else state.choices[day] = menu;
      buzz();
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
    card.classList.toggle("is-picked", Boolean(picked));
    card.classList.toggle("is-changed", (state.saved[card.dataset.day] || "") !== (picked || "") && Boolean(state.data?.submittedAt));
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
  const submitted = Boolean(state.data.submittedAt);
  const dirty = isDirty();
  $("#sticky-count").textContent = `${count} de ${total} días elegidos`;
  $("#sticky-total").textContent = viandas ? `${viandas} vianda${viandas === 1 ? "" : "s"}` : "Sin viandas todavía";
  $("#sticky-progress-fill").style.width = `${Math.round((count / total) * 100)}%`;
  $("#confirm-btn").textContent = submitted ? "Guardar cambios" : "Enviar pedido";
  $("#confirm-btn").disabled = count === 0 || (submitted && !dirty);
  $("#cancel-edit-btn").classList.toggle("hidden", !submitted);
  $("#dirty-flag").classList.toggle("hidden", !(submitted && dirty));
}

/* ---------- Pedido enviado / modificar ---------- */

function deadlineText() {
  const { deadline, locked } = state.data;
  if (!deadline) return "";
  if (locked) return "🔒 La elección de esta semana ya cerró";
  const ms = Date.parse(deadline) - Date.now();
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  const rest = h % 24;
  const m = Math.max(1, Math.floor((ms % 3600000) / 60000));
  const left = d > 0 ? `${d} d ${rest} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
  return `⏳ Cierra el sábado 14:00 · faltan ${left}`;
}

function paintDeadline() {
  const chip = $("#deadline-chip");
  if (!state.data) return;
  chip.textContent = deadlineText();
  chip.classList.toggle("hidden", !chip.textContent);
  chip.classList.toggle("urgent", !state.data.locked && Date.parse(state.data.deadline) - Date.now() < 6 * 3600000);
  chip.classList.toggle("closed", Boolean(state.data.locked));
}
setInterval(paintDeadline, 60000);

function renderSummary() {
  const data = state.data;
  const box = $("#order-summary");
  const rows = data.week.days.map((day) => {
    const menu = state.saved[day.key];
    const meta = data.menus.find((m) => m.id === menu);
    const dish = menu === "ninguno" ? "Sin vianda" : meta ? data.dayMenus[day.key][menu] : "Sin elegir · queda Equilibrado al cierre";
    const tag = menu === "ninguno" ? "Día libre" : meta ? `${meta.emoji} ${meta.name}` : "—";
    return `<li class="summary-row${meta ? "" : " empty"}">
      <span class="summary-dot" style="background:${MENU_DOT[menu] || "#d9ccb4"}"></span>
      <span class="summary-day">${DAY_LABELS[day.key]} <span class="muted">${Number(day.iso.slice(8))}</span></span>
      <span class="summary-dish"><span class="summary-tag">${tag}</span>${escapeHtml(dish)}</span>
    </li>`;
  }).join("");
  const viandas = Object.values(state.saved).filter((m) => m && m !== "ninguno").length;
  box.innerHTML = `
    <div class="card order-card ${data.locked ? "locked" : ""}">
      <div class="order-head">
        <div class="order-status">
          <span class="order-check">${data.locked ? "🔒" : "✓"}</span>
          <div>
            <strong>${data.locked ? "Pedido cerrado" : "Pedido enviado"}</strong>
            <span class="muted">Enviado el ${fmtDateTime(data.submittedAt)}</span>
          </div>
        </div>
        ${data.locked ? "" : '<button id="edit-order-btn" class="btn btn-outline btn-sm" type="button">✏️ ¿Querés modificar?</button>'}
      </div>
      <ul class="summary-list">${rows}</ul>
      <div class="order-foot">
        <span><strong>${viandas}</strong> vianda${viandas === 1 ? "" : "s"} para la ${escapeHtml(data.week.label)}</span>
        <span class="muted">${data.locked ? "Ya no se puede modificar." : "Podés cambiarlo hasta el sábado 14:00."}</span>
      </div>
    </div>`;
  $("#edit-order-btn")?.addEventListener("click", () => setEditing(true, true));
}

function setEditing(editing, scroll = false) {
  state.editing = editing && !state.data.locked;
  const submitted = Boolean(state.data.submittedAt);
  $("#order-summary").classList.toggle("hidden", state.editing || !submitted);
  $("#week-editor").classList.toggle("hidden", !state.editing);
  if (!state.editing && submitted) renderSummary();
  $("#week-title").textContent = state.editing
    ? (submitted ? "Modificá tu pedido" : `Armá tu semana del ${Number(state.data.week.days[0].iso.slice(8))} al ${Number(state.data.week.days[5].iso.slice(8))}`)
    : "Tu pedido de la semana";
  $("#week-sub").textContent = state.editing
    ? "Elegí un menú por día, de lunes a sábado. Los días que no elijas quedan con Equilibrado al cierre."
    : `Semana del ${Number(state.data.week.days[0].iso.slice(8))} al ${Number(state.data.week.days[5].iso.slice(8))}. Te mandamos el resumen por mail.`;
  $("#sticky-bar").classList.toggle("hidden", currentView !== "employee" || !state.editing);
  updateSticky();
  paintChips();
  if (scroll) (state.editing ? $("#week-editor") : $("#app")).scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#cancel-edit-btn").addEventListener("click", () => {
  if (isDirty() && !confirm("¿Descartar los cambios que hiciste?")) return;
  state.choices = { ...state.saved };
  setEditing(false, true);
});

document.querySelectorAll("[data-fill]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (state.data?.locked) return;
    const menu = btn.dataset.fill;
    state.choices = {};
    if (menu) for (const day of state.data.week.days) state.choices[day.key] = menu;
    buzz();
    paintChips();
    updateSticky();
  });
});

window.addEventListener("beforeunload", (e) => {
  if (currentView === "employee" && state.editing && state.data?.submittedAt && isDirty()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function loadEmployee() {
  const data = await api(`state?code=${session.code}&employee=${session.employeeId}`);
  state.data = data;
  state.choices = { ...data.choices };
  state.saved = { ...data.choices };
  state.editing = !data.submittedAt && !data.locked;
  if (!await checkPush()) return;
  renderEmployee();
}

function renderEmployee() {
  const data = state.data;
  const first = data.employee.name.split(" ")[0];
  $("#hello-line").textContent = `¡Hola, ${first}!`;
  $("#user-chip").textContent = data.employee.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  $("#user-chip").title = data.employee.name;
  renderSurvey(data.lastWeek, data.surveyDone);
  renderWeek(data.week, data.menus, data.dayMenus);
  $("#demo-btn")?.classList.toggle("hidden", data.employee.name.trim().toLowerCase().replace(/\s+/g, "") !== "usuariodeprueba");
  show("employee");
  setEditing(state.editing);
  if (data.locked && !data.submittedAt) {
    $("#order-summary").classList.remove("hidden");
    $("#order-summary").innerHTML = '<div class="card order-card locked"><strong>🔒 La elección de esta semana ya cerró</strong><p class="muted" style="margin:6px 0 0">Los días sin elegir quedaron con el menú Equilibrado.</p></div>';
    $("#week-editor").classList.add("hidden");
  }
  paintDeadline();
}

$("#confirm-btn")?.addEventListener("click", async () => {
  const btn = $("#confirm-btn");
  const missing = state.data.week.days.filter((d) => !state.choices[d.key]).length;
  if (missing && !confirm(`Te ${missing === 1 ? "falta 1 día" : `faltan ${missing} días`}. Si no los elegís, quedan con el menú Equilibrado. ¿Enviar igual?`)) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Enviando…";
  try {
    const res = await api("choices", {
      method: "POST",
      body: { code: session.code, employee: session.employeeId, pushEndpoint, week: state.data.week.key, choices: state.choices },
    });
    state.choices = { ...res.choices };
    state.saved = { ...res.choices };
    state.data.choices = { ...res.choices };
    state.data.submittedAt = res.updatedAt;
    setEditing(false, true);
    toast(res.modified ? "Pedido actualizado ✏️" : "¡Pedido enviado! 🥘");
  } catch (err) {
    toast(err.message);
    btn.textContent = label;
    updateSticky();
    if (/cerró|cambió/.test(err.message)) setTimeout(() => loadEmployee().catch(() => {}), 1500);
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
const android = /Android/i.test(navigator.userAgent);
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

function isPushServiceError(error) {
  return /registration failed\s*-\s*push service error/i.test(error?.message || "");
}

async function subscribeToPush(manager, applicationServerKey) {
  const options = { userVisibleOnly: true, applicationServerKey };
  try {
    return await manager.subscribe(options);
  } catch (error) {
    if (!android || !isPushServiceError(error)) throw error;
    $("#push-status").textContent = "Volviendo a intentar activar las notificaciones…";
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const existing = await manager.getSubscription();
    if (existing && samePushKey(existing, applicationServerKey)) return existing;
    return manager.subscribe(options);
  }
}

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
    $("#push-status").textContent = "Activando las notificaciones…";
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
    sub ||= await subscribeToPush(reg.pushManager, applicationServerKey);
    await api("push-subscribe", {
      method: "POST",
      body: { code: session.code, employee: session.employeeId, subscription: sub, optIn: true },
    });
    state.data.employee.reminderOptIn = true;
    pushEndpoint = sub.endpoint;
    renderEmployee();
    toast("¡Notificaciones activadas! 🔔");
  } catch (err) {
    if (session) showPush(isPushServiceError(err)
      ? "El servicio de notificaciones no respondió. Tocá Activar notificaciones para reintentar. Si sigue pasando, cerrá la app y volvé a abrirla."
      : err.message);
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
    else if (res.pushes > 0) toast("Notificación de prueba enviada. El correo de prueba no se envió.");
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
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.hasPin ? "" : " · primer ingreso"}</option>`)
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
  const button = $("#login-submit");
  button.disabled = true;
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
    person.hasPin = true;
    updatePinMode();
    localStorage.setItem(LS_EMPLOYEE, JSON.stringify({ code: roster.code, employeeId: person.id, name: person.name, token: res.token }));
    session = JSON.parse(localStorage.getItem(LS_EMPLOYEE));
    await loadEmployee();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll("[data-switch-user]").forEach((button) => {
  button.addEventListener("click", () => {
    if (currentView === "employee" && state.editing && state.data?.submittedAt && isDirty() && !confirm("Tenés cambios sin guardar. ¿Salir igual?")) return;
    localStorage.removeItem(LS_EMPLOYEE);
    session = null;
    pushEndpoint = null;
    state.data = null;
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
  const done = data.people.filter((p) => p.submittedAt).length;
  const totalPeople = data.people.length;
  const pct = totalPeople ? Math.round((done / totalPeople) * 100) : 0;
  const totalViandas = Object.values(data.counts).reduce((acc, c) => acc + Object.entries(c).filter(([k]) => k !== "ninguno").reduce((a, [, v]) => a + v, 0), 0);
  $("#admin-progress").innerHTML = `
    <div class="stats">
      <div class="stat"><span class="stat-num">${done}/${totalPeople}</span><span class="muted">enviaron su pedido</span></div>
      <div class="stat"><span class="stat-num">${totalViandas}</span><span class="muted">viandas pedidas</span></div>
      <div class="stat"><span class="stat-num ${data.locked ? "" : "accent"}">${data.locked ? "Cerrado" : "Abierto"}</span><span class="muted">cierre sáb 14:00</span></div>
    </div>
    <div class="bar"><span style="width:${pct}%"></span></div>
    ${!data.locked && done < totalPeople ? `<button id="remind-btn" class="btn btn-outline btn-sm" type="button">🔔 Recordar a los ${totalPeople - done} que faltan</button>` : ""}`;
  $("#remind-btn")?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    if (!confirm("¿Mandar un recordatorio (notificación y mail) a quienes no enviaron su pedido?")) return;
    b.disabled = true;
    try {
      const r = await api("admin-remind", { method: "POST", body: { code: adminSession.code, key: adminSession.adminKey } });
      toast(`Recordatorio enviado a ${r.reminded} persona${r.reminded === 1 ? "" : "s"} 🔔`);
    } catch (err) { toast(err.message); }
    b.disabled = false;
  });

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
        <td><strong>${escapeHtml(p.name)}</strong><br><span class="muted">${escapeHtml(p.email) || "Correo pendiente"}</span></td>
        <td>${p.submittedAt ? `<span class="pill-ok">Enviado</span><br><span class="muted small">${fmtDateTime(p.submittedAt)}</span>` : '<span class="pill-no">Falta elegir</span>'}</td>
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
        <td><strong>${escapeHtml(p.name)}</strong></td>
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

function openAdmin() {
  show("admin");
  $("#admin-panel").classList.add("hidden");
  $("#admin-login").classList.toggle("hidden", Boolean(adminSession));
  if (!adminSession) return;
  loadAdmin().catch((err) => {
    $("#admin-login").classList.remove("hidden");
    $("#admin-error").textContent = err.message;
    $("#admin-error").classList.remove("hidden");
  });
}

$("#import-employees-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const button = form.querySelector("button");
  const status = $("#import-employees-status");
  const names = form.elements.names.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  button.disabled = true;
  status.textContent = "Cargando la lista…";
  try {
    const { added, skipped } = await api("roster-import", {
      method: "POST",
      body: { code: adminSession.code, key: adminSession.adminKey, names },
    });
    status.textContent = `Personas agregadas: ${added}. Nombres repetidos o ya cargados: ${skipped}.`;
    form.reset();
    await loadAdmin();
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

$("#add-employee-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    await api("roster-add", {
      method: "POST",
      body: { code: adminSession.code, key: adminSession.adminKey, name: form.get("name") },
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

$("#admin-link")?.addEventListener("click", openAdmin);

/* ---------- Arranque ---------- */

(async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  if (window.location.hash === "#admin") {
    openAdmin();
    return;
  }
  if (session) {
    try {
      await loadEmployee();
      return;
    } catch (err) {
      const error = $("#join-error");
      error.textContent = err.message;
      error.classList.remove("hidden");
    }
  }
  show("join");
})();
