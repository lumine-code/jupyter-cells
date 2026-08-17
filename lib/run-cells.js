const { Point } = require("lumine");
const cells = require("./cells");
const services = require("./services");

// The cell-run commands: compute {code, row, cellType} blocks from the marker
// model and hand them to jupyter-repl's execution service. Every handler tries
// the adapter route first — a notebook pane owns its own runs, and that is
// what keeps one keystroke meaningful there and in a text editor alike.

// A tab still in pending (italic) state is being committed to by running it.
function terminateEditorPendingState(editor) {
  if (!editor || editor.isDestroyed?.()) {
    return;
  }

  const pane = lumine.workspace.paneForItem(editor);
  if (pane?.getPendingItem?.() === editor) {
    pane.clearPendingItem();
    return;
  }

  editor.terminatePendingState?.();
}

function missingExecution() {
  lumine.notifications.addWarning("Running cells needs the jupyter-repl package", {
    description:
      "jupyter-cells computes the cells; the jupyter-repl package owns the kernels that run them. Install it to run cells.",
  });
}

// The block a cell range runs as, or null for a cell with nothing in it.
function blockForCell(editor, cell) {
  const { start, end } = cell;
  const codeNullable = cells.getTextInRange(editor, start, end);
  if (codeNullable === null) {
    return null;
  }
  const row = cells.escapeBlankRows(editor, start.row, cells.getEscapeBlankRowsEndRow(editor, end));
  const cellType = cells.getMetadataForRow(editor, start);
  const code =
    cellType === "markdown" ? cells.removeCommentsMarkdownCell(editor, codeNullable) : codeNullable;
  return { code, row, cellType };
}

function refuseMultilanguage(editor, label) {
  if (!cells.isMultilanguageGrammar(editor.getGrammar())) {
    return false;
  }
  lumine.notifications.addError(`"${label}" is not supported for this file type!`);
  return true;
}

function runCell(editor, moveDown = false) {
  terminateEditorPendingState(editor);
  const execution = services.getExecution();
  if (execution?.runAdapter("active", moveDown)) {
    return;
  }
  if (!editor) {
    return;
  }
  if (!execution) {
    return missingExecution();
  }
  // Capture the cell before anything moves the cursor: starting a kernel can
  // take long enough for the user to be somewhere else by the time it answers.
  const block = blockForCell(editor, cells.getCurrentCell(editor));
  if (!block) {
    return;
  }
  if (moveDown) {
    execution.moveDown(editor, block.row);
  }
  execution.runBlocks(editor, [block]);
}

function runAll(editor) {
  terminateEditorPendingState(editor);
  const execution = services.getExecution();
  if (execution?.runAdapter("all")) {
    return;
  }
  if (!editor) {
    return;
  }
  if (!execution) {
    return missingExecution();
  }
  if (refuseMultilanguage(editor, "Run All")) {
    return;
  }
  const blocks = cells
    .getCells(editor)
    .map((cell) => blockForCell(editor, cell))
    .filter(Boolean);
  if (!blocks.length) {
    return;
  }
  execution.runBlocks(editor, blocks);
}

function runAllAbove(editor) {
  terminateEditorPendingState(editor);
  const execution = services.getExecution();
  if (execution?.runAdapter("above")) {
    return;
  }
  if (!editor) {
    return;
  }
  if (!execution) {
    return missingExecution();
  }
  if (refuseMultilanguage(editor, "Run All Above")) {
    return;
  }
  const cursor = editor.getCursorBufferPosition();
  const breakpoints = cells.getBreakpoints(editor);
  // An extra boundary right below the cursor truncates the cursor's own cell
  // at the cursor row, which is what "above" has always meant here.
  breakpoints.push(new Point(cursor.row + 1, 0));
  const blocks = [];
  for (const cell of cells.getCells(editor, breakpoints)) {
    const block = blockForCell(editor, cell);
    if (block) {
      blocks.push(block);
    }
    if (cell.containsPoint(cursor)) {
      break;
    }
  }
  if (!blocks.length) {
    return;
  }
  execution.runBlocks(editor, blocks);
}

function clearAndCenter(editor, execution) {
  execution.clearResults();
  editor.scrollToCursorPosition();
}

function recalculateAll(editor) {
  if (!editor) {
    return;
  }
  terminateEditorPendingState(editor);
  const execution = services.getExecution();
  if (!execution) {
    return missingExecution();
  }
  clearAndCenter(editor, execution);
  execution.restartKernel(() => {
    runAll(editor);
  });
}

function recalculateAllAbove(editor) {
  if (!editor) {
    return;
  }
  terminateEditorPendingState(editor);
  const execution = services.getExecution();
  if (!execution) {
    return missingExecution();
  }
  clearAndCenter(editor, execution);
  execution.restartKernel(() => {
    runAllAbove(editor);
  });
}

module.exports = {
  blockForCell,
  runCell,
  runAll,
  runAllAbove,
  recalculateAll,
  recalculateAllAbove,
};
