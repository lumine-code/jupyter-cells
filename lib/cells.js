const { Point, Range } = require("lumine");

// A cell is a run of buffer between two markers: a comment reading `%%` in the
// grammar's own comment syntax (`# %%`, `// %%`, `%% %%`…), a `<codecell>` tag,
// or an `In[n]` prompt from an exported notebook. Everything in this module is
// derived from the buffer text and the grammar — no kernel anywhere.

// The grammars whose files hold several languages at once (markdown and the
// weave family). Their "cells" are fenced code blocks, not `%%` markers.
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

function isMultilanguageGrammar(grammar) {
  return markupGrammars.has(grammar.scopeName);
}

function getEmbeddedScope(editor, position) {
  const scopes = editor.scopeDescriptorForBufferPosition(position).getScopesArray();
  return scopes.find((scope, i) => {
    return i > 0 ? scope.indexOf("source.") === 0 : false;
  });
}

function escapeStringRegexp(string) {
  if (typeof string !== "string") {
    throw new TypeError("Expected a string");
  }
  return string.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}

function stripIndent(string) {
  const match = string.match(/^[ \t]*(?=\S)/gm);
  if (!match) {
    return string;
  }
  const indent = Math.min(...match.map((x) => x.length));
  if (indent === 0) {
    return string;
  }
  const regex = new RegExp(`^[ \\t]{${indent}}`, "gm");
  return string.replace(regex, "");
}

function normalizeString(code) {
  if (code) {
    return code.replace(/\r\n|\r/g, "\n");
  }

  return null;
}

function getTextInRange(editor, start, end) {
  const code = editor.getTextInBufferRange([start, end]);
  return normalizeString(code);
}

function getRows(editor, startRow, endRow) {
  const code = editor.getTextInBufferRange({
    start: { row: startRow, column: 0 },
    end: { row: endRow, column: 9999999 },
  });
  return normalizeString(code);
}

function isComment(editor, position) {
  const scope = editor.scopeDescriptorForBufferPosition(position);
  const scopeString = scope.getScopeChain();
  return scopeString.includes("comment.line");
}

function isBlank(editor, row) {
  return editor.getBuffer().isRowBlank(row);
}

function escapeBlankRows(editor, startRow, endRow) {
  while (endRow > startRow) {
    if (!isBlank(editor, endRow)) {
      break;
    }
    endRow -= 1;
  }

  return endRow;
}

function getCommentStartString(editor) {
  const result = editor.tokenizedBuffer.commentStringsForPosition(editor.getCursorBufferPosition());

  // An unofficial API, but the only one that answers per position.
  const commentStartString = result?.commentStartString;
  if (!commentStartString) {
    return null;
  }

  return commentStartString.trimRight();
}

function getRegexString(editor) {
  const commentStartString = getCommentStartString(editor);
  if (!commentStartString) {
    return null;
  }
  const escapedCommentStartString = escapeStringRegexp(commentStartString);
  const regexString = `${escapedCommentStartString} *%% *(md|markdown)?| *<(codecell|md|markdown)>| *(In[[0-9 ]*])`;
  return regexString;
}

// -----------------------------------------------------------------------------
// CELL MARKER INDEX
// -----------------------------------------------------------------------------

// One forward scan per buffer state answers every marker query. getCell,
// getMetadataForRow and getBreakpoints each used to regex-sweep the buffer on
// every call — O(file) apiece, which a bulk caller walking every row turned
// into an O(file²) freeze. The index records every match of the cell-marker
// regex in buffer order.
//
// Validity is an edit subscription plus the regex itself, which follows the
// grammar's comment string. A subscription rather than a version number
// because TextBuffer exposes none — there is no `changeCount` on it, and
// comparing a property that does not exist reads as "unchanged" forever.
// `onDidChange` fires synchronously per change, so an index read in the same
// tick as an edit is already stale by the time it is asked for.
//
// Only text-derived facts are cached; scope-dependent ones (isComment) stay
// per-call, since re-tokenization can change them with no edit at all.
const markerIndexCache = new WeakMap();

