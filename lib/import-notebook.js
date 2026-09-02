const path = require("path");
const { promises } = require("fs");
const { readFile } = promises;

const { getCommentStartString } = require("./cells");
const services = require("./services");
const linesep = process.platform === "win32" ? "\r\n" : "\n";

// Valid nbformat v4 output types
const VALID_OUTPUT_TYPES = new Set(["execute_result", "display_data", "stream", "error"]);

/**
 * Sanitizes notebook data by filtering out non-standard output types
 * that may be present in some notebooks (e.g., "status", "execute_input")
 * but are not part of the nbformat v4 specification.
 *
 * @param {Object} data - Raw notebook JSON data
 * @returns {Object} - Sanitized notebook data
 */
function sanitizeNotebookData(data) {
  if (!data.cells) {
    return data;
  }

  return {
    ...data,
    cells: data.cells.map((cell) => {
      if (cell.cell_type !== "code" || !Array.isArray(cell.outputs)) {
        return cell;
      }

      const validOutputs = cell.outputs.filter((output) =>
        VALID_OUTPUT_TYPES.has(output.output_type),
      );

      if (validOutputs.length !== cell.outputs.length) {
        return { ...cell, outputs: validOutputs };
      }

      return cell;
    }),
  };
}

/**
 * Determines if the provided uri is a valid file for Jupyter to import. Then
 * it loads the notebook.
 *
 * @param {String} uri - Uri of the file to open.
 */
function ipynbOpener(uri) {
  if (
    path.extname(uri).toLowerCase() !== ".ipynb" ||
    lumine.config.get("jupyter-cells.importNotebookURI") !== true
  ) {
    return undefined;
  }
  // A notebook viewer beats an import: jupyter-view opens the file as a real
  // notebook. This package activates eagerly, so its opener registers early —
  // yielding must not depend on registration order. Loaded rather than active:
  // the viewer owning `.ipynb` must not depend on which package happened to
  // activate first.
  if (lumine.packages.getLoadedPackage("jupyter-view")) {
    return undefined;
  }
  return _loadNotebook(uri, lumine.config.get("jupyter-cells.importNotebookResults"));
}

/**
 * Determines if the provided event is trying to open a valid file for Jupyter
 * to import. Otherwise it will ask the user to chose a valid file for Jupyter
 * to import. Then it loads the notebook.
 *
 * @param {Event} event - Lumine Event from clicking in a treeview.
 */
async function importNotebook(event) {
  // tree-view way fallback
  // Use selected filepath if called from tree-view context menu. The command is
  // registered on `lumine-workspace`, so `event.target` is the element that was
  // right-clicked — resolve the row it belongs to, which is what carries the path.
  const filenameFromTreeView = event.target
    ?.closest?.('.tree-view [is="tree-view-file"]')
    ?.getPath?.();
  if (filenameFromTreeView && path.extname(filenameFromTreeView) === ".ipynb") {
    return _loadNotebook(
      filenameFromTreeView,
      lumine.config.get("jupyter-cells.importNotebookResults"),
    );
  }
  // command way fallback
  const filePaths = await new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ipynb";
    input.multiple = true;
    input.addEventListener("change", () => resolve(Array.from(input.files).map((f) => f.path)));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
  if (filePaths.length === 0) {
    return;
  }
  for (const filePath of filePaths) {
    if (path.extname(filePath) !== ".ipynb") {
      lumine.notifications.addError("Selected file must have extension .ipynb");
      continue;
    }
    _loadNotebook(filePath, lumine.config.get("jupyter-cells.importNotebookResults"));
  }
}

/**
 * Reads the given notebook file and coverts it to a text editor format with
 * Jupyter cell markers. Optionally after opening the notebook, it will also
 * load the previous results and display them.
 *
 * @param {String} filename - Path of the file.
 * @param {Boolean} importResults - Decides whether to display previous results
 */
