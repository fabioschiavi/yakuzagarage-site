const clamp = (value) => Math.max(0, Math.min(1, value));
const mix = (start, end, progress) => start + (end - start) * progress;
const portion = (progress, start, end) => clamp((progress - start) / (end - start));

const FIRST = 42;
const LAST = 363;
const OUTRO_FIRST = 369;
const OUTRO_LAST = 453;
const CHAPTERS = [0, .24, .50, .74];
const CHAPTER_STOPS = [0, .34, .59, .85];
const CUT_BEFORE = 202;
const CUT_AFTER = 220;

// These are frame numbers in the 24 fps WebP export of the 4K master.
const TIMELINE = [
  [0, FIRST], [.12, 81], [.32, 151], [.47, 202],
  [.53, 220], [.69, 280], [.74, 313], [1, LAST],
];

function frameAt(progress) {
  for (let index = 1; index < TIMELINE.length; index++) {
    const [end, last] = TIMELINE[index];
    if (progress > end) continue;
    const [start, first] = TIMELINE[index - 1];
    if (first === CUT_BEFORE) return progress < CHAPTERS[2] ? first : last;
    return Math.round(mix(first, last, portion(progress, start, end)));
  }
  return LAST;
}

function createFrames(set, first, last, limit, invalidate) {
  // Quadros como ImageBitmap já decodificados: desenhar um <img> recém-baixado decodifica na hora do drawImage,
  // no meio do quadro (medido: ~17 ms no desktop, bem mais no celular). O bitmap desenha em ~4 ms.
  const url = (index) => `img/film/${set}/${String(index).padStart(3, "0")}.webp`;
  const valid = (index) => index >= first && index <= last && (index <= CUT_BEFORE || index >= CUT_AFTER);
  const canBitmap = typeof createImageBitmap === "function";
  const bytes = new Map();
  const fetching = new Map();
  const images = new Map();
  const pending = new Set();
  const unavailable = new Set();
  let queue = [];
  let wanted = first;
  let heading = 1;
  let shown = null;
  let disposed = false;

  function blobOf(index, priority = "high") {
    if (bytes.has(index)) return Promise.resolve(bytes.get(index));
    if (!fetching.has(index)) {
      fetching.set(index, fetch(url(index), { priority }).then((response) => {
        if (!response.ok) throw new Error(response.status);
        return response.blob();
      }).then((blob) => { bytes.set(index, blob); return blob; }).finally(() => fetching.delete(index)));
    }
    return fetching.get(index);
  }

  function decode(index) {
    if (!canBitmap) {
      const img = new Image();
      img.src = url(index);
      return img.decode().then(() => img);
    }
    return blobOf(index).then((blob) => createImageBitmap(blob));
  }

  function evict() {
    while (images.size > limit) {
      let far = null;
      for (const key of images.keys()) if (far === null || Math.abs(key - wanted) > Math.abs(far - wanted)) far = key;
      const image = images.get(far);
      images.delete(far);
      if (image !== shown && image.close) image.close();
    }
  }

  function pump() {
    while (!disposed && pending.size < 4 && queue.length) {
      const index = queue.shift();
      if (images.has(index) || pending.has(index) || unavailable.has(index)) continue;
      pending.add(index);
      decode(index).then((image) => {
        if (disposed || Math.abs(index - wanted) > 25) { if (image.close) image.close(); return; }
        images.set(index, image);
        evict();
        invalidate();
      }).catch(() => unavailable.add(index)).finally(() => {
        pending.delete(index);
        pump();
      });
    }
  }

  // Baixa os bytes do filme inteiro em segundo plano, na ordem do scroll: depois disso rolar só espera decodificar.
  let prefetchStarted = false;
  function prefetch() {
    if (prefetchStarted || disposed) return;
    prefetchStarted = true;
    let cursor = first;
    const next = () => {
      while (!disposed && cursor <= last && (bytes.has(cursor) || !valid(cursor))) cursor++;
      if (disposed || cursor > last) return;
      const index = cursor++;
      blobOf(index, "low").catch(() => unavailable.add(index)).finally(next);
    };
    for (let lane = 0; lane < 3; lane++) next();
  }

  function request(index) {
    if (index !== wanted) heading = Math.sign(index - wanted);
    wanted = index;
    const offsets = [0, 1, 3, 6, -1, 2, -3, 9, 4, 5, -6, 12, 15, 18];
    queue = offsets.map((offset) => index + offset * heading).filter(valid);
    pump();
    if (!prefetchStarted) setTimeout(prefetch, 700);
  }

  function nearest(index) {
    let found = images.get(index);
    for (let offset = 1; !found && offset <= 12; offset++) {
      for (const candidate of [index - offset * heading, index + offset * heading]) {
        if ((candidate <= CUT_BEFORE) !== (index <= CUT_BEFORE)) continue;
        if (images.has(candidate)) { found = images.get(candidate); break; }
      }
    }
    if (found) shown = found;
    return found || null;
  }

  return {
    request,
    nearest,
    dispose() {
      disposed = true;
      for (const image of images.values()) if (image.close) image.close();
      images.clear(); bytes.clear(); queue = [];
    },
  };
}

