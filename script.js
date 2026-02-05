// =========================
// Firebase (v10 modular)
// =========================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  runTransaction,
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// ====== CONFIG (as tuas chaves) ======
const firebaseConfig = {
  apiKey: "AIzaSyCs9f8SeZQ-H2aSYm695q2RW1gGPtEUoJA",
  authDomain: "agenda-cce.firebaseapp.com",
  projectId: "agenda-cce",
  storageBucket: "agenda-cce.firebasestorage.app",
  messagingSenderId: "405095335038",
  appId: "1:405095335038:web:cb064572b272f95850c42f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// =========================
// DOM
// =========================
const calendario = document.getElementById("calendario");
const selectAno = document.getElementById("ano");
const selectMes = document.getElementById("mes"); // (pode existir, mas deixa de ser usado)

const overlay = document.getElementById("overlay");
const modalData = document.getElementById("modalData");
const listaEventos = document.getElementById("listaEventos");

const btnFechar = document.getElementById("btnFechar");
const btnCancelar = document.getElementById("btnCancelar");
const btnAdicionarEvento = document.getElementById("btnAdicionarEvento");
const btnGuardarDia = document.getElementById("btnGuardarDia");
const btnApagarDia = document.getElementById("btnApagarDia");

// login (se existir no teu HTML)
const inputEmail = document.getElementById("email");
const inputPass = document.getElementById("password");
const btnEntrar = document.getElementById("btnEntrar");
const btnSair = document.getElementById("btnSair");
const authStatus = document.getElementById("authStatus");

// =========================
// Constantes / Helpers
// =========================
const meses = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const diasSemana = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];

function pad2(n) { return String(n).padStart(2, "0"); }

function keyDia(ano, mes, dia) {
  return `${ano}-${pad2(mes + 1)}-${pad2(dia)}`;
}

function isValidISODate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatISODateUTC(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = pad2(dateObj.getUTCMonth() + 1);
  const d = pad2(dateObj.getUTCDate());
  return `${y}-${m}-${d}`;
}

