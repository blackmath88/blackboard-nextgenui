/* Blackboard-Engine: rein und deterministisch. Gleicher Start + gleiche Strategie = gleicher Verlauf. */
(function (root) {
  const S = root.SCENARIO || (typeof require !== 'undefined' ? require('./scenario.js') : null);
  const PRIO = { POM: 6, MOW: 5, SEQ: 4, PREDICT: 3, VERIFY: 2, PARSE: 1 };
  const f2 = n => n.toFixed(2).replace(/^0/, '');

  const cat = w => (S.names.includes(w) ? '@NAME' : w);
  const allowed = (a, b) => (S.next[cat(a)] || []).includes(cat(b));
  const isSilence = (a, b) => S.silences.some(([x, y]) => x === a && y === b);
  const touches = (endA, startB) => endA === startB || isSilence(endA, startB);
  const after = t => { const s = S.silences.find(([x]) => x === t); return s ? s[1] : t; };
  const before = t => { const s = S.silences.find(([, y]) => y === t); return s ? s[0] : t; };
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

  function create({ strategy = 'opportunistisch', streaming = false } = {}) {
    return {
      strategy, streaming,
      available: streaming ? 1 : S.end,
      hyps: [], done: new Set(), cycle: 0, nextId: 1,
      log: [], fired: {}, last: null,
      halted: null, asked: false
    };
  }

  const words = st => st.hyps.filter(h => h.level === 'word');
  const usable = h => h.status === 'erkannt' || h.status === 'bestätigt';
  const sylAvail = (st, s) => s.end <= st.available;

  function agenda(st) {
    const out = [];
    const add = (ks, key, rating, why, payload) => {
      if (st.done.has(key)) return;
      const eff = st.strategy === 'schichtweise' ? PRIO[ks] * 10 + rating : rating;
      out.push({ ks, key, rating, eff, why, payload });
    };

    // Silbenfinder
    for (const s of S.syllables) if (sylAvail(st, s))
      add('POM', 'POM:' + s.id, s.score, `Signal zeigt „${s.label}" (Güte ${f2(s.score)})`, { s });

    // Worterkenner
    const syls = st.hyps.filter(h => h.level === 'syl' && h.score >= S.threshold);
    for (const [w, labels] of Object.entries(S.lexicon)) {
      const chains = [[]];
      let found = [];
      const extend = (chain, i) => {
        if (i === labels.length) { found.push(chain); return; }
        for (const h of syls) if (h.label === labels[i] && (i === 0 || chain[i - 1].end === h.start)) extend([...chain, h], i + 1);
      };
      extend([], 0);
      for (const c of found) {
        const sc = mean(c.map(h => h.score));
        add('MOW', 'MOW:' + w + ':' + c.map(h => h.id).join(','), sc, `Silben ${c.map(h => h.label).join('·')} ergeben „${w}"`, { w, chain: c, score: sc });
      }
    }

    // Wortfolgen: Paare und Erweiterungen
    const ws = words(st).filter(usable);
    const seqs = st.hyps.filter(h => h.level === 'seq');
    const seqKeys = new Set(seqs.map(q => q.words.join(',')));
    const pushSeq = (list, why) => {
      const key = list.map(h => h.id).join(',');
      if (seqKeys.has(key)) return;
      const sc = mean(list.map(h => h.score));
      add('SEQ', 'SEQ:' + key, sc, why, { list, score: sc });
    };
    for (const a of ws) for (const b of ws)
      if (a !== b && touches(a.end, b.start) && allowed(a.label, b.label)) pushSeq([a, b], `„${a.label}" gefolgt von „${b.label}" ist grammatisch`);
    for (const q of seqs) {
      const list = q.words.map(id => st.hyps.find(h => h.id === id));
      const first = list[0], last = list[list.length - 1];
      for (const b of ws) {
        if (touches(last.end, b.start) && allowed(last.label, b.label)) pushSeq([...list, b], `Insel „${q.label}" wächst nach rechts um „${b.label}"`);
        if (touches(b.end, first.start) && allowed(b.label, first.label)) pushSeq([b, ...list], `Insel „${q.label}" wächst nach links um „${b.label}"`);
      }
    }

    // Vorhersage (top-down) an den Rändern jeder Insel
    const expand = c => (c === '@NAME' ? S.names : [c]);
    const hasWordAt = (w, start) => words(st).some(h => h.label === w && h.start === start);
    for (const q of seqs) {
      const list = q.words.map(id => st.hyps.find(h => h.id === id));
      const first = list[0], last = list[list.length - 1];
      const rStart = after(q.end);
      for (const w of (S.next[cat(last.label)] || []).flatMap(expand)) {
        const end = rStart + S.lexicon[w].length;
        if (end > st.available || hasWordAt(w, rStart)) continue;
        if (ws.some(b => touches(last.end, b.start) && allowed(last.label, b.label))) continue;
        add('PREDICT', `PRED:${w}@${rStart}`, q.score * 0.9, `Rechts von „${q.label}" müsste „${w}" stehen`, { w, start: rStart, end, from: q });
      }
      const lEnd = before(q.start);
      for (const [k, nexts] of Object.entries(S.next)) {
        if (!nexts.includes(cat(first.label))) continue;
        for (const w of expand(k)) {
          const start = lEnd - S.lexicon[w].length;
          if (start < 0 || hasWordAt(w, start)) continue;
          if (ws.some(b => touches(b.end, first.start) && allowed(b.label, first.label))) continue;
          add('PREDICT', `PRED:${w}@${start}`, q.score * 0.9, `Links von „${q.label}" müsste „${w}" stehen`, { w, start, end: lEnd, from: q });
        }
      }
    }

    // Prüfer
    for (const p of words(st).filter(h => h.status === 'vorhergesagt'))
      add('VERIFY', 'VER:' + p.id, p.score, `Vorhersage „${p.label}" gegen das Signal prüfen`, { p });

    // Satzparser
    for (const q of seqs) {
      const list = q.words.map(id => st.hyps.find(h => h.id === id));
      if (list[0].start !== 0) continue;
      const cats = list.map(h => cat(h.label)).join(' ');
      if (S.sentences.some(s => s.join(' ') === cats))
        add('PARSE', 'PARSE:' + q.id, 1, `„${q.label}" ist ein gültiger Satz`, { q });
    }

    return out.sort((a, b) => b.eff - a.eff || (a.key < b.key ? -1 : 1));
  }

  function post(st, h) {
    h.id = 'h' + st.nextId++;
    h.born = st.cycle;
    st.hyps.push(h);
    return h;
  }

  function apply(st, k) {
    const p = k.payload;
    switch (k.ks) {
      case 'POM':
        return post(st, { level: 'syl', label: p.s.label, start: p.s.start, end: p.s.end, score: p.s.score, status: 'erkannt', support: [] });
      case 'MOW':
        return post(st, { level: 'word', label: p.w, start: p.chain[0].start, end: p.chain[p.chain.length - 1].end, score: p.score, status: 'erkannt', support: p.chain.map(h => h.id) });
      case 'SEQ':
        return post(st, { level: 'seq', label: p.list.map(h => h.label).join(' '), words: p.list.map(h => h.id), start: p.list[0].start, end: p.list[p.list.length - 1].end, score: p.score, status: 'erkannt', support: p.list.map(h => h.id) });
      case 'PREDICT':
        return post(st, { level: 'word', label: p.w, start: p.start, end: p.end, score: k.rating, status: 'vorhergesagt', support: [p.from.id] });
      case 'VERIFY': {
        const w = p.p, labels = S.lexicon[w.label];
        const hits = labels.map((l, i) => S.syllables.find(s => s.label === l && s.start === w.start + i && sylAvail(st, s)));
        if (hits.every(Boolean)) {
          w.score = Math.min(1, mean(hits.map(s => s.score)) + S.contextBonus);
          w.status = 'bestätigt';
        } else { w.score = 0; w.status = 'verworfen'; }
        w.touched = st.cycle;
        return w;
      }
      case 'PARSE':
        return post(st, { level: 'phrase', label: p.q.label, start: p.q.start, end: p.q.end, score: p.q.score, status: 'erkannt', support: [p.q.id] });
    }
  }

  // Zwischen Satzende und verfügbarem Signal liegt nur Stille?
  const onlySilenceAfter = (st, t) => {
    let x = t;
    while (x < st.available) { const s = S.silences.find(([a]) => a === x); if (!s) return false; x = s[1]; }
    return x >= st.available;
  };

  function step(st) {
    if (st.halted && st.halted !== 'question') return st;
    if (st.halted === 'question') { st.halted = null; st.asked = true; }
    st.cycle++;
    const list = agenda(st);
    if (!list.length) {
      if (st.streaming && st.available < S.end) {
        const from = st.available; st.available++;
        const silent = isSilence(from, st.available);
        st.last = { ks: 'SIGNAL', key: 'SIG:' + st.available, why: silent ? 'Stille im Signal' : 'Neues Signal trifft ein' };
        st.log.push({ cycle: st.cycle, ks: 'SIGNAL', text: silent ? `Zeit ${from}–${st.available}: Stille` : `Zeit ${from}–${st.available}: neues Signal` });
      } else {
        st.halted = 'stuck'; st.cycle--; return st;
      }
    } else {
      const k = list[0];
      st.done.add(k.key);
      const h = apply(st, k);
      if (h && !h.ks) h.ks = k.ks;
      st.fired[k.ks] = (st.fired[k.ks] || 0) + 1;
      st.last = { ks: k.ks, key: k.key, why: k.why, hyp: h && h.id };
      const res = k.ks === 'VERIFY' ? (h.status === 'bestätigt' ? ` → bestätigt (${f2(h.score)})` : ' → verworfen') : '';
      st.log.push({ cycle: st.cycle, ks: k.ks, text: k.why + res });
    }
    const phrases = st.hyps.filter(h => h.level === 'phrase');
    if (phrases.some(p => p.end === S.end && st.available >= S.end)) st.halted = 'solved';
    else if (st.streaming && !st.asked && phrases.some(p => p.end < st.available && onlySilenceAfter(st, p.end))) st.halted = 'question';
    return st;
  }

  function run(opts) {
    const st = create(opts);
    let guard = 0;
    while (guard++ < 500) {
      step(st);
      if (st.halted === 'solved' || st.halted === 'stuck') break;
    }
    return st;
  }

  const api = { create, agenda, step, run, S };
  root.Blackboard = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
