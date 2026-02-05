/* =========================
   AGENDA CCE - script.js
   Firebase Auth (email/pass) + Firestore realtime
   Allowlist por UID (mais seguro)
========================= */

/* ===== Imports Firebase (SDK via CDN) ===== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  FieldPath
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ===== Config Firebase (a tua) ===== */
const firebaseConfig = {
  apiKey: "AIzaSyCs9f8SeZQ-H2aSYm695q2RW1gGPtEUoJA",
  authDomain: "agenda-cce.firebaseapp.com",
  projectId: "agenda-cce",
  storageBucket: "agenda-cce.firebasestorage.app",
  messagingSenderId: "405095335038",
  appId: "1:405095335038:web:cb064572b272f95850c42f"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ===== DOM ===== */
const calendario = document.getElementById("calendario");
const selectAno = document.getElementById("ano");
const selectMes = document.getElementById("mes");

const overlay = document.getElementById("overlay");
const modalData = document.getElementById("modalData");
const listaEventos = document.getElementById("listaEventos");

const btnFechar = document.getElementById("btnFechar");
const btnCancelar = document.getElementById("btnCancelar");
const btnAdicionarEvento = document.getElementById("btnAdicionarEvento");
const btnGuardarDia = document.getElementById("btnGuardarDia");
const btnApagarDia = document.getElementById("btnApagarDia");

const emailInput = document.getElementById("email");
const passInput = document.getElementById("password");
const btnLogin = document.getElementById("btnLogin");
const btnLogout = document.getElementById("btnLogout");
const authStatus = document.getElementById("authStatus");

/* ===== Constantes ===== */
const meses = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

/* ===== Helpers ===== */
function pad2(n) { return String(n).padStart(2, "0"); }

function keyDia(ano, mes, dia) {
  return `${ano}-${pad2(mes + 1)}-${pad2(dia)}`;
}

function startEndKeys(ano, mes) {
  const start = `${ano}-${pad2(mes + 1)}-01`;
  const last = new Date(ano, mes + 1, 0).getDate();
  const end = `${ano}-${pad2(mes + 1)}-${pad2(last)}`;
  return { start, end };
}

function safeArray(v) { return Array.isArray(v) ? v : []; }

function canEdit() {
  return !!state.user && state.allowed === true;
}

function setUIEnabled(enabled) {
  btnAdicionarEvento.disabled = !enabled;
  btnGuardarDia.disabled = !enabled;
  btnApagarDia.disabled = !enabled;

  btnAdicionarEvento.style.opacity = enabled ? "1" : "0.5";
  btnGuardarDia.style.opacity = enabled ? "1" : "0.5";
  btnApagarDia.style.opacity = enabled ? "1" : "0.5";
}

function renderMensagem(texto) {
  calendario.innerHTML = "";
  const msg = document.createElement("div");
  msg.style.gridColumn = "1 / -1";
  msg.style.padding = "12px";
  msg.style.fontWeight = "700";
  msg.style.color = "#333";
  msg.textContent = texto;
  calendario.appendChild(msg);
}

/* ===== Estado global ===== */
const state = {
  user: null,
  allowed: false,

  // realtime mês
  unsubMonth: null,
  monthData: new Map(), // key: YYYY-MM-DD -> {eventos:[]}

  // modal/dia aberto
  diaAtualKey: null,
  unsubDay: null
};

/* ===== Allowlist por UID ===== */
async function checkAllowlist(uid) {
  try {
    const ref = doc(db, "allowlist", uid);
    const snap = await getDoc(ref);
    console.log("ALLOWLIST UID:", uid, "exists?", snap.exists());
    return snap.exists();
  } catch (e) {
    console.error("ALLOWLIST ERROR:", e);
    return false;
  }
}

/* ===== AUTH handlers ===== */
btnLogin?.addEventListener("click", async () => {
  const email = String(emailInput.value || "").trim();
  const password = String(passInput.value || "");

  if (!email || !password) {
    alert("Introduz email e palavra-passe.");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    passInput.value = "";
  } catch (e) {
    console.error(e);
    alert("Falha no login. Verifica email/palavra-passe.");
  }
});

btnLogout?.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (u) => {
  state.user = u || null;

  // logout
  if (!state.user) {
    state.allowed = false;

    authStatus.textContent = "Não autenticado";
    btnLogin?.classList.remove("hidden");
    btnLogout?.classList.add("hidden");

    stopRealtime();
    fecharModal();
    setUIEnabled(false);
    renderMensagem("Faz login para ver e editar a agenda.");
    return;
  }

  // login ok
  authStatus.textContent = `Autenticado: ${state.user.email}`;
  btnLogin?.classList.add("hidden");
  btnLogout?.classList.remove("hidden");

  // ✅ check allowlist por UID
  state.allowed = await checkAllowlist(state.user.uid);

  if (!state.allowed) {
    stopRealtime();
    fecharModal();
    setUIEnabled(false);
    renderMensagem("Sem permissão. Conta não autorizada.");
    alert(
      "Sem permissão: este utilizador não está na allowlist.\n" +
      "Adiciona um documento em Firestore > allowlist com Document ID = UID do utilizador."
    );
    return;
  }

  setUIEnabled(true);
  startRealtimeForSelectedMonth();
});