function listDatesInclusiveISO(startISO, endISO) {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(formatISODateUTC(cur));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

function randomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Estado agregado do DIA (vermelho > laranja > nenhum)
function estadoAgregado(eventos) {
  if (eventos.some(e => e.estado === "confirmado")) return "confirmado";
  if (eventos.some(e => e.estado === "provisorio")) return "provisorio";
  return "nenhum";
}

function tooltipClientes(eventos) {
  const nomes = eventos.map(e => (e.clienteEmpresa || "").trim()).filter(Boolean);
  if (!nomes.length) return "";
  const uniq = [];
  for (const n of nomes) if (!uniq.includes(n)) uniq.push(n);
  return uniq.join(" • ");
}

// =========================
// CSS (injetado) p/ vista anual
// =========================
(function injectAnnualStyles() {
  const css = `
  .ano-grid{
    display:grid;
    grid-template-columns: repeat(3, minmax(240px, 1fr));
    gap:18px;
    max-width: 980px;
    margin: 0 auto;
  }
  @media (max-width: 900px){ .ano-grid{ grid-template-columns: repeat(2, minmax(240px, 1fr)); } }
  @media (max-width: 600px){ .ano-grid{ grid-template-columns: 1fr; } }

  .mes-card{
    border:1px solid #e2e2e2;
    border-radius:12px;
    background:#fff;
    padding:10px 10px 12px;
  }
  .mes-titulo{
    font-weight:700;
    text-align:center;
    margin: 2px 0 8px;
  }
  .mini-head{
    display:grid;
    grid-template-columns: repeat(7, 1fr);
    gap:4px;
    margin-bottom:6px;
  }
  .mini-head div{
    background:#4b5f78;
    color:#fff;
    font-weight:700;
    font-size:11px;
    padding:6px 0;
    border-radius:8px;
    text-align:center;
  }
  .mini-grid{
    display:grid;
    grid-template-columns: repeat(7, 1fr);
    gap:4px;
  }
  .mini-day{
    border:1px solid #cfcfcf;
    border-radius:7px;
    min-height:28px;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:12px;
    font-weight:700;
    cursor:pointer;
    user-select:none;
    background:#fff;
  }
  .mini-day.vazio{
    border:1px dashed #d9d9d9;
    background:transparent;
    cursor:default;
  }
  .mini-day.confirmado{
    background:#ffd6d6;
    border-color:#ff5a5a;
  }
  .mini-day.provisorio{
    background:#ffe2bf;
    border-color:#ff9a2e;
  }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
})();

// =========================
// AUTH + allowlist por UID
// =========================
let state = {
  user: null,
  allowed: false,
  diaAtualKey: null,
  unsubYear: null
};

async function checkAllowlistByUID(uid) {
  const ref = doc(db, "allowlist", uid);
  const snap = await getDoc(ref);
  return snap.exists();
}

function canEdit() {
  return !!state.user && state.allowed;
}

function setUIAuth() {
  const ok = canEdit();
  if (authStatus) {
    authStatus.textContent = ok
      ? `Autenticado: ${state.user.email}`
      : "Não autenticado";
  }

  if (!ok) {
    calendario.innerHTML = `<div style="text-align:center;margin-top:16px;font-weight:700;">
      Faz login para ver e editar a agenda.
    </div>`;
  }
}

onAuthStateChanged(auth, async (user) => {
  state.user = user || null;
  state.allowed = false;

  if (state.unsubYear) {
    state.unsubYear();
    state.unsubYear = null;
  }

  if (user) {
    state.allowed = await checkAllowlistByUID(user.uid);
    console.log("ALLOWLIST UID:", user.uid, "exists?", state.allowed);

    if (state.allowed) {
      criarCalendarioAnual();
      startRealtimeForSelectedYear();
    } else {
      calendario.innerHTML = `<div style="text-align:center;margin-top:16px;font-weight:700;">
        Sem permissão (não estás na allowlist).
      </div>`;
    }
  }

  setUIAuth();
});

btnEntrar?.addEventListener("click", async () => {
  const email = (inputEmail?.value || "").trim();
  const pass = (inputPass?.value || "").trim();
  if (!email || !pass) return alert("Preenche email e palavra-passe.");
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    console.error(e);
    alert("Erro no login: " + (e?.message || e));
  }
});

btnSair?.addEventListener("click", async () => {
  await signOut(auth);
});

// =========================
// Preencher anos/meses
// =========================
for (let ano = 2026; ano <= 2030; ano++) {
  const option = document.createElement("option");
  option.value = String(ano);
  option.textContent = String(ano);
  selectAno.appendChild(option);
}

meses.forEach((nomeMes, index) => {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = nomeMes;
  selectMes?.appendChild(option);
});

// =========================
// Cache anual em tempo real
// =========================
const yearCache = new Map(); // key: "YYYY-MM-DD" -> {eventos:[...]}

function startRealtimeForSelectedYear() {
  if (!canEdit()) return;

  if (state.unsubYear) {
    state.unsubYear();
    state.unsubYear = null;
  }

  yearCache.clear();

  const ano = Number(selectAno.value);
  const start = `${ano}-01-01`;
  const end = `${ano}-12-31`;

  const diasRef = collection(db, "dias");
  const q = query(
    diasRef,
    where("__name__", ">=", start),
    where("__name__", "<=", end)
  );

  state.unsubYear = onSnapshot(q, (snap) => {
    snap.docChanges().forEach((ch) => {
      const id = ch.doc.id;
      if (ch.type === "removed") yearCache.delete(id);
      else yearCache.set(id, ch.doc.data());
    });
    criarCalendarioAnual();
  }, (err) => {
    console.error("Listener ano erro:", err);
  });
}

// =========================
// Calendário ANUAL (12 meses)
// =========================
function criarCalendarioAnual() {
  if (!canEdit()) return;

  const ano = Number(selectAno.value);
  calendario.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "ano-grid";

  for (let mes = 0; mes < 12; mes++) {
    const card = document.createElement("div");
    card.className = "mes-card";

    const titulo = document.createElement("div");
    titulo.className = "mes-titulo";
    titulo.textContent = meses[mes];
    card.appendChild(titulo);

    const head = document.createElement("div");
    head.className = "mini-head";
    diasSemana.forEach(d => {
      const h = document.createElement("div");
      h.textContent = d;
      head.appendChild(h);
    });
    card.appendChild(head);

    const mini = document.createElement("div");
    mini.className = "mini-grid";

    const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
    const totalDias = new Date(ano, mes + 1, 0).getDate();

    // vazios
    for (let i = 0; i < primeiroDiaSemana; i++) {
      const v = document.createElement("div");
      v.className = "mini-day vazio";
      mini.appendChild(v);
    }

    // dias
    for (let dia = 1; dia <= totalDias; dia++) {
      const cell = document.createElement("div");
      cell.className = "mini-day";
      cell.textContent = String(dia);

      const k = keyDia(ano, mes, dia);
      const cached = yearCache.get(k);
      const eventos = cached?.eventos || [];

      const agg = estadoAgregado(eventos);
      if (agg === "confirmado") cell.classList.add("confirmado");
      if (agg === "provisorio") cell.classList.add("provisorio");

      const tip = tooltipClientes(eventos);
      if (tip) cell.title = tip;

      cell.addEventListener("click", () => abrirDia(dia, mes, ano));
      mini.appendChild(cell);
    }

    card.appendChild(mini);
    grid.appendChild(card);
  }

  calendario.appendChild(grid);
}

// =========================
// Modal
// =========================
function abrirModal() { overlay.classList.remove("hidden"); }
function fecharModal() {
  overlay.classList.add("hidden");
  state.diaAtualKey = null;
  listaEventos.innerHTML = "";
}

function criarCardEvento(evento = {}, indice = 1, defaultDiaISO = null) {
  const card = document.createElement("div");
  card.className = "evento-card";

  if (!evento.eventId) evento.eventId = randomId();
  if (!evento.dataInicio && defaultDiaISO) evento.dataInicio = defaultDiaISO;
  if (!evento.dataFim && defaultDiaISO) evento.dataFim = defaultDiaISO;

  card.innerHTML = `
    <div class="evento-topo">
      <div class="evento-titulo">Evento #${indice}</div>
      <div class="evento-acoes">
        <button type="button" class="btn-sec btnRemover">Remover</button>
      </div>
    </div>

    <div class="form-grid">
      <input type="hidden" name="eventId" />

      <label>Estado
        <select name="estado">
          <option value="nenhum">—</option>
          <option value="2opcao">2ª opção</option>
          <option value="provisorio">Reservado provisoriamente</option>
          <option value="confirmado">Confirmado</option>
        </select>
      </label>

      <label>Gestor <input name="gestor" type="text" /></label>
      <label>Evento <input name="evento" type="text" /></label>
      <label>Cliente / Empresa <input name="clienteEmpresa" type="text" /></label>

      <label>Nome / Contacto <input name="nomeContacto" type="text" /></label>

      <label>Data Início <input name="dataInicio" type="date" /></label>
      <label>Data Fim <input name="dataFim" type="date" /></label>
      <label>Montagens <input name="montagens" type="text" /></label>
      <label>Evento <input name="evento2" type="text" /></label>

      <label>Desmontagens <input name="desmontagens" type="text" /></label>
      <label>Pax <input name="pax" type="number" min="0" /></label>
      <label>N/I <input name="ni" type="text" /></label>
      <label>Segmento <input name="segmento" type="text" /></label>

      <label>ESPAÇOS <input name="espacos" type="text" /></label>
      <label>Data Consulta <input name="dataConsulta" type="date" /></label>
      <label>DEAD LINE <input name="deadLine" type="date" /></label>
      <label>Data Confirmação <input name="dataConfirmacao" type="date" /></label>

      <label>Nº Proposta <input name="numProposta" type="text" /></label>

      <label class="span2">OBSERVAÇÕES
        <textarea name="observacoes" rows="3"></textarea>
      </label>

      <label class="span2">PONTO DE SITUAÇÃO
        <textarea name="pontoSituacao" rows="3"></textarea>
      </label>
    </div>
  `;

  for (const [k, v] of Object.entries(evento)) {
    const el = card.querySelector(`[name="${k}"]`);
    if (el) el.value = v ?? "";
  }

  card.querySelector(".btnRemover").addEventListener("click", () => {
    card.remove();
    renumerarEventos();
  });

  return card;
}

function renumerarEventos() {
  [...listaEventos.querySelectorAll(".evento-card")].forEach((c, i) => {
    const t = c.querySelector(".evento-titulo");
    if (t) t.textContent = `Evento #${i + 1}`;
  });
}

