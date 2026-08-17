const { nextCell, previousCell, selectCell, moveCellDown } = require("../lib/cell-navi");

describe("cell navigation", () => {
  let editor;

  const open = async (grammarPackage, fileName, text) => {
    await lumine.packages.activatePackage(grammarPackage);
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

    nextCell(editor);
    expect(editor.getCursorBufferPosition().row).toBe(2);
    nextCell(editor);
    expect(editor.getCursorBufferPosition().row).toBe(4);

    previousCell(editor);
    expect(editor.getCursorBufferPosition().row).toBe(2);
  });

  it("selects the cell around the cursor", async () => {
    await open("language-python", "cell-navi.py", "a = 1\n# %%\nb = 2\nc = 3\n# %%\nd = 4\n");
    editor.setCursorBufferPosition([2, 0]);

    selectCell(editor);

    const range = editor.getSelectedBufferRange();
    expect(range.start.row).toBe(1);
    expect(range.end.row).toBe(4);
  });

  it("invents the boundary marker in the grammar's own comment syntax", async () => {
    // The moved preamble needs a marker of its own; it used to be hard-coded
    // as "# %%", which is wrong for every language that does not comment
    // with a hash.
    await open("language-javascript", "cell-navi-example.js", "a = 1;\n// %%\nb = 2;\n");
    editor.setCursorBufferPosition([0, 0]);

    moveCellDown(editor);

    expect(editor.getText()).toContain("// %%\na = 1;");
    expect(editor.getText()).not.toContain("# %%");
  });

  it("does nothing, without throwing, in a grammar with no comment syntax", async () => {
    editor = await lumine.workspace.open("cell-navi.txt");
    editor.getBuffer().setText("a\nb\nc\n");
    editor.setCursorBufferPosition([0, 0]);

    expect(() => nextCell(editor)).not.toThrow();
    expect(editor.getCursorBufferPosition().row).toBe(0);
  });
});
