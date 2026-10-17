/* Szenario: Hearsay-II-Spielzeugversion. Nur Daten, keine Logik. */
(function (root) {
  const SCENARIO = {
    utterance: 'ARE ANY BY FEIGENBAUM AND FELDMAN',
    end: 11,
    silences: [[7, 8]],            // Pause nach "Feigenbaum"
    threshold: 0.4,                // Worterkenner nutzt nur Silben ab dieser Güte
    contextBonus: 0.25,            // Top-down-Bestätigung hebt die Glaubwürdigkeit
    // Silbenkandidaten im verrauschten Signal: Zeitspanne + akustische Güte
    syllables: [
      { id: 's-ar',   label: 'ar',   start: 0,  end: 1,  score: 0.80 },
      { id: 's-e',    label: 'e',    start: 1,  end: 2,  score: 0.70 },
      { id: 's-an',   label: 'an',   start: 1,  end: 2,  score: 0.50 },
      { id: 's-ni',   label: 'ni',   start: 2,  end: 3,  score: 0.75 },
      { id: 's-bai',  label: 'bai',  start: 3,  end: 4,  score: 0.70 },
      { id: 's-fai',  label: 'fai',  start: 4,  end: 5,  score: 0.85 },
      { id: 's-gen',  label: 'gen',  start: 5,  end: 6,  score: 0.80 },
      { id: 's-baum', label: 'baum', start: 6,  end: 7,  score: 0.90 },
      { id: 's-end',  label: 'end',  start: 8,  end: 9,  score: 0.30 },  // genuschelt
      { id: 's-in',   label: 'in',   start: 8,  end: 9,  score: 0.45 },
      { id: 's-feld', label: 'feld', start: 9,  end: 10, score: 0.80 },
      { id: 's-fel',  label: 'fel',  start: 9,  end: 10, score: 0.50 },
      { id: 's-man',  label: 'man',  start: 10, end: 11, score: 0.75 }
    ],
    lexicon: {
      ARE: ['ar'], ANY: ['e', 'ni'], ANNIE: ['an', 'ni'], BY: ['bai'], BUY: ['bai'],
      FEIGENBAUM: ['fai', 'gen', 'baum'], AND: ['end'], IN: ['in'],
      FELDMAN: ['feld', 'man'], FELL: ['fel']
    },
    // Grammatik der Aufgabe: erlaubte Nachfolger und gültige Sätze
    names: ['FEIGENBAUM', 'FELDMAN'],
    next: { ARE: ['ANY'], ANY: ['BY'], BY: ['@NAME'], '@NAME': ['AND'], AND: ['@NAME'] },
    sentences: [
      ['ARE', 'ANY', 'BY', '@NAME'],
      ['ARE', 'ANY', 'BY', '@NAME', 'AND', '@NAME']
    ],
    levels: [
      { id: 'phrase', name: 'Satz' },
      { id: 'seq',    name: 'Wortfolgen' },
      { id: 'word',   name: 'Wörter' },
      { id: 'syl',    name: 'Silben' }
    ],
    ks: {
      POM:     { name: 'Silbenfinder', dir: 'bottom-up', text: 'Liest das Signal und schreibt Silben mit ihrer akustischen Güte an.' },
      MOW:     { name: 'Worterkenner', dir: 'bottom-up', text: 'Sucht im Lexikon Wörter, deren Silben nebeneinander an der Tafel stehen. Ignoriert Silben unter der Schwelle.' },
      SEQ:     { name: 'Wortfolgen',   dir: 'bottom-up', text: 'Verbindet benachbarte Wörter, wenn die Grammatik die Folge erlaubt. So wachsen Inseln.' },
      PREDICT: { name: 'Vorhersage',   dir: 'top-down',  text: 'Schaut an den Rand einer Insel und sagt voraus, welches Wort dort stehen müsste.' },
      VERIFY:  { name: 'Prüfer',       dir: 'top-down',  text: 'Prüft eine Vorhersage gegen das Signal, auch gegen schwache Silben, die der Worterkenner liegen liess.' },
      PARSE:   { name: 'Satzparser',   dir: 'bottom-up', text: 'Meldet, wenn eine Wortfolge vom Anfang an einen gültigen Satz bildet.' }
    }
  };
  root.SCENARIO = SCENARIO;
  if (typeof module !== 'undefined') module.exports = SCENARIO;
})(typeof window !== 'undefined' ? window : globalThis);
