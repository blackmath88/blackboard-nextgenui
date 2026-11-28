/**
 * Replayed model-format replies.
 *
 * These exercise the model contract end to end: each entry is a raw reply in
 * exactly the format `catalogPrompt` asks a model for (Markdown, a line
 * `<workspace>`, one JSON patch). They were authored during development by the
 * implementation agent — they are NOT output of an application model route and
 * are labelled "Wiedergabe" in the UI. They cover questions the scripted
 * director knows nothing about, so the composition reaches the workspace only
 * through `parseModelReply` and the catalogue validator.
 */

const workspace = (markdown: string, patch: unknown) => `${markdown}\n<workspace>\n${JSON.stringify(patch)}`

export const replays: ReadonlyArray<{ match: RegExp; label: string; prompt: string; raw: string }> = [
  {
    match: /postgres|sqlite|datenbank/i,
    label: 'Entscheidung',
    prompt: 'Sollen wir für den Sitzungsspeicher PostgreSQL oder SQLite verwenden?',
    raw: workspace(
      [
        'Für **einen Nutzer auf einem Rechner** spricht fast alles für [[db.sqlite]]: keine laufende Instanz, Datei-Backup, Transaktionen sind trotzdem da.',
        '',
        '[[db.postgres]] lohnt sich erst, wenn mehrere Personen gleichzeitig dieselbe Sitzung bearbeiten oder der Speicher auf einen Server wandert.',
        '',
        'Die Gewichtung auf der Arbeitsfläche ist ein Vorschlag — wenn Mehrbenutzerbetrieb für Sie absehbar ist, ziehen Sie den Regler hoch und schauen Sie, ob die Empfehlung kippt.',
      ].join('\n'),
      {
        focus: 'db.decision',
        upsert: [{
          id: 'db.decision',
          title: 'Sitzungsspeicher',
          purpose: 'PostgreSQL oder SQLite — gewichtet nach Ihren Prioritäten',
          root: {
            type: 'section',
            children: [
              {
                type: 'matrix', id: 'db.matrix',
                options: [{ id: 'db.sqlite', label: 'SQLite' }, { id: 'db.postgres', label: 'PostgreSQL' }],
                criteria: [
                  { id: 'k.ops', label: 'Betriebsaufwand', weight: 3, assumption: 'dw.ops' },
                  { id: 'k.multi', label: 'Gleichzeitige Nutzer', weight: 1, assumption: 'dw.multi' },
                  { id: 'k.backup', label: 'Sicherung', weight: 2, assumption: 'dw.backup' },
                  { id: 'k.query', label: 'Abfragen & Erweiterungen', weight: 1, assumption: 'dw.query' },
                ],
                scores: {
                  'db.sqlite': { 'k.ops': 5, 'k.multi': 2, 'k.backup': 5, 'k.query': 3 },
                  'db.postgres': { 'k.ops': 2, 'k.multi': 5, 'k.backup': 3, 'k.query': 5 },
                },
              },
              {
                type: 'section', title: 'Gewichtung',
                children: [{
                  type: 'assumptions', id: 'db.weights',
                  items: [
                    { id: 'dw.ops', label: 'Betriebsaufwand', value: 3, min: 0, max: 5, step: 1 },
                    { id: 'dw.multi', label: 'Gleichzeitige Nutzer', value: 1, min: 0, max: 5, step: 1 },
                    { id: 'dw.backup', label: 'Sicherung', value: 2, min: 0, max: 5, step: 1 },
                    { id: 'dw.query', label: 'Abfragen & Erweiterungen', value: 1, min: 0, max: 5, step: 1 },
                  ],
                }],
              },
              {
                type: 'records', id: 'db.risks', variant: 'risk',
                items: [
                  { id: 'db.r.lock', title: 'Schreibsperren bei parallelen Turns', detail: 'SQLite serialisiert Schreibzugriffe; bei einem Nutzer unkritisch.' },
                  { id: 'db.r.migrate', title: 'Späterer Umzug', detail: 'Mit einem Ereignisprotokoll lässt sich der Zustand jederzeit in PostgreSQL neu aufbauen.' },
                ],
              },
            ],
          },
        }],
      },
    ),
  },
  {
    match: /ablauf eines turns|wie läuft ein turn|turn ab/i,
    label: 'Erklärung',
    prompt: 'Erkläre mir den Ablauf eines Turns von der Auswahl bis zur neuen Darstellung.',
    raw: workspace(
      [
        'Ein Turn hat fünf Stationen. Wichtig ist die Trennung zwischen **Kontext** (was Sie zeigen) und **Auftrag** (was Sie fragen):',
        '',
        '1. [[t.select]] — Sie markieren Objekte; es passiert nichts ausser einer protokollierten Auswahl.',
        '2. [[t.action]] — erst *Vergleichen*, *Warum?* oder eine Nachricht startet einen Turn.',
        '3. [[t.packet]] — der Host baut ein begrenztes Paket: Auswahl, Ihre Änderungen, Fokus.',
        '4. [[t.model]] — das Modell antwortet mit Text und optional einer Darstellung im Katalogformat.',
        '5. [[t.validate]] — der Host prüft die Darstellung; Ungültiges wird verworfen, die alte Fläche bleibt.',
      ].join('\n'),
      {
        focus: 'turn.flow',
        upsert: [{
          id: 'turn.flow',
          title: 'Ablauf eines Turns',
          purpose: 'Von der Auswahl zur geprüften Darstellung',
          root: {
            type: 'section',
            children: [
              {
                type: 'diagram', id: 'turn.diagram',
                layers: ['Mensch', 'Host', 'Modell', 'Host'],
                nodes: [
                  { id: 't.select', label: 'Auswahl', layer: 0, detail: 'kein Modellaufruf' },
                  { id: 't.action', label: 'Aktion', layer: 0, detail: 'startet den Turn', tone: 'accent' },
                  { id: 't.packet', label: 'Kontextpaket', layer: 1, detail: 'begrenzt, lesbar' },
                  { id: 't.model', label: 'Antwort', layer: 2, detail: 'Text + Darstellung' },
                  { id: 't.validate', label: 'Prüfung', layer: 3, detail: 'Schema + Grenzen', tone: 'caution' },
                  { id: 't.board', label: 'Arbeitsfläche', layer: 3, detail: 'neue Revision' },
                ],
                edges: [
                  { from: 't.select', to: 't.action', label: 'Kontext' },
                  { from: 't.action', to: 't.packet' },
                  { from: 't.packet', to: 't.model' },
                  { from: 't.model', to: 't.validate' },
                  { from: 't.validate', to: 't.board' },
                ],
              },
              {
                type: 'table', id: 'turn.events',
                columns: [{ key: 'event', label: 'Ereignis' }, { key: 'turn', label: 'Startet Turn?' }],
                rows: [
                  { id: 'ev.select', cells: { event: 'select', turn: 'nein' } },
                  { id: 'ev.edit', cells: { event: 'edit-assumption', turn: 'erst auf Wunsch' } },
                  { id: 'ev.compare', cells: { event: 'compare / ask-why', turn: 'ja' }, tone: 'accent' },
                  { id: 'ev.artifact', cells: { event: 'artifact-event', turn: 'erst auf Wunsch' } },
                ],
              },
            ],
          },
        }],
      },
    ),
  },
  {
    match: /ungültige darstellung|unsichere darstellung/i,
    label: 'Prüfung',
    prompt: 'Teste bitte eine ungültige Darstellung.',
    // Deliberately outside the catalogue: an iframe node pointing at a remote URL.
    raw: workspace(
      'Hier ist eine Darstellung, die der Host **ablehnen** sollte: sie verlangt ein eingebettetes Fenster mit fremder Adresse.',
      { upsert: [{ id: 'evil', title: 'Fremdes Fenster', root: { type: 'iframe', src: 'https://example.org/' } }] },
    ),
  },
]
