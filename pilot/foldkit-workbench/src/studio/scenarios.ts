/**
 * Synthetic representations for the three reference conversations.
 *
 * These are fixtures: hand-authored compositions in the catalogue vocabulary,
 * used so the experience is reproducible without a model route. They are
 * deliberately different in shape — a system map, an interactive calculator,
 * an evidence synthesis — so the workspace is not one dashboard with new data.
 * All sources are fictitious and labelled as such.
 */

import type { Representation } from './spec.js'

// ---------------------------------------------------------------- architecture

export const archMap: Representation = {
  id: 'arch.map',
  title: 'Systemlandkarte',
  purpose: 'Wie Chat, Arbeitsfläche und Modell über einen gemeinsamen Zustand verbunden sind',
  root: {
    type: 'section',
    children: [
      {
        type: 'diagram',
        id: 'arch.diagram',
        layers: ['Oberfläche', 'Protokoll', 'Zustand', 'Intelligenz'],
        nodes: [
          { id: 'n.chat', label: 'Chat', layer: 0, detail: 'Gespräch, Composer, Verweise' },
          { id: 'n.board', label: 'Arbeitsfläche', layer: 0, detail: 'Native Komponenten' },
          { id: 'n.artifact', label: 'HTML-Artefakt', layer: 0, detail: 'Isolierte Sandbox', tone: 'caution' },
          { id: 'n.intents', label: 'Interaktionen', layer: 1, detail: 'Typisierte Ereignisse' },
          { id: 'n.bridge', label: 'Artefakt-Brücke', layer: 1, detail: 'Absender + Schema geprüft', tone: 'caution' },
          { id: 'n.log', label: 'Ereignisprotokoll', layer: 2, detail: 'Unveränderlich, geordnet', tone: 'accent' },
          { id: 'n.state', label: 'Sitzungszustand', layer: 2, detail: 'Abgeleitet aus dem Protokoll' },
          { id: 'n.context', label: 'Kontextaufbau', layer: 3, detail: 'Begrenztes Paket je Turn' },
          { id: 'n.model', label: 'Sprachmodell', layer: 3, detail: 'Schlägt Darstellungen vor' },
        ],
        edges: [
          { from: 'n.chat', to: 'n.intents' },
          { from: 'n.board', to: 'n.intents' },
          { from: 'n.artifact', to: 'n.bridge' },
          { from: 'n.bridge', to: 'n.intents' },
          { from: 'n.intents', to: 'n.log' },
          { from: 'n.log', to: 'n.state' },
          { from: 'n.state', to: 'n.context' },
          { from: 'n.context', to: 'n.model' },
          { from: 'n.model', to: 'n.state', label: 'Vorschlag', dashed: true },
        ],
      },
      {
        type: 'grid',
        columns: 3,
        children: [
          { type: 'metric', id: 'arch.m.flows', label: 'Schreibende Pfade', value: 1, note: 'nur über das Protokoll', tone: 'positive' },
          { type: 'metric', id: 'arch.m.trust', label: 'Vertrauensgrenzen', value: 2, note: 'Modell, Artefakt', tone: 'caution' },
          { type: 'metric', id: 'arch.m.views', label: 'Darstellungspfade', value: 2, note: 'nativ und HTML' },
        ],
      },
    ],
  },
}

