const canvas = document.querySelector(".canvas");
const greeting = document.querySelector(".greeting");
const guide = document.querySelector(".guide");
const menu = document.querySelector(".top-menu");
const bubble = document.querySelector("#bubble");
const bubbleSize = document.querySelector("#bubble-size");
const typed = document.querySelector("#typed");
const speech = document.querySelector("#speech");
const avatar = document.querySelector(".avatar");
const clock = document.querySelector(".clock");
const sections = [...document.querySelectorAll("[data-line]")];
const farewellPhoto = document.querySelector(".farewell-photo");
const drumCards = [...document.querySelectorAll(".drum-card")].map((card) => ({
  card,
  pieces: [...card.querySelectorAll(".piece")],
}));
const drumStrips = new WeakMap();
const drumImages = new Map();
const drumBandFraction = .08;
const drumMaximumSqueeze = .08;
const drumCurveMaximum = Math.expm1(5);
let drumVideoPlaying = false;
const videos = [...document.querySelectorAll("video[data-src]")];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const smallScreen = matchMedia("(max-width: 650px)");
const introduction = typed.textContent;
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const time = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

let line = null;
let requestedLine = introduction;
let bubbleClosing = false;
let typingRun = 0;
let scrollFrame = 0;
let scrollDirty = true;
let layoutDirty = true;
let layout;
let activeSection = -1;
let heroY;
let heroVelocity = 0;
let lastFrameTime = 0;

const clampProgress = (value) => Math.max(0, Math.min(1, value));
const smoothProgress = (value) => value * value * (3 - 2 * value);

function updateClock() {
  if (smallScreen.matches) return;
  const now = new Date();
  clock.textContent = weekday.format(now).toUpperCase() + " " + time.format(now);
  clock.dateTime = now.toISOString();
}

function afterBubbleTransition(callback) {
  const animations = bubble.getAnimations();
  if (animations.length) {
    Promise.allSettled(animations.map((animation) => animation.finished)).then(callback);
  } else {
    requestAnimationFrame(() => requestAnimationFrame(callback));
  }
}

function showLine(text, { animate = true } = {}) {
  requestedLine = text;
  if (line === text && animate) return;
  const done = (message) => {
    typed.textContent = message;
    speech.textContent = message;
    bubble.dataset.state = "idle";
    avatar.removeAttribute("data-talking");
  };

  if (reduceMotion.matches || !animate) {
    typingRun++;
    line = text;
    bubbleClosing = false;
    bubbleSize.textContent = text;
    done(text);
    return;
  }

  if (bubbleClosing) return;
  const run = ++typingRun;
  bubbleClosing = true;
  avatar.removeAttribute("data-talking");
  bubble.dataset.state = "closed";
  afterBubbleTransition(() => {
    if (run !== typingRun) return;
    bubbleClosing = false;
    const message = requestedLine;
    line = message;
    bubbleSize.textContent = message;
    typed.textContent = "";
    bubble.dataset.state = "opening";
    afterBubbleTransition(() => {
      if (run !== typingRun) return;
      avatar.dataset.talking = "";
      bubble.dataset.state = "typing";
      const characters = Array.from(message);
      let start;
      let previousCount = 0;
      function type(now) {
        if (run !== typingRun) return;
        start ??= now;
        const count = Math.min(characters.length, 1 + Math.floor((now - start) / 20));
        if (count >= characters.length) {
          done(message);
          return;
        }
        if (count !== previousCount) {
          typed.textContent = characters.slice(0, count).join("");
          previousCount = count;
        }
        requestAnimationFrame(type);
      }
      requestAnimationFrame(type);
    });
  });
}

function getDrumImage(url) {
  if (!url) return null;
  if (!drumImages.has(url)) {
    const image = new Image();
    image.addEventListener("load", scheduleScroll, { once: true });
    image.src = url;
    drumImages.set(url, image);
  }
  const image = drumImages.get(url);
  return image.complete && image.naturalWidth ? image : null;
}

function getDrumSource({ piece, background }) {
  if (piece instanceof HTMLVideoElement) {
    return piece.readyState >= 2 ? piece : getDrumImage(piece.poster);
  }
  if (piece instanceof HTMLImageElement) {
    return piece.complete && piece.naturalWidth ? piece : null;
  }
  return getDrumImage(background);
}

function paintDrumPiece(context, item, source) {
  const { left, top, width, height, position, backgroundZoom, radius } = item;
  const sourceWidth = source.videoWidth || source.naturalWidth;
  const sourceHeight = source.videoHeight || source.naturalHeight;
  const zoom = backgroundZoom
    ? width * backgroundZoom / sourceWidth
    : Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * zoom;
  const drawHeight = sourceHeight * zoom;

  context.save();
  context.beginPath();
  context.roundRect(left, top, width, height, radius);
  context.clip();
  context.drawImage(source,
    left + (width - drawWidth) * position[0],
    top + (height - drawHeight) * position[1],
    drawWidth, drawHeight);
  context.restore();
}

