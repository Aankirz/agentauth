/* ---- pixel guard dog: rendered from an editable map ---- */
// Legend -> theme colors. '.' is transparent.
const DOG_COLORS = {
  K: 'var(--ink)',
  F: 'var(--amber)',
  f: 'var(--amber-deep)',
  M: 'oklch(91% 0.05 80)',
  W: 'var(--paper)',
  T: 'var(--red)',
  C: 'var(--green)',
  B: 'var(--sky)',
};

// 16 wide x 18 tall — front-facing shepherd with a security-badge collar.
const DOG = [
  '.KK........KK...',
  '.KfK......KfK...',
  '.KFfK....KFfK...',
  '.KFFfKKKKFFfK...',
  '..KFFFFFFFFFK...',
  '.KFFFFFFFFFFFK..',
  '.KFFFFFFFFFFFK..',
  '.KFWKFFFFFWKFFK.',
  '.KFWKFFFFFWKFFK.',
  '.KFFFFFFFFFFFFK.',
  '.KFFFMMMMMMFFFK.',
  '..KFMMMKKMMMFK..',
  '..KFMMMKKMMMFK..',
  '...KMMTTTTMMK...',
  '...KFMMMMMMFK...',
  '..KCCCCCCCCCCK..',
  '..KCCBKKBCCK....',
  '...KKK..KKK.....',
];

function paintDog(el, map, px) {
  const w = Math.max(...map.map((r) => r.length));
  const h = map.length;
  let rects = '';
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = DOG_COLORS[row[x]];
      if (c) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`;
    }
  });
  el.innerHTML =
    `<svg class="${el.dataset.cls || ''}" width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}" ` +
    `shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Watchdog, the AgentAuth guard dog">${rects}</svg>`;
}

document.querySelectorAll('[data-dog]').forEach((el) => paintDog(el, DOG, Number(el.dataset.dog) || 10));

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
