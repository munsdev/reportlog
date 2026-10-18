/**
 * The install guide's three conveniences: a copy button on every command, a
 * fill-in-once panel that rewrites the commands to the reader's own
 * hostname and paths, and a tick per step so a long install can be put down
 * and picked up.
 *
 * A FILE RATHER THAN AN INLINE SCRIPT, like every other script in public/.
 * nginx serves these off disk and never renders them, so there is no nonce
 * to be had — and one inline script anywhere in public/ would force
 * 'unsafe-inline' on the whole deployment's policy. `npm test` fails on one
 * appearing.
 *
 * NOTHING HERE IS LOAD-BEARING. The page is a complete, correct guide with
 * JavaScript off: every command block already contains working defaults, the
 * steps are numbered in the markup, and the panel below is an enhancement to
 * text that reads fine without it. That is deliberate — somebody standing up
 * a server reads this in whatever browser the box has, and a guide that
 * needed scripting to be legible would be the wrong thing to hand them.
 *
 * NO INLINE STYLE ATTRIBUTES. Everything visual is a class in
 * css/docs-page.css; this file only adds and removes them. The policy
 * refuses an inline style attribute in markup, and a script that wrote one
 * would do nothing, silently.
 */

/* The placeholders a reader can replace, and what the page ships with.
   Keys are matched as whole words inside command text, longest first, so
   `/srv/reportlog` is never half-replaced by a shorter key. */
/* `yours` marks a value nobody can guess for you. The other two have
   defaults that are not merely acceptable — they are what `contrib/systemd/`
   HARDCODES (`User=reportlog`, `WorkingDirectory=/srv/reportlog`,
   `ReadWritePaths=/srv/reportlog`) and what install.sh uses, so changing
   them means editing the unit files too. The panel says so rather than
   quietly inviting a change that breaks the service. */
const FIELDS = [
  {
    id: 'host',
    label: 'Your hostname',
    placeholder: 'reports.example.org',
    example: 'where people will reach it',
    yours: true,
  },
  {
    id: 'dir',
    label: 'Install directory',
    placeholder: '/srv/reportlog',
    example: 'where the code lives',
    note: 'Leave blank unless you need another path \u2014 the shipped '
      + 'service files name this one, so changing it means editing them too.',
  },
  /* THERE IS NO `user` FIELD, AND THERE CANNOT BE ONE BY TEXT MATCHING.
   *
   * It was here, and it was unsafe. `reportlog` means FIVE different things
   * in these commands, and only the first is the service account:
   *
   *   the account      createuser reportlog, sudo -u reportlog, chown
   *   the database     createdb reportlog -O reportlog
   *   the install path /srv/reportlog
   *   THE REPOSITORY   github.com/munsdev/reportlog.git, cd reportlog
   *   THE UNIT NAME    systemctl status reportlog, journalctl -u reportlog
   *
   * Substituting the bare word renamed the last two, so anybody who set a
   * service user was handed a clone URL that 404s and `systemctl` commands
   * for a unit that does not exist. It worked in testing only because nobody
   * ever typed in that box.
   *
   * Doing it properly means marking the substitutable occurrences in the
   * markup rather than guessing them from text — see docs/frontend-files.md.
   * Until then the account is a stated fact instead of an offer, which costs
   * nothing: contrib/systemd/ hardcodes `User=reportlog` anyway, so the page
   * could never have kept its promise for a reader who changed it.
   *
   * `/srv/reportlog` IS safe and stays a field: the full path only ever means
   * the install directory. `/var/backups/reportlog` is a different string.
   */
  {
    id: 'ip',
    label: "Your server's IP",
    placeholder: '203.0.113.10',
    example: 'the address you SSH to',
    yours: true,
  },
  {
    id: 'admin',
    label: 'Your login on the server',
    placeholder: 'admin',
    example: 'the account you make for yourself, with sudo',
    yours: true,
  },
  {
    id: 'email',
    label: 'Your email',
    placeholder: 'you@example.org',
    example: 'for the mail test and the owner account',
    yours: true,
  },
];

