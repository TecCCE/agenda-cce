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

/* ========= Firebase Config ========= */
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

/* ========= DOM ========= */
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

/* ========= Utils ========= */
const meses = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function pad2(n) { return String(n).padStart(2, "0"); }
function normalizeEmail(s) { return String(s || "").trim(); }

function keyDia(ano, mes, dia) {
  return `${ano}-${pad2(mes + 1)}-${pad2(dia)}`;
}

function startEndKeys(ano, mes) {
  const start = `${ano}-${pad2(mes + 1)}-01`;
  const last = new Date(ano, mes + 1, 0).getDate();
  const end = `${ano}-${pad2(mes + 1)}-${pad2(last)}`;
  return { start, end };
}

function estadoAgregado(eventos) {
  if (eventos.some(e => e.estado === "confirmado")) return "confirmado";
  if (eventos.some(e => e.estado === "provisorio")) return "provisorio";
  if (eventos.some(e => e.estado === "segunda_opcao")) return "segunda_opcao";
  return "nenhum";
}

function textoBadge(eventos) {
  const nomes = eventos.map(e => (e.evento || "").trim()).filter(Boolean);
  if (nomes.length === 0) return "";
  return nomes.join(", ");
}

/* ========= Estado ========= */
let user = null;
let allowed = false;

let monthData = new Map();
let unsubMonth = null;

let diaAtualKey = null;
let unsubDay = null;

/* ========= Helpers UI bloqueio ========= */
function setUIEnabled(enabled) {
  // bloquear botões do modal
  btnAdicionarEvento.disabled = !enabled;
  btnGuardarDia.disabled = !enabled;
  btnApagarDia.disabled = !enabled;

  // opcional: dar feedback visual (se tiveres CSS)
  btnAdicionarEvento.style.opacity = enabled ? "1" : "0.5";
  btnGuardarDia.style.opacity = enabled ? "1" : "0.5";
  btnApagarDia.style.opacity = enabled ? "1" : "0.5";
}

function renderMensagem(texto) {
  calendario.innerHTML = "";
  const msg = document.createElement("div");
  msg.style.gridColumn = "1 / -1";
  msg.style.padding = "12px";
  msg.style.color = "#333";
  msg.style.fontWeight = "700";
  msg.textContent = texto;
  calendario.appendChild(msg);
}

function canEdit() {
  return !!user && allowed;
}

