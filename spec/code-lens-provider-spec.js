const path = require("path");
const { CompositeDisposable } = require("lumine");

const packageRoot = path.join(__dirname, "..");

describe("the code-lens provider", () => {
  let mainModule, provider, editor, disposables, runs, runtimeRequest;

  const markers = ["# %%", "a = 1", "# %% markdown", "# text", "# %%", "b = 2"].join("\n");
  const literalCells = [
    "# %% Setup",
    "seed = 1",
    "# %% [markdown] Notes",
    "# Heading 😀",
    "  literal **bold**",
    "# %% [raw] Bytes",
    "%%bash remains raw",
    "<bytes>",
    "# %% Script",
    "%%writefile -a notes.txt",
    "first",
    "second",
    "# %% Last",
    "last = 2",
  ].join("\n");

  async function useIPython(text) {
    await lumine.packages.activatePackage(path.resolve(__dirname, "..", "..", "language-ipython"));
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python.ipy");
    editor.setText(text);
    await editor.whenGrammarSettled();
  }

  beforeEach(async () => {
    disposables = new CompositeDisposable();
    const pack = await lumine.packages.activatePackage(packageRoot);
    mainModule = pack.mainModule;
    provider = mainModule.provideCodeLens();
    lumine.config.set("jupyter-cells.codeLenses", true);
    runtimeRequest = spyOn(lumine.packages, "requestService").and.returnValue(
      Promise.resolve(true),
    );

    await lumine.packages.activatePackage("language-python");
    editor = await lumine.workspace.open("code-lens-cells.py");
    editor.getBuffer().setText(markers);
    const languageMode = editor.getBuffer().getLanguageMode();
    if (languageMode.atTransactionEnd) {
      await languageMode.atTransactionEnd();
    }

    runs = [];
    disposables.add(
      mainModule.consumeJupyterExecution({
        execute: ({ editor: target, blocks }) => {
          runs.push({ target, blocks });
          return Promise.resolve(true);
        },
      }),
    );
  });

  afterEach(async () => {
    disposables.dispose();
    await lumine.packages.deactivatePackage("jupyter-cells");
    for (const open of lumine.workspace.getTextEditors()) open.destroy();
  });

  it("offers Run Cell on every marker, and Run All Above where something is above", async () => {
    const lenses = await provider.codeLenses(editor);
    const titlesByRow = {};
    for (const lens of lenses) {
      const row = lens.range[0][0];
      (titlesByRow[row] = titlesByRow[row] || []).push(lens.title);
    }
    // The first marker has an empty preamble above it, so it gets no dead
    // Run All Above link.
    expect(titlesByRow[0]).toEqual(["Run Cell"]);
    expect(titlesByRow[2]).toEqual(["Run Cell", "Run All Above"]);
    expect(titlesByRow[4]).toEqual(["Run Cell", "Run All Above"]);
  });

  it("runs the cell below the clicked marker, wherever the cursor is", async () => {
    editor.setCursorBufferPosition([5, 0]);
    const lenses = await provider.codeLenses(editor);
    const runCell = lenses.find((lens) => lens.range[0][0] === 0 && lens.title === "Run Cell");

    await runCell.execute();

    expect(runs.length).toBe(1);
    expect(runs[0].target).toBe(editor);
    expect(runs[0].blocks).toEqual([{ code: "a = 1", row: 1, cellType: "code" }]);
    expect(runtimeRequest).not.toHaveBeenCalled();
  });

  it("runs everything above the clicked marker as one batch", async () => {
    const lenses = await provider.codeLenses(editor);
    const runAbove = lenses.find(
      (lens) => lens.range[0][0] === 4 && lens.title === "Run All Above",
    );

    await runAbove.execute();

    expect(runs.length).toBe(1);
    expect(runs[0].blocks.length).toBe(2);
    expect(runs[0].blocks.map((block) => block.cellType)).toEqual(["code", "markdown"]);
  });

  it("runs literal typed cells and complete magic headers from their own lenses", async () => {
    await useIPython(literalCells);
    editor.setCursorBufferPosition([13, 0]);
    const lenses = await provider.codeLenses(editor);
    const expected = [
      [2, { code: "# Heading 😀\n  literal **bold**", row: 4, cellType: "markdown" }],
      [5, { code: "%%bash remains raw\n<bytes>", row: 7, cellType: "raw" }],
      [8, { code: "%%writefile -a notes.txt\nfirst\nsecond", row: 11, cellType: "code" }],
    ];
    for (const [markerRow, block] of expected) {
      await lenses
        .find((lens) => lens.range[0][0] === markerRow && lens.title === "Run Cell")
        .execute();
      expect(runs.at(-1)).toEqual({ target: editor, blocks: [block] });
    }
    expect(runs.length).toBe(expected.length);
    expect(runtimeRequest).not.toHaveBeenCalled();
  });

  it("preserves literal types and magic arguments in the batch above an IPython lens", async () => {
    await useIPython(literalCells);
    editor.setCursorBufferPosition([0, 0]);
    const lenses = await provider.codeLenses(editor);
    await lenses
      .find((lens) => lens.range[0][0] === 12 && lens.title === "Run All Above")
      .execute();
    expect(runs).toEqual([
      {
        target: editor,
        blocks: [
          { code: "seed = 1", row: 1, cellType: "code" },
          { code: "# Heading 😀\n  literal **bold**", row: 4, cellType: "markdown" },
          { code: "%%bash remains raw\n<bytes>", row: 7, cellType: "raw" },
          { code: "%%writefile -a notes.txt\nfirst\nsecond", row: 11, cellType: "code" },
        ],
      },
    ]);
  });

  it("runs flagged headers across literal and magic boundaries through the normal lenses", async () => {
    await useIPython(
      [
        "#%%$# Start",
        "seed = 1",
        "#%% [markdown] Notes",
        "# Literal heading",
        "#%%$$s+;<_# From Markdown",
        "%%writefile -a notes.txt",
        "first",
        "second",
        "#%% [raw] Data",
        "raw <payload>",
        "#%%$$p!_<;# From raw",
        "%%bash -e",
        "echo hello",
        "#%%$$v-# Last",
        "done = 1",
      ].join("\n"),
    );
    const service = mainModule.provideJupyterCells();
    const lenses = await provider.codeLenses(editor);
    expect(
      lenses.filter((lens) => lens.title === "Run Cell").map((lens) => lens.range[0][0]),
    ).toEqual([0, 2, 4, 8, 10, 13]);
    editor.setCursorBufferPosition([14, 0]);
    await lenses.find((lens) => lens.range[0][0] === 4 && lens.title === "Run Cell").execute();
    expect(runs.at(-1).blocks).toEqual([
      { code: "%%writefile -a notes.txt\nfirst\nsecond", row: 7, cellType: "code" },
    ]);
    await lenses.find((lens) => lens.range[0][0] === 10 && lens.title === "Run Cell").execute();
    expect(runs.at(-1).blocks).toEqual([
      { code: "%%bash -e\necho hello", row: 12, cellType: "code" },
    ]);
    expect(
      await service.getExecutionBlocks(editor, [
        [7, 0],
        [7, 6],
      ]),
    ).toEqual([{ code: "%%writefile -a notes.txt\nsecond", row: 7, cellType: "code" }]);
    await lenses
      .find((lens) => lens.range[0][0] === 13 && lens.title === "Run All Above")
      .execute();
    expect(runs.at(-1).blocks).toEqual([
      { code: "seed = 1", row: 1, cellType: "code" },
      { code: "# Literal heading", row: 3, cellType: "markdown" },
      { code: "%%writefile -a notes.txt\nfirst\nsecond", row: 7, cellType: "code" },
      { code: "raw <payload>", row: 9, cellType: "raw" },
      { code: "%%bash -e\necho hello", row: 12, cellType: "code" },
    ]);
    expect(runtimeRequest).not.toHaveBeenCalled();
  });

  it("shares one scalar index across concurrent lenses and bulk reads of 1000 typed cells", async () => {
    lumine.config.set("jupyter-cells.cellMarkers", false);
    const payloads = Array.from({ length: 1000 }, (_, index) => {
      switch (index % 4) {
        case 0:
          return { type: "code", source: `value_${index} = ${index}` };
        case 1:
          return { type: "markdown", source: `# Heading ${index} 😀\n  literal **bold**` };
        case 2:
          return { type: "raw", source: `%%bash remains raw ${index}\n<bytes>` };
        default:
          return { type: "code", source: `%%capture --no-stderr\nvalue_${index} = ${index}` };
      }
    });
    await useIPython(
      payloads
        .map(({ type, source }, index) => `# %% [${type}] Cell ${index}\n${source}`)
        .join("\n"),
    );
    const cells = require("../lib/cells");
    const service = mainModule.provideJupyterCells();
    const mode = editor.getBuffer().getLanguageMode();
    const rootTree = mode.tree;
    const layers = mode.getAllInjectionLayers();
    expect(layers.filter((layer) => layer.grammar.scopeName === "source.python").length).toBe(1);
    const walks = spyOn(rootTree, "walk").and.callThrough();
    const parse = spyOn(mode, "parseAsync").and.callThrough();
    const createParser = spyOn(mode, "createParserForLanguage").and.callThrough();
    const scan = spyOn(editor.getBuffer(), "scan").and.callThrough();
    const wholeSource = spyOn(editor, "getText").and.callThrough();
    const ready = jasmine.createSpy("ready");
    disposables.add(
      cells.onDidUpdate(({ editor: changed }) => {
        if (changed === editor) ready();
      }),
    );
    const requests = Array.from({ length: 8 }, () =>
      Promise.all([
        provider.codeLenses(editor),
        service.getCellDescriptors(editor),
        service.getExecutionBlocks(editor),
      ]),
    );
    const results = await Promise.all(requests);
    expect(walks).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(scan).not.toHaveBeenCalled();
    expect(wholeSource).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(createParser).not.toHaveBeenCalled();
    expect(editor.getBuffer().getLanguageMode()).toBe(mode);
    expect(mode.tree).toBe(rootTree);
    expect(mode.getAllInjectionLayers()).toEqual(layers);
    const expected = payloads.map(({ type, source }) => [type, source]);
    for (const [lenses, descriptors, blocks] of results) {
      expect(lenses.length).toBe(1999);
      expect(descriptors.map((cell) => [cell.cellType, cell.source])).toEqual(expected);
      expect(blocks.map((block) => [block.cellType, block.code])).toEqual(expected);
    }
    const index = cells.getMarkerIndex(editor);
    expect(index.magics.length).toBe(250);
    expect(index.entries.length).toBe(1000);
    expect(index.markers.length).toBe(1000);
    await provider.codeLenses(editor);
    expect(cells.getMarkerIndex(editor)).toBe(index);
    expect(walks).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("emits nothing while the setting is off", async () => {
    lumine.config.set("jupyter-cells.codeLenses", false);
    expect(await provider.codeLenses(editor)).toBeNull();
  });

  it("keeps the links visible without the execution service and explains a failed request", async () => {
    disposables.dispose();
    const lenses = await provider.codeLenses(editor);
    const runCell = lenses.find((lens) => lens.range[0][0] === 0 && lens.title === "Run Cell");

    await runCell.execute();

    expect(runtimeRequest).toHaveBeenCalledWith("jupyter.execution", "^1.0.0");
    expect(lumine.notifications.getNotifications().at(-1).getMessage()).toContain("jupyter-repl");
  });

  it("invalidates when the setting flips", async () => {
    const invalidated = jasmine.createSpy("invalidated");
    disposables.add(provider.onDidInvalidate(invalidated));

    lumine.config.set("jupyter-cells.codeLenses", false);
    expect(invalidated.calls.count()).toBe(1);

    expect(invalidated.calls.count()).toBe(1);
  });

  it("emits nothing for a file with no markers", async () => {
    editor.getBuffer().setText("a = 1\nb = 2\n");
    const languageMode = editor.getBuffer().getLanguageMode();
    if (languageMode.atTransactionEnd) {
      await languageMode.atTransactionEnd();
    }
    expect(await provider.codeLenses(editor)).toBeNull();
  });

  it("keeps a Run Cell lens on an empty cell from running the next code cell", async () => {
    await lumine.packages.activatePackage(path.resolve(__dirname, "..", "..", "language-ipython"));
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python.ipy");
    for (const metadata of ["[markdown]", "[raw]", ""]) {
      editor.setText("# %% " + metadata + "\n# %% Code\ndangerous()\n");
      runs.length = 0;
      const lenses = await provider.codeLenses(editor);
      await lenses.find((lens) => lens.range[0][0] === 0 && lens.title === "Run Cell").execute();
      expect(runs).toEqual([]);
      await lenses.find((lens) => lens.range[0][0] === 1 && lens.title === "Run Cell").execute();
      expect(runs.length).toBe(1);
      expect(runs[0].blocks.map((block) => block.code)).toEqual(["dangerous()\n"]);
    }
  });

  it("cancels a lens run if its source shifts while service activation is pending", async () => {
    editor.setText("# %% Harmless\nharmless()\n# %% Code\ndangerous()\n");
    const lenses = await provider.codeLenses(editor);
    const execution = {
      execute: ({ editor: target, blocks }) => {
        runs.push({ target, blocks });
      },
    };
    let resume;
    const deferred = new Promise((resolve) => {
      resume = resolve;
    });
    spyOn(require("../lib/services"), "requestExecution").and.returnValue(deferred);
    const runCell = lenses.find((lens) => lens.range[0][0] === 0 && lens.title === "Run Cell");
    const pending = runCell.execute();
    editor.getBuffer().delete([
      [0, 0],
      [2, 0],
    ]);
    resume(execution);
    await pending;
    expect(runs).toEqual([]);
  });
});
