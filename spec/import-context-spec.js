const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Notebook import opening context", () => {
  let directory, notebookPath, importer, services, load, command, releases, previousEditors;

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("language-python");
    await lumine.packages.activatePackage("language-ipython");
    const pack = await lumine.packages.activatePackage("jupyter-cells");
    importer = require(path.join(pack.path, "lib/import-notebook"));
    services = require(path.join(pack.path, "lib/services"));
    services.setOutput(null);
    load = spyOn(importer, "_loadNotebook").and.callThrough();
    command = spyOn(importer, "importNotebook").and.callThrough();
    releases = [];
    previousEditors = new Set(lumine.workspace.getTextEditors());
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "notebook-import-context-"));
    notebookPath = path.join(directory, "model.ipynb");
    fs.writeFileSync(
      notebookPath,
      JSON.stringify({
        cells: [
          {
            cell_type: "code",
            source: ["answer = 42\n"],
            metadata: {},
            execution_count: 1,
            outputs: [{ output_type: "stream", name: "stdout", text: "42\n" }],
          },
        ],
        metadata: { language_info: { name: "python" } },
        nbformat: 4,
        nbformat_minor: 5,
      }),
    );
    lumine.config.set("jupyter-cells.importNotebookResults", false);
  });

  afterEach(async () => {
    for (const release of releases) release();
    await Promise.allSettled(
      [...command.calls.all(), ...load.calls.all()].map(({ returnValue }) => returnValue),
    );
    services.setOutput(null);
    for (const editor of lumine.workspace.getTextEditors())
      if (!previousEditors.has(editor)) editor.destroy();
    await lumine.packages.deactivatePackage("jupyter-cells");
    await lumine.workspace.discardEditorWindows();
    await lumine.fileWatchClient.settlePendingTeardown();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function holdRead() {
    let reached, release;
    const started = new Promise((resolve) => {
      reached = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    releases.push(release);
    const read = fs.promises.readFile.bind(fs.promises);
    spyOn(fs.promises, "readFile").and.callFake(async (filePath, options) => {
      if (filePath === notebookPath) {
        reached();
        await gate;
      }
      return read(filePath, options);
    });
    return { started, release };
  }

  function panes() {
    const original = lumine.workspace.getCenter().getActivePane();
    const another = original.splitRight({ activate: false });
    original.activate();
    return { original, another };
  }

  function open(pane, signal) {
    return lumine.workspace.open(notebookPath, { opener: "jupyter-cells", pane, signal });
  }

  it("imports into the requested center pane after another pane becomes active during file reading", async () => {
    const { original, another } = panes();
    const read = holdRead();
    const pending = open(original);
    await read.started;
    another.activate();
    read.release();
    await pending;

    const editors = lumine.workspace
      .getTextEditors()
      .filter((editor) => !previousEditors.has(editor));
    expect(editors.length).toBe(1);
    expect(editors[0].getText()).toContain("answer = 42");
    expect(editors[0].getGrammar().scopeName).toBe("source.python.ipy");
    expect(lumine.workspace.paneForItem(editors[0])).toBe(original);
    expect(another.getItems()).toEqual([]);
  });

  for (const retirement of ["cancellation", "pane closure", "package deactivation"]) {
    it(`creates no late source editor after ${retirement} while reading a notebook`, async () => {
      const { original, another } = panes();
      const read = holdRead();
      const controller = new AbortController();
      const error = spyOn(lumine.notifications, "addError");
      const pending = open(original, controller.signal);
      await read.started;
      if (retirement === "cancellation") controller.abort();
      else if (retirement === "pane closure") original.destroy();
      else await lumine.packages.deactivatePackage("jupyter-cells");
      another.activate();
      read.release();
      await pending;
      await load.calls.mostRecent().returnValue;

      expect(
        lumine.workspace.getTextEditors().filter((editor) => !previousEditors.has(editor)),
      ).toEqual([]);
      expect(another.getItems()).toEqual([]);
      expect(error).not.toHaveBeenCalled();
    });
  }

  for (const explicit of [true, false]) {
    it(`keeps an auxiliary center destination ${explicit ? "passed explicitly" : "captured without options"} while main becomes active during reading`, async () => {
      const workspace = lumine.workspace;
      const extra = await workspace.openEditorWindow({ show: false });
      const pane = extra.getEditorContainer().getActivePane();
      pane.activate();
      const read = holdRead();
      const pending = explicit ? open(pane) : importer._loadNotebook(notebookPath);
      await read.started;
      workspace.getMainWindow().getEditorContainer().getActivePane().activate();
      read.release();
      await pending;

      const editors = workspace.getTextEditors().filter((editor) => !previousEditors.has(editor));
      expect(editors.length).toBe(1);
      expect(workspace.paneForItem(editors[0])).toBe(pane);
      expect(workspace.getWindowForElement(editors[0].getElement())).toBe(extra);
      expect(editors[0].getText()).toContain("answer = 42");
    });
  }

  it("keeps the native import command's auxiliary owner and pane while its dialog is pending", async () => {
    const workspace = lumine.workspace;
    const extra = await workspace.openEditorWindow({ show: false });
    const pane = extra.getEditorContainer().getActivePane();
    pane.activate();
    let release;
    const selected = new Promise((resolve) => {
      release = resolve;
    });
    releases.push(() => release({ canceled: true, filePaths: [] }));
    const dialog = spyOn(extra, "showOpenDialog").and.returnValue(selected);
    const mainDialog = spyOn(workspace.getMainWindow(), "showOpenDialog");

    lumine.commands.dispatch(pane.getElement(), "jupyter-cells:import-notebook");

    expect(command.calls.mostRecent().args[0].pane).toBe(pane);
    expect(dialog).toHaveBeenCalledOnceWith({
      title: "Import Notebook",
      filters: [{ name: "Jupyter Notebooks", extensions: ["ipynb"] }],
      properties: ["openFile", "multiSelections"],
    });
    expect(mainDialog).not.toHaveBeenCalled();
    workspace.getMainWindow().getEditorContainer().getActivePane().activate();
    release({ canceled: false, filePaths: [notebookPath] });
    await command.calls.mostRecent().returnValue;

    const editors = workspace.getTextEditors().filter((editor) => !previousEditors.has(editor));
    expect(editors.length).toBe(1);
    expect(workspace.paneForItem(editors[0])).toBe(pane);
    expect(workspace.getWindowForElement(editors[0].getElement())).toBe(extra);
    expect(editors[0].getText()).toContain("answer = 42");
  });

  it("finishes without importing when the native chooser's auxiliary owner closes", async () => {
    const workspace = lumine.workspace;
    const extra = await workspace.openEditorWindow({ show: false });
    const pane = extra.getEditorContainer().getActivePane();
    let rejectDialog;
    const selected = new Promise((_resolve, reject) => {
      rejectDialog = reject;
    });
    releases.push(() => rejectDialog(new Error("The editor window has closed.")));
    const dialog = spyOn(extra, "showOpenDialog").and.returnValue(selected);
    lumine.commands.dispatch(pane.getElement(), "jupyter-cells:import-notebook");
    expect(dialog).toHaveBeenCalledTimes(1);
    const pending = command.calls.mostRecent().returnValue;

    expect(await workspace.closeEditorWindow(extra)).toBe(true);
    rejectDialog(
      Object.assign(new Error("The editor window has closed."), { code: "CLOSED_WINDOW" }),
    );
    await expectAsync(pending).toBeResolved();

    expect(load).not.toHaveBeenCalled();
    expect(workspace.getTextEditors().filter((editor) => !previousEditors.has(editor))).toEqual([]);
  });

  it("does not restore saved outputs after cancellation while the output service is pending", async () => {
    const { original } = panes();
    const controller = new AbortController();
    let requested, release;
    const started = new Promise((resolve) => {
      requested = resolve;
    });
    const service = new Promise((resolve) => {
      release = resolve;
    });
    releases.push(() => release(null));
    spyOn(services, "requestOutput").and.callFake(() => {
      requested();
      return service;
    });
    const output = { importOutputs: jasmine.createSpy("importOutputs") };
    lumine.config.set("jupyter-cells.importNotebookResults", true);
    const pending = open(original, controller.signal);
    await started;
    const editor = original.getActiveItem();
    expect(editor.getText()).toContain("answer = 42");
    controller.abort();
    services.setOutput(output);
    release(output);
    await pending;
    await load.calls.mostRecent().returnValue;

    expect(output.importOutputs).not.toHaveBeenCalled();
    expect(editor.isDestroyed()).toBe(false);
    expect(editor.getText()).toContain("answer = 42");
  });
});
