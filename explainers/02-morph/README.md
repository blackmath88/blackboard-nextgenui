# Die Oberfläche, die sich selbst umbaut

Explainer in drei Akten, gebaut auf den Meilensteinen des Build-Plan-Trackers.

1. **Die Wurzeln**: NLS (Ansichten per Befehl), adaptive Hypermedia (Regeln nach Nutzermodell, inklusive einer Regel, die danebengreift) und Morphic (direkt umformen mit Griffen).
2. **Der Vorschlag**: Signale (Klick, Verweilen, Statuswechsel, Absicht ohne Enter) gehen an einen deterministischen Kontrolleur: ignorieren, notieren oder wecken. Das Modell schlägt nur eine `FrameIntent` vor, der Compiler prüft und baut die Szene, View Transitions morphen sie.
3. **Wem gehört der Rahmen?**: Drei simulierte Vorschläge, bis eine Ansicht etwas versteckt und einen Knopf behauptet. Endet mit der offenen Frage nach Autorität.

## Starten

`index.html` direkt öffnen. Kein Build, keine Abhängigkeiten.

## Eigenes Modell (Akt 2)

Rechts „Eigene API" wählen: Basis-URL, Modell, optional Schlüssel. Jede OpenAI-kompatible API geht (`/chat/completions`).

- **Ollama**: `http://localhost:11434/v1`, Browser-Zugriff erlauben mit `OLLAMA_ORIGINS="*" ollama serve`.
- **LM Studio**: `http://localhost:1234/v1`, CORS in den Servereinstellungen aktivieren.
- **Open WebUI**: `http://<host>/api` mit API-Schlüssel aus den Einstellungen.

Die Antwort muss ein JSON-Objekt sein. `<think>`-Blöcke und Code-Fences werden entfernt. Unbekannte IDs, Layouts oder Felder (`hide`, `actions`) führen zu „verworfen, nichts umgeformt". Der Schlüssel bleibt im Speicher des Tabs.

## Aufbau

```
js/data.js       Inhalt: Abschnitte, Meilensteine, Abhängigkeiten
js/compiler.js   rein: validate (FrameIntent prüfen), compile (Szene), control (Kontrolleur), adaptive (Regeln Akt 1)
js/model.js      simulate oder callApi, liefert nur Vorschläge
js/ui.js         Darstellung, Signale, View Transitions
```

Die Grenze, um die es geht: Das Modell darf Layout, Fokus und Zurücknehmen vorschlagen. Status ändern, Elemente ausblenden und Knöpfe anbieten darf es in Akt 2 nicht. Akt 3 zeigt, was passiert, wenn es das doch darf.
