/* ---- generic pixel-map painter -> crisp SVG ---- */
function paintPixels(el, map, colors, px, label) {
  const w = Math.max(...map.map((r) => r.length));
  const h = map.length;
  let rects = '';
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colors[row[x]];
      if (c) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`;
    }
  });
  el.innerHTML =
    `<svg width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}" ` +
    `shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">${rects}</svg>`;
}

/* ---- pixel guard dog (front-facing shepherd, security-badge collar) ---- */
const DOG_COLORS = {
  K: 'var(--ink)', F: 'var(--amber)', f: 'var(--amber-deep)',
  M: 'oklch(91% 0.05 80)', W: 'var(--paper)', T: 'var(--red)', C: 'var(--green)', B: 'var(--sky)',
};
const DOG = [
  '.KK........KK...', '.KfK......KfK...', '.KFfK....KFfK...', '.KFFfKKKKFFfK...',
  '..KFFFFFFFFFK...', '.KFFFFFFFFFFFK..', '.KFFFFFFFFFFFK..', '.KFWKFFFFFWKFFK.',
  '.KFWKFFFFFWKFFK.', '.KFFFFFFFFFFFFK.', '.KFFFMMMMMMFFFK.', '..KFMMMKKMMMFK..',
  '..KFMMMKKMMMFK..', '...KMMTTTTMMK...', '...KFMMMMMMFK...', '..KCCCCCCCCCCK..',
  '..KCCBKKBCCK....', '...KKK..KKK.....',
];
document.querySelectorAll('[data-dog]').forEach((el) =>
  paintPixels(el, DOG, DOG_COLORS, Number(el.dataset.dog) || 10, 'Watchdog, the AgentAuth guard dog'),
);

/* ---- paw print (woven through the page as the dog "theme")
   4 toe beans in an arc above a rounded pad ---- */
const PAW = [
  '...PP.PP...',
  '...PP.PP...',
  'PP.......PP',
  'PP.......PP',
  '...PPPPPP..',
  '..PPPPPPPP.',
  '..PPPPPPPP.',
  '..PPPPPPPP.',
  '...PPPPPP..',
  '....PPPP...',
];
document.querySelectorAll('[data-paw]').forEach((el) => {
  const color = el.dataset.pawColor || 'var(--amber-deep)';
  paintPixels(el, PAW, { P: color }, Number(el.dataset.paw) || 2, 'paw print');
});

/* ---- theme toggle (initial theme set inline in <head> to avoid flash) ---- */
const root = document.documentElement;
const toggle = document.getElementById('theme-toggle');
function syncLabel() {
  if (toggle) toggle.textContent = root.getAttribute('data-theme') === 'dark' ? 'LIGHT' : 'DARK';
}
syncLabel();
if (toggle) {
  toggle.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('aa-theme', next); } catch {}
    syncLabel();
  });
}

/* ---- copy buttons ---- */
function flash(btn, label = 'copied ✓') {
  const prev = btn.textContent;
  btn.textContent = label;
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = prev; btn.classList.remove('copied'); }, 1300);
}
document.querySelectorAll('[data-copy-target]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const el = document.getElementById(btn.dataset.copyTarget);
    if (el) { await navigator.clipboard.writeText(el.innerText.trim()); flash(btn); }
  }),
);
document.querySelectorAll('[data-copy]').forEach((btn) =>
  btn.addEventListener('click', async () => { await navigator.clipboard.writeText(btn.dataset.copy); flash(btn); }),
);

/* ---- scroll reveal ---- */
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
