/* v3: fallback sem WebGL2 (ou contexto perdido) e as peças de DOM que ui.js reaproveita.
   Só importa spec.js de propósito: se three, emblem ou o boot quebrarem, este módulo ainda sobe e o contato continua tocável. */
import { FACTS, COPY, SMS } from "./spec.js";

const SVGNS = "http://www.w3.org/2000/svg";

/* Traços à mão. Números quebrados de propósito: reta e círculo perfeitos leem como ícone de sistema, não pincel.
   viewBox no tamanho de uso, para o traço escalar ~1:1 sem vector-effect (que quebra o dash com pathLength). */
export const BRUSH = {
  underline: { vb: "0 0 112 8", w: 2, d: "M1.6 5.3C17.8 4.2 34.6 6.4 55.2 5.2S89.4 3.5 101.3 4.6C105.6 5 108.2 4.5 110.6 3.1" },
  underlineWide: { vb: "0 0 330 14", w: 2, d: "M3.2 8.7C52.4 6.5 104.8 10.6 162.5 8.4S262.1 5.2 298.6 7.3C310.4 8 319.8 7 327.1 4.4" },
  // laço que passa do ponto de partida, como quem circula uma palavra com pincel
  ring: { vb: "0 0 400 130", w: 3, d: "M58.4 30.6C121.2 10.1 289.5 5.8 351.7 26.3C392.6 39.4 394.8 84.7 349.2 100.8C281.6 124.5 117.9 124.1 51.6 104.2C9.8 91.4 7.6 46.2 45.9 32.4C78.1 20.6 121.7 15.2 160.3 13.4" },
  // mola: zigue-zague de hélice vista de lado
  coil: { vb: "0 0 28 28", w: 1.6, d: "M8.6 4.4C12.9 4.8 16.8 5.5 19.6 6.4C15.5 7.8 11.7 9.1 8.3 10.7C12.7 11.4 16.7 12.3 19.9 13.3C15.7 14.7 11.8 16.1 8.5 17.6C12.6 18.3 16.4 19.2 19.5 20.3C15.8 21.6 12.2 22.8 9.1 24" },
  // bolsa de ar: duas convoluções com o anel de cintura no meio, pratos em cima e embaixo
  air: { vb: "0 0 28 28", w: 1.6, d: "M8.4 4.3C12.1 3.9 16.2 4.1 19.8 4.6M9.6 4.7C4.5 6.7 4.4 11.8 9.1 13.8C4.3 15.9 4.8 21.2 9.8 23.4M18.6 4.8C23.7 6.9 23.4 11.9 18.9 13.9C23.6 16.1 23.1 21.1 18.3 23.3M9.2 13.9C12.5 13.6 15.7 13.7 18.9 14M8.1 23.6C11.9 23.9 16.1 23.8 19.9 23.4" },
  slash: { vb: "0 0 8 28", w: 1, d: "M6.3 5.2L1.8 22.9" },
};

export function svgPath(doc, { vb, d, w }, cls) {
  const svg = doc.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", vb);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (cls) svg.setAttribute("class", cls);
  const p = doc.createElementNS(SVGNS, "path");
  p.setAttribute("d", d);
  p.setAttribute("pathLength", "1"); // dash em fração: 1 = apagado, 0 = desenhado
  p.setAttribute("stroke-width", String(w));
  svg.appendChild(p);
  return svg;
}

/* ---------------- SMS, mapa ---------------- */
const SMS_KEYS = ["general", "fitment", "brake", "coil", "air"];
// só serviços que estão nos fatos viram corpo de SMS: nada inventado entra no texto
const SERVICES = [...new Set([...FACTS.services, ...COPY.orbitLabels.map((l) => l.text)])];

export function serviceName(s) {
  if (typeof s !== "string") return null;
  const t = s.trim().toLowerCase();
  return SERVICES.find((x) => x.toLowerCase() === t) || null;
}

export function smsBody(key) {
  if (key && SMS_KEYS.includes(key)) return SMS[key];
  const svc = serviceName(key);
  // inicial minúscula porque entra no meio da frase; o resto fica como está nos fatos
  if (svc) return SMS.serviceTemplate.replace("{service}", svc.charAt(0).toLowerCase() + svc.slice(1));
  return SMS.general;
}

export const smsHref = (key) => SMS.hrefPrefix + encodeURIComponent(smsBody(key));

export function isIOS(nav = globalThis.navigator) {
  if (!nav) return false;
  // iPadOS se apresenta como Mac; o toque denuncia
  return /iPad|iPhone|iPod/.test(nav.userAgent || "") || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}