/**
 * The registrable domain, taken from the hostname rather than asked for.
 *
 * `dig +short NS example.org` wants the DOMAIN, not the hostname: NS records
 * live at the zone apex, so asking about `reports.example.org` usually
 * answers nothing and reads as a broken zone. Dropping the leftmost label
 * gets it right for `reports.example.org`, which is the shape almost every
 * reader has, and asking for it as a sixth field would be asking for
 * something the page can work out.
 *
 * IT IS WRONG FOR A MULTI-PART PUBLIC SUFFIX — `reports.example.co.uk`
 * gives `example.co.uk`, which is right, but `example.co.uk` itself would
 * give `co.uk`, which is not. Getting that right needs the public-suffix
 * list, which is a dependency this page will not take on for one command.
 * So it only ever fires when the hostname has THREE OR MORE labels, where
 * dropping one is safe, and otherwise leaves the placeholder alone.
 */
function domainFrom(host) {
  const parts = String(host || '').trim().replace(/\.$/, '').split('.');
  return parts.length >= 3 ? parts.slice(1).join('.') : '';
}

const STORE = 'reportlog-install-guide';

/* Browser storage can throw outright — a private window, blocked site data —
   so every read and write is wrapped and the page works without it. Nothing
   here is worth failing a page over. */
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}') || {};
  } catch { return {}; }
}
function save(state) {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* fine */ }
}

let state = load();
if (!state.values) state.values = {};
if (!state.done) state.done = {};

/* ---------------------------------------------------------------- copy --- */

/**
 * The text of a command block, as a person would have typed it.
 *
 * Comment spans are dropped: they are there to be read, and pasting
 * `# writes .env, generates the two keys` into a shell is at best noise. The
 * block's own text is used rather than a second copy in an attribute, so
 * there is nothing to drift from what the reader can see.
 */
function commandText(pre) {
  const clone = pre.cloneNode(true);
  for (const c of clone.querySelectorAll('.c')) c.remove();
  return clone.textContent.replace(/[ \t]+$/gm, '').trim();
}

async function copy(text, button) {
  const settle = (cls, label) => {
    button.classList.remove('done', 'failed');
    button.classList.add(cls);
    button.textContent = label;
    setTimeout(() => {
      button.classList.remove(cls);
      button.textContent = 'copy';
    }, 1800);
  };
  // navigator.clipboard needs a secure context, which http://an-ip-address is
  // not. That is a normal way to read this page — somebody part way through an
  // install has no certificate yet — so the fallback selects the text instead
  // of failing silently, and the label says what happened.
  try {
    if (!navigator.clipboard) throw new Error('no clipboard api');
    await navigator.clipboard.writeText(text);
    settle('done', 'copied');
  } catch {
    const pre = button.parentElement.querySelector('pre');
    try {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      settle('failed', 'selected — ⌘/ctrl-c');
    } catch {
      settle('failed', 'select it by hand');
    }
  }
}

/* ------------------------------------------------- fill in once, apply --- */

/**
 * Rewrite every command block from the reader's values.
 *
 * The ORIGINAL text is kept on the element the first time it is seen, and
 * every later pass substitutes from that rather than from the last result.
 * Substituting a substituted string is how `reportlog` inside
 * `/srv/reportlog` gets replaced twice and the path turns into nonsense.
 */
