/* Original pixel sprites, 12x12. a = amber, d = dim amber, c = cyan, w = white-ish. */
(function (root) {
  const SPRITES = {
    teletype: [
      '..dddddddd..', '..dwwwwwwd..', '..dwddddwd..', '..dwwwwwwd..', '..dwddddwd..', '.aaaaaaaaaa.',
      'aaaaaaaaaaaa', 'adadadadadaa', 'aadadadadada', 'adadadadadaa', 'aaaaaaaaaaaa', '.a........a.'],
    commander: [
      'cccccccccccc', 'c....cc....c', 'c.aa.cc.dd.c', 'c....cc....c', 'c.aa.cc.dd.c', 'c....cc....c',
      'c.aa.cc.dd.c', 'c....cc....c', 'c.aa.cc.dd.c', 'c....cc....c', 'cccccccccccc', 'adadadadadad'],
    windows: [
      'aaaaaaaa....', 'a......a....', 'a..cccccccc.', 'a..c......c.', 'aaac.dddd.c.', '...c......c.',
      '...c.dddd.c.', '...c......c.', '...cccccccc.', '............', 'dddddddddddd', 'a.a.a.a.a.a.'],
    wheel: [
      '....aaaa....', '..aa....aa..', '.a...dd...a.', '.a..d..d..a.', 'a..d....d..a', 'a..d.cc.d..a',
      'a..d.cc.d..a', 'a..d....d..a', '.a..d..d..a.', '.a...dd...a.', '..aa....aa..', '....aaaa....'],
    perspective: [
      'cccccc.aaaaa', 'c.c..c.a...a', 'c.c..c.a...a', 'c.c..c.aaaaa', 'c.cccc.a.a.a', 'cccccc.aaaaa',
      '............', '....d..d....', '...ddddddd..', '....d..d....', '............', 'dddddddddddd'],
    house: [
      '.....a......', '....aaa.....', '...aaaaa....', '..aaaaaaa...', '..a.c.c.a...', '..a.....a...',
      '..a.c.c.addd', '..a.....ad.d', '..a..aa.addd', '..a..aa.ad.d', 'aaaaaaaaaaaa', 'dddddddddddd'],
    agent: [
      'aaaaaaaaaaaa', 'a..........a', 'a.c........a', 'a..c.......a', 'a.c..dddd..a', 'a..........a',
      'a.dddddd...a', 'a..........a', 'a.dddd.....a', 'a..........a', 'aaaaaaaaaaaa', '...aaaaaa...'],
    keeper: [
      '...aaaaaa...', '..a......a..', '.a.cc..cc.a.', '.a.cw..cw.a.', '.a........a.', '.a..dddd..a.',
      '..a......a..', '...aaaaaa...', '..a.a..a.a..', '.a..a..a..a.', '....a..a....', '...aa..aa...']
  };
  const COL = { a: 'var(--amber)', d: 'var(--dim)', c: 'var(--cyan)', w: 'var(--paper)' };
  function sprite(name, size = 48, label = '') {
    const rows = SPRITES[name];
    let r = '';
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (COL[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${COL[ch]}"/>`; }));
    return `<svg class="px" viewBox="0 0 12 12" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="${label}">${r}</svg>`;
  }
  root.Pixel = { sprite };
})(window);
