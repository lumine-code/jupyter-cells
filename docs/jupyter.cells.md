# jupyter.cells

The `# %%` cell model of an editor: ranges, types, and boundary positions.

|             |                                                                 |
| ----------- | --------------------------------------------------------------- |
| Version     | `1.0.0`                                                         |
| Provided by | `provideJupyterCells()` returning the query object              |
| Consumed by | `consumeJupyterCells(cells)` returning a `Disposable`           |
| Owner       | [`jupyter-cells`](https://github.com/lumine-code/jupyter-cells) |

A cell is a run of buffer between two markers — a comment reading `%%` in the grammar's own comment syntax, a `<codecell>` tag, or an `In[n]` prompt from an exported notebook. This service answers questions about that structure without the consumer owning a scanner of its own: the scrollbar layer draws the boundaries, and jupyter-repl reads cell types where its run paths meet marker files. It absorbed the retired `jupyter.breakpoints` contract, whose members live on here unchanged.

## Registration

In your `package.json`:

```json
{
  "consumedServices": {
    "jupyter.cells": {
      "versions": { "^1.0.0": "consumeJupyterCells" }
    }
  }
}
```

## Contract

```ts
type JupyterCells = {
  getCell(editor: TextEditor, point?: Point): Range;
  getCurrentCell(editor: TextEditor): Range;
  getMetadataForRow(editor: TextEditor, point: Point): "codecell" | "markdown";
  removeCommentsMarkdownCell(editor: TextEditor, text: string): string;
  getBreakpoints(editor: TextEditor): Point[];
  initBreakpoints(editor: TextEditor): Point[];
  onDidUpdate(callback: (event: { editor: TextEditor; breakpoints: Point[] }) => void): Disposable;
};
```

| Member                                | Description                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `getCell(editor, point)`              | The cell around the point — the cursor when omitted. The whole buffer when there is no marker. |
| `getCurrentCell(editor)`              | The same at the cursor, but fenced-code-block aware for markdown-family grammars.              |
| `getMetadataForRow(editor, point)`    | The type of the cell holding the row, from the nearest marker at or above it.                  |
| `removeCommentsMarkdownCell(e, text)` | A markdown cell's text with the leading comment tokens stripped and de-indented.               |
| `getBreakpoints(editor)`              | The cell boundaries as buffer positions. `[]` for an editor with none, or with no buffer.      |
| `initBreakpoints(editor)`             | The same, but `[]` while the user has cell markers switched off. **Use this one to draw.**     |
| `onDidUpdate(callback)`               | Fires when an editor's boundaries may have changed, carrying that editor's current list.       |

## Minimal example

```js
module.exports = {
  consumeJupyterCells(cells) {
    this.cells = cells;
    return cells.onDidUpdate(({ editor }) => this.redraw(editor));
  },

  rowsFor(editor) {
    return (this.cells?.initBreakpoints(editor) ?? []).map((point) => point.row);
  },
};
```

## Behavior

**Prefer `initBreakpoints` over `getBreakpoints` when drawing.** They return the same positions, but `initBreakpoints` respects the `jupyter-cells.cellMarkers` setting and returns `[]` when the user has cell markers turned off. Using `getBreakpoints` directly draws markers the user asked not to see; it exists for consumers computing rather than drawing.

The **end-of-file boundary is excluded** from both. Cells are delimited internally by a list that ends with the buffer's end position; the service trims it, so the positions you get are real dividers, not the final terminator. A file with three cells yields two boundaries.

`onDidUpdate` fires only while the cell-markers decoration is on — it rides the same scan that paints the boundary lines. It says that something _may_ have changed for that editor; re-query rather than diffing, and do not expect a replay on subscribe.

`getMetadataForRow` answers `"codecell"` for a file with no markers, for multilanguage grammars, and for everything above the first marker — the absence of a marker is an answer, not an error. An editor with no buffer yields `[]` from the boundary members rather than throwing.

The queries are backed by one marker index per buffer, rebuilt lazily after an edit — asking many times in a row costs one scan, so there is no need to cache answers on the consumer side.

## Teardown

`consumeJupyterCells` receives the query object for as long as both packages are active. `onDidUpdate` returns a `Disposable`; return it from your consumer method, and clear whatever you drew.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