function applyValues() {
  const subs = FIELDS
    .map((f) => ({ from: f.placeholder, to: (state.values[f.id] || '').trim() }))
    // The domain is derived, so it rides along as one more substitution
    // rather than as a field. Added here so the longest-first sort below
    // still covers it: `reports.example.org` and `you@example.org` both
    // contain `example.org` and must be replaced before it.
    .concat([{ from: 'example.org', to: domainFrom(state.values.host) }])
    .filter((s) => s.to && s.to !== s.from)
    // Longest placeholder first: /srv/reportlog before reportlog.
    .sort((a, b) => b.from.length - a.from.length);

  if (!subs.length) {
    for (const pre of document.querySelectorAll('.cmd pre')) {
      if (pre.dataset.original !== undefined) pre.innerHTML = pre.dataset.original;
    }
    return;
  }

  /* ONE PASS, ONE ALTERNATION. Not a loop of replaces.
   *
   * THE BUG THIS FIXES SHIPPED, and the old code's own comment shows it was
   * half-anticipated: "longest placeholder first: /srv/reportlog before
   * reportlog". Sorting only helps while BOTH are being substituted. Leave
   * the install directory blank — which the panel now actively encourages —
   * and `/srv/reportlog` drops out of the list, so the shorter `reportlog`
   * key matches INSIDE the path and hands the reader `/srv/rluser`.
   *
   * It was worse than that, because a replacement can also match text an
   * EARLIER replacement introduced: a reader whose hostname is
   * `reports.reportlog-demo.net` had it rewritten to `reports.rluser-demo.net` the moment
   * they also named a service user. Every command on the page, quietly wrong,
   * in a guide whose whole promise is that you can copy them without editing.
   *
   * A single alternation consumes each part of the original exactly once, so
   * nothing a substitution produces can be substituted again. Longest-first
   * still matters — it decides which key wins where two overlap — but it is
   * no longer load-bearing on its own.
   */
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const byFrom = new Map(subs.map((s) => [s.from, s.to]));
  // Not followed by the inside of a tag: the stored HTML carries
  // <span class="c"> comment markup, and a blind replace could rewrite an
  // attribute rather than the command text.
  const all = new RegExp(`(?:${subs.map((s) => esc(s.from)).join('|')})(?![^<]*>)`, 'g');

  /* THE COMMAND BLOCKS, AND THE COMMANDS IN THE PROSE.
   *
   * Inline <code> was left out and it is where a stuck reader is: the
   * troubleshooting fold-outs are full of commands you run when the happy
   * path failed — `ssh-keygen -R 203.0.113.10` after a rebuild, the
   * `host`/`nslookup` fallbacks when dig is missing, `dig +short <host>
   * @1.1.1.1` to check DNS. Fourteen of them carried an example value the
   * panel had already been told the real one for, so the page filled in every
   * command that worked and none of the ones you reach for when it does not.
   *
   * `code:not(pre code)` keeps the block copies out of it — those are handled
   * above and have their own markup.
   */
  const targets = [...document.querySelectorAll('.cmd pre'),
    ...document.querySelectorAll('code:not(pre code)')];
  for (const el of targets) {
    if (el.dataset.original === undefined) el.dataset.original = el.innerHTML;
    el.innerHTML = el.dataset.original.replace(all, (m) => escapeHtml(byFrom.get(m)));
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
}

/* ------------------------------------------------------------- wire up --- */

function buildPanel(panel) {
  const fields = document.createElement('div');
  fields.className = 'fields';
  for (const f of FIELDS) {
    const wrap = document.createElement('div');
    wrap.className = 'field';

    const label = document.createElement('label');
    label.textContent = f.label;
    label.setAttribute('for', `f-${f.id}`);
    // Which of the four actually need an answer, said on the field itself.
    // "Leave them blank to see the defaults" was read as possibly meaning
    // "type the grey text in", which is the one reading that wastes time.
    const tag = document.createElement('span');
    tag.className = f.yours ? 'needs' : 'has-default';
    tag.textContent = f.yours ? 'yours' : 'default is fine';
    label.append(' ', tag);

    const input = document.createElement('input');
    input.id = `f-${f.id}`;
    input.type = 'text';
    input.spellcheck = false;
    input.autocapitalize = 'none';
    input.placeholder = f.placeholder;
    input.value = state.values[f.id] || '';
    input.addEventListener('input', () => {
      state.values[f.id] = input.value;
      save(state);
      applyValues();
    });

    const ex = document.createElement('span');
    ex.className = 'ex';
    ex.textContent = f.example;

    wrap.append(label, input, ex);
    if (f.note) {
      const note = document.createElement('span');
      note.className = 'fieldnote';
      note.textContent = f.note;
      wrap.append(note);
    }
    fields.append(wrap);
  }

  const cleared = document.createElement('p');
  cleared.className = 'cleared';
  cleared.textContent = 'Kept in this browser only, so you can close the tab '
    + 'and come back. Nothing is sent anywhere.';

  const reset = document.createElement('button');
  reset.type = 'button';
  // NOT the tick class: that renders a checkbox, and a checkbox you cannot
  // check is a control that asks to be clicked twice.
  reset.className = 'reset';
  reset.textContent = 'clear what I typed';
  reset.addEventListener('click', () => {
    state.values = {};
    state.done = {};
    save(state);
    for (const f of FIELDS) {
      const el = document.getElementById(`f-${f.id}`);
      if (el) el.value = '';
    }
    applyValues();
    for (const t of document.querySelectorAll('.tick[data-step]')) setTick(t, false);
  });

  panel.append(fields, cleared, reset);
}

/**
 * How far through the install the reader is.
 *
 * Counts only the steps they can SEE: a text-only deployment has twelve, not
 * thirteen, and telling somebody they are on 7 of 13 when their guide ends at
 * 12 is the kind of small wrongness that makes a reader stop trusting the
 * rest of the page.
 */
function renderProgress() {
  const line = document.querySelector('[data-progress]');
  if (!line) return;
  const steps = [...document.querySelectorAll('ol.steps > li')].filter((li) => !li.hidden);
  const done = steps.filter((li) => state.done[li.dataset.step]).length;
  line.hidden = false;
  if (!done) {
    line.textContent = `${steps.length} steps, none ticked off yet`;
    return;
  }
  line.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = `${done} of ${steps.length}`;
  line.append(b, document.createTextNode(
    done === steps.length ? ' — all done' : ' steps done',
  ));
}

function setTick(button, on) {
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
  button.querySelector('.box').textContent = on ? '✓' : '✓';
  const li = button.closest('li');
  if (li) li.classList.toggle('done', on);
}

function buildTicks() {
  for (const [i, li] of [...document.querySelectorAll('ol.steps > li')].entries()) {
    const key = li.dataset.step || String(i);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tick';
    button.dataset.step = key;
    const box = document.createElement('span');
    box.className = 'box';
    box.textContent = '✓';
    button.append(box, document.createTextNode('done'));
    button.addEventListener('click', () => {
      const next = button.getAttribute('aria-pressed') !== 'true';
      state.done[key] = next;
      save(state);
      setTick(button, next);
      renderProgress();
    });
    setTick(button, Boolean(state.done[key]));
    const body = li.querySelector('div') || li;
    body.insertBefore(button, body.firstChild);
  }
}

/**
 * Inline commands copy when you click them.
 *
 * The block commands have had a copy button since this page existed; the ones
 * in the prose had nothing, so the commands you need when something has gone
 * wrong were the ones you had to select by hand on a phone.
 *
 * NOT A BUTTON ELEMENT, because these sit mid-sentence and a <button> breaks
 * the line box. role and tabindex instead, with Enter and Space, so it is
 * reachable from the keyboard rather than mouse-only.
 *
 * The text is put back after the flash: unlike the block button, the label
 * here IS the command, and replacing it with "copied" would leave somebody
 * looking at a word instead of the thing they came to read.
 */
function buildInlineCopy() {
  for (const el of document.querySelectorAll('code:not(pre code)')) {
    el.classList.add('cancopy');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', 'Click to copy');
    const flash = (ok) => {
      el.classList.add(ok ? 'copied' : 'copyfailed');
      setTimeout(() => el.classList.remove('copied', 'copyfailed'), 1200);
    };
    const go = async () => {
      try {
        if (!navigator.clipboard) throw new Error('no clipboard api');
        await navigator.clipboard.writeText(el.textContent);
        flash(true);
      } catch {
        // http://an-ip-address is not a secure context, which is a normal way
        // to read this page part way through an install. Select it instead so
        // ctrl-c still works.
        try {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        } catch { /* nothing left to try */ }
        flash(false);
      }
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  }
}

function buildCopyButtons() {
  for (const block of document.querySelectorAll('.cmd')) {
    const pre = block.querySelector('pre');
    if (!pre) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy';
    button.textContent = 'copy';
    button.setAttribute('aria-label', 'Copy this command');
    button.addEventListener('click', () => copy(commandText(pre), button));
    block.append(button);
  }
}


/* ------------------------------------------------------------ choices --- */

/**
 * The questions at the top, and the branching they drive.
 *
 * A guide that covers four providers and three desktop operating systems at
 * once is a guide where most of what you read does not apply to you, and the
 * reader has to work out which third is theirs. Answering three questions
 * once hides the rest.
 *
 * THE PAGE IS STILL COMPLETE WITH SCRIPTING OFF. Nothing is hidden in the
 * markup; this hides things at runtime. With no JavaScript every branch is
 * visible, each under its own heading saying who it is for, which is exactly
 * what a printed guide would do.
 */
const CHOICES = [
  {
    id: 'host',
    label: 'Where is the server?',
    options: [
      { value: 'hetzner', label: 'Hetzner Cloud' },
      { value: 'other', label: 'Another provider' },
      { value: 'shell', label: 'I already have a root shell' },
    ],
  },
  {
    id: 'from',
    label: 'What are you connecting from?',
    options: [
      { value: 'windows', label: 'Windows' },
      { value: 'mac', label: 'Mac' },
      { value: 'linux', label: 'Linux' },
    ],
  },
  {
    id: 'uploads',
    label: 'Will it accept photos, video or PDFs?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No, text only' },
    ],
  },
  /* THE DECISIONS THAT USED TO SIT IN THE MIDDLE OF THE READING.
   *
   * A reference book offers alternatives and lets you weigh them. A guide you
   * are following at a terminal, with a half-built server in front of you,
   * should have had that argument already — meeting "or you could do it this
   * other way" at step 9 is where somebody stops and starts reading sideways.
   *
   * So the trade-offs are still ON the options here, where you are choosing
   * on purpose and nothing is half-done yet, and the guide below then shows
   * one path. Leaving a question unanswered still shows everything, which is
   * what a reader with scripting off gets too. */
  {
    id: 'mail',
    label: 'Where will it send mail from?',
    hint: 'Sign-in codes and report confirmations. Not optional \u2014 without '
      + 'working mail no report can be confirmed, and nobody can sign in '
      + 'without reading the code out of the server\u2019s log.',
    options: [
      { value: 'undecided', label: 'Help me choose' },
      { value: 'mailgun', label: 'Mailgun' },
      { value: 'postmark', label: 'Postmark' },
      { value: 'scaleway', label: 'Scaleway' },
      { value: 'own', label: 'My own SMTP' },
    ],
  },
  {
    id: 'account',
    label: 'How will you log in to the server?',
    hint: 'Root works. Your own account with sudo is the habit worth having '
      + 'on a box you intend to keep.',
    options: [
      { value: 'own', label: 'Make myself an account' },
      { value: 'root', label: 'Stay as root' },
    ],
  },
  {
    id: 'path',
    label: 'Scripted install, or step by step?',
    hint: 'The script does the mechanical half. Step by step is the same '
      + 'thing with every command shown.',
    options: [
      { value: 'script', label: 'Run the script' },
      { value: 'manual', label: 'Step by step' },
    ],
  },
];

