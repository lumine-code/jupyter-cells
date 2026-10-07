const { Point } = require("lumine");
const services = require("./services");

// Keep the invocation's cursor and cancel its preparation if source changes
// while service activation or tokenization is still pending.
module.exports = function captureRequest(editor, item) {
  let changed = false;
  const generation = services.getLifecycleGeneration();
  const paneItem =
    item ??
    (editor &&
    lumine.textEditors?.roleFor?.(editor) !== "fragment" &&
    !editor.isJupyterNotebookSourceEditor
      ? editor
      : lumine.workspace.getCenter().getActivePaneItem());
  const sourceEditor = services.getAdapter(paneItem) ? null : editor;
  const buffer = sourceEditor?.getBuffer?.();
  const subscription = buffer?.onWillChange(() => {
    changed = true;
  });
  const cursor = editor?.getCursorBufferPosition?.();
  const grammar = sourceEditor?.getGrammar?.();
  const embedded =
    !editor ||
    lumine.textEditors?.roleFor?.(editor) === "fragment" ||
    editor.isJupyterNotebookSourceEditor;
  return {
    item: paneItem,
    position: cursor ? new Point(cursor.row, cursor.column) : null,
    current: () =>
      services.getLifecycleGeneration() === generation &&
      !changed &&
      !sourceEditor?.isDestroyed?.() &&
      sourceEditor?.getGrammar?.() === grammar &&
      !paneItem?.isDestroyed?.() &&
      !paneItem?._destroyed &&
      (!embedded || Boolean(paneItem)),
    dispose: () => subscription?.dispose(),
  };
};