export const archOptions: Representation = {
  id: 'arch.options',
  title: 'Alternativen',
  purpose: 'Drei Wege, Chat und Arbeitsfläche zu synchronisieren',
  root: {
    type: 'section',
    children: [
      {
        type: 'records',
        id: 'arch.alternatives',
        variant: 'option',
        items: [
          { id: 'opt.events', title: 'Ereignisprotokoll mit abgeleitetem Zustand', detail: 'Jede Interaktion wird als typisiertes Ereignis angehängt; Ansichten und Modellkontext werden daraus abgeleitet.', meta: 'Empfohlen' },
          { id: 'opt.shared', title: 'Gemeinsames Dokument (CRDT)', detail: 'Chat und Arbeitsfläche schreiben in ein gemeinsames, zusammenführbares Dokument.', meta: 'Stark für Mehrbenutzer' },
          { id: 'opt.direct', title: 'Direkte Modellaufrufe pro Klick', detail: 'Jede Interaktion ruft das Modell auf, das die Ansicht neu erzeugt.', meta: 'Einfach, aber teuer' },
        ],
      },
      {
        type: 'matrix',
        id: 'arch.matrix',
        options: [
          { id: 'opt.events', label: 'Ereignisprotokoll' },
          { id: 'opt.shared', label: 'CRDT-Dokument' },
          { id: 'opt.direct', label: 'Direkte Aufrufe' },
        ],
        criteria: [
          { id: 'c.trace', label: 'Nachvollziehbarkeit', weight: 3, assumption: 'w.trace' },
          { id: 'c.edit', label: 'Schutz menschlicher Änderungen', weight: 3, assumption: 'w.edit' },
          { id: 'c.cost', label: 'Modellkosten', weight: 2, assumption: 'w.cost' },
          { id: 'c.collab', label: 'Mehrbenutzer', weight: 1, assumption: 'w.collab' },
          { id: 'c.effort', label: 'Umsetzungsaufwand', weight: 2, assumption: 'w.effort' },
        ],
        scores: {
          'opt.events': { 'c.trace': 5, 'c.edit': 5, 'c.cost': 4, 'c.collab': 3, 'c.effort': 3 },
          'opt.shared': { 'c.trace': 3, 'c.edit': 4, 'c.cost': 4, 'c.collab': 5, 'c.effort': 2 },
          'opt.direct': { 'c.trace': 2, 'c.edit': 1, 'c.cost': 1, 'c.collab': 2, 'c.effort': 5 },
        },
      },
      {
        type: 'section',
        title: 'Gewichtung — verschieben Sie, was Ihnen wichtig ist',
        children: [{
          type: 'assumptions',
          id: 'arch.weights',
          items: [
            { id: 'w.trace', label: 'Nachvollziehbarkeit', value: 3, min: 0, max: 5, step: 1 },
            { id: 'w.edit', label: 'Schutz menschlicher Änderungen', value: 3, min: 0, max: 5, step: 1 },
            { id: 'w.cost', label: 'Modellkosten', value: 2, min: 0, max: 5, step: 1 },
            { id: 'w.collab', label: 'Mehrbenutzer', value: 1, min: 0, max: 5, step: 1 },
            { id: 'w.effort', label: 'Umsetzungsaufwand', value: 2, min: 0, max: 5, step: 1 },
          ],
        }],
      },
      {
        type: 'records',
        id: 'arch.decisions',
        variant: 'decision',
        items: [
          { id: 'dec.log', title: 'Interaktionen als Ereignisse protokollieren', detail: 'Status: vorgeschlagen. Grundlage für Kontext, Wiederherstellung und Prüfung.', meta: 'Vorgeschlagen', tone: 'accent' },
          { id: 'dec.select', title: 'Auswahl löst keinen Modellaufruf aus', detail: 'Status: vorgeschlagen. Nur ausdrückliche Aktionen erzeugen einen Turn.', meta: 'Vorgeschlagen', tone: 'accent' },
        ],
      },
    ],
  },
}

