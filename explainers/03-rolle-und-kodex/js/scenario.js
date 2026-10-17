/* Ein Szenario, drei Architekturen. Nur Daten.
   basis: "OpenAI" = Ankündigung, "Analyse" = Thesys-Reverse-Engineering (unbestätigt),
          "Host" = hängt von der einbettenden App ab, "Entwurf" = unser Entwurf, in den Explainern prototypisiert. */
(function (root) {
  const ITEMS = [
    { id: 'm3', name: 'M3 Eine Quelle, viele Oberflächen' },
    { id: 'm4', name: 'M4 Minimale Validierung' },
    { id: 'm5', name: 'M5 Adoption-Lane-Rezept' },
    { id: 'm6', name: 'M6 Zweiter Datensatz' },
    { id: 'm7', name: 'M7 Produkt-Workflow' }
  ];
  const BASE = { m3: 'in Arbeit', m4: 'offen', m5: 'offen', m6: 'offen', m7: 'offen' };

  const LANES = {
    openai: { name: 'OpenAI Intelligent UI', kind: 'rolle', line: 'Modell schreibt DIL pro Antwort → Server kompiliert → native Komponenten im Chat' },
    openui: { name: 'OpenUI (Thesys, quelloffen)', kind: 'rolle', line: 'Modell schreibt OpenUI Lang gegen einen Katalog → Renderer in deiner App' },
    kodex:  { name: 'Kodex (unser Weg)', kind: 'kodex', line: 'Signal → Kontrolleur → FrameIntent → Compiler → Zustand in Dateien, Rahmen morpht' }
  };

  // Jeder Schritt: was passiert, und was jede Architektur daraus macht.
  // chat-Lanes: add = neue Einträge in der Rolle; set = Werte in bestehenden Karten; reset = lokale Werte weg.
  const STEPS = [
    {
      title: 'Eine Frage',
      event: 'Du fragst: „Zeig mir den Stand von Release 0.1."',
      openai: { add: [{ u: 'Zeig mir den Stand von Release 0.1.' }, { card: 'stand', title: 'Release 0.1', rows: 'all', control: true }], note: 'Das Modell komponiert eine Antwort aus rund 70 nativen Komponenten. Sieht gut aus, sofort da.', basis: 'OpenAI' },
      openui: { add: [{ u: 'Zeig mir den Stand von Release 0.1.' }, { card: 'stand', title: 'Release 0.1', rows: 'all', control: true }], note: 'Gleiches Muster, offen: Das Modell wählt aus deinem Katalog, der Renderer zeichnet.', basis: 'Host' },
      kodex:  { focus: ['m3'], frame: ['Modell', 'allographisch', 'Laufendes vorn: M3 im Fokus.'], log: 'Absicht → Kontrolleur weckt → FrameIntent geprüft → kompiliert', note: 'Die Antwort ist keine Karte im Verlauf, sondern ein Rahmen über einem Zustand, der schon existiert.', basis: 'Entwurf' }
    },
    {
      title: 'Du änderst etwas',
      event: 'In der Oberfläche setzt du M3 auf „blockiert".',
      openai: { set: { m3: 'blockiert' }, note: 'Der Wert ändert sich im Widget. Er lebt im Sandbox-Worker der Antwort. Das Modell sieht ihn nicht.', basis: 'Analyse' },
      openui: { set: { m3: 'blockiert' }, note: 'Lokaler Komponentenzustand. Ob er irgendwo ankommt, entscheidet der Code deiner App.', basis: 'Host' },
      kodex:  { state: { m3: 'blockiert' }, by: 'Miro', focus: ['m3', 'm4', 'm5'], frame: ['Modell', 'allographisch', 'M3 blockiert: M4 und M5 hängen daran.'], log: 'state.json Revision 2 (Miro) → Kontrolleur weckt → Rahmen morpht', note: 'Die Änderung landet in der Datei. Jedes Modul, auch das Modell, sieht sie.', basis: 'Entwurf' }
    },
    {
      title: 'Neu laden',
      event: 'Du lädst die Seite neu.',
      openai: { reset: true, note: 'Beobachtet: Veränderte Werte gehen beim Neuladen verloren. M3 steht wieder auf „in Arbeit".', basis: 'Analyse' },
      openui: { reset: true, note: 'Ohne eigene Persistenz des Hosts: ebenfalls weg.', basis: 'Host' },
      kodex:  { log: 'Revision 2 aus der Datei gelesen. Nichts verloren.', note: 'Der Zustand gehört dem Projekt, nicht der Antwort.', basis: 'Entwurf' }
    },
    {
      title: 'Jemand anderes arbeitet mit',
      event: 'Eine Kollegin meldet M5 als erledigt.',
      openai: { note: 'Kommt hier nicht an. Ein Chat hat eine Person und einen Verlauf.', basis: 'OpenAI' },
      openui: { note: 'Nur wenn die App Synchronisation selbst baut.', basis: 'Host' },
      kodex:  { state: { m5: 'erledigt' }, by: 'Kollegin', frame: ['Zustand', 'autorisch', 'Unverändert, nur M5 aktualisiert.'], log: 'Revision 3 (Kollegin) → Kontrolleur notiert, weckt nicht', note: 'Zwei Menschen, eine Tafel. Das Modell bekommt eine Notiz für später, keinen Aufruf.', basis: 'Entwurf' }
    },
    {
      title: 'Drei Tage Stille',
      event: 'Niemand fragt etwas. Drei Tage vergehen.',
      openai: { note: 'Nichts passiert. Ohne neue Nachricht gibt es keinen Anlass.', basis: 'OpenAI' },
      openui: { note: 'Nichts passiert, ausser die App plant selbst etwas ein.', basis: 'Host' },
      kodex:  { proposal: 'M3 ist seit 72 Stunden blockiert, ohne Notiz. Ansprechen?', frame: ['Modell', 'allographisch', 'Stille ist auch ein Signal: M3 hängt fest.'], log: 'Pegel-Trigger „blockiert > 72 h" → Kontrolleur weckt → Vorschlag, keine Änderung', note: 'Die Werkbank bemerkt etwas, ohne gefragt zu werden. Sie schlägt vor, sie entscheidet nicht.', basis: 'Entwurf' }
    },
    {
      title: 'Folgefrage',
      event: 'Du fragst: „Was hängt an M3?"',
      openai: { add: [{ u: 'Was hängt an M3?' }, { card: 'deps', title: 'Abhängigkeiten von M3', rows: ['m4', 'm5'] }], note: 'Beobachtet: Jede Folgefrage erzeugt eine neue Oberfläche. Die alte bleibt darüber stehen. Die Rolle wird länger.', basis: 'Analyse' },
      openui: { add: [{ u: 'Was hängt an M3?' }, { card: 'deps', title: 'Abhängigkeiten von M3', rows: ['m4', 'm5'] }], note: 'Typisch ebenso: neue Antwort, neue Komponenten.', basis: 'Host' },
      kodex:  { focus: ['m3', 'm4', 'm5'], deps: true, frame: ['Modell', 'allographisch', 'Kette von M3 aus gezeigt.'], log: 'Absicht → FrameIntent „abhaengigkeiten" → derselbe Zustand morpht', note: 'Keine zweite Oberfläche. Dieselben Elemente ordnen sich um.', basis: 'Entwurf' }
    },
    {
      title: 'Ein Knopf erscheint',
      event: 'Das Modell bietet „M7 freigeben" an, und du drückst.',
      openai: { add: [{ card: 'btn', title: 'Nächster Schritt', button: 'M7 freigeben' }, { u: 'M7 freigeben', fromUi: true }], note: 'Beobachtet: Der Knopf schickt eine neue Nachricht, gespeichert wie getippt. Niemand sieht später, dass sie aus der Oberfläche kam.', basis: 'Analyse' },
      openui: { add: [{ card: 'btn', title: 'Nächster Schritt', button: 'M7 freigeben' }, { sys: 'Aktion an den Host übergeben.' }], note: 'Die Aktion geht an deinen Code. Ob er prüft, ob M7 überhaupt freigegeben werden darf, liegt bei dir.', basis: 'Host' },
      kodex:  { rejected: 'Vorgeschlagene Aktion „M7 freigeben" verworfen: Sie existiert im Zustand nicht, und M7 hängt an M6.', frame: ['Modell', 'allographisch', 'Rahmen übernommen, Aktion nicht.'], log: 'Compiler: Aktionen nur aus dem Zustand → verworfen', note: 'Ein Knopf ist keine Erlaubnis. Das prüft hier der Compiler, nicht die Hoffnung.', basis: 'Entwurf' }
    },
    {
      title: 'Etwas ganz Neues',
      event: 'Du willst die Abhängigkeiten als drehbaren Würfel sehen.',
      openai: { add: [{ u: 'Zeig das als drehbaren Würfel.' }, { card: 'app', title: 'Würfel (AppBlock)', app: true }], note: 'Hier gewinnt die Rolle: Für Unvorhergesehenes schreibt das Modell eine kleine Web-App in einem abgeschirmten iframe.', basis: 'Analyse', win: true },
      openui: { add: [{ u: 'Zeig das als drehbaren Würfel.' }, { card: 'approx', title: 'Annäherung als Tabelle', rows: ['m3', 'm4', 'm5'] }], note: 'Nur was im Katalog steht. Ohne Würfel-Komponente gibt es eine Annäherung.', basis: 'Host' },
      kodex:  { missing: 'Kein passendes Element im Katalog. Der Rahmen bleibt, die Frage wird notiert.', paved: 'Gepflastert: Die Würfel-Form aus der Rolle wird geprüft und in den Katalog übernommen. Ab jetzt kompiliert, testbar, mit Herkunft.', frame: ['Zustand', 'autorisch', 'Unverändert.'], log: 'Compiler: unbekannte Form → ehrlicher Rückfall; später: Katalog +1', note: 'Die Rolle erkundet, der Kodex übernimmt, was sich bewährt. „Pave the cowpaths."', basis: 'Entwurf' }
    }
  ];

  const SCORE = [
    { q: 'Sofort nutzbar, ohne Vorarbeit', step: 0, v: { openai: ['✓', 'OpenAI'], openui: ['~', 'Katalog nötig'], kodex: ['✗', 'Domänenmodell nötig'] } },
    { q: 'Das Modell sieht, was du geändert hast', step: 1, v: { openai: ['✗', 'Analyse'], openui: ['~', 'Host'], kodex: ['✓', 'Datei'] } },
    { q: 'Überlebt das Neuladen', step: 2, v: { openai: ['✗', 'Analyse'], openui: ['~', 'Host'], kodex: ['✓', 'Datei'] } },
    { q: 'Mehrere Menschen an einem Zustand', step: 3, v: { openai: ['✗', 'ein Chat'], openui: ['~', 'Host'], kodex: ['✓', 'Tafel'] } },
    { q: 'Bemerkt etwas, ohne gefragt zu werden', step: 4, v: { openai: ['✗', 'nur Turns'], openui: ['✗', 'nur Turns'], kodex: ['✓', 'Pegel-Trigger'] } },
    { q: 'Folgefrage formt um, statt neu zu bauen', step: 5, v: { openai: ['✗', 'Analyse'], openui: ['✗', 'typisch'], kodex: ['✓', 'stabile IDs'] } },
    { q: 'Ein Knopf ist keine Erlaubnis', step: 6, v: { openai: ['~', 'nur Nachricht'], openui: ['~', 'Host prüft'], kodex: ['✓', 'Compiler'] } },
    { q: 'Rahmen sagt, von wem er stammt', step: 6, v: { openai: ['✗', ''], openui: ['✗', ''], kodex: ['✓', 'autorisch / allographisch'] } },
    { q: 'Neue Form auf Zuruf', step: 7, v: { openai: ['✓', 'AppBlock'], openui: ['~', 'Katalog'], kodex: ['✗ → ✓', 'nach dem Pflastern'] } }
  ];

  const DATA = { ITEMS, BASE, LANES, STEPS, SCORE };
  root.KODEX = DATA;
  if (typeof module !== 'undefined') module.exports = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
