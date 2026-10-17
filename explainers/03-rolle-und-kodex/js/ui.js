/* Darstellung. Jede Spur wird für Schritt k aus den Schritten 0..k berechnet: deterministisch, vor- und zurückspulbar. */
(function () {
  const K = window.KODEX;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const name = id => K.ITEMS.find(i => i.id === id).name;
  let act = 1, step = 0;

  /* ---------- Spuren berechnen ---------- */
  function chatLane(lane, k) {
    const entries = []; let local = {};
    for (let i = 0; i <= k; i++) {
      const s = K.STEPS[i][lane];
      if (s.reset) { local = {}; entries.push({ sep: 'Seite neu geladen', at: i }); }
      if (s.set) Object.assign(local, s.set);
      (s.add || []).forEach(e => entries.push({ ...e, at: i }));
    }
    return { entries, local };
  }
  function kodexLane(k) {
    const st = { ...K.BASE }; let rev = 1, by = 'Ausgangslage', focus = [], deps = false, frame = null; const log = [];
    let proposal = null, rejected = null, missing = null, paved = null;
    for (let i = 0; i <= k; i++) {
      const s = K.STEPS[i].kodex;
      if (s.state) { Object.assign(st, s.state); rev++; by = s.by; }
      if (s.focus) { focus = s.focus; deps = !!s.deps; }
      if (s.frame) frame = s.frame;
      if (s.log) log.unshift(s.log);
      if (i === k) { proposal = s.proposal; rejected = s.rejected; missing = s.missing; paved = s.paved; }
      else if (s.proposal) proposal = null;
    }
    if (K.STEPS[k].kodex.proposal == null && k > 4 && k < 6) proposal = null;
    return { st, rev, by, focus, deps, frame, log, proposal, rejected, missing, paved };
  }

  /* ---------- Rendern ---------- */
  function renderChat(lane) {
    const { entries, local } = chatLane(lane, step);
    const html = entries.map(e => {
      const cls = e.at === step ? ' new' : '';
      if (e.sep) return `<div class="sep${cls}">${esc(e.sep)}</div>`;
      if (e.u) return `<div class="msg${cls}">${esc(e.u)}${e.fromUi ? '<span class="ui">gesendet vom Knopf, gespeichert wie getippt</span>' : ''}</div>`;
      if (e.sys) return `<div class="sys${cls}">${esc(e.sys)}</div>`;
      let c = `<div class="card${cls}"><b>${esc(e.title)}</b>`;
      const rows = e.rows === 'all' ? K.ITEMS.map(i => i.id) : (e.rows || []);
      c += rows.map(id => { const v = local[id] || K.BASE[id]; return `<div class="r"><span>${esc(name(id))}</span><span class="v${local[id] ? ' changed' : ''}">${esc(v)}</span></div>`; }).join('');
      if (e.button) c += `<span class="fake-btn">${esc(e.button)}</span>`;
      if (e.app) c += `<div class="cube">eigene kleine Web-App im iframe</div>`;
      return c + '</div>';
    }).join('');
    return `<div class="rolle"><div class="body" id="body-${lane}">${html}</div></div>`;
  }
  function renderKodex() {
    const v = kodexLane(step);
    const order = [...v.focus, ...K.ITEMS.map(i => i.id).filter(id => !v.focus.includes(id))];
    const items = order.map(id => {
      const cls = ['kx', v.focus[0] === id ? 'focus' : '', v.deps && v.focus.includes(id) && v.focus[0] !== id ? 'dep' : '', v.focus.length && !v.focus.includes(id) ? 'dim' : ''].join(' ');
      return `<div class="${cls}" style="view-transition-name:kx-${id}"><span>${esc(name(id))}</span><span class="v ${v.st[id]}">${esc(v.st[id])}</span></div>`;
    }).join('');
    const f = v.frame;
    return `<div class="kodex"><div class="page">
        <p class="rev">state.json, Revision ${v.rev}, zuletzt: ${esc(v.by)}</p>${items}
        ${v.proposal ? `<div class="proposal"><small>Vorschlag des Modells, keine Änderung</small>${esc(v.proposal)}</div>` : ''}
        ${v.rejected ? `<div class="rejected"><small>Compiler</small>${esc(v.rejected)}</div>` : ''}
        ${v.missing ? `<div class="rejected"><small>Compiler</small>${esc(v.missing)}</div>` : ''}
        ${v.paved ? `<div class="paved">${esc(v.paved)}</div>` : ''}
      </div><div class="margin">
        ${f ? `<span class="who ${f[1] === 'allographisch' ? 'allo' : 'auto'}">Rahmen: ${esc(f[0])}, ${esc(f[1])}</span>${esc(f[2])}` : ''}
        <div class="lg">${v.log.slice(0, 3).map(esc).join('<br><br>')}</div>
      </div></div>`;
  }

  function act1() {
    const rows = [
      ['Wer bestimmt die Form?', 'Das Modell, pro Antwort, aus rund 70 nativen Komponenten.', 'Das Modell, pro Antwort, aus deinem Katalog.', 'Das Modell schlägt einen Rahmen vor. Ein Compiler baut ihn aus einem festen Vokabular.'],
      ['Wo lebt der Zustand?', 'In der Antwort, in einem abgeschirmten Worker.', 'In deiner App, so wie du sie baust.', 'In Dateien, die dem Projekt gehören. Alle Module lesen und schreiben dort.'],
      ['Was weckt das Modell?', 'Eine neue Nachricht.', 'Ein neuer Turn deiner App.', 'Ein Signal, das ein kleiner Kontrolleur gewichtet: ignorieren, notieren, wecken.'],
      ['Was ist ein Knopf?', 'Eine neue Nachricht im Namen des Nutzers.', 'Eine Aktion an deinen Code.', 'Nur, was der Zustand erlaubt. Alles andere verwirft der Compiler.'],
      ['Stärke', 'Alles auf Zuruf, ohne Vorarbeit.', 'Offen, mit eigenem Katalog in der eigenen App.', 'Gedächtnis, Mitarbeit, nachvollziehbare Autorität.'],
      ['Belegt durch', 'OpenAI, Interna laut Thesys-Analyse', 'öffentliche Doku, Rest hängt vom Host ab', 'unser Entwurf, prototypisiert']
    ];
    const lanes = ['openai', 'openui', 'kodex'];
    return `<div class="two"><div class="prose">
        <p>Bis ins 4. Jahrhundert las man meist Rollen: Text in einer Richtung, ohne Seitenzahlen, ohne Register. Der Kodex, das gebundene Buch, erlaubte zu blättern, zu springen, zu verweisen. Auf ihm wuchs über Jahrhunderte der Apparat: Inhaltsverzeichnis, Register, Randglossen, Fussnoten. Werkzeuge, um mit Text zu arbeiten, statt ihn einmal zu lesen.</p>
        <p>Der Chat ist eine Rolle. Für Neugier reicht sie. Für Arbeit braucht es einen Kodex.</p>
      </div><div class="prose">
        <p>Gérard Genette nannte alles, was einen Text rahmt, Paratext: Titel, Vorwort, Anmerkungen. Er unterschied den autorischen Paratext, der vom Autor stammt, vom allographischen, der von anderen kommt: Verlag, Herausgeberin, Übersetzer.</p>
        <p>Ein Rahmen, den ein Modell vorschlägt, ist allographisch. Er darf helfen. Er sollte sich als fremd zu erkennen geben.</p>
      </div></div>
      <div class="arch" role="table" aria-label="Drei Architekturen">
        <div class="hdrow"></div>${lanes.map(l => `<div class="hd hdrow">${esc(K.LANES[l].name)}<small>${esc(K.LANES[l].line)}</small></div>`).join('')}
        ${rows.map(r => `<div class="rk">${esc(r[0])}</div>${r.slice(1).map((c, i) => `<div class="cell ${i === 2 ? 'ours' : ''} ${r[0] === 'Belegt durch' ? 'tag' : ''}" data-lane="${esc(K.LANES[lanes[i]].name)}">${esc(c)}</div>`).join('')}`).join('')}
      </div>
      <p class="split">Die ehrliche Teilung: Die Rolle gewinnt bei Neugier, der Kodex bei fortlaufender Arbeit. Projekte, Betrieb, Governance und Zusammenarbeit gehören zur zweiten Sorte.</p>
      <p><button type="button" class="btn primary" data-go="2">Zum Szenario</button></p>`;
  }

  function act2() {
    const s = K.STEPS[step];
    const lanes = ['openai', 'openui', 'kodex'].map(l => {
      const d = s[l];
      return `<section class="lane" aria-label="${esc(K.LANES[l].name)}"><h3>${esc(K.LANES[l].name)}</h3><p class="line">${esc(K.LANES[l].line)}</p>
        <div id="lane-${l}">${l === 'kodex' ? renderKodex() : renderChat(l)}</div>
        <p class="note ${d.win ? 'win' : ''}">${esc(d.note)}<br><span class="basis">${esc(d.basis)}</span></p></section>`;
    }).join('');
    const score = K.SCORE.map(r => {
      const later = r.step > step;
      const cell = l => { const [m, why] = r.v[l]; const c = m.startsWith('✓') ? 'y' : m.startsWith('✗') ? 'n' : 'p'; return `<td><span class="m ${c}">${esc(m)}</span><small>${esc(why)}</small></td>`; };
      return `<tr class="${later ? 'later' : ''}"><td>${esc(r.q)}</td>${cell('openai')}${cell('openui')}${cell('kodex')}</tr>`;
    }).join('');
    return `<div class="stepbar">
        <button type="button" class="btn" id="prev" ${step === 0 ? 'disabled' : ''}>Zurück</button>
        <button type="button" class="btn primary" id="next" ${step === K.STEPS.length - 1 ? 'disabled' : ''}>Weiter</button>
        <div class="dots" role="group" aria-label="Schritte">${K.STEPS.map((x, i) => `<button type="button" data-step="${i}" class="${i < step ? 'done' : ''}" ${i === step ? 'aria-current="step"' : ''} aria-label="Schritt ${i + 1}: ${esc(x.title)}">${i + 1}</button>`).join('')}</div>
      </div>
      <p class="event" aria-live="polite"><small>Schritt ${step + 1} von ${K.STEPS.length}: ${esc(s.title)}</small>${esc(s.event)}</p>
      <div class="lanes">${lanes}</div>
      <section class="score"><h2>Bilanz bis hierher</h2>
        <table><thead><tr><th></th><th>OpenAI</th><th>OpenUI</th><th>Kodex</th></tr></thead><tbody>${score}</tbody></table>
        <p class="muted" style="margin-top:10px">✓ kann es · ~ hängt davon ab · ✗ kann es nicht. Grau ausgeblendet: noch nicht gezeigt.</p>
        ${step === K.STEPS.length - 1 ? `<p class="split">Keine Architektur gewinnt alles. Aber nur eine davon bemerkt, erinnert und hält Autorität fest. Und sie kann übernehmen, was die anderen erkunden.</p><p><button type="button" class="btn primary" data-go="3">Zum Nordstern</button></p>` : ''}
      </section>`;
  }

  function act3() {
    return `<div class="star">
      <p class="claim">Eine Werkbank, die mitdenkt, ohne mitzuentscheiden.</p>
      <div class="two"><div class="prose">
        <p>Der Beweis ist kein weiterer Explainer, sondern zwei Wochen echte Arbeit. Ein reales Projekt, der Build-Plan, läuft auf einem Kodex statt im Chat. Die Teile gibt es schon, verteilt auf eigene Repositories. Neu ist nur, dass sie zusammen laufen.</p>
        <table class="map">
          <tr><td>Zustand in Dateien, Vorschlag und Bestätigung, Herkunft</td><td>br-ai-nstorm</td></tr>
          <tr><td>Beobachtung des Repositorys, Belege</td><td>Observstory</td></tr>
          <tr><td>Kleiner Kontrolleur: ignorieren, notieren, wecken</td><td>Morrow (Qwen, lokal)</td></tr>
          <tr><td>Rahmen vorschlagen</td><td>Frontier-Modell</td></tr>
          <tr><td>Commit, Regeln, menschliche Autorität</td><td>Weavr</td></tr>
          <tr><td>Rahmen kompilieren, morphen, Herkunft zeigen</td><td>Kodex-Renderer</td></tr>
        </table>
      </div><div class="prose">
        <h3>Abnahme nach zwei Wochen</h3>
        <p class="muted">Vorgeschlagene Schwellen, keine Messwerte.</p>
        <ul class="criteria">
          <li><b>Bemerkt</b>Mindestens fünf Hinweise, nach denen niemand gefragt hat. Mindestens die Hälfte davon nützlich, gemessen wie bei Observstory.</li>
          <li><b>Ruhig</b>Der lokale Kontrolleur weckt das grosse Modell höchstens bei jedem fünften Signal. Der Rest wird notiert oder ignoriert.</li>
          <li><b>Treu</b>Keine einzige Zustandsänderung ohne deinen Commit. Jeder Rahmen trägt seine Herkunft.</li>
          <li><b>Kontinuität</b>Du musst den Projektstand in keinem Chat mehr erklären.</li>
        </ul>
        <div class="kill"><b>Abbruchkriterium.</b> Wenn du nach zwei Wochen für Statusfragen wieder zum Chat greifst, hat der Kodex verloren. Dann ist die Rolle für diese Arbeit gut genug, und auch das ist ein Ergebnis.</div>
      </div></div>
      <p class="tease">Offen bleibt, was sich nicht simulieren lässt: wie sich ein Rahmen anfühlt, der dir nicht gehört, aber dir hilft. Das muss man benutzen.</p>
    </div>`;
  }

  function render(morph) {
    const draw = () => {
      $('main').innerHTML = act === 1 ? act1() : act === 2 ? act2() : act3();
      if (act === 2) ['openai', 'openui'].forEach(l => { const b = $('body-' + l); if (b) b.scrollTop = b.scrollHeight; });
    };
    if (morph && document.startViewTransition && !reduced.matches) document.startViewTransition(draw); else draw();
  }
  function setAct(n) {
    act = n; if (n === 2) step = 0;
    document.querySelectorAll('.acts button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.act === n)));
    render(false);
    window.scrollTo({ top: document.querySelector('.acts').offsetTop - 10, behavior: reduced.matches ? 'auto' : 'smooth' });
  }

  document.querySelector('.acts').onclick = e => { const b = e.target.closest('button'); if (b) setAct(+b.dataset.act); };
  $('main').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) return setAct(+b.dataset.go);
    if (b.id === 'next' && step < K.STEPS.length - 1) { step++; render(true); }
    if (b.id === 'prev' && step > 0) { step--; render(true); }
    if (b.dataset.step) { step = +b.dataset.step; render(true); }
    const f = document.getElementById(b.id || ''); if (f) f.focus();
  });
  document.addEventListener('keydown', e => {
    if (act !== 2 || e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowRight' && step < K.STEPS.length - 1) { step++; render(true); }
    if (e.key === 'ArrowLeft' && step > 0) { step--; render(true); }
  });
  render(false);
})();
