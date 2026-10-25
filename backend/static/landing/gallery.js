(() => {
  const gallery = document.querySelector('[data-gallery]');
  const controls = document.querySelector('.gallery-filters');
  const status = document.querySelector('[data-gallery-status]');
  if (!gallery || !controls || !status) return;
  const labels = {
    all: 'Three photographs. One point of view.',
    day: 'Daylight — two photographs.',
    night: 'After dark — one photograph.',
  };
  controls.hidden = false;
  controls.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button || !controls.contains(button)) return;
    const filter = button.dataset.filter;
    if (!Object.hasOwn(labels, filter)) return;
    controls.querySelectorAll('button').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    gallery.dataset.view = filter;
    gallery.querySelectorAll('[data-category]').forEach((photo) => {
      photo.hidden = filter !== 'all' && photo.dataset.category !== filter;
    });
    status.textContent = labels[filter];
  });
})();
