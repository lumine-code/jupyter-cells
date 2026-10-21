const { Point, Range } = require("lumine");
const INDEX_CHUNK_NODES = 512,
  INDEX_SLICE_MS = 8;
const yieldIndex = () => new Promise((resolve) => setImmediate(resolve));
const point = (position) => new Point(position.row, position.column);

exports.embedded = async function (context, { position }, { signal }) {
  const scope = context
    .scopeDescriptorForBufferPosition(position)
    .getScopesArray()
    .find((scope, i) => i > 0 && scope.startsWith("source."));
  if (!scope) return null;
  let start = position.row,
    end = start,
    steps = 0;
  const embedded = (row) =>
    context.scopeDescriptorForBufferPosition([row, 0]).getScopesArray().includes(scope);
  const yieldIfNeeded = () =>
    ++steps % 64 === 0 ? yieldIndex().then(() => signal.throwIfAborted()) : null;
  while (start > 0 && embedded(start - 1)) {
    start--;
    const pending = yieldIfNeeded();
    if (pending) await pending;
  }
  while (end < context.getLastBufferRow() && embedded(end + 1)) {
    end++;
    const pending = yieldIfNeeded();
    if (pending) await pending;
  }
  return new Range([start, 0], [end + 1, 0]);
};

async function send(data, comment, { signal, emit }) {
  for (const field of ["markers", "magics"])
    for (let start = 0; start < data[field].length; start += 256) {
      signal.throwIfAborted();
      await emit({ field, records: data[field].slice(start, start + 256) });
    }
  return { comment };
}

exports.ipython = async function (context, _params, options) {
  const root = context.getRootSyntaxNode();
  if (!root) throw new Error("IPython cell structure is unavailable");
  const result = await collectIPython(context, root.tree, () => !options.signal.aborted);
  if (!result) return null;
  return send(result, "#", options);
};

exports.legacy = async function (context, { fragment, cursor }, options) {
  const markers = [],
    magics = [];
  const column = context.lineTextForBufferRow(cursor.row).search(/\S/);
  const position = new Point(cursor.row, column === -1 ? cursor.column : column);
  const strings = context.getCommentStringsForBufferPosition(position);
  const delimiters = strings.commentDelimiters;
  const comment =
    (delimiters?.line ?? delimiters?.block?.[0] ?? strings.commentStartString)?.trimEnd() ?? null;
  if (!fragment && comment) {
    const escaped = comment.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
    const regex = new RegExp(
      escaped +
        "[\\t ]*%{2,}(?:[\\t ]+(\\[(?:md|markdown|raw)\\]|md|markdown)(?=[\\t \\r\\n]|$))?| *<(codecell|md|markdown)>| *(In[[0-9 ]*])",
      "g",
    );
    context.scanInBufferRange(
      regex,
      [
        [0, 0],
        [Infinity, Infinity],
      ],
      ({ match, range }) => {
        if (
          !context
            .scopeDescriptorForBufferPosition(range.start)
            .getScopeChain()
            .includes("comment.line")
        )
          return;
        const metadata = match
          .slice(1)
          .find(Boolean)
          ?.replace(/^\[|\]$/g, "");
        markers.push({
          start: range.start,
          end: range.end,
          cellType:
            metadata === "md" || metadata === "markdown"
              ? "markdown"
              : metadata === "raw"
                ? "raw"
                : "code",
        });
      },
    );
  }
  if (fragment)
    for (let row = 0; row <= context.getLastBufferRow(); row++) {
      options.signal.throwIfAborted();
      const line = context.lineTextForBufferRow(row);
      if (!/\S/.test(line)) continue;
      if (/^\s*%%(?:[\w-]+|!)(?:\s|$)/.test(line))
        magics.push({
          start: new Point(row, 0),
          end: context.buffer.getEndPosition(),
          bodyStart: context.buffer.clipPosition([row + 1, 0]),
        });
      break;
    }
  return send({ markers, magics }, comment, options);
};
function markerType(node) {
  const metadata = node.childForFieldName("metadata")?.text?.replace(/^\[|\]$/g, "");
  if (metadata === "md" || metadata === "markdown") return "markdown";
  return metadata === "raw" ? "raw" : "code";
}
async function collectIPython(editor, tree, isCurrent) {
  const markers = [],
    magics = [];
  const cursor = tree.walk();
  const malformed = tree.rootNode.hasError;
  const addMagic = (node) => {
    const start = point(node.startPosition);
    magics.push({
      start,
      end: point(node.endPosition),
      bodyStart: editor.getBuffer().clipPosition([start.row + 1, 0]),
    });
  };
  let count = 0;
  let sliceStart = performance.now();
  try {
    let hasNode = cursor.gotoFirstChild();
    while (hasNode) {
      // Visit root scaffold cells only. Python bodies, special command nodes
      // inside them and native Python injection trees do not define cell bounds.
      const type = cursor.nodeType;
      if (type === "code_cell" || type === "markdown_cell" || type === "raw_cell") {
        const node = cursor.currentNode;
        const marker = node.childForFieldName("marker");
        if (marker)
          markers.push({
            start: point(marker.startPosition),
            end: point(marker.endPosition),
            cellType: type === "markdown_cell" ? "markdown" : type === "raw_cell" ? "raw" : "code",
          });
        const body = type === "code_cell" ? node.childForFieldName("body") : null;
        if (body?.type === "cell_magic") addMagic(body);
      } else if (type === "cell_marker") {
        // A complete document represents typed markers in their outer cell
        // nodes. Only recovery trees need the metadata fallback.
        markers.push({
          start: point(cursor.startPosition),
          end: point(cursor.endPosition),
          cellType: malformed ? markerType(cursor.currentNode) : "code",
        });
      } else if (type === "cell_magic") {
        // Retain the standalone structural recovery shape too.
        addMagic(cursor.currentNode);
      }
      hasNode = cursor.gotoNextSibling();
      count++;
      if (
        hasNode &&
        (count % INDEX_CHUNK_NODES === 0 ||
          (count % 64 === 0 && performance.now() - sliceStart >= INDEX_SLICE_MS))
      ) {
        await yieldIndex();
        if (!isCurrent()) return null;
        sliceStart = performance.now();
      }
    }
  } finally {
    // Native cursors are GC-owned; the web backend requires explicit release.
    cursor.delete?.();
  }
  return { markers, magics };
}
