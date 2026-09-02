const fs = require("fs").promises;
const os = require("os");
const path = require("path");

const { exportNotebook, buildNotebook } = require("../lib/export-notebook");
const { _loadNotebook } = require("../lib/import-notebook");
const { parseNotebook } = require("../lib/nbformat");

describe("notebook export", () => {
  let editor;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    editor = await lumine.workspace.open();
  });

  afterEach(async () => {
    const pane = lumine.workspace.paneForItem(editor);
    if (pane) await pane.destroyItem(editor, true);
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
});

describe("notebook marker round-trip", () => {
  let temporaryDirectory;

  beforeEach(async () => {
    await lumine.packages.activatePackage("language-python");
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

    await _loadNotebook(notebookPath, false);
    const editor = lumine.workspace.getActiveTextEditor();
    const languageMode = editor.getBuffer().getLanguageMode();
    await languageMode.ready;
    await languageMode.atTransactionEnd();

    expect(editor.getText().split(/\r?\n/)).toEqual([
      "# %%",
      "value = 1",
      "# %% [markdown]",
      "# Heading",
      "# body",
    ]);

    const roundTripped = parseNotebook(buildNotebook(editor));
    expect(roundTripped.cells.map((cell) => cell.cell_type)).toEqual(["code", "markdown"]);
    expect(roundTripped.cells.map((cell) => cell.source)).toEqual(["value = 1", "Heading\nbody"]);
  });
});