/* ===== Realtime start/stop ===== */
function stopRealtime() {
  if (state.unsubMonth) { state.unsubMonth(); state.unsubMonth = null; }
  if (state.unsubDay) { state.unsubDay(); state.unsubDay = null; }
  state.monthData = new Map();
}

function startRealtimeForSelectedMonth() {
  if (!canEdit()) return;

  if (state.unsubMonth) { state.unsubMonth(); state.unsubMonth = null; }
  state.monthData = new Map();

  const ano = Number(selectAno.value);
  const mes = Number(selectMes.value);
  const { start, end } = startEndKeys(ano, mes);

  const diasRef = collection(db, "dias");
  const q = query(
    diasRef,
    where("__name__", ">=", start),
    where("__name__", "<=", end)
  );

  state.unsubMonth = onSnapshot(q, (snap) => {
    const map = new Map();
    snap.forEach(d => map.set(d.id, d.data()));
    state.monthData = map;
    criarCalendario();
  }, (err) => {
    console.error("MONTH SNAPSHOT ERROR:", err);
    renderMensagem("Erro ao carregar dados do Firestore (permissões ou rede).");
  });
}

/* ===== Preencher selects ===== */
for (let ano = 2026; ano <= 2030; ano++) {
  const opt = document.createElement("option");
  opt.value = String(ano);
  opt.textContent = String(ano);
  selectAno.appendChild(opt);
}

meses.forEach((m, idx) => {
  const opt = document.createElement("option");
  opt.value = String(idx);
  opt.textContent = m;
  selectMes.appendChild(opt);
});

selectAno.value = "2026";
selectMes.value = "0";

/* ===== Estado agregado (cores do dia) ===== */
function estadoAgregado(eventos) {
  if (eventos.some(e => e.estado === "confirmado")) return "confirmado";
  if (eventos.some(e => e.estado === "provisorio")) return "provisorio";
  // "segunda_opcao" não pinta o dia (podes alterar se quiseres)
  return "nenhum";
}

/* ===== Badge: mostrar todos os nomes ===== */
function textoBadge(eventos) {
  // Mostra o campo "evento"; se estiver vazio usa "clienteEmpresa"
  const nomes = eventos
    .map(e => (String(e.evento || "").trim()) || (String(e.clienteEmpresa || "").trim()))
    .filter(Boolean);

  if (nomes.length === 0) return "";

  // para não ficar gigante, corta nomes muito longos
  const clean = nomes.map(n => n.length > 18 ? (n.slice(0, 18) + "…") : n);

  // se houver muitos, ainda assim mostramos todos, em várias linhas
  return clean.join(" · ");
}

/* ===== Criar calendário ===== */
function criarCalendario() {
  calendario.innerHTML = "";

  if (!canEdit()) {
    renderMensagem("Faz login para ver e editar a agenda.");
    return;
  }

  const ano = Number(selectAno.value);
  const mes = Number(selectMes.value);

  const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
  const totalDias = new Date(ano, mes + 1, 0).getDate();

  for (let i = 0; i < primeiroDiaSemana; i++) {
    const vazio = document.createElement("div");
    vazio.className = "dia vazio";
    calendario.appendChild(vazio);
  }

  for (let dia = 1; dia <= totalDias; dia++) {
    const div = document.createElement("div");
    div.className = "dia";

    const num = document.createElement("span");
    num.textContent = String(dia);
    div.appendChild(num);

    const k = keyDia(ano, mes, dia);
    const dados = state.monthData.get(k) || { eventos: [] };
    const eventos = safeArray(dados.eventos);

    const agg = estadoAgregado(eventos);
    if (agg === "confirmado") div.classList.add("confirmado");
    if (agg === "provisorio") div.classList.add("provisorio");

    const btxt = textoBadge(eventos);
    if (btxt) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = btxt;
      div.appendChild(badge);
    }

    div.addEventListener("click", () => abrirDia(dia, mes, ano));
    calendario.appendChild(div);
  }
}

/* ===== Modal open/close ===== */
function abrirModal() { overlay.classList.remove("hidden"); }
function fecharModal() {
  overlay.classList.add("hidden");
  state.diaAtualKey = null;
  listaEventos.innerHTML = "";
  if (state.unsubDay) { state.unsubDay(); state.unsubDay = null; }
}

btnFechar?.addEventListener("click", fecharModal);
btnCancelar?.addEventListener("click", fecharModal);
overlay?.addEventListener("click", (e) => { if (e.target === overlay) fecharModal(); });