export const archPlan: Representation = {
  id: 'arch.plan',
  title: 'Umsetzungsplan',
  purpose: 'Acht Wochen bis zum belastbaren Interaktionsprotokoll',
  root: {
    type: 'section',
    children: [
      {
        type: 'board',
        id: 'arch.board',
        lanes: [
          { id: 'open', label: 'Offen' },
          { id: 'doing', label: 'In Arbeit' },
          { id: 'done', label: 'Erledigt' },
        ],
        cards: [
          { id: 't.schema', title: 'Ereignisschema festlegen', lane: 'done', owner: 'Mira' },
          { id: 't.log', title: 'Protokoll persistieren', lane: 'doing', owner: 'Jonas' },
          { id: 't.context', title: 'Kontextpaket begrenzen', lane: 'open', owner: 'Mira' },
          { id: 't.bridge', title: 'Artefakt-Brücke härten', lane: 'open', owner: 'Lea' },
          { id: 't.replay', title: 'Wiederherstellung testen', lane: 'open', owner: 'Jonas' },
        ],
      },
      {
        type: 'timeline',
        id: 'arch.timeline',
        span: 8,
        items: [
          { id: 'tl.schema', label: 'Ereignisschema', start: 0, length: 1, lane: 'Grundlage' },
          { id: 'tl.log', label: 'Protokoll', start: 1, length: 2, lane: 'Grundlage' },
          { id: 'tl.context', label: 'Kontextpaket', start: 2, length: 2, lane: 'Modell' },
          { id: 'tl.bridge', label: 'Artefakt-Brücke', start: 3, length: 3, lane: 'Sicherheit', tone: 'caution' },
          { id: 'tl.replay', label: 'Wiederherstellung', start: 5, length: 2, lane: 'Qualität' },
          { id: 'tl.review', label: 'Review', start: 7, length: 1, lane: 'Qualität', milestone: true },
        ],
      },
    ],
  },
}

// ---------------------------------------------------------------- budget

export const budgetPlan = (total = 480_000): Representation => ({
  id: 'budget.plan',
  title: 'Budget 2027',
  purpose: 'Verteilung des Produktbudgets — Werte sind verschiebbar',
  derived: {
    allocated: { op: 'add', args: [{ ref: 'b.dev' }, { ref: 'b.design' }, { ref: 'b.research' }, { ref: 'b.infra' }, { ref: 'b.events' }] },
    reserve: { op: 'sub', args: [{ ref: 'b.total' }, { ref: 'allocated' }] },
    reserveShare: { op: 'mul', args: [{ op: 'div', args: [{ ref: 'reserve' }, { ref: 'b.total' }] }, { num: 100 }] },
    monthly: { op: 'div', args: [{ ref: 'allocated' }, { num: 12 }] },
    devShare: { op: 'mul', args: [{ op: 'div', args: [{ ref: 'b.dev' }, { ref: 'allocated' }] }, { num: 100 }] },
  },
  root: {
    type: 'section',
    children: [
      {
        type: 'grid',
        columns: 4,
        children: [
          { type: 'metric', id: 'm.allocated', label: 'Verplant', derived: 'allocated', unit: 'CHF' },
          { type: 'metric', id: 'm.reserve', label: 'Reserve', derived: 'reserve', unit: 'CHF' },
          { type: 'metric', id: 'm.reserveShare', label: 'Reserve-Anteil', derived: 'reserveShare', unit: '%' },
          { type: 'metric', id: 'm.monthly', label: 'Pro Monat', derived: 'monthly', unit: 'CHF' },
        ],
      },
      {
        type: 'bars',
        id: 'budget.bars',
        title: 'Verteilung',
        unit: 'CHF',
        items: [
          { id: 'bar.dev', label: 'Entwicklung', assumption: 'b.dev', tone: 'accent' },
          { id: 'bar.design', label: 'Design', assumption: 'b.design' },
          { id: 'bar.research', label: 'Nutzerforschung', assumption: 'b.research' },
          { id: 'bar.infra', label: 'Infrastruktur', assumption: 'b.infra' },
          { id: 'bar.events', label: 'Weiterbildung', assumption: 'b.events' },
          { id: 'bar.reserve', label: 'Reserve', assumption: 'reserve', tone: 'positive' },
        ],
      },
      {
        type: 'assumptions',
        id: 'budget.inputs',
        items: [
          { id: 'b.total', label: 'Gesamtbudget', value: total, min: 300_000, max: 700_000, step: 10_000, unit: 'CHF' },
          { id: 'b.dev', label: 'Entwicklung', value: 210_000, min: 0, max: 400_000, step: 5_000, unit: 'CHF' },
          { id: 'b.design', label: 'Design', value: 80_000, min: 0, max: 200_000, step: 5_000, unit: 'CHF' },
          { id: 'b.research', label: 'Nutzerforschung', value: 45_000, min: 0, max: 150_000, step: 5_000, unit: 'CHF' },
          { id: 'b.infra', label: 'Infrastruktur', value: 50_000, min: 0, max: 150_000, step: 5_000, unit: 'CHF' },
          { id: 'b.events', label: 'Weiterbildung', value: 25_000, min: 0, max: 100_000, step: 5_000, unit: 'CHF' },
        ],
      },
      {
        type: 'callout', tone: 'critical', title: 'Überzeichnet',
        markdown: 'Die Posten übersteigen das Gesamtbudget. Kürzen Sie einen Posten oder erhöhen Sie das Gesamtbudget — oder fragen Sie mit **Auswirkungen besprechen**, wo es am wenigsten schmerzt.',
        showIf: { ref: 'reserve', max: 0 },
      },
      {
        type: 'callout', tone: 'caution', title: 'Reserve knapp',
        markdown: 'Unter 8 % Reserve fängt der Plan eine ungeplante Stelle oder höhere Lizenzkosten nicht mehr ab.',
        showIf: { ref: 'reserveShare', min: 0, max: 8 },
      },
      {
        type: 'callout', tone: 'neutral', title: 'Lesart',
        markdown: 'Eine Reserve von 10–15 % fängt eine ungeplante Stelle oder Lizenzkosten ab. Verschieben Sie Beträge direkt; die Kennzahlen rechnen sofort mit. Erst **Auswirkungen besprechen** schickt die Änderung ins Gespräch.',
        showIf: { ref: 'reserveShare', min: 8 },
      },
    ],
  },
})

