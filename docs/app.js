/* ---- clean vector paw print (woven through as the dog motif) ---- */
function paintPaw(el, color, px) {
  el.innerHTML =
    `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="${color}" ` +
    `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="paw">` +
    `<ellipse cx="6.5" cy="9" rx="2.4" ry="3.1"/>` +
    `<ellipse cx="10.4" cy="5.6" rx="2.3" ry="3.1"/>` +
    `<ellipse cx="14.6" cy="5.6" rx="2.3" ry="3.1"/>` +
    `<ellipse cx="18" cy="9" rx="2.4" ry="3.1"/>` +
    `<path d="M12 11.4c3.2 0 5.6 2.1 5.6 4.7 0 2.2-1.9 3.4-4 3.4-0.7 0-1.1-0.3-1.6-0.3s-0.9 0.3-1.6 0.3c-2.1 0-4-1.2-4-3.4 0-2.6 2.4-4.7 5.6-4.7z"/>` +
    `</svg>`;
}
document.querySelectorAll('[data-paw]').forEach((el) =>
  paintPaw(el, el.dataset.pawColor || 'currentColor', Number(el.dataset.paw) || 18),
);

/* ---- theme toggle (initial theme set inline in <head> to avoid flash) ---- */
const root = document.documentElement;
const toggle = document.getElementById('theme-toggle');
function syncToggle() {
  if (toggle) toggle.textContent = root.getAttribute('data-theme') === 'dark' ? '☀' : '☾';
}
syncToggle();
if (toggle) {
  toggle.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('aa-theme', next); } catch {}
    syncToggle();
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