if (!state.choices) state.choices = {};

/**
 * Should this element be shown?
 *
 * `data-when="host:hetzner"` shows only for that answer;
 * `data-when="from:mac|linux"` for either. An UNANSWERED question shows
 * everything, so the page reads as the full guide until somebody narrows it
 * and never hides a branch behind a question they have not been asked.
 */
function visible(el) {
  const rule = el.dataset.when;
  if (!rule) return true;
  return rule.split(/\s+/).every((clause) => {
    const [key, accepted] = clause.split(':');
    const answer = state.choices[key];
    if (!answer) return true;
    return accepted.split('|').includes(answer);
  });
}

function applyChoices() {
  for (const el of document.querySelectorAll('[data-when]')) {
    el.hidden = !visible(el);
  }
  /* A FOLD-OUT THAT NOW APPLIES TO YOU SHOULD BE OPEN.
   *
   * `data-open-when` is for the few <details> that stopped being an aside the
   * moment somebody answered: the Scaleway values if they picked Scaleway,
   * making yourself an account if they said they would. Leaving them folded
   * would be the same "wait, is this for me?" the questions exist to remove.
   * It only ever OPENS one — a reader who folds it away again is not fought
   * with on the next render. */
  for (const el of document.querySelectorAll('[data-open-when]')) {
    const rule = el.dataset.when;
    el.dataset.when = el.dataset.openWhen;
    if (visible(el) && !el.hidden && el.dataset.wasOpened !== 'yes') {
      el.open = true;
      el.dataset.wasOpened = 'yes';
    }
    el.dataset.when = rule;
  }
  // The step numbers look after themselves: they come from a CSS counter,
  // a hidden element is display:none, and an element that generates no box
  // does not increment a counter. So hiding step 4 renumbers 5 to 4 with no
  // help from here — which is lucky, because writing a number into the
  // markup would mean an inline style, and this file may not write one.
  if (state.walk) showStep(state.at || 0);
  const total = document.querySelector('[data-step-total]');
  if (total) {
    total.textContent = String([...document.querySelectorAll('ol.steps > li')]
      .filter((li) => !li.hidden).length);
  }
  renderProgress();
}

