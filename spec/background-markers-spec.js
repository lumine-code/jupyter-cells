const cells = require("../lib/cells");

describe("background cell boundary detection", () => {
  let editor, service, previousExecution;

  beforeEach(async () => {
    jasmine.useRealClock();
    previousExecution = lumine.grammars.syntaxExecution;
    lumine.grammars.syntaxExecution = "worker";
    lumine.config.set("jupyter-cells.cellMarkers", false);
    await lumine.packages.activatePackage("language-python");
    service = (await lumine.packages.activatePackage("jupyter-cells")).mainModule;
    editor = await lumine.workspace.open("background-cells.py");
  });

  afterEach(() => {
    editor?.destroy();
    lumine.grammars.syntaxExecution = previousExecution;
  });

  it("keeps marker-free background checks text-only and answers explicit queries", async () => {
    editor.setText("meaning = 42\r\nname = '日'\r\n");
    const ready = spyOn(editor, "whenGrammarSettled").and.callThrough();
    const analyze = spyOn(editor.getBuffer(), "analyzeSyntax").and.callThrough();
    lumine.config.set("jupyter-cells.cellMarkers", true);

    expect(service.provideJupyterCells().initBreakpoints(editor)).toEqual([]);
    expect(await cells.updateCellMarkers(editor, { background: true })).toEqual([]);
    expect(ready).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();

    const descriptors = await cells.getCellDescriptors(editor);
    expect(descriptors.map(({ source }) => source)).toEqual(["meaning = 42\nname = '日'\n"]);
    expect(analyze).toHaveBeenCalled();
  });

  it("asks exact syntax about candidates and clears dividers after their removal", async () => {
    editor.setText('value = "# %% not a comment"\n# %% A real header\nvalue = 1\n');
    cells.prepareCellDecoration(editor);
    const analyze = spyOn(editor.getBuffer(), "analyzeSyntax").and.callThrough();
    const breakpoints = await cells.updateCellMarkers(editor, { background: true });
    expect(breakpoints.map(({ row }) => row)).toEqual([1]);
    expect(editor.getBuffer().cellMarkerLayer.getMarkerCount()).toBe(1);
    expect(analyze).toHaveBeenCalled();

    editor.setText("value = 1\n");
    analyze.calls.reset();
    expect(await cells.updateCellMarkers(editor, { background: true })).toEqual([]);
    expect(analyze).not.toHaveBeenCalled();
    expect(editor.getBuffer().cellMarkerLayer.getMarkerCount()).toBe(0);
  });

  it("preserves marker forms already accepted by the legacy matcher", async () => {
    editor.setText("value = 1\r\n# In1]\r\nvalue = 2\r\n");
    const breakpoints = await cells.updateCellMarkers(editor, { background: true });
    expect(breakpoints.map(({ row }) => row)).toEqual([1]);
  });

  it("does not publish an earlier scan onto a replacement marker layer", async () => {
    editor.setText("# %% Header\nx = 1\n");
    cells.prepareCellDecoration(editor);
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const whenGrammarSettled = editor.whenGrammarSettled.bind(editor);
    const settle = spyOn(editor, "whenGrammarSettled").and.callFake(async () => {
      await gate;
      return whenGrammarSettled();
    });
    const pending = cells.updateCellMarkers(editor, { background: true });
    try {
      await conditionPromise(() => settle.calls.any());
      cells.destroyCellMarkers(editor);
      cells.prepareCellDecoration(editor);
      const replacement = editor.getBuffer().cellMarkerLayer;
      const sentinel = replacement.markPosition([1, 0]);
      release();
      expect(await pending).toEqual([]);
      expect(replacement.getMarkers()).toEqual([sentinel]);
    } finally {
      release();
    }
  });

  it("does not admit syntax work when its marker layer is removed during the text preflight", async () => {
    editor.setText("# %% Header\nx = 1\n");
    cells.prepareCellDecoration(editor);
    const ready = spyOn(editor, "whenGrammarSettled").and.callThrough();
    const pending = cells.updateCellMarkers(editor, { background: true });
    cells.destroyCellMarkers(editor);
    expect(await pending).toEqual([]);
    expect(ready).not.toHaveBeenCalled();
  });
});