async function lerDiaFS(key) {
  const ref = doc(db, "dias", key);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { eventos: [] };
  const data = snap.data() || {};
  return { eventos: Array.isArray(data.eventos) ? data.eventos : [] };
}

async function abrirDia(dia, mes, ano) {
  if (!canEdit()) return;

  const diaISO = keyDia(ano, mes, dia);
  state.diaAtualKey = diaISO;

  modalData.textContent = `Dia ${dia} de ${meses[mes]} de ${ano} (${diaISO})`;
  listaEventos.innerHTML = "";

  const dados = await lerDiaFS(diaISO);
  const eventos = Array.isArray(dados.eventos) ? dados.eventos : [];

  if (eventos.length === 0) {
    listaEventos.appendChild(criarCardEvento({ estado: "nenhum" }, 1, diaISO));
  } else {
    eventos.forEach((ev, idx) => {
      listaEventos.appendChild(criarCardEvento(ev, idx + 1, diaISO));
    });
  }

  abrirModal();
}

// + Adicionar evento
btnAdicionarEvento.addEventListener("click", () => {
  if (!canEdit() || !state.diaAtualKey) return;
  const count = listaEventos.querySelectorAll(".evento-card").length;
  listaEventos.appendChild(criarCardEvento({ estado: "nenhum" }, count + 1, state.diaAtualKey));
  renumerarEventos();
});