async function _loadNotebook(filename, importResults = false) {
  let data;
  let nb;

  try {
    data = JSON.parse(await readFile(filename, { encoding: "utf-8" }));

    if (data.nbformat < 4) {
      lumine.notifications.addError("Only notebook version 4+ is supported");
      return;
    }

    // Sanitize notebook data to filter out non-standard output types
    data = sanitizeNotebookData(data);

    const { parseNotebook } = require("./nbformat");
    nb = parseNotebook(data);
  } catch (err) {
    if (err.name === "SyntaxError") {
      lumine.notifications.addError("Error not a valid notebook", {
        detail: err.stack,
      });
    } else {
      lumine.notifications.addError("Error reading file", {
        detail: err,
      });
    }

    return;
  }

  const editor = await lumine.workspace.open();
  // An open can decline, e.g. when the workspace center is full.
  if (!editor) {
    return;
  }
  const grammar = getGrammarForNotebook(nb);
  if (!grammar) {
    return;
  }
  lumine.grammars.assignLanguageMode(editor.getBuffer(), grammar.scopeName);
  const commentStartString = getCommentStartString(editor);

  if (!commentStartString) {
    lumine.notifications.addError("No comment symbol defined in root scope");
    return;
  }

  const nbCells = [];
  const sources = [];
  const resultRows = [];
  let previousBreakpoint = -1;
  nb.cells.forEach((cell) => {
    nbCells.push(cell);
    const hyCell = toJupyterCodeBlock(cell, `${commentStartString} `);
    resultRows.push(previousBreakpoint + hyCell.code.trim().split("\n").length);
    previousBreakpoint += hyCell.row;
    sources.push(hyCell.code);
  });
  editor.setText(sources.join(linesep));
  if (importResults) {
    importNotebookResults(editor, nbCells, resultRows);
  }
}

/**
 * Tries to determine the Lumine Grammar of a notebook. Default is Python.
 *
 * @param {Notebook} nb - The Notebook to determine the Lumine Grammar of.
 * @returns {Grammar} - The grammar of the notebook.
 */
function getGrammarForNotebook(nb) {
  const { kernelspec, language_info } = nb.metadata;

  const kernel = kernelspec;
  const lang = language_info;

  if (!kernel && !lang) {
    // The import succeeds either way and there is nothing to fix, so this says
    // what was assumed rather than warning about a notebook that is fine.
    lumine.notifications.addHint("No language metadata in notebook; assuming Python");
    return lumine.grammars.grammarForScopeName("source.python");
  }

  let matchedGrammar;

  if (lang) {
    // lang.name should be required
    matchedGrammar = getGrammarForLanguageName(lang.name);
    if (matchedGrammar) {
      return matchedGrammar;
    }

    // lang.file_extension is not required, but if lang.name retrieves no match,
    // this is the next best thing.
    if (lang.file_extension) {
      matchedGrammar = getGrammarForFileExtension(lang.file_extension);
    }

    if (matchedGrammar) {
      return matchedGrammar;
    }
  }

  if (kernel) {
    // kernel.language is not required, but its often more accurate than name
    matchedGrammar = getGrammarForLanguageName(kernel.language);
    if (matchedGrammar) {
      return matchedGrammar;
    }
    // kernel.name should be required, but is often a kernel name, so its hard
    // to match effciently
    matchedGrammar = getGrammarForKernelspecName(kernel.name);
    if (matchedGrammar) {
      return matchedGrammar;
    }
  }

  lumine.notifications.addWarning("Unable to determine correct language grammar");
  return lumine.grammars.grammarForScopeName("source.python");
}

/**
 * Tries to find a matching Lumine Grammar from a language name
 *
 * @param {String} name - The language name to find a grammar for.
 * @returns {Grammar} - The matching Lumine Grammar.
 */
function getGrammarForLanguageName(name) {
  if (!name) {
    return null;
  }
  const formattedName = name.toLowerCase().replace(" ", "-");
  const scopeName = `source.${formattedName}`;
  const grammars = lumine.grammars.getGrammars();

  for (const g of grammars) {
    if (g && ((g.name && g.name.toLowerCase() == name.toLowerCase()) || g.scopeName == scopeName)) {
      return g;
    }
  }

  return null;
}

