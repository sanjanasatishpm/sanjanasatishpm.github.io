// Theme toggle (remembers choice, falls back to system preference)
(function () {
  const root = document.documentElement;
  const toggle = document.querySelector('.theme-toggle');
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) {}
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = saved || (prefersDark ? 'dark' : 'light');

  toggle.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) {}
  });
})();

// Nav border on scroll
(function () {
  const nav = document.querySelector('.nav');
  const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

// Fade items in as they scroll into view and back out as they leave,
// and animate stat counters each time they appear
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets = document.querySelectorAll(
    '.hero__inner > *, .stat, .section__label, .section__title, .about__body, .card, .project, ' +
    '.vine__card, .skillset, .creds__col, .contact__intro, .note-form'
  );
  if (reduce || !('IntersectionObserver' in window)) return;

  // Stagger items that sit side by side in the same grid row
  const staggerGroups = ['.hero__inner', '.stats', '.cards', '.projects__grid', '.skills__grid', '.creds', '.contact__inner'];
  targets.forEach((el) => {
    el.classList.add('reveal');
    const group = el.parentElement;
    if (staggerGroups.some((sel) => group.matches(sel))) {
      const index = [...group.children].indexOf(el);
      el.style.setProperty('--reveal-delay', (index % 4) * 140 + 'ms');
    }
  });

  const countUp = (el) => {
    const end = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals || '0', 10);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const start = performance.now();
    const duration = 1200;
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = prefix + (end * eased).toFixed(decimals) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const el = entry.target;
      const wasVisible = el.classList.contains('is-visible');
      el.classList.toggle('is-visible', entry.isIntersecting);
      if (entry.isIntersecting && !wasVisible) {
        const counter = el.querySelector('[data-count]');
        if (counter) countUp(counter);
      }
    });
  }, { threshold: 0.12, rootMargin: '-6% 0px -6% 0px' });

  targets.forEach((el) => io.observe(el));
})();

document.getElementById('year').textContent = new Date().getFullYear();

// Contact note form → emails Sanjana via Web3Forms (https://web3forms.com)
// Paste your free access key below. Until then, the form falls back to opening
// the visitor's email app with the note pre-filled.
const WEB3FORMS_ACCESS_KEY = 'YOUR_ACCESS_KEY_HERE';
const CONTACT_EMAIL = 'sanjana.satish28@gmail.com';