function buildChoices(panel) {
  const wrap = document.createElement('div');
  wrap.className = 'choices';

  for (const q of CHOICES) {
    const row = document.createElement('div');
    row.className = 'choice-row';

    const label = document.createElement('p');
    label.className = 'choice-q';
    label.textContent = q.label;
    row.append(label);

    // The trade-off belongs HERE, next to the choice, rather than three
    // sections later next to the consequence.
    if (q.hint) {
      const h = document.createElement('p');
      h.className = 'choice-hint';
      h.textContent = q.hint;
      row.append(h);
    }

    row.setAttribute('data-choice', q.id);
    const group = document.createElement('div');
    group.className = 'choice-opts';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', q.label);

    for (const o of q.options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice-opt';
      b.dataset.value = o.value;
      b.textContent = o.label;
      b.setAttribute('aria-pressed', String(state.choices[q.id] === o.value));
      b.addEventListener('click', () => {
        // Clicking the chosen one again clears it, which is the only way
        // back to the whole guide without wiping the typed values too.
        state.choices[q.id] = state.choices[q.id] === o.value ? undefined : o.value;
        save(state);
        for (const sib of group.querySelectorAll('.choice-opt')) {
          sib.setAttribute('aria-pressed', 'false');
        }
        b.setAttribute('aria-pressed', String(state.choices[q.id] === o.value));
        applyChoices();
      });
      group.append(b);
    }
    row.append(group);
    wrap.append(row);
  }
  panel.append(wrap);
}

