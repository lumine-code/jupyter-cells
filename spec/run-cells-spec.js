const path = require("path");
const { CompositeDisposable } = require("lumine");

const packageRoot = path.join(__dirname, "..");

async function microtasks(count = 20) {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

// A jupyter.execution fake recording every call, so the specs can assert what
// the moved commands hand over without a kernel anywhere near them.
function makeExecution() {
  const calls = [];
  return {
    calls,
    execute(request) {
      calls.push(["execute", request.editor, request.blocks, request]);
      return Promise.resolve({ accepted: true, done: Promise.resolve({ status: "ok" }) });
    },
  };
}

describe("the cell run commands", () => {
  let mainModule, editor, disposables, runtimeRequest;

  const markers = ["# %%", "a = 1", "# %% markdown", "# text", "# %%", "b = 2"].join("\n");

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    disposables = new CompositeDisposable();
    lumine.notifications.clear();
    runtimeRequest = spyOn(lumine.packages, "requestService").and.returnValue(
      Promise.resolve(true),
    );

    const pack = await lumine.packages.activatePackage(packageRoot);
    mainModule = pack.mainModule;
    await lumine.packages.activatePackage("language-python");
    editor = await lumine.workspace.open("run-cells.py");
    editor.getBuffer().setText(markers);
    const languageMode = editor.getBuffer().getLanguageMode();
    if (languageMode.atTransactionEnd) {
      await languageMode.atTransactionEnd();
    }
  });

  afterEach(async () => {
    disposables.dispose();
    await lumine.packages.deactivatePackage("jupyter-cells");
    for (const open of lumine.workspace.getTextEditors()) open.destroy();
  });

  const consume = (execution) => {
    disposables.add(mainModule.consumeJupyterExecution(execution));
    return execution;
  };

  const dispatch = (command) => {
    lumine.commands.dispatch(lumine.views.getView(editor), command);
  };

  it("hands the cursor's cell to the execution service as one block", async () => {
    const execution = consume(makeExecution());
    editor.setCursorBufferPosition([1, 0]);

    dispatch("jupyter-cells:run-cell");
    await microtasks();

    const run = execution.calls.find(([name]) => name === "execute");
    expect(runtimeRequest).not.toHaveBeenCalled();
    expect(run[1]).toBe(editor);
    expect(run[2]).toEqual([{ code: "a = 1", row: 1, cellType: "code" }]);
  });

  it("captures the cell before moving down, and moves before running", async () => {
    const execution = consume(makeExecution());
    editor.setCursorBufferPosition([1, 0]);

    dispatch("jupyter-cells:run-cell-and-move-down");
    await microtasks();

    expect(execution.calls.length).toBe(1);
    expect(execution.calls[0][3].moveDown).toBe(true);
    const run = execution.calls.find(([name]) => name === "execute");
    // The block was captured from the cell the cursor was in, wherever the
    // move put it afterwards.
    expect(run[2][0].code).toBe("a = 1");
  });

  it("submits the explicit notebook and captured adapter targets only once", async () => {
    const execution = consume(makeExecution());
    const item = { isDestroyed: () => false };
    const owner = { isDestroyed: () => false };
    const targets = [{ id: "cell", source: "original()" }];
    const adapter = {
      getRunTargets: () => targets,
      getRunTarget: () => targets[0],
      getKernelOwner: () => owner,
    };
    disposables.add(
      mainModule.consumeJupyterAdapter({
        getAdapterForItem: (candidate) => (candidate === item ? adapter : null),
      }),
    );
    await require("../lib/run-cells").runCell(null, false, item);
    expect(execution.calls.length).toBe(1);
    expect(execution.calls[0][3]).toEqual(
      jasmine.objectContaining({ item, owner, targets, scope: "active" }),
    );
    expect(execution.calls[0][2]).toBeUndefined();
  });

  it("walks every cell for run-all, stripping markdown cells to their prose", async () => {
    const execution = consume(makeExecution());

    dispatch("jupyter-cells:run-all");
    await microtasks();

    const run = execution.calls.find(([name]) => name === "execute");
    expect(run[2].map((block) => block.cellType)).toEqual(["code", "markdown", "code"]);
    // The comment prefix of the markdown cell is stripped before it is handed over.
    expect(run[2][1].code).toContain("text");
    expect(run[2][1].code).not.toContain("#");
  });

  it("runs only the cells at and above the cursor for run-all-above", async () => {
    const execution = consume(makeExecution());
    editor.setCursorBufferPosition([3, 0]);

    dispatch("jupyter-cells:run-all-above");
    await microtasks();

    const run = execution.calls.find(([name]) => name === "execute");
    expect(run[2].length).toBe(2);
    expect(run[2][0].code).toBe("a = 1");
  });

  it("preserves literal types and the full magic header when Run All Above clips its body", async () => {
    await lumine.packages.activatePackage(path.resolve(__dirname, "..", "..", "language-ipython"));
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python.ipy");
    editor.setText(
      [
        "# %% Setup",
        "seed = 1",
        "# %% [markdown]",
        "# Literal heading",
        "  **bold**",
        "# %% [raw]",
        "%%time is raw",
        "# %% Script",
        "%%writefile -a notes.txt",
        "first",
        "second",
        "# %% Following",
        "later = 1",
      ].join("\n"),
    );
    await mainModule.provideJupyterCells().getCellDescriptors(editor);
    const execution = consume(makeExecution());
    editor.setCursorBufferPosition([9, 2]);

    dispatch("jupyter-cells:run-all-above");
    await microtasks();

    const runs = execution.calls.filter(([name]) => name === "execute");
    expect(runs.length).toBe(1);
    expect(runs[0][2]).toEqual([
      { code: "seed = 1", row: 1, cellType: "code" },
      { code: "# Literal heading\n  **bold**", row: 4, cellType: "markdown" },
      { code: "%%time is raw", row: 6, cellType: "raw" },
      { code: "%%writefile -a notes.txt\nfirst\n", row: 9, cellType: "code" },
    ]);
  });

  it("clears, restarts, and reruns for recalculate-all", async () => {
    const execution = consume(makeExecution());

    dispatch("jupyter-cells:recalculate-all");
    await microtasks();

    expect(execution.calls.length).toBe(1);
    expect(execution.calls[0][3]).toEqual(
      jasmine.objectContaining({ editor, restart: true, clear: true }),
    );
    expect(execution.calls[0][2].length).toBe(3);
  });

  it("says what is missing when no execution service is consumed", async () => {
    editor.setCursorBufferPosition([1, 0]);

    dispatch("jupyter-cells:run-cell");
    await microtasks();

    const notifications = lumine.notifications.getNotifications();
    expect(notifications.length).toBe(1);
    expect(notifications[0].getType()).toBe("warning");
    expect(notifications[0].getMessage()).toContain("jupyter-repl");
    expect(runtimeRequest).toHaveBeenCalledWith("jupyter.execution", "^1.0.0");
  });

  it("keeps empty typed cells inert and runs the following code only once", async () => {
    await lumine.packages.activatePackage(path.resolve(__dirname, "..", "..", "language-ipython"));
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python.ipy");
    const execution = consume(makeExecution());
    for (const metadata of ["[markdown]", "[raw]", ""]) {
      editor.setText("# %% " + metadata + "\n# %% Code\ndangerous()\n");
      editor.setCursorBufferPosition([0, 0]);
      execution.calls.length = 0;
      await mainModule.provideJupyterCells().getCellDescriptors(editor);
      dispatch("jupyter-cells:run-cell");
      await microtasks();
      expect(execution.calls.filter(([name]) => name === "execute")).toEqual([]);
      dispatch("jupyter-cells:run-all");
      await microtasks();
      const runs = execution.calls.filter(([name]) => name === "execute");
      expect(runs.length).toBe(1);
      expect(runs[0][2].map((block) => block.code)).toEqual(["dangerous()\n"]);
    }
  });

  it("cancels a cell run if source changes while the execution service is pending", async () => {
    editor.setText("# %% Harmless\nharmless()\n# %% Code\ndangerous()\n");
    editor.setCursorBufferPosition([1, 0]);
    const execution = consume(makeExecution());
    let resume;
    const deferred = new Promise((resolve) => {
      resume = resolve;
    });
    spyOn(require("../lib/services"), "requestExecution").and.returnValue(deferred);
    const pending = require("../lib/run-cells").runCell(editor);
    editor.getBuffer().delete([
      [0, 0],
      [2, 0],
    ]);
    resume(execution);
    await pending;
    expect(execution.calls.filter(([name]) => name === "execute")).toEqual([]);
  });

  it("keeps a replacement execution and kernel provider after the old edges detach", async () => {
    const services = require("../lib/services");
    const execution = makeExecution();
    const oldExecution = mainModule.consumeJupyterExecution(execution);
    disposables.add(mainModule.consumeJupyterExecution(execution));
    oldExecution.dispose();
    expect(await services.requestExecution()).toBe(execution);
    const firstKernel = { name: "first" };
    const secondKernel = { name: "second" };
    const oldKernel = mainModule.consumeJupyterKernel(firstKernel);
    disposables.add(mainModule.consumeJupyterKernel(secondKernel));
    oldKernel.dispose();
    expect(services.getKernel()).toBe(secondKernel);
  });

  it("cancels run-all when source changes during service activation", async () => {
    const execution = consume(makeExecution());
    let release;
    spyOn(require("../lib/services"), "requestExecution").and.returnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = require("../lib/run-cells").runAll(editor);
    editor.setText("# %%\ndangerous()\n");
    release(execution);
    await pending;
    expect(execution.calls).toEqual([]);
  });

  it("cancels a run when the grammar changes during service activation", async () => {
    const execution = consume(makeExecution());
    let release;
    spyOn(require("../lib/services"), "requestExecution").and.returnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = require("../lib/run-cells").runCell(editor);
    editor.setGrammar(lumine.grammars.nullGrammar);
    release(execution);
    await pending;
    expect(execution.calls).toEqual([]);
  });

  it("keeps the invoked notebook when focus changes during service activation", async () => {
    const execution = consume(makeExecution());
    const item = { isDestroyed: () => false };
    const targets = [{ id: "cell", source: "original()" }];
    const adapter = {
      getRunTargets: () => targets,
      getRunTarget: () => targets[0],
      getKernelOwner: () => item,
    };
    disposables.add(
      mainModule.consumeJupyterAdapter({
        getAdapterForItem: (candidate) => (candidate === item ? adapter : null),
      }),
    );
    let release;
    spyOn(require("../lib/services"), "requestExecution").and.returnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = require("../lib/run-cells").runCell(null, false, item);
    await lumine.workspace.open("other-pane.py");
    release(execution);
    await pending;
    expect(execution.calls.length).toBe(1);
    expect(execution.calls[0][3].item).toBe(item);
  });

  it("keeps the invocation's cursor limit when restarting before run-all-above", async () => {
    const execution = consume(makeExecution());
    let release;
    spyOn(require("../lib/services"), "requestExecution").and.returnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    editor.setCursorBufferPosition([3, 0]);
    const pending = require("../lib/run-cells").recalculateAllAbove(editor);
    await microtasks();
    editor.setCursorBufferPosition([5, 0]);
    release(execution);
    await pending;
    const run = execution.calls.find(([name]) => name === "execute");
    expect(run[2].map((block) => block.code)).toEqual(["a = 1", "text"]);
  });

  it("cancels index preparation when the package deactivates", async () => {
    const cells = require("../lib/cells");
    const mode = editor.getBuffer().getLanguageMode();
    let release;
    spyOn(mode, "atTransactionEnd").and.returnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    editor.setText("# %%\nnew source");
    const index = cells.refreshIndex(editor);
    await lumine.packages.deactivatePackage("jupyter-cells");
    release();
    expect(await index).toBeNull();
  });
});
