describe("Cell boundaries with no grammar", () => {
  let cells, editor, markers;

  beforeEach(async () => {
    await lumine.packages.activatePackage("jupyter-cells");
    cells = require("../lib/cells");
    const CellMarkers = require("../lib/cell-markers");
    await lumine.packages.activatePackage("language-python");
    editor = await lumine.workspace.open("none-cells.py");
    editor.setText("# %% First\nfirst = 1\n# %% Second\nsecond = 2\n");
    await editor.whenGrammarSettled();
    markers = new CellMarkers();
    markers.watchEditor(editor);
    await conditionPromise(() => editor.buffer.cellMarkerLayer.getMarkerCount() === 2);
  });

  afterEach(() => {
    markers.dispose();
    editor.destroy();
    cells.dispose();
  });

  it("clears existing boundaries on a grammar change and resumes after a grammar is restored", async () => {
    const updates = jasmine.createSpy("updates");
    const subscription = markers.onDidUpdate(updates);
    try {
      lumine.grammars.assignGrammar(editor, lumine.grammars.nullGrammar);
      await conditionPromise(() => editor.buffer.cellMarkerLayer.getMarkerCount() === 0);
      expect(updates.calls.mostRecent().args[0].breakpoints).toEqual([]);

      lumine.grammars.autoAssignLanguageMode(editor.buffer);
      await conditionPromise(() => editor.buffer.cellMarkerLayer.getMarkerCount() === 2);
      expect(updates.calls.mostRecent().args[0].breakpoints.map((point) => point.row)).toEqual([
        0, 2,
      ]);
    } finally {
      subscription.dispose();
    }
  });

  it("does not paint an old index after real to None to real changes in the same turn", async () => {
    markers.unwatchEditor(editor);
    const grammar = editor.getGrammar();
    const pending = cells.updateCellMarkers(editor);
    lumine.grammars.assignGrammar(editor, lumine.grammars.nullGrammar);
    editor.buffer.cellMarkerLayer.clear();
    editor.setText("# %% Fresh\nfresh = 1\n");
    lumine.grammars.assignGrammar(editor, grammar);

    await pending;
    expect(editor.buffer.cellMarkerLayer.getMarkerCount()).toBe(0);
    await cells.updateCellMarkers(editor);
    expect(editor.buffer.cellMarkerLayer.getMarkerCount()).toBe(1);
  });

  it("does not settle syntax or read the document while None is selected", async () => {
    lumine.grammars.assignGrammar(editor, lumine.grammars.nullGrammar);
    await conditionPromise(() => editor.buffer.cellMarkerLayer.getMarkerCount() === 0);
    spyOn(editor, "whenGrammarSettled").and.callThrough();
    spyOn(editor, "getText").and.callThrough();
    spyOn(editor, "lineTextForBufferRow").and.callThrough();
    spyOn(editor.buffer, "analyzeSyntax").and.callThrough();

    expect(cells.getCells(editor)).toEqual([]);
    expect(cells.getBreakpoints(editor)).toEqual([]);
    expect(await cells.getCellDescriptors(editor)).toEqual([]);
    expect(await cells.getExecutionBlocks(editor)).toEqual([]);
    expect(editor.whenGrammarSettled).not.toHaveBeenCalled();
    expect(editor.getText).not.toHaveBeenCalled();
    expect(editor.lineTextForBufferRow).not.toHaveBeenCalled();
    expect(editor.buffer.analyzeSyntax).not.toHaveBeenCalled();
  });
});
