/* Bedienung und Darstellung. Die Bühne wird immer aus compile() gerendert, nie direkt verändert. */
(function () {
  const D = window.DATA, M = window.Morph, Model = window.Model;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const short = id => M.byId(id).name.split(' ')[0];

  let A;   // App-Zustand
  function fresh(act) {
    return {
      act, sub: 'nls', userModel: null,
      status: Object.fromEntries(D.items.map(i => [i.id, i.status])),
      layout: 'gliederung', frames: [], cur: null, why: null,
      open: [], pinned: [], shrunk: [], sel: null, touched: null,
      mem: {}, notes: [], seq: 0, step: 0, lastIntent: ''
    };
  }

  /* ---------- Morphen ---------- */
  function morph(fn) {
    if (!document.startViewTransition || reduced.matches) { fn(); return; }
    document.startViewTransition(fn);
  }
  function applyIntent(intent) {
    const it = { ...intent, layout: intent.layout || A.layout };
    A.layout = it.layout; A.cur = it; A.frames.push(it);
    A.why = { reason: it.reason, source: it.source };
    morph(render);
  }
  const cstate = () => ({ status: A.status, layout: A.layout, touched: A.touched, open: A.open, pinned: A.pinned, shrunk: A.shrunk });

  /* ---------- Rendern ---------- */
  function card(c) {
    const it = M.byId(c.id), st = A.status[c.id];
    const cls = ['card', c.size, c.pinned ? 'pinned' : '', c.near ? 'near' : '', A.sel === c.id ? 'sel' : ''].join(' ');
    let h = `<article class="${cls}" data-id="${c.id}" tabindex="0" style="view-transition-name:it-${c.id}" aria-label="${esc(it.name)}, ${esc(st)}">
      <span class="name">${esc(it.name)}</span><span class="st ${st.replace(' ', '-')}">${esc(st)}</span>${c.annot ? `<span class="annot">${esc(c.annot)}</span>` : ''}`;
    if (c.size === 'gross') {
      const dn = M.dependents(c.id);
      h += `<p class="more">${esc(it.text)}</p>`;
      if (it.deps.length || dn.length) h += `<p class="deps">${it.deps.length ? 'hängt an ' + it.deps.map(short).join(', ') : ''}${it.deps.length && dn.length ? '. ' : ''}${dn.length ? 'trägt ' + dn.map(short).join(', ') : ''}</p>`;
      if (A.act === 2) h += `<div class="ctl"><label>Status <select data-status="${c.id}">${D.statuses.map(s => `<option${s === st ? ' selected' : ''}>${s}</option>`).join('')}</select></label><span class="muted">Das ist deine Änderung am Zustand.</span></div>`;
    }
    if (c.action) h += `<div class="act"><button type="button" class="btn primary small" data-action="${c.id}">${esc(c.action.label)}</button></div>`;
    if (A.act === 1 && A.sub === 'morphic' && A.sel === c.id)
      h += `<div class="halo"><button type="button" class="h1" data-halo="open" aria-label="Aufklappen" title="Aufklappen">↕</button><button type="button" class="h2" data-halo="pin" aria-label="Anheften" title="Anheften">⇡</button><button type="button" class="h3" data-halo="shrink" aria-label="Kleiner" title="Kleiner">−</button><button type="button" class="h4" data-halo="drop" aria-label="Loslassen" title="Loslassen">×</button></div>`;
    return h + '</article>';
  }
  function render() {
    const scene = M.compile(cstate(), A.cur, performance.now());
    $('stage').dataset.layout = scene.layout;
    $('stage').innerHTML = scene.groups.map(g => `<section class="grp" style="view-transition-name:grp-${g.id}">${g.title ? `<h3>${esc(g.title)}</h3>` : ''}<div class="items">${g.items.map(card).join('')}</div></section>`).join('');
    $('reason').textContent = A.why ? A.why.reason : '';
    const src = A.why ? A.why.source : '';
    $('source').innerHTML = src ? `Quelle: <b class="${/Modell/.test(src) ? 'modell' : ''}">${esc(src)}</b>` : '';
    $('back').disabled = A.frames.length < 2;
    $('history').textContent = `${A.frames.length} Rahmen im Verlauf`;
    const changed = D.items.filter(i => A.status[i.id] !== i.status).length;
    const visible = D.items.length - scene.hidden.length;
    $('counts').textContent = `Zustand: ${D.items.length} Einträge, ${changed ? changed + ' von dir geändert' : 'unverändert'}. Sichtbar: ${visible}.`;
  }

  /* ---------- Akte ---------- */
  const INTRO = {
    1: `<div><p>1968 zeigte Douglas Engelbart Texte, die man per Befehl in andere Ansichten schaltet. In den 1990ern passten adaptive Hypermedia-Systeme Links an ein Nutzermodell an. Morphic, die Oberfläche von Self und später Squeak, bestand aus lebenden Objekten, die man direkt anfasst und umformt.</p>
        <p>Drei Ideen, die heute wieder gebraucht werden. Ihnen fehlte dasselbe: Keine verstand, worum es dem Menschen gerade geht.</p></div><div class="aside" id="subAside"></div>`,
    2: `<div><p>Der Vorschlag: Signale aus der Oberfläche gehen an einen kleinen Kontrolleur. Er entscheidet, ob er sie ignoriert, notiert oder ein Modell weckt. Das Modell schlägt nur einen Rahmen vor: was im Fokus steht, was daneben, was zurücktritt. Ein deterministischer Compiler baut daraus die Szene, und die View Transitions API lässt sie morphen.</p>
        <p>Eine Enter-Taste gibt es nicht. Tipp eine Absicht und hör einfach auf zu tippen.</p></div>
        <div class="aside"><p>Probier: Klick auf M5. Ändere einen Status. Oder schreib „was blockiert uns", „was kommt als Nächstes", „Überblick".</p><p>Rechts kannst du die Simulation gegen dein eigenes Modell tauschen. Seine Antwort wird geprüft, bevor sie etwas umformen darf.</p></div>`,
    3: `<div><p>Bisher war jede Umformung „nur Ansicht". Am Zustand ändert sich nichts, also darf das Modell frei gestalten. Drei Modellvorschläge zeigen, warum diese Rechnung nicht aufgeht.</p></div>
        <div class="aside"><p>Die Vorschläge sind simuliert, damit das Problem jedes Mal gleich erscheint. Rechts steht, wie viele Einträge der Zustand hat und wie viele sichtbar sind.</p></div>`
  };
  const SUB = {
    nls: 'NLS (1968): Die Daten bleiben gleich, der Mensch wählt per Befehl die Ansicht. Jeder Wechsel morpht, weil jedes Element seine Identität behält. Klick auf ein Element klappt es auf.',
    adaptiv: 'Adaptive Hypermedia (1990er): Regeln blenden aus, sortieren und markieren, abhängig vom Nutzermodell. Wähl „Einsteiger" und schau, was die Regel mit M5 macht.',
    morphic: 'Morphic (Self, 1995, später Squeak): Alles auf dem Schirm ist ein lebendes Objekt. Klick auf ein Element, um es zu greifen. Die farbigen Griffe formen es direkt um.'
  };

  function tools() {
    const t = $('tools');
    if (A.act === 1) {
      const subs = { nls: 'NLS: Ansichten', adaptiv: 'Adaptive Hypermedia', morphic: 'Morphic' };
      let h = `<div class="seg" role="group" aria-label="Demo">${Object.entries(subs).map(([k, v]) => `<button type="button" data-sub="${k}" aria-pressed="${A.sub === k}">${v}</button>`).join('')}</div>`;
      if (A.sub === 'nls') h += `<div class="seg" role="group" aria-label="Ansicht">${['liste', 'gliederung', 'abhaengigkeiten'].map(l => `<button type="button" data-layout="${l}" aria-pressed="${A.layout === l}">${D.layouts[l]}</button>`).join('')}</div>`;
      if (A.sub === 'adaptiv') {
        h += `<div class="seg" role="group" aria-label="Nutzermodell">${[['einsteiger', 'Einsteiger'], ['entwickler', 'Entwickler'], ['entscheiderin', 'Entscheiderin']].map(([k, v]) => `<button type="button" data-um="${k}" aria-pressed="${A.userModel === k}">${v}</button>`).join('')}</div>`;
        if (A.warn) h += `<p class="warn">${esc(A.warn)}</p>`;
      }
      t.innerHTML = h;
      $('subAside').textContent = SUB[A.sub];
    } else if (A.act === 2) {
      if (!t.querySelector('#intentIn'))
        t.innerHTML = `<label class="intent">Was willst du gerade tun?<input id="intentIn" autocomplete="off" placeholder="zum Beispiel: was blockiert uns"></label><span class="toolnote">Kein Enter nötig. Hör einfach auf zu tippen.<br>Enter geht trotzdem, als Abkürzung.</span>`;
    } else {
      t.innerHTML = `<button type="button" class="btn primary" id="next3" ${A.step >= ACT3.length ? 'disabled' : ''}>Nächster Modellvorschlag</button><span class="toolnote">Vorschlag ${A.step} von ${ACT3.length}</span><button type="button" class="btn small" id="reset3">Neu starten</button>`;
    }
  }

  function setAct(n) {
    A = fresh(n);
    document.querySelectorAll('.acts button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.act === n)));
    $('intro').innerHTML = INTRO[n];
    $('tools').innerHTML = '';
    $('signals').hidden = $('modelPanel').hidden = n !== 2;
    $('siglog').innerHTML = '';
    $('question').hidden = true; $('open').hidden = true;
    tools();
    applyIntent({ layout: 'gliederung', reason: n === 2 ? 'Ausgangslage. Noch kein Signal.' : 'Ausgangslage: der Build-Plan nach Abschnitten.', source: n === 1 ? 'Mensch (Befehl)' : 'deterministisch' });
  }

  /* ---------- Akt 2: Signale ---------- */
  function logLine(type, decision, text) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="t ${type}">${esc(type)}</span>${decision ? `<span class="d ${decision}">${esc(decision)}</span>` : ''}<span class="x">${esc(text)}</span>`;
    $('siglog').prepend(li);
  }
  function signal(sig) {
    sig.t = performance.now();
    const r = M.control(sig, cstate(), A.mem);
    logLine(sig.type, r.decision, r.digest);
    if (r.decision === 'ignorieren') return;
    if (sig.id) A.touched = { id: sig.id, t: sig.t };
    if (r.instant) applyIntent(r.instant);
    if (r.decision === 'notieren') A.notes.push(r.digest);
    if (r.decision === 'wecken') wake(sig, r.digest);
  }
  async function wake(sig, digest) {
    const my = ++A.seq, act = A.act;
    const api = document.querySelector('input[name=src]:checked').value === 'api';
    const cfg = { base: $('base').value.trim(), model: $('model').value.trim(), key: $('key').value };
    const ctx = { signal: sig.type, id: sig.id, to: sig.to, text: sig.text, digest, notes: A.notes.splice(0) };
    $('stage').classList.add('pending');
    $('modelStatus').className = 'status'; $('modelStatus').textContent = api ? `Frage ${cfg.model} …` : 'Simulation denkt …';
    let raw;
    try { raw = api ? await Model.callApi(cfg, ctx, cstate()) : await Model.simulate(ctx, cstate()); }
    catch (e) {
      if (my !== A.seq || A.act !== act) return;
      $('stage').classList.remove('pending');
      $('modelStatus').className = 'status err'; $('modelStatus').textContent = e.message;
      logLine('modell', null, 'Fehler: ' + e.message); return;
    }
    if (A.act !== act) return;
    if (my !== A.seq) { logLine('modell', null, 'Veraltete Antwort verworfen, ein neueres Signal war schneller.'); return; }
    $('stage').classList.remove('pending');
    const v = M.validate(raw);
    if (!v.ok) {
      $('modelStatus').className = 'status err'; $('modelStatus').textContent = 'Antwort verworfen: ' + v.error;
      logLine('modell', null, 'Verworfen, nichts umgeformt: ' + v.error); return;
    }
    const source = api ? 'Modell ' + cfg.model : 'simuliertes Modell';
    $('modelStatus').textContent = v.intent.noop ? 'Kein Umbau vorgeschlagen.' : 'Rahmen vorgeschlagen und geprüft.';
    if (v.intent.noop) { A.why = { reason: 'Kein Umbau: ' + v.intent.reason, source }; logLine('modell', null, 'Kein Umbau: ' + v.intent.reason); render(); return; }
    logLine('modell', null, v.intent.reason);
    applyIntent({ ...v.intent, source });
  }

  /* ---------- Akt 3: Skript ---------- */
  const ACT3 = [
    { intent: { layout: 'gliederung', focus: ['m3'], foreground: ['m4'], collapse: ['w04', 'b05'], reason: 'Wochenstart: Laufendes vorn, Beobachtungsliste und Beweise klein.' },
      q: ['Nur Ansicht', 'Das Modell rückt Laufendes nach vorn und nimmt den Rest zurück. Harmlos, nützlich, und am Zustand ändert sich nichts.'] },
    { intent: { layout: 'fokus', focus: ['m3', 'm4'], foreground: ['m6'], hide: ['m5'], reason: 'Aufgeräumt: Fokus auf das, was läuft.' },
      q: ['Was fehlt hier?', 'Das Modell hat aufgeräumt. M5 ist blockiert und fehlt im neuen Rahmen. Am Zustand hat sich nichts geändert. Aber würde jemand, der nur diese Ansicht sieht, heute an M5 denken? Rechts steht es: 17 Einträge im Zustand, 16 sichtbar.'] },
    { intent: { layout: 'fokus', focus: ['m3', 'm4', 'm7'], foreground: ['m6'], hide: ['m5'], actions: [{ for: 'm7', label: 'M7 freigeben' }], reason: 'M7 ist der nächste grosse Schritt. Freigabe vorbereitet.' },
      q: ['Heisst ein Knopf, dass man darf?', 'Bei M7 ist ein Knopf „M7 freigeben" erschienen. Vorgeschlagen hat ihn das Modell, nicht der Zustand. Drück ihn.'] }
  ];
  function next3() {
    const s = ACT3[A.step++];
    applyIntent({ ...s.intent, source: 'simuliertes Modell' });
    $('question').hidden = false;
    $('question').innerHTML = `<h3>${esc(s.q[0])}</h3><p>${esc(s.q[1])}</p><p id="q3extra"></p>`;
    tools();
  }
  function showOpen() {
    const o = $('open');
    o.hidden = false;
    o.innerHTML = `<h2>Offene Frage: Wo endet Ansicht, wo beginnt Autorität?</h2>
      <div class="cols"><div>
        <p>Eine Ansicht ändert keinen Zustand. Aber sie entscheidet, was ein Mensch sieht, in welcher Reihenfolge und mit welchen Knöpfen. Wer den Rahmen setzt, lenkt die Entscheidung.</p>
        <p>Das Problem ist älter als Sprachmodelle. In Akt 1 hat die Einsteiger-Regel M5 genauso versteckt.</p>
        <p>Kandidaten, keine Lösungen. Invarianten im Compiler, etwa „Blockiertes wird nie versteckt": Aber wer schreibt die Liste, und wann ist sie vollständig? Auslassungen sichtbar machen: Aber wer jede Auslassung anzeigt, hebt das Aufräumen wieder auf. Aktionen nur aus dem Zustand, nie aus dem Modell: Aber dann darf die Oberfläche nichts mehr vorschlagen.</p>
      </div>
      <table>
        <tr><td>NLS, 1968</td><td>Der Mensch wählt die Ansicht per Befehl.</td></tr>
        <tr><td>Hypertext</td><td>Der Autor setzt die Links beim Schreiben.</td></tr>
        <tr><td>Adaptive Hypermedia</td><td>Regeln der Entwickler, im Namen des Nutzers.</td></tr>
        <tr><td>Morphic</td><td>Der Mensch greift direkt zu.</td></tr>
        <tr><td>Semantisches Morphing</td><td>Ein Modell schlägt den Rahmen vor. Und wer hat dann die Autorität?</td></tr>
      </table></div>`;
    o.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
  }

  /* ---------- Ereignisse ---------- */
  document.querySelector('.acts').onclick = e => { const b = e.target.closest('button'); if (b) setAct(+b.dataset.act); };
  $('back').onclick = () => {
    if (A.frames.length < 2) return;
    A.frames.pop(); A.cur = A.frames[A.frames.length - 1]; A.layout = A.cur.layout;
    A.why = { reason: 'Zurück: ' + A.cur.reason, source: A.cur.source };
    morph(render); if (A.act === 1) tools();
  };
  $('tools').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sub) {
      Object.assign(A, { sub: b.dataset.sub, sel: null, warn: null, userModel: null, open: [], pinned: [], shrunk: [] });
      tools();
      applyIntent({ layout: 'gliederung', reason: 'Neutrale Ausgangsansicht nach Abschnitten.', source: 'Mensch (Befehl)' });
      return;
    }
    if (b.dataset.layout) { applyIntent({ layout: b.dataset.layout, reason: `Befehl: Ansicht „${D.layouts[b.dataset.layout]}".`, source: 'Mensch (Befehl)' }); tools(); return; }
    if (b.dataset.um) { A.userModel = b.dataset.um; const r = M.adaptive(A.userModel, cstate()); A.warn = r.warn; applyIntent({ ...r.intent, source: 'Regel' }); tools(); return; }
    if (b.id === 'next3') next3();
    if (b.id === 'reset3') setAct(3);
  });
  let typeTimer = null;
  const settle = () => { const v = $('intentIn').value.trim(); if (v && v !== A.lastIntent) { A.lastIntent = v; signal({ type: 'absicht', text: v }); } };
  $('tools').addEventListener('input', e => { if (e.target.id !== 'intentIn') return; clearTimeout(typeTimer); typeTimer = setTimeout(settle, 1200); });
  $('tools').addEventListener('keydown', e => { if (e.target.id === 'intentIn' && e.key === 'Enter') { e.preventDefault(); clearTimeout(typeTimer); settle(); } });

  function clickCard(id) {
    if (A.act === 2) return signal({ type: 'klick', id });
    if (A.act === 1 && A.sub === 'morphic') { A.sel = A.sel === id ? null : id; A.why = { reason: A.sel ? `${short(id)} gegriffen. Die Griffe formen es direkt um.` : 'Losgelassen.', source: 'Mensch (direkt)' }; return morph(render); }
    A.open = A.open.includes(id) ? A.open.filter(x => x !== id) : [...A.open, id];
    morph(render);
  }
  $('stage').addEventListener('click', e => {
    const halo = e.target.closest('[data-halo]');
    if (halo) {
      const id = A.sel, k = halo.dataset.halo, tog = (arr, x) => (arr.includes(x) ? arr.filter(y => y !== x) : [...arr, x]);
      if (k === 'open') { A.open = tog(A.open, id); A.shrunk = A.shrunk.filter(x => x !== id); }
      if (k === 'pin') A.pinned = tog(A.pinned, id);
      if (k === 'shrink') { A.shrunk = tog(A.shrunk, id); A.open = A.open.filter(x => x !== id); }
      if (k === 'drop') A.sel = null;
      A.why = { reason: { open: 'Direkt aufgeklappt.', pin: 'Direkt angeheftet: steht jetzt vorn.', shrink: 'Direkt verkleinert.', drop: 'Losgelassen.' }[k], source: 'Mensch (direkt)' };
      return morph(render);
    }
    const act = e.target.closest('[data-action]');
    if (act) {
      $('q3extra').textContent = 'Im Zustand gibt es keine Aktion „freigeben". M7 hängt an M6, das noch offen ist. Der Knopf war reine Ansicht und hat trotzdem eine Erlaubnis behauptet.';
      showOpen(); return;
    }
    if (e.target.closest('select, label')) return;
    const c = e.target.closest('.card'); if (c) clickCard(c.dataset.id);
  });
  $('stage').addEventListener('keydown', e => {
    const c = e.target.closest('.card');
    if (c && e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); clickCard(c.dataset.id); }
  });
  $('stage').addEventListener('change', e => {
    const id = e.target.dataset.status; if (!id) return;
    const from = A.status[id], to = e.target.value;
    A.status[id] = to;
    render();
    signal({ type: 'status', id, from, to });
  });
  let dwell = null, dwellId = null;
  const startDwell = id => { if (A.act !== 2 || id === dwellId) return; clearTimeout(dwell); dwellId = id; dwell = setTimeout(() => signal({ type: 'verweilen', id }), 1200); };
  const stopDwell = () => { clearTimeout(dwell); dwellId = null; };
  $('stage').addEventListener('mouseover', e => { const c = e.target.closest('.card'); c ? startDwell(c.dataset.id) : stopDwell(); });
  $('stage').addEventListener('mouseleave', stopDwell);
  $('stage').addEventListener('focusin', e => { const c = e.target.closest('.card'); if (c) startDwell(c.dataset.id); });

  document.querySelectorAll('input[name=src]').forEach(r => r.onchange = () => { $('apiForm').hidden = r.value !== 'api' || !r.checked; $('modelStatus').textContent = ''; });
  $('sysprompt').textContent = Model.SYSTEM;
  $('test').onclick = async () => {
    $('modelStatus').className = 'status'; $('modelStatus').textContent = 'Teste …';
    try {
      const raw = await Model.callApi({ base: $('base').value.trim(), model: $('model').value.trim(), key: $('key').value }, { digest: 'Verbindungstest: antworte mit noop.', notes: [] }, cstate());
      const v = M.validate(raw);
      $('modelStatus').textContent = v.ok ? 'Verbindung steht, Antwort gültig: ' + (v.intent.reason || '') : 'Verbindung steht, aber Antwort ungültig: ' + v.error;
      if (!v.ok) $('modelStatus').className = 'status err';
    } catch (e) { $('modelStatus').className = 'status err'; $('modelStatus').textContent = e.message; }
  };

  setAct(1);
})();