/**
 * Tries to find a matching Lumine Grammar from a file extensions
 *
 * @param {String} ext - The file extension to find a grammar for.
 * @returns {Grammar} - The matching Lumine Grammar.
 */
function getGrammarForFileExtension(ext) {
  if (!ext) {
    return null;
  }
  ext = ext.startsWith(".") ? ext.slice(1) : ext;
  const grammars = lumine.grammars.getGrammars();
  return grammars.find((grammar) => {
    return grammar.fileTypes.includes(ext);
  });
}

/**
 * Tries to find a matching Lumine Grammar from KernelspecMetadata name
 *
 * @param {String} name - The KernelspecMetadata name to find a grammar for.
 * @returns {Grammar} - The matching Lumine Grammar.
 */
function getGrammarForKernelspecName(name) {
  // Check if there exists an Lumine grammar named source.${name}
  const grammar = getGrammarForLanguageName(name);
  if (grammar) {
    return grammar;
  }
  // Otherwise attempt manual matching from kernelspec name to Lumine scope
  const crosswalk = {
    python2: "source.python",
    python3: "source.python",
    bash: "source.shell",
    javascript: "source.js",
    ir: "source.r",
  };

  if (crosswalk[name]) {
    return lumine.grammars.grammarForScopeName(crosswalk[name]);
  }
}

/**
 * Converts notebook cells to Jupyter code blocks.
 *
 * @param {Cell} cell - Notebook cell to convert
 * @param {String} commentStartString - The comment syntax of the code language.
 * @returns {Object} - A Jupyter Code Block.
 */
function toJupyterCodeBlock(cell, commentStartString) {
  const cellType = cell.cell_type === "markdown" ? "markdown" : "codecell";
  const cellHeader = getCellHeader(commentStartString, cellType);
  let source = cell.source;
  let cellLength;

  if (cellType === "markdown") {
    source = source.split("\n");
    source[0] = commentStartString + source[0];
    cellLength = source.length;
    source = source.join(linesep + commentStartString);
  } else {
    cellLength = source.split("\n").length;
  }

  return {
    cellType,
    code: cellHeader + linesep + source,
    row: cellLength + 1, // plus 1 for the header
  };
}

/**
 * Creates a Jupyter cell header
 *
 * @param {String} commentStartString - The comment syntax of the code language.
 * @param {String} cellType - The normalized cell type.
 * @returns {String} - A Jupyter Cell Header.
 */
function getCellHeader(commentStartString, cellType) {
  const marker = `${commentStartString}%%`;
  return cellType === "markdown" ? `${marker} [markdown]` : marker;
}

/**
 * Displays previous cell results inline of the provided editor, through the
 * jupyter.execution service — the bubbles are jupyter-repl's. Without it the
 * source still imports; a hint says the saved results were left behind.
 * nbCells and resultRows should be the same length.
 *
 * @param {TextEditor} editor - The editor to display the results in.
 * @param {Cell[]} nbCells - The original notebook cells.
 * @param {Number[]} resultRows - The rows to display the results on.
 */
function importNotebookResults(editor, nbCells, resultRows) {
  if (nbCells.length != resultRows.length) {
    return;
  }
  const execution = services.getExecution();
  if (!execution) {
    lumine.notifications.addInfo(
      "Install the jupyter-repl package to render the notebook's saved results inline.",
    );
    return;
  }
  let cellNumber = 0;

  for (const cell of nbCells) {
    const row = resultRows[cellNumber];

    switch (cell.cell_type) {
      case "code":
        if (cell.outputs.length > 0) {
          execution.importOutputs(editor, {
            outputs: cell.outputs,
            row,
          });
        }

        break;

      case "markdown":
        execution.importOutputs(editor, {
          outputs: [execution.markdownToOutput(cell.source)],
          row,
        });
        break;
    }

    cellNumber++;
  }
}

module.exports = {
  ipynbOpener,
  importNotebook,
  _loadNotebook,
};
