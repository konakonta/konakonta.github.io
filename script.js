const canvas = document.querySelector(".canvas");
const greeting = document.querySelector(".greeting");
const bubble = document.querySelector("#bubble");
const bubbleSize = document.querySelector("#bubble-size");
const typed = document.querySelector("#typed");
const speech = document.querySelector("#speech");
const avatar = document.querySelector("#liza");
const clock = document.querySelector(".clock");
const sections = [...document.querySelectorAll("[data-line]")];
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
let typingRun = 0;
let scrollFrame = 0;

function updateClock() {
  const now = new Date();
  clock.textContent = weekday.format(now).toUpperCase() + " " + time.format(now);
  clock.dateTime = now.toISOString();
}

function showLine(text, { animate = true } = {}) {
  if (line === text && animate) return;
  line = text;
  const run = ++typingRun;
  bubbleSize.textContent = text;
  const done = () => {
    typed.textContent = text;
    speech.textContent = text;
    bubble.dataset.state = "idle";
    avatar.src = "./liza-blink.gif";
  };

  if (reduceMotion.matches || !animate) {
    done();
    return;
  }

  typed.textContent = "";
  avatar.src = "./liza-blink.gif";
  bubble.dataset.state = "closed";
  setTimeout(() => {
    if (run !== typingRun) return;
    bubble.dataset.state = "opening";
    setTimeout(() => {
      if (run !== typingRun) return;
      avatar.src = "./liza-talk.gif";
      bubble.dataset.state = "typing";
      const characters = Array.from(text);
      const start = performance.now();
      function type(now) {
        if (run !== typingRun) return;
        const count = Math.min(characters.length, 1 + Math.floor((now - start) / 20));
        typed.textContent = characters.slice(0, count).join("");
        if (count < characters.length) requestAnimationFrame(type);
        else done();
      }
      requestAnimationFrame(type);
    }, 170);
  }, 125);
}

function updateScroll() {
  scrollFrame = 0;
  const mobile = smallScreen.matches;
  const width = canvas.clientWidth;
  const unit = width / (mobile ? 390 : 1280);
  const start = (mobile ? 246 : 226) * unit;
  // Anchor the bottom of the letters 18 design pixels above the guide.
  const greetingBottom = start - 18 * unit;
  const y = Math.max(0, scrollY);
  const progress = Math.min(1, y / Math.max(start, 1));

  canvas.style.setProperty("--guide-top", Math.max(0, start - y) + "px");
  canvas.style.setProperty("--hero-progress", progress);
  greeting.style.setProperty("--greeting-anchor", greetingBottom + "px");
  greeting.style.setProperty("--greeting-scale", Math.max(0, 1 - y / Math.max(greetingBottom, 1)));

  let active = introduction;
  const projectLine = Math.min(mobile ? 240 : 330, innerHeight * .43);
  for (const section of sections) {
    const top = section.getBoundingClientRect().top;
    if (section.classList.contains("farewell")) {
      const photoInset = (mobile ? 392 : 164) * unit;
      if (top + photoInset <= innerHeight * .82) active = section.dataset.line;
    } else if (top <= projectLine) {
      active = section.dataset.line;
    }
  }
  showLine(active);
}

function scheduleScroll() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
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
addEventListener("resize", scheduleScroll, { passive: true });
addEventListener("pageshow", scheduleScroll);
reduceMotion.addEventListener("change", () => {
  showLine(line ?? introduction, { animate: false });
  videos.forEach(syncVideo);
});
updateClock();
setInterval(updateClock, 250);
updateScroll();
