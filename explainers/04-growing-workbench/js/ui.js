/* The growing workbench. Everything is derived from: how many messages are shown, and what you answered. */
(function () {
  const R = window.REPLAY, P = window.Pixel;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let act = 1, S, timer = null;

  const fresh = () => ({ pos: 0, accepted: [], declined: [], asked: [], ctl: [], pending: null, fresh: null, jump: null });

  /* ---------- Derived numbers ---------- */
  function stats() {
    const shown = R.MESSAGES.slice(0, S.pos);
    const tasks = new Set(); shown.forEach(m => { if (m.task) tasks.add(m.task[0]); if (m.task2) tasks.add(m.task2[0]); });
    return { messages: S.pos, decisions: shown.filter(m => m.dec).length, tasks: tasks.size, sources: shown.filter(m => m.src).length };
  }
  function taskStates() {
    const st = {};
    R.MESSAGES.slice(0, S.pos).forEach(m => { [m.task, m.task2].forEach(t => { if (t) st[t[0]] = t[1]; }); });
    return st;
  }
  function checkRules() {
    if (S.pending) return;
    const s = stats();
    for (const r of R.RULES) {
      if (S.asked.includes(r.mod)) continue;
      const n = r.count(s);
      if (n >= r.at) { S.asked.push(r.mod); S.pending = r.mod; S.ctl.push({ after: S.pos, mod: r.mod, text: r.ask(n), state: 'pending' }); stop(); return; }
    }
  }

  /* ---------- Act 1 ---------- */
  const ERAS = [
    ['1960s', 'teletype', 'Teletype and shell', 'One line in, one line out. The conversation is the interface. Chat today is exactly this, with nicer fonts.'],
    ['1975', 'house', 'Piecemeal growth', 'Christopher Alexander’s Oregon Experiment: good places grow in small steps, decided by the people who use them, not in one master plan.'],
    ['1984', 'wheel', 'Training wheels', 'Carroll and Carrithers blocked advanced functions for beginners, who then learned faster. Complexity can be introduced, not just shown.'],
    ['1986', 'commander', 'Norton Commander', 'Two panels, still pure text. The terminal learned that real work needs more than one view at a time.'],
    ['1990', 'windows', 'Turbo Vision', 'Borland drew windows, menus and dialogs in characters. A whole workbench, without leaving text mode.'],
    ['1994', 'house', 'How buildings learn', 'Stewart Brand: buildings adapt by adding rooms, and by letting unused ones go. Growth includes shrinking.'],
    ['2001', 'perspective', 'Eclipse perspectives', 'Panel arrangements per task. Before switching, the IDE asked: “Do you want to open this perspective now?”'],
    ['2025', 'agent', 'Coding agents', 'The terminal returns: coding agents run as text-mode chats. One line in, one line out, again.']
  ];
  function act1() {
    return `<ol class="eras">${ERAS.map(([y, sp, t, d], i) => `<li class="era ${i === ERAS.length - 1 ? 'now' : ''}">${P.sprite(sp, 56, t)}<div><span class="yr">${y}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></div></li>`).join('')}</ol>
      <p class="closing">Every era solved a piece of it. The terminal grew panels. Beginners got training wheels. IDEs got perspectives and asked before switching. What is still rare: an interface that grows with the work itself.</p>
      <button type="button" class="btn solid" data-go="2">Replay a conversation that grows</button>`;
  }

  /* ---------- Act 2 ---------- */
  function transcript() {
    let h = '';
    const ctlAt = i => S.ctl.filter(c => c.after === i);
    const ctlLine = c => {
      const rule = R.RULES.find(r => r.mod === c.mod);
      const res = c.state === 'yes' ? `<span class="ln sys">› pane added: ${esc(rule.name)}</span>` : c.state === 'no' ? `<span class="ln sys">› remembered: no ${esc(rule.name.toLowerCase())}. I won’t ask again.</span>` : '';
      return `<div class="ln ctl ${c.state !== 'pending' ? 'done' : ''}">${P.sprite('keeper', 28, 'controller')}<span><span class="q"><b>controller ›</b> ${esc(c.text)}</span>${c.state === 'pending' ? `<span class="keys"><button type="button" class="btn solid" data-ans="y">[y] yes</button><button type="button" class="btn" data-ans="n">[n] no</button></span>` : ''}</span></div>${res}`;
    };
    h += `<div class="ln sys">› workbench started. One pane: chat. Rules are visible above.</div>`;
    R.MESSAGES.slice(0, S.pos).forEach((m, i) => {
      h += `<p class="ln ${m.r} ${S.jump === i ? 'flash' : ''}" id="msg-${i}"><span class="who">${m.r === 'you' ? 'you ›' : 'claude ›'}</span>${esc(m.t)}</p>`;
      ctlAt(i + 1).forEach(c => { h += ctlLine(c); });
    });
    if (S.pos === R.MESSAGES.length && !S.pending) h += `<div class="ln sys">› replay complete. The workbench grew from 1 to ${S.accepted.length + 1} panes. Nothing appeared without your yes.</div>`;
    return h;
  }
  function modBody(mod) {
    const shown = R.MESSAGES.slice(0, S.pos);
    if (mod === 'index') return `<ol class="idx">${shown.map((m, i) => `<li><button type="button" data-jump="${i}">${esc(m.title)}</button></li>`).join('')}</ol>`;
    if (mod === 'map') {
      const decs = shown.map((m, i) => ({ m, i })).filter(x => x.m.dec);
      return `<p class="legend"><i style="background:var(--amber)"></i>said by you<i style="background:var(--cyan)"></i>said by claude</p>
        <ol class="map">${decs.map((x, k) => `<li class="${x.m.r} ${k === decs.length - 1 ? 'new' : ''}">${esc(x.m.dec)}<small>message ${x.i + 1}</small></li>`).join('')}</ol>`;
    }
    if (mod === 'kanban') {
      const st = taskStates();
      const col = (k, label) => `<div class="${k}"><h4>${label}</h4>${Object.entries(st).filter(([, v]) => v === k).map(([id]) => `<div class="card">${esc(R.TASKS[id])}</div>`).join('')}</div>`;
      return `<div class="kan">${col('todo', 'todo')}${col('doing', 'doing')}${col('done', 'done')}</div>`;
    }
    if (mod === 'sources') return `<ul class="srcs">${shown.filter(m => m.src).map(m => `<li>▪ <a href="${esc(m.src[1])}" target="_blank" rel="noopener">${esc(m.src[0])}</a></li>`).join('')}</ul>`;
  }
  function pane(mod, i) {
    const r = R.RULES.find(x => x.mod === mod);
    return `<section class="pane ${S.fresh === mod ? 'fresh' : ''}" style="view-transition-name:pane-${mod}" aria-label="${esc(r.name)}">
      <div class="bar"><span>[${i + 2}] ${esc(r.name.toLowerCase())}</span><small>added at message ${S.ctl.find(c => c.mod === mod).after}</small></div>
      <div class="body">${modBody(mod)}</div></section>`;
  }
  function act2() {
    const s = stats(), n = S.accepted.length;
    const rules = R.RULES.map(r => `<span class="${S.accepted.includes(r.mod) ? 'on' : S.declined.includes(r.mod) ? 'off' : ''}">${esc(r.name)} at ${r.at} ${r.mod === 'index' ? 'messages' : r.mod === 'map' ? 'decisions' : r.mod === 'kanban' ? 'tasks' : 'sources'}</span>`).join(' · ');
    const cols = n >= 3 ? [S.accepted.filter((_, i) => i % 2 === 0), S.accepted.filter((_, i) => i % 2 === 1)] : n ? [S.accepted] : [];
    let k = 0; const idxOf = {}; S.accepted.forEach(m => { idxOf[m] = k++; });
    return `<div class="ctrl">
        <button type="button" class="btn solid" id="next" ${S.pending || S.pos >= R.MESSAGES.length ? 'disabled' : ''}>Next message</button>
        <button type="button" class="btn" id="auto" ${S.pending || S.pos >= R.MESSAGES.length ? 'disabled' : ''}>${timer ? 'Pause' : 'Auto'}</button>
        <button type="button" class="btn" id="restart">Restart</button>
        <span class="hint">Keys: → next · y / n answer the controller</span>
      </div>
      <p class="rules"><b>Growth rules</b> (deterministic, visible): ${rules}</p>
      <div class="bench n${Math.min(n, 4)}">
        <section class="pane term" style="view-transition-name:pane-chat" aria-label="Chat">
          <div class="bar"><span>[1] chat</span><small>this conversation, condensed</small></div>
          <div class="body" id="tbody" aria-live="polite">${transcript()}</div>
          <div class="prompt">› <span class="cursor"></span></div>
        </section>
        ${cols.map(c => `<div class="col">${c.map(m => pane(m, idxOf[m])).join('')}</div>`).join('')}
      </div>
      <div class="status"><span>workbench · msgs ${s.messages} · decisions ${s.decisions} · tasks ${s.tasks} · sources ${s.sources}</span><span>panes: chat${S.accepted.map(m => ' · ' + m).join('')}</span></div>
      ${S.pos >= R.MESSAGES.length && !S.pending ? `<p style="margin-top:18px"><button type="button" class="btn solid" data-go="3">What comes next</button></p>` : ''}`;
  }

  /* ---------- Act 3 ---------- */
  const SHRINK = [
    ['Remove it automatically', 'Quiet and tidy, until the day you need the board and it is gone. A disappearing pane is a surprise, and surprises cost trust.'],
    ['Ask', '“Kanban unused for 9 days. Remove it?” Honest, but every question is an interruption. Ask too often and the controller becomes the thing you want to remove.'],
    ['Let it fade', 'Brand’s buildings: unused rooms become storage before they are torn down. The pane shrinks to a tab and comes back when touched. But who decides when “storage” becomes “gone”?']
  ];
  function act3() {
    return `<div class="two">
      <section><h2>The open problem: rooms must also go</h2>
        <p>Growing is the easy half. A threshold fires, the controller asks, a pane appears. Shrinking is harder, because the signal is an absence.</p>
        <div class="stage-q"><div class="scene">${P.sprite('keeper', 40, 'controller')}<span><b>controller ›</b> The kanban pane has not been touched for 9 days.</span></div>
          <div class="opts">${SHRINK.map((o, i) => `<button type="button" class="btn" data-shrink="${i}">${esc(o[0])}</button>`).join('')}</div>
          <p class="answer" id="shrinkAnswer" aria-live="polite">Pick an option to see why it is not enough on its own.</p>
        </div>
        <p style="margin-top:14px">This stays open on purpose. It is the first thing the real pilot has to learn.</p>
      </section>
      <section class="pane spec"><div class="bar"><span>$ cat pilot-v1.md</span><small>draft for the next session</small></div><div class="body"><pre>
<span class="h"># CLI Pilot v1</span>
<span class="m">One terminal. Not really a terminal.</span>

<span class="h">Goal</span>
A chat that grows into a workbench as the project
grows. Proven on one real project for one week.

<span class="h">In v1</span>
<span class="c">▪</span> One chat pane against any OpenAI-compatible
  endpoint: Morrow/Qwen locally, or a frontier model.
<span class="c">▪</span> Project state in files, nothing in the session:
  .pilot/transcript.jsonl
  .pilot/state.json      decisions, tasks, sources
  .pilot/modules.json    panes and your answers
<span class="c">▪</span> A deterministic controller with visible rules,
  four thresholds in one editable file.
<span class="c">▪</span> Three panes to start:
  index    computed from messages, no model
  map      model proposes decisions, you confirm
  kanban   model proposes tasks, you confirm
<span class="c">▪</span> Consent for every new pane:
  [y] yes  [n] no  [a] always  [x] never
<span class="c">▪</span> Every item says who authored it: you, or the
  model with your confirmation.

<span class="h">Not in v1</span>
Real shell, removing panes, several users, MCP, voice.

<span class="h">Done when</span>
<span class="c">▪</span> State survives a restart.
<span class="c">▪</span> No pane appeared without your yes.
<span class="c">▪</span> You jumped back via the index at least three
  times in one session.
<span class="c">▪</span> At least one proposed decision or task was
  worth confirming.

<span class="h">Decide next session</span>
<span class="m">Browser-based fake terminal (morphing, pixel art)
or a real TUI (Textual, Ink)? Where does the small
controller run, and when does it get a model?</span>
</pre></div></section>
    </div>`;
  }

  /* ---------- Render and events ---------- */
  function render(morph) {
    const draw = () => {
      $('main').innerHTML = act === 1 ? act1() : act === 2 ? act2() : act3();
      const tb = $('tbody');
      if (tb) {
        if (S.jump != null) { const el = $('msg-' + S.jump); if (el) tb.scrollTop = el.offsetTop - tb.offsetTop - 20; }
        else tb.scrollTop = tb.scrollHeight;
      }
    };
    if (morph && document.startViewTransition && !reduced.matches) document.startViewTransition(draw); else draw();
  }
  function stop() { clearInterval(timer); timer = null; }
  function next() {
    if (S.pending || S.pos >= R.MESSAGES.length) { stop(); return; }
    S.pos++; S.jump = null; S.fresh = null;
    checkRules();
    if (S.pos >= R.MESSAGES.length) stop();
    render(false);
  }
  function answer(yes) {
    if (!S.pending) return;
    const c = S.ctl.find(x => x.mod === S.pending && x.state === 'pending');
    c.state = yes ? 'yes' : 'no';
    if (yes) { S.accepted.push(S.pending); S.fresh = S.pending; } else S.declined.push(S.pending);
    S.pending = null; S.jump = null;
    checkRules();
    render(yes);
  }
  function setAct(n) {
    stop(); act = n; if (n === 2) S = fresh();
    document.querySelectorAll('.acts button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.act === n)));
    render(false);
    window.scrollTo({ top: document.querySelector('.acts').offsetTop - 10, behavior: reduced.matches ? 'auto' : 'smooth' });
  }

  document.querySelector('.acts').onclick = e => { const b = e.target.closest('button'); if (b) setAct(+b.dataset.act); };
  $('main').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) return setAct(+b.dataset.go);
    if (b.id === 'next') return next();
    if (b.id === 'auto') { if (timer) stop(); else timer = setInterval(next, 1100); return render(false); }
    if (b.id === 'restart') return setAct(2);
    if (b.dataset.ans) return answer(b.dataset.ans === 'y');
    if (b.dataset.jump) { S.jump = +b.dataset.jump; return render(false); }
    if (b.dataset.shrink) $('shrinkAnswer').textContent = SHRINK[+b.dataset.shrink][1];
  });
  document.addEventListener('keydown', e => {
    if (act !== 2 || e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.key === 'y' || e.key === 'n') answer(e.key === 'y');
  });

  $('brand').innerHTML = P.sprite('keeper', 36, 'controller') + P.sprite('agent', 36, 'terminal');
  S = fresh();
  render(false);
})();
