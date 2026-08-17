const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

// This package was extracted from jupyter-repl, which used to own the whole
// cell layer. The guards below pin the boundary that made the split worth it:
// the keymap carries exactly the three run bindings that moved, the services
// are the two consumed and two provided contracts, and nothing here reaches
// for a kernel.
describe("jupyter-cells package assets", () => {
  it("ships plain CommonJS with no build step", () => {
    expect(exists("lib/main.js")).toBe(true);
    expect(exists("tsconfig.json")).toBe(false);
    expect(exists("dist")).toBe(false);
    expect(fs.readdirSync(path.join(root, "lib")).every((file) => /\.js$/.test(file))).toBe(true);
  });

  it("ships a CSS stylesheet built on custom properties, not Less", () => {
    expect(exists("styles/jupyter-cells.css")).toBe(true);
    const css = read("styles/jupyter-cells.css");
    expect(css).toContain(".line.jupyter-cells-breakpoint");
    expect(css).toContain("var(--");
    expect(css).not.toContain("jupyter-repl");
    expect(css).not.toContain("@import");
    expect(css).not.toMatch(/\bfade\(|\bcontrast\(|\blighten\(|\bdarken\(|@[a-z-]+:/);
  });

  it("is named `jupyter-cells` and carries the lumine-code metadata", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.name).toBe("jupyter-cells");
    expect(pkg.author).toBe("lumine-code");
    expect(pkg.repository).toBe("https://github.com/lumine-code/jupyter-cells");
    expect(pkg.bugs.url).toBe("https://github.com/lumine-code/jupyter-cells/issues");
    expect(pkg.main).toBe("./lib/main");
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.scripts.test).toBe("lumine --test spec");
    expect(pkg.engines.lumine).toBe("^1.0.0");
  });

  it("declares the service pair on each side of the kernel boundary", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.consumedServices["jupyter.execution"].versions["^1.0.0"]).toBe(
      "consumeJupyterExecution",
    );
    expect(pkg.consumedServices["jupyter.kernel"].versions["^1.0.0"]).toBe("consumeJupyterKernel");
    expect(pkg.providedServices["jupyter.cells"].versions["1.0.0"]).toBe("provideJupyterCells");
    expect(pkg.providedServices["code-lens.provider"].versions["1.0.0"]).toBe("provideCodeLens");
    // The retired name must not resurface.
    expect(pkg.providedServices["jupyter.breakpoints"]).toBeUndefined();
  });

  it("keeps a keyword list that never repeats the package name", () => {
    const { keywords } = JSON.parse(read("package.json"));
    expect(keywords.length).toBeGreaterThan(2);
    expect(keywords.length).toBeLessThan(9);
    for (const keyword of keywords) {
      expect(keyword).toBe(keyword.toLowerCase());
      expect(keyword).not.toContain(" ");
      expect("jupyter-cells".includes(keyword)).toBe(false);
    }
  });

  it("binds exactly the three run keystrokes that moved here", () => {
    const raw = read("keymaps/jupyter-cells.json").replace(/^\s*\/\/.*$/gm, "");
    const keymap = JSON.parse(raw);
    const selectors = Object.keys(keymap);
    expect(selectors).toEqual([
      "lumine-workspace lumine-text-editor:not([mini]):not(lumine-dock lumine-text-editor)",
    ]);
    const block = keymap[selectors[0]];
    expect(block["alt-shift-enter"]).toBe("jupyter-cells:run-cell");
    expect(block["cmdorctrl-alt-shift-enter"]).toBe("jupyter-cells:run-cell-and-move-down");
    expect(block["cmdorctrl-shift-enter"]).toBe("jupyter-cells:run-all");
    // alt-enter belongs to intentions; this more specific block must not take it.
    expect(block["alt-enter"]).toBeUndefined();
    expect(Object.keys(block).length).toBe(3);
  });

  it("keeps its commands in one Packages submenu, fencing only the context menu", () => {
    const menu = JSON.parse(read("menus/jupyter-cells.json"));
    const packages = menu.menu.find((item) => item.label === "Packages");
    const submenu = packages.submenu.find((item) => item.label === "Jupyter Cells");
    // No separator opens or closes the submenu, and none doubles up.
    expect(submenu.submenu[0].type).toBeUndefined();
    expect(submenu.submenu[submenu.submenu.length - 1].type).toBeUndefined();
    submenu.submenu.forEach((item, index) => {
      if (item.type === "separator") {
        expect(submenu.submenu[index + 1]?.type).not.toBe("separator");
      }
    });
    // Every command in the menu is this package's own.
    const commands = [];
    const collect = (items) => {
      for (const item of items) {
        if (item.command) commands.push(item.command);
        if (item.submenu) collect(item.submenu);
      }
    };
    collect(submenu.submenu);
    expect(commands.length).toBe(17);
    expect(commands.every((command) => command.startsWith("jupyter-cells:"))).toBe(true);
    // The tree-view import block is fenced by separators at both ends.
    const context = menu["context-menu"]['.tree-view .file[data-name$=".ipynb"]'];
    expect(context[0].type).toBe("separator");
    expect(context[context.length - 1].type).toBe("separator");
  });

  it("ships the contract document for the service it owns", () => {
    expect(exists("docs/jupyter.cells.md")).toBe(true);
    const doc = read("docs/jupyter.cells.md");
    expect(doc.split(/\r?\n/)[0]).toBe("# jupyter.cells");
    expect(doc).toContain("provideJupyterCells");
    expect(doc).toContain("consumeJupyterCells");
    // The breakpoints members folded in here; their old document must not linger.
    expect(exists("docs/jupyter.breakpoints.md")).toBe(false);
  });

  it("keeps the README description in sync with package.json", () => {
    const pkg = JSON.parse(read("package.json"));
    const lines = read("README.md").split(/\r?\n/);
    expect(lines[0]).toBe("# jupyter-cells");
    const sentence = lines.find((line, index) => index > 0 && line.trim().length > 0);
    expect(sentence).toBe(pkg.description);
  });

  it("keeps kernels out: no store, no kernel transport, no jupyter-repl require", () => {
    for (const file of fs.readdirSync(path.join(root, "lib"))) {
      const src = read(path.join("lib", file));
      expect(src).not.toContain('require("jupyter-repl');
      expect(src).not.toContain("zmq");
      expect(src).not.toContain("kernelManager");
    }
  });
});
