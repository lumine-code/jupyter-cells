const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Notebook import file selection", () => {
  let root, directory, files, previousEditors, importNotebook, cancelled;

  beforeEach(async () => {
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    cancelled = false;
    files = [];
    spyOn(lumine.window, "showOpenDialog").and.callFake(async () => ({
      canceled: cancelled,
      filePaths: cancelled ? [] : files,
    }));
    // Exercise the current DOM File shape without opening a real OS chooser.
    // Electron removed File.path; file dialog results provide native paths.
    spyOn(HTMLInputElement.prototype, "click").and.callFake(function () {
      if (this.type !== "file") return;
      if (cancelled) {
        this.dispatchEvent(new Event("cancel"));
        return;
      }
      const transfer = new window.DataTransfer();
      for (const filePath of files) {
        const file = new window.File([fs.readFileSync(filePath)], path.basename(filePath), {
          type: "application/json",
        });
        expect(file.path).toBeUndefined();
        transfer.items.add(file);
      }
      this.files = transfer.files;
      this.dispatchEvent(new Event("change"));
    });
    root = fs.realpathSync.native(os.tmpdir());
    directory = fs.realpathSync.native(fs.mkdtempSync(path.join(root, "notebook-dialog-")));
    await lumine.packages.activatePackage("language-python");
    await lumine.packages.activatePackage("language-ipython");
    const pack = await lumine.packages.activatePackage("jupyter-cells");
    importNotebook = spyOn(
      require(path.join(pack.path, "lib/import-notebook")),
      "importNotebook",
    ).and.callThrough();
    lumine.config.set("jupyter-cells.importNotebookResults", false);
    previousEditors = new Set(lumine.workspace.getTextEditors());
  });

  afterEach(async () => {
    for (const editor of lumine.workspace.getTextEditors())
      if (!previousEditors.has(editor)) editor.destroy();
    if (lumine.packages.isPackageLoaded("jupyter-cells")) {
      await lumine.packages.deactivatePackage("jupyter-cells");
      await lumine.packages.unloadPackage("jupyter-cells");
    }
    await lumine.fileWatchClient.settlePendingTeardown();
    if (
      path.dirname(directory) !== root ||
      !path.basename(directory).startsWith("notebook-dialog-")
    )
      throw new Error("Unsafe notebook chooser fixture cleanup");
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function notebook(name, source, extension = ".ipynb") {
    const filePath = path.join(directory, name + extension);
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        cells: [{ cell_type: "code", source, metadata: {}, outputs: [], execution_count: null }],
        metadata: { language_info: { name: "python" } },
        nbformat: 4,
        nbformat_minor: 0,
      }),
    );
    files.push(filePath);
  }

  async function dispatchImport() {
    lumine.commands.dispatch(lumine.workspace.getElement(), "jupyter-cells:import-notebook");
    await expectAsync(importNotebook.calls.mostRecent().returnValue).toBeResolved();
    return lumine.workspace.getTextEditors().filter((editor) => !previousEditors.has(editor));
  }

  it("imports the selected native path despite the absent DOM File.path property", async () => {
    notebook("one", "answer = 42\n");
    const editors = await dispatchImport();
    expect(editors.length).toBe(1);
    if (editors[0]) expect(editors[0].getText()).toContain("answer = 42\n");
  });

  it("finishes every selected notebook before the import command settles", async () => {
    notebook("one", "first = 1\n");
    notebook("two", "second = 2\n");
    const editors = await dispatchImport();
    expect(editors.length).toBe(2);
    expect(editors.map((editor) => editor.getText()).join("\n")).toContain("first = 1\n");
    expect(editors.map((editor) => editor.getText()).join("\n")).toContain("second = 2\n");
  });

  it("imports a selected notebook with an uppercase file extension", async () => {
    notebook("uppercase", "answer = 42\n", ".IPYNB");
    const editors = await dispatchImport();
    expect(editors.length).toBe(1);
    if (editors[0]) expect(editors[0].getText()).toContain("answer = 42\n");
  });

  it("leaves the workspace unchanged when file selection is cancelled", async () => {
    cancelled = true;
    expect(await dispatchImport()).toEqual([]);
  });
});
