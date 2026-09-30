const { Emitter, Point, Range } = require("lumine");

const markupGrammars = new Set([
  "source.gfm",
  "source.asciidoc",
  "text.restructuredtext",
  "text.tex.latex.knitr",
  "text.md",
  "source.weave.noweb",
  "source.weave.md",
  "source.weave.latex",
  "source.weave.restructuredtext",
  "source.pweave.noweb",
  "source.pweave.md",
  "source.pweave.latex",
  "source.pweave.restructuredtext",
  "source.dyndoc.md.stata",
  "source.dyndoc.latex.stata",
]);
const indexes = new WeakMap();
const updates = new Emitter();
const INDEX_CHUNK_NODES = 512;
const INDEX_SLICE_MS = 8;

function yieldIndex() {
  return new Promise((resolve) => setImmediate(resolve));
}

function isMultilanguageGrammar(grammar) {
  return markupGrammars.has(grammar?.scopeName);
}
function isFragment(editor) {
  return lumine.textEditors?.roleFor?.(editor) === "fragment";
}
function isIPythonDocument(editor) {
  return editor.getGrammar?.()?.scopeName === "source.python.ipy" && !isFragment(editor);
}
function getEmbeddedScope(editor, position) {
  return editor
    .scopeDescriptorForBufferPosition(position)
    .getScopesArray()
    .find((scope, index) => index > 0 && scope.startsWith("source."));
}
function escapeStringRegexp(string) {
  return string.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}
