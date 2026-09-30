const path = require("path");
const { Point, Range } = require("lumine");
const cells = require("../lib/cells");

describe("settled typed cell descriptors", () => {
  let editor, registration;
  const open = async (text, grammar = "language-python", file = "cell-model.py") => {
    await lumine.packages.activatePackage(
      grammar === "language-ipython" ? path.resolve(__dirname, "..", "..", grammar) : grammar,
    );
    editor = await lumine.workspace.open(file);
    editor.setText(text);
    await editor.getBuffer().getLanguageMode().atTransactionEnd?.();
    return editor;
  };
  afterEach(() => {
    registration?.dispose();
    registration = null;
    editor?.destroy();
  });

  it("consumes a complete percent run and metadata before titles", async () => {
    await open("# %% Top\na = 1\n# %%% [md] Child\n# text\n# %%%% [raw] Raw title\n# bytes");
    const descriptors = await cells.getCellDescriptors(editor);
    expect(descriptors.map((cell) => cell.cellType)).toEqual(["code", "markdown", "raw"]);
    expect(descriptors.map((cell) => cell.source)).toEqual(["a = 1", "text", "bytes"]);
    const index = cells.getMarkerIndex(editor);
    expect(
      index.markers.map(({ start, end }) => editor.getTextInBufferRange([start, end])),
    ).toEqual(["# %%", "# %%% [md]", "# %%%% [raw]"]);
    expect(cells.getBreakpoints(editor).map((position) => position.row)).toEqual([0, 2, 4, 5]);
  });

  it("accepts legacy bare Markdown without stealing ordinary titles", async () => {
    await open(
      "# %% md Short title\n# first\n# %% markdown Long title\n# second\n# %% markdownish notes\nvalue = 1",
    );
    expect((await cells.getCellDescriptors(editor)).map((cell) => cell.cellType)).toEqual([
      "markdown",
      "markdown",
      "code",
    ]);
  });

  it("shares one scan for concurrent readers and invalidates synchronously on edits", async () => {
    await open("# %%\na = 1\n# %% [markdown]\n# text");
    const scans = spyOn(editor.getBuffer(), "scan").and.callThrough();
    await Promise.all(
      Array.from({ length: 20 }, () => cells.getCellDescriptors(editor, new Range([1, 0], [1, 0]))),
    );
    cells.getBreakpoints(editor);
    expect(scans.calls.count()).toBe(1);
    editor.getBuffer().setTextInRange(
      [
        [0, 0],
        [0, 4],
      ],
      "# %% [raw]",
    );
    const descriptor = (await cells.getCellDescriptors(editor, new Range([1, 0], [1, 0])))[0];
    expect(descriptor.cellType).toBe("raw");
    expect(scans.calls.count()).toBe(2);
  });

  it("splits and clips a cross-cell selection before preparing execution", async () => {
    await open("# %%\na = 1\n# %% [markdown]\n# text\n# %% [raw]\n# bytes");
    const blocks = await cells.getExecutionBlocks(editor, [
      [1, 2],
      [5, 5],
    ]);
    expect(blocks.map((block) => block.cellType)).toEqual(["code", "markdown", "raw"]);
    expect(blocks.map((block) => block.code)).toEqual(["= 1", "text", "byt"]);
  });

  it("reads literal IPython types from the root tree without a regex scan", async () => {
    await open(
      '# %%\nvalue = """\n# %% [raw]\ninside string\n"""\n# %% [markdown]\n# Heading\n  indented\n# %% [raw]\nraw <bytes>',
      "language-ipython",
      "cell-model.ipy",
    );
    const scans = spyOn(editor.getBuffer(), "scan").and.callThrough();
    const descriptors = await cells.getCellDescriptors(editor);
    expect(descriptors.map((cell) => cell.cellType)).toEqual(["code", "markdown", "raw"]);
    expect(descriptors[0].source).toContain("# %% [raw]\ninside string");
    expect(descriptors[1].source).toBe("# Heading\n  indented");
    expect(descriptors[2].source).toBe("raw <bytes>");
    expect(scans).not.toHaveBeenCalled();
    const onHeader = await cells.getCellDescriptors(editor, [
      [5, 0],
      [5, 0],
    ]);
    expect(onHeader[0]).toEqual(descriptors[1]);
  });

  it("never serves stale IPython geometry while a new transaction is pending", async () => {
    await open("# %%\nvalue = 1", "language-ipython", "cell-model.ipy");
    await cells.getCellDescriptors(editor);
    editor.getBuffer().setTextInRange(
      [
        [0, 0],
        [0, 4],
      ],
      "# %% [raw]",
    );
    expect(cells.getCell(editor, new Point(1, 0))).toBeNull();
    expect(cells.getBreakpoints(editor)).toEqual([]);
    const descriptors = await cells.getCellDescriptors(editor);
    expect(descriptors[0].cellType).toBe("raw");
    expect(cells.getCell(editor, new Point(1, 0))).not.toBeNull();
  });

  it("preserves empty explicit cells and source newlines separately from separators", async () => {
    await open(
      "# %%\nline\n\n# %% [markdown]\n\n# %% [raw]\nlast\n",
      "language-ipython",
      "cell-model.ipy",
    );
    const descriptors = await cells.getCellDescriptors(editor);
    expect(descriptors.map((cell) => cell.source)).toEqual(["line\n", "", "last\n"]);
    expect((await cells.getExecutionBlocks(editor)).map((block) => block.cellType)).toEqual([
      "code",
      "raw",
    ]);
  });

  it("prepends complete magic headers for selections and expands an empty magic selection", async () => {
    await open(
      "# %%\n%%writefile -a notes.txt\nfirst\nsecond\n",
      "language-ipython",
      "cell-model.ipy",
    );
    const selected = await cells.getExecutionBlocks(editor, [
      [3, 0],
      [3, 6],
    ]);
    expect(selected).toEqual([
      { code: "%%writefile -a notes.txt\nsecond", row: 3, cellType: "code" },
    ]);
    const current = await cells.getExecutionBlocks(editor, [
      [3, 2],
      [3, 2],
    ]);
    expect(current[0].code).toBe("%%writefile -a notes.txt\nfirst\nsecond\n");
  });

  it("treats fragment marker comments as code and preserves a first magic header", async () => {
    await lumine.packages.activatePackage("language-python");
    editor = lumine.workspace.buildTextEditor();
    registration = lumine.textEditors.add(editor, { role: "fragment" });
    editor.setText("\n%%time -n 3\n# %% [markdown]\nvalue = 1");
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python");
    const descriptors = await cells.getCellDescriptors(editor);
    expect(descriptors.length).toBe(1);
    expect(descriptors[0].cellType).toBe("code");
    expect(cells.getBreakpoints(editor)).toEqual([editor.getBuffer().getEndPosition()]);
    const blocks = await cells.getExecutionBlocks(editor, [
      [3, 0],
      [3, 9],
    ]);
    expect(blocks[0].code).toBe("%%time -n 3\nvalue = 1");
  });

  it("preserves the complete shell-magic header when a fragment body is selected", async () => {
    await lumine.packages.activatePackage("language-python");
    editor = lumine.workspace.buildTextEditor();
    registration = lumine.textEditors.add(editor, { role: "fragment" });
    editor.setText("\n%%! --flag\nfirst\nsecond");
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python");
    const blocks = await cells.getExecutionBlocks(editor, [
      [3, 0],
      [3, 6],
    ]);
    expect(blocks).toEqual([{ code: "%%! --flag\nsecond", row: 3, cellType: "code" }]);
  });

  it("runs a header-only fragment at EOF without inventing a body or a newline", async () => {
    await lumine.packages.activatePackage("language-python");
    editor = lumine.workspace.buildTextEditor();
    registration = lumine.textEditors.add(editor, { role: "fragment" });
    editor.setText("%%time -n 3");
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python");
    const end = editor.getBuffer().getEndPosition();
    expect(await cells.getExecutionBlocks(editor, [[0, 0], end])).toEqual([
      { code: "%%time -n 3", row: 0, cellType: "code" },
    ]);
    expect(await cells.getExecutionBlocks(editor, [end, end])).toEqual([
      { code: "%%time -n 3", row: 0, cellType: "code" },
    ]);
  });

  it("classifies without copying body text and keeps lazy source on its original revision", async () => {
    await open("# %% [markdown]\n# Original heading\n", "language-ipython", "cell-model.ipy");
    const reads = spyOn(editor, "getTextInBufferRange").and.callThrough();
    const descriptor = (
      await cells.getCellDescriptors(editor, [
        [1, 0],
        [1, 0],
      ])
    )[0];
    expect(descriptor.cellType).toBe("markdown");
    expect(Object.getOwnPropertyDescriptor(descriptor, "source").get).toEqual(
      jasmine.any(Function),
    );
    expect(reads).not.toHaveBeenCalled();
    editor.setText("# %% [raw]\nNew bytes\n");
    const fresh = (await cells.getCellDescriptors(editor))[0];
    expect(fresh.cellType).toBe("raw");
    expect(descriptor.source).toBe("# Original heading\n");
    expect(fresh.source).toBe("New bytes\n");
    expect(reads).toHaveBeenCalledTimes(1);
    expect(fresh.source).toBe("New bytes\n");
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("retries a cooperative traversal when an edit wins during its yield", async () => {
    await open(
      Array.from({ length: 600 }, (_, index) => "# %%\nvalue = " + index).join("\n"),
      "language-ipython",
      "cell-model.ipy",
    );
    const ready = jasmine.createSpy("ready");
    const subscription = cells.onDidUpdate(({ editor: changed }) => {
      if (changed === editor) ready();
    });
    try {
      const pending = cells.getCellDescriptors(editor);
      setImmediate(() =>
        editor.getBuffer().setTextInRange(
          [
            [0, 0],
            [0, 4],
          ],
          "# %% [raw]",
        ),
      );
      const descriptors = await pending;
      expect(descriptors.length).toBe(600);
      expect(descriptors[0].cellType).toBe("raw");
      expect(ready).toHaveBeenCalledTimes(1);
    } finally {
      subscription.dispose();
    }
  });

  it("cancels specified ranges if an edit shifts another cell into their coordinates", async () => {
    await open(
      "# %% Harmless\nharmless()\n# %% Code\ndangerous()\n",
      "language-ipython",
      "cell-model.ipy",
    );
    const mode = editor.getBuffer().getLanguageMode();
    const settle = mode.atTransactionEnd.bind(mode);
    let resume;
    const deferred = new Promise((resolve) => {
      resume = resolve;
    });
    spyOn(mode, "atTransactionEnd").and.returnValue(deferred);
    const selected = [
      [1, 0],
      [2, 0],
    ];
    const pendingBlocks = cells.getExecutionBlocks(editor, selected);
    const pendingDescriptors = cells.getCellDescriptors(editor, selected);
    editor.getBuffer().delete([
      [0, 0],
      [2, 0],
    ]);
    resume(await settle());
    expect(await pendingBlocks).toEqual([]);
    expect(await pendingDescriptors).toEqual([]);
    expect((await cells.getExecutionBlocks(editor)).map((block) => block.code)).toEqual([
      "dangerous()\n",
    ]);
  });
});
