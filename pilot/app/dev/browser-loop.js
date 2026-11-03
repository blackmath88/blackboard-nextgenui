'use strict';
const fs = require('fs'), path = require('path');

// The user-facing loop, driven through the real page. Direct file mutation is
// used only to simulate another editor while the first tab has an open draft.
module.exports = async function loop(page, { url, dir, root, check, stop, startServer, setExtractor }) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async expr => {
    const until = Date.now() + 7000;
    while (Date.now() < until) { if (await page.eval(expr)) return true; await pause(40); }
    return false;
  };
  const shots = process.env.SHOT_DIR || path.join(root, 'screenshots'); fs.mkdirSync(shots, { recursive: true });
  const shot = async name => {
    const r = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shots, `loop-${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const state = async () => (await (await fetch(url + 'state')).json());
  const card = '#overview .item[data-id="task-1"]';
  await page.goto(url);
  await page.submit('Task: review the release notes. Task: discard the archive. Decision: keep evidence local.', 100);
  check('loop streamed conversation creates three reviewable proposals', await wait(`document.querySelectorAll('#overview .item.proposed').length === 3 && !document.getElementById('input').disabled`));
  await shot('01-proposed-desktop');
  await page.eval(`document.querySelector('${card}').focus()`); await page.key('c');
  check('loop keyboard acceptance preserves task identity', await wait(`document.querySelector('${card}').classList.contains('confirmed')`));
  await page.eval(`document.querySelector('#overview .item[data-id="task-2"]').focus()`); await page.key('r');
  check('loop keyboard rejection excludes the rejected record from knowledge views', await wait(`!document.querySelector('#overview .item[data-id="task-2"]')`));
  await page.eval(`document.querySelector('${card} .item-edit').click()`);
  check('loop edit dialog focuses the title and retains original evidence', await page.eval(`document.activeElement.id === 'item-edit-text' && document.getElementById('item-edit-origin').textContent.includes('review the release notes')`));
  await page.eval(`document.getElementById('item-edit-text').select()`);
  await page.send('Input.insertText', { text: 'Publish reviewed release notes' });
  await page.key('Tab'); await page.key('Enter');
  // The source URL is hidden for tasks; Tab moves to Save.
  check('loop keyboard save closes dialog and updates canonical task', await wait(`!document.getElementById('item-editor').open && document.querySelector('${card} .text').textContent === 'Publish reviewed release notes'`));
  await page.eval(`document.querySelector('[data-knowledge-view="kanban"]').click()`);
  await wait(`document.querySelector('${card} select')`);
  await page.eval(`document.querySelector('${card}').focus()`); await page.key('ArrowRight');
  check('loop task moves to doing using the keyboard', await wait(`document.querySelector('${card} select').value === 'doing'`));
  await page.key('ArrowRight');
  check('loop task moves to done without losing knowledge focus', await wait(`document.querySelector('${card} select').value === 'done' && document.activeElement.dataset.id === 'task-1'`));
  await shot('02-accepted-edited-done-desktop');
  for (const view of ['summary', 'index', 'kanban']) {
    await page.eval(`document.querySelector('[data-knowledge-view="${view}"]').click()`);
    check(`loop ${view} shows the same edited completed task`, await wait(`document.querySelector('${card}').textContent.includes('Publish reviewed release notes') && document.querySelector('${card}').textContent.includes('stage: done')`));
  }
  await page.eval(`document.getElementById('share-board').click()`);
  check('loop sharing preview includes current stage and excludes rejected/pending records', await wait(`(() => { const messages = JSON.parse(document.querySelector('#context-roles [data-role="chat"] pre').textContent); const board = messages.find(m => m.role === 'system'); return board && board.content.includes('"stage":"done"') && !board.content.includes('discard the archive') && !board.content.includes('keep evidence local'); })()`));
  await page.eval(`document.querySelector('#context-roles [data-role="chat"]').open = true`);
  await page.submit('What is the latest accepted task and its stage?', 100);
  check('loop next fake response uses edited title and done stage', await wait(`!document.getElementById('input').disabled && [...document.querySelectorAll('.ln.assistant .text')].at(-1).textContent.includes('task-1 [done]: Publish reviewed release notes')`));
  check('loop live context refresh preserves disclosure expansion', await page.eval(`document.querySelector('#context-roles [data-role="chat"]').open`));
  await shot('03-shared-response-desktop');
  await page.eval(`document.getElementById('share-board').click()`);
  await wait(`document.getElementById('models').textContent.includes('conversation-only')`);
  await page.submit('What context is shared now?', 100);
  check('loop sharing off sends no accepted board on the next turn', await wait(`!document.getElementById('input').disabled && [...document.querySelectorAll('.ln.assistant .text')].at(-1).textContent.includes('no accepted board')`));
  await page.eval(`document.querySelector('${card} .item-edit').click(); document.getElementById('item-edit-text').value = 'My unsaved draft'`);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
  saved.items.find(i => i.id === 'task-1').text = 'Changed in another editor';
  // Deliberately keep rev unchanged: the raw-content token must detect this.
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(saved));
  await wait(`document.querySelector('${card} .text').textContent === 'Changed in another editor'`);
  await page.eval(`document.getElementById('item-edit-save').click()`);
  check('loop stale save keeps draft and shows current saved record', await wait(`document.getElementById('item-edit-notice').textContent.includes('changed while') && document.getElementById('item-edit-text').value === 'My unsaved draft' && document.getElementById('item-edit-latest').textContent.includes('Changed in another editor')`));
  await shot('04-stale-edit-preserves-draft');
  await page.eval(`document.getElementById('item-edit-reload').click()`);
  check('loop stale recovery explicitly loads latest version', await page.eval(`document.getElementById('item-edit-text').value === 'Changed in another editor' && !document.getElementById('item-edit-save').disabled`));
  await page.eval(`document.getElementById('item-edit-text').value = 'Publish reviewed release notes'; document.getElementById('item-edit-save').click()`);
  await wait(`!document.getElementById('item-editor').open`);
  const before = await state();
  await stop('server'); await startServer(); await page.goto(url + '#knowledge-kanban');
  check('loop browser reconnect after restart preserves canonical records and pending review', await wait(`document.querySelector('${card} select')?.value === 'done' && document.querySelectorAll('#overview .item.proposed').length === 1`) && JSON.stringify((await state()).items) === JSON.stringify(before.items));
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const width of [820, 375]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    check(`loop ${width}px knowledge has no horizontal overflow`, await page.eval(`document.documentElement.scrollWidth <= innerWidth`));
    await shot(`05-knowledge-${width}`);
  }
  await page.eval(`document.querySelector('${card} .item-origin').click()`);
  check('loop narrow origin link restores visible conversation and source message', await wait(`document.body.dataset.surface === 'conversation' && !!document.querySelector('.ln.flash') && document.getElementById('pane-chat').getBoundingClientRect().width > 0`));
  await shot('06-conversation-375');
  await page.eval(`document.getElementById('show-knowledge').click(); document.querySelector('#overview .item.proposed').focus()`); await page.key('r');
  check('loop narrow final rejection keeps focus on a visible knowledge control', await wait(`!document.querySelector('#overview .item.proposed') && document.activeElement.getBoundingClientRect().width > 0 && document.body.dataset.surface === 'knowledge'`));
  await page.eval(`document.querySelector('${card}').focus()`); await page.key('Escape');
  check('loop Escape returns to visible conversation input at narrow width', await page.eval(`document.activeElement.id === 'input' && document.body.dataset.surface === 'conversation' && document.activeElement.getBoundingClientRect().width > 0`));
  await page.eval(`document.getElementById('new-chat').click()`);
  check('loop new chat starts a clean conversation while retaining shared knowledge', await wait(`document.querySelectorAll('.ln.user').length === 0 && document.querySelector('${card}')`));
  await page.eval(`document.getElementById('show-knowledge').click(); document.querySelector('${card} .item-origin').click()`);
  check('loop provenance jump finds the originating chat across conversations', await wait(`document.querySelectorAll('.ln.user').length > 0 && !!document.querySelector('.ln.flash')`));

  await setExtractor('--extract-delay=5000');
  await page.submit('Task: restore the interrupted browser review.', 100);
  check('loop page reports a queued extraction after the reply', await wait(`!document.getElementById('input').disabled && !document.getElementById('extraction-recovery').hidden`));
  await stop('server'); await setExtractor(); await startServer(); await page.goto(url + '#knowledge-kanban');
  check('loop interrupted extraction is visible after restart', await wait(`document.getElementById('extraction-recovery').textContent.includes('interrupted: Task: restore')`));
  await shot('07-interrupted-extraction-375');
  await page.eval(`document.querySelector('#extraction-recovery button').click()`);
  check('loop Retry extraction recovers one proposed task through the page', await wait(`document.getElementById('extraction-recovery').hidden && [...document.querySelectorAll('#overview .item.proposed .text')].filter(el => el.textContent === 'restore the interrupted browser review').length === 1`));

  // An edit request may finish after the user closes and reopens the dialog.
  // Delay delivery of its response, while allowing the real write to complete.
  await page.eval(`(() => { const realFetch = window.fetch; window.__editDelivered = false; window.fetch = async (...args) => { const res = await realFetch(...args); if (args[0] === '/edit') { window.fetch = realFetch; await new Promise(resolve => setTimeout(resolve, 600)); window.__editDelivered = true; } return res; }; document.querySelector('${card} .item-edit').click(); document.getElementById('item-edit-text').value = 'Saved while closing the editor'; document.getElementById('item-edit-save').click(); document.getElementById('item-edit-cancel').click(); document.querySelector('${card} .item-edit').click(); document.getElementById('item-edit-text').value = 'New unsaved draft'; })()`);
  await wait(`window.__editDelivered`);
  check('loop delayed save cannot close or overwrite a newly opened draft', await page.eval(`document.getElementById('item-editor').open && document.getElementById('item-edit-text').value === 'New unsaved draft'`));
  await page.eval(`document.getElementById('item-edit-cancel').click()`);
  check('loop closed editor still commits its acknowledged canonical edit', (await state()).items.find(i => i.id === 'task-1').text === 'Saved while closing the editor');
};
