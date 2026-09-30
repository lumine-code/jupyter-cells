const { Point } = require("lumine");

// Keep the invocation's cursor and cancel its preparation if source changes
// while service activation or tokenization is still pending.
module.exports = function captureRequest(editor) {
  let changed = false;
  const buffer = editor?.getBuffer?.();
  const subscription = buffer?.onWillChange(() => {
    changed = true;
  });
  const cursor = editor?.getCursorBufferPosition?.();
  return {
    position: cursor ? new Point(cursor.row, cursor.column) : null,
    current: () => !changed && !editor?.isDestroyed?.(),
    dispose: () => subscription?.dispose(),
  };
};
