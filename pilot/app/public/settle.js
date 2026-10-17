// CLI Pilot (pilot-v0.9, experiment behind the flag experiments.settledInput): does the input look finished?
// Deterministic, no model. Used by the page (window.Settle) and by the node checks (require('./public/settle.js')).
// looksFinished(text) -> {finished: bool, cue: 'punct' | 'question' | null, why}
//   finished when, after trimming:
//   - it is not a command (starts with "/"), and has at least 2 words or at least 6 characters before the ending;
//   - it ends in . ! ? (optionally followed by closing ) ] " ' ” ’ »): cue 'question' for ?, else 'punct';
//     or it starts with a question word (what, how, why, can, should, ...), has at least 4 words and ends in a letter
//     or digit that is not a dangling function word (and, or, the, to, ...): cue 'question';
//   not finished when it ends in "..." or "…" (trailing off), ",", ":", ";", "-", in an abbreviation that usually
//   continues (e.g., i.e., vs., cf., approx.), in a list number ("3."), or in a URL ("see https://x.org."), or when a
//   bracket or a code span (`) is still open. English only. See CHANGELOG.md # pilot-v0.9 for the cases.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Settle = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const QWORDS = /^(what|how|why|when|where|who|whom|whose|which|can|could|should|would|will|shall|is|are|was|were|do|does|did|have|has|may|might|must)\b/i;
  const DANGLING = /\b(and|or|but|so|because|the|a|an|to|of|with|for|in|on|at|by|from|if|that|than|then|my|your|our|their|is|are|be)$/i;
  const CONTINUES = /(^|\s)(e\.g|i\.e|vs|cf|approx|incl|z\.b|bzw)\.$/i;
  const CLOSERS = /[)\]"'”’»]+$/;

  function balanced(s) {
    if ((s.match(/`/g) || []).length % 2) return false;
    let depth = 0;
    for (const ch of s) {
      if (ch === '(' || ch === '[') depth++;
      else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    }
    return depth === 0;
  }

  function looksFinished(text) {
    const s = String(text || '').trim();
    const no = (why) => ({ finished: false, cue: null, why });
    if (!s) return no('empty');
    if (s.startsWith('/')) return no('command');
    if (!balanced(s)) return no('open bracket or code span');
    const core = s.replace(CLOSERS, '');
    const words = core.split(/\s+/).filter(Boolean);
    const body = core.replace(/[.!?…]+$/, '');
    if (words.length < 2 && body.length < 6) return no('too short');
    if (/(\.\.\.|…)$/.test(core)) return no('trails off');
    if (/[,:;\-–—]$/.test(core)) return no('ends mid-sentence');
    const last = words[words.length - 1] || '';
    if (/[.!?]$/.test(core)) {
      if (CONTINUES.test(core)) return no('abbreviation that usually continues');
      if (/^\d+[.)]$/.test(last)) return no('list number');
      if (/^(https?:\/\/|www\.)\S+\.$/i.test(last)) return no('URL');
      return { finished: true, cue: core.endsWith('?') ? 'question' : 'punct', why: 'sentence-final punctuation' };
    }
    if (QWORDS.test(core) && words.length >= 4 && /[\p{L}\p{N}]$/u.test(core) && !DANGLING.test(core)) {
      return { finished: true, cue: 'question', why: 'question without a question mark' };
    }
    return no('no finished ending');
  }

  return { looksFinished };
}));