function makeSurface(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let lastImage;
  let width = 0;
  let height = 0;
  // Tamanho em CSS px guardado pelo ResizeObserver: ler clientWidth a cada quadro forçava layout no meio do scroll.
  let cssWidth = canvas.clientWidth;
  let cssHeight = canvas.clientHeight;
  new ResizeObserver(([entry]) => {
    cssWidth = entry.contentRect.width;
    cssHeight = entry.contentRect.height;
  }).observe(canvas);

  function paint(image, layout, opacity = 1) {
    if (!image && !lastImage) return;
    if (image) lastImage = image;
    if (!(lastImage.naturalWidth || lastImage.width)) return; // bitmap já liberado: mantém o quadro que está na tela
    const dpr = Math.min(devicePixelRatio || 1, 2, 2400 / Math.max(1, cssWidth));
    const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
    const nextHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (width !== nextWidth || height !== nextHeight) {
      canvas.width = width = nextWidth;
      canvas.height = height = nextHeight;
      ctx.imageSmoothingQuality = "high";
    }

    const { scale, x, y, mask, mobile } = layout;
    const img = lastImage;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const cover = mobile ? width / iw : Math.max(width / iw, height / ih);
    const w = iw * cover * scale;
    const h = ih * cover * scale;
    const left = width * x - w / 2;
    const top = height * y - h / 2;
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = opacity;
    ctx.drawImage(img, left, top, w, h);
    ctx.globalAlpha = 1;

    if (mask > 0) {
      const gradient = ctx.createLinearGradient(0, top, 0, top + h * (mobile ? .53 : .57));
      gradient.addColorStop(0, `rgba(0,0,0,${mask})`);
      gradient.addColorStop(mobile ? .20 / .53 : .30 / .57, `rgba(0,0,0,${mask})`);
      gradient.addColorStop(1, "transparent");
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
    }
    if (mobile) {
      // No celular o quadro 16:9 ocupa só a faixa do meio: sem isto as bordas de cima e de baixo do vídeo viram linhas duras no preto.
      const top0 = Math.max(0, top), bottom0 = Math.min(height, top + h), fade = h * .16;
      ctx.globalCompositeOperation = "destination-out";
      const upper = ctx.createLinearGradient(0, top0, 0, top0 + fade);
      upper.addColorStop(0, "#000"); upper.addColorStop(1, "transparent");
      ctx.fillStyle = upper; ctx.fillRect(0, top0, width, fade);
      const lower = ctx.createLinearGradient(0, bottom0 - fade, 0, bottom0);
      lower.addColorStop(0, "transparent"); lower.addColorStop(1, "#000");
      ctx.fillStyle = lower; ctx.fillRect(0, bottom0 - fade, width, fade);
      ctx.globalCompositeOperation = "source-over";
    }
    canvas.dataset.painted = "";
  }

  return { paint };
}