// Guardar (intervalos)
async function upsertEventoNoDia(diaISO, eventoObj) {
  const ref = doc(db, "dias", diaISO);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const eventos = Array.isArray(data.eventos) ? data.eventos : [];

    const sem = eventos.filter(e => e.eventId !== eventoObj.eventId);
    sem.push(eventoObj);

    tx.set(ref, { eventos: sem }, { merge: true });
  });
}

btnGuardarDia.addEventListener("click", async () => {
  if (!canEdit() || !state.diaAtualKey) return;

  const cards = [...listaEventos.querySelectorAll(".evento-card")];

  const eventos = cards.map(card => {
    const obj = {};
    card.querySelectorAll("[name]").forEach(el => obj[el.name] = el.value);
    return obj;
  }).filter(ev =>
    (ev.evento && ev.evento.trim() !== "") ||
    (ev.clienteEmpresa && ev.clienteEmpresa.trim() !== "")
  );

  try {
    if (eventos.length === 0) {
      await deleteDoc(doc(db, "dias", state.diaAtualKey));
      fecharModal();
      criarCalendarioAnual();
      return;
    }

    for (const ev of eventos) {
      let di = ev.dataInicio;
      let df = ev.dataFim;

      if (!isValidISODate(di)) di = state.diaAtualKey;
      if (!isValidISODate(df)) df = di;

      if (parseISODate(df) < parseISODate(di)) {
        const tmp = di; di = df; df = tmp;
      }

      const dias = listDatesInclusiveISO(di, df);
      for (const d of dias) {
        await upsertEventoNoDia(d, { ...ev, dataInicio: di, dataFim: df });
      }
    }

    fecharModal();
    criarCalendarioAnual();
  } catch (e) {
    console.error("ERRO AO GUARDAR:", e);
    alert("Erro ao guardar. Vê F12 → Console.");
  }
});

// Apagar todos do dia
btnApagarDia.addEventListener("click", async () => {
  if (!canEdit() || !state.diaAtualKey) return;
  await deleteDoc(doc(db, "dias", state.diaAtualKey));
  fecharModal();
  criarCalendarioAnual();
});

// Fechar modal
btnFechar.addEventListener("click", fecharModal);
btnCancelar.addEventListener("click", fecharModal);
overlay.addEventListener("click", (e) => { if (e.target === overlay) fecharModal(); });

// Ano muda => refaz listener do ano
selectAno.addEventListener("change", () => {
  if (!canEdit()) return;
  criarCalendarioAnual();
  startRealtimeForSelectedYear();
});

// (mes deixa de ser usado na vista anual, mas não faz mal existir)
selectMes?.addEventListener("change", () => {});

// Iniciar
selectAno.value = "2026";
if (selectMes) selectMes.value = "0";
setUIAuth();
