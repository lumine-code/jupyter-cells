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
async function buildNotebook(editor, kernelSpec) {
  const nbformat = require("./nbformat");
  const notebookCells = [];
  const descriptors = await cells.getCellDescriptors(editor);
  const sourceOptions = { preserveSourceLineEndings: cells.isIPythonDocument(editor) };

  for (const { source, cellType } of descriptors) {
    if (cellType === "code") {
      notebookCells.push(nbformat.makeCodeCell(source, sourceOptions));
    } else if (cellType === "markdown") {
      notebookCells.push(nbformat.makeMarkdownCell(source, sourceOptions));
    } else if (cellType === "raw") {
      notebookCells.push(nbformat.makeRawCell(source, sourceOptions));
    }
  }

  return nbformat.makeNotebook(notebookCells, kernelSpec);
}

async function exportNotebook(editor) {
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

  const kernelService = services.getKernel() ?? (await services.requestKernel());
  const kernelSpec = kernelService?.getKernelForEditor?.(editor)?.kernelSpec;
  try {
    const { stringifyNotebook } = require("./nbformat");
    await writeFile(fname, stringifyNotebook(await buildNotebook(editor, kernelSpec)));
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
