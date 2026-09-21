const path = require("path");
const { CompositeDisposable } = require("lumine");

const packageRoot = path.join(__dirname, "..");

async function microtasks(count = 20) {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

// A jupyter.execution fake recording every call, so the specs can assert what
// the moved commands hand over without a kernel anywhere near them.
function makeExecution({ adapterHandles = false } = {}) {
  const calls = [];
  return {
    calls,
    runAdapter(scope, moveDown) {
      calls.push(["runAdapter", scope, moveDown]);
      return adapterHandles;
    },
    runBlocks(editor, blocks) {
      calls.push(["runBlocks", editor, blocks]);
      return Promise.resolve(true);
    },
    moveDown(editor, endRow) {
      calls.push(["moveDown", editor, endRow]);
    },
    clearResults() {
      calls.push(["clearResults"]);
    },
    restartKernel(onRestarted) {
      calls.push(["restartKernel"]);
      onRestarted?.();
    },
    importOutputs() {},
    markdownToOutput(source) {
      return { output_type: "display_data", data: { "text/markdown": source } };
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

    const run = execution.calls.find(([name]) => name === "runBlocks");
    expect(runtimeRequest).not.toHaveBeenCalled();
    expect(run[1]).toBe(editor);
    expect(run[2]).toEqual([{ code: "a = 1\n", row: 1, cellType: "codecell" }]);
  });

  it("captures the cell before moving down, and moves before running", async () => {
    const execution = consume(makeExecution());
    editor.setCursorBufferPosition([1, 0]);

    dispatch("jupyter-cells:run-cell-and-move-down");
    await microtasks();

    const order = execution.calls.map(([name]) => name);
    expect(order.indexOf("moveDown")).toBeGreaterThan(-1);
    expect(order.indexOf("moveDown")).toBeLessThan(order.indexOf("runBlocks"));
    const run = execution.calls.find(([name]) => name === "runBlocks");
    // The block was captured from the cell the cursor was in, wherever the
    // move put it afterwards.
    expect(run[2][0].code).toBe("a = 1\n");
  });

  it("stops at the adapter when a notebook pane claims the run", async () => {
    const execution = consume(makeExecution({ adapterHandles: true }));
    editor.setCursorBufferPosition([1, 0]);

    dispatch("jupyter-cells:run-cell");
    await microtasks();

    expect(execution.calls.map(([name]) => name)).toEqual(["runAdapter"]);
    expect(execution.calls[0][1]).toBe("active");
  });

  it("walks every cell for run-all, stripping markdown cells to their prose", async () => {
    const execution = consume(makeExecution());

    dispatch("jupyter-cells:run-all");
    await microtasks();

    const run = execution.calls.find(([name]) => name === "runBlocks");
    expect(run[2].map((block) => block.cellType)).toEqual(["codecell", "markdown", "codecell"]);
    // The comment prefix of the markdown cell is stripped before it is handed over.
    expect(run[2][1].code).toContain("text");
    expect(run[2][1].code).not.toContain("#");
  });

  it("runs only the cells at and above the cursor for run-all-above", async () => {
    const execution = consume(makeExecution());
    editor.setCursorBufferPosition([3, 0]);

    dispatch("jupyter-cells:run-all-above");
    await microtasks();

    const run = execution.calls.find(([name]) => name === "runBlocks");
    expect(run[2].length).toBe(2);
    expect(run[2][0].code).toBe("a = 1\n");
  });

  it("clears, restarts, and reruns for recalculate-all", async () => {
    const execution = consume(makeExecution());

    dispatch("jupyter-cells:recalculate-all");
    await microtasks();

    const order = execution.calls.map(([name]) => name);
    expect(order.indexOf("clearResults")).toBeLessThan(order.indexOf("restartKernel"));
    expect(order.indexOf("restartKernel")).toBeLessThan(order.indexOf("runBlocks"));
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
});
