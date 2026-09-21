const { Emitter, CompositeDisposable, Point } = require("lumine");
const cells = require("./cells");
const services = require("./services");
const { blockForCell, missingExecution } = require("./run-cells");

// Serves the code-lens.provider contract with a run link per cell marker.
// Lenses are emitted while the jupyter-cells.codeLenses setting is on. Clicking
// one requests the Jupyter runtime before resolving the execution service, so
// merely opening an editor does not activate jupyter-repl. Every lens ships
// complete (no resolveCodeLens): the titles are static, and only the click
// computes anything.
module.exports = class CodeLensProvider {
  constructor() {
    this.emitter = new Emitter();
    this.subscriptions = new CompositeDisposable(
      lumine.config.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("jupyter-cells.codeLenses")) this.invalidate();
      }),
    );
  }

  onDidInvalidate(fn) {
    return this.emitter.on("invalidate", fn);
  }

  // Called when the setting flips.
  invalidate() {
    this.emitter.emit("invalidate", {});
  }

  enabledFor(editor) {
    return !!lumine.config.get("jupyter-cells.codeLenses", {
      scope: editor.getRootScopeDescriptor(),
    });
  }

  codeLenses(editor) {
    if (!this.enabledFor(editor)) {
      return null;
    }
    // Boundaries without the end-of-file terminator: one lens row per marker.
    const markers = cells.getBreakpoints(editor).slice(0, -1);
    if (!markers.length) {
      return null;
    }
    const cellRanges = cells.getCells(editor);
    const lenses = [];
    for (const marker of markers) {
      const row = marker.row;
      const range = [
        [row, 0],
        [row, editor.lineTextForBufferRow(row).length],
      ];
      lenses.push({
        range,
        title: "Run Cell",
        tooltip: "Run the cell this marker opens.",
        // Computed at click time, not at fetch time: the buffer has usually
        // moved on since the lenses were fetched.
        execute: () => this.runCellBelow(editor, row),
      });
      // Everything before this cell; the first marker of a file with no
      // preamble has nothing above, and gets no dead link.
      if (cellRanges.some((cell) => cell.end.row <= row)) {
        lenses.push({
          range,
          title: "Run All Above",
          tooltip: "Run every cell above this marker.",
          execute: () => this.runAllAbove(editor, row),
        });
      }
    }
    return lenses;
  }

  async runCellBelow(editor, markerRow) {
    if (editor.isDestroyed()) {
      return;
    }
    const execution = await services.requestExecution();
    if (!execution) {
      return missingExecution();
    }
    const block = blockForCell(editor, cells.getCell(editor, new Point(markerRow, 0)));
    if (!block) {
      return;
    }
    return execution.runBlocks(editor, [block]);
  }

  async runAllAbove(editor, markerRow) {
    if (editor.isDestroyed()) {
      return;
    }
    const execution = await services.requestExecution();
    if (!execution) {
      return missingExecution();
    }
    const blocks = cells
      .getCells(editor)
      .filter((cell) => cell.end.row <= markerRow)
      .map((cell) => blockForCell(editor, cell))
      .filter(Boolean);
    if (!blocks.length) {
      return;
    }
    return execution.runBlocks(editor, blocks);
  }

  dispose() {
    this.subscriptions.dispose();
    this.emitter.dispose();
  }
};
