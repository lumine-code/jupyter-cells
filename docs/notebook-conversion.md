# Notebook conversion

`jupyter-cells:import-notebook` opens a notebook as a source document. For a Python notebook, it creates literal `.ipy` code, Markdown, and raw cells and suggests an `.ipy` filename when you save. Saved results can appear inline when `jupyter-repl` is available. Other notebook languages retain their language's comment-prefixed non-code cells.

`jupyter-cells:export-notebook` writes the source document as an `.ipynb` notebook with code, Markdown, and raw cell types. Export does not require a running kernel; when one is available, its specification supplies the notebook's kernel metadata.

Column-zero marker lines are reserved inside literal Markdown and raw bodies too. Notebook import checks its constructed `.ipy` against the original cells and refuses a conversion that would change their count, types or source, naming the source cell and line. Open such a notebook directly to retain its original structure; marker text inside Python strings remains ordinary source.

Marker headers are structure rather than cell source. One newline before the next marker separates cells and is excluded from the exported source. Additional trailing newlines belong to the preceding cell and are preserved. For example, leave a blank line before the next marker when the cell's source must end with a newline. Empty explicit cells remain cells, and the final cell keeps its source through the end of the file. Literal `.ipy` descriptors and imported or exported notebook sources preserve CRLF, lone CR and LF exactly, including literal `#` prefixes. When a source ends in a lone CR, import uses a CRLF separator before the next marker to keep that source CR intact. Execution blocks normalize line endings to LF.

See the [IPython and Jupyter cells guide](https://github.com/lumine-code/jupyter-repl/blob/master/docs/4_ipython.md) for writing source cells, magics, execution and Python analysis.
