/* Inhalt: die Meilensteine aus dem Build-Plan-Tracker. Nur Daten. */
(function (root) {
  const DATA = {
    sections: [
      { id: 'r01', title: 'Release 0.1: Wissensschleife' },
      { id: 'p02', title: 'Produktbeweis' },
      { id: 'm03', title: 'Handbuch und Automatisierung' },
      { id: 'w04', title: 'Aufgeschobene Entscheidungen' },
      { id: 'b05', title: 'Drei Beweise' }
    ],
    items: [
      { id: 'm0', sec: 'r01', name: 'M0 Sauberes Repository', status: 'erledigt', deps: [], tags: [], text: 'Neues Repo, Handbuch importiert, Deployment geschützt.' },
      { id: 'm1', sec: 'r01', name: 'M1 Prototyp-Superkraft bewahren', status: 'erledigt', deps: ['m0'], tags: [], text: 'Rohe HTML-Studien bleiben in Minuten live.' },
      { id: 'm2', sec: 'r01', name: 'M2 Astro-Hülle', status: 'erledigt', deps: ['m1'], tags: ['technisch'], text: 'Minimales Astro, Startseite, Navigation, ein Layout.' },
      { id: 'm3', sec: 'r01', name: 'M3 Eine Quelle, viele Oberflächen', status: 'in Arbeit', deps: ['m2'], tags: [], text: 'Ein Datensatz als Seite, als JSON und als Markdown.' },
      { id: 'm4', sec: 'r01', name: 'M4 Minimale Validierung', status: 'offen', deps: ['m3'], tags: ['technisch'], text: 'Kleines Zod-Schema, ungültige Datensätze scheitern klar.' },
      { id: 'm5', sec: 'r01', name: 'M5 Adoption-Lane-Rezept', status: 'blockiert', deps: ['m3'], tags: ['technisch'], text: 'Rezept als YAML. Blockiert: Vokabular der Stationen ist ungeklärt.' },
      { id: 'm6', sec: 'r01', name: 'M6 Zweiter verknüpfter Datensatz', status: 'offen', deps: ['m4', 'm5'], tags: [], text: 'Beweist die Form des Schemas, nicht nur die Schleife.' },
      { id: 'm7', sec: 'p02', name: 'M7 Ein echter Produkt-Workflow', status: 'offen', deps: ['m6'], tags: [], text: 'Fall, Beleg, Entscheidung, Herkunft. Ohne SaaS-Ballast.' },
      { id: 'm8', sec: 'm03', name: 'M8 Manuelles Kontextpaket', status: 'offen', deps: ['m6'], tags: [], text: 'Von Hand gebautes Bündel gegen einen Prompt ohne Kontext.' },
      { id: 'm9', sec: 'm03', name: 'M9 Bewährte Wiederholung automatisieren', status: 'offen', deps: ['m8'], tags: [], text: 'Automatisiert wird erst, was nachweislich schmerzt.' },
      { id: 'w-lit', sec: 'w04', name: 'Lit-Komponenten', status: 'aufgeschoben', deps: ['m7'], tags: ['technisch'], text: 'Erst wenn eine Komponente in zwei Frameworks laufen muss.' },
      { id: 'w-db', sec: 'w04', name: 'Datenbank', status: 'beobachten', deps: ['m7'], tags: ['technisch'], text: 'Erst wenn das Produkt echte Abfragemuster zeigt.' },
      { id: 'w-api', sec: 'w04', name: 'HTTP-API', status: 'aufgeschoben', deps: ['m8'], tags: ['technisch'], text: 'Erst beim zweiten echten Abnehmer.' },
      { id: 'w-mcp', sec: 'w04', name: 'MCP-Adapter', status: 'aufgeschoben', deps: ['m8'], tags: ['technisch'], text: 'Lieferkanal, kein Designtreiber.' },
      { id: 'p-loop', sec: 'b05', name: 'Beweis 1: Autorenschleife', status: 'offen', deps: ['m4'], tags: ['technisch'], text: 'Schreiben fühlt sich schnell an, Validierung fängt echte Fehler.' },
      { id: 'p-grammar', sec: 'b05', name: 'Beweis 2: Produktgrammatik', status: 'offen', deps: ['m7'], tags: [], text: 'Das Vokabular liest sich klar im Code.' },
      { id: 'p-bundle', sec: 'b05', name: 'Beweis 3: Kontextbündel', status: 'offen', deps: ['m8'], tags: [], text: 'Gegroundete Ausgabe ist messbar besser.' }
    ],
    statuses: ['offen', 'in Arbeit', 'erledigt', 'blockiert', 'aufgeschoben', 'beobachten'],
    layouts: { liste: 'Liste', gliederung: 'Gliederung', abhaengigkeiten: 'Abhängigkeiten', fokus: 'Fokus' }
  };
  root.DATA = DATA;
  if (typeof module !== 'undefined') module.exports = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