function normalizeString(code) {
  return code ? code.replace(/\r\n|\r/g, "\n") : null;
}
function getTextInRange(editor, start, end) {
  return normalizeString(editor.getTextInBufferRange([start, end]));
}
function getRows(editor, startRow, endRow) {
  return getTextInRange(editor, [startRow, 0], [endRow, Infinity]);
}
function isComment(editor, position) {
  return editor.scopeDescriptorForBufferPosition(position).getScopeChain().includes("comment.line");
}
function isBlank(editor, row) {
  return editor.getBuffer().isRowBlank(row);
}
function escapeBlankRows(editor, startRow, endRow) {
  while (endRow > startRow && isBlank(editor, endRow)) endRow--;
  return endRow;
}
function getCommentStartString(editor) {
  if (isIPythonDocument(editor)) return "#";
  const cursor = editor.getCursorBufferPosition();
  const column = editor.lineTextForBufferRow(cursor.row).search(/\S/);
  const delimiters = editor.getCommentDelimitersForBufferPosition([
    cursor.row,
    column === -1 ? cursor.column : column,
  ]);
  return (delimiters?.line ?? delimiters?.block?.[0])?.trimEnd() ?? null;
}
function getRegexString(editor) {
  const comment = getCommentStartString(editor);
  if (!comment) return null;
  return (
    escapeStringRegexp(comment) +
    "[\\t ]*%{2,}(?:[\\t ]+(\\[(?:md|markdown|raw)\\]|md|markdown)(?=[\\t \\r\\n]|$))?| *<(codecell|md|markdown)>| *(In[[0-9 ]*])"
  );
}
function stateFor(editor) {
  const buffer = editor.getBuffer();
  let state = indexes.get(buffer);
  if (!state) {
    state = { revision: 0, builtRevision: -1, index: null, promise: null };
    indexes.set(buffer, state);
    const subscription = buffer.onDidChange(() => {
      state.revision++;
    });
    buffer.onDidDestroy?.(() => subscription.dispose());
  }
  return state;
}
function point(position) {
  return new Point(position.row, position.column);
}
function lowerBound(items, position, key = "start") {
  let low = 0,
    high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle][key].isLessThan(position)) low = middle + 1;
    else high = middle;
  }
  return low;
}
function markerType(node) {
  const metadata = node.childForFieldName("metadata")?.text?.replace(/^\[|\]$/g, "");
  if (metadata === "md" || metadata === "markdown") return "markdown";
  return metadata === "raw" ? "raw" : "code";
}
async function buildASTIndex(editor, tree, isCurrent) {
  const markers = [],
    magics = [];
  let node = tree.rootNode.firstNamedChild;
  let count = 0;
  let sliceStart = performance.now();
  while (node) {
    let marker = null;
    if (node.type === "cell_marker") marker = node;
    else if (node.type === "markdown_cell" || node.type === "raw_cell") {
      marker = node.childForFieldName("marker");
    }
    if (marker)
      markers.push({
        start: point(marker.startPosition),
        end: point(marker.endPosition),
        cellType:
          node.type === "markdown_cell"
            ? "markdown"
            : node.type === "raw_cell"
              ? "raw"
              : markerType(marker),
      });
    if (node.type === "cell_magic") {
      const body = node.childForFieldName("body");
      magics.push({
        start: point(node.startPosition),
        end: point(node.endPosition),
        bodyStart: body ? point(body.startPosition) : point(node.endPosition),
      });
    }
    node = node.nextNamedSibling;
    count++;
    if (
      node &&
      (count % INDEX_CHUNK_NODES === 0 ||
        (count % 64 === 0 && performance.now() - sliceStart >= INDEX_SLICE_MS))
    ) {
      await yieldIndex();
      if (!isCurrent()) return null;
      sliceStart = performance.now();
    }
  }
  const entries = [];
  count = 0;
  sliceStart = performance.now();
  for (const entry of makeEntries(editor, markers, true)) {
    entries.push(entry);
    count++;
    if (
      count % INDEX_CHUNK_NODES === 0 ||
      (count % 64 === 0 && performance.now() - sliceStart >= INDEX_SLICE_MS)
    ) {
      await yieldIndex();
      if (!isCurrent()) return null;
      sliceStart = performance.now();
    }
  }
  return { markers, entries, magics, literal: true };
}
function* makeEntries(editor, markers, literal) {
  const buffer = editor.getBuffer(),
    end = buffer.getEndPosition();
  let start = new Point(0, 0),
    marker = null;
  const add = (boundary, terminal) => {
    const contentRange = new Range(start, boundary);
    // One newline before the next header separates cells, independently of
    // source newlines. The importer writes that separator explicitly.
    let sourceEnd = boundary;
    if (!terminal && boundary.row > start.row && boundary.column === 0) {
      sourceEnd = new Point(boundary.row - 1, buffer.lineLengthForRow(boundary.row - 1));
    }
    if (marker || !contentRange.isEmpty())
      return {
        start,
        end: boundary,
        contentRange,
        range: new Range(start, sourceEnd),
        cellType: marker?.cellType ?? "code",
        marker,
        literal,
      };
  };
  for (const next of markers) {
    const entry = add(next.start, false);
    if (entry) yield entry;
    marker = next;
    start = new Point(Math.min(next.start.row + 1, end.row), 0);
    if (next.start.row === end.row) start = end;
  }
  const entry = add(end, true);
  if (entry) yield entry;
}
function finishIndex(editor, markers, magics = [], literal = false) {
  return { markers, entries: [...makeEntries(editor, markers, literal)], magics, literal };
}
function buildLegacyIndex(editor) {
  const regexString = isFragment(editor) ? null : getRegexString(editor),
    markers = [];
  if (regexString)
    editor.getBuffer().scan(new RegExp(regexString, "g"), ({ match, range }) => {
      if (!isComment(editor, range.start)) return;
      const metadata = match
        .slice(1)
        .find(Boolean)
        ?.replace(/^\[|\]$/g, "");
      markers.push({
        start: range.start.copy(),
        end: range.end.copy(),
        cellType:
          metadata === "md" || metadata === "markdown"
            ? "markdown"
            : metadata === "raw"
              ? "raw"
              : "code",
      });
    });
  const magics = [];
  if (isFragment(editor)) {
    for (let row = 0; row <= editor.getLastBufferRow(); row++) {
      const line = editor.lineTextForBufferRow(row);
      if (!/\S/.test(line)) continue;
      if (/^\s*%%(?:[\w-]+|!)(?:\s|$)/.test(line)) {
        magics.push({
          start: new Point(row, 0),
          end: editor.getBuffer().getEndPosition(),
          bodyStart: editor.getBuffer().clipPosition([row + 1, 0]),
        });
      }
      break;
    }
  }
  return finishIndex(editor, markers, magics);
}
function indexIsCurrent(editor, state) {
  const mode = editor.getBuffer().getLanguageMode();
  return (
    state.index &&
    state.builtRevision === state.revision &&
    state.mode === mode &&
    state.fragment === isFragment(editor) &&
    (!isIPythonDocument(editor) || state.tree === mode.tree)
  );
}
async function refreshIndex(editor) {
  if (!editor || editor.isDestroyed?.()) return null;
  const state = stateFor(editor);
  if (indexIsCurrent(editor, state)) return state.index;
  if (state.promise) return state.promise;
  state.promise = (async () => {
    while (!editor.isDestroyed?.()) {
      const revision = state.revision,
        mode = editor.getBuffer().getLanguageMode();
      await mode.atTransactionEnd?.();
      if (revision !== state.revision || mode !== editor.getBuffer().getLanguageMode()) continue;
      const tree = mode.tree;
      if (isIPythonDocument(editor) && !tree?.rootNode) return null;
      const isCurrent = () =>
        !editor.isDestroyed?.() &&
        revision === state.revision &&
        mode === editor.getBuffer().getLanguageMode() &&
        tree === mode.tree;
      const index = isIPythonDocument(editor)
        ? await buildASTIndex(editor, tree, isCurrent)
        : buildLegacyIndex(editor);
      if (!index || !isCurrent()) continue;
      state.index = index;
      state.builtRevision = revision;
      state.mode = mode;
      state.tree = tree;
      state.fragment = isFragment(editor);
      updates.emit("did-update", {
        editor,
        breakpoints: index.markers.map((marker) => marker.start.copy()),
      });
      return index;
    }
    return null;
  })().finally(() => {
    state.promise = null;
  });
  return state.promise;
}
function getMarkerIndex(editor) {
  if (!editor || editor.isDestroyed?.()) return null;
  const state = stateFor(editor);
  if (indexIsCurrent(editor, state)) return state.index;
  if (isIPythonDocument(editor)) {
    void refreshIndex(editor);
    return null;
  }
  state.index = buildLegacyIndex(editor);
  state.builtRevision = state.revision;
  state.mode = editor.getBuffer().getLanguageMode();
  state.fragment = isFragment(editor);
  return state.index;
}
function entryAt(index, position) {
  const marker = index.markers[lowerBound(index.markers, new Point(position.row, 0))];
  if (marker?.start.row === position.row) {
    const at = lowerBound(index.entries, new Point(position.row + 1, 0));
    return index.entries[Math.min(at, index.entries.length - 1)] ?? null;
  }
  const at = lowerBound(index.entries, position);
  if (index.entries[at]?.start.isEqual(position)) return index.entries[at];
  return index.entries[Math.max(0, at - 1)] ?? null;
}
function getCell(editor, position = editor?.getCursorBufferPosition()) {
  const index = getMarkerIndex(editor);
  if (!index) return null;
  const rowEnd = new Point(position.row, editor.getBuffer().lineLengthForRow(position.row));
  return entryAt(index, rowEnd)?.contentRange.copy() ?? null;
}
function getCurrentCell(editor) {
  if (isMultilanguageGrammar(editor.getGrammar())) {
    const scope = getEmbeddedScope(editor, editor.getCursorBufferPosition());
    if (scope) {
      let { row: start } = editor.getCursorBufferPosition(),
        end = start;
      const embedded = (row) =>
        editor.scopeDescriptorForBufferPosition([row, 0]).getScopesArray().includes(scope);
      while (start > 0 && embedded(start - 1)) start--;
      while (end < editor.getLastBufferRow() && embedded(end + 1)) end++;
      return new Range([start, 0], [end + 1, 0]);
    }
  }
  return getCell(editor);
}
function getBreakpoints(editor) {
  const index = getMarkerIndex(editor);
  return index
    ? [...index.markers.map((marker) => marker.start.copy()), editor.getBuffer().getEndPosition()]
    : [];
}
function getCells(editor) {
  return getMarkerIndex(editor)?.entries.map((entry) => entry.contentRange.copy()) ?? [];
}
function uncomment(comment, text) {
  if (!comment) return text;
  const source = text
    .split("\n")
    .map((line) => (line.startsWith(comment) ? line.slice(comment.length) : line))
    .join("\n");
  const indents = source.match(/^[ \t]*(?=\S)/gm);
  const indent = indents ? Math.min(...indents.map((value) => value.length)) : 0;
  return indent ? source.replace(new RegExp("^[ \\t]{" + indent + "}", "gm"), "") : source;
}
function entriesForRange(index, range) {
  if (!range) return index.entries;
  range = Range.fromObject(range);
  if (range.isEmpty()) return [entryAt(index, range.start)].filter(Boolean);
  const first = Math.max(0, lowerBound(index.entries, range.start) - 1),
    entries = [];
  for (let at = first; at < index.entries.length; at++) {
    const entry = index.entries[at];
    if (entry.start.isGreaterThanOrEqual(range.end)) break;
    if (entry.end.isGreaterThan(range.start)) entries.push(entry);
  }
  return entries;
}
function describe(editor, index, requestedRange) {
  const selection = requestedRange ? Range.fromObject(requestedRange) : null;
  // The parser already warmed TextBuffer's immutable cached text. Keeping its
  // reference preserves this revision without copying whole cell bodies merely
  // to classify a cursor. Individual sources are sliced only when requested.
  const buffer = editor.getBuffer();
  const text = buffer.getText();
  const revision = stateFor(editor).revision;
  const comment = getCommentStartString(editor);
  return entriesForRange(index, selection)
    .map((entry) => {
      const start =
        selection && !selection.isEmpty() && selection.start.isGreaterThan(entry.range.start)
          ? selection.start
          : entry.range.start;
      const end =
        selection && !selection.isEmpty() && selection.end.isLessThan(entry.range.end)
          ? selection.end
          : entry.range.end;
      if (start.isGreaterThan(end)) return null;
      const range = new Range(start.copy(), end.copy());
      const sourceStart = buffer.characterIndexForPosition(range.start);
      const sourceEnd = buffer.characterIndexForPosition(range.end);
      let source;
      return {
        range,
        cellType: entry.cellType,
        get source() {
          if (source === undefined) {
            // Native range reads detach small executed fragments from the full
            // document. For an older descriptor, copy its UTF-16 slice instead
            // of retaining a large obsolete backing string in an output log.
            source =
              !editor.isDestroyed?.() && stateFor(editor).revision === revision
                ? editor.getTextInBufferRange(range)
                : Buffer.from(text.slice(sourceStart, sourceEnd), "utf16le").toString("utf16le");
            source = source.replace(/\r\n|\r/g, "\n");
            if (!entry.literal && entry.cellType !== "code") source = uncomment(comment, source);
          }
          return source;
        },
      };
    })
    .filter(Boolean);
}
async function getCellDescriptors(editor, requestedRange) {
  const index = await settledIndex(editor);
  return index ? describe(editor, index, requestedRange) : [];
}
async function settledIndex(editor) {
  while (editor && !editor.isDestroyed?.()) {
    const index = await refreshIndex(editor);
    if (!index) return null;
    const state = stateFor(editor);
    if (state.index === index && indexIsCurrent(editor, state)) return index;
  }
  return null;
}
function magicAt(index, position) {
  const at = lowerBound(index.magics, position);
  const magic = index.magics[at]?.start.isEqual(position) ? index.magics[at] : index.magics[at - 1];
  return magic?.end.isGreaterThan(position) ? magic : null;
}
async function getExecutionBlocks(editor, requestedRange) {
  const index = await settledIndex(editor);
  if (!index) return [];
  let selection = requestedRange ? Range.fromObject(requestedRange) : null;
  if (selection?.isEmpty()) {
    const magic = magicAt(index, selection.start);
    if (magic) selection = new Range(magic.start, magic.end);
  }
  const descriptors = describe(editor, index, selection);
  return descriptors
    .filter(({ source }) => /\S/.test(source))
    .map(({ range, cellType, source }) => {
      const magic = cellType === "code" && magicAt(index, range.start);
      if (
        magic &&
        magic.bodyStart.isLessThanOrEqual(range.start) &&
        range.start.isGreaterThan(magic.start)
      ) {
        source =
          editor.getTextInBufferRange([magic.start, magic.bodyStart]).replace(/\r\n|\r/g, "\n") +
          source;
      }
      let lastRow =
        range.end.row - (range.end.column === 0 && range.end.row > range.start.row ? 1 : 0);
      lastRow = escapeBlankRows(editor, range.start.row, lastRow);
      return { code: source, row: lastRow, cellType };
    });
}
function adjustCellFoldRange(editor, range) {
  const startRow = range.start.row > 0 ? range.start.row - 1 : 0;
  const endRow = range.end.row === editor.getLastBufferRow() ? range.end.row : range.end.row - 1;
  return new Range(
    [startRow, editor.lineTextForBufferRow(startRow).length],
    [endRow, editor.lineTextForBufferRow(endRow).length],
  );
}
async function foldCurrentCell(editor) {
  await refreshIndex(editor);
  const cell = getCurrentCell(editor);
  if (!cell) return;
  editor.setSelectedBufferRange(adjustCellFoldRange(editor, cell));
  editor.getSelections()[0].fold();
}
async function foldAllButCurrentCell(editor) {
  await refreshIndex(editor);
  const selections = editor.getSelectedBufferRanges(),
    current = getCurrentCell(editor);
  const ranges = getCells(editor)
    .filter((range) => !range.isEqual(current))
    .map((range) => adjustCellFoldRange(editor, range));
  if (!ranges.length) return;
  editor.setSelectedBufferRanges(ranges);
  editor.getSelections().forEach((selection) => selection.fold());
  editor.setSelectedBufferRanges(selections);
}
function getEscapeBlankRowsEndRow(editor, end) {
  return end.row === editor.getLastBufferRow() ? end.row : end.row - 1;
}
function prepareCellDecoration(editor) {
  if (!editor.buffer.cellMarkerLayer)
    editor.buffer.cellMarkerLayer = editor.buffer.addMarkerLayer({
      role: "jupyter-cells-breakpoints",
    });
  editor.decorateMarkerLayer(editor.buffer.cellMarkerLayer, {
    type: "line",
    class: "jupyter-cells-breakpoint",
  });
}
async function updateCellMarkers(editor) {
  const index = await refreshIndex(editor);
  if (editor.isDestroyed?.()) return [];
  const breakpoints = index?.markers.map((marker) => marker.start.copy()) ?? [];
  if (editor.buffer.cellMarkerLayer) {
    editor.buffer.cellMarkerLayer.clear();
    for (const position of breakpoints)
      editor.buffer.cellMarkerLayer.markRange([position, [position.row, Infinity]], {
        invalidate: "surround",
        exclusive: true,
      });
  }
  return breakpoints;
}
function destroyCellMarkers(editor) {
  editor.buffer.cellMarkerLayer?.destroy();
  delete editor.buffer.cellMarkerLayer;
}
module.exports = {
  isMultilanguageGrammar,
  isIPythonDocument,
  getEmbeddedScope,
  normalizeString,
  getTextInRange,
  getRows,
  isComment,
  isBlank,
  escapeBlankRows,
  getCommentStartString,
  getRegexString,
  getMarkerIndex,
  refreshIndex,
  getCellDescriptors,
  getExecutionBlocks,
  getBreakpoints,
  getCell,
  getCurrentCell,
  getCells,
  foldCurrentCell,
  foldAllButCurrentCell,
  getEscapeBlankRowsEndRow,
  prepareCellDecoration,
  updateCellMarkers,
  destroyCellMarkers,
  onDidUpdate: (fn) => updates.on("did-update", fn),
};