/* ========= AUTH ========= */
btnLogin.addEventListener("click", async () => {
  const email = normalizeEmail(emailInput.value);
  const password = passInput.value;

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

btnLogout.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (u) => {
  user = u || null;

  if (!user) {
    allowed = false;
    authStatus.textContent = "Não autenticado";
    btnLogout.classList.add("hidden");
    btnLogin.classList.remove("hidden");

    stopRealtime();
    fecharModal();
    setUIEnabled(false);
    renderMensagem("Faz login para ver e editar a agenda.");
    return;
  }

  authStatus.textContent = `Autenticado: ${user.email}`;
  btnLogout.classList.remove("hidden");
  btnLogin.classList.add("hidden");

  allowed = await checkAllowlist(user.email);

  if (!allowed) {
    stopRealtime();
    fecharModal();
    setUIEnabled(false);
    renderMensagem("Sem permissão. O teu email não está autorizado.");
    alert("Sem permissão: o teu email não está na allowlist.");
    return;
  }

  setUIEnabled(true);
  startRealtimeForSelectedMonth();
});

async function checkAllowlist(email) {
  try {
    const ref = doc(db, "allowlist", normalizeEmail(email));
    const snap = await getDoc(ref);
    return snap.exists();
  } catch (e) {
    console.error(e);
    return false;
  }
}

/* ========= REALTIME ========= */
function stopRealtime() {
  if (unsubMonth) { unsubMonth(); unsubMonth = null; }
  if (unsubDay) { unsubDay(); unsubDay = null; }
  monthData = new Map();
}

function startRealtimeForSelectedMonth() {
  if (!canEdit()) return;

  if (unsubMonth) { unsubMonth(); unsubMonth = null; }
  monthData = new Map();

  const ano = Number(selectAno.value);
  const mes = Number(selectMes.value);
  const { start, end } = startEndKeys(ano, mes);

  const diasRef = collection(db, "dias");
  const q = query(
    diasRef,
    where(FieldPath.documentId(), ">=", start),
    where(FieldPath.documentId(), "<=", end)
  );

  unsubMonth = onSnapshot(q, (snap) => {
    const newMap = new Map();
    snap.forEach(d => newMap.set(d.id, d.data()));
    monthData = newMap;
    criarCalendario();
  }, (err) => {
    console.error(err);
    alert("Erro a ouvir alterações do mês (Firestore).");
  });
}

/* ========= Preencher selects ========= */
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

/* ========= CALENDÁRIO ========= */
function criarCalendario() {
  calendario.innerHTML = "";

  if (!canEdit()) {
    renderMensagem(user ? "Sem permissão." : "Faz login para ver e editar a agenda.");
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
    const dados = monthData.get(k) || { eventos: [] };
    const eventos = Array.isArray(dados.eventos) ? dados.eventos : [];

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

    // ✅ Agora só abre dia se autenticado+allowed (aqui já é)
    div.addEventListener("click", () => abrirDia(dia, mes, ano));
    calendario.appendChild(div);
  }
}

selectAno.addEventListener("change", () => canEdit() && startRealtimeForSelectedMonth());
selectMes.addEventListener("change", () => canEdit() && startRealtimeForSelectedMonth());

/* ========= MODAL ========= */
function abrirModal() { overlay.classList.remove("hidden"); }
function fecharModal() {
  overlay.classList.add("hidden");
  diaAtualKey = null;
  listaEventos.innerHTML = "";
  if (unsubDay) { unsubDay(); unsubDay = null; }
}

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

  for (const [k, v] of Object.entries(evento)) {
    const el = card.querySelector(`[name="${k}"]`);
    if (el) el.value = v ?? "";
  }

  const btnRem = card.querySelector(".btnRemover");
  btnRem.addEventListener("click", () => {
    if (!canEdit()) return;
    card.remove();
    renumerarEventos();
  });

  // ✅ Se não pode editar, desativa inputs
  if (!canEdit()) {
    card.querySelectorAll("input, select, textarea, button").forEach(el => el.disabled = true);
  }

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

function abrirDia(dia, mes, ano) {
  if (!canEdit()) {
    alert("Tens de fazer login para editar.");
    return;
  }

  diaAtualKey = keyDia(ano, mes, dia);
  modalData.textContent = `Dia ${dia} de ${meses[mes]} de ${ano} (${diaAtualKey})`;

  if (unsubDay) { unsubDay(); unsubDay = null; }

  const ref = doc(db, "dias", diaAtualKey);
  unsubDay = onSnapshot(ref, (snap) => {
    const dados = snap.exists() ? snap.data() : { eventos: [] };
    const eventos = Array.isArray(dados.eventos) ? dados.eventos : [];
    monthData.set(diaAtualKey, { eventos });
    renderEventosNoModal(eventos, diaAtualKey);
    criarCalendario();
  });

  abrirModal();
}

/* + Adicionar evento */
btnAdicionarEvento.addEventListener("click", () => {
  if (!canEdit()) return;
  const count = listaEventos.querySelectorAll(".evento-card").length;
  listaEventos.appendChild(criarCardEvento({ estado: "nenhum", dataEvento: diaAtualKey }, count + 1));
  renumerarEventos();
});

/* Guardar */
btnGuardarDia.addEventListener("click", async () => {
  if (!canEdit() || !diaAtualKey) return;

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
      await deleteDoc(doc(db, "dias", diaAtualKey));
      monthData.delete(diaAtualKey);
    } else {
      await setDoc(doc(db, "dias", diaAtualKey), { eventos }, { merge: true });
      monthData.set(diaAtualKey, { eventos });
    }
    fecharModal();
    criarCalendario();
  } catch (e) {
    console.error(e);
    alert("Erro a guardar no Firestore.");
  }
});

/* Apagar dia */
btnApagarDia.addEventListener("click", async () => {
  if (!canEdit() || !diaAtualKey) return;

  try {
    await deleteDoc(doc(db, "dias", diaAtualKey));
    monthData.delete(diaAtualKey);
    fecharModal();
    criarCalendario();
  } catch (e) {
    console.error(e);
    alert("Erro a apagar no Firestore.");
  }
});

/* Fechar */
btnFechar.addEventListener("click", fecharModal);
btnCancelar.addEventListener("click", fecharModal);
overlay.addEventListener("click", (e) => { if (e.target === overlay) fecharModal(); });

/* Iniciar */
selectAno.value = "2026";
selectMes.value = "0";
setUIEnabled(false);
renderMensagem("Faz login para ver e editar a agenda.");

