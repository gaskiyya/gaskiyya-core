import copy from '../../packages/schemas/copy.json';
import { runCore } from './core';
import { demoResult, digest } from './fingerprint';

const CONFIG = {
  appStoreUrl: '',
  playStoreUrl: '',
  contactEmail: '',
  demoUrl: 'console/',
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => el.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => [...el.querySelectorAll<T>(s)];

const APPLE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 1.6c-.25.27-.4.68-.4 1.2v18.4c0 .52.15.93.4 1.2l.06.06L13.98 12.1v-.2L3.66 1.54z" fill="#00d7fe"/><path d="M17.42 15.55l-3.44-3.45v-.2l3.44-3.45.08.04 4.08 2.32c1.16.66 1.16 1.74 0 2.4l-4.08 2.32z" fill="#ffce00"/><path d="M17.5 15.5L13.98 12 3.6 22.4c.38.4 1.02.45 1.73.05l12.17-6.95" fill="#ff3a44"/><path d="M17.5 8.5L5.33 1.56c-.71-.4-1.35-.35-1.73.05L13.98 12z" fill="#00f076"/></svg>';

function storeBadge(kind: 'ios' | 'android') {
  const url = kind === 'ios' ? CONFIG.appStoreUrl : CONFIG.playStoreUrl;
  const a = document.createElement('a');
  a.className = 'store';
  a.href = url || '#download';
  if (url) {
    a.target = '_blank';
    a.rel = 'noopener';
  }
  a.setAttribute('aria-label', `${kind === 'ios' ? 'Download on the App Store' : 'Get it on Google Play'}${url ? '' : ' (coming soon)'}`);
  a.innerHTML =
    kind === 'ios'
      ? `${APPLE}<span><small>Download on the</small><b>App Store</b></span>`
      : `${PLAY}<span><small>GET IT ON</small><b>Google Play</b></span>`;
  if (!url) a.insertAdjacentHTML('beforeend', '<span class="soon">Soon</span>');
  return a;
}
for (const el of $$('[data-stores]')) el.append(storeBadge('ios'), storeBadge('android'));

const contact = $('[data-contact]');
if (CONFIG.contactEmail && contact) {
  const c = contact;
  c.innerHTML = `<a class="btn" href="mailto:${CONFIG.contactEmail}?subject=Gaskiyya%20partnership">Partner with us</a>`;
}
for (const y of $$('[data-year]')) y.textContent = String(new Date().getFullYear());
if (CONFIG.demoUrl) {
  for (const a of $$<HTMLAnchorElement>('[data-demo-link]')) {
    a.href = CONFIG.demoUrl;
    a.target = '_blank';
    a.rel = 'noopener';
  }
}

const heroWord = $('[data-rotate]');
if (heroWord && !reduceMotion) {
  const words = heroWord.dataset.rotate!.split(',');
  let i = 0;
  setInterval(() => {
    if (document.hidden) return;
    heroWord.classList.add('is-out');
    setTimeout(() => {
      i = (i + 1) % words.length;
      heroWord.textContent = `${words[i]},`;
      heroWord.classList.replace('is-out', 'is-entering');
      void heroWord.offsetWidth;
      heroWord.classList.remove('is-entering');
    }, 350);
  }, 2400);
}

const nav = $('#nav')!;
const hero = $('.dark-hero .hero');
const onScroll = () => {
  nav.classList.toggle('scrolled', window.scrollY > 10);
  if (hero) nav.classList.toggle('over-hero', hero.getBoundingClientRect().bottom > nav.offsetHeight);
};
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

const menuBtn = $('.menu-btn');
const menu = $('#mobile-menu');
menuBtn?.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') !== 'true';
  menuBtn.setAttribute('aria-expanded', String(open));
  menu!.hidden = !open;
  nav.classList.toggle('menu-open', open);
});
if (menu) for (const a of $$('a', menu)) a.addEventListener('click', () => {
  menuBtn!.setAttribute('aria-expanded', 'false');
  menu.hidden = true;
  nav.classList.remove('menu-open');
});

const video = $<HTMLVideoElement>('[data-hero-video]');
const toggle = $('[data-video-toggle]');
if (video && toggle) {
  let userPaused = reduceMotion;
  const sync = () => {
    toggle.classList.toggle('paused', video.paused);
    toggle.setAttribute('aria-label', video.paused ? 'Play video' : 'Pause video');
  };
  const play = () => video.play().catch(() => sync());
  if (reduceMotion) video.pause();
  video.addEventListener('play', sync);
  video.addEventListener('pause', sync);
  toggle.addEventListener('click', () => {
    userPaused = !video.paused;
    if (userPaused) video.pause();
    else play();
    sync();
  });
  const sound = $('[data-video-sound]');
  sound?.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted && video.paused) {
      userPaused = false;
      play();
    }
    sound.classList.toggle('unmuted', !video.muted);
    sound.setAttribute('aria-pressed', String(!video.muted));
    sound.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Turn sound off');
  });
  new IntersectionObserver(([e]) => {
    if (!e!.isIntersecting) video.pause();
    else if (!userPaused) play();
  }).observe(video);
  sync();
}

