const { foldAllButCurrentCell, foldCurrentCell, getCells } = require("../lib/cells");

// Two bugs met here, in the package this code moved from. `foldAllButCurrentCell`
// dropped the first cell to skip a leading empty range that `getCells` already
// filters out, so the top of every file stayed unfolded; and with no cell
// markers at all it handed an empty array to setSelectedBufferRanges, which
// rejects one, so the command threw on the most ordinary file there is.
describe("cell folding", () => {
  let editor;

  // Cell markers are comments, so they need a grammar that defines one, and
  // `getBreakpoints` reads scopes — which only exist once the buffer has been
  // tokenized. Without the wait every file reads as a single cell.
  const openPython = async (text) => {
    await lumine.packages.activatePackage("language-python");
    editor = await lumine.workspace.open("cell-fold.py");
    editor.getBuffer().setText(text);
    const languageMode = editor.getBuffer().getLanguageMode();
    if (languageMode.atTransactionEnd) {
      await languageMode.atTransactionEnd();
    }
    return editor;
  };

  it("does nothing when the file has no cell markers", async () => {
    await openPython("a = 1\nb = 2\nc = 3\n");
    editor.setCursorBufferPosition([1, 0]);
    const before = editor.getSelectedBufferRanges();

    expect(() => foldAllButCurrentCell(editor)).not.toThrow();
    expect(editor.isFoldedAtBufferRow(0)).toBe(false);
    expect(editor.getSelectedBufferRanges()).toEqual(before);
  });

  it("folds every other cell, including the first, and restores the selection", async () => {
    // Each cell spans several rows: a one-row range has nothing to fold.
    await openPython("a = 1\nb = 2\n#%%\nc = 3\nd = 4\n#%%\ne = 5\nf = 6\n");
    expect(getCells(editor).length).toBe(3);
    editor.setCursorBufferPosition([3, 0]);
    const before = editor.getSelectedBufferRanges();

    foldAllButCurrentCell(editor);

    expect(editor.isFoldedAtBufferRow(0)).toBe(true);
    expect(editor.isFoldedAtBufferRow(6)).toBe(true);
    expect(editor.isFoldedAtBufferRow(3)).toBe(false);
    expect(editor.getSelectedBufferRanges()).toEqual(before);
  });

  it("folds the cell around the cursor", async () => {
    await openPython("a = 1\nb = 2\n#%%\nc = 3\nd = 4\n");
    editor.setCursorBufferPosition([3, 0]);

    foldCurrentCell(editor);

    expect(editor.isFoldedAtBufferRow(3)).toBe(true);
  });
});
