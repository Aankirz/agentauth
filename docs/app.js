// Copy-to-clipboard for code blocks and the npm button.
function flash(btn, label = 'copied ✓') {
  const prev = btn.textContent;
  btn.textContent = label;
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = prev;
    btn.classList.remove('copied');
  }, 1400);
}

document.querySelectorAll('[data-copy-target]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const el = document.getElementById(btn.dataset.copyTarget);
    if (!el) return;
    await navigator.clipboard.writeText(el.innerText.trim());
    flash(btn);
  });
});

document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(btn.dataset.copy);
    flash(btn, 'copied ✓');
  });
});

// Reveal sections as they scroll into view.
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }
  },
  { threshold: 0.12 },
);
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
