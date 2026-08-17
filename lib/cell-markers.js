const { Emitter, CompositeDisposable } = require("lumine");
const cells = require("./cells");

// The marker-line decoration and the update stream behind the jupyter.cells
// boundary members. Observing the config is what fixed the old "requires
// reopening the editor" caveat: enabling decorates every open editor on the
// spot, disabling strips them and announces empty boundaries so a scrollbar
// layer redraws clean.
module.exports = class CellMarkers {
  constructor() {
    this.emitter = new Emitter();
    this.editors = new Map();
    this.enabled = false;
    this.observer = null;
    this.subscriptions = new CompositeDisposable(
      lumine.config.observe("jupyter-cells.cellMarkers", (value) => this.setEnabled(!!value)),
    );
  }

  isEnabled() {
    return this.enabled;
  }

  // fn({editor, breakpoints}) — the boundaries of one editor changed.
  onDidUpdate(fn) {
    return this.emitter.on("did-update", fn);
  }

  setEnabled(enabled) {
    if (enabled === this.enabled) {
      return;
    }
    this.enabled = enabled;
    if (enabled) {
      this.observer = lumine.workspace.observeTextEditors((editor) => this.watchEditor(editor));
    } else {
      this.observer?.dispose();
      this.observer = null;
      for (const editor of [...this.editors.keys()]) {
        this.unwatchEditor(editor, { strip: true });
      }
    }
  }

  watchEditor(editor) {
    if (this.editors.has(editor)) {
      return;
    }
    const subscriptions = new CompositeDisposable();
    this.editors.set(editor, subscriptions);
    cells.prepareCellDecoration(editor);
    const update = () => {
      const breakpoints = cells.updateCellMarkers(editor);
      this.emitter.emit("did-update", { editor, breakpoints });
    };
    update();
    subscriptions.add(
      // Tokenization decides which markers are real comments, so the first
      // paint after a grammar loads has to re-run.
      editor.onDidTokenize(update),
      editor.buffer.onDidStopChanging(update),
      editor.onDidDestroy(() => this.unwatchEditor(editor)),
    );
  }

  unwatchEditor(editor, { strip = false } = {}) {
    const subscriptions = this.editors.get(editor);
    if (!subscriptions) {
      return;
    }
    subscriptions.dispose();
    this.editors.delete(editor);
    if (strip && !editor.isDestroyed()) {
      cells.destroyCellMarkers(editor);
      this.emitter.emit("did-update", { editor, breakpoints: [] });
    }
  }

  dispose() {
    this.setEnabled(false);
    this.subscriptions.dispose();
    this.emitter.dispose();
  }
};
