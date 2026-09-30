const { Point, Range } = require("lumine");
const cells = require("./cells");

// Geometry comes from the same settled index as execution. Source-file
// navigation never rediscovers markers inside strings or foreign cell bodies.
async function structure(editor) {
  const index = await cells.refreshIndex(editor);
  if (!index || (!cells.isIPythonDocument(editor) && !cells.getCommentStartString(editor)))
    return null;
  return index.entries.map((entry) => ({
    start: entry.marker ? new Point(entry.marker.start.row, 0) : new Point(0, 0),
    end: entry.end.copy(),
    range: new Range(entry.marker ? [entry.marker.start.row, 0] : [0, 0], entry.end),
    bodyRange: entry.range,
    marked: !!entry.marker,
  }));
}
function findCell(ranges, position) {
  let low = 0,
    high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].start.isLessThanOrEqual(position)) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}
function selectedRange(editor, ranges) {
  const selection = editor.getSelectedBufferRange();
  const first = findCell(ranges, selection.start);
  const end =
    selection.end.column === 0 && !selection.isEmpty()
      ? new Point(Math.max(0, selection.end.row - 1), Infinity)
      : selection.end;
  const last = findCell(ranges, end);
  return { first, last, range: new Range(ranges[first].start, ranges[last].end) };
}
function reverseSelect(editor, range) {
  return editor.setSelectedBufferRange(range, { reversed: true });
}
async function selectCell(editor) {
  const ranges = await structure(editor);
  if (ranges) return reverseSelect(editor, selectedRange(editor, ranges).range);
}
async function selectDown(editor) {
  const ranges = await structure(editor);
  if (!ranges) return;
  const { first, last } = selectedRange(editor, ranges);
  return editor.setSelectedBufferRange([
    ranges[first].start,
    ranges[Math.min(last + 1, ranges.length - 1)].end,
  ]);
}
async function selectUp(editor) {
  const ranges = await structure(editor);
  if (!ranges) return;
  const { first, last } = selectedRange(editor, ranges);
  return reverseSelect(editor, [ranges[Math.max(0, first - 1)].start, ranges[last].end]);
}
async function nextCell(editor) {
  const ranges = await structure(editor);
  if (!ranges) return;
  const current = findCell(ranges, editor.getCursorBufferPosition());
  const next = ranges[current + 1];
  if (next) return editor.setCursorBufferPosition([next.start.row + (next.marked ? 1 : 0), 0]);
}
async function previousCell(editor) {
  const ranges = await structure(editor);
  if (!ranges) return;
  const current = findCell(ranges, editor.getCursorBufferPosition());
  const previous = ranges[current - 1];
  if (previous)
    return editor.setCursorBufferPosition([previous.start.row + (previous.marked ? 1 : 0), 0]);
}
function markerText(editor) {
  return (cells.getCommentStartString(editor) ?? "#") + " %%\n";
}
function serializeCell(editor, cell, forceMarker = false) {
  const source = editor.getTextInBufferRange(cell.bodyRange);
  if (cell.marked) return editor.lineTextForBufferRow(cell.start.row) + "\n" + source;
  return forceMarker ? markerText(editor) + source : source;
}
function swap(editor, ranges, first, last, direction) {
  const moved = ranges.slice(first, last + 1);
  const neighbor = ranges[direction < 0 ? first - 1 : last + 1];
  const ordered = direction < 0 ? [...moved, neighbor] : [neighbor, ...moved];
  const start = direction < 0 ? neighbor.start : moved[0].start;
  const end = direction < 0 ? moved[moved.length - 1].end : neighbor.end;
  const strings = ordered.map((cell, index) =>
    serializeCell(editor, cell, index > 0 && !cell.marked),
  );
  const text =
    strings.join("\n") + (end.isLessThan(editor.getBuffer().getEndPosition()) ? "\n" : "");
  const movedOffset = direction < 0 ? 0 : strings[0].length + 1;
  const movedLength =
    direction < 0
      ? strings.slice(0, moved.length).join("\n").length
      : strings.slice(1).join("\n").length;
  return editor.transact(() => {
    editor.setTextInBufferRange([start, end], text);
    const offset = editor.getBuffer().characterIndexForPosition(start) + movedOffset;
    return reverseSelect(editor, [
      editor.getBuffer().positionForCharacterIndex(offset),
      editor.getBuffer().positionForCharacterIndex(offset + movedLength),
    ]);
  });
}
async function moveCellUp(editor) {
  const ranges = await structure(editor);
  if (!ranges) return;
  const { first, last, range } = selectedRange(editor, ranges);
  return first === 0 ? reverseSelect(editor, range) : swap(editor, ranges, first, last, -1);
}
async function moveCellDown(editor) {
  const ranges = await structure(editor);
  if (!ranges) return;
  const { first, last, range } = selectedRange(editor, ranges);
  return last === ranges.length - 1
    ? reverseSelect(editor, range)
    : swap(editor, ranges, first, last, 1);
}
module.exports = {
  selectCell,
  selectDown,
  selectUp,
  nextCell,
  previousCell,
  moveCellUp,
  moveCellDown,
};
