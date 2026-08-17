// Reads and writes nbformat 4 notebooks as plain objects. This replaced
// @nteract/commutable, whose immutable model every call site converted away
// at the boundary anyway; what survives is the nbformat plumbing, kept
// byte-faithful to what commutable produced — key order, the 2-space
// stringify, the legacy jupyter/nteract cell-metadata blobs, and the
// multiline split — so an exported notebook diffs clean against one
// exported before the switch.

/** Normalize line endings to \n, as the on-disk format expects. */
function normalizeLineEndings(text) {
  return text ? text.replace(/\r\n/g, "\n") : text;
}

/** nbformat multiline strings (arrays of strings, for diffs) into strings. */
function demultiline(s) {
  return Array.isArray(s) ? s.join("") : s;
}

/** Split a string into newline-retaining chunks, the on-disk expectation. */
function remultiline(s) {
  if (Array.isArray(s)) {
    return s;
  }
  return s.split(/(.*?(?:\r\n|\n))/g).filter((x) => x !== "");
}

function isJSONKey(key) {
  return /^application\/(.*\+)json$/.test(key);
}

// Media-bundle values are multiline-encoded on disk except the JSON mimetypes,
// whose values are real JSON structures.
function demultilineBundle(data) {
  if (!data || typeof data !== "object") {
    return data;
  }
  const bundle = {};
  for (const key of Object.keys(data)) {
    bundle[key] = isJSONKey(key) ? data[key] : demultiline(data[key]);
  }
  return bundle;
}

function parseOutput(output) {
  switch (output.output_type) {
    case "stream":
      return { ...output, text: demultiline(output.text) };
    case "execute_result":
    case "display_data":
      return { ...output, data: demultilineBundle(output.data) };
    default:
      // error keeps its traceback as the array the format specifies; anything
      // unrecognized passes through, since the import path filters output
      // types before parsing.
      return output;
  }
}

function parseCell(cell) {
  const parsed = { ...cell, source: normalizeLineEndings(demultiline(cell.source ?? "")) };
  if (Array.isArray(cell.outputs)) {
    parsed.outputs = cell.outputs.map(parseOutput);
  }
  return parsed;
}

/**
 * A notebook's JSON as plain data with joined sources and output texts.
 * @param {Object} data - Parsed .ipynb JSON.
 * @returns {{cells: Object[], metadata: Object, nbformat: 4, nbformat_minor: number}}
 */
function parseNotebook(data) {
  if (!(data && typeof data === "object" && data.nbformat === 4 && data.nbformat_minor >= 0)) {
    throw new TypeError("Notebook is not a valid v4 notebook");
  }
  return {
    cells: (data.cells || []).map(parseCell),
    metadata: data.metadata || {},
    nbformat: 4,
    nbformat_minor: data.nbformat_minor,
  };
}

// The cell metadata below is what commutable stamped on every cell it
// created; it is kept verbatim so exports do not churn.
function makeCodeCell(source) {
  return {
    cell_type: "code",
    source: remultiline(normalizeLineEndings(source)),
    outputs: [],
    execution_count: null,
    metadata: {
      jupyter: { source_hidden: false, outputs_hidden: false },
      nteract: { transient: { deleting: false } },
    },
  };
}

function makeMarkdownCell(source) {
  return {
    cell_type: "markdown",
    source: remultiline(normalizeLineEndings(source)),
    metadata: {
      nteract: { transient: { deleting: false } },
    },
  };
}

/**
 * A complete v4.0 notebook around the given cells. 4.0 deliberately: cells
 * carry no ids at that version, which is what the exports always looked like.
 * @param {Object[]} cells - From makeCodeCell/makeMarkdownCell.
 * @param {Object} [kernelSpec] - Stamped as metadata.kernelspec when given.
 */
function makeNotebook(cells, kernelSpec) {
  return {
    cells,
    metadata: kernelSpec ? { kernelspec: kernelSpec } : {},
    nbformat: 4,
    nbformat_minor: 0,
  };
}

/** The exact serialization the exports always had: 2-space, no trailing newline. */
function stringifyNotebook(notebook) {
  return JSON.stringify(notebook, null, 2);
}

module.exports = {
  parseNotebook,
  makeCodeCell,
  makeMarkdownCell,
  makeNotebook,
  stringifyNotebook,
};