/* ------------------------------------------------------ the start screen ---
 *
 * The two panels are one screen you leave, rather than two cards sitting on
 * top of the guide. You answer them, press on, and the nav bar keeps a way
 * back.
 *
 * THE GATE IS SCRIPT AND SCREEN ONLY, which is the whole constraint here.
 * Nothing below is hidden in the markup, and the CSS that hides it is inside
 * `@media screen` under a body attribute this file sets — so with scripting
 * off, and on paper, the guide is simply all there. That is the promise this
 * page has always made: every command block carries working defaults in its
 * own text, and the script only ever adds conveniences.
 *
 * It is also why a reader who has been here before does not see it again:
 * the saved state decides, so the screen appears once rather than standing
 * between somebody and the step they came back for.
 */
/**
 * `scroll` IS ONLY EVER TRUE FOR A BUTTON PRESS, never for the call on load.
 *
 * Both buttons sit at the bottom of a tall panel, so without it you press
 * Start the guide and land in the middle of the document, looking at whatever
 * step happens to be at that scroll offset.
 *
 * And it must NOT fire on load, because the first call decides the mode for
 * everybody: a reader following `/docs#dns` from a bookmark or a link in
 * these notes would be scrolled off their anchor to the top of the page.
 */
function setMode(mode, scroll) {
  document.body.setAttribute('data-mode', mode);
  const back = document.querySelector('[data-open-start]');
  if (back) back.hidden = mode !== 'guide';
  // The walk bar is part of the guide, so it comes and goes with it.
  const bar = document.querySelector('[data-walk-bar]');
  if (bar) bar.hidden = !state.walk || mode === 'start';
  if (scroll) window.scrollTo(0, 0);
}