function hideDrumStrip(strip) {
  if (!strip?.visible) return;
  strip.output.hidden = true;
  strip.visible = false;
  for (const piece of strip.clipped) piece.style.removeProperty("clip-path");
  strip.clipped.clear();
}

function createDrumStrip(card) {
  const output = document.createElement("canvas");
  output.className = "drum-strip";
  output.setAttribute("aria-hidden", "true");
  output.hidden = true;
  const source = document.createElement("canvas");
  card.append(output);
  return {
    output,
    source,
    outputContext: output.getContext("2d"),
    sourceContext: source.getContext("2d"),
    clipped: new Set(),
    visible: false,
    playing: false,
  };
}

function clipDrumPiece(item, bandTop, bandBottom) {
  const top = Math.max(0, bandTop - item.top);
  const bottom = Math.min(item.height, bandBottom - item.top);
  // Keep the original pixels on both sides of the strip.
  item.piece.style.clipPath = `polygon(0 0, 100% 0, 100% ${top}px, 0 ${top}px, 0 ${bottom}px, 100% ${bottom}px, 100% 100%, 0 100%)`;
}

function updateDrum(cards, y, layoutChanged) {
  const viewport = window.visualViewport;
  const height = viewport?.height || innerHeight;
  const viewportBottom = y + (viewport?.offsetTop ?? 0) + height;
  const bandHeight = height * drumBandFraction;
  const bandTop = viewportBottom - bandHeight;
  const feather = Math.min(8, bandHeight * .16);
  const density = Math.min(2, window.devicePixelRatio || 1);
  let playing = false;

  for (const { card, pageTop, left, width, pieces } of cards) {
    let strip = drumStrips.get(card);
    if (!layoutChanged && !strip?.playing) continue;

    const localTop = bandTop - pageTop;
    const localBottom = viewportBottom - pageTop;
    const items = pieces.filter((item) => item.top < localBottom && item.top + item.height > localTop);
    if (reduceMotion.matches || !items.length || width <= 0 || bandHeight <= 0) {
      hideDrumStrip(strip);
      if (strip) strip.playing = false;
      continue;
    }

    const media = items.map(getDrumSource);
    if (media.some((source) => !source)) {
      hideDrumStrip(strip);
      if (strip) strip.playing = false;
      continue;
    }

    if (!strip) {
      strip = createDrumStrip(card);
      drumStrips.set(card, strip);
    }
    strip.playing = media.some((source) => source instanceof HTMLVideoElement && !source.paused && !source.ended);
    playing ||= strip.playing;

    const pixelWidth = Math.ceil(width * density);
    const pixelHeight = Math.ceil(bandHeight * density);
    for (const layer of [strip.source, strip.output]) {
      if (layer.width !== pixelWidth) layer.width = pixelWidth;
      if (layer.height !== pixelHeight) layer.height = pixelHeight;
    }
    const { sourceContext, outputContext, output, source } = strip;
    sourceContext.resetTransform();
    sourceContext.clearRect(0, 0, pixelWidth, pixelHeight);
    const scaleX = pixelWidth / width;
    const scaleY = pixelHeight / bandHeight;
    sourceContext.setTransform(scaleX, 0, 0, scaleY, -left * scaleX, -localTop * scaleY);
    items.forEach((item, index) => paintDrumPiece(sourceContext, item, media[index]));

    outputContext.clearRect(0, 0, pixelWidth, pixelHeight);
    for (let row = 0; row < pixelHeight; row++) {
      const t = row / Math.max(1, pixelHeight - 1);
      const squeeze = drumMaximumSqueeze * Math.expm1(5 * t) / drumCurveMaximum;
      const rowWidth = pixelWidth * (1 - squeeze);
      outputContext.drawImage(source, 0, row, pixelWidth, 1, (pixelWidth - rowWidth) / 2, row, rowWidth, 1);
    }

    if (layoutChanged || !strip.visible) {
      Object.assign(output.style, {
        left: left + "px", top: localTop + "px", width: width + "px", height: bandHeight + "px",
      });
      output.style.setProperty("--drum-feather", feather + "px");
      for (const piece of strip.clipped) piece.style.removeProperty("clip-path");
      strip.clipped.clear();
      for (const item of items) {
        if (item.top + item.height <= localTop + feather) continue;
        clipDrumPiece(item, localTop + feather, localBottom);
        strip.clipped.add(item.piece);
      }
      output.hidden = false;
      strip.visible = true;
    }
  }
  return playing;
}

