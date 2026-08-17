const { CompositeDisposable, Emitter, Point } = require("lumine");

describe("jupyter-cells marker layer", () => {
  let workspaceElement, editor, mainModule, markerLayer;

  beforeEach(async () => {
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    editor = await lumine.workspace.open();
    editor.setText(Array(30).fill("lorem ipsum").join("\n"));
    const pack = await lumine.packages.activatePackage("jupyter-cells");
    mainModule = pack.mainModule;
    markerLayer = mainModule.markerLayer;
    // Activation connected the layer to the package's own jupyter.cells
    // service; the specs below connect fakes, so that wiring has to go first.
    mainModule.markerLayerConnection.dispose();
  });

  function createCellsService(breakpointsByEditor) {
    const emitter = new Emitter();
    return {
      emitter,
      getBreakpoints: (serviceEditor) => breakpointsByEditor.get(serviceEditor) || [],
      initBreakpoints: (serviceEditor) => breakpointsByEditor.get(serviceEditor) || [],
      onDidUpdate: (callback) => emitter.on("did-update", callback),
    };
  }

  // The data half of a host's layer, which is the only half a provider sees.
  function createLayer(provider, layerEditor = editor) {
    const layer = {
      editor: layerEditor,
      props: provider,
      cache: new Map(),
      items: [],
      disposables: new CompositeDisposable(),
      update: jasmine.createSpy("update"),
    };
    provider.initialize(layer);
    return layer;
  }

  describe("activation", () => {
    it("wires the layer to the package's own cells service", () => {
      expect(lumine.packages.isPackageActive("jupyter-cells")).toBe(true);
      expect(mainModule.markerLayerConnection).toBeDefined();
    });
  });

  describe("jupyter.cells service connection", () => {
    it("returns no breakpoints when no service is connected", () => {
      expect(markerLayer.breakpoints(editor)).toEqual([]);
    });

    it("reads initial breakpoints from the connected service", () => {
      const points = [new Point(2, 0), new Point(10, 0)];
      const service = createCellsService(new Map([[editor, points]]));
      const disposable = markerLayer.connect(service);

      expect(markerLayer.breakpoints(editor)).toEqual(points);

      disposable.dispose();
    });

    it("seeds existing jupyter-cells layers on connection", () => {
      const points = [new Point(4, 0)];
      const layer = createLayer(mainModule.provideMarkerLayer());

      const service = createCellsService(new Map([[editor, points]]));
      const disposable = markerLayer.connect(service);

      expect(layer.cache.get("data")).toEqual(points);
      expect(layer.update).toHaveBeenCalled();

      layer.disposables.dispose();
      disposable.dispose();
    });

    it("pushes fresh breakpoints into the layer on service updates", () => {
      const layer = createLayer(mainModule.provideMarkerLayer());

      const service = createCellsService(new Map());
      const disposable = markerLayer.connect(service);
      layer.update.calls.reset();

      const breakpoints = [new Point(7, 0), new Point(15, 0)];
      service.emitter.emit("did-update", { editor, breakpoints });

      expect(layer.cache.get("data")).toEqual(breakpoints);
      expect(layer.update).toHaveBeenCalled();

      layer.disposables.dispose();
      disposable.dispose();
    });

    it("detaches the service on disposal", () => {
      const service = createCellsService(new Map([[editor, [new Point(1, 0)]]]));
      const disposable = markerLayer.connect(service);
      expect(markerLayer.cellsService).toBe(service);

      disposable.dispose();
      expect(markerLayer.cellsService).toBe(null);
      expect(markerLayer.breakpoints(editor)).toEqual([]);
    });
  });

  describe("marker.layer service provider", () => {
    let provider;

    beforeEach(() => {
      provider = mainModule.provideMarkerLayer();
    });

    it("describes the jupyter-cells layer", () => {
      expect(provider.name).toBe("jupyter-cells");
      expect(provider.enabled).toBe("jupyter-cells.marker.enabled");
      expect(provider.threshold).toBe("jupyter-cells.marker.threshold");
      expect(typeof provider.initialize).toBe("function");
      expect(typeof provider.getItems).toBe("function");
    });

    it("seeds the cache with current breakpoints on initialize", () => {
      const points = [new Point(3, 0)];
      const service = createCellsService(new Map([[editor, points]]));
      const disposable = markerLayer.connect(service);

      const layer = createLayer(provider);
      expect(layer.cache.get("data")).toEqual(points);

      layer.disposables.dispose();
      disposable.dispose();
    });

    it("maps breakpoints to marker rows", () => {
      const layer = createLayer(provider);
      layer.cache.set("data", [new Point(2, 0), new Point(12, 0)]);

      expect(provider.getItems(layer)).toEqual([{ row: 2 }, { row: 12 }]);
    });

    it("returns no items without cached data", () => {
      const layer = createLayer(provider);
      expect(provider.getItems(layer)).toEqual([]);
    });

    it("forgets the editor when its layer detaches", () => {
      const layer = createLayer(provider);
      const service = createCellsService(new Map());
      const disposable = markerLayer.connect(service);
      layer.disposables.dispose();
      layer.update.calls.reset();

      const breakpoints = [new Point(9, 0)];
      service.emitter.emit("did-update", { editor, breakpoints });

      expect(layer.cache.get("data")).toEqual([]);
      expect(layer.update).not.toHaveBeenCalled();

      disposable.dispose();
    });
  });
});
