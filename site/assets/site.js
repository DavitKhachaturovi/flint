// flintnotes.app (WEB-01, D-162; redesign D-184): the intro, sections rising in, the nav's state,
// the hero window tilting up, the glows' parallax, the capture popup typing, the "One window"
// videos taking turns, the file viewer, the cards' spotlight and the fade when leaving the page.
// The values are the design reference's (docs/design/site). No requests, no storage, nothing
// tracked. Under reduce-motion the page is still: no intro, reveals, tilt, parallax or autoplay.
//
// Loaded in <head> without defer, so the `js` class is on <html> before the first paint (the CSS
// shows the intro and hides the reveals only with it); the rest waits for the document.
document.documentElement.classList.add('js');

(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const start = () => {
    const page = $('.page');
    if (!page) return;

    // ── The intro (D-184): the stone strikes the tile, sparks fly off its tip, the light opens the
    // page from there; the hero's items rise in after the strike. All times in ms from the start.
    const intro = $('.intro');
    let introDelay = 0;
    if (intro && !reduced) {
      const IMPACT = 420;
      const at = (element, frames, delay, duration, easing = 'ease', fill = 'both') =>
        element.animate(frames, { delay, duration, easing, fill });
      const icon = $('.intro-icon', intro);
      const tile = $('.intro-tile', intro);
      const stone = $('.intro-stone', intro);
      // The tile alone, in the centre.
      at(
        tile,
        [
          { opacity: 0, transform: 'scale(.92)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        0,
        300,
        'cubic-bezier(.2,.9,.3,1)',
      );
      // The stone, from 40 px right of and above its place, turning 8°, speeding up into the tile.
      at(
        stone,
        [
          { opacity: 0, transform: 'translate(40px, -40px) rotate(8deg)' },
          { opacity: 1, offset: 0.35 },
          { opacity: 1, transform: 'translate(0, 0) rotate(0deg)' },
        ],
        IMPACT - 280,
        280,
        'cubic-bezier(.55,0,.9,.4)',
      );
      // The hit: a dead stop (40 ms), the stone recoils and settles; the tile squashes and springs
      // back; the whole icon shakes for a beat; the shadow lands.
      at(
        stone,
        [
          { transform: 'translate(0, 0) rotate(0deg)' },
          { transform: 'translate(6px, -6px) rotate(-3deg)', offset: 0.35 },
          { transform: 'translate(0, 0) rotate(0deg)' },
        ],
        IMPACT + 40,
        300,
        'cubic-bezier(.2,.9,.3,1.2)',
        'forwards',
      );
      at(
        tile,
        [
          { transform: 'scale(1)' },
          { transform: 'translate(-4px, 4px) scale(.9)', offset: 0.18 },
          { transform: 'translate(1px, -1px) scale(1.02)', offset: 0.6 },
          { transform: 'scale(1)' },
        ],
        IMPACT,
        420,
        'ease-out',
        'forwards',
      );
      at(
        icon,
        [
          { transform: 'translate(0, 0)' },
          { transform: 'translate(-4px, 3px)' },
          { transform: 'translate(3px, -2px)' },
          { transform: 'translate(-2px, 1px)' },
          { transform: 'translate(1px, 0)' },
          { transform: 'translate(0, 0)' },
        ],
        IMPACT,
        240,
        'linear',
      );
      at($('.intro-shadow', intro), [{ opacity: 0 }, { opacity: 1 }], IMPACT - 10, 90, 'ease-out');
      // The spark: a flash where it hits, a ring, the glint across the tile, the sparks.
      at(
        $('.intro-hit', intro),
        [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 0 }],
        IMPACT,
        320,
        'ease-out',
      );
      at(
        $('.intro-ring', intro),
        [
          { opacity: 0, transform: 'scale(.08)' },
          { opacity: 1, transform: 'scale(.25)', offset: 0.12 },
          { opacity: 0, transform: 'scale(1.15)' },
        ],
        IMPACT,
        460,
        'cubic-bezier(.1,.7,.3,1)',
      );
      at(
        $('.intro-glint i', intro),
        [
          { transform: 'translateX(-260%) skewX(-20deg)' },
          { transform: 'translateX(320%) skewX(-20deg)' },
        ],
        IMPACT + 20,
        380,
        'cubic-bezier(.4,0,.2,1)',
      );
      // Streaks thrown forward off the stone's bottom-left tip (down and to the left, the way it
      // was moving), falling a little as they fade; fixed values, the same on every visit.
      $$('.intro-sparks i', intro).forEach((spark, i) => {
        const deg = 135 + (i - 3.5) * 17 + ((i * 37) % 13) - 6;
        const dist = 75 + ((i * 53) % 80);
        const x = Math.cos((deg * Math.PI) / 180) * dist;
        const y = Math.sin((deg * Math.PI) / 180) * dist;
        const fall = 26 + ((i * 29) % 30);
        at(
          spark,
          [
            { opacity: 0, transform: `translate(0, 0) rotate(${deg}deg) scaleX(.3)` },
            {
              opacity: 1,
              transform: `translate(${x * 0.15}px, ${y * 0.15}px) rotate(${deg}deg) scaleX(1.4)`,
              offset: 0.08,
            },
            {
              opacity: 0.9,
              transform: `translate(${x * 0.7}px, ${y * 0.7 + fall * 0.3}px) rotate(${deg + 8}deg) scaleX(1)`,
              offset: 0.55,
            },
            {
              opacity: 0,
              transform: `translate(${x}px, ${y + fall}px) rotate(${deg + 16}deg) scaleX(.4)`,
            },
          ],
          IMPACT + (i % 4) * 18,
          480 + ((i * 41) % 200),
          'cubic-bezier(.05,.7,.3,1)',
        );
      });
      at(
        $('.intro-flash', intro),
        [
          { opacity: 0, transform: 'scale(.15)' },
          { opacity: 1, transform: 'scale(.6)', offset: 0.18 },
          { opacity: 0, transform: 'scale(1.6)' },
        ],
        IMPACT + 20,
        820,
        'ease-out',
      );
      // The light opens the page from the tip, out past the farthest corner. Where a browser can't
      // animate the radius (no @property), the curtain still fades out at the end.
      const tipX = window.innerWidth / 2 - 31.4;
      const tipY = window.innerHeight / 2 + 32.3;
      const far = Math.hypot(
        Math.max(tipX, window.innerWidth - tipX),
        Math.max(tipY, window.innerHeight - tipY),
      );
      at(
        $('.intro-curtain', intro),
        [
          { opacity: 1, '--intro-r': '0px' },
          { opacity: 1, offset: 0.8 },
          { opacity: 0, '--intro-r': `${Math.ceil(far) + 160}px` },
        ],
        IMPACT + 160,
        740,
        'cubic-bezier(.65,0,.25,1)',
      );
      at(
        icon,
        [
          { opacity: 1, filter: 'blur(0)' },
          { opacity: 0, filter: 'blur(4px)' },
        ],
        IMPACT + 280,
        400,
        'ease',
        'forwards',
      ).onfinish = () => setTimeout(() => (intro.style.display = 'none'), 300);
      introDelay = IMPACT + 280;
    } else if (intro) intro.style.display = 'none';

    // ── Reveals: each [data-reveal] rises in when 12% of it shows, after its own delay (ms). ──
    if (!reduced && 'IntersectionObserver' in window) {
      const show = (element) => {
        const delay = Number(element.dataset.reveal || 0) + (element.closest('#top') ? introDelay : 0);
        element.style.transition = `opacity 900ms ease ${delay}ms, transform 1100ms cubic-bezier(.16,1,.3,1) ${delay}ms, filter 900ms ease ${delay}ms`;
        element.classList.add('is-revealed');
        setTimeout(() => (element.style.transition = ''), delay + 1200);
      };
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              show(entry.target);
              observer.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
      );
      for (const element of $$('[data-reveal]')) observer.observe(element);
    } else for (const element of $$('[data-reveal]')) element.classList.add('is-revealed');

    // ── The hero's dark orb drifts. ──
    const orb = $('.hero-orb');
    if (orb && !reduced) {
      orb.animate(
        [
          { transform: 'translate(-4%, -2%) scale(1)' },
          { transform: 'translate(4%, 3%) scale(1.08)' },
        ],
        { duration: 12000, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' },
      );
    }

    // ── Scroll: the nav's state, the window's tilt, the hero fading back, the glows' parallax. ──
    const nav = $('.nav');
    const hero = $('#top');
    const heroInner = $('.hero-inner');
    const tilt = $('.bezel');
    const parallax = $$('[data-parallax]');
    const scrollFx = () => {
      const vh = window.innerHeight;
      const heroTop = hero ? hero.getBoundingClientRect().top : -window.scrollY;
      if (nav) nav.classList.toggle('is-scrolled', heroTop < -20);
      if (reduced) return;
      if (tilt) {
        const top = tilt.getBoundingClientRect().top;
        const p = Math.max(0, Math.min(1, (vh - top) / (vh * 0.95)));
        const e = 1 - Math.pow(1 - p, 3);
        tilt.style.transform = `rotateX(${(1 - e) * 22}deg) scale(${0.9 + 0.1 * e}) translateY(${(1 - e) * 40}px)`;
      }
      if (heroInner) {
        const h = Math.max(0, -heroTop);
        heroInner.style.transform = `translateY(${h * 0.35}px) scale(${1 - Math.min(h / 4000, 0.08)})`;
        heroInner.style.opacity = String(Math.max(0, 1 - h / 520));
      }
      for (const element of parallax) {
        const box = element.parentElement.getBoundingClientRect();
        element.style.transform = `translateY(${(box.top + box.height / 2 - vh / 2) * Number(element.dataset.parallax)}px)`;
      }
    };
    let frame = 0;
    const onScroll = () => {
      if (!frame)
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          scrollFx();
        });
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll);
    scrollFx();

    // ── "One window": each tab plays while the section shows, then the next one opens. ──
    const screens = $('#screens');
    if (screens) {
      // Lengths in ms; a video tab also waits for its video to end (the fill holds at 98.5%).
      const SCREENS = [
        { ms: 13400, video: true },
        { ms: 12400, video: true },
        { ms: 14200, video: true },
        { ms: 7500, video: false },
      ];
      const layers = $$('[data-shot]', screens);
      const tabs = $$('[data-pick]', screens);
      const fills = $$('[data-fill]', screens);
      const videos = $$('video[data-video]', screens);
      const videoOf = (i) => videos.find((video) => Number(video.dataset.video) === i);
      const auto = !reduced;
      let shot = 0;
      let t0 = performance.now();
      let paused = 0;
      let visible = false;
      let videoDone = false;

      if (reduced) for (const video of videos) video.poster = video.dataset.still;

      const play = () => {
        videoDone = false;
        const video = videoOf(shot);
        if (!video || reduced) return;
        video.currentTime = 0;
        // A video that can't play (a blocked autoplay, a failed load) lets the tabs go on.
        video.play()?.catch(() => (videoDone = true));
      };
      for (const video of videos) {
        video.addEventListener('ended', () => {
          if (video === videoOf(shot)) videoDone = true;
        });
        video.addEventListener('error', () => {
          if (video === videoOf(shot)) videoDone = true;
        });
      }

      const pick = (i) => {
        const before = videoOf(shot);
        t0 = performance.now();
        paused = 0;
        shot = i;
        for (const layer of layers) layer.classList.toggle('is-on', Number(layer.dataset.shot) === i);
        tabs.forEach((tab, index) => tab.classList.toggle('is-on', index === i));
        if (SCREENS[i].video) play();
        // The one leaving stops once it has faded out (500 ms).
        if (before && before !== videoOf(i)) setTimeout(() => before !== videoOf(shot) && before.pause(), 500);
      };
      tabs.forEach((tab, index) => tab.addEventListener('click', () => pick(index)));

      new IntersectionObserver(
        ([entry]) => {
          const was = visible;
          visible = entry.isIntersecting;
          if (visible && !was && SCREENS[shot].video) {
            t0 = performance.now();
            paused = 0;
            play();
          } else if (!visible && was) videoOf(shot)?.pause();
        },
        { threshold: 0.25 },
      ).observe(screens);
      // The videos load as the section comes near, not with the page.
      const warm = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting || reduced) return;
          for (const video of videos) video.preload = 'auto';
          warm.disconnect();
        },
        { rootMargin: '100% 0px' },
      );
      warm.observe(screens);

      const tick = (now) => {
        if (!auto || !visible) t0 = now - paused;
        paused = now - t0;
        const current = SCREENS[shot];
        const waiting = current.video && !videoDone;
        const p = Math.min(waiting ? 0.985 : 1, (now - t0) / current.ms);
        fills.forEach((fill, index) => {
          fill.style.width = `${index === shot ? (auto ? p * 100 : 100) : 0}%`;
        });
        if (auto && p >= 1 && !waiting) pick((shot + 1) % SCREENS.length);
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    }

    // ── The capture popup: the shorthand turns into chips as it is typed (CAP-03, CAP-04). ──
    const card = $('#capture-card');
    if (card) {
      const typed = $('#typed');
      const chips = $('#chips');
      const target = $('#target');
      const send = $('#send');
      const saved = $('#saved');
      const svg = (path) =>
        `<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
      const CHIPS = [
        { token: '!h', html: '<span class="chip-stripe"></span>High' },
        {
          token: '##unicorn',
          html: `${svg('M4 9h16M4 15h16M10 3 8 21M16 3l-2 18')}Unicorn`,
          list: 'Unicorn',
        },
        {
          token: '@15:00',
          html: `${svg('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0')}Today 15:00`,
        },
      ];
      const TEXT = 'Fix token refresh !h ##unicorn @15:00';
      const show = (text) => {
        typed.textContent = text;
        const shown = new Set($$('.chip', chips).map((chip) => chip.dataset.token));
        for (const chip of CHIPS) {
          // A token counts once it is followed by a space or ends the text, as the parser reads it.
          const done = text.includes(`${chip.token} `) || text.endsWith(chip.token);
          if (done && !shown.has(chip.token)) {
            const element = document.createElement('span');
            element.className = 'chip';
            element.dataset.token = chip.token;
            element.innerHTML = chip.html; // constant markup
            chips.append(element);
            if (chip.list) target.textContent = chip.list;
          }
        }
      };
      const loop = async () => {
        await wait(introDelay + 400);
        for (;;) {
          typed.textContent = '';
          chips.replaceChildren();
          target.textContent = 'Inbox';
          card.classList.remove('sent');
          saved.classList.remove('on');
          await wait(700);
          for (let at = 1; at <= TEXT.length; at++) {
            show(TEXT.slice(0, at));
            await wait(TEXT[at - 1] === ' ' ? 120 : 55 + Math.random() * 45);
          }
          await wait(900);
          send.classList.add('pressed');
          await wait(140);
          send.classList.remove('pressed');
          card.classList.add('sent');
          saved.classList.add('on');
          await wait(2200);
        }
      };
      if (reduced) show(TEXT);
      else void loop();
    }

    // ── The file viewer: a list file and a note as they are on disk (docs/04). ──
    const fileTabs = $('#file-tabs');
    if (fileTabs) {
      const lines = $('#file-lines');
      const seg = (text, kind = 'txt') => [text, kind];
      const FILES = [
        [
          [seg('---', 'dim')],
          [seg('flint: 1', 'dim')],
          [seg('id: unicorn', 'dim')],
          [seg('mode: tasks', 'dim')],
          [seg('---', 'dim')],
          [
            seg('- [ ] ', 'pun'),
            seg('Fix the login redirect loop '),
            seg('[priority:: high]', 'fld'),
            seg(' '),
            seg('[id:: t1]', 'fld'),
          ],
          [seg('- [ ] ', 'pun'), seg("Review Alex's pull request "), seg('[reminder:: 2026-03-10T15:00]', 'fld')],
          [seg('- [ ] ', 'pun'), seg('Rotate the Contoso storage keys '), seg('[pinned:: true]', 'fld')],
          [seg(' ')],
          [seg('## Completed', 'hi')],
          [seg('- [x] ', 'pun'), seg('Ship the hotfix '), seg('[completion:: 2026-03-10T09:12]', 'fld')],
        ],
        [
          [seg('---', 'dim')],
          [seg('flint: 1', 'dim')],
          [seg('id: n4d8', 'dim')],
          [seg('mode: note', 'dim')],
          [seg('---', 'dim')],
          [seg('# Sprint planning 29 Oct', 'hi')],
          [seg(' ')],
          [seg('- ', 'pun'), seg('Discussed staging DNS')],
          [seg('- [ ] ', 'pun'), seg('Davit: check VPN gateway logs')],
        ],
      ];
      const buttons = $$('[data-file]', fileTabs);
      let current = 0;
      const render = (index) => {
        lines.replaceChildren(
          ...FILES[index].map((segments, i) => {
            const line = document.createElement('div');
            line.className = 'line';
            const number = document.createElement('span');
            number.className = 'ln';
            number.textContent = String(i + 1);
            const text = document.createElement('span');
            for (const [content, kind] of segments) {
              const span = document.createElement('span');
              span.className = `c-${kind}`;
              span.textContent = content;
              text.append(span);
            }
            line.append(number, text);
            return line;
          }),
        );
      };
      buttons.forEach((button, index) =>
        button.addEventListener('click', () => {
          if (index === current) return;
          current = index;
          buttons.forEach((each, i) => each.classList.toggle('is-on', i === index));
          render(index);
          if (reduced) return;
          $$('.line', lines).forEach((line, i) =>
            line.animate(
              [
                { opacity: 0, transform: 'translateX(-12px)', filter: 'blur(4px)' },
                { opacity: 1, transform: 'none', filter: 'blur(0)' },
              ],
              { duration: 420, delay: i * 45, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'backwards' },
            ),
          );
        }),
      );
    }

    // ── The cards' spotlight follows the cursor. ──
    for (const element of $$('.card')) {
      element.addEventListener('mousemove', (event) => {
        const box = element.getBoundingClientRect();
        element.style.setProperty('--mx', `${event.clientX - box.left}px`);
        element.style.setProperty('--my', `${event.clientY - box.top}px`);
      });
    }

    // ── Links: in-page ones scroll to 24 px above their section; others fade the page out first. ──
    page.addEventListener(
      'click',
      (event) => {
        const link = event.target.closest && event.target.closest('a[href]');
        if (!link) return;
        const href = link.getAttribute('href');
        if (href.startsWith('#')) {
          event.preventDefault();
          const to = $(href);
          if (to) {
            const top = href === '#top' ? 0 : to.getBoundingClientRect().top + window.scrollY - 24;
            window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
          }
        } else if (
          !href.startsWith('mailto:') &&
          !reduced &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          page.animate(
            [
              { opacity: 1, filter: 'blur(0)' },
              { opacity: 0, filter: 'blur(6px)' },
            ],
            { duration: 260, easing: 'ease', fill: 'forwards' },
          ).onfinish = () => {
            window.location.href = link.href;
          };
        }
      },
      true,
    );
    // Back to a page kept in the back/forward cache: undo the fade.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) for (const animation of page.getAnimations()) animation.cancel();
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
