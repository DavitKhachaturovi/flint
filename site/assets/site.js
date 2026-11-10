// flintnotes.app (WEB-01, D-162): the capture popup typing in the hero, the screens' tabs, and
// sections rising in as they come into view. No requests, no storage, nothing tracked.
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The capture popup: the shorthand turns into chips as it is typed (CAP-03, CAP-04).
  const typed = document.getElementById('typed');
  const chips = document.getElementById('chips');
  const target = document.getElementById('target');
  const card = document.getElementById('capture');
  const send = document.getElementById('send');
  const saved = document.getElementById('saved');
  const svg = (path) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const CHIPS = [
    { token: '!h', html: '<span class="stripe"></span>High' },
    { token: '##unicorn', html: `${svg('M4 9h16M4 15h16M10 3 8 21M16 3l-2 18')}Unicorn`, list: 'Unicorn' },
    {
      token: '@15:00',
      html: `${svg('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0')}Today 15:00`,
    },
  ];
  const TEXT = 'Fix token refresh !h ##unicorn @15:00';
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const show = (text) => {
    typed.textContent = text;
    const shown = new Set([...chips.children].map((chip) => chip.dataset.token));
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

  const reset = () => {
    typed.textContent = '';
    chips.replaceChildren();
    target.textContent = 'Inbox';
    card.classList.remove('sent');
    saved.classList.remove('on');
  };

  const play = async () => {
    for (;;) {
      reset();
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

  if (typed && chips && card) {
    if (reduced) show(TEXT);
    else void play();
  }

  // The screens' tabs.
  const CAPTIONS = {
    list: 'Every line is a task: drag it, give it a priority, a reminder, notes and code.',
    note: 'Notes in markdown with a live preview, code blocks, checklists and tables.',
    today: 'Today: your pinned tasks, the next reminder, and what is high priority.',
    sync: 'Chosen lists and notes sync through your own Google Drive; a cloud marks them.',
  };
  const ALTS = {
    list: "A task list in Flint: a task with its stack trace, subtasks, priorities and reminders.",
    note: 'A note in Flint with headings, a checklist and a code block.',
    today: "Flint's Today view: the greeting, the next reminder and the pinned tasks.",
    sync: "Flint's sync status: synced with Google Drive, with clouds on the synced lists.",
  };
  const screen = document.getElementById('screen');
  const caption = document.getElementById('caption');
  const tabs = [...document.querySelectorAll('[data-screen]')];
  const select = (tab) => {
    const name = tab.dataset.screen;
    for (const each of tabs) each.setAttribute('aria-selected', String(each === tab));
    const swap = () => {
      screen.src = `assets/screens/${name}.png`;
      screen.alt = ALTS[name];
      caption.textContent = CAPTIONS[name];
      screen.classList.remove('swapping');
    };
    if (reduced) swap();
    else {
      screen.classList.add('swapping');
      setTimeout(swap, 200);
    }
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      select(next);
    });
  }
  // The images, ready before they are asked for.
  for (const name of Object.keys(CAPTIONS)) new Image().src = `assets/screens/${name}.png`;

  // Sections rise in as they come into view.
  if (!reduced && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('seen');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    for (const element of document.querySelectorAll('.showcase, .card, .private, .cta')) {
      element.classList.add('reveal');
      observer.observe(element);
    }
  }
})();
