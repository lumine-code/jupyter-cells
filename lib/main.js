const { CompositeDisposable, Disposable } = require("lumine");
const CellMarkers = require("./cell-markers");
const markerLayer = require("./marker-layer");
const services = require("./services");

// A keystroke or a right-click means the editor it came from; the menu and the
// palette mean the active one.
const editorForEvent = (event) =>
  lumine.workspace.getTextEditorForElement(event?.target, { includeMini: false }) ??
  lumine.workspace.getActiveTextEditor() ??
  null;

module.exports = {
  activate() {
    this.cellMarkers = new CellMarkers();
    this.subscriptions = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "jupyter-cells:run-cell": {
          description: "Run the cell holding the cursor.",
          didDispatch: (event) => require("./run-cells").runCell(editorForEvent(event), false),
        },
        "jupyter-cells:run-cell-and-move-down": {
          description: "Run the cell holding the cursor and move on to the next.",
          didDispatch: (event) => require("./run-cells").runCell(editorForEvent(event), true),
        },
        "jupyter-cells:run-all": {
          description: "Run every cell in the file, from the top.",
          didDispatch: (event) => require("./run-cells").runAll(editorForEvent(event)),
        },
        "jupyter-cells:run-all-above": {
          description: "Run every cell above the cursor.",
          didDispatch: (event) => require("./run-cells").runAllAbove(editorForEvent(event)),
        },
        "jupyter-cells:recalculate-all": {
          description: "Restart the kernel, clear the results, and run everything.",
          didDispatch: (event) => require("./run-cells").recalculateAll(editorForEvent(event)),
        },
        "jupyter-cells:recalculate-all-above": {
          description: "Restart the kernel and run everything above the cursor.",
          didDispatch: (event) => require("./run-cells").recalculateAllAbove(editorForEvent(event)),
        },
        "jupyter-cells:go-to-next-cell": {
          description: "Move the cursor to the start of the next cell.",
          didDispatch: (event) => this.withEditor(event, "nextCell"),
        },
        "jupyter-cells:go-to-previous-cell": {
          description: "Move the cursor to the start of the previous cell.",
          didDispatch: (event) => this.withEditor(event, "previousCell"),
        },
        "jupyter-cells:select-cell": {
          description: "Select the whole of the cell holding the cursor.",
          didDispatch: (event) => this.withEditor(event, "selectCell"),
        },
        "jupyter-cells:select-previous-cell": {
          description: "Extend the selection to take in the previous cell.",
          didDispatch: (event) => this.withEditor(event, "selectUp"),
        },
        "jupyter-cells:select-next-cell": {
          description: "Extend the selection to take in the next cell.",
          didDispatch: (event) => this.withEditor(event, "selectDown"),
        },
        "jupyter-cells:move-cell-up": {
          description: "Swap this cell with the one above it.",
          didDispatch: (event) => this.withEditor(event, "moveCellUp"),
        },
        "jupyter-cells:move-cell-down": {
          description: "Swap this cell with the one below it.",
          didDispatch: (event) => this.withEditor(event, "moveCellDown"),
        },
        "jupyter-cells:fold-current-cell": {
          description: "Fold the cell holding the cursor.",
          didDispatch: (event) => {
            const editor = editorForEvent(event);
            if (editor) require("./cells").foldCurrentCell(editor);
          },
        },
        "jupyter-cells:fold-all-but-current-cell": {
          description: "Fold every cell except the one holding the cursor.",
          didDispatch: (event) => {
            const editor = editorForEvent(event);
            if (editor) require("./cells").foldAllButCurrentCell(editor);
          },
        },
        "jupyter-cells:import-notebook": {
          description: "Open an ipynb notebook as a source file.",
          didDispatch: (event) => require("./import-notebook").importNotebook(event),
        },
        "jupyter-cells:export-notebook": {
          description: "Write this file out as an ipynb notebook.",
          didDispatch: (event) =>
            require("./export-notebook").exportNotebook(editorForEvent(event)),
        },
      }),
      lumine.workspace.addOpener((uri) => {
        if (!/\.ipynb$/i.test(uri)) return undefined;
        return require("./import-notebook").ipynbOpener(uri);
      }),
    );
    // The scrollbar/minimap layer consumes the same `jupyter.cells` service
    // this package provides, connected directly rather than through the
    // service hub — the layer sees exactly what an external consumer would.
    markerLayer.activate();
    this.markerLayerConnection = markerLayer.connect(this.provideJupyterCells());
  },

  deactivate() {
    this.subscriptions?.dispose();
    this.subscriptions = null;
    this.markerLayerConnection?.dispose();
    this.markerLayerConnection = null;
    markerLayer.deactivate();
    this.codeLensProvider?.dispose();
    this.codeLensProvider = null;
    this.cellMarkers?.dispose();
    this.cellMarkers = null;
    services.setExecution(null);
    services.setKernel(null);
  },

  withEditor(event, method) {
    const editor = editorForEvent(event);
    if (!editor) {
      return;
    }
    return require("./cell-navi")[method](editor);
  },

  consumeJupyterExecution(execution) {
    services.setExecution(execution);
    // Lenses are gated on the service, so its arrival is what makes them
    // appear without waiting for an edit.
    this.codeLensProvider?.invalidate();
    return new Disposable(() => {
      services.setExecution(null);
      this.codeLensProvider?.invalidate();
    });
  },

  consumeJupyterKernel(kernelProvider) {
    services.setKernel(kernelProvider);
    return new Disposable(() => {
      services.setKernel(null);
    });
  },

  provideJupyterCells() {
    const cells = require("./cells");
    const cellMarkers = this.cellMarkers;
    return {
      getCell: (editor, point) => cells.getCell(editor, point),
      getCurrentCell: (editor) => cells.getCurrentCell(editor),
      getMetadataForRow: (editor, point) => cells.getMetadataForRow(editor, point),
      removeCommentsMarkdownCell: (editor, text) => cells.removeCommentsMarkdownCell(editor, text),
      getBreakpoints: (editor) => {
        if (!editor || !editor.buffer) {
          return [];
        }
        // The boundary list ends with the buffer's end position; the service
        // reports real dividers only.
        return cells.getBreakpoints(editor).slice(0, -1);
      },
      initBreakpoints: (editor) => {
        if (!cellMarkers.isEnabled()) {
          return [];
        }
        if (!editor || !editor.buffer) {
          return [];
        }
        return cells.getBreakpoints(editor).slice(0, -1);
      },
      onDidUpdate: (fn) => cellMarkers.onDidUpdate(fn),
    };
  },

  provideCodeLens() {
    if (!this.codeLensProvider) {
      const CodeLensProvider = require("./code-lens-provider");
      this.codeLensProvider = new CodeLensProvider();
    }
    return this.codeLensProvider;
  },

  provideMarkerLayer() {
    return markerLayer.provideMarkerLayer();
  },

  markerLayer,
};
