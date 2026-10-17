# Rolle und Kodex

Explainer in drei Akten über drei Architekturen für Oberflächen mit Sprachmodellen.

1. **Rolle und Kodex**: Vom Lesen in Rollen zum Kodex und seinem Apparat; Genettes autorischer und allographischer Paratext. Dazu eine Tabelle: OpenAI Intelligent UI, OpenUI und der Kodex im Vergleich (Form, Zustand, Weckruf, Knopf, Stärke, Beleg).
2. **Ein Szenario, drei Antworten**: Acht Schritte nebeneinander: Frage, eigene Änderung, Neuladen, Kollegin, drei Tage Stille, Folgefrage, angebotener Knopf, ganz neue Form. Die Chat-Spuren wachsen als Rolle, der Kodex morpht über einem Zustand mit Randglossen zur Herkunft jedes Rahmens. Eine Bilanz füllt sich Schritt für Schritt. Im letzten Schritt gewinnt die Rolle, und der Kodex übernimmt die bewährte Form („pave the cowpaths").
3. **Nordstern**: „Eine Werkbank, die mitdenkt, ohne mitzuentscheiden." Ein Zwei-Wochen-Beweis auf dem echten Build-Plan, die Zuordnung zu den eigenen Repositories, vorgeschlagene Abnahmeschwellen und ein Abbruchkriterium.

## Starten

`index.html` direkt öffnen. Kein Build, keine Abhängigkeiten. Pfeiltasten blättern im Szenario.

## Aufbau

```
js/scenario.js   Daten: Elemente, Spuren, acht Schritte, Bilanz (mit Belegart je Aussage)
js/ui.js         Spuren für Schritt k aus den Schritten 0..k berechnet, vor- und zurückspulbar
css/style.css
```

## Belege

Jede Aussage trägt ihre Belegart: **OpenAI** (Ankündigung), **Analyse** (Thesys-Reverse-Engineering, von OpenAI nicht bestätigt), **Host** (hängt von der einbettenden App ab), **Entwurf** (unser Entwurf, in den beiden anderen Explainern prototypisiert). Alles ist simuliert.
