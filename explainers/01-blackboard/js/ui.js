/* Darstellung und Bedienung. Liest nur den Engine-Zustand, entscheidet nichts selbst. */
(function () {
  const B = window.Blackboard, S = window.SCENARIO;
  const $ = id => document.getElementById(id);
  const f2 = n => n.toFixed(2).replace(/^0/, '');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = t => (t / S.end) * 100;

  let act = 1, st, timer = null, selected = null;

  const ACTS = {
    1: {
      cfg: { strategy: 'opportunistisch', streaming: false },
      intro: `<div>
        <p>Ein Sprecher fragt eine Literaturdatenbank: <em>„Are any by Feigenbaum and Feldman?"</em> Das Signal ist verrauscht, manche Silben sind kaum zu hören.</p>
        <p>Sechs Wissensquellen beobachten die Tafel. Sobald eine etwas beitragen kann, meldet sie sich. Was sie anschreibt, ist immer eine Vermutung mit Glaubwürdigkeit, nie eine Tatsache. Drück <strong>Schritt</strong> für einen Zyklus.</p>
      </div>
      <div class="aside">
        <p><strong>Achte auf zwei Dinge.</strong> Erstens wächst die Erkennung von der sichersten Stelle aus, nicht von links nach rechts. „Feigenbaum" ist gut zu hören und wird zur Insel.</p>
        <p>Zweitens ist „and" genuschelt. Der Worterkenner übersieht es. Erst die Vorhersage von oben findet es wieder (rosa).</p>
      </div>`
    },
    2: {
      cfg: { strategy: 'opportunistisch', streaming: false },
      strategy: true,
      intro: null
    },
    3: {
      cfg: { strategy: 'opportunistisch', streaming: true },
      intro: `<div>
        <p>Jetzt kommt das Signal live, Silbe für Silbe. Rechts ist noch nichts gesprochen.</p>
        <p>1976 war die Frage, wann jemand fertig gesprochen hat, einfach: Die Aufnahme endete. Im Chat beantwortet sie die Enter-Taste. Eine Oberfläche, die mit einem Modell einen gemeinsamen Zustand teilt, hat weder das eine noch das andere. Spiel den Akt ab und schau, wo das System hängen bleibt.</p>
      </div>
      <div class="aside">
        <p>Die Engine ist dieselbe wie in Akt 1. Neu ist nur, dass das Signal Stück für Stück eintrifft, wenn die Agenda leer ist.</p>
      </div>`
    }
  };

  function act2Intro() {
    const a = B.run({ strategy: 'opportunistisch' }), b = B.run({ strategy: 'schichtweise' });
    const max = Math.max(a.cycle, b.cycle);
    return `<div>
      <p>Welche Wissensquelle als Nächstes schreiben darf, entscheidet die Agenda. In Hearsay-II sass hier die eigentliche Intelligenz. Dieselben Daten, zwei Strategien:</p>
      <p><strong>Opportunistisch:</strong> Die glaubwürdigste Aktivierung zuerst, egal auf welcher Ebene. Inseln der Sicherheit wachsen nach aussen.<br>
      <strong>Schichtweise:</strong> Erst alle Silben, dann alle Wörter, dann alle Folgen. Gründlich, aber blind für Kontext. Es liest auch jede schwache Silbe und baut jede mögliche Folge.</p>
      <div class="compare">
        <div>Opportunistisch: ${a.cycle} Zyklen, ${a.hyps.length} Hypothesen<div class="bar" style="width:${a.cycle / max * 100}%"></div></div>
        <div>Schichtweise: ${b.cycle} Zyklen, ${b.hyps.length} Hypothesen<div class="bar b" style="width:${b.cycle / max * 100}%"></div></div>
      </div>
      <p>1985 machte Barbara Hayes-Roth mit BB1 die Steuerung selbst zu einem Blackboard-Problem: Kontroll-Wissensquellen schreiben Strategien auf eine eigene Tafel. Dort sässe heute ein kleines Sprachmodell als Agenda. Es wählt aus einer geschlossenen Liste und schreibt nie selbst an die Tafel.</p>
    </div>
    <div class="aside">
      <p><strong>Damals und heute.</strong> br-ai-nstorm ist dieselbe Architektur, fünfzig Jahre später.</p>
      <table class="map">
        <tr><th>Hearsay-II</th><th>br-ai-nstorm</th></tr>
        <tr><td>Tafel</td><td>gemeinsamer Problemspeicher</td></tr>
        <tr><td>Hypothese mit Glaubwürdigkeit</td><td>Beitrag oder Vorschlag mit Endorsement</td></tr>
        <tr><td>Wissensquelle</td><td>Kurator, erst deterministisch, dann LLM</td></tr>
        <tr><td>Agenda</td><td>fehlt noch: Kuration läuft bei jedem Beitrag</td></tr>
        <tr><td>Strategie</td><td>Orchestrierungsmodus</td></tr>
        <tr><td>Ende der Aufnahme</td><td>„Beitrag absenden"</td></tr>
      </table>
    </div>`;
  }

  /* ---------- Tafel ---------- */
  function lanes(hs) {
    const ends = [], out = new Map();
    [...hs].sort((a, b) => a.start - b.start || a.born - b.born).forEach(h => {
      let i = ends.findIndex(e => e <= h.start);
      if (i < 0) { i = ends.length; ends.push(0); }
      ends[i] = h.end; out.set(h.id, i);
    });
    return { map: out, count: Math.max(1, ends.length) };
  }

  function chain(id, acc = new Set()) {
    if (!id || acc.has(id)) return acc;
    acc.add(id);
    const h = st.hyps.find(x => x.id === id);
    (h && h.support || []).forEach(s => chain(s, acc));
    return acc;
  }

  function renderBoard() {
    const sel = selected ? chain(selected) : null;
    let html = '';
    for (const lv of S.levels) {
      const hs = st.hyps.filter(h => h.level === lv.id);
      const { map, count } = lanes(hs);
      html += `<div class="row"><div class="rowlabel">${lv.name}</div><div class="track" style="height:${count * 32 + 8}px">`;
      for (const h of hs) {
        const cls = ['chip',
          lv.id === 'phrase' ? 'phrase' : '',
          h.status === 'vorhergesagt' || h.status === 'bestätigt' ? 'top' : '',
          h.status === 'verworfen' ? 'gone' : '',
          sel ? (sel.has(h.id) ? 'chain' : 'dim') : '',
          (h.born === st.cycle || h.touched === st.cycle) ? 'new' : ''].filter(Boolean).join(' ');
        html += `<button type="button" class="${cls}" data-id="${h.id}"
          style="left:calc(${pct(h.start)}% + 2px);width:calc(${pct(h.end - h.start)}% - 4px);top:${map.get(h.id) * 32}px;--w:${h.score * 100}%"
          aria-label="${esc(lv.name)}: ${esc(h.label)}, ${h.status}, Glaubwürdigkeit ${f2(h.score)}" title="${esc(h.label)} (${f2(h.score)})">
          <span class="lab">${esc(h.label)}</span>${h.end - h.start > 1 ? `<span class="sc">${f2(h.score)}</span>` : ''}</button>`;
      }
      html += `</div></div>`;
    }
    // Signal
    html += `<div class="row signal"><div class="rowlabel">Signal</div><div class="track">`;
    for (const [a, b] of S.silences) if (b <= st.available) html += `<div class="silence" style="left:${pct(a)}%;width:${pct(b - a)}%">Stille</div>`;
    const starts = [...new Set(S.syllables.filter(s => s.end <= st.available).map(s => s.start))];
    for (const t of starts) {
      const cands = S.syllables.filter(s => s.start === t);
      html += `<div class="tick" style="left:${pct(t)}%;width:${pct(1)}%">${cands.map(s => `<b style="--o:${.3 + s.score * .7}">${s.label}</b>`).join('')}</div>`;
    }
    if (st.available < S.end) html += `<div class="unheard" style="left:${pct(st.available)}%">noch nicht gesprochen</div>`;
    html += `</div></div>`;
    $('board').innerHTML = html;
  }

  function renderDetail() {
    const h = selected && st.hyps.find(x => x.id === selected);
    if (!h) { $('detail').textContent = 'Klick auf eine Hypothese an der Tafel, um zu sehen, worauf sie sich stützt.'; return; }
    const lv = S.levels.find(l => l.id === h.level).name;
    const ks = S.ks[h.ks] ? S.ks[h.ks].name : h.ks;
    const sup = (h.support || []).map(id => st.hyps.find(x => x.id === id)).filter(Boolean).map(x => `„${x.label}"`).join(', ');
    $('detail').innerHTML = `<strong>${esc(lv)} „${esc(h.label)}"</strong>, angeschrieben vom ${esc(ks)} in Zyklus ${h.born}. Status: ${h.status}, Glaubwürdigkeit ${f2(h.score)}.${sup ? ` Stützt sich auf ${esc(sup)}.` : ''}`;
  }

  function renderSide() {
    const list = B.agenda(st);
    const top = list.slice(0, 7);
    $('agenda').innerHTML = top.length ? top.map((k, i) => `<li class="${i === 0 ? 'next' : ''}">
        <span class="who">${esc(S.ks[k.ks].name)}</span>
        <span class="r">${st.strategy === 'schichtweise' ? 'Schicht ' + ({ POM: 6, MOW: 5, SEQ: 4, PREDICT: 3, VERIFY: 2, PARSE: 1 })[k.ks] + ', ' : ''}${f2(k.rating)}</span>
        <span class="why">${esc(k.why)}</span></li>`).join('') + (list.length > 7 ? `<li class="empty">und ${list.length - 7} weitere</li>` : '')
      : `<li class="empty">${st.halted === 'solved' ? 'Nichts mehr zu tun.' : st.streaming && st.available < S.end ? 'Leer. Die Tafel wartet auf Signal.' : 'Leer.'}</li>`;
    $('ks').innerHTML = Object.entries(S.ks).map(([id, k]) => `<li class="${st.last && st.last.ks === id ? 'on' : ''}">
        <span class="n">${st.fired[id] || 0}×</span><span class="name">${esc(k.name)}</span><span class="dir ${k.dir === 'top-down' ? 'td' : ''}">${k.dir}</span>
        <p>${esc(k.text)}</p></li>`).join('');
  }

  function renderLog() {
    $('log').innerHTML = st.log.slice().reverse().map(l =>
      `<li><b>${l.cycle}</b> <i>${l.ks === 'SIGNAL' ? 'Signal' : esc(S.ks[l.ks].name)}</i> ${esc(l.text)}</li>`).join('');
  }

  function renderStatus() {
    const n = st.hyps.length;
    let t = `Zyklus ${st.cycle}, ${n} Hypothese${n === 1 ? '' : 'n'} an der Tafel.`;
    if (st.halted === 'solved') t = `Erkannt in ${st.cycle} Zyklen: „${S.utterance}". ${n} Hypothesen an der Tafel, die meisten davon Umwege.`;
    if (st.halted === 'stuck') t = 'Die Agenda ist leer und es kommt kein Signal mehr.';
    if (st.halted === 'question') t = 'Angehalten: An der Tafel steht ein vollständiger Satz, danach Stille.';
    $('status').textContent = t;
    const over = st.halted === 'solved' || st.halted === 'stuck';
    $('step').disabled = over || st.halted === 'question';
    $('play').disabled = over || st.halted === 'question';
    $('play').textContent = timer ? 'Anhalten' : 'Abspielen';
  }

  function renderQuestion() {
    const q = $('question');
    if (st.halted !== 'question') { q.hidden = true; return; }
    if (!q.hidden) return;
    q.hidden = false;
    q.innerHTML = `<h3>Ist der Sprecher fertig?</h3>
      <p>An der Tafel steht ein vollständiger, gültiger Satz: <em>„Are any by Feigenbaum"</em>. Danach kommt Stille. Soll das System jetzt antworten?</p>
      <div class="opts">
        <button type="button" class="btn" data-a="0">Auf Stille warten</button>
        <button type="button" class="btn" data-a="1">Dem Satz glauben</button>
        <button type="button" class="btn" data-a="2">Den Sprecher fragen</button>
      </div>
      <p class="answer" id="answer" aria-live="polite"></p>
      <button type="button" class="btn primary" id="listen">Weiter zuhören</button>`;
  }

  const ANSWERS = [
    'Die Pause nach „Feigenbaum" sieht aus wie ein Ende, aber der Sprecher zögert nur. Eine längere Schwelle macht das System träge, eine kürzere schneidet ab.',
    'Die Tafel hat recht: Der Satz ist vollständig und grammatisch korrekt. Vollständig heisst aber nicht fertig.',
    'Der Sprecher sagt selbst, wann er fertig ist. Das funktioniert immer und ist genau der Enter-Knopf, den wir loswerden wollen.'
  ];

  function renderOpen() {
    const o = $('open');
    const show = act === 3 && st.halted === 'solved';
    o.hidden = !show;
    if (!show) return;
    o.innerHTML = `<h2>Offene Frage: Wie verschwindet der Enter-Knopf?</h2>
      <div class="cols">
        <div>
          <p>Am Ende hat das System den ganzen Satz erkannt, aber nur, weil das Signal aufgehört hat. Diese Antwort gibt es nur bei einer Aufnahme.</p>
          <p>Kein Signal reicht allein. Stille täuscht, weil Menschen zögern. Vollständigkeit täuscht, weil ein Satz weitergehen kann. Fragen funktioniert, ist aber der Knopf selbst.</p>
          <p>Offen ist, wer diese Signale abwägt. Vielleicht die Agenda, so wie sie entscheidet, wer an die Tafel darf? Und offen ist, ob ein Abschluss vorläufig sein darf: handeln, aber korrigierbar bleiben, wenn der Sprecher doch weiterredet.</p>
        </div>
        <table>
          <tr><td>Hearsay-II, 1976</td><td>Die Aufnahme endet.</td></tr>
          <tr><td>Chat</td><td>Enter.</td></tr>
          <tr><td>br-ai-nstorm</td><td>„Beitrag absenden".</td></tr>
          <tr><td>Oberfläche mit gemeinsamem Zustand</td><td>?</td></tr>
        </table>
      </div>`;
    if (!o.dataset.seen) { o.dataset.seen = '1'; o.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
  }

  function render() {
    renderBoard(); renderDetail(); renderSide(); renderLog(); renderStatus(); renderQuestion(); renderOpen();
  }

  /* ---------- Bedienung ---------- */
  function stop() { clearInterval(timer); timer = null; }
  function doStep() {
    B.step(st);
    if (st.halted) stop();
    render();
  }
  function start() {
    stop();
    const a = ACTS[act];
    const strategy = a.strategy ? $('strategy').value : a.cfg.strategy;
    st = B.create({ ...a.cfg, strategy });
    selected = null;
    $('question').hidden = true;
    $('open').dataset.seen = '';
    render();
  }
  function setAct(n) {
    act = n;
    document.querySelectorAll('.acts button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.act === n)));
    $('intro').innerHTML = n === 2 ? act2Intro() : ACTS[n].intro;
    $('strategyWrap').hidden = !ACTS[n].strategy;
    if (!ACTS[n].strategy) $('strategy').value = 'opportunistisch';
    start();
  }

  $('step').onclick = doStep;
  $('play').onclick = () => {
    if (timer) { stop(); renderStatus(); return; }
    timer = setInterval(doStep, 550); renderStatus();
  };
  $('reset').onclick = start;
  $('strategy').onchange = start;
  document.querySelector('.acts').onclick = e => { const b = e.target.closest('button'); if (b) setAct(+b.dataset.act); };
  $('board').onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    selected = selected === c.dataset.id ? null : c.dataset.id;
    renderBoard(); renderDetail();
  };
  $('question').onclick = e => {
    const a = e.target.closest('[data-a]');
    if (a) { $('answer').textContent = ANSWERS[+a.dataset.a]; return; }
    if (e.target.id === 'listen') { $('question').hidden = true; doStep(); }
  };
  document.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' || e.target.closest('select, input, textarea')) return;
    if (!$('step').disabled) { e.preventDefault(); doStep(); }
  });

  setAct(1);
})();