function getMarkerIndex(editor) {
  const buffer = editor.getBuffer();
  const regexString = getRegexString(editor);
  if (!regexString) {
    return null;
  }

  let index = markerIndexCache.get(buffer);
  if (index && !index.stale && index.regexString === regexString) {
    return index;
  }

  if (!index) {
    index = { stale: true, regexString: null, markers: [] };
    markerIndexCache.set(buffer, index);
    // One subscription for the buffer's life. It is held by the buffer's own
    // emitter, so it is released when the buffer is, and the entry it closes
    // over is reachable only from a WeakMap keyed by that same buffer.
    const subscription = buffer.onDidChange(() => {
      index.stale = true;
    });
    buffer.onDidDestroy?.(() => subscription.dispose());
  }

  const markers = [];
  buffer.scan(new RegExp(regexString, "g"), ({ match, range }) => {
    // The last non-empty capture group decides the type, as the per-call
    // group loop always did.
    let type = "codecell";
    for (let i = 1; i < match.length; i++) {
      if (!match[i]) continue;
      type = match[i] === "md" || match[i] === "markdown" ? "markdown" : "codecell";
    }
    markers.push({ start: range.start, end: range.end, type });
  });

  index.regexString = regexString;
  index.markers = markers;
  index.stale = false;
  return index;
}

// The marker a backwards single-match scan over [(0,0), point] found: the last
// one lying entirely at or before the point. Matches are in buffer order, so
// ends are ascending and the walk can stop at the first marker past the point.
function lastMarkerBefore(markers, point) {
  let found = null;
  for (const marker of markers) {
    if (marker.end.isLessThanOrEqual(point)) {
      found = marker;
    } else {
      break;
    }
  }
  return found;
}

// The marker a forward single-match scan over [point, end] found.
function firstMarkerAtOrAfter(markers, point) {
  for (const marker of markers) {
    if (marker.start.isGreaterThanOrEqual(point)) {
      return marker;
    }
  }
  return null;
}

function getMetadataForRow(editor, anyPointInCell) {
  if (isMultilanguageGrammar(editor.getGrammar())) {
    return "codecell";
  }

  const buffer = editor.getBuffer();
  const point = new Point(anyPointInCell.row, buffer.lineLengthForRow(anyPointInCell.row));
  const index = getMarkerIndex(editor);
  if (!index) {
    return "codecell";
  }
  // The nearest marker above (or on) the row decides the cell type, which is
  // what the backwards single-match scan used to find.
  const marker = lastMarkerBefore(index.markers, point);
  return marker ? marker.type : "codecell";
}

function removeCommentsMarkdownCell(editor, text) {
  const commentStartString = getCommentStartString(editor);
  if (!commentStartString) {
    return text;
  }
  const lines = text.split("\n");
  const editedLines = [];

  lines.forEach((line) => {
    if (line.startsWith(commentStartString)) {
      // Remove comment from start of line
      editedLines.push(line.slice(commentStartString.length));
    } else {
      editedLines.push(line);
    }
  });

  return stripIndent(editedLines.join("\n"));
}

function getBreakpoints(editor) {
  const buffer = editor.getBuffer();
  const breakpoints = [];
  const index = getMarkerIndex(editor);

  if (index) {
    for (const marker of index.markers) {
      if (isComment(editor, marker.start)) {
        breakpoints.push(marker.start.copy());
      }
    }
  }

  breakpoints.push(buffer.getEndPosition());
  return breakpoints;
}

function getCell(editor, anyPointInCell) {
  if (!anyPointInCell) {
    anyPointInCell = editor.getCursorBufferPosition();
  }

  const buffer = editor.getBuffer();
  anyPointInCell = new Point(anyPointInCell.row, buffer.lineLengthForRow(anyPointInCell.row));
  let start = new Point(0, 0);
  let end = buffer.getEndPosition();
  const index = getMarkerIndex(editor);

  if (!index) {
    return new Range(start, end);
  }

  const above = lastMarkerBefore(index.markers, anyPointInCell);
  if (above) {
    start = new Point(above.start.row + 1, 0);
  }

  const below = firstMarkerAtOrAfter(index.markers, anyPointInCell);
  if (below) {
    end = below.start.copy();
  }
  return new Range(start, end);
}

function isEmbeddedCode(editor, referenceScope, row) {
  const scopes = editor.scopeDescriptorForBufferPosition(new Point(row, 0)).getScopesArray();
  return scopes.includes(referenceScope);
}

function getCurrentFencedCodeBlock(editor) {
  const buffer = editor.getBuffer();
  const { row: bufferEndRow } = buffer.getEndPosition();
  const cursor = editor.getCursorBufferPosition();
  let start = cursor.row;
  let end = cursor.row;
  const scope = getEmbeddedScope(editor, cursor);
  if (!scope) {
    return getCell(editor);
  }

  while (start > 0 && isEmbeddedCode(editor, scope, start - 1)) {
    start -= 1;
  }

  while (end < bufferEndRow && isEmbeddedCode(editor, scope, end + 1)) {
    end += 1;
  }

  return new Range([start, 0], [end + 1, 0]);
}

