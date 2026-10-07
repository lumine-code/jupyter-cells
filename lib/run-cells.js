const { Point, Range } = require("lumine");
const cells = require("./cells");
const services = require("./services");
const captureRequest = require("./command-request");

function terminateEditorPendingState(editor) {
  if (!editor || editor.isDestroyed?.()) return;
  const pane = lumine.workspace.paneForItem(editor);
  if (pane?.getPendingItem?.() === editor) pane.clearPendingItem();
  else editor.terminatePendingState?.();
}

function missingExecution() {
  lumine.notifications.addWarning("Running cells needs the jupyter-repl package", {
    description:
      "jupyter-cells computes the cells; the jupyter-repl package owns the kernels that run them. Install it to run cells.",
  });
}

async function blockForCell(editor, cell) {
  if (!cell) return null;
  const range = Range.fromObject(cell);
  if (range.isEmpty()) return null;
  return (await cells.getExecutionBlocks(editor, range))[0] ?? null;
}

function refuseMultilanguage(editor, label) {
  if (!cells.isMultilanguageGrammar(editor.getGrammar())) return false;
  lumine.notifications.addError(`"${label}" is not supported for this file type!`);
  return true;
}

async function run(editor, scope, { moveDown = false, restart = false, item } = {}) {
  terminateEditorPendingState(editor);
  const request = captureRequest(editor, item);
  const adapter = services.getAdapter(request.item);
  // Capture target identities and source before service activation. A later
  // focus change cannot redirect the invocation into a different notebook.
  const targets = adapter?.getRunTargets(scope);
  const owner = adapter?.getKernelOwner();
  try {
    let blocks;
    if (!adapter) {
      if (!editor) return;
      if (
        scope !== "active" &&
        refuseMultilanguage(editor, scope === "all" ? "Run All" : "Run All Above")
      )
        return;
      if (scope === "active") {
        await cells.refreshIndex(editor);
        if (!request.current()) return;
        const range = cells.isMultilanguageGrammar(editor.getGrammar())
          ? cells.getCurrentCell(editor, request.position)
          : cells.getCell(editor, request.position);
        const block = await blockForCell(editor, range);
        blocks = block ? [block] : [];
      } else {
        blocks = await cells.getExecutionBlocks(
          editor,
          scope === "above" ? [new Point(0, 0), new Point(request.position.row + 1, 0)] : undefined,
        );
      }
    }
    if (!request.current() || owner?.isDestroyed?.()) return;
    if (!adapter && !blocks?.length) return;
    const execution = await services.requestExecution();
    if (
      !request.current() ||
      owner?.isDestroyed?.() ||
      (execution && execution !== services.getExecution())
    )
      return;
    if (!execution) return missingExecution();
    if (
      adapter &&
      targets.some((target) => adapter.getRunTarget(target.id)?.source !== target.source)
    )
      return;
    return await execution.execute({
      item: request.item,
      ...(adapter ? { owner, targets } : { editor, blocks }),
      scope,
      moveDown,
      restart,
      clear: restart,
    });
  } finally {
    request.dispose();
  }
}

module.exports = {
  blockForCell,
  missingExecution,
  runCell: (editor, moveDown = false, item) => run(editor, "active", { moveDown, item }),
  runAll: (editor, item) => run(editor, "all", { item }),
  runAllAbove: (editor, item) => run(editor, "above", { item }),
  recalculateAll: (editor, item) => run(editor, "all", { item, restart: true }),
  recalculateAllAbove: (editor, item) => run(editor, "above", { item, restart: true }),
};
