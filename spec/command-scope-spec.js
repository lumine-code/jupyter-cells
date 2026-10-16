describe("jupyter-cells command scopes", () => {
  const commands = [
    "select-cell",
    "select-previous-cell",
    "select-next-cell",
    "go-to-next-cell",
    "go-to-previous-cell",
    "move-cell-up",
    "move-cell-down",
    "fold-current-cell",
    "fold-all-but-current-cell",
    "export-notebook",
    "run-cell",
    "run-cell-and-move-down",
    "run-all",
    "run-all-above",
    "recalculate-all",
    "recalculate-all-above",
  ].map((name) => `jupyter-cells:${name}`);
  let editor, mini, button;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("jupyter-cells");
    editor = await lumine.workspace.open();
    mini = lumine.workspace.buildTextEditor({ mini: true });
    button = document.createElement("button");
    lumine.workspace.getElement().append(mini.getElement(), button);
  });

  afterEach(async () => {
    button.remove();
    mini.destroy();
    editor.destroy();
    await lumine.packages.deactivatePackage("jupyter-cells");
  });

  it("exposes local actions only where their registered surface handles them", () => {
    for (const command of commands) {
      expect(lumine.commands.canDispatch(editor.getElement(), command))
        .withContext(command)
        .toBe(true);
      expect(lumine.commands.canDispatch(button, command)).withContext(command).toBe(false);
      expect(lumine.commands.canDispatch(lumine.workspace.getElement(), command))
        .withContext(command)
        .toBe(false);
      expect(lumine.commands.canDispatch(mini.getElement(), command))
        .withContext(command)
        .toBe(false);
    }
  });

  it("keeps selection and navigation available while disabling text mutations in a read-only editor", () => {
    editor.getElement().setAttribute("readonly", "");
    const mutators = new Set(
      ["move-cell-up", "move-cell-down"].map((name) => `jupyter-cells:${name}`),
    );
    for (const command of commands)
      expect(lumine.commands.canDispatch(editor.getElement(), command))
        .withContext(command)
        .toBe(!mutators.has(command));
  });

  it("does not offer local actions in an empty workspace", () => {
    editor.destroy();
    for (const command of commands)
      expect(lumine.commands.canDispatch(lumine.workspace.getElement(), command))
        .withContext(command)
        .toBe(false);
  });

  it("keeps importing global and limits notebook controls to runnable actions", () => {
    const notebook = document.createElement("div");
    notebook.className = "jupyter-notebook-container";
    lumine.workspace.getElement().appendChild(notebook);
    try {
      expect(lumine.commands.canDispatch(button, "jupyter-cells:import-notebook")).toBe(true);
      expect(lumine.commands.canDispatch(notebook, "jupyter-cells:run-cell")).toBe(true);
      expect(lumine.commands.canDispatch(notebook, "jupyter-cells:select-cell")).toBe(false);
    } finally {
      notebook.remove();
    }
  });

  it("runs once when the target editor is nested in a notebook container", async () => {
    const { createRequire } = require("node:module");
    const requireCurrent = createRequire(
      require("node:path").join(
        lumine.packages.getLoadedPackage("jupyter-cells").path,
        "package.json",
      ),
    );
    const run = spyOn(requireCurrent("./lib/run-cells"), "runCell").and.resolveTo();
    const notebook = document.createElement("div");
    notebook.className = "jupyter-notebook-container";
    const fragment = lumine.workspace.buildTextEditor();
    notebook.appendChild(fragment.getElement());
    lumine.workspace.getElement().appendChild(notebook);
    try {
      await lumine.commands.dispatch(fragment.getElement(), "jupyter-cells:run-cell");
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.calls.mostRecent().args[0]).toBe(fragment);
    } finally {
      fragment.destroy();
      notebook.remove();
    }
  });
});
