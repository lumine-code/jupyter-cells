const { TextEditor } = require("lumine");
const cells = require("../lib/cells");
const CellMarkers = require("../lib/cell-markers");

describe("Cell indexes after syntax failures", () => {
  let editor, error;
  beforeEach(() => {
    editor = new TextEditor();
    editor.setText("# %%\nvalue = 1\n");
    editor.getBuffer().getLanguageMode().asynchronousSyntax = true;
    error = new Error("Parser unavailable");
    spyOn(editor, "whenGrammarSettled").and.rejectWith(error);
    spyOn(console, "error");
  });
  afterEach(() => {
    editor.destroy();
    cells.dispose();
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  it("handles a background index failure and does not retry it until the document changes", async () => {
    expect(cells.getCells(editor)).toEqual([]);
    await flush();
    expect(console.error).toHaveBeenCalledTimes(1);
    cells.getCells(editor);
    await flush();
    expect(editor.whenGrammarSettled).toHaveBeenCalledTimes(1);
    editor.getBuffer().append("next = 2\n");
    cells.getCells(editor);
    await flush();
    expect(editor.whenGrammarSettled).toHaveBeenCalledTimes(2);
  });
  it("handles failure of an automatically scheduled marker update", async () => {
    const markers = new CellMarkers();
    try {
      markers.watchEditor(editor);
      await flush();
      expect(console.error).toHaveBeenCalledTimes(1);
    } finally {
      markers.dispose();
    }
  });
  for (const getter of ["getSyntaxRequestEpoch", "getSyntaxGeneration"])
    it(`retries after ${getter} changes and still rejects explicit failed requests`, async () => {
      let epoch = 1;
      editor.getBuffer().getLanguageMode()[getter] = () => epoch;
      cells.getCells(editor);
      await flush();
      epoch++;
      cells.getCells(editor);
      await flush();
      expect(editor.whenGrammarSettled).toHaveBeenCalledTimes(2);
      await expectAsync(cells.refreshIndex(editor)).toBeRejectedWith(error);
    });
  it("does not report a background failure from an editor that has closed", async () => {
    let reject;
    editor.whenGrammarSettled.and.returnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    cells.getCells(editor);
    editor.destroy();
    reject(error);
    await flush();
    expect(console.error).not.toHaveBeenCalled();
  });
});
