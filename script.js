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

// ====== CONFIG (SUBSTITUI PELAS TUAS CHAVES) ======
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
const selectMes = document.getElementById("mes");

const overlay = document.getElementById("overlay");
const modalData = document.getElementById("modalData");
const listaEventos = document.getElementById("listaEventos");

const btnFechar = document.getElementById("btnFechar");
const btnCancelar = document.getElementById("btnCancelar");
const btnAdicionarEvento = document.getElementById("btnAdicionarEvento");
const btnGuardarDia = document.getElementById("btnGuardarDia");
const btnApagarDia = document.getElementById("btnApagarDia");

// (se tens inputs de login no index)
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

function pad2(n) { return String(n).padStart(2, "0"); }

function keyDia(ano, mes, dia) {
  // mes é 0-11, dia 1-31
  return `${ano}-${pad2(mes + 1)}-${pad2(dia)}`;
}

function isValidISODate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseISODate(s) {
  // força UTC “limpo” para evitar problemas de timezone
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

function estadoAgregado(eventos) {
  if (eventos.some(e => e.estado === "confirmado")) return "confirmado";
  if (eventos.some(e => e.estado === "provisorio")) return "provisorio";
  return "nenhum";
}

// Mostrar todos os nomes de clientes no badge
function textoBadge(eventos) {
  const nomes = eventos
    .map(e => (e.clienteEmpresa || "").trim())
    .filter(Boolean);

  if (nomes.length === 0) return "";

  // remove duplicados mantendo ordem
  const uniq = [];
  for (const n of nomes) if (!uniq.includes(n)) uniq.push(n);

  // se ficar muito longo, corta visualmente
  const joined = uniq.join(" • ");
  if (joined.length <= 28) return joined;
  return joined.slice(0, 28) + "…";
}

// =========================
// AUTH + allowlist (por UID)
// =========================
let state = {
  user: null,
  allowed: false,
  diaAtualKey: null,
  unsubMonth: null
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

  // Bloqueia UI de edição quando não autorizado
  // (mantém visível o login)
  const hideWhenNoAuth = document.querySelectorAll("[data-requires-auth]");
  hideWhenNoAuth.forEach(el => el.style.display = ok ? "" : "none");

  // A própria agenda pode estar atrás deste “gate”
  if (!ok) {
    calendario.innerHTML = "";
  }
}

onAuthStateChanged(auth, async (user) => {
  state.user = user || null;
  state.allowed = false;

  // parar listeners antigos
  if (state.unsubMonth) {
    state.unsubMonth();
    state.unsubMonth = null;
  }

  if (user) {
    state.allowed = await checkAllowlistByUID(user.uid);
    console.log("ALLOWLIST UID:", user.uid, "exists?", state.allowed);

    if (state.allowed) {
      criarCalendario();
      startRealtimeForSelectedMonth();
    } else {
      calendario.innerHTML = "";
    }
  } else {
    calendario.innerHTML = "";
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
// Preencher selects
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
  selectMes.appendChild(option);
});

// =========================
// Firestore read helpers
// =========================
async function lerDiaFS(key) {
  const ref = doc(db, "dias", key);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { eventos: [] };
  const data = snap.data() || {};
  return { eventos: Array.isArray(data.eventos) ? data.eventos : [] };
}

// =========================
// Calendário
// =========================
function criarCalendario() {
  if (!canEdit()) return;

  calendario.innerHTML = "";

  const ano = Number(selectAno.value);
  const mes = Number(selectMes.value);

  const primeiroDiaSemana = new Date(ano, mes, 1).getDay(); // 0=Dom
  const totalDias = new Date(ano, mes + 1, 0).getDate();

  // vazios antes do dia 1
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

    // pinta / badge se existir cache do mês (via listener)
    const k = keyDia(ano, mes, dia);
    const cached = monthCache.get(k);
    if (cached) {
      const eventos = cached.eventos || [];
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
    }

    div.addEventListener("click", () => abrirDia(dia, mes, ano));
    calendario.appendChild(div);
  }
}

// =========================
// Realtime mês (cache)
// =========================
const monthCache = new Map();

function startRealtimeForSelectedMonth() {
  if (!canEdit()) return;

  // limpar listener anterior
  if (state.unsubMonth) {
    state.unsubMonth();
    state.unsubMonth = null;
  }

  monthCache.clear();

  const ano = Number(selectAno.value);
  const mes = Number(selectMes.value);

  const start = `${ano}-${pad2(mes + 1)}-01`;
  const lastDay = new Date(ano, mes + 1, 0).getDate();
  const end = `${ano}-${pad2(mes + 1)}-${pad2(lastDay)}`;

  const diasRef = collection(db, "dias");
  const q = query(
    diasRef,
    where("__name__", ">=", start),
    where("__name__", "<=", end)
  );

  state.unsubMonth = onSnapshot(q, (snap) => {
    snap.docChanges().forEach((ch) => {
      const id = ch.doc.id;
      if (ch.type === "removed") monthCache.delete(id);
      else monthCache.set(id, ch.doc.data());
    });
    criarCalendario();
  }, (err) => {
    console.error("Listener mês erro:", err);
  });
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

  // garantir eventId fixo (para replicar em vários dias sem duplicar)
  if (!evento.eventId) evento.eventId = randomId();

  // defaults para intervalo
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

  // preencher valores
  for (const [k, v] of Object.entries(evento)) {
    const el = card.querySelector(`[name="${k}"]`);
    if (el) el.value = v ?? "";
  }

  card.querySelector(".btnRemover").addEventListener("click", () => {
    card.remove();
    renumerarEventos();
    aplicarCoresSequenciais();
  });

  return card;
}

function renumerarEventos() {
  [...listaEventos.querySelectorAll(".evento-card")].forEach((c, i) => {
    const t = c.querySelector(".evento-titulo");
    if (t) t.textContent = `Evento #${i + 1}`;
  });
}

function aplicarCoresSequenciais() {
  const cards = [...listaEventos.querySelectorAll(".evento-card")];
  cards.forEach((card, idx) => {
    card.classList.remove("alt1", "alt2", "alt3", "alt4");
    card.classList.add(`alt${(idx % 4) + 1}`); // 4 cores (definir no CSS)
  });
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

  aplicarCoresSequenciais();
  abrirModal();
}

// =========================
// + Adicionar evento
// =========================
btnAdicionarEvento.addEventListener("click", () => {
  if (!canEdit() || !state.diaAtualKey) return;

  const count = listaEventos.querySelectorAll(".evento-card").length;
  listaEventos.appendChild(criarCardEvento({ estado: "nenhum" }, count + 1, state.diaAtualKey));
  renumerarEventos();
  aplicarCoresSequenciais();
});

// =========================
// Guardar (intervalos)
// =========================
async function upsertEventoNoDia(diaISO, eventoObj) {
  const ref = doc(db, "dias", diaISO);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const eventos = Array.isArray(data.eventos) ? data.eventos : [];

    // remove evento com o mesmo eventId (para "atualizar" sem duplicar)
    const sem = eventos.filter(e => e.eventId !== eventoObj.eventId);

    // adiciona o evento
    sem.push(eventoObj);

    tx.set(ref, { eventos: sem }, { merge: true });
  });
}

