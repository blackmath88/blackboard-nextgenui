/* Modell-Anbindung: Simulation oder eigene OpenAI-kompatible API.
   Beide liefern nur einen Vorschlag (FrameIntent). Geprüft wird er im Compiler. */
(function (root) {
  const D = root.DATA, M = root.Morph;
  const st = s => (k => D.items.filter(i => s.status[i.id] === k).map(i => i.id));

  /* ---------- Simulation: erkennbar gefälschte, aber plausible Modellantworten ---------- */
  function simulate(ctx, state) {
    const by = st(state), t = (ctx.text || '').toLowerCase();
    const blocked = by('blockiert'), doing = by('in Arbeit');
    const nextUp = D.items.filter(i => state.status[i.id] === 'offen' && i.deps.every(d => state.status[d] === 'erledigt')).map(i => i.id);
    let r;
    if (ctx.signal === 'absicht') {
      if (/block|häng|problem|steck|warum/.test(t))
        r = { layout: 'fokus', focus: blocked, foreground: blocked.flatMap(M.dependents), reason: `Du fragst nach Hindernissen: ${blocked.join(', ') || 'nichts'} blockiert, daneben was daran hängt.` };
      else if (/nächst|weiter|reihenfolge|als erstes|next/.test(t))
        r = nextUp.length
          ? { layout: 'abhaengigkeiten', focus: nextUp, foreground: doing, reason: 'Du suchst den nächsten Schritt: Abhängigkeiten zeigen, frei startbare Punkte gross.' }
          : { layout: 'abhaengigkeiten', focus: doing, foreground: doing.flatMap(M.dependents), reason: 'Nichts ist frei startbar. Erst muss Laufendes fertig werden: das gross, daneben was es freigibt.' };
      else if (/entscheid|später|trigger|warten|watch/.test(t))
        r = { layout: 'gliederung', focus: D.items.filter(i => i.sec === 'w04').map(i => i.id), collapse: ['r01', 'b05'], reason: 'Es geht um Entscheidungen: die Beobachtungsliste vorn, Release 0.1 klein.' };
      else if (/stand|überblick|release|status/.test(t))
        r = { layout: 'gliederung', focus: doing, foreground: blocked, collapse: ['w04', 'b05'], reason: 'Überblick gewünscht: nach Abschnitten, Laufendes und Blockiertes hervorgehoben.' };
      else r = { noop: true, reason: 'Aus dieser Absicht lässt sich kein besserer Rahmen ableiten. Er bleibt, wie er ist.' };
    } else if (ctx.signal === 'status') {
      const id = ctx.id, dn = M.dependents(id);
      r = ctx.to === 'blockiert'
        ? { layout: 'fokus', focus: [id], foreground: dn, reason: `${id.toUpperCase()} ist neu blockiert. Gezeigt wird, was daran hängt: ${dn.join(', ') || 'nichts'}.` }
        : ctx.to === 'erledigt'
          ? { layout: 'abhaengigkeiten', focus: dn.filter(x => D.items.find(i => i.id === x).deps.every(d => d === id || state.status[d] === 'erledigt')), reason: `${id.toUpperCase()} ist erledigt. Gross: was dadurch frei wird.` }
          : { noop: true, reason: 'Statuswechsel ohne Folgen für den Rahmen.' };
    } else if (ctx.signal === 'klick') {
      const it = D.items.find(i => i.id === ctx.id);
      r = { layout: it.deps.length > 1 || M.dependents(ctx.id).length > 1 ? 'abhaengigkeiten' : state.layout, focus: [ctx.id], foreground: [...it.deps, ...M.dependents(ctx.id)], collapse: D.sections.filter(s => s.id !== it.sec).map(s => s.id), reason: `${it.name}: Kette davor und danach, andere Abschnitte zurückgenommen.` };
    } else r = { noop: true, reason: 'Nichts Neues.' };
    r.reason = r.reason + (ctx.notes.length ? ` (Notizen berücksichtigt: ${ctx.notes.length})` : '');
    return new Promise(res => setTimeout(() => res(r), 900));
  }

  /* ---------- Eigene API (OpenAI-kompatibel: Ollama, Open WebUI, LM Studio, OpenAI …) ---------- */
  const SYSTEM = `You choose how a project board is SHOWN. You never change the project.
Return ONLY one JSON object, no prose, no code fences:
{"noop": boolean, "layout": "liste"|"gliederung"|"abhaengigkeiten"|"fokus", "focus": [ids], "foreground": [ids], "collapse": [ids or section ids], "reason": "one short sentence in German"}
Rules: use only ids from the given lists. You cannot change any status and cannot add buttons.
Prefer {"noop": true, "reason": "..."} when the signal does not justify a different view.
layout meanings: liste = flat list; gliederung = by section; abhaengigkeiten = dependency stages; fokus = focus items large, rest small.`;

  async function callApi(cfg, ctx, state) {
    const board = D.items.map(i => ({ id: i.id, section: i.sec, name: i.name, status: state.status[i.id], deps: i.deps }));
    const user = JSON.stringify({ signal: ctx.digest, notes_since_last_call: ctx.notes, current_layout: state.layout, sections: D.sections, items: board });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(cfg.base.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}) },
        body: JSON.stringify({ model: cfg.model, temperature: 0.2, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const data = await res.json();
      const text = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
      const clean = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json|```/g, '');
      const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
      if (a < 0 || b < a) throw new Error('Antwort enthält kein JSON: ' + clean.slice(0, 120));
      return JSON.parse(clean.slice(a, b + 1));
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Zeitüberschreitung nach 45 s.');
      if (e instanceof TypeError) throw new Error('Keine Verbindung. Läuft der Server, und erlaubt er Anfragen aus dem Browser (CORS)? Bei Ollama: OLLAMA_ORIGINS="*" setzen.');
      throw e;
    } finally { clearTimeout(timer); }
  }

  root.Model = { simulate, callApi, SYSTEM };
})(window);
