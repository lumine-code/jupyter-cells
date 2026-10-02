const { Point, Range } = require("lumine");
const cells = require("./cells");
const services = require("./services");
const captureRequest = require("./command-request");

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
async function blockForCell(editor, cell) {
  if (!cell) return null;
  const range = Range.fromObject(cell);
  // An empty cell body can coincide with the next header. An empty range is
  // also the preparation API's cursor locator, so passing it would run the
  // following cell rather than the empty one selected by this command.
  if (range.isEmpty()) return null;
  return (await cells.getExecutionBlocks(editor, range))[0] ?? null;
}

function refuseMultilanguage(editor, label) {
  if (!cells.isMultilanguageGrammar(editor.getGrammar())) {
    return false;
  }
  lumine.notifications.addError(`"${label}" is not supported for this file type!`);
  return true;
}

async function runCell(editor, moveDown = false) {
  terminateEditorPendingState(editor);
  const request = captureRequest(editor);
  try {
    const execution = await services.requestExecution();
    if (!request.current()) return;
    if (request.adapterCurrent() && execution?.runAdapter("active", moveDown)) {
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
    await cells.refreshIndex(editor);
    if (!request.current() || execution !== services.getExecution()) return;
    const range = cells.isMultilanguageGrammar(editor.getGrammar())
      ? cells.getCurrentCell(editor, request.position)
      : cells.getCell(editor, request.position);
    const block = await blockForCell(editor, range);
    if (!request.current() || execution !== services.getExecution()) return;
    if (!block) {
      return;
    }
    if (moveDown) {
      execution.moveDown(editor, block.row);
    }
    return await execution.runBlocks(editor, [block]);
  } finally {
    request.dispose();
  }
}

async function runAll(editor, request = captureRequest(editor)) {
  terminateEditorPendingState(editor);
  try {
    const execution = await services.requestExecution();
    if (!request.current()) return;
    if (request.adapterCurrent() && execution?.runAdapter("all")) return;
    if (!editor) return;
    if (!execution) return missingExecution();
    if (refuseMultilanguage(editor, "Run All")) return;
    const blocks = await cells.getExecutionBlocks(editor);
    if (!request.current() || execution !== services.getExecution() || !blocks.length) return;
    return await execution.runBlocks(editor, blocks);
  } finally {
    request.dispose();
  }
}

async function runAllAbove(editor, request = captureRequest(editor)) {
  terminateEditorPendingState(editor);
  try {
    const execution = await services.requestExecution();
    if (!request.current()) return;
    if (request.adapterCurrent() && execution?.runAdapter("above")) {
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
    const cursor = request.position;
    const blocks = await cells.getExecutionBlocks(editor, [
      new Point(0, 0),
      new Point(cursor.row + 1, 0),
    ]);
    if (!request.current() || execution !== services.getExecution()) return;
    if (!blocks.length) {
      return;
    }
    return await execution.runBlocks(editor, blocks);
  } finally {
    request.dispose();
  }
}

async function recalculateAll(editor) {
  return recalculate(editor, runAll);
}

async function recalculateAllAbove(editor) {
  return recalculate(editor, runAllAbove);
}

async function recalculate(editor, run) {
  if (!editor) return;
  terminateEditorPendingState(editor);
  const request = captureRequest(editor);
  try {
    const execution = await services.requestExecution();
    if (!request.current()) return;
    if (!execution) return missingExecution();
    // Kernel control methods act on the active context. Do not restart a
    // different notebook after asynchronous service activation.
    if (!request.adapterCurrent()) return;
    execution.clearResults();
    let running = null;
    await execution.restartKernel(() => {
      if (request.current() && execution === services.getExecution())
        running = run(editor, request);
    });
    if (running) await running;
  } finally {
    request.dispose();
  }
}

module.exports = {
  blockForCell,
  missingExecution,
  runCell,
  runAll,
  runAllAbove,
  recalculateAll,
  recalculateAllAbove,
};