/* ------------------------------------------------- one step at a time ---
 *
 * The same thirteen steps, shown one at a time with next and back, for
 * somebody who wants to be walked through rather than handed a document.
 *
 * IT IS A VIEW OVER THE SAME MARKUP, not a second copy of the guide. That is
 * the whole design: nothing here is written twice, the steps are the same
 * <li> elements the scrolling view uses, so there is no second version to
 * drift. Turning it off puts the document back exactly as it was.
 *
 * AND IT IS A CHOICE, NOT THE DEFAULT. An install guide gets searched for an
 * error message, skimmed ahead to see what is coming, printed, and linked to
 * a particular step. One page does all four; a wizard does none of them, and
 * the moment you are stuck is the moment you most want to range around. So
 * the document stays the document and this rides on top of it.
 *
 * Hidden steps are skipped, because the chooser has already decided they do
 * not apply — walking somebody into a step for a branch they are not on is
 * the thing all of this exists to stop.
 */
function stepList() {
  return [...document.querySelectorAll('ol.steps > li')].filter((li) => !li.hidden);
}

function showStep(n) {
  const steps = stepList();
  if (!steps.length) return;
  /* COERCED, because `state.at` comes out of localStorage and the Next button
   * does `state.at + 1`. If the first showStep ever bailed early — the steps
   * were not countable yet — `at` was never set, and `undefined + 1` is NaN.
   * Math.min(NaN, 12) is NaN, so the bar read "Step NaN of 13" and stayed
   * there, because every later click did NaN + 1. Browser storage is input,
   * and this treats it as such rather than trusting its own earlier write. */
  const want = Number(n);
  const at = Number.isFinite(want)
    ? Math.max(0, Math.min(want, steps.length - 1)) : 0;
  state.at = at;
  save(state);
  for (const [i, li] of steps.entries()) li.classList.toggle('stepaway', i !== at);
  const bar = document.querySelector('[data-walk-bar]');
  if (bar) {
    bar.querySelector('[data-walk-at]').textContent = `Step ${at + 1} of ${steps.length}`;
    bar.querySelector('[data-walk-back]').disabled = at === 0;
    bar.querySelector('[data-walk-next]').disabled = at === steps.length - 1;
  }
  steps[at].scrollIntoView({ block: 'start' });
  // The heading, not the top of the window: the sticky bar would otherwise
  // sit over the first line of it.
  window.scrollBy(0, -70);
}

