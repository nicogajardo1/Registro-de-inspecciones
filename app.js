/* =========================================================
   VARIABLES GLOBALES Y CONFIGURACIÓN
   ========================================================= */
let DB = null;
let FORMS = [];
let ACTIVE_FORM_ID = null;
let MULTIPLICADOR = 1;

const TIPOS = {
  texto: "Texto Corto",
  area_texto: "Texto Largo",
  numero: "Número",
  seleccion_unica: "Opción Única",
  seleccion_multiple: "Opción Múltiple",
  fecha: "Fecha",
  hora: "Hora"
};

/* =========================================================
   UTILIDADES
   ========================================================= */
function uuid() {
  return 'x4xxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const container = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function showConfirm(message, title = "Confirmar") {
  return new Promise((resolve) => {
    const ok = window.confirm(`${title}\n\n${message}`);
    resolve(ok);
  });
}

function getConditions(q) {
  if (Array.isArray(q.conditions)) return q.conditions;
  if (q.conditionQid) {
    return [{ qid: q.conditionQid, value: q.conditionValue || "" }];
  }
  return [];
}

/* =========================================================
   BASE DE DATOS LOCAL (IndexedDB)
   ========================================================= */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("AppFormsDB", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("config")) db.createObjectStore("config");
      if (!db.objectStoreNames.contains("responses")) db.createObjectStore("responses", { autoIncrement: true });
    };
    req.onsuccess = (e) => { DB = e.target.result; resolve(DB); };
    req.onerror = (e) => reject(e);
  });
}

async function loadConfig() {
  return new Promise((resolve) => {
    const tx = DB.transaction("config", "readonly");
    const store = tx.objectStore("config");
    const req = store.get("forms_config");
    req.onsuccess = () => {
      FORMS = req.result || [];
      resolve(FORMS);
    };
    req.onerror = () => resolve([]);
  });
}

async function persistForms() {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction("config", "readwrite");
    const store = tx.objectStore("config");
    const req = store.put(FORMS, "forms_config");
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e);
  });
}

/* =========================================================
   INTERFAZ Y NAVEGACIÓN
   ========================================================= */
function updateStatusPill() {
  const pill = document.getElementById("statusPill");
  if (navigator.onLine) {
    pill.textContent = "En línea";
    pill.className = "pill-badge status-online";
  } else {
    pill.textContent = "Sin conexión";
    pill.className = "pill-badge status-offline";
  }
}

function goHome() {
  ACTIVE_FORM_ID = null;
  MULTIPLICADOR = 1;
  document.getElementById("multiplicadorLabel").style.display = "none";
  document.getElementById("topTitle").textContent = "Formularios";
  document.getElementById("viewForm").classList.remove("active");
  document.getElementById("viewHome").classList.add("active");
  renderHome();
}

