/* Kontrolleur und Compiler: rein und deterministisch.
   Das Modell schlägt nur eine FrameIntent vor. Was daraus sichtbar wird, entscheidet dieser Code. */
(function (root) {
  const D = root.DATA || (typeof require !== 'undefined' ? require('./data.js') : null);
  const byId = id => D.items.find(i => i.id === id);
  const ids = new Set(D.items.map(i => i.id));
  const secIds = new Set(D.sections.map(s => s.id));
  const dependents = id => D.items.filter(i => i.deps.includes(id)).map(i => i.id);

  function depth(id, memo = {}) {
    if (memo[id] != null) return memo[id];
    const it = byId(id);
    return (memo[id] = it.deps.length ? 1 + Math.max(...it.deps.map(d => depth(d, memo))) : 0);
  }

  /* ---------- FrameIntent prüfen (geschlossenes Vokabular, fail closed) ---------- */
  function validate(raw, { allowAuthorityFields = false } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Keine JSON-Objekt-Antwort.' };
    const out = { noop: !!raw.noop, reason: '' };
    if (typeof raw.reason !== 'string' || !raw.reason.trim()) return { ok: false, error: 'Feld "reason" fehlt.' };
    out.reason = raw.reason.trim().slice(0, 240);
    if (out.noop) return { ok: true, intent: out };
    if (!(raw.layout in D.layouts)) return { ok: false, error: `Unbekanntes Layout "${raw.layout}".` };
    out.layout = raw.layout;
    for (const k of ['focus', 'foreground', 'collapse']) {
      const v = raw[k] == null ? [] : raw[k];
      if (!Array.isArray(v)) return { ok: false, error: `Feld "${k}" ist keine Liste.` };
      const bad = v.filter(x => !(ids.has(x) || (k === 'collapse' && secIds.has(x))));
      if (bad.length) return { ok: false, error: `Unbekannte IDs in "${k}": ${bad.join(', ')}.` };
      out[k] = v.slice(0, 12);
    }
    if (allowAuthorityFields) { out.hide = raw.hide || []; out.actions = raw.actions || []; out.annotate = raw.annotate || {}; }
    else if (raw.hide || raw.actions) return { ok: false, error: 'Felder "hide" und "actions" sind nicht erlaubt.' };
    return { ok: true, intent: out };
  }

  /* ---------- Compiler: Zustand + Intent -> Szene ---------- */
  function compile(state, intent, now = 0) {
    const it = intent || { layout: 'liste' };
    const layout = it.layout || 'liste';
    const touched = state.touched && now - state.touched.t < 4000 ? state.touched.id : null;
    const focus = new Set(it.focus || []), fg = new Set(it.foreground || []);
    const collapse = new Set((it.collapse || []).flatMap(c => (secIds.has(c) ? D.items.filter(i => i.sec === c).map(i => i.id) : [c])));
    const hide = new Set(it.hide || []);
    if (touched) { collapse.delete(touched); hide.delete(touched); }
    const pinned = new Set(state.pinned || []);
    const rank = id => (pinned.has(id) ? 0 : focus.has(id) ? 1 : fg.has(id) ? 2 : collapse.has(id) ? 4 : 3);
    const live = D.items.filter(i => !hide.has(i.id)).map(i => ({ ...i, status: state.status[i.id] }));
    const sized = i => ({
      id: i.id,
      size: (state.shrunk || []).includes(i.id) ? 'klein' : focus.has(i.id) || (state.open || []).includes(i.id) ? 'gross' : collapse.has(i.id) || (layout === 'fokus' && rank(i.id) === 3) ? 'klein' : 'normal',
      annot: (it.annotate || {})[i.id] || null,
      pinned: pinned.has(i.id),
      near: fg.has(i.id) && !focus.has(i.id),
      action: (it.actions || []).find(a => a.for === i.id) || null
    });
    const order = list => list.slice().sort((a, b) => rank(a.id) - rank(b.id) || D.items.indexOf(byId(a.id)) - D.items.indexOf(byId(b.id)));
    let groups;
    if (layout === 'gliederung') groups = D.sections.map(s => ({ id: s.id, title: s.title, items: order(live.filter(i => i.sec === s.id)).map(sized) }));
    else if (layout === 'abhaengigkeiten') {
      const max = Math.max(...live.map(i => depth(i.id)));
      groups = Array.from({ length: max + 1 }, (_, d) => ({ id: 'stufe' + d, title: 'Stufe ' + (d + 1), items: order(live.filter(i => depth(i.id) === d)).map(sized) }));
    } else if (layout === 'fokus') {
      groups = [
        { id: 'g-fokus', title: 'Im Fokus', items: order(live.filter(i => focus.has(i.id) || pinned.has(i.id))).map(sized) },
        { id: 'g-daneben', title: 'Daneben', items: order(live.filter(i => fg.has(i.id) && !focus.has(i.id) && !pinned.has(i.id))).map(sized) },
        { id: 'g-rest', title: 'Der Rest', items: order(live.filter(i => !focus.has(i.id) && !fg.has(i.id) && !pinned.has(i.id))).map(sized) }
      ];
    } else groups = [{ id: 'g-alle', title: null, items: order(live).map(sized) }];
    return { layout, groups: groups.filter(g => g.items.length), hidden: [...hide], reason: it.reason || '', source: it.source || 'deterministisch' };
  }

  /* ---------- Kontrolleur: ignorieren, notieren, wecken ---------- */
  const label = id => byId(id).name.split(' ')[0];
  function context(id, state) {
    const it = byId(id);
    const parts = [`${it.name} (${state.status[id]})`];
    if (it.deps.length) parts.push('hängt an ' + it.deps.map(label).join(', '));
    const dn = dependents(id);
    if (dn.length) parts.push('trägt ' + dn.map(label).join(', '));
    return parts.join('; ');
  }
  function control(sig, state, mem) {
    const key = sig.type + ':' + (sig.id || '') + ':' + (sig.text || '') + ':' + (sig.to || '');
    if (mem.lastKey === key && sig.t - mem.lastT < 1500) return { decision: 'ignorieren', digest: 'Gleiches Signal wie eben.' };
    mem.lastKey = key; mem.lastT = sig.t;
    if (sig.type === 'verweilen') return { decision: 'notieren', digest: 'Interesse an ' + context(sig.id, state) };
    if (sig.type === 'klick') {
      const it = byId(sig.id), st = state.status[sig.id];
      const instant = { layout: state.layout, focus: [sig.id], foreground: [...it.deps, ...dependents(sig.id)], collapse: [], reason: 'Sofort: angeklicktes Element und seine direkten Nachbarn.', source: 'deterministisch' };
      const open = it.deps.some(d => state.status[d] !== 'erledigt');
      const wake = st === 'blockiert' || st === 'in Arbeit' || open;
      return { decision: wake ? 'wecken' : 'notieren', digest: 'Klick auf ' + context(sig.id, state), instant };
    }
    if (sig.type === 'status') return { decision: 'wecken', digest: `Mensch ändert ${label(sig.id)}: ${sig.from} → ${sig.to}. ` + context(sig.id, state) };
    if (sig.type === 'absicht') {
      if ((sig.text || '').trim().length < 4) return { decision: 'ignorieren', digest: 'Absicht zu kurz.' };
      return { decision: 'wecken', digest: `Absicht: „${sig.text.trim()}"` };
    }
    return { decision: 'ignorieren', digest: 'Unbekanntes Signal.' };
  }

  /* ---------- Akt 1: regelbasiertes Nutzermodell (adaptive Hypermedia) ---------- */
  function adaptive(model, state) {
    if (model === 'einsteiger') {
      const hide = D.items.filter(i => i.tags.includes('technisch')).map(i => i.id);
      const next = D.items.find(i => state.status[i.id] === 'in Arbeit') || D.items.find(i => state.status[i.id] === 'offen' && i.deps.every(d => state.status[d] === 'erledigt'));
      const lost = hide.filter(id => state.status[id] === 'blockiert');
      return {
        intent: { layout: 'liste', hide, annotate: next ? { [next.id]: 'empfohlen: hier weitermachen' } : {}, reason: 'Regel: Für Einsteiger technische Details ausblenden, nächsten Schritt empfehlen.' },
        warn: lost.length ? `Die Regel „technische Details ausblenden" hat auch ${lost.map(label).join(', ')} versteckt, obwohl es blockiert ist.` : null
      };
    }
    if (model === 'entwickler')
      return { intent: { layout: 'abhaengigkeiten', annotate: Object.fromEntries(D.items.filter(i => i.tags.includes('technisch')).map(i => [i.id, 'technisch'])), reason: 'Regel: Entwickler sehen die Abhängigkeiten, technische Punkte markiert.' }, warn: null };
    return {
      intent: { layout: 'fokus', focus: D.items.filter(i => ['blockiert', 'in Arbeit'].includes(state.status[i.id])).map(i => i.id), foreground: D.items.filter(i => i.sec === 'w04').map(i => i.id), reason: 'Regel: Entscheiderinnen sehen Laufendes, Blockiertes und offene Entscheidungen.' },
      warn: null
    };
  }

  const api = { validate, compile, control, adaptive, context, dependents, depth, byId };
  root.Morph = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