function measureLayout() {
  const mobile = smallScreen.matches;
  const unit = canvas.clientWidth / (mobile ? 390 : 1280);
  const height = innerHeight;
  const offset = scrollY;
  const triggers = sections.map((section) => {
    const top = section.getBoundingClientRect().top + offset;
    if (!section.classList.contains("farewell")) {
      return top - Math.min(mobile ? 240 : 330, height * .43);
    }
    let photoTop = top + 164 * unit;
    if (mobile) {
      const photo = farewellPhoto.getBoundingClientRect();
      // The transparent GIF has a border above the visible photograph.
      photoTop = photo.top + offset + photo.height / 3;
    }
    return photoTop - height * .82;
  });
  const cards = drumCards.map(({ card, pieces }) => {
    const box = card.getBoundingClientRect();
    const artwork = pieces.map((piece) => {
      const rect = piece.getBoundingClientRect();
      const style = getComputedStyle(piece);
      const background = style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
      const position = background ? style.backgroundPosition : style.objectPosition;
      const radius = style.borderTopLeftRadius.endsWith("%")
        ? { x: rect.width / 2, y: rect.height / 2 }
        : parseFloat(style.borderTopLeftRadius) || 0;
      return {
        piece, background, radius,
        left: rect.left - box.left, top: rect.top - box.top, width: rect.width, height: rect.height,
        position: position.split(" ").map((value) => parseFloat(value) / 100),
        backgroundZoom: background ? parseFloat(style.backgroundSize) / 100 : 0,
      };
    });
    const left = Math.min(...artwork.map((piece) => piece.left));
    const right = Math.max(...artwork.map((piece) => piece.left + piece.width));
    return { card, pageTop: box.top + offset, left, width: right - left, pieces: artwork };
  });
  return { mobile, unit, start: (mobile ? 246 : 226) * unit, triggers, cards };
}

function renderHero({ mobile, unit, start }, y) {
  const progress = clampProgress(y / Math.max(start, 1));
  const guideTop = Math.max(0, start - y) + "px";
  guide.style.setProperty("--guide-top", guideTop);
  guide.style.setProperty("--hero-progress", mobile ? smoothProgress(progress) : progress);
  if (mobile) {
    menu.style.setProperty("--mobile-contact-top", Math.max(18 * unit, 211 * unit - y) + "px");
    greeting.style.setProperty("--greeting-lift", -y + "px");
  } else {
    menu.style.setProperty("--guide-top", guideTop);
  }
  // Keep the bottom of the letters anchored above the guide while they shrink.
  const anchor = start - 18 * unit;
  greeting.style.setProperty("--greeting-anchor", anchor + "px");
  greeting.style.setProperty("--greeting-scale", Math.max(0, 1 - y / Math.max(anchor, 1)));
}

function updateScroll(now) {
  scrollFrame = 0;
  const layoutChanged = layoutDirty;
  if (layoutChanged) {
    const next = measureLayout();
    if (!layout || next.mobile !== layout.mobile || next.unit !== layout.unit) heroY = undefined;
    layout = next;
    layoutDirty = false;
  }

  const y = Math.max(0, scrollY);
  const target = Math.min(y, layout.start);
  const previousY = heroY;
  if (heroY === undefined || !layout.mobile || reduceMotion.matches) {
    heroY = target;
    heroVelocity = 0;
  } else if (heroY !== target || heroVelocity) {
    // A critically damped spring eases into movement and settles without bouncing.
    const dt = Math.min(24, Math.max(0, now - lastFrameTime));
    const rate = .024;
    const delta = heroY - target;
    const step = (heroVelocity + rate * delta) * dt;
    const decay = Math.exp(-rate * dt);
    const next = target + (delta + step) * decay;
    heroY = Math.max(0, Math.min(layout.start, next));
    heroVelocity = next === heroY ? (heroVelocity - rate * step) * decay : 0;
    if (Math.abs(heroY - target) < .1 && Math.abs(heroVelocity) < .01) {
      heroY = target;
      heroVelocity = 0;
    }
  }
  lastFrameTime = now;
  if (layoutChanged || previousY !== heroY) renderHero(layout, heroY);

  const drumGeometryChanged = scrollDirty || layoutChanged;
  if (drumGeometryChanged) {
    scrollDirty = false;
    let nextSection = -1;
    for (const [index, trigger] of layout.triggers.entries()) {
      const tolerance = layout.mobile ? (index <= activeSection ? -12 : 12) : 0;
      if (y >= trigger + tolerance) nextSection = index;
    }
    activeSection = nextSection;
    showLine(sections[activeSection]?.dataset.line ?? introduction);
  }
  if (drumGeometryChanged || drumVideoPlaying) {
    drumVideoPlaying = updateDrum(layout.cards, y, drumGeometryChanged);
  }
  if (heroY !== target || heroVelocity || drumVideoPlaying) queueScrollFrame();
}

