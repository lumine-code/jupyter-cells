const { getBreakpoints, getCells, getMarkerIndex, getMetadataForRow } = require("../lib/cells");
const { Point } = require("lumine");

// Every query here used to sweep the whole buffer on every call, so a caller
// walking each row of a file paid O(rows²) and froze the window for seconds.
// These pin the property that keeps it linear — the marker scan happens once
// per buffer state — and the semantics alongside it, since both are invisible
// in the results.
describe("the cell marker index", () => {
  let editor;

  // Cell markers are comments, so they need a grammar that defines one, and
  // getBreakpoints reads scopes — which only exist once the buffer has been
  // tokenized. Without the wait every file reads as a single cell.
  const open = async (text) => {
    await lumine.packages.activatePackage("language-python");
    editor = await lumine.workspace.open("cell-model.py");
    editor.getBuffer().setText(text);
    const languageMode = editor.getBuffer().getLanguageMode();
    if (languageMode.atTransactionEnd) {
      await languageMode.atTransactionEnd();
    }
    return editor;
  };

  // The legacy bare markdown spelling remains accepted alongside the preferred
  // bracketed metadata exercised below.
  const markers = ["# %%", "a = 1", "# %% markdown", "# text", "# %%", "b = 2"].join("\n");

  it("consumes every percent in a named marker while keeping one boundary", async () => {
    await open(
      ["# %% Top", "a = 1", "# %%% Child", "b = 2", "# %%%% Grandchild", "c = 3"].join("\n"),
    );

    const index = getMarkerIndex(editor);
    expect(
      index.markers.map(({ start, end }) => editor.getTextInBufferRange([start, end])),
    ).toEqual(["# %%", "# %%%", "# %%%%"]);
    expect(getBreakpoints(editor).map((point) => point.row)).toEqual([0, 2, 4, 5]);
  });

  it("recognizes bracketed markdown metadata before arbitrary titles", async () => {
    await open(
      ["# %% [md] Short title", "first", "# %%% [markdown] Nested title", "second"].join("\n"),
    );

    expect(getMetadataForRow(editor, new Point(1, 0))).toBe("markdown");
    expect(getMetadataForRow(editor, new Point(3, 0))).toBe("markdown");
  });

  it("keeps bare markdown metadata compatible and ignores its title", async () => {
    await open(["# %% md Short title", "first", "# %% markdown Long title", "second"].join("\n"));

    expect(getMetadataForRow(editor, new Point(1, 0))).toBe("markdown");
    expect(getMetadataForRow(editor, new Point(3, 0))).toBe("markdown");
  });

  it("treats a title starting with markdownish as a code cell", async () => {
    await open("# %% markdownish ordinary title\nvalue = 1\n");

    expect(getMetadataForRow(editor, new Point(1, 0))).toBe("codecell");
  });

  it("scans the buffer once for repeated queries at the same buffer state", async () => {
    await open(markers);
    const scans = spyOn(editor.getBuffer(), "scan").and.callThrough();

    for (let row = 0; row <= 5; row++) {
      getMetadataForRow(editor, new Point(row, 0));
    }
    getBreakpoints(editor);

    expect(scans.calls.count()).toBe(1);
  });

  it("rescans after the buffer changes", async () => {
    // TextBuffer carries no version counter, so the index invalidates on a
    // change subscription. Getting that wrong is invisible until an edit
    // moves a marker: every later query answers from the pre-edit scan.
    await open(markers);
    expect(getMetadataForRow(editor, new Point(1, 0))).toBe("codecell");
    const scans = spyOn(editor.getBuffer(), "scan").and.callThrough();

    // Turn the marker above row 1 into a markdown one, so that row's type
    // flips. The wait is for the re-tokenization the edit starts: the marker
    // regex is built from the grammar's comment string, which is
    // unavailable until it finishes.
    editor.getBuffer().setTextInRange(
      [
        [0, 0],
        [0, 4],
      ],
      "# %% markdown",
    );
    const languageMode = editor.getBuffer().getLanguageMode();
    if (languageMode.atTransactionEnd) {
      await languageMode.atTransactionEnd();
    }

    expect(getMetadataForRow(editor, new Point(1, 0))).toBe("markdown");
    expect(scans.calls.count()).toBe(1);
  });

  it("reports each row's cell type from the nearest marker above it", async () => {
    await open(markers);
    expect(getMetadataForRow(editor, new Point(0, 0))).toBe("codecell");
    expect(getMetadataForRow(editor, new Point(1, 0))).toBe("codecell");
    expect(getMetadataForRow(editor, new Point(2, 0))).toBe("markdown");
    expect(getMetadataForRow(editor, new Point(3, 0))).toBe("markdown");
    expect(getMetadataForRow(editor, new Point(4, 0))).toBe("codecell");
    expect(getMetadataForRow(editor, new Point(5, 0))).toBe("codecell");
  });

  it("reports codecell for a buffer with no markers at all", async () => {
    await open("a = 1\nb = 2\n");
    expect(getMetadataForRow(editor, new Point(1, 0))).toBe("codecell");
    expect(getBreakpoints(editor).length).toBe(1); // the end position alone
  });

  it("finds every marker as a breakpoint, in buffer order", async () => {
    await open(markers);
    const rows = getBreakpoints(editor).map((point) => point.row);
    expect(rows).toEqual([0, 2, 4, 5]); // three markers, then the end position
  });

  it("splits the buffer into cells at those markers", async () => {
    await open(markers);
    // The leading marker on row 0 opens an empty range, which getCells drops.
    const ranges = getCells(editor).map((cell) => [cell.start.row, cell.end.row]);
    expect(ranges).toEqual([
      [1, 2],
      [3, 4],
      [5, 5],
    ]);
  });
});