const googleSearch = (q) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
// só a consulta do endereço: nada do visitante vai na URL
export const mapsHref = (ios = isIOS()) => (ios ? "https://maps.apple.com/?q=" + encodeURIComponent(FACTS.addressLine) : googleSearch(FACTS.addressLine));
export const ratingHref = () => googleSearch(FACTS.mapsQuery);

/* ---------------- peças de DOM ---------------- */
const reducedMotion = (win) => !!(win && win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Redesenha um traço por stroke-dashoffset (1 -> 0). Sem movimento: aparece inteiro. */
export function drawLine(svg, reduced) {
  const p = svg && svg.querySelector("path");
  if (!p) return;
  if (reduced || typeof p.animate !== "function") { p.style.strokeDashoffset = "0"; return; }
  if (p.getAnimations) p.getAnimations().forEach((a) => a.cancel());
  p.animate([{ strokeDashoffset: "1" }, { strokeDashoffset: "0" }], { duration: 650, easing: "cubic-bezier(.6,0,.2,1)", fill: "forwards" });
}

/** "Text the shop" persistente, embaixo à direita. */
export function buildAction(doc, key = "general") {
  const a = el(doc, "a", "v3-act");
  a.href = smsHref(key);
  a.append(el(doc, "span", "v3-act__t", COPY.persistentAction), svgPath(doc, BRUSH.underline, "v3-uline"));
  return a;
}

/** Marca persistente: o SVG do emblem quando existe, senão o mark.svg como imagem. Decorativa. */
export function buildMark(doc, markSvg) {
  const box = el(doc, "div", "v3-mark");
  box.setAttribute("aria-hidden", "true");
  setMark(box, markSvg);
  return box;
}

export function setMark(box, markSvg) {
  const src = typeof markSvg === "function" ? markSvg() : markSvg;
  if (typeof src === "string" && /<svg[\s>]/i.test(src)) { box.innerHTML = src; }
  else if (src && src.nodeType === 1) { box.replaceChildren(src.cloneNode(true)); }
  else {
    const img = el(box.ownerDocument, "img");
    // mark.svg (só máscara e katanas, osso): o logo.webp traz YAKUZA GARAGE NYC em letras, que a 28 px viram borrão
    img.src = new URL("../../img/mark.svg", import.meta.url).href;
    img.alt = ""; img.width = 28; img.height = 28; img.decoding = "async";
    box.replaceChildren(img);
  }
  const svg = box.querySelector("svg");
  if (svg) { svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); }
}

/** Bloco de contato, igual ao estático do v3.html (para quando ele não estiver na página). */
export function buildContact(doc) {
  const s = el(doc, "section", "v3-contact");
  s.id = "v3-contact";
  s.setAttribute("aria-label", "Contact");
  const C = COPY.contact;
  const sms = el(doc, "a", "v3-contact__sms");
  sms.href = smsHref("general");
  sms.append(el(doc, "span", "v3-contact__txt", C.action), svgPath(doc, BRUSH.ring, "v3-ring"), svgPath(doc, BRUSH.underlineWide, "v3-uline"));
  const addr = el(doc, "a", "v3-contact__line", C.address);
  addr.href = mapsHref(false); addr.setAttribute("data-v3-maps", "");
  const tel = el(doc, "a", "v3-contact__line", C.phone);
  tel.href = "tel:" + FACTS.phoneE164;
  const hours = el(doc, "p", "v3-contact__note", C.hours);
  const rate = el(doc, "a", "v3-contact__note v3-contact__rate", C.rating);
  rate.href = ratingHref(); rate.target = "_blank"; rate.rel = "noopener";
  s.append(sms, addr, tel, hours, rate);
  return s;
}

/** Liga o bloco de contato: mapa certo por plataforma, SMS geral, anel vermelho desenhado uma vez na entrada. */
export function bindContact(section) {
  const doc = section.ownerDocument, win = doc.defaultView;
  const sms = section.querySelector(".v3-contact__sms");
  if (sms) sms.href = smsHref("general");
  const maps = section.querySelector("[data-v3-maps]");
  if (maps) {
    const ios = isIOS(win && win.navigator);
    maps.href = mapsHref(ios);
    // Apple Maps abre o app pelo link universal; o Google vai para aba nova para não perder a página
    if (ios) { maps.removeAttribute("target"); maps.removeAttribute("rel"); }
    else { maps.target = "_blank"; maps.rel = "noopener"; }
  }
  let drawn = false, io = null;
  const drawRing = () => {
    if (drawn || !sms) return;
    drawn = true;
    sms.classList.add("is-drawn");
    if (io) io.disconnect();
  };
  if (sms && win && "IntersectionObserver" in win) {
    io = new win.IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) drawRing(); }, { threshold: 0.9 });
    io.observe(sms);
  } else drawRing();
  return { drawRing, get drawn() { return drawn; } };
}

