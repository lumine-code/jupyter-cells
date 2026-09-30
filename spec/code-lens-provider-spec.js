const path = require("path");
const { CompositeDisposable } = require("lumine");

const packageRoot = path.join(__dirname, "..");

describe("the code-lens provider", () => {
  let mainModule, provider, editor, disposables, runs, runtimeRequest;

  const markers = ["# %%", "a = 1", "# %% markdown", "# text", "# %%", "b = 2"].join("\n");

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
        runAdapter: () => false,
        runBlocks: (target, blocks) => {
          runs.push({ target, blocks });
          return Promise.resolve(true);
        },
        moveDown() {},
        clearResults() {},
        restartKernel() {},
        importOutputs() {},
        markdownToOutput: (source) => ({ data: { "text/markdown": source } }),
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
});
