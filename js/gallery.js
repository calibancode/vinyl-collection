// Standalone gallery renderer for pages without the turntable
(function() {
  const wrap = document.getElementById('fav-gallery');
  const sec = document.getElementById('favorites');

  if (!wrap || !sec || typeof favImages === 'undefined') return;

  let idx = 0;
  const batchSize = 6;

  function addBatch() {
    const end = Math.min(idx + batchSize, favImages.length);
    for (; idx < end; idx++) {
      const item = favImages[idx];
      const src = item.src;
      const full = item.full ?? item.dataFull ?? item['data-full'] ?? null;
      const alt = item.alt || '';

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.setAttribute('fetchpriority', 'low');
      img.src = src;
      img.alt = alt;

      const a = document.createElement('a');
      a.href = full || src;
      a.target = '_blank';
      a.rel = 'noopener';
      a.appendChild(img);

      wrap.appendChild(a);
    }

    if (idx < favImages.length) {
      const fn = window.requestIdleCallback || ((cb) => setTimeout(cb, 0));
      fn(addBatch, { timeout: 1500 });
    }
  }

  // Start rendering when the section is near viewport
  const rect = sec.getBoundingClientRect();
  const inView = rect.top < (window.innerHeight || 0) && rect.bottom > 0;

  if (inView) {
    addBatch();
  } else {
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        addBatch();
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(sec);
  }
})();