function renderHome() {
  const grid = document.getElementById("formsList");
  grid.innerHTML = "";

  if (FORMS.length === 0) {
    grid.innerHTML = `<p style="grid-column: 1/-1; color: var(--ink-soft);">No hay formularios creados. Haz clic en <strong>+ Crear Formulario</strong>.</p>`;
    return;
  }

  FORMS.forEach(f => {
    const card = document.createElement("div");
    card.className = "form-card";
    card.innerHTML = `
      <h3>${escapeHtml(f.name)}</h3>
      <p style="font-size: 12px; color: var(--ink-soft); margin-top: 4px;">${f.questions ? f.questions.length : 0} Preguntas</p>
      <div style="margin-top: 12px; display: flex; gap: 8px;">
        <button class="btn btn-sm btn-secondary" onclick="openForm('${f.id}')">Abrir</button>
        <button class="btn btn-sm btn-ghost" onclick="openBuilder('${f.id}')">Editar</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function openForm(formId) {
  const f = FORMS.find(x => x.id === formId);
  if (!f) return;
  ACTIVE_FORM_ID = formId;
  document.getElementById("topTitle").textContent = f.name;
  document.getElementById("viewHome").classList.remove("active");
  document.getElementById("viewForm").classList.add("active");
  renderForm();
}

function renderForm() {
  const f = FORMS.find(x => x.id === ACTIVE_FORM_ID);
  if (!f) return;
  const container = document.getElementById("questionsContainer");
  container.innerHTML = "";

  (f.questions || []).forEach(q => {
    const fieldWrap = document.createElement("div");
    fieldWrap.className = "input-field";
    fieldWrap.dataset.qid = q.id;

    let html = `<label>${escapeHtml(q.label)} ${q.required ? '<span style="color:var(--err)">*</span>' : ''}</label>`;

    if (q.type === "texto") {
      html += `<input type="text" data-q="${q.id}" placeholder="${escapeHtml(q.placeholder || '')}">`;
    } else if (q.type === "area_texto") {
      html += `<textarea data-q="${q.id}" placeholder="${escapeHtml(q.placeholder || '')}"></textarea>`;
    } else if (q.type === "numero") {
      html += `<input type="number" data-q="${q.id}">`;
    } else if (q.type === "fecha") {
      html += `<input type="date" data-q="${q.id}">`;
    } else if (q.type === "hora") {
      html += `<input type="time" data-q="${q.id}">`;
    }

    fieldWrap.innerHTML = html;
    container.appendChild(fieldWrap);
  });
}

function resetForm() {
  document.getElementById("dynamicForm").reset();
}

/* =========================================================
   SINCRONIZACIÓN CON GOOGLE SHEETS
   ========================================================= */
async function trySync() {
  refreshTicker();
}

function refreshTicker() {
  const text = document.getElementById("tickerText");
  if (navigator.onLine) {
    text.textContent = "Listo para enviar registros nuevos.";
  } else {
    text.textContent = "Sin conexión a internet. Los datos se guardarán localmente.";
  }
}

async function subirConfigAServidor() {}
async function bajarConfigDelServidorSiHayVersionNueva() {}

/* =========================================================
   EVENTOS PRINCIPALES
   ========================================================= */
document.getElementById("btnHome").addEventListener("click", goHome);
document.getElementById("btnBackHome").addEventListener("click", goHome);
document.getElementById("btnNewForm").addEventListener("click", () => {
  const newId = uuid();
  FORMS.push({
    id: newId,
    name: "Nuevo Formulario",
    webAppUrl: "",
    sheetName: "",
    questions: []
  });
  openBuilder(newId);
});

document.getElementById("btnMultiply").addEventListener("click", () => {
  document.getElementById("multiplicarModal").classList.add("show");
});

document.getElementById("btnCancelMultiply").addEventListener("click", () => {
  document.getElementById("multiplicarModal").classList.remove("show");
});

document.getElementById("btnApplyMultiply").addEventListener("click", async () => {
  const nuevo = parseInt(document.getElementById("inputMultiplicador").value, 10);
  if (nuevo >= 1) {
    if (MULTIPLICADOR > 1) {
      const ok = await showConfirm(
        "Al cambiar la cantidad de repeticiones se reiniciará el formulario actual. ¿Deseas continuar?",
        "Cambiar repeticiones"
      );
      if (!ok) return;
    }
    MULTIPLICADOR = nuevo;
    const label = document.getElementById("multiplicadorLabel");
    label.textContent = "x" + MULTIPLICADOR;
    label.style.display = MULTIPLICADOR > 1 ? "inline-block" : "none";
    renderForm();
    resetForm();
  }
  document.getElementById("multiplicarModal").classList.remove("show");
});

document.getElementById("btnCancelForm").addEventListener("click", goHome);
document.getElementById("btnSyncNow").addEventListener("click", trySync);

/* =========================================================
   BUILDER (Editor visual de formularios)
   ========================================================= */
let builderFormId = null;
let builderQuestions = [];

function openBuilder(formId) {
  builderFormId = formId;
  const f = FORMS.find(x => x.id === formId);
  if (!f) return;

  document.getElementById("bf_name").value = f.name || "";
  document.getElementById("bf_url").value = f.webAppUrl || "";
  document.getElementById("bf_sheet").value = f.sheetName || "";
  builderQuestions = JSON.parse(JSON.stringify(f.questions || []));

  renderBuilderQuestions();
  document.getElementById("builderModal").classList.add("show");
}

function closeBuilder() {
  document.getElementById("builderModal").classList.remove("show");
  builderFormId = null;
  builderQuestions = [];
}

document.getElementById("btnCloseBuilder").addEventListener("click", closeBuilder);

document.getElementById("btnTestUrl").addEventListener("click", async () => {
  const url = document.getElementById("bf_url").value.trim();
  if (!url) { showToast("Ingresa una URL primero"); return; }
  try {
    const res = await fetch(url);
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch(e){}
    if (parsed && parsed.status === "ok") {
      showToast("Conexión exitosa con " + (parsed.planilla || "Google Sheets"));
    } else {
      showToast("La URL respondió pero no con el formato esperado.");
    }
  } catch(err) {
    showToast("Error al conectar. Verifica la URL y tus permisos.");
  }
});

function renderBuilderQuestions() {
  const wrap = document.getElementById("builderList");
  wrap.innerHTML = "";

  builderQuestions.forEach((q, idx) => {
    const card = document.createElement("div");
    card.className = "qcard";

    const isChoice = q.type === "seleccion_unica" || q.type === "seleccion_multiple";

    let typesHtml = "";
    Object.entries(TIPOS).forEach(([k, v]) => {
      typesHtml += `<option value="${k}" ${q.type === k ? "selected" : ""}>${v}</option>`;
    });

    const isFirst = idx === 0;
    const isLast = idx === builderQuestions.length - 1;

    card.innerHTML = `
      <div class="qcard-head">
        <span style="font-size:12px; font-weight:700; color:var(--ink-soft);">Pregunta ${idx + 1}</span>
        <div class="order-btns">
          <button data-bact="up" data-idx="${idx}" ${isFirst ? "disabled style='opacity:0.3;'" : ""}>↑</button>
          <button data-bact="down" data-idx="${idx}" ${isLast ? "disabled style='opacity:0.3;'" : ""}>↓</button>
          <button class="del-btn" data-bact="del" data-idx="${idx}" title="Eliminar pregunta">🗑</button>
        </div>
      </div>

      <div class="qrow2">
        <div>
          <label>Título / Etiqueta</label>
          <input type="text" data-bfield="label" data-idx="${idx}" value="${escapeHtml(q.label || "")}">
        </div>
        <div>
          <label>Nombre de Columna en Sheet</label>
          <input type="text" data-bfield="column" data-idx="${idx}" value="${escapeHtml(q.column || "")}" placeholder="Mismo que el título">
        </div>
      </div>

      <div class="qrow2" style="margin-top:10px;">
        <div>
          <label>Tipo de campo</label>
          <select data-bfield="type" data-idx="${idx}">${typesHtml}</select>
        </div>
        <div>
          <label>Placeholder <span class="opt">(opcional)</span></label>
          <input type="text" data-bfield="placeholder" data-idx="${idx}" value="${escapeHtml(q.placeholder || "")}">
        </div>
      </div>

      <div class="qcheck">
        <input type="checkbox" id="bq_req_${idx}" data-bfield="required" data-idx="${idx}" ${q.required ? "checked" : ""}>
        <label for="bq_req_${idx}" style="margin:0;">Respuesta obligatoria</label>
      </div>

      <div class="options-block" style="display:${isChoice ? "block" : "none"}; margin-top:14px; padding-top:10px; border-top:1px dashed #d4d2ca;">
        <label>Alternativas <span class="opt">(una por línea)</span></label>
        <textarea data-bfield="optionsRaw" data-idx="${idx}">${escapeHtml(q.optionsRaw || "")}</textarea>
        
        <div class="qcheck">
          <input type="checkbox" id="bq_other_${idx}" data-bfield="allowOther" data-idx="${idx}" ${q.allowOther ? "checked" : ""}>
          <label for="bq_other_${idx}" style="margin:0;">Permitir opción "Otro..."</label>
        </div>
      </div>

      ${renderConditionsBuilder(q, idx)}
    `;

    wrap.appendChild(card);
  });
}

function renderConditionsBuilder(q, idx) {
  const otherQuestions = builderQuestions.filter((_, i) => i !== idx);
  if (otherQuestions.length === 0) return "";

  const conditions = getConditions(q);
  const logic = q.conditionLogic || "AND";

  let condsHtml = "";
  conditions.forEach((c, cIdx) => {
    let optsControllers = `<option value="">-- Sin condición --</option>`;
    otherQuestions.forEach(oq => {
      optsControllers += `<option value="${oq.id}" ${c.qid === oq.id ? "selected" : ""}>${escapeHtml(oq.label || "Sin título")}</option>`;
    });

    condsHtml += `
      <div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
        <select style="flex:1;" data-cond-qid="${cIdx}" data-qidx="${idx}">${optsControllers}</select>
        <span style="font-size:12px;">sea igual a:</span>
        <input type="text" style="flex:1;" data-cond-val="${cIdx}" data-qidx="${idx}" value="${escapeHtml(c.value || "")}" placeholder="Valor exacto">
        <button style="background:none; border:none; color:var(--err); cursor:pointer;" data-cond-del="${cIdx}" data-qidx="${idx}">✕</button>
      </div>
    `;
  });

  return `
    <div style="margin-top:14px; padding-top:10px; border-top:1px dashed #d4d2ca;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <label style="margin:0;">Visibilidad condicional</label>
        <button class="btn btn-ghost" style="width:auto; min-height:28px; padding:2px 8px; font-size:11px;" data-bact="addCond" data-idx="${idx}">+ Regla</button>
      </div>
      ${conditions.length > 1 ? `
        <div style="margin-top:8px; font-size:12px; display:flex; align-items:center; gap:8px;">
          <span>Mostrar si cumple:</span>
          <select data-bfield="conditionLogic" data-idx="${idx}" style="width:auto; min-height:30px; padding:2px 8px; font-size:12px;">
            <option value="AND" ${logic === "AND" ? "selected" : ""}>TODAS las condiciones (AND)</option>
            <option value="OR" ${logic === "OR" ? "selected" : ""}>AL MENOS UNA condición (OR)</option>
          </select>
        </div>
      ` : ""}
      ${condsHtml}
    </div>
  `;
}

document.getElementById("builderList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-bact]");
  const condDel = e.target.closest("[data-cond-del]");

  if (condDel) {
    const qIdx = parseInt(condDel.dataset.qidx, 10);
    const cIdx = parseInt(condDel.dataset.condDel, 10);
    const q = builderQuestions[qIdx];
    let conds = getConditions(q);
    conds.splice(cIdx, 1);
    q.conditions = conds;
    delete q.conditionQid;
    delete q.conditionValue;
    renderBuilderQuestions();
    return;
  }

  if (!btn) return;
  const act = btn.dataset.bact;
  const idx = parseInt(btn.dataset.idx, 10);

  if (act === "del") {
    builderQuestions.splice(idx, 1);
    renderBuilderQuestions();
  } else if (act === "up" && idx > 0) {
    const temp = builderQuestions[idx];
    builderQuestions[idx] = builderQuestions[idx - 1];
    builderQuestions[idx - 1] = temp;
    renderBuilderQuestions();
  } else if (act === "down" && idx < builderQuestions.length - 1) {
    const temp = builderQuestions[idx];
    builderQuestions[idx] = builderQuestions[idx + 1];
    builderQuestions[idx + 1] = temp;
    renderBuilderQuestions();
  } else if (act === "addCond") {
    const q = builderQuestions[idx];
    let conds = getConditions(q);
    conds.push({ qid: "", value: "" });
    q.conditions = conds;
    delete q.conditionQid;
    delete q.conditionValue;
    renderBuilderQuestions();
  }
});

document.getElementById("builderList").addEventListener("input", (e) => {
  const field = e.target.dataset.bfield;
  const idx = e.target.dataset.idx;

  if (field && idx !== undefined) {
    const q = builderQuestions[idx];
    if (e.target.type === "checkbox") {
      q[field] = e.target.checked;
    } else {
      q[field] = e.target.value;
    }
    if (field === "type") {
      renderBuilderQuestions();
    }
    return;
  }

  const condQid = e.target.dataset.condQid;
  const condVal = e.target.dataset.condVal;
  const qIdx = e.target.dataset.qidx;

  if (qIdx !== undefined) {
    const q = builderQuestions[qIdx];
    let conds = getConditions(q);
    if (condQid !== undefined) {
      conds[condQid].qid = e.target.value;
    } else if (condVal !== undefined) {
      conds[condVal].value = e.target.value;
    }
    q.conditions = conds;
    delete q.conditionQid;
    delete q.conditionValue;
  }
});

document.getElementById("btnAddQuestion").addEventListener("click", () => {
  builderQuestions.push({
    id: uuid(),
    label: "Nueva pregunta",
    type: "texto",
    required: false,
    column: ""
  });
  renderBuilderQuestions();
  const wrap = document.getElementById("builderList");
  wrap.lastElementChild?.scrollIntoView({ behavior: "smooth" });
});

document.getElementById("btnSaveBuilder").addEventListener("click", async () => {
  const name = document.getElementById("bf_name").value.trim();
  const url = document.getElementById("bf_url").value.trim();
  const sheet = document.getElementById("bf_sheet").value.trim();

  if (!name) { showToast("Escribe un nombre para el formulario"); return; }
  if (builderQuestions.length === 0) { showToast("Agrega al menos una pregunta"); return; }

  builderQuestions.forEach(q => {
    if (!q.column) q.column = q.label;
    if (q.type !== "seleccion_unica" && q.type !== "seleccion_multiple") {
      delete q.optionsRaw;
      delete q.allowOther;
      delete q.saveOtherAsOption;
    }
  });

  const f = FORMS.find(x => x.id === builderFormId);
  if (f) {
    f.name = name;
    f.webAppUrl = url;
    f.sheetName = sheet;
    f.questions = builderQuestions;
  }

  await persistForms();
  await subirConfigAServidor();
  closeBuilder();

  if (ACTIVE_FORM_ID === builderFormId) {
    document.getElementById("topTitle").textContent = name;
    renderForm();
    resetForm();
  } else {
    renderHome();
  }

  showToast("Formulario guardado ✓");
});

/* =========================================================
   INICIALIZACIÓN DE LA APLICACIÓN
   ========================================================= */
window.addEventListener("DOMContentLoaded", async () => {
  try {
    await openDB();
    await loadConfig();
    renderHome();
    refreshTicker();
    updateStatusPill();

    if (navigator.onLine) {
      trySync();
      bajarConfigDelServidorSiHayVersionNueva();
    }
  } catch(e) {
    console.error("Error al inicializar la aplicación:", e);
    showToast("Ocurrió un error al cargar la base de datos local.");
  }
});

window.addEventListener("online", () => {
  updateStatusPill();
  trySync();
  bajarConfigDelServidorSiHayVersionNueva();
});

window.addEventListener("offline", () => {
  updateStatusPill();
});