const steps = $$('.step');
const screens = $$('[data-story-screens] picture');
const dots = $$('.story-dots i');
const setStep = (n: number) => {
  steps.forEach((s, i) => s.classList.toggle('on', i === n));
  screens.forEach((s, i) => s.classList.toggle('on', i === n));
  dots.forEach((d, i) => d.classList.toggle('on', i === n));
};
const storyIo = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step));
  },
  { rootMargin: '-45% 0px -45% 0px' },
);
for (const s of steps) storyIo.observe(s);

const ORIGINAL = 'DemoBank: Debit NGN5,000.00 on acct ***5678 at POS SHOPRITE IKEJA.\nAvail Bal: NGN12,450.10\nGet our new app: https://www.demobank.ng/app';
const sent = $('#sent');
const got = $<HTMLTextAreaElement>('#got');
const fpSent = $('#fp-sent')!;
const fpGot = $('#fp-got')!;
const match = $('#match')!;
const verdict = $('#verdict')!;

if (sent && got) {
  sent.textContent = ORIGINAL;
  got.value = ORIGINAL;
  let sentDigest = '';

  const show = (state: 'pending' | 'match' | 'no_match' | 'cannot_check') => {
    match.dataset.state = state;
    match.classList.toggle('bad', state === 'no_match');
    verdict.textContent =
      state === 'match' ? copy.verdict.confirmed.title
        : state === 'no_match' ? copy.verdict.not_confirmed.short
          : state === 'cannot_check' ? copy.verdict.cannot_check.short
            : String.fromCharCode(8230);
  };
  show('pending');

  const render = async () => {
    const d = await digest(got.value);
    const state = demoResult(sentDigest, d);
    if (!d) fpGot.textContent = 'Open this page over https to see the fingerprint.';
    else fpGot.innerHTML = [...d].map((ch, i) => (ch === sentDigest[i] ? ch : `<i>${ch}</i>`)).join('');
    show(state);
  };

  digest(ORIGINAL).then((d) => {
    sentDigest = d ?? '';
    fpSent.textContent = d ?? 'Open this page over https to see the fingerprint.';
    void render();
  });
  got.addEventListener('input', render);

  for (const b of $$('[data-act]')) {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'reset') got.value = ORIGINAL;
      if (act === 'spaces') got.value = `  ${got.value.replace(/ /g, '   ').replace(/\n/g, '\n\n')}  `;
      if (act === 'link') got.value = got.value.includes('demobank.ng') ? got.value.replace('demobank.ng', 'demo-bank.ng') : got.value.replace('demo-bank.ng', 'demobank.ng');
      if (act === 'amount') got.value = got.value.includes('NGN5,000.00') ? got.value.replace('NGN5,000.00', 'NGN50,000.00') : got.value.replace('NGN50,000.00', 'NGN5,000.00');
      render();
    });
  }
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : systemDark.matches;
};

function applyTheme() {
  const dark = isDark();
  for (const pic of $$('picture')) {
    const source = pic.querySelector('source');
    const img = pic.querySelector('img');
    if (!source || !img) continue;
    img.dataset.light ??= img.getAttribute('src')!;
    img.dataset.dark ??= source.getAttribute('srcset')!;
    source.media = '(not all)';
    img.src = (dark ? img.dataset.dark : img.dataset.light)!;
  }
  const digits = $('.digits');
  if (digits) {
    const code = (dark ? digits.dataset.codeDark : digits.dataset.codeLight)!;
    digits.innerHTML = [...code].map((d) => `<span>${d}</span>`).join('');
  }
}
applyTheme();
systemDark.addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

const tocLinks = $$<HTMLAnchorElement>('.toc a[href^="#"]');
if (tocLinks.length) {
  const byId = new Map(tocLinks.map((a) => [a.getAttribute('href')!.slice(1), a]));
  const tocIo = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const active = byId.get(e.target.id);
        for (const a of tocLinks) a.classList.toggle('on', a === active);
        const bar = active?.closest('ol');
        if (bar) bar.scrollTo({ left: active!.offsetLeft - 24, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    },
    { rootMargin: '-30% 0px -60% 0px' },
  );
  for (const id of byId.keys()) {
    const el = document.getElementById(id);
    if (el) tocIo.observe(el);
  }
}

for (const block of $$('[data-copy]')) {
  const code = $('code', block)!;
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.type = 'button';
  btn.textContent = 'Copy';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent!);
      btn.textContent = 'Copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      btn.textContent = 'Selected';
    }
    setTimeout(() => (btn.textContent = 'Copy'), 1600);
  });
  block.append(btn);
}

const core = $('[data-core]');
if (core) runCore(core, digest, reduceMotion);
