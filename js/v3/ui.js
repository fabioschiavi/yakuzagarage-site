/* v3: camada DOM ao vivo (seção 6). Uma frase e uma linha pequena por vez, ação SMS persistente com sublinhado a pincel,
   alternador mola/bolsa no B4, bloco de contato no fim da trilha. Toda a copy vem de spec.js; nada daqui toca o canvas. */
import * as emblem from "./emblem.js"; // namespace: tolera MARK_SVG ainda não exportado
import { COPY, BEATS } from "./spec.js";
import { BRUSH, svgPath, smsHref, serviceName, buildAction, buildMark, buildContact, bindContact, drawLine } from "./fallback.js";

const COPY_KEYS = ["hero", "fitment", "brake", "suspension", "orbit", "carlinhos"];
const KEYS = new Set(BEATS.map((b) => b.key));
// id "B1".."B6" -> trechos daquele id, montado uma vez: setBeat roda todo quadro e não pode alocar
const BY_ID = new Map();
for (const b of BEATS) { if (!BY_ID.has(b.id)) BY_ID.set(b.id, []); BY_ID.get(b.id).push(b); }
const IDLE_MS = 4000;
const SWAP_MS = 160;
const SMS_CTX = ["general", "fitment", "brake", "coil", "air"];
const SAFETY_REVEAL_MS = 6000; // o loader fecha em 3 s + 0.7 s de íris; isto só pega boot que esqueceu de revelar

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** id: chave de beat ("hero"...), id "B1".."B6" (t = progresso global p desempata B5 e B6) ou índice em BEATS. */
function resolveKey(id, t) {
  if (id == null || id === "") return null;
  if (typeof id === "number") return (BEATS[id] && BEATS[id].key) || null;
  if (KEYS.has(id)) return id;
  const hits = BY_ID.get(id);
  if (!hits) return null;
  const last = hits[hits.length - 1];
  if (typeof t === "number" && isFinite(t)) {
    for (let i = 0; i < hits.length; i++) if (t >= hits[i].p[0] && t < hits[i].p[1]) return hits[i].key;
    if (t >= last.p[1]) return last.key;
  }
  return hits[0].key;
}

const beatSms = (key, mode) => {
  if (key === "suspension") return mode;
  const b = BEATS.find((x) => x.key === key);
  return (b && b.sms) || "general";
};

/**
 * createUI(root) -> { setBeat(id, t), setMode('coil'|'air'), setSmsContext(key), showContact(t), setTogglePos(y, visible),
 *                     onMode(fn), onService(fn), setHint(text|null), reveal(), el }
 */
