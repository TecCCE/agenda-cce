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

const meses = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function pad2(n) { return String(n).padStart(2, "0"); }

function keyDia(ano, mes, dia) {
  return `${ano}-${pad2(mes + 1)}-${pad2(dia)}`;
}

function lerDia(key) {
  try {
    const raw = localStorage.getItem("agenda:" + key);
    return raw ? JSON.parse(raw) : { eventos: [] };
  } catch {
    return { eventos: [] };
  }
}

function gravarDia(key, obj) {
  localStorage.setItem("agenda:" + key, JSON.stringify(obj));
}

function apagarDia(key) {
  localStorage.removeItem("agenda:" + key);
}

function estadoAgregado(eventos) {
  if (eventos.some(e => e.estado === "confirmado")) return "confirmado";
  if (eventos.some(e => e.estado === "provisorio")) return "provisorio";
  return "nenhum";
}

/* 🔹 NOVA VERSÃO — MOSTRA TODOS OS NOMES */
function textoBadge(eventos) {
  const nomes = eventos
    .map(e => (e.evento || "").trim())
    .filter(Boolean);

  if (nomes.length === 0) return "";

  return nomes.join(", ");
}

/* Preencher anos */
for (let ano = 2026; ano <= 2030; ano++) {
  const option = document.createElement("option");
  option.value = String(ano);
  option.textContent = String(ano);
  selectAno.appendChild(option);
}

/* Preencher meses */
meses.forEach((nomeMes, index) => {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = nomeMes;
  selectMes.appendChild(option);
});

/* Criar calendário */
function criarCalendario() {
  calendario.innerHTML = "";

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
    const dados = lerDia(k);
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

    div.addEventListener("click", () => abrirDia(dia, mes, ano));
    calendario.appendChild(div);
  }
}

/* Modal */
let diaAtualKey = null;

function abrirModal() { overlay.classList.remove("hidden"); }

function fecharModal() {
  overlay.classList.add("hidden");
  diaAtualKey = null;
  listaEventos.innerHTML = "";
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

  card.querySelector(".btnRemover").addEventListener("click", () => {
    card.remove();
    renumerarEventos();
  });

  return card;
}

function renumerarEventos() {
  const cards = [...listaEventos.querySelectorAll(".evento-card")];

  cards.forEach((c, i) => {
    const titulo = c.querySelector(".evento-titulo");
    if (titulo) titulo.textContent = `Evento #${i + 1}`;
    c.style.order = i;
  });
}

function abrirDia(dia, mes, ano) {
  diaAtualKey = keyDia(ano, mes, dia);
  modalData.textContent = `Dia ${dia} de ${meses[mes]} de ${ano} (${diaAtualKey})`;

  listaEventos.innerHTML = "";

  const dados = lerDia(diaAtualKey);
  const eventos = Array.isArray(dados.eventos) ? dados.eventos : [];

  if (eventos.length === 0) {
    listaEventos.appendChild(
      criarCardEvento({ estado: "nenhum", dataEvento: diaAtualKey }, 1)
    );
  } else {
    eventos.forEach((ev, idx) => {
      if (!ev.dataEvento) ev.dataEvento = diaAtualKey;
      listaEventos.appendChild(criarCardEvento(ev, idx + 1));
    });
  }

  abrirModal();
}

/* + Adicionar evento */
btnAdicionarEvento?.addEventListener("click", () => {
  const count = listaEventos.querySelectorAll(".evento-card").length;
  listaEventos.appendChild(
    criarCardEvento({ estado: "nenhum", dataEvento: diaAtualKey }, count + 1)
  );
  renumerarEventos();
});

/* Guardar todos os eventos do dia */
btnGuardarDia?.addEventListener("click", () => {
  if (!diaAtualKey) return;

  const cards = [...listaEventos.querySelectorAll(".evento-card")];

  const eventos = cards
    .map(card => {
      const obj = {};
      card.querySelectorAll("[name]").forEach(el => (obj[el.name] = el.value));
      return obj;
    })
    .filter(ev =>
      (ev.evento && ev.evento.trim() !== "") ||
      (ev.clienteEmpresa && ev.clienteEmpresa.trim() !== "")
    );

  if (eventos.length === 0) apagarDia(diaAtualKey);
  else gravarDia(diaAtualKey, { eventos });

  fecharModal();
  criarCalendario();
});

/* Apagar todos os eventos do dia */
btnApagarDia?.addEventListener("click", () => {
  if (!diaAtualKey) return;
  apagarDia(diaAtualKey);
  fecharModal();
  criarCalendario();
});

/* Fechar modal */
btnFechar?.addEventListener("click", fecharModal);
btnCancelar?.addEventListener("click", fecharModal);

overlay?.addEventListener("click", (e) => {
  if (e.target === overlay) fecharModal();
});

/* Atualizar calendário */
selectAno.addEventListener("change", criarCalendario);
selectMes.addEventListener("change", criarCalendario);

/* Iniciar */
selectAno.value = "2026";
selectMes.value = "0";
criarCalendario();