async function removerEventoDoDia(diaISO, eventId) {
  const ref = doc(db, "dias", diaISO);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

    const data = snap.data() || {};
    const eventos = Array.isArray(data.eventos) ? data.eventos : [];
    const novos = eventos.filter(e => e.eventId !== eventId);

    if (novos.length === 0) tx.delete(ref);
    else tx.set(ref, { eventos: novos }, { merge: true });
  });
}

btnGuardarDia.addEventListener("click", async () => {
  if (!canEdit() || !state.diaAtualKey) return;

  const cards = [...listaEventos.querySelectorAll(".evento-card")];

  // ler eventos do formulário
  const eventos = cards.map(card => {
    const obj = {};
    card.querySelectorAll("[name]").forEach(el => obj[el.name] = el.value);
    return obj;
  }).filter(ev =>
    (ev.evento && ev.evento.trim() !== "") ||
    (ev.clienteEmpresa && ev.clienteEmpresa.trim() !== "")
  );

  try {
    // Caso: sem eventos => apagar só o dia atual
    if (eventos.length === 0) {
      await deleteDoc(doc(db, "dias", state.diaAtualKey));
      fecharModal();
      criarCalendario();
      return;
    }

    // Para cada evento, grava no intervalo dataInicio..dataFim
    for (const ev of eventos) {
      // normalizar datas
      let di = ev.dataInicio;
      let df = ev.dataFim;

      // fallback: se estiverem vazias, usa o dia atual
      if (!isValidISODate(di)) di = state.diaAtualKey;
      if (!isValidISODate(df)) df = di;

      // garantir ordem
      if (parseISODate(df) < parseISODate(di)) {
        const tmp = di; di = df; df = tmp;
      }

      const dias = listDatesInclusiveISO(di, df);

      // grava em todos os dias do intervalo
      for (const d of dias) {
        await upsertEventoNoDia(d, { ...ev, dataInicio: di, dataFim: df });
      }

      // NOTA: não removo automaticamente dos dias antigos fora do intervalo
      // (se quiseres “mover”, diz-me e eu adiciono essa lógica)
    }

    fecharModal();
    criarCalendario();
  } catch (e) {
    console.error("ERRO AO GUARDAR:", e);
    alert("Erro ao guardar. Vê F12 → Console.");
  }
});

// =========================
// Apagar todos do dia
// =========================
btnApagarDia.addEventListener("click", async () => {
  if (!canEdit() || !state.diaAtualKey) return;
  await deleteDoc(doc(db, "dias", state.diaAtualKey));
  fecharModal();
  criarCalendario();
});

// =========================
// Fechar modal
// =========================
btnFechar.addEventListener("click", fecharModal);
btnCancelar.addEventListener("click", fecharModal);

overlay.addEventListener("click", (e) => {
  if (e.target === overlay) fecharModal();
});

// =========================
// Atualizar mês/ano
// =========================
selectAno.addEventListener("change", () => {
  if (!canEdit()) return;
  criarCalendario();
  startRealtimeForSelectedMonth();
});

selectMes.addEventListener("change", () => {
  if (!canEdit()) return;
  criarCalendario();
  startRealtimeForSelectedMonth();
});

// =========================
// Iniciar
// =========================
selectAno.value = "2026";
selectMes.value = "0";
setUIAuth();
