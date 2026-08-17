const { Emitter, CompositeDisposable, Point } = require("lumine");
const cells = require("./cells");
const services = require("./services");
const { blockForCell } = require("./run-cells");

// Serves the code-lens.provider contract with a run link per cell marker.
// Lenses are emitted only while both gates hold — the jupyter-cells.codeLenses
// setting and a live execution service — so a link that could do nothing is
// never rendered. Every lens ships complete (no resolveCodeLens): the titles
// are static, and only the click computes anything.
module.exports = class CodeLensProvider {
  constructor() {
    this.emitter = new Emitter();
    this.subscriptions = new CompositeDisposable(
      lumine.config.onDidChange("jupyter-cells.codeLenses", () => this.invalidate()),
    );
  }

  onDidInvalidate(fn) {
    return this.emitter.on("invalidate", fn);
  }

  // Called on config flips and when the execution service arrives or leaves.
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
    const execution = services.getExecution();
    if (!execution) {
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

  runCellBelow(editor, markerRow) {
    const execution = services.getExecution();
    if (!execution || editor.isDestroyed()) {
      return;
    }
    const block = blockForCell(editor, cells.getCell(editor, new Point(markerRow, 0)));
    if (!block) {
      return;
    }
    return execution.runBlocks(editor, [block]);
  }

  runAllAbove(editor, markerRow) {
    const execution = services.getExecution();
    if (!execution || editor.isDestroyed()) {
      return;
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
