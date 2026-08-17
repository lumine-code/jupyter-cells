const { ipynbOpener } = require("../lib/import-notebook");

// This package activates eagerly, so its opener registers before
// jupyter-view's. Yielding used to fall out of registration order; it has to
// be explicit or every notebook opens as an import instead of a notebook.

describe("the ipynb opener", () => {
  it("yields to jupyter-view when it is installed", () => {
    lumine.config.set("jupyter-cells.importNotebookURI", true);
    spyOn(lumine.packages, "getLoadedPackage").and.returnValue({ name: "jupyter-view" });

    expect(ipynbOpener("C:/tmp/notebook.ipynb")).toBeUndefined();
    expect(lumine.packages.getLoadedPackage).toHaveBeenCalledWith("jupyter-view");
  });

  it("stays out of it when auto-import is off", () => {
    lumine.config.set("jupyter-cells.importNotebookURI", false);

    expect(ipynbOpener("C:/tmp/notebook.ipynb")).toBeUndefined();
  });

  it("ignores everything that is not a notebook", () => {
    lumine.config.set("jupyter-cells.importNotebookURI", true);

    expect(ipynbOpener("C:/tmp/script.py")).toBeUndefined();
  });
});
