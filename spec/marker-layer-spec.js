const { CompositeDisposable, Emitter, Point } = require("lumine");

describe("jupyter-cells marker layer", () => {
  let workspaceElement, editor, mainModule, markerLayer, attached;

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
    attached = [];
  });

  afterEach(() => {
    for (const layer of attached) layer.disposables.dispose();
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
    attached.push(layer);
    return layer;
  }

  describe("activation", () => {
    it("can deactivate before the marker runtime has activated", () => {
      const uninitialized = { deactivate: markerLayer.deactivate };
      expect(() => uninitialized.deactivate()).not.toThrow();
    });

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
      const layer = createLayer(mainModule.provideMarkerLayer());
      const service = createCellsService(new Map([[editor, [new Point(1, 0)]]]));
      const disposable = markerLayer.connect(service);
      expect(markerLayer.cellsService).toBe(service);
      layer.update.calls.reset();
      const bufferMarkers = layer.cache.get("bufferMarkers");
      expect(bufferMarkers.getMarkers().length).toBe(1);

      disposable.dispose();
      expect(markerLayer.cellsService).toBe(null);
      expect(markerLayer.breakpoints(editor)).toEqual([]);
      expect(layer.cache.get("data")).toEqual([]);
      expect(bufferMarkers.getMarkers()).toEqual([]);
      expect(layer.update).toHaveBeenCalledTimes(1);

      layer.disposables.dispose();
    });

    it("ignores updates and disposal from a replaced service connection", () => {
      const layer = createLayer(mainModule.provideMarkerLayer());
      const firstService = createCellsService(new Map([[editor, [new Point(2, 0)]]]));
      const nextPoints = [new Point(6, 0)];
      const nextService = createCellsService(new Map([[editor, nextPoints]]));
      const firstConnection = markerLayer.connect(firstService);
      const nextConnection = markerLayer.connect(nextService);
      layer.update.calls.reset();

      firstService.emitter.emit("did-update", { editor, breakpoints: [new Point(3, 0)] });
      firstConnection.dispose();

      expect(markerLayer.cellsService).toBe(nextService);
      expect(layer.cache.get("data")).toEqual(nextPoints);
      expect(layer.update).not.toHaveBeenCalled();

      nextConnection.dispose();
      expect(layer.cache.get("data")).toEqual([]);
      expect(layer.update).toHaveBeenCalledTimes(1);

      layer.disposables.dispose();
    });

    it("keeps a newer connection when the same service object reconnects", () => {
      const points = [new Point(3, 0)];
      const layer = createLayer(mainModule.provideMarkerLayer());
      const service = createCellsService(new Map([[editor, points]]));
      const firstConnection = markerLayer.connect(service);
      const nextConnection = markerLayer.connect(service);
      layer.update.calls.reset();

      firstConnection.dispose();

      expect(markerLayer.cellsService).toBe(service);
      expect(layer.cache.get("data")).toEqual(points);
      expect(layer.update).not.toHaveBeenCalled();

      nextConnection.dispose();
      layer.disposables.dispose();
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
      markerLayer.setBreakpoints(editor, [new Point(2, 0), new Point(12, 0)]);

      expect(provider.getItems(layer)).toEqual([{ row: 2 }, { row: 12 }]);
    });

    it("tracks repeated newline edits before the next parser result without polling the producer", () => {
      const points = [new Point(4, 0)];
      const layer = createLayer(provider);
      const service = createCellsService(new Map([[editor, points]]));
      spyOn(service, "initBreakpoints").and.callThrough();
      const disposable = markerLayer.connect(service);
      const stopped = jasmine.createSpy("stopped");
      const stopSubscription = editor.onDidStopChanging(stopped);

      editor.getBuffer().insert([0, 0], "\n");
      expect(provider.getItems(layer)).toEqual([{ row: 5 }]);
      editor.getBuffer().insert([0, 0], "\n");
      expect(provider.getItems(layer)).toEqual([{ row: 6 }]);
      expect(service.initBreakpoints).toHaveBeenCalledTimes(1);
      expect(stopped).not.toHaveBeenCalled();
      expect(points[0].row).toBe(4);

      service.emitter.emit("did-update", { editor, breakpoints: points });
      expect(provider.getItems(layer)).toEqual([{ row: 6 }]);

      const oldAnchor = layer.cache.get("anchors")[0].marker;
      service.emitter.emit("did-update", { editor, breakpoints: [new Point(8, 0)] });
      expect(oldAnchor.isDestroyed()).toBe(true);
      expect(provider.getItems(layer)).toEqual([{ row: 8 }]);

      stopSubscription.dispose();
      disposable.dispose();
    });

    it("projects moved cell boundaries through folds and changing soft wraps", () => {
      editor.setText(
        ["x".repeat(100), "before", "fold", "hidden", "end", "# %%", "tail"].join("\n"),
      );
      editor.displayLayer.reset({ softWrapColumn: 10 });
      editor.foldBufferRowRange(2, 4);
      const layer = createLayer(provider);
      const service = createCellsService(new Map([[editor, [new Point(5, 0)]]]));
      const disposable = markerLayer.connect(service);
      const before = provider.getItems(layer)[0].row;
      expect(before).toBeGreaterThan(5);

      editor.getBuffer().insert([1, 0], "\n\n");

      const moved = provider.getItems(layer)[0].row;
      expect(moved).toBe(before + 2);
      expect(moved).toBe(editor.screenPositionForBufferPosition([7, 0]).row);

      editor.displayLayer.reset({ softWrapColumn: 20 });
      expect(provider.getItems(layer)[0].row).toBe(
        editor.screenPositionForBufferPosition([7, 0]).row,
      );
      expect(provider.getItems(layer)[0].row).toBeLessThan(moved);

      disposable.dispose();
    });

    it("returns no items without cached data", () => {
      const layer = createLayer(provider);
      expect(provider.getItems(layer)).toEqual([]);
    });

    it("forgets the editor when its layer detaches", () => {
      const layer = createLayer(provider);
      const service = createCellsService(new Map());
      const disposable = markerLayer.connect(service);
      const bufferMarkers = layer.cache.get("bufferMarkers");
      layer.disposables.dispose();
      layer.update.calls.reset();

      const breakpoints = [new Point(9, 0)];
      service.emitter.emit("did-update", { editor, breakpoints });

      expect(layer.cache.get("data")).toEqual([]);
      expect(layer.update).not.toHaveBeenCalled();
      expect(bufferMarkers.isDestroyed()).toBe(true);
      expect(editor.getBuffer().getMarkerLayer(bufferMarkers.id)).toBeUndefined();

      disposable.dispose();
    });
  });
});