export function mountFilm(film, visit) {
  const stage = film.querySelector(".film__stage");
  const surface = makeSurface(film.querySelector(".film__canvas"));
  const outroSurface = makeSurface(visit.querySelector(".visit__canvas"));
  if (!surface) return;

  const hero = film.querySelector(".film__hero");
  const panels = [...film.querySelectorAll("[data-panel]")];
  const chapters = [...film.querySelectorAll(".film__chapters a")];
  const mobileQuery = matchMedia("(max-width: 700px) and (orientation: portrait)");
  let mobile = mobileQuery.matches;
  let progress = 0;
  let travel = 1;
  let filmTop = 0;
  let lastTime = 0;
  let raf = 0;
  let dirty = true;
  let inFilm = false;
  let inOutro = false;
  let shot = 0;
  let frames = makeIntro();
  let outroFrames;
  let previousIndex = -1;
  let paintedIndex = -1;
  let previousOutroIndex = -1;

  function makeIntro() {
    return createFrames(mobile ? "m" : "d", FIRST, LAST, mobile ? 13 : 20, invalidate);
  }

  function invalidate() {
    dirty = true;
    schedule();
  }

  function schedule() {
    if (!raf && (inFilm || inOutro)) raf = requestAnimationFrame(draw);
  }

  function showChapter(index) {
    if (shot === index) return;
    shot = index;
    stage.dataset.shot = String(index);
    hero.hidden = index !== 0;
    for (const panel of panels) panel.hidden = Number(panel.dataset.panel) !== index;
    chapters.forEach((link, chapter) => {
      if (chapter === index) link.setAttribute("aria-current", "step");
      else link.removeAttribute("aria-current");
    });
  }

  function draw(now) {
    raf = 0;
    const dt = lastTime ? Math.min(64, now - lastTime) : 16;
    lastTime = now;
    let unsettled = false;

    if (inFilm) {
      const target = clamp((scrollY - filmTop) / travel);
      const delta = target - progress;
      unsettled = Math.abs(delta) > .00025;
      if (unsettled || dirty) {
        progress = unsettled ? progress + delta * (1 - Math.exp(-dt / 75)) : target;
        const index = frameAt(progress);
        const reveal = portion(progress, .06, .24);
        const titleExit = portion(progress, .025, .17);
        const shade = 1 - portion(progress, .464, .50) + portion(progress, .50, .544);
        const isolated = portion(progress, .48, .56);
        const x = mobile ? .5 : mix(.5, .69, isolated);
        const image = frames.nearest(index);
        const crossedCut = (paintedIndex <= CUT_BEFORE) !== (index <= CUT_BEFORE);
        // Hold the dip to black while the first frame across the cut decodes.
        if (image) paintedIndex = index;
        surface.paint(image, {
          mobile,
          x,
          y: mobile ? mix(.48, .42, reveal) : mix(.58, .49, reveal),
          scale: mobile ? mix(1.26, 1.52, reveal) : mix(1.32, 1.13, reveal),
          mask: 1 - reveal,
        }, crossedCut && !image ? 0 : shade);
        if (index !== previousIndex) {
          frames.request(index);
          previousIndex = index;
        }
        let chapter = CHAPTERS.length - 1;
        while (progress < CHAPTERS[chapter]) chapter--;
        showChapter(chapter);
        stage.style.setProperty("--film-progress", progress.toFixed(4));
        stage.style.setProperty("--title-opacity", (1 - titleExit).toFixed(3));
        stage.style.setProperty("--title-rise", `-${(titleExit * 22).toFixed(2)}%`);
      }
    }

    if (inOutro && outroFrames) {
      const bounds = visit.getBoundingClientRect();
      const reveal = clamp((innerHeight - bounds.top) / Math.max(1, bounds.height));
      const index = Math.round(mix(OUTRO_FIRST, OUTRO_LAST, reveal));
      if (dirty || index !== previousOutroIndex) {
        outroSurface.paint(outroFrames.nearest(index), { mobile: true, x: .5, y: .5, scale: 1.05, mask: 0 });
        if (index !== previousOutroIndex) outroFrames.request(index);
        previousOutroIndex = index;
      }
    }

    dirty = false;
    if (unsettled) schedule();
  }

  function measure() {
    filmTop = film.getBoundingClientRect().top + scrollY;
    travel = Math.max(1, film.offsetHeight - stage.offsetHeight);
    invalidate();
  }

  for (const mark of film.querySelectorAll("[data-chapter]")) {
    mark.style.setProperty("--stop", CHAPTER_STOPS[Number(mark.dataset.chapter)]);
  }
  film.dataset.scrub = "";
  stage.dataset.moving = "";
  measure();
  frames.request(FIRST);
  progress = clamp((scrollY - filmTop) / travel);

  new IntersectionObserver(([entry]) => {
    inFilm = entry.isIntersecting;
    if (inFilm) {
      progress = clamp((scrollY - filmTop) / travel);
      invalidate();
    }
  }, { rootMargin: "120px 0px" }).observe(film);

  if (outroSurface) {
    new IntersectionObserver(([entry]) => {
      inOutro = entry.isIntersecting;
      if (inOutro) {
        outroFrames ??= createFrames("d", OUTRO_FIRST, OUTRO_LAST, 14, invalidate);
        invalidate();
      }
    }, { rootMargin: "200px 0px" }).observe(visit);
  }

  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", measure, { passive: true });
  mobileQuery.addEventListener("change", () => {
    mobile = mobileQuery.matches;
    frames.dispose();
    frames = makeIntro();
    previousIndex = -1;
    measure();
  });
}