function setWalk(on) {
  state.walk = Boolean(on);
  save(state);
  document.body.classList.toggle('walking', state.walk);
  /* THE BAR BELONGS TO THE GUIDE, NOT TO THE START SCREEN.
   *
   * `walk` is remembered, so a reader who turned it on once came back to a
   * fixed Next button sitting under the start screen, stepping through a list
   * that was not on screen. It looked like the steps were broken, and in
   * effect they were. */
  const bar = document.querySelector('[data-walk-bar]');
  if (bar) bar.hidden = !state.walk || document.body.getAttribute('data-mode') === 'start';
  const toggle = document.querySelector('[data-walk-toggle]');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(state.walk));
    toggle.textContent = state.walk ? 'Show the whole guide' : 'One step at a time';
  }
  if (state.walk) showStep(state.at || 0);
  else for (const li of document.querySelectorAll('ol.steps > li')) li.classList.remove('stepaway');
}

function buildWalk() {
  const steps = document.querySelector('ol.steps');
  if (!steps) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'walktoggle';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.textContent = 'One step at a time';
  toggle.addEventListener('click', () => setWalk(!state.walk));
  steps.parentElement.insertBefore(toggle, steps);

  const bar = document.createElement('div');
  bar.className = 'walkbar';
  bar.setAttribute('data-walk-bar', '');
  bar.hidden = true;
  bar.innerHTML = '<button type="button" class="walkbtn" data-walk-back>Back</button>'
    + '<span class="walkat" data-walk-at aria-live="polite"></span>'
    + '<button type="button" class="walkbtn is-next" data-walk-next>Next step</button>';
  bar.querySelector('[data-walk-back]').addEventListener('click', () => showStep(state.at - 1));
  bar.querySelector('[data-walk-next]').addEventListener('click', () => showStep(state.at + 1));
  document.body.append(bar);

  if (state.walk) setWalk(true);
}

/**
 * "Do it the other way" — change ONE decision without going back to the top.
 *
 * The questions belong on the first screen, and a reader who is standing at a
 * half-built server should not have to walk back there to change their mind
 * about one of them. The button writes the same answer the chooser writes, so
 * the page re-branches exactly as if it had been answered up front, and the
 * start screen shows the new answer when they next open it.
 */
function buildOtherWay() {
  for (const b of document.querySelectorAll('[data-set-path]')) {
    b.addEventListener('click', () => {
      state.choices.path = b.dataset.setPath;
      save(state);
      for (const opt of document.querySelectorAll('[data-choice="path"] .choice-opt')) {
        opt.setAttribute('aria-pressed', String(opt.dataset.value === state.choices.path));
      }
      applyChoices();
      const shown = document.querySelector(`[data-when="path:${state.choices.path}"]`);
      if (shown) shown.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -70);
    });
  }
}

function buildStartScreen() {
  const screen = document.querySelector('[data-start-screen]');
  const open = document.querySelector('[data-open-start]');
  if (!screen) return;

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'startgo';
  go.textContent = 'Start the guide';
  go.addEventListener('click', () => {
    state.started = true;
    save(state);
    setMode('guide', true);
  });
  screen.append(go);

  if (open) {
    open.addEventListener('click', () => setMode('start', true));
  }

  // Anything already answered means this reader has been here, so the guide
  // is what they came for. A fresh reader gets the screen.
  const answered = Object.keys(state.values || {}).some((k) => state.values[k])
    || Object.keys(state.choices || {}).length > 0;
  setMode(state.started || answered ? 'guide' : 'start');
}

buildCopyButtons();
buildInlineCopy();
buildTicks();
buildWalk();
buildOtherWay();
const choicePanel = document.querySelector('[data-choices-panel]');
if (choicePanel) buildChoices(choicePanel);
const panel = document.querySelector('[data-setup-panel]');
if (panel) buildPanel(panel);
buildStartScreen();
applyValues();
applyChoices();
renderProgress();
