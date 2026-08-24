# jupyter-cells

Navigate, run, and organize code cells marked with # %% comments.

A `# %%` comment splits a plain source file into runnable cells — the script twin of a Jupyter notebook. This package owns that structure in the editor: moving between cells, selecting, reordering and folding them, drawing their boundaries, running them through the jupyter-repl package's kernels, and converting to and from `.ipynb` notebooks.

## Features

- **Cell markers**: recognizes `%%` comments in every grammar's own comment syntax, plus `<codecell>` tags and `In[n]` prompts from exported notebooks.
- **Run commands**: runs a cell, every cell, or everything above the cursor through the jupyter-repl package, with recalculate variants that restart the kernel first.
- **Navigation**: moves the cursor between cells, and selects or extends the selection cell by cell.
- **Reordering**: swaps a cell with its neighbour above or below, inventing the boundary marker where the file's top needs one.
- **Folding**: folds the current cell, or everything except it.
- **Boundary lines**: draws a line on every marker row, live with the setting and customisable from your stylesheet, and shows the same boundaries on the scrollbar and minimap via the marker hub.
- **Notebook import and export**: opens an `.ipynb` as a marker file — rendering its saved results inline when jupyter-repl is present — and writes a marker file back out as a notebook.
- **Code lenses**: offers Run Cell and Run All Above links above each marker through the code-lens package.
- **Markdown cells**: a `# %% md` cell renders as markdown instead of executing.

## Installation

To install `jupyter-cells` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/jupyter-cells`.

## Commands

Commands available in `lumine-workspace`:

- `jupyter-cells:run-cell`: run the cell holding the cursor,
- `jupyter-cells:run-cell-and-move-down`: run the cell holding the cursor and move on to the next,
- `jupyter-cells:run-all`: run every cell in the file, from the top,
- `jupyter-cells:run-all-above`: run every cell above the cursor,
- `jupyter-cells:recalculate-all`: restart the kernel, clear the results, and run everything,
- `jupyter-cells:recalculate-all-above`: restart the kernel and run everything above the cursor,
- `jupyter-cells:go-to-next-cell`: move the cursor to the start of the next cell,
- `jupyter-cells:go-to-previous-cell`: move the cursor to the start of the previous cell,
- `jupyter-cells:select-cell`: select the whole of the cell holding the cursor,
- `jupyter-cells:select-previous-cell`: extend the selection to take in the previous cell,
- `jupyter-cells:select-next-cell`: extend the selection to take in the next cell,
- `jupyter-cells:move-cell-up`: swap this cell with the one above it,
- `jupyter-cells:move-cell-down`: swap this cell with the one below it,
- `jupyter-cells:fold-current-cell`: fold the cell holding the cursor,
- `jupyter-cells:fold-all-but-current-cell`: fold every cell except the one holding the cursor,
- `jupyter-cells:import-notebook`: open an ipynb notebook as a source file,
- `jupyter-cells:export-notebook`: write this file out as an ipynb notebook.

## Customization

The boundary line drawn on marker rows can be adjusted in the `styles.css` file, e.g. change its color:

```css
.line.jupyter-cells-breakpoint::before {
  --jupyter-cells-breakpoint-color: var(--accent-color);
  height: 2px;
}
```

## Services

- [`jupyter.cells`](docs/jupyter.cells.md): provided to answer cell ranges, types, and boundary positions — to the scrollbar marker layer, and to jupyter-repl's own run paths.
- `code-lens.provider`: provided to render Run Cell and Run All Above links above each cell marker.
- `marker.layer`: provided to draw the cell boundaries on the editor's overview maps (scrollbar, minimap).
- `jupyter.execution`: consumed to run the computed cells through jupyter-repl's kernels and result bubbles.
- `jupyter.kernel`: consumed to stamp the running kernel's spec into an exported notebook.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
