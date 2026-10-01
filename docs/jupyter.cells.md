# jupyter.cells

The cell model of an editor: settled ranges, source, types, and boundaries.

|             |                                                                 |
| ----------- | --------------------------------------------------------------- |
| Version     | `1.0.0`                                                         |
| Provided by | `provideJupyterCells()` returning the query object              |
| Consumed by | `consumeJupyterCells(cells)` returning a `Disposable`           |
| Owner       | [`jupyter-cells`](https://github.com/lumine-code/jupyter-cells) |

An IPython document uses its existing root syntax tree to find cell markers, literal Markdown and raw cells. A marker inside a string, a bracketed expression, an indented suite or a continued line is not a boundary. Other source languages retain percent markers in their own comment syntax, legacy `<codecell>` tags and exported `In[n]` prompts. Fragment editors inside a notebook remain one code cell: the notebook owns their type and structure.

The IPython root contains `code_cell`, `markdown_cell` and `raw_cell` scaffolds. The index reads their marker fields and direct `cell_magic` body fields; opaque body contents and the injected native Python tree do not define cell boundaries. Source before the first marker remains an implicit code cell.

## Registration

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
type CellType = "code" | "markdown" | "raw";
type CellDescriptor = { range: Range; cellType: CellType; source: string };
type ExecutionBlock = { code: string; row: number; cellType: CellType };
type JupyterCells = {
  getCellDescriptors(editor: TextEditor, range?: Range): Promise<CellDescriptor[]>;
  getExecutionBlocks(editor: TextEditor, range?: Range): Promise<ExecutionBlock[]>;
  getCell(editor: TextEditor, point?: Point): Range | null;
  getCurrentCell(editor: TextEditor): Range | null;
  getBreakpoints(editor: TextEditor): Point[];
  initBreakpoints(editor: TextEditor): Point[];
  onDidUpdate(callback: (event: { editor: TextEditor; breakpoints: Point[] }) => void): Disposable;
};
```

`getCellDescriptors` waits for the current parse transaction and returns cells in buffer order. Omit the range to read the document; an empty range locates its whole containing cell, including when the point is on a marker header. A nonempty range clips the source of every intersecting cell, preserving their individual types. Descriptor ranges exclude marker headers and the one newline separating a body from the next header. The source field is read lazily and retains the descriptor's original text revision even if the editor changes before it is read, so classifying a cursor does not copy a large body. Literal IPython source remains unchanged apart from newline normalization; legacy commented Markdown and raw source has its comment prefixes removed and is de-indented. Empty explicit cells remain descriptors so notebook conversion preserves them.

`getExecutionBlocks` uses the same snapshot and omits whitespace-only bodies. Its row is the last meaningful source row for an inline result. Selecting any part of a cell magic, including a partial header, restores its complete original header and arguments exactly once, followed by the selected physical body beginning on the next row. Leading blank body rows and trailing comments remain inside the logical magic. An empty range inside a magic selects that whole magic, while omitted-range and whole-cell requests preserve their complete source. Raw remains a typed block; execution consumers skip it before kernel selection, while Markdown renders locally without a kernel.

An empty descriptor body has no execution block. Skip it instead of passing its empty range back to preparation, where an empty range means a cursor locator and can coincide with the following header. Both asynchronous methods capture specified range coordinates at invocation and return `[]` if the buffer changes while awaiting the index; they never reinterpret those coordinates against a shifted document. Omitting the range permits a bulk query to refresh safely to the latest revision.

The synchronous geometry members read the current metadata index. `getCell` locates the cell around a point or cursor; `getCurrentCell` also understands fenced code blocks in Markdown-family grammars. An IPython index still catching up returns `null` or `[]`, starts one shared asynchronous refresh and announces the settled result through `onDidUpdate`; await a descriptor query before using geometry for an action. Geometry covers the body through the following boundary, whereas descriptor source excludes the structural separator.

## Boundary drawing

Prefer `initBreakpoints` when drawing: it returns `[]` while `jupyter-cells.cellMarkers` is off. `getBreakpoints` answers real marker positions regardless of that setting. Both exclude the internal end-of-file terminator, and an editor without a buffer yields `[]`.

`onDidUpdate` fires after an index settles and when boundary decorations change. It carries the editor and the currently drawable boundaries; re-query instead of diffing, and do not expect replay when subscribing.

```js
module.exports = {
  consumeJupyterCells(cells) {
    this.cells = cells;
    return cells.onDidUpdate(({ editor }) => this.redraw(editor));
  },
  async runSelection(editor) {
    const blocks = await this.cells.getExecutionBlocks(editor, editor.getSelectedBufferRange());
    return this.execution.runBlocks(editor, blocks);
  },
};
```

## Markers and caching

A complete run of two or more percent signs is one boundary: `# %% Title`, `# %%% Child` and `# %%%% Grandchild` expose increasing outline levels. IPython types are `# %%`, `# %% [markdown]` and `# %% [raw]`; `[code]` explicitly selects code and `[md]` abbreviates Markdown. Bare words are titles, so `# %% markdown notes` and `# %% raw Bytes` remain code. Other source languages retain their legacy bare `md`/`markdown` metadata.

Column-zero marker lines are reserved in literal Markdown and raw bodies. Python notebook import validates the generated document against the original normalized cells through these settled descriptors and refuses a conversion that would alter their count, types or source. It preserves the original notebook and any edits made while validation awaits the tree.

The metadata index is shared per buffer and settled revision. Concurrent readers share one pending refresh; repeated reads reuse it and point lookups use binary search. It stores positions and types, never syntax-node references or copied source strings. Source is materialized only when a descriptor's source field is read. Large root traversals yield in bounded chunks, and an edit during a yield discards the unfinished index and retries against the new settled tree. Edits invalidate it synchronously, and a changed revision during an asynchronous wait causes a retry.

## Teardown and compatibility

`consumeJupyterCells` receives the object while both packages are active. Dispose update subscriptions and clear whatever you drew when the service leaves. This preproduction contract uses `code`, `markdown` and `raw` throughout; the former metadata/decomment helpers are replaced by descriptors and prepared execution blocks without compatibility aliases.
