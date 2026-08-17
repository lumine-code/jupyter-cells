const { Range } = require("lumine");
const { getRegexString, getCommentStartString } = require("./cells");

// Navigation, selection and reordering over the cell markers. Every function
// takes the editor it acts on; a grammar with no comment syntax has no cells,
// so every entry point returns silently when the marker regex cannot exist.

function cellRegex(editor) {
  const regexString = getRegexString(editor);
  return regexString ? new RegExp(regexString, "g") : null;
}

// The `%%` marker line in the editor's own comment syntax, for the reordering
// commands that must invent a boundary where none exists.
function markerText(editor) {
  const commentStartString = getCommentStartString(editor);
  return `${commentStartString ?? "#"} %%\n`;
}

function rowEnd(editor, row) {
  return editor.buffer.rangeForRow(row).end;
}

function cursorRowEnd(editor) {
  return rowEnd(editor, editor.getCursorBufferPosition().row);
}

function cellRange(editor, cellregex) {
  let bufferEnd, endPos, lowerCellPos, lowerRange, startRow, upperCellPos, upperRange;
  bufferEnd = editor.buffer.getEndPosition();
  startRow = editor.getSelectedBufferRange().start.row;
  upperRange = new Range([0, 0], rowEnd(editor, startRow));
  endPos = editor.getSelectedBufferRange().end;
  if (startRow === endPos.row) {
    endPos = rowEnd(editor, endPos.row);
  }
  lowerRange = new Range(endPos, bufferEnd);
  upperCellPos = [0, 0];
  lowerCellPos = bufferEnd;
  editor.backwardsScanInBufferRange(cellregex, upperRange, (match) => {
    upperCellPos = match.range.start;
    return match.stop();
  });
  editor.scanInBufferRange(cellregex, lowerRange, (match) => {
    lowerCellPos = match.range.start;
    return match.stop();
  });
  return new Range(upperCellPos, lowerCellPos);
}

function getCellRows(editor, cellregex, range, funcName) {
  let cellRows, maxRow;
  cellRows = [];
  maxRow = {
    scanInBufferRange: 0,
    backwardsScanInBufferRange: 1,
  };
  editor[funcName](cellregex, range, (match) => {
    cellRows.push(match.range.start.row);
    if (cellRows.length > maxRow[funcName]) {
      return match.stop();
    }
  });
  return cellRows;
}

function reverseSelect(editor, range) {
  return editor.setSelectedBufferRange(range, {
    reversed: true,
  });
}

function selectCell(editor) {
  const cellregex = cellRegex(editor);
  if (!cellregex) {
    return;
  }
  return reverseSelect(editor, cellRange(editor, cellregex));
}

function selectDown(editor) {
  const cellregex = cellRegex(editor);
  if (!cellregex) {
    return;
  }
  const currentRange = cellRange(editor, cellregex);
  editor.setCursorBufferPosition(currentRange.end);
  const downRange = cellRange(editor, cellregex);
  return editor.setSelectedBufferRange([currentRange.start, downRange.end]);
}

function selectUp(editor) {
  const cellregex = cellRegex(editor);
  if (!cellregex) {
    return;
  }
  const currentRange = cellRange(editor, cellregex);
  let upRow = currentRange.start.row - 1;
  if (upRow < 0) {
    upRow = 0;
  }
  editor.setCursorBufferPosition([upRow, 0]);
  const upRange = cellRange(editor, cellregex);
  return reverseSelect(editor, [upRange.start, currentRange.end]);
}

function nextCell(editor) {
  const cellregex = cellRegex(editor);
  if (!cellregex) {
    return;
  }
  const bufferEnd = editor.buffer.getEndPosition();
  const range = new Range(cursorRowEnd(editor), bufferEnd);
  const cellRows = getCellRows(editor, cellregex, range, "scanInBufferRange");
  if (cellRows.length === 0) {
    return;
  }
  if (cellRows[0] === bufferEnd.row) {
    return;
  }
  return editor.setCursorBufferPosition([cellRows[0] + 1, 0]);
}

function previousCell(editor) {
  const cellregex = cellRegex(editor);
  if (!cellregex) {
    return;
  }
  const range = new Range([0, 0], cursorRowEnd(editor));
  const cellRows = getCellRows(editor, cellregex, range, "backwardsScanInBufferRange");
  if (cellRows.length === 0) {
    return;
  }
  if (cellRows.length === 1) {
    if (cellRows[0] === 0) {
      return;
    } else {
      return editor.setCursorBufferPosition([0, 0]);
    }
  }
  return editor.setCursorBufferPosition([cellRows[1] + 1, 0]);
}

function moveCellUp(editor) {
  const cellregex = cellRegex(editor);
  if (!cellregex) {
    return;
  }
  const cellrange = cellRange(editor, cellregex);
  if (cellrange.start.row === 0) {
    return reverseSelect(editor, cellrange);
  }
  const range = new Range([0, 0], cellrange.start);
  let insertPos = [0, 0];
  editor.backwardsScanInBufferRange(cellregex, range, (match) => {
    insertPos = match.range.start;
    return match.stop();
  });
  return editor.transact(() => {
    let txt = editor.getTextInBufferRange(cellrange);
    if (!txt.endsWith("\n")) {
      txt += "\n";
    }
    editor.buffer.delete(cellrange);
    if (insertPos[0] === 0 && editor.buffer.lineForRow(0).search(cellregex) !== 0) {
      // The cell moved above the preamble, which now needs the boundary the
      // moved cell used to sit under.
      editor.buffer.insert(insertPos, markerText(editor));
    }
    editor.setCursorBufferPosition(insertPos);
    const insertRanges = editor.insertText(txt);
    return reverseSelect(editor, insertRanges[0]);
  });
}

function moveCellDown(editor) {
  const cellregex = cellRegex(editor);
  if (!cellregex) {
    return;
  }
  const cellrange = cellRange(editor, cellregex);
  const bufferEnd = editor.buffer.getEndPosition();
  if (cellrange.end.row === bufferEnd.row) {
    return reverseSelect(editor, cellrange);
  }
  const searchStart = editor.buffer.rangeForRow(cellrange.end.row).end;
  const range = new Range(searchStart, bufferEnd);
  let insertPos = bufferEnd;
  editor.scanInBufferRange(cellregex, range, (match) => {
    insertPos = match.range.start;
    return match.stop();
  });
  return editor.transact(() => {
    let txt = editor.getTextInBufferRange(cellrange);
    if (txt.search(cellregex) !== 0) {
      // The preamble is moving down; it needs a boundary of its own to stay a
      // cell where it lands.
      txt = markerText(editor) + txt;
    }
    editor.setCursorBufferPosition(insertPos);
    if (bufferEnd.column !== 0) {
      editor.buffer.append("\n");
    }
    const insertRanges = editor.insertText(txt);
    reverseSelect(editor, insertRanges[0]);
    return editor.buffer.delete(cellrange);
  });
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
