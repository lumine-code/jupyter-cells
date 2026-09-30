const fs = require("fs").promises;
const os = require("os");
const path = require("path");

const { exportNotebook, buildNotebook } = require("../lib/export-notebook");
const { _loadNotebook } = require("../lib/import-notebook");
const { parseNotebook } = require("../lib/nbformat");
const services = require("../lib/services");

describe("notebook export", () => {
  let editor, temporaryDirectory;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    editor = await lumine.workspace.open();
    services.setKernel(null);
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "jupyter-cells-export-"));
  });

  afterEach(async () => {
    services.setKernel(null);
    const pane = lumine.workspace.paneForItem(editor);
    if (pane) await pane.destroyItem(editor, true);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("opens a save dialog for the source editor's notebook name", async () => {
    const choosePath = spyOn(lumine.window, "showSaveDialog").and.returnValue(
      Promise.resolve({ canceled: true }),
    );

    await exportNotebook(editor);

    expect(choosePath.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        title: editor.getTitle(),
        defaultPath: jasmine.stringMatching(/\.ipynb$/),
      }),
    );
  });

  it("requests jupyter.kernel before reading notebook metadata", async () => {
    const kernelSpec = { name: "python3", display_name: "Python 3", language: "python" };
    const request = spyOn(lumine.packages, "requestService").and.callFake(async () => {
      services.setKernel({ getActiveKernel: () => ({ kernelSpec }) });
      return true;
    });
    const filePath = path.join(temporaryDirectory, "export.ipynb");
    spyOn(lumine.window, "showSaveDialog").and.resolveTo({ canceled: false, filePath });

    await exportNotebook(editor);

    expect(request).toHaveBeenCalledWith("jupyter.kernel", "^1.0.0");
    expect(JSON.parse(await fs.readFile(filePath, "utf8")).metadata.kernelspec).toEqual(kernelSpec);
  });
});

describe("notebook marker round-trip", () => {
  let runtimeRequest, temporaryDirectory;

  beforeEach(async () => {
    await lumine.packages.activatePackage("language-python");
    await lumine.packages.activatePackage(path.resolve(__dirname, "..", "..", "language-ipython"));
    runtimeRequest = spyOn(lumine.packages, "requestService").and.returnValue(
      Promise.resolve(true),
    );
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "jupyter-cells-"));
  });

  afterEach(async () => {
    for (const editor of lumine.workspace.getTextEditors()) editor.destroy();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("imports preferred markers and exports their original cell types", async () => {
    const notebookPath = path.join(temporaryDirectory, "markers.ipynb");
    const notebook = {
      cells: [
        {
          cell_type: "code",
          source: ["value = 1"],
          outputs: [],
          execution_count: null,
          metadata: {},
        },
        {
          cell_type: "markdown",
          source: ["Heading\n", "body"],
          metadata: {},
        },
      ],
      metadata: { language_info: { name: "python" } },
      nbformat: 4,
      nbformat_minor: 5,
    };
    await fs.writeFile(notebookPath, JSON.stringify(notebook));

    await _loadNotebook(notebookPath, true);
    const editor = lumine.workspace.getActiveTextEditor();
    const languageMode = editor.getBuffer().getLanguageMode();
    await languageMode.ready;
    await languageMode.atTransactionEnd();

    expect(editor.getText().split(/\r?\n/)).toEqual([
      "# %%",
      "value = 1",
      "# %% [markdown]",
      "Heading",
      "body",
    ]);

    const roundTripped = parseNotebook(await buildNotebook(editor));
    expect(roundTripped.cells.map((cell) => cell.cell_type)).toEqual(["code", "markdown"]);
    expect(roundTripped.cells.map((cell) => cell.source)).toEqual(["value = 1", "Heading\nbody"]);
    expect(runtimeRequest).toHaveBeenCalledWith("jupyter.execution", "^1.0.0");
    expect(editor.getGrammar().scopeName).toBe("source.python.ipy");
    expect(editor.getSaveDialogOptions().defaultPath).toBe(
      path.join(temporaryDirectory, "markers.ipy"),
    );
  });

  it("round-trips literal Markdown, raw, empty cells and trailing source newlines", async () => {
    const original = [
      {
        cell_type: "code",
        source: ["value = 1\n"],
        outputs: [],
        metadata: {},
        execution_count: null,
      },
      { cell_type: "markdown", source: ["# Heading\n", "    indented\n"], metadata: {} },
      { cell_type: "raw", source: ["literal <bytes>\n"], metadata: {} },
      { cell_type: "markdown", source: [], metadata: {} },
      { cell_type: "code", source: ["last\n"], outputs: [], metadata: {}, execution_count: null },
    ];
    const notebookPath = path.join(temporaryDirectory, "literal.ipynb");
    await fs.writeFile(
      notebookPath,
      JSON.stringify({
        cells: original,
        metadata: { language_info: { name: "python" } },
        nbformat: 4,
        nbformat_minor: 5,
      }),
    );
    await _loadNotebook(notebookPath);
    const editor = lumine.workspace.getActiveTextEditor();
    const result = parseNotebook(await buildNotebook(editor));
    expect(result.cells.map((cell) => cell.cell_type)).toEqual(
      original.map((cell) => cell.cell_type),
    );
    expect(result.cells.map((cell) => cell.source)).toEqual(
      original.map((cell) => cell.source.join("")),
    );
  });
});
