# Die Tafel, an der alle schreiben

Ein kleiner, deterministischer Nachbau von **Hearsay-II** (CMU, 1971–1976), dem ersten Blackboard-System. Drei Akte:

1. **Die Tafel**: Wissensquellen schreiben Hypothesen an eine gemeinsame Tafel. Inseln wachsen von der sichersten Stelle aus, ein genuscheltes „and" wird top-down gerettet.
2. **Wer ist dran?**: Die Agenda als eigentliche Intelligenz. Opportunistisch vs. schichtweise auf denselben Daten, BB1 als Ort für eine LLM-Agenda, Vergleich mit br-ai-nstorm.
3. **Ist er fertig?**: Das Signal kommt live. Nach „Feigenbaum" steht ein vollständiger Satz an der Tafel, danach Stille. Die Seite endet mit der offenen Frage: Wie verschwindet der Enter-Knopf?

## Starten

`index.html` direkt im Browser öffnen. Kein Build, kein Server, keine Abhängigkeiten (nur Google Fonts, mit Fallback).

## Aufbau

```
js/scenario.js   Daten: Silben im Signal, Lexikon, Grammatik, Wissensquellen
js/engine.js     reine Engine: create · agenda · step · run (läuft auch in Node)
js/ui.js         Darstellung, liest nur den Zustand
css/style.css
```

Gleicher Start + gleiche Strategie = gleicher Verlauf. Prüfen:

```
node -e "globalThis.SCENARIO=require('./js/scenario.js');const B=require('./js/engine.js');for(const s of ['opportunistisch','schichtweise']){const r=B.run({strategy:s});console.log(s,r.halted,r.cycle)}"
```

## Bewusst offen

Akt 3 simuliert keine Lösung. Die drei Optionen (Stille, Vollständigkeit, Fragen) zeigen nur, warum jede allein nicht reicht.

Silben, Güten und Grammatik sind erfunden, die Architektur folgt Erman, Hayes-Roth, Lesser und Reddy (1980).