/* ---------------- fallback (seção 8) ---------------- */
const FB_ORDER = ["hero", "fitment", "brake", "suspension", "orbit", "carlinhos"];

/**
 * mountFallback(root, reason): emblema parado no anel, pôster, a mesma copy na mesma ordem, o mesmo contato e a ação SMS.
 * Rolagem nativa; cada trecho entra por opacidade. Esconde trilha, canvas, loader e UI ao vivo pela classe v3-fallback no <html>.
 */
export function mountFallback(root, reason = "nowebgl") {
  const doc = (root && root.ownerDocument) || globalThis.document;
  if (!doc) return;
  root = root || doc.body;
  if (doc.querySelector(".v3-fb")) return;
  const win = doc.defaultView, html = doc.documentElement, reduced = reducedMotion(win);
  html.classList.remove("v3-loading");
  html.classList.add("v3-fallback");

  const fb = el(doc, "div", "v3-fb");
  fb.dataset.reason = reason === "contextlost" ? "contextlost" : "nowebgl";

  // 1. o loader parado: oni dentro do anel inteiro, o mesmo visual do v2
  const em = el(doc, "div", "v3-fb__emblem");
  em.setAttribute("aria-hidden", "true");
  const stage = el(doc, "div", "v3-fb__stage");
  const ring = el(doc, "img", "v3-fb__ring");
  ring.src = new URL("../../img/ring.webp", import.meta.url).href; ring.alt = ""; ring.width = 900; ring.height = 900;
  const oni = el(doc, "img", "v3-fb__oni");
  oni.src = new URL("../../img/oni.webp", import.meta.url).href; oni.alt = ""; oni.width = 870; oni.height = 1000;
  stage.append(ring, oni); em.append(stage);

  // 2. pôster do quadro herói ao vivo; se ainda não existir, some sem buraco
  const fig = el(doc, "figure", "v3-fb__poster");
  const poster = el(doc, "img");
  poster.src = new URL("../../img/poster-v3.webp", import.meta.url).href;
  poster.alt = "Forged wheel, red brake caliper and red coilover spring on a black stone slab.";
  poster.width = 1080; poster.height = 1920; poster.decoding = "async";
  poster.addEventListener("error", () => fig.remove(), { once: true });
  fig.append(poster);

  // 3. a copy, na ordem dos beats
  const beats = FB_ORDER.map((k) => {
    const c = COPY[k], sec = el(doc, "section", "v3-fb__beat");
    sec.append(el(doc, "h2", "v3-statement", c.statement));
    // "Hold anywhere" ensina um gesto que aqui não existe: fica de fora
    const small = k === "brake" ? "" : c.small;
    if (small) sec.append(el(doc, "p", "v3-small", small));
    return sec;
  });

  // 4. o contato: move o estático da trilha (que vai sumir) ou constrói
  const contact = doc.getElementById("v3-contact") || buildContact(doc);
  const contactApi = bindContact(contact);

  // 5. marca e ação fixas
  const fixed = el(doc, "div", "v3-fb__fixed");
  const mark = buildMark(doc, undefined);
  const action = buildAction(doc, "general");
  fixed.append(mark, action);

  fb.append(em, fig, ...beats, contact, fixed);
  root.appendChild(fb);

  // marca do emblem se o módulo estiver são; se não, fica o logo
  import("./emblem.js").then((m) => { if (m && m.MARK_SVG) setMark(mark, m.MARK_SVG); }).catch(() => {});

  if (reduced || !win || !("IntersectionObserver" in win)) {
    beats.forEach((b) => b.classList.add("is-in"));
  } else {
    const io = new win.IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle("is-in", e.isIntersecting)), { threshold: 0.35 });
    beats.forEach((b) => io.observe(b));
  }
  // a ação some quando o bloco de contato assume, como no ao vivo
  if (win && "IntersectionObserver" in win) {
    const io2 = new win.IntersectionObserver((es) => es.forEach((e) => {
      action.classList.toggle("is-hidden", e.isIntersecting);
      if (e.isIntersecting) contactApi.drawRing();
    }), { threshold: 0.25 });
    io2.observe(contact);
  }
  drawLine(action.querySelector(".v3-uline"), reduced);
  if (fb.dataset.reason === "contextlost" && win) win.scrollTo(0, 0);
}