function getCurrentCell(editor) {
  if (isMultilanguageGrammar(editor.getGrammar())) {
    return getCurrentFencedCodeBlock(editor);
  }

  return getCell(editor);
}

function getCells(editor, breakpoints = []) {
  if (breakpoints && breakpoints.length !== 0) {
    breakpoints.sort((a, b) => a.compare(b));
  } else {
    breakpoints = getBreakpoints(editor);
  }

  return getCellsForBreakPoints(editor, breakpoints);
}

function getCellsForBreakPoints(editor, breakpoints) {
  let start = new Point(0, 0);
  // Let start be earliest row with text
  editor.scan(/\S/, (match) => {
    start = new Point(match.range.start.row, 0);
    match.stop();
  });
  return breakpoints
    .map((end) => {
      const cell = end.isEqual(start) ? null : new Range(start, end);
      start = new Point(end.row + 1, 0);
      return cell;
    })
    .filter(Boolean);
}

function foldCurrentCell(editor) {
  const cellRange = getCurrentCell(editor);
  const newRange = adjustCellFoldRange(editor, cellRange);
  editor.setSelectedBufferRange(newRange);
  editor.getSelections()[0].fold();
}

function foldAllButCurrentCell(editor) {
  const initialSelections = editor.getSelectedBufferRanges();
  const allCellRanges = getCells(editor);
  const currentCellRange = getCurrentCell(editor);
  const newRanges = allCellRanges
    .filter((cellRange) => !cellRange.isEqual(currentCellRange))
    .map((cellRange) => adjustCellFoldRange(editor, cellRange));
  // A file with no cell markers is one single cell, so there is nothing else to
  // fold. setSelectedBufferRanges rejects an empty array, so stop here.
  if (newRanges.length === 0) {
    return;
  }
  editor.setSelectedBufferRanges(newRanges);
  editor.getSelections().forEach((selection) => selection.fold());
  // Restore selections
  editor.setSelectedBufferRanges(initialSelections);
}

function adjustCellFoldRange(editor, range) {
  const startRow = range.start.row > 0 ? range.start.row - 1 : 0;
  const startWidth = editor.lineTextForBufferRow(startRow).length;
  const endRow = range.end.row == editor.getLastBufferRow() ? range.end.row : range.end.row - 1;
  const endWidth = editor.lineTextForBufferRow(endRow).length;
  return new Range(new Point(startRow, startWidth), new Point(endRow, endWidth));
}

function getEscapeBlankRowsEndRow(editor, end) {
  return end.row === editor.getLastBufferRow() ? end.row : end.row - 1;
}

function prepareCellDecoration(editor) {
  const buffer = editor.buffer;
  if (!buffer.cellMarkerLayer) {
    buffer.cellMarkerLayer = buffer.addMarkerLayer({
      role: "jupyter-cells-breakpoints",
    });
  }
  editor.decorateMarkerLayer(editor.buffer.cellMarkerLayer, {
    type: "line",
    class: "jupyter-cells-breakpoint",
  });
}

function updateCellMarkers(editor) {
  const buffer = editor.buffer;
  const breakpoints = getBreakpoints(editor).slice(0, -1);
  if (buffer.cellMarkerLayer) {
    buffer.cellMarkerLayer.clear();
    for (const breakpoint of breakpoints) {
      buffer.cellMarkerLayer.markRange([breakpoint, [breakpoint.row, 1e9]], {
        invalidate: "surround",
        exclusive: true,
      });
    }
  }
  return breakpoints;
}

function destroyCellMarkers(editor) {
  const buffer = editor.buffer;
  if (!buffer.cellMarkerLayer) {
    return;
  }
  buffer.cellMarkerLayer.clear();
  buffer.cellMarkerLayer.destroy();
  delete buffer.cellMarkerLayer;
}

module.exports = {
  isMultilanguageGrammar,
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
  getMetadataForRow,
  removeCommentsMarkdownCell,
  getBreakpoints,
  getCell,
  getCurrentCell,
  getCells,
  getCellsForBreakPoints,
  foldCurrentCell,
  foldAllButCurrentCell,
  getEscapeBlankRowsEndRow,
  prepareCellDecoration,
  updateCellMarkers,
  destroyCellMarkers,
};