(function () {
  const form = document.getElementById('note-form');
  if (!form) return;
  const status = form.querySelector('.note-form__status');
  const button = form.querySelector('.note-form__submit');
  const fields = ['name', 'email', 'message'].map((n) => form.elements[n]);

  const setStatus = (text, type) => {
    status.textContent = text;
    status.className = 'note-form__status' + (type ? ' is-' + type : '');
  };

  fields.forEach((f) => f.addEventListener('input', () => f.classList.remove('is-invalid')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const invalid = fields.filter((f) => !f.value.trim() || !f.checkValidity());
    fields.forEach((f) => f.classList.toggle('is-invalid', invalid.includes(f)));
    if (invalid.length) {
      const empty = invalid.some((f) => !f.value.trim());
      setStatus(empty
        ? 'Please fill out all required fields (*) before sending.'
        : 'Please enter a valid email address (like name@example.com).', 'error');
      invalid[0].focus();
      return;
    }
    if (form.elements.botcheck.checked) return; // spam bot

    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const message = form.elements.message.value.trim();

    if (!WEB3FORMS_ACCESS_KEY || WEB3FORMS_ACCESS_KEY === 'YOUR_ACCESS_KEY_HERE') {
      const subject = encodeURIComponent('Portfolio note from ' + name);
      const body = encodeURIComponent(message + '\n\n— ' + name + ' (' + email + ')');
      window.location.href = 'mailto:' + CONTACT_EMAIL + '?subject=' + subject + '&body=' + body;
      setStatus('Opening your email app to send the note…', 'success');
      return;
    }

    button.disabled = true;
    button.textContent = 'Sending…';
    setStatus('');
    try {
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: 'New portfolio note from ' + name,
          from_name: 'Sanjana Satish Portfolio',
          replyto: email,
          name, email, message,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Send failed');
      form.reset();
      setStatus("Thanks, " + name.split(' ')[0] + "! Your note is on its way — I'll get back to you soon.", 'success');
    } catch (err) {
      setStatus("Sorry, that didn't go through. Please try again or email me directly.", 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Send note →';
    }
  });
})();

// Experience vine: draw a winding stem through each stage and grow it with scroll
(function () {
  const vine = document.querySelector('.vine');
  if (!vine) return;
  const svg = vine.querySelector('.vine__svg');
  const track = vine.querySelector('.vine__track');
  const stem = vine.querySelector('.vine__stem');
  const nodes = [...vine.querySelectorAll('.vine__node')];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const draw = () => {
    const box = vine.getBoundingClientRect();
    const mobile = window.innerWidth <= 760;
    const sway = mobile ? 10 : 36;
    const points = nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
    });
    let d = 'M ' + points[0].x + ' ' + points[0].y;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dir = i % 2 ? 1 : -1;
      const h = b.y - a.y;
      d += ' C ' + (a.x + sway * dir) + ' ' + (a.y + h * 0.35) + ', ' +
        (b.x + sway * dir) + ' ' + (b.y - h * 0.35) + ', ' + b.x + ' ' + b.y;
    }
    svg.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);
    track.setAttribute('d', d);
    stem.setAttribute('d', d);
    // Remember where each node sits along the stem (0 → 1) so it sprouts when the stem reaches it
    const span = points[points.length - 1].y - points[0].y;
    nodes.forEach((n, i) => { n.dataset.at = (points[i].y - points[0].y) / span; });
    vine.dataset.top = points[0].y;
    vine.dataset.span = span;
  };

  const grow = () => {
    if (reduce) {
      stem.style.strokeDashoffset = 0;
      nodes.forEach((n) => n.classList.add('is-grown'));
      return;
    }
    const box = vine.getBoundingClientRect();
    const tip = window.innerHeight * 0.62; // the stem grows up to ~60% down the screen
    const progress = Math.min(Math.max((tip - box.top - +vine.dataset.top) / +vine.dataset.span, 0), 1);
    stem.style.strokeDashoffset = 1 - progress;
    nodes.forEach((n) => n.classList.toggle('is-grown', progress >= +n.dataset.at - 0.001));
  };

  const update = () => { draw(); grow(); };
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { grow(); ticking = false; });
  }, { passive: true });
  window.addEventListener('resize', update);
  if ('ResizeObserver' in window) new ResizeObserver(update).observe(vine);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(update);
  window.addEventListener('load', update);
  update();
})();

// Slow, eased scrolling for in-page links (nav, buttons, "Back to top")
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let frame = null;

  const scrollToY = (targetY) => {
    const startY = window.scrollY;
    const distance = targetY - startY;
    // Longer jumps take longer, between ~0.9s and ~1.8s
    const duration = Math.min(1800, Math.max(900, Math.abs(distance) * 0.5));
    const start = performance.now();
    cancelAnimationFrame(frame);
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      window.scrollTo(0, startY + distance * easeInOutCubic(t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };

  // Let the user take over by scrolling with the wheel or touch mid-animation
  ['wheel', 'touchstart', 'keydown'].forEach((evt) =>
    window.addEventListener(evt, () => cancelAnimationFrame(frame), { passive: true })
  );

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href');
    const target = id === '#' || id === '#top' ? document.body : document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const y = target === document.body ? 0 : target.getBoundingClientRect().top + window.scrollY - offset;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    if (reduce) window.scrollTo(0, y);
    else scrollToY(Math.min(Math.max(y, 0), maxY));
    history.pushState(null, '', id === '#top' ? location.pathname : id);
  });
})();
