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
      services.setKernel({
        getKernelForEditor: (candidate) => (candidate === editor ? { kernelSpec } : null),
      });
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

  async function writeNotebook(name, original) {
    const notebookPath = path.join(temporaryDirectory, name + ".ipynb");
    const serialized = JSON.stringify({
      cells: original,
      metadata: { language_info: { name: "python" } },
      nbformat: 4,
      nbformat_minor: 5,
    });
    await fs.writeFile(notebookPath, serialized);
    return { notebookPath, serialized };
  }

  function originalCell(cellType, source) {
    return cellType === "code"
      ? { cell_type: cellType, source, outputs: [], metadata: {}, execution_count: null }
      : { cell_type: cellType, source, metadata: {} };
  }

  async function pauseImportValidation(notebookPath) {
    let reach, resume;
    const reached = new Promise((resolve) => {
      reach = resolve;
    });
    const gate = new Promise((resolve) => {
      resume = resolve;
    });
    const assign = lumine.grammars.assignLanguageMode.bind(lumine.grammars);
    spyOn(lumine.grammars, "assignLanguageMode").and.callFake((buffer, ...args) => {
      const result = assign(buffer, ...args);
      const mode = buffer.getLanguageMode();
      if (jasmine.isSpy(mode.atTransactionEnd)) return result;
      const settle = mode.atTransactionEnd.bind(mode);
      spyOn(mode, "atTransactionEnd").and.callFake(async () => {
        const transaction = await settle();
        reach(lumine.workspace.getTextEditors().find((editor) => editor.getBuffer() === buffer));
        await gate;
        return transaction;
      });
      return result;
    });
    const pending = _loadNotebook(notebookPath, true);
    return { editor: await reached, pending, resume };
  }

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
    expect(runtimeRequest).toHaveBeenCalledWith("jupyter.output", "^1.0.0");
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

  it("round-trips magic arguments and literal magic-looking Markdown and raw source", async () => {
    const original = [
      originalCell("code", "\n%%writefile -a notes.txt\nfirst\nsecond\n"),
      originalCell("markdown", "# Heading 😀\n%%capture remains prose\n  **bold**\n"),
      originalCell("raw", "%%time stays raw\n<bytes>\n"),
      originalCell("code", "%%capture --no-stderr\nvalue = 1"),
    ];
    const { notebookPath } = await writeNotebook("literal-magics", original);

    await _loadNotebook(notebookPath);
    const editor = lumine.workspace.getActiveTextEditor();
    const result = parseNotebook(await buildNotebook(editor));

    expect(result.cells.map((cell) => [cell.cell_type, cell.source])).toEqual(
      original.map((cell) => [cell.cell_type, cell.source]),
    );
    expect(editor.getGrammar().scopeName).toBe("source.python.ipy");
  });

  for (const [endingName, ending] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["lone CR", "\r"],
  ]) {
    it(`round-trips exact literal source with internal CRLF and CR and trailing ${endingName}`, async () => {
      const original = ["code", "markdown", "raw", "raw"].map((cellType, index) => {
        const source =
          cellType === "code"
            ? 'text = """first\r\nmiddle\rcarriage\r\nlast"""' + ending
            : `# First ${index} 😀\r\nmiddle\rcarriage\r\nlast` + ending;
        return originalCell(cellType, source);
      });
      const { notebookPath } = await writeNotebook(
        "exact-" + endingName.replace(" ", "-"),
        original,
      );

      await _loadNotebook(notebookPath);
      const editor = lumine.workspace.getActiveTextEditor();
      const descriptors = await require("../lib/cells").getCellDescriptors(editor);
      const expected = original.map((cell) => [cell.cell_type, cell.source]);
      expect(descriptors.map((cell) => [cell.cellType, cell.source])).toEqual(expected);
      const blocks = await require("../lib/cells").getExecutionBlocks(editor);
      expect(blocks.map((block) => [block.cellType, block.code])).toEqual(
        original.map((cell) => [cell.cell_type, cell.source.replace(/\r\n|\r/g, "\n")]),
      );
      const exported = await buildNotebook(editor);
      expect(exported.cells.map((cell) => [cell.cell_type, cell.source.join("")])).toEqual(
        expected,
      );
      expect(
        parseNotebook(exported, { preserveSourceLineEndings: true }).cells.map((cell) => [
          cell.cell_type,
          cell.source,
        ]),
      ).toEqual(expected);
      expect(editor.getGrammar().scopeName).toBe("source.python.ipy");
    });
  }

  for (const cellType of ["raw", "markdown", "code"]) {
    it(`refuses a reserved delimiter inside an imported ${cellType} payload`, async () => {
      const original = [
        originalCell("code", "first = 1"),
        originalCell(cellType, "before\n# %% [raw] Payload\nbytes"),
        originalCell("code", "after = 1"),
      ];
      const { notebookPath, serialized } = await writeNotebook("collision-" + cellType, original);
      const previous = await lumine.workspace.open();
      previous.setText("existing source");
      const warnings = spyOn(lumine.notifications, "addWarning");

      await _loadNotebook(notebookPath, true);

      expect(lumine.workspace.getTextEditors()).toEqual([previous]);
      expect(previous.isDestroyed()).toBe(false);
      expect(previous.getText()).toBe("existing source");
      const [message, options] = warnings.calls.mostRecent().args;
      expect(message).toContain("source cell 2, line 2");
      expect(options.detail).toContain("Open the notebook directly");
      expect(runtimeRequest).not.toHaveBeenCalled();
      expect(await fs.readFile(notebookPath, "utf8")).toBe(serialized);
    });
  }

  it("keeps a marker inside a Python string as code during import validation", async () => {
    const original = [
      originalCell("code", 'value = """\n# %% [raw]\ninside string\n"""\n'),
      originalCell("markdown", "# Heading\n"),
      originalCell("raw", "unchanged bytes\n"),
    ];
    const { notebookPath } = await writeNotebook("string-marker", original);
    const warnings = spyOn(lumine.notifications, "addWarning");

    await _loadNotebook(notebookPath);

    const result = parseNotebook(await buildNotebook(lumine.workspace.getActiveTextEditor()));
    expect(result.cells.map((cell) => [cell.cell_type, cell.source])).toEqual(
      original.map((cell) => [cell.cell_type, cell.source]),
    );
    expect(warnings).not.toHaveBeenCalled();
  });

  it("preserves edits made while the import's descriptor validation is awaiting its tree", async () => {
    const { notebookPath, serialized } = await writeNotebook("edited-collision", [
      originalCell("raw", "before\n# %% [raw]\nafter"),
    ]);
    const warnings = spyOn(lumine.notifications, "addWarning");
    const request = await pauseImportValidation(notebookPath);
    try {
      request.editor.setText("User edits remain here");
    } finally {
      request.resume();
    }
    await request.pending;

    expect(request.editor.isDestroyed()).toBe(false);
    expect(request.editor.getText()).toBe("User edits remain here");
    const [message, options] = warnings.calls.mostRecent().args;
    expect(message).toContain("source editor changed");
    expect(options.detail).toContain("Your edits were preserved");
    expect(runtimeRequest).not.toHaveBeenCalled();
    expect(await fs.readFile(notebookPath, "utf8")).toBe(serialized);
  });

  it("keeps an import editor that was given a save path during validation", async () => {
    const { notebookPath } = await writeNotebook("saved-collision", [
      originalCell("markdown", "before\n# %% [code]\nafter = 1"),
    ]);
    const request = await pauseImportValidation(notebookPath);
    const savePath = path.join(temporaryDirectory, "user-saved.ipy");
    try {
      request.editor.getBuffer().setPath(savePath);
    } finally {
      request.resume();
    }
    await request.pending;

    expect(request.editor.isDestroyed()).toBe(false);
    expect(request.editor.getPath()).toBe(savePath);
    expect(runtimeRequest).not.toHaveBeenCalled();
  });

  it("preserves a grammar override chosen while import validation awaits its tree", async () => {
    const { notebookPath, serialized } = await writeNotebook("grammar-choice", [
      originalCell("markdown", "# Heading\n"),
    ]);
    const warnings = spyOn(lumine.notifications, "addWarning");
    const request = await pauseImportValidation(notebookPath);
    const source = request.editor.getText();
    try {
      expect(lumine.grammars.assignLanguageMode(request.editor.getBuffer(), "source.python")).toBe(
        true,
      );
    } finally {
      request.resume();
    }
    await request.pending;

    expect(request.editor.isDestroyed()).toBe(false);
    expect(request.editor.getText()).toBe(source);
    expect(request.editor.getGrammar().scopeName).toBe("source.python");
    expect(lumine.grammars.getAssignedLanguageId(request.editor.getBuffer())).toBe("source.python");
    expect(warnings.calls.mostRecent().args[0]).toContain("source editor changed");
    expect(runtimeRequest).not.toHaveBeenCalled();
    expect(await fs.readFile(notebookPath, "utf8")).toBe(serialized);
  });

  it("does not overwrite or close an existing editor if a fresh import editor is declined", async () => {
    const { notebookPath } = await writeNotebook("existing-editor", [
      originalCell("raw", "payload"),
    ]);
    const previous = await lumine.workspace.open();
    previous.setText("existing source");
    spyOn(lumine.workspace, "open").and.resolveTo(previous);

    await _loadNotebook(notebookPath);

    expect(previous.isDestroyed()).toBe(false);
    expect(previous.getText()).toBe("existing source");
  });
});