/* ===== Cards de evento ===== */
function criarCardEvento(evento = {}, indice = 1) {
  const card = document.createElement("div");
  card.className = "evento-card";

  card.innerHTML = `
    <div class="evento-topo">
      <div class="evento-titulo">Evento #${indice}</div>
      <div class="evento-acoes">
        <button type="button" class="btn-sec btnRemover">Remover</button>
      </div>
    </div>

    <div class="form-grid">
      <label>Estado
        <select name="estado">
          <option value="nenhum">—</option>
          <option value="provisorio">Reservado provisoriamente</option>
          <option value="segunda_opcao">2ª opção</option>
          <option value="confirmado">Confirmado</option>
        </select>
      </label>

      <label>Gestor <input name="ce" type="text" /></label>
      <label>Evento <input name="evento" type="text" /></label>
      <label>Cliente / Empresa <input name="clienteEmpresa" type="text" /></label>

      <label>Nome / Contacto <input name="nomeContacto" type="text" /></label>
      <label>Data do Evento <input name="dataEvento" type="date" /></label>
      <label>Montagens <input name="monta" type="text" /></label>
      <label>Evento <input name="realiza" type="text" /></label>

      <label>Desmontagens <input name="desmonta" type="text" /></label>
      <label>Pax <input name="pax" type="number" min="0" /></label>
      <label>N/I <input name="macIntl" type="text" /></label>
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

  // preencher valores existentes
  for (const [k, v] of Object.entries(evento)) {
    const el = card.querySelector(`[name="${k}"]`);
    if (el) el.value = v ?? "";
  }

  // remover
  card.querySelector(".btnRemover").addEventListener("click", () => {
    if (!canEdit()) return;
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

function renderEventosNoModal(eventos, diaKey) {
  listaEventos.innerHTML = "";

  if (eventos.length === 0) {
    listaEventos.appendChild(criarCardEvento({ estado: "nenhum", dataEvento: diaKey }, 1));
  } else {
    eventos.forEach((ev, idx) => {
      const copy = { ...ev };
      if (!copy.dataEvento) copy.dataEvento = diaKey;
      listaEventos.appendChild(criarCardEvento(copy, idx + 1));
    });
  }

  renumerarEventos();
}

/* ===== Abrir um dia (realtime doc) ===== */
function abrirDia(dia, mes, ano) {
  if (!canEdit()) {
    alert("Tens de fazer login para editar.");
    return;
  }

  state.diaAtualKey = keyDia(ano, mes, dia);
  modalData.textContent = `Dia ${dia} de ${meses[mes]} de ${ano} (${state.diaAtualKey})`;

  // parar listener anterior
  if (state.unsubDay) { state.unsubDay(); state.unsubDay = null; }

  const ref = doc(db, "dias", state.diaAtualKey);

  state.unsubDay = onSnapshot(ref, (snap) => {
    const dados = snap.exists() ? snap.data() : { eventos: [] };
    const eventos = safeArray(dados.eventos);

    // atualizar cache mensal
    state.monthData.set(state.diaAtualKey, { eventos });

    // render modal + calendário
    renderEventosNoModal(eventos, state.diaAtualKey);
    criarCalendario();
  }, (err) => {
    console.error("DAY SNAPSHOT ERROR:", err);
    alert("Sem permissões para abrir este dia (Firestore).");
  });

  abrirModal();
}

/* ===== Botões do modal ===== */
btnAdicionarEvento?.addEventListener("click", () => {
  if (!canEdit()) return;
  const count = listaEventos.querySelectorAll(".evento-card").length;
  listaEventos.appendChild(criarCardEvento({ estado: "nenhum", dataEvento: state.diaAtualKey }, count + 1));
  renumerarEventos();
});

btnGuardarDia?.addEventListener("click", async () => {
  if (!canEdit() || !state.diaAtualKey) {
    alert("Sem permissão ou dia inválido.");
    return;
  }

  const cards = [...listaEventos.querySelectorAll(".evento-card")];

  const eventos = cards
    .map(card => {
      const obj = {};
      card.querySelectorAll("[name]").forEach(el => obj[el.name] = el.value);
      return obj;
    })
    .filter(ev =>
      (ev.evento && ev.evento.trim() !== "") ||
      (ev.clienteEmpresa && ev.clienteEmpresa.trim() !== "")
    );

  try {
    if (eventos.length === 0) {
      await deleteDoc(doc(db, "dias", state.diaAtualKey));
      alert("Dia apagado (sem eventos).");
    } else {
      await setDoc(doc(db, "dias", state.diaAtualKey), { eventos }, { merge: true });
      alert("Guardado com sucesso ✅");
    }

    fecharModal();
    criarCalendario();
  } catch (e) {
    console.error("ERRO AO GUARDAR:", e);
    alert("Erro ao guardar no Firestore. Abre F12 → Console para ver o erro.");
  }
});

btnApagarDia?.addEventListener("click", async () => {
  if (!canEdit() || !state.diaAtualKey) return;

  try {
    await deleteDoc(doc(db, "dias", state.diaAtualKey));
    state.monthData.delete(state.diaAtualKey);
    fecharModal();
    criarCalendario();
  } catch (e) {
    console.error(e);
    alert("Erro a apagar no Firestore.");
  }
});

/* ===== Atualizar mês/ano ===== */
selectAno.addEventListener("change", () => canEdit() && startRealtimeForSelectedMonth());
selectMes.addEventListener("change", () => canEdit() && startRealtimeForSelectedMonth());

/* ===== UI inicial ===== */
setUIEnabled(false);
renderMensagem("Faz login para ver e editar a agenda.");