// ---------------------------------------------------------------- research

export const researchFindings: Representation = {
  id: 'research.findings',
  title: 'Befunde',
  purpose: 'Was die (synthetische) Evidenz über Remote-Onboarding sagt',
  root: {
    type: 'section',
    children: [
      {
        type: 'records',
        id: 'research.claims',
        variant: 'finding',
        items: [
          { id: 'f.buddy', title: 'Feste Ansprechperson verkürzt die Einarbeitung', detail: 'Neue Mitarbeitende mit einer festen Buddy-Person erreichen die volle Produktivität im Mittel rund drei Wochen früher.', strength: 3, sources: ['s.panel', 's.field'], tone: 'positive' },
          { id: 'f.async', title: 'Asynchrone Dokumentation wirkt erst ab Woche 3', detail: 'In den ersten zwei Wochen ersetzt Dokumentation den direkten Austausch nicht; danach beschleunigt sie deutlich.', strength: 2, sources: ['s.field'] },
          { id: 'f.cohort', title: 'Kohorten-Onboarding senkt frühe Fluktuation', detail: 'Gemeinsam startende Gruppen berichten mehr Zugehörigkeit; der Effekt auf Produktivität ist unklar.', strength: 2, sources: ['s.survey'] },
          { id: 'f.tools', title: 'Werkzeugzugang am ersten Tag ist unterschätzt', detail: 'Fehlende Zugänge verursachen im Mittel 2,5 verlorene Arbeitstage.', strength: 1, sources: ['s.blog'], tone: 'caution' },
        ],
      },
      {
        type: 'bars',
        id: 'research.ttp',
        title: 'Wochen bis zur vollen Produktivität',
        unit: 'Wochen',
        items: [
          { id: 'ttp.none', label: 'Ohne Struktur', value: 14, tone: 'critical' },
          { id: 'ttp.docs', label: 'Nur Dokumentation', value: 12 },
          { id: 'ttp.cohort', label: 'Kohorte', value: 11 },
          { id: 'ttp.buddy', label: 'Buddy', value: 9, tone: 'positive' },
          { id: 'ttp.both', label: 'Buddy + Doku', value: 8, tone: 'positive' },
        ],
      },
    ],
  },
}