export function createUI(root) {
  const doc = root.ownerDocument, win = doc.defaultView, html = doc.documentElement;
  const reduced = !!(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
  root.classList.add("v3-ui");

  /* ---- marca ---- */
  const mark = buildMark(doc, emblem.MARK_SVG);

  /* ---- frases: todas no DOM, na ordem (leitor de tela lê tudo), só uma visível ---- */
  const copyBox = el(doc, "div", "v3-copy");
  const groups = {};
  const modeHandlers = new Set(), serviceHandlers = new Set();
  const svcButtons = []; // botões de serviço do B5: só entram na ordem do Tab enquanto o B5 está na tela
  for (const k of COPY_KEYS) {
    const c = COPY[k], g = el(doc, "div", "v3-beat");
    g.dataset.key = k;
    const statement = el(doc, "h2", "v3-statement", c.statement);
    const small = el(doc, "p", "v3-small", c.small || "");
    g.append(statement, small);
    if (k === "orbit") {
      // os rótulos do anel são textura no canvas; aqui viram botões reais só para leitor de tela e teclado
      const ul = el(doc, "ul", "v3-sr");
      for (const l of COPY.orbitLabels) {
        const li = el(doc, "li"), b = el(doc, "button", null, l.text);
        b.type = "button"; b.tabIndex = -1;
        b.addEventListener("click", () => { setSmsContext(l.text); serviceHandlers.forEach((fn) => fn(l.text)); });
        svcButtons.push(b);
        li.append(b); ul.append(li);
      }
      g.append(ul);
    }
    groups[k] = { el: g, small, def: c.small || "", swapT: 0 };
    copyBox.append(g);
  }

  /* ---- alternador mola / bolsa: dois glifos e uma barra, sem caixa ---- */
  const toggle = el(doc, "div", "v3-toggle");
  toggle.setAttribute("role", "group");
  toggle.setAttribute("aria-label", "Coilovers or air bag installs");
  const mkBtn = (m, label, glyph) => {
    const b = el(doc, "button");
    b.type = "button"; b.dataset.mode = m;
    b.setAttribute("aria-label", label);
    b.append(svgPath(doc, glyph));
    b.addEventListener("click", () => {
      if (m === mode) return;
      setMode(m);
      modeHandlers.forEach((fn) => fn(m));
    });
    return b;
  };
  const coilBtn = mkBtn("coil", "Coilovers", BRUSH.coil);
  const airBtn = mkBtn("air", "Air bag installs", BRUSH.air);
  toggle.append(coilBtn, svgPath(doc, BRUSH.slash, "v3-slash"), airBtn);

  /* ---- ação persistente ---- */
  const action = buildAction(doc, "general");
  const actionLine = action.querySelector(".v3-uline");

  root.append(mark, copyBox, toggle, action);

  /* ---- contato: o estático do v3.html; se faltar, entra no fim da trilha ---- */
  let contact = doc.getElementById("v3-contact");
  if (!contact) {
    contact = buildContact(doc);
    (doc.getElementById("v3-track") || doc.body).append(contact);
  }
  const contactApi = bindContact(contact);

  /* ---- estado ---- */
  let key = null, beatSet = false, mode = "coil", smsOverride = null, contactT = 0;
  let togY = 0, togVisible = false, revealed = !html.classList.contains("v3-loading");
  let togOn = null, togPx = NaN, href = ""; // último estado escrito no DOM: setTogglePos e setBeat rodam todo quadro

  // setBeat(null) esconde tudo, inclusive a ação; antes do 1º setBeat a ação já vale (corpo geral)
  const actionWanted = () => !(beatSet && key === null) && key !== "contact" && contactT <= 0;
  // lê a classe ao vivo: o boot pode tirar v3-loading sozinho sem chamar reveal()
  const actionVisible = () => !html.classList.contains("v3-loading") && actionWanted();

  function applyAction() {
    action.classList.toggle("is-hidden", !actionWanted());
  }
  function applySms() {
    const h = smsHref(smsOverride || beatSms(key, mode));
    if (h !== href) { href = h; action.href = h; }
  }
  function applyToggle() {
    const on = togVisible && key === "suspension";
    if (on !== togOn) { togOn = on; toggle.classList.toggle("is-on", on); }
    const px = Math.round(togY);
    if (on && px !== togPx) { togPx = px; toggle.style.transform = `translate3d(0,${px}px,0)`; }
  }
  function redraw() { if (actionVisible()) drawLine(actionLine, reduced); }

  function setSmall(g, text) {
    const s = g.small;
    clearTimeout(g.swapT);
    if (s.textContent === text) { s.classList.remove("is-swap"); return; }
    if (reduced || !g.el.classList.contains("is-on")) { s.textContent = text; s.classList.remove("is-swap"); return; }
    // troca dentro do mesmo beat: some, troca, volta (nunca duas linhas pequenas)
    s.classList.add("is-swap");
    g.swapT = setTimeout(() => { s.textContent = text; s.classList.remove("is-swap"); }, SWAP_MS);
  }

  function setBeat(id, t) {
    const k = resolveKey(id, t);
    if (k === key && beatSet) return;
    beatSet = true;
    const prev = key && groups[key];
    if (prev) prev.el.classList.remove("is-on");
    key = k;
    const g = key && groups[key];
    if (g) {
      // volta ao texto padrão enquanto ainda está invisível
      clearTimeout(g.swapT);
      g.small.textContent = g.def;
      g.small.classList.remove("is-swap");
      g.el.classList.add("is-on");
    }
    // leitor de tela segue lendo a lista; só o Tab deixa de parar em botão de beat invisível
    for (const b of svcButtons) b.tabIndex = key === "orbit" ? 0 : -1;
    smsOverride = null; // um serviço tocado no B5 vale só dentro do B5
    applySms(); applyAction(); applyToggle();
    redraw();
  }

  function setMode(m) {
    mode = m === "air" ? "air" : "coil";
    coilBtn.setAttribute("aria-pressed", String(mode === "coil"));
    airBtn.setAttribute("aria-pressed", String(mode === "air"));
    applySms();
  }

  /** key: "general" | "fitment" | "brake" | "coil" | "air" | nome de serviço dos fatos | null (volta ao do beat). */
  function setSmsContext(k) {
    // nome fora dos fatos vira o corpo geral (nunca texto inventado no SMS)
    smsOverride = k == null ? null : (SMS_CTX.includes(k) ? k : serviceName(k) || "general");
    applySms();
  }

  /** t: 0..1 da entrada do contato (p 0.88..1). Qualquer t > 0 tira a ação persistente. */
  function showContact(t) {
    const v = Math.max(0, Math.min(1, +t || 0));
    const was = contactT > 0;
    contactT = v;
    if (was !== v > 0) applyAction();
    if (v >= 0.5) contactApi.drawRing();
  }

  /** y em px CSS da mola projetada na tela; visível só vale dentro do B4. */
  function setTogglePos(y, visible) {
    togY = +y || 0;
    togVisible = !!visible;
    applyToggle();
  }

  /** Troca a linha pequena do beat atual. null volta ao padrão; "" esconde (o anel do freio assume depois da 1ª pressão). */
  function setHint(text) {
    const g = key && groups[key];
    if (!g) return;
    setSmall(g, text == null ? g.def : String(text));
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    html.classList.remove("v3-loading");
    redraw();
  }

  /* ---- 4 s parado: o sublinhado se redesenha uma vez, até o próximo gesto ---- */
  let idleT = 0;
  const poke = () => { clearTimeout(idleT); idleT = setTimeout(redraw, IDLE_MS); };
  for (const ev of ["scroll", "pointerdown", "wheel", "keydown", "touchstart"]) win.addEventListener(ev, poke, { passive: true });
  poke();
  if (!revealed) setTimeout(reveal, SAFETY_REVEAL_MS);

  setMode("coil");
  applySms(); applyAction(); applyToggle();

  return {
    setBeat, setMode, setSmsContext, showContact, setTogglePos, setHint, reveal,
    onMode(fn) { modeHandlers.add(fn); return () => modeHandlers.delete(fn); },
    onService(fn) { serviceHandlers.add(fn); return () => serviceHandlers.delete(fn); },
    el: root,
    get beat() { return key; },
    get mode() { return mode; },
  };
}
