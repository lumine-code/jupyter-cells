const { Disposable } = require("lumine");

// The `marker.layer` provider: cell boundaries on the overview maps.
//
// Fed by the same `jupyter.cells` service this package provides — main.js
// connects the two directly rather than through the service hub, so the layer
// sees exactly what an external consumer would.
module.exports = {
  activate() {
    this.cellsService = null;
    // One layer per editor, guaranteed by the marker hub; the boundary list
    // lives in the layer cache.
    this.editors = new Map();
  },

  deactivate() {
    this.cellsService = null;
    this.editors.clear();
  },

  breakpoints(editor) {
    if (!this.cellsService) {
      return [];
    }
    return this.cellsService.initBreakpoints?.(editor) || [];
  },

  setBreakpoints(editor, data) {
    const layer = this.editors.get(editor);
    if (!layer) return;
    layer.cache.set("data", data);
    layer.update();
  },

  connect(cellsService) {
    this.cellsService = cellsService;
    // Update existing editors
    for (const editor of this.editors.keys()) {
      this.setBreakpoints(editor, this.breakpoints(editor));
    }
    let subscription = cellsService.onDidUpdate?.(({ editor, breakpoints }) => {
      if (!editor) return;
      this.setBreakpoints(editor, breakpoints);
    });
    return new Disposable(() => {
      this.cellsService = null;
      subscription?.dispose();
    });
  },

  provideMarkerLayer() {
    return {
      name: "jupyter-cells",
      description: "Jupyter cell markers",
      enabled: "jupyter-cells.marker.enabled",
      threshold: "jupyter-cells.marker.threshold",
      initialize: (layer) => {
        this.editors.set(layer.editor, layer);
        layer.cache.set("data", this.breakpoints(layer.editor));
        layer.disposables.add(
          new Disposable(() => {
            this.editors.delete(layer.editor);
          }),
        );
      },
      getItems: ({ editor, cache }) => {
        const data = cache.get("data") || [];
        return data.map((breakpoint) => ({
          row: editor.screenPositionForBufferPosition(breakpoint).row,
        }));
      },
    };
  },
};