export const researchEvidence: Representation = {
  id: 'research.evidence',
  title: 'Evidenz',
  purpose: 'Quellen, Methoden und offene Fragen',
  root: {
    type: 'section',
    children: [
      {
        type: 'callout',
        tone: 'caution',
        markdown: 'Alle Quellen in diesem Labor sind **synthetisch** und dienen nur der Demonstration.',
      },
      {
        type: 'table',
        id: 'research.studies',
        selectable: true,
        columns: [
          { key: 'name', label: 'Studie' },
          { key: 'method', label: 'Methode' },
          { key: 'n', label: 'n', align: 'end' },
          { key: 'quality', label: 'Güte' },
        ],
        rows: [
          { id: 's.panel', cells: { name: 'Panelstudie Nordwerk', method: 'Längsschnitt, 18 Monate', n: 412, quality: 'hoch' }, tone: 'positive' },
          { id: 's.field', cells: { name: 'Feldexperiment Kanton', method: 'Randomisiert', n: 96, quality: 'mittel' } },
          { id: 's.survey', cells: { name: 'Umfrage Tech-Branche', method: 'Querschnitt', n: 1280, quality: 'mittel' } },
          { id: 's.blog', cells: { name: 'Erfahrungsbericht', method: 'Einzelfall', n: 1, quality: 'niedrig' }, tone: 'caution' },
        ],
      },
      {
        type: 'sources',
        id: 'research.sources',
        items: [
          { id: 's.panel', title: 'Panelstudie Nordwerk', origin: 'Synthetisch · Institut Nordwerk', year: 2025, kind: 'Längsschnitt', excerpt: 'Buddy-Zuordnung war der stärkste einzelne Prädiktor für frühere volle Produktivität.' },
          { id: 's.field', title: 'Feldexperiment Kanton', origin: 'Synthetisch · Verwaltungslabor', year: 2024, kind: 'Experiment', excerpt: 'Dokumentation wirkte in Woche 1–2 nicht, ab Woche 3 signifikant.' },
          { id: 's.survey', title: 'Umfrage Tech-Branche', origin: 'Synthetisch · Branchenverband', year: 2026, kind: 'Umfrage', excerpt: 'Kohorten berichten höhere Zugehörigkeit, Produktivität nicht gemessen.' },
          { id: 's.blog', title: 'Erfahrungsbericht', origin: 'Synthetisch · Engineering-Blog', year: 2026, kind: 'Einzelfall', excerpt: 'Zwei Tage ohne Laptop-Zugang am Start.' },
        ],
      },
      {
        type: 'records',
        id: 'research.open',
        variant: 'question',
        items: [
          { id: 'q.senior', title: 'Gilt der Buddy-Effekt auch für erfahrene Fachkräfte?', detail: 'Alle Studien betrachten überwiegend Berufseinsteigende.' },
          { id: 'q.measure', title: 'Wie messen wir „volle Produktivität“ bei uns?', detail: 'Die Studien verwenden Selbsteinschätzung und Ticketdurchsatz.' },
        ],
      },
    ],
  },
}

// ---------------------------------------------------------------- learning

