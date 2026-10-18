// CLI Pilot (pilot-v0.11): the kanban's order rule. Deterministic, no model. Used by the page (window.Board) and by the
// server (require('./public/board.js')), so both sort a column the same way.
// A task's place in its column: `order` (a number) when it has one, else its position in state.json `items` (0-based).
// Without any `order` the board is in file order, exactly as before pilot-v0.11. Ties: file position.
// A move writes only the moved task: its `order` becomes the midpoint between its new neighbours (first: the next one
// minus 1; last: the previous one plus 1; alone: its file position). No other card is renumbered, so no other card
// changes author. Rejected tasks are not on the board and are not neighbours.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Board = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COLUMNS = ['todo', 'doing', 'done'];
  const columnOf = (it) => (COLUMNS.includes(it.column) ? it.column : 'todo');
  const hasOrder = (it) => typeof it.order === 'number' && Number.isFinite(it.order);
  // items: every item of state.json in file order (the file position is the fallback key)
  function keyOf(items) {
    const pos = new Map(items.map((it, i) => [it, i]));
    return (it) => (hasOrder(it) ? it.order : pos.get(it));
  }
  // tasks: the tasks to sort (a subset of items); returns a new array in board order
  function sort(tasks, items) {
    const key = keyOf(items), pos = new Map(items.map((it, i) => [it, i]));
    return tasks.slice().sort((a, b) => key(a) - key(b) || pos.get(a) - pos.get(b));
  }
  // The tasks on the board in one column, in order (rejected ones are not on the board).
  function column(items, col) {
    return sort(items.filter((it) => it.kind === 'task' && it.status !== 'rejected' && columnOf(it) === col), items);
  }
  // Where `item` goes when it is dropped at position `index` of column `col` (index counts the other cards of that
  // column, 0 = top). Returns {order, index, neighbours: [above id|null, below id|null]}.
  function place(items, item, col, index) {
    const others = column(items, col).filter((it) => it !== item);
    const i = Math.max(0, Math.min(others.length, Number.isInteger(index) ? index : others.length));
    const key = keyOf(items);
    const above = others[i - 1], below = others[i];
    let order;
    if (above && below) order = (key(above) + key(below)) / 2;
    else if (above) order = key(above) + 1;
    else if (below) order = key(below) - 1;
    else order = items.indexOf(item);
    return { order, index: i, neighbours: [above ? above.id : null, below ? below.id : null] };
  }
  // The index of `item` among the cards of its column (null when it is not on the board).
  function indexOf(items, item) {
    const i = column(items, columnOf(item)).indexOf(item);
    return i < 0 ? null : i;
  }
  return { COLUMNS, columnOf, hasOrder, sort, column, place, indexOf };
}));
