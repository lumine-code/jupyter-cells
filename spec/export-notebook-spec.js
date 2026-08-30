const { exportNotebook } = require("../lib/export-notebook");

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
