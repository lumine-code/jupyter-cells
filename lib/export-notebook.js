const path = require("path");
const os = require("os");
const { promises } = require("fs");
const { writeFile } = promises;

const cells = require("./cells");
const services = require("./services");

// The cell ranges of the editor as an nbformat notebook. Kernel metadata comes
// from the jupyter.kernel service when a kernel is live; a notebook without a
// kernelspec is still valid, so exporting works with no kernel and with no
// jupyter-repl at all.
function buildNotebook(editor, kernelSpec) {
  const commutable = require("@nteract/commutable");
  let notebook = commutable.emptyNotebook;

  if (kernelSpec) {
    notebook = notebook.setIn(["metadata", "kernelspec"], kernelSpec);
  }

  const cellRanges = cells.getCells(editor);

  cellRanges.forEach((cell) => {
    const { start, end } = cell;
    let source = cells.getTextInRange(editor, start, end);
    source = source ? source : "";
    // When the cell marker following a given cell range is on its own line,
    // the newline immediately preceding that cell marker is included in
    // `source`. We remove that here.
    if (source.slice(-1) === "\n") {
      source = source.slice(0, -1);
    }
    const cellType = cells.getMetadataForRow(editor, start);
    let newCell;

    if (cellType === "codecell") {
      newCell = commutable.emptyCodeCell.set("source", source);
    } else if (cellType === "markdown") {
      source = cells.removeCommentsMarkdownCell(editor, source);
      newCell = commutable.emptyMarkdownCell.set("source", source);
    }

    notebook = commutable.appendCellToNotebook(notebook, newCell);
  });

  return commutable.toJS(notebook);
}

async function exportNotebook() {
  const editor = lumine.workspace.getActiveTextEditor();
  if (!editor) {
    return;
  }
  const editorPath = editor.getPath();
  const directory = editorPath ? path.dirname(editorPath) : os.homedir();
  const rawFileName = editorPath ? path.basename(editorPath, path.extname(editorPath)) : "untitled";
  const noteBookPath = path.join(directory, `${rawFileName}.ipynb`);

  const { canceled, filePath } = await lumine.window.showSaveDialog({
    title: editor.getTitle(),
    defaultPath: noteBookPath,
  });
  if (!canceled) {
    await saveNoteBook(editor, filePath);
  }
}

async function saveNoteBook(editor, filePath) {
  if (filePath.length === 0) {
    return;
  }
  // add default extension
  const ext = path.extname(filePath) === "" ? ".ipynb" : "";
  const fname = `${filePath}${ext}`;

  const kernelSpec = services.getKernel()?.getActiveKernel()?.kernelSpec;
  try {
    const { stringifyNotebook } = require("@nteract/commutable");
    await writeFile(fname, stringifyNotebook(buildNotebook(editor, kernelSpec)));
    lumine.notifications.addSuccess("Save successful", {
      detail: `Saved notebook as ${fname}`,
    });
  } catch (err) {
    lumine.notifications.addError("Error saving file", {
      detail: err.message,
    });
  }
}

module.exports = {
  exportNotebook,
  buildNotebook,
};