function queueScrollFrame() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
}

function scheduleScroll() {
  scrollDirty = true;
  queueScrollFrame();
}

function refreshLayout() {
  layoutDirty = true;
  queueScrollFrame();
}

function stickerFrame(sticker) {
  const frame = sticker.offsetParent;
  const bounds = frame.getBoundingClientRect();
  return { frame, bounds, scaleX: bounds.width / frame.offsetWidth };
}

function placeSticker(sticker, frame, x, y) {
  const startX = sticker.offsetLeft;
  const startY = sticker.offsetTop;
  const maxX = Math.max(startX, frame.clientWidth - sticker.offsetWidth);
  const maxY = Math.max(startY, frame.clientHeight - sticker.offsetHeight);
  const left = Math.max(0, Math.min(maxX, x));
  const top = Math.max(0, Math.min(maxY, y));
  const unit = canvas.clientWidth / 100;
  sticker.style.translate = `${(left - startX) / unit}cqw ${(top - startY) / unit}cqw`;
}

function bringStickerForward(sticker) {
  sticker.parentElement.querySelector(".sticker[data-front]")?.removeAttribute("data-front");
  sticker.dataset.front = "";
}

const stickerSteps = new Map([
  ["ArrowLeft", [-12, 0]], ["ArrowRight", [12, 0]],
  ["ArrowUp", [0, -12]], ["ArrowDown", [0, 12]],
]);

for (const sticker of document.querySelectorAll(".sticker")) {
  let drag;

  sticker.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const bounds = sticker.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
    sticker.setPointerCapture(drag.id);
    bringStickerForward(sticker);
    sticker.dataset.dragging = "";
    event.preventDefault();
  });

  sticker.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    const { frame, bounds, scaleX } = stickerFrame(sticker);
    const x = (event.clientX - bounds.left) / scaleX - drag.x * sticker.offsetWidth;
    const y = event.clientY - bounds.top - drag.y * sticker.offsetHeight;
    placeSticker(sticker, frame, x, y);
  });

  sticker.addEventListener("lostpointercapture", (event) => {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    sticker.removeAttribute("data-dragging");
  });

  sticker.addEventListener("keydown", (event) => {
    const step = stickerSteps.get(event.key);
    if (!step || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const { frame, bounds, scaleX } = stickerFrame(sticker);
    const position = sticker.getBoundingClientRect();
    const x = (position.left - bounds.left + step[0]) / scaleX;
    const y = position.top - bounds.top + step[1];
    placeSticker(sticker, frame, x, y);
    bringStickerForward(sticker);
  });
}

function syncVideo(video) {
  if (!reduceMotion.matches && video.dataset.visible === "true") {
    if (!video.getAttribute("src")) video.src = video.dataset.src;
    video.muted = true;
    video.play().catch(() => {
      // Leave the poster visible if the browser blocks autoplay.
    });
  } else {
    video.pause();
    if (reduceMotion.matches && video.hasAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }
  }
}

for (const { pieces } of drumCards) {
  for (const piece of pieces) {
    if (piece instanceof HTMLImageElement) piece.addEventListener("load", scheduleScroll);
    if (piece instanceof HTMLVideoElement) {
      for (const event of ["loadeddata", "play", "pause", "emptied"]) piece.addEventListener(event, scheduleScroll);
    }
  }
}

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      entry.target.dataset.visible = String(entry.isIntersecting);
      syncVideo(entry.target);
    }
  });
  videos.forEach((video) => observer.observe(video));
} else {
  videos.forEach((video) => {
    video.dataset.visible = "true";
    syncVideo(video);
  });
}

addEventListener("scroll", scheduleScroll, { passive: true });
addEventListener("resize", refreshLayout, { passive: true });
window.visualViewport?.addEventListener("resize", scheduleScroll, { passive: true });
window.visualViewport?.addEventListener("scroll", scheduleScroll, { passive: true });
addEventListener("pageshow", refreshLayout);
if ("ResizeObserver" in window) {
  const observer = new ResizeObserver(refreshLayout);
  observer.observe(canvas);
  observer.observe(document.querySelector(".token-cover"));
}
reduceMotion.addEventListener("change", () => {
  showLine(requestedLine, { animate: false });
  videos.forEach(syncVideo);
  scheduleScroll();
});
canvas.dataset.mobileMotion = "";
updateClock();
setInterval(updateClock, 250);
updateScroll(performance.now());
