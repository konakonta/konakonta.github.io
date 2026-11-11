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
  pieces: card.classList.contains("drum-collage") ? [...card.querySelectorAll(".piece:not(.sticker)")] : [card],
}));
const drumScales = new WeakMap();
const drumCurveMaximum = Math.expm1(5);
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

function updateDrum(cards, y) {
  if (reduceMotion.matches) return;

  const viewport = window.visualViewport;
  const height = viewport?.height || innerHeight;
  const viewportTop = y + (viewport?.offsetTop ?? 0);
  for (const { card, pageBottom } of cards) {
    const bottom = pageBottom - viewportTop;
    const t = clampProgress((bottom / height - .62) / .38);
    const scale = 1 - .08 * Math.expm1(5 * t) / drumCurveMaximum;
    if (scale === drumScales.get(card)) continue;
    drumScales.set(card, scale);
    card.style.setProperty("--drum-scale", scale);
  }
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
    const pageBottom = Math.max(...pieces.map((piece) => piece.getBoundingClientRect().bottom)) + offset;
    if (pieces.length === 1) return { card, pageBottom };
    const left = Math.min(...pieces.map((piece) => piece.offsetLeft));
    const right = Math.max(...pieces.map((piece) => piece.offsetLeft + piece.offsetWidth));
    return { card, pageBottom, origin: (left + right) / 2 };
  });
  for (const { card, origin } of cards) {
    if (origin !== undefined) card.style.setProperty("--drum-origin", origin + "px");
  }
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

  if (scrollDirty || layoutChanged) {
    scrollDirty = false;
    let nextSection = -1;
    for (const [index, trigger] of layout.triggers.entries()) {
      const tolerance = layout.mobile ? (index <= activeSection ? -12 : 12) : 0;
      if (y >= trigger + tolerance) nextSection = index;
    }
    activeSection = nextSection;
    updateDrum(layout.cards, y);
    showLine(sections[activeSection]?.dataset.line ?? introduction);
  }
  if (heroY !== target || heroVelocity) queueScrollFrame();
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