export const learnPlan: Representation = {
  id: 'learn.plan',
  title: 'Lernplan Effect',
  purpose: 'Sechs Wochen, abends — Zeit und Übungen gehören Ihnen',
  derived: {
    total: { op: 'mul', args: [{ ref: 'l.hours' }, { ref: 'l.weeks' }] },
    'h.basics': { op: 'mul', args: [{ ref: 'total' }, { num: 0.15 }] },
    'h.effects': { op: 'mul', args: [{ ref: 'total' }, { num: 0.3 }] },
    'h.schema': { op: 'mul', args: [{ ref: 'total' }, { num: 0.2 }] },
    'h.foldkit': { op: 'mul', args: [{ ref: 'total' }, { num: 0.2 }] },
    'h.project': { op: 'mul', args: [{ ref: 'total' }, { num: 0.15 }] },
  },
  root: {
    type: 'section',
    children: [
      {
        type: 'grid', columns: 3, children: [
          { type: 'metric', id: 'lm.total', label: 'Lernzeit gesamt', derived: 'total', unit: 'Std.' },
          { type: 'metric', id: 'lm.effects', label: 'Davon Effects & Fehler', derived: 'h.effects', unit: 'Std.' },
          { type: 'metric', id: 'lm.project', label: 'Abschlussprojekt', derived: 'h.project', unit: 'Std.' },
        ],
      },
      {
        type: 'grid', columns: 2, children: [
          {
            type: 'assumptions', id: 'learn.inputs', items: [
              { id: 'l.hours', label: 'Stunden pro Woche', value: 6, min: 2, max: 15, step: 1, unit: 'Std.' },
              { id: 'l.weeks', label: 'Wochen', value: 6, min: 3, max: 12, step: 1 },
            ],
          },
          {
            type: 'bars', id: 'learn.split', title: 'Zeit pro Thema', unit: 'Std.', items: [
              { id: 'lb.basics', label: 'Grundlagen', assumption: 'h.basics' },
              { id: 'lb.effects', label: 'Effects & Fehler', assumption: 'h.effects', tone: 'accent' },
              { id: 'lb.schema', label: 'Schema', assumption: 'h.schema' },
              { id: 'lb.foldkit', label: 'Foldkit', assumption: 'h.foldkit' },
              { id: 'lb.project', label: 'Projekt', assumption: 'h.project', tone: 'positive' },
            ],
          },
        ],
      },
      {
        type: 'timeline', id: 'learn.timeline', span: 6, items: [
          { id: 'lt.basics', label: 'Grundlagen & Pipe', start: 0, length: 1, lane: 'Verstehen' },
          { id: 'lt.effects', label: 'Effects & Fehler', start: 1, length: 2, lane: 'Verstehen' },
          { id: 'lt.schema', label: 'Schema', start: 2, length: 1, lane: 'Anwenden' },
          { id: 'lt.foldkit', label: 'Foldkit-App', start: 3, length: 2, lane: 'Anwenden' },
          { id: 'lt.project', label: 'Eigenes Projekt', start: 4, length: 2, lane: 'Festigen' },
          { id: 'lt.review', label: 'Rückblick', start: 5, length: 1, lane: 'Festigen', milestone: true },
        ],
      },
      {
        type: 'board', id: 'learn.board',
        lanes: [{ id: 'open', label: 'Geplant' }, { id: 'doing', label: 'Läuft' }, { id: 'done', label: 'Geschafft' }],
        cards: [
          { id: 'lc.basics', title: 'Pipe-Übungen', lane: 'open', detail: 'Woche 1' },
          { id: 'lc.effects', title: 'Fehlerkanal verstehen', lane: 'open', detail: 'Woche 2–3' },
          { id: 'lc.schema', title: 'API mit Schema validieren', lane: 'open', detail: 'Woche 3' },
          { id: 'lc.foldkit', title: 'Zähler-App in Foldkit', lane: 'open', detail: 'Woche 4' },
          { id: 'lc.project', title: 'Eigenes Projekt', lane: 'open', detail: 'Woche 5–6' },
        ],
      },
      {
        type: 'sources', id: 'learn.resources', items: [
          { id: 'r.effect', title: 'Effect-Dokumentation', origin: 'effect.website', kind: 'Offizielle Doku', excerpt: 'Einstieg, Effects, Fehlerbehandlung, Schema.' },
          { id: 'r.foldkit', title: 'Foldkit-Beispiele', origin: 'foldkit.dev', kind: 'Offizielle Doku', excerpt: 'Model, Message, Update, Commands — mit kleinen Apps.' },
        ],
      },
    ],
  },
}
