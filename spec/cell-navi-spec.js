const { nextCell, previousCell, selectCell, moveCellDown } = require("../lib/cell-navi");
const { getCommentStartString, getCellDescriptors } = require("../lib/cells");
const path = require("path");

describe("cell navigation", () => {
  let editor;

  const open = async (grammarPackage, fileName, text) => {
    await lumine.packages.activatePackage(
      grammarPackage === "language-ipython"
        ? path.resolve(__dirname, "..", "..", grammarPackage)
        : grammarPackage,
    );
    editor = await lumine.workspace.open(fileName);
    editor.getBuffer().setText(text);
    const languageMode = editor.getBuffer().getLanguageMode();
    if (languageMode.atTransactionEnd) {
      await languageMode.atTransactionEnd();
    }
    return editor;
  };

  it("moves the cursor between cells", async () => {
    await open("language-python", "cell-navi.py", "a = 1\n# %%\nb = 2\n# %%\nc = 3\n");
    editor.setCursorBufferPosition([0, 0]);

    await nextCell(editor);
    expect(editor.getCursorBufferPosition().row).toBe(2);
    await nextCell(editor);
    expect(editor.getCursorBufferPosition().row).toBe(4);

    await previousCell(editor);
    expect(editor.getCursorBufferPosition().row).toBe(2);
  });

  it("selects the cell around the cursor", async () => {
    await open("language-python", "cell-navi.py", "a = 1\n# %%\nb = 2\nc = 3\n# %%\nd = 4\n");
    editor.setCursorBufferPosition([2, 0]);

    await selectCell(editor);

    const range = editor.getSelectedBufferRange();
    expect(range.start.row).toBe(1);
    expect(range.end.row).toBe(4);
  });

  it("uses AST boundaries for IPython navigation and selects a markerless code file", async () => {
    await open(
      "language-ipython",
      "cell-navi.ipy",
      'value = """\n# %% [raw]\ninside\n"""\n# %% [markdown]\n# Heading\n# %% [raw]\nbytes',
    );
    editor.setCursorBufferPosition([0, 0]);
    await nextCell(editor);
    expect(editor.getCursorBufferPosition().row).toBe(5);
    await nextCell(editor);
    expect(editor.getCursorBufferPosition().row).toBe(7);
    await previousCell(editor);
    expect(editor.getCursorBufferPosition().row).toBe(5);
    editor.setText("value = 1\n");
    await selectCell(editor);
    expect(editor.getSelectedText()).toBe("value = 1\n");
  });

  it("invents the boundary marker in the grammar's own comment syntax", async () => {
    // The moved preamble needs a marker of its own; it used to be hard-coded
    // as "# %%", which is wrong for every language that does not comment
    // with a hash.
    await open("language-javascript", "cell-navi-example.js", "a = 1;\n// %%\nb = 2;\n");
    editor.setCursorBufferPosition([0, 0]);

    await moveCellDown(editor);

    expect(editor.getText()).toContain("// %%\na = 1;");
    expect(editor.getText()).not.toContain("# %%");
  });

  it("preserves typed source and its trailing newlines when moving a cell", async () => {
    await open(
      "language-ipython",
      "cell-navi.ipy",
      "# %%\nvalue = 1\n\n# %% [markdown]\n# Heading\n# %% [raw]\nbytes",
    );
    const before = await getCellDescriptors(editor);
    editor.setCursorBufferPosition([4, 0]);
    await moveCellDown(editor);
    const after = await getCellDescriptors(editor);
    expect(after.map((cell) => [cell.cellType, cell.source])).toEqual(
      [before[0], before[2], before[1]].map((cell) => [cell.cellType, cell.source]),
    );
  });

  it("does nothing, without throwing, in a grammar with no comment syntax", async () => {
    editor = await lumine.workspace.open("cell-navi.txt");
    editor.getBuffer().setText("a\nb\nc\n");
    editor.setCursorBufferPosition([0, 0]);

    await nextCell(editor);
    expect(editor.getCursorBufferPosition().row).toBe(0);
  });

  it("looks up an indented line and falls back to a block-comment opener", () => {
    const getCommentDelimitersForBufferPosition = jasmine
      .createSpy("getCommentDelimitersForBufferPosition")
      .and.returnValue({ block: ["/* ", " */"] });
    const fakeEditor = {
      getCursorBufferPosition: () => ({ row: 2, column: 11 }),
      lineTextForBufferRow: () => "    value",
      getCommentDelimitersForBufferPosition,
    };

    expect(getCommentStartString(fakeEditor)).toBe("/*");
    expect(getCommentDelimitersForBufferPosition).toHaveBeenCalledWith([2, 4]);
  });
});
