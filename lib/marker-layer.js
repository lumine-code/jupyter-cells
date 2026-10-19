const { Disposable } = require("lumine");

// The `marker.layer` provider: cell boundaries on the overview maps.
//
// Fed by the same `jupyter.cells` service this package provides — main.js
// connects the two directly rather than through the service hub, so the layer
// sees exactly what an external consumer would.
module.exports = {
  activate() {
    this.cellsService = null;
    this.connection = null;
    // One layer per editor, guaranteed by the marker hub; the boundary list
    // lives in the layer cache.
    this.editors = new Map();
  },

  deactivate() {
    this.cellsService = null;
    this.connection = null;
    for (const layer of this.editors?.values() || []) layer.cache.get("bufferMarkers")?.destroy();
    this.editors?.clear();
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
    const points = data || [];
    const anchors = layer.cache.get("anchors") || [];
    const unchanged =
      anchors.length === points.length &&
      points.every(
        (point, index) =>
          anchors[index].sourcePoint === point &&
          anchors[index].sourceRow === point.row &&
          anchors[index].sourceColumn === point.column,
      );
    if (!unchanged) {
      const bufferMarkers = layer.cache.get("bufferMarkers");
      bufferMarkers.clear();
      layer.cache.set(
        "anchors",
        points.map((point) => ({
          sourcePoint: point,
          sourceRow: point.row,
          sourceColumn: point.column,
          marker: bufferMarkers.markPosition(point, { invalidate: "never" }),
        })),
      );
    }
    layer.cache.set("data", points);
    layer.update();
  },

  connect(cellsService) {
    const connection = {};
    this.connection = connection;
    this.cellsService = cellsService;
    // Update existing editors
    for (const editor of this.editors.keys()) {
      this.setBreakpoints(editor, this.breakpoints(editor));
    }
    let subscription = cellsService.onDidUpdate?.(({ editor, breakpoints }) => {
      if (this.connection !== connection) return;
      if (!editor) return;
      this.setBreakpoints(editor, breakpoints);
    });
    return new Disposable(() => {
      subscription?.dispose();
      if (this.connection !== connection) return;
      this.connection = null;
      this.cellsService = null;
      for (const editor of this.editors.keys()) {
        this.setBreakpoints(editor, []);
      }
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
        const bufferMarkers = layer.editor.getBuffer().addMarkerLayer({
          maintainHistory: false,
          role: "jupyter-cells-overview-anchors",
        });
        layer.cache.set("bufferMarkers", bufferMarkers);
        layer.disposables.add(
          new Disposable(() => {
            if (this.editors.get(layer.editor) === layer) this.editors.delete(layer.editor);
            bufferMarkers.destroy();
          }),
        );
        this.setBreakpoints(layer.editor, this.breakpoints(layer.editor));
      },
      getItems: ({ editor, cache }) => {
        const items = [];
        for (const { marker } of cache.get("anchors") || []) {
          if (!marker.isDestroyed()) {
            items.push({
              row: editor.screenPositionForBufferPosition(marker.getStartPosition()).row,
            });
          }
        }
        return items;
      },
    };
  },
};
