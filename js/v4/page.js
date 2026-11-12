import { mountFilm } from "./film.js";

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const film = document.getElementById("film");
const visit = document.getElementById("visit");
if (!reduced.matches && "IntersectionObserver" in window) mountFilm(film, visit);

const workbench = document.getElementById("services");
const figure = workbench.querySelector(".specimen");
const view = figure.querySelector(".specimen__view");
const canvas = figure.querySelector("canvas");
const poster = figure.querySelector("img");
const label = figure.querySelector(".specimen__label");
const cta = document.getElementById("service-cta");
const buttons = [...workbench.querySelectorAll("button[data-part]")];
const details = [...workbench.querySelectorAll("[data-detail]")];
const explode = figure.querySelector("[data-explode]");

const parts = {
  fitment: {
    label: "Wheel & hub", poster: 158, alt: "Close-up of the Charger’s front wheel", topic: "wheel fitment",
  },
  brakes: {
    label: "Rotor & caliper", poster: 247, alt: "Red brake caliper and drilled rotor", topic: "brake upgrades",
  },
  suspension: {
    label: "Coilover", poster: 332, alt: "Adjustable coilover with a red spring", topic: "suspension setups",
  },
};

let selected = "fitment";
let viewer;
let attempted = false;
let visible = false;

function showPart(key) {
  selected = key;
  const part = parts[key];
  figure.dataset.part = key;
  label.textContent = part.label;
  poster.alt = part.alt;
  const source = `img/film/d/${part.poster}.webp`;
  if (poster.getAttribute("src") !== source) poster.src = source;
  cta.href = `sms:+13478132779?&body=${encodeURIComponent(`Hi Yakuza Garage, I'd like to ask about ${part.topic}.`)}`;
  for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.part === key));
  for (const detail of details) detail.hidden = detail.dataset.detail !== key;
  explode.setAttribute("aria-pressed", "false");
  try {
    viewer?.select(key);
  } catch (error) {
    showPoster(error);
  }
}

function showPoster(error) {
  if (error) console.warn("The 3D workbench is unavailable.", error);
  viewer?.setVisible(false);
  viewer = null;
  delete figure.dataset.live;
}

async function loadWorkbench() {
  if (attempted) return;
  attempted = true;
  try {
    const { createWorkbench } = await import("./workbench.js");
    viewer = createWorkbench(canvas, { reduced, onLost: showPoster });
    viewer.select(selected);
    viewer.setVisible(visible);
    figure.dataset.live = "";
  } catch (error) {
    showPoster(error);
  }
}

for (const button of buttons) {
  button.addEventListener("click", () => {
    if (button.dataset.part !== selected) showPart(button.dataset.part);
    loadWorkbench();
  });
}
for (const button of figure.querySelectorAll("[data-turn]")) {
  button.addEventListener("click", () => viewer?.turn(Number(button.dataset.turn)));
}
explode.addEventListener("click", () => {
  const open = explode.getAttribute("aria-pressed") !== "true";
  explode.setAttribute("aria-pressed", String(open));
  viewer?.explode(open);
});

showPart(selected);
workbench.dataset.enhanced = "";
if ("IntersectionObserver" in window) {
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    viewer?.setVisible(visible);
    if (visible) loadWorkbench();
  }, { rootMargin: "160px 0px" }).observe(view);
} else {
  visible = true;
  loadWorkbench();
}
