describe("the notebook import file opener", () => {
  beforeEach(async () => {
    await lumine.packages.activatePackage("jupyter-cells");
  });

  const choiceFor = (filePath = "C:/tmp/notebook.ipynb") =>
    lumine.workspace.getAvailableFileOpeners(filePath).find(({ id }) => id === "jupyter-cells");

  it("stays available while automatic import is off", () => {
    lumine.config.set("jupyter-cells.importNotebookURI", false);
    expect(choiceFor()).toEqual(
      jasmine.objectContaining({ label: "Import Notebook as Source", isDefault: false }),
    );
  });

  it("yields automatic opening to an eligible notebook viewer", () => {
    lumine.config.set("jupyter-cells.importNotebookURI", true);
    spyOn(lumine.packages, "isPackageActive")
      .and.callThrough()
      .withArgs("jupyter-view")
      .and.returnValue(true);
    spyOn(lumine.packages, "getLoadedPackage")
      .and.callThrough()
      .withArgs("jupyter-view")
      .and.returnValue({ mainModule: { useWorkspaceOpener: () => true } });
    expect(choiceFor().isDefault).toBe(false);
  });

  it("can import automatically when notebook viewing is disabled", () => {
    lumine.config.set("jupyter-cells.importNotebookURI", true);
    spyOn(lumine.packages, "isPackageActive")
      .and.callThrough()
      .withArgs("jupyter-view")
      .and.returnValue(true);
    spyOn(lumine.packages, "getLoadedPackage")
      .and.callThrough()
      .withArgs("jupyter-view")
      .and.returnValue({ mainModule: { useWorkspaceOpener: () => false } });
    expect(choiceFor().isDefault).toBe(true);
  });

  it("becomes the default after an enabled viewer deactivates while remaining loaded", () => {
    lumine.config.set("jupyter-cells.importNotebookURI", true);
    const active = spyOn(lumine.packages, "isPackageActive")
      .and.callThrough()
      .withArgs("jupyter-view")
      .and.returnValue(true);
    spyOn(lumine.packages, "getLoadedPackage")
      .and.callThrough()
      .withArgs("jupyter-view")
      .and.returnValue({ mainModule: { useWorkspaceOpener: () => true } });
    expect(choiceFor().isDefault).toBe(false);
    active.withArgs("jupyter-view").and.returnValue(false);
    expect(choiceFor().isDefault).toBe(true);
  });

  it("ignores everything that is not a notebook", () => {
    expect(choiceFor("C:/tmp/script.py")).toBeUndefined();
  });
});
