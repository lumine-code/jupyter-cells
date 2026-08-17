const fs = require("fs");
const path = require("path");

// The settings schema lives in package.json's `configSchema` rather than being
// exported as `config` from main.js, so the editor can show and default the
// settings without activating the package. These specs guard that: the schema
// has to stay well-formed, and it has to keep covering every setting the
// source actually reads.
describe("jupyter-cells configSchema", () => {
  const packageRoot = path.resolve(__dirname, "..");
  let configSchema;

  beforeEach(() => {
    configSchema = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ).configSchema;
  });

  it("is declared in package.json", () => {
    expect(configSchema).toBeDefined();
    expect(Object.keys(configSchema).length).toBeGreaterThan(0);
  });

  it("is not also exported from main.js", () => {
    // Two sources of truth would silently diverge; package.json is the one the
    // editor reads before activation.
    const main = require("../lib/main");
    expect(main.config).toBeUndefined();
  });

  it("gives every setting a type, a title, and a description", () => {
    for (const [key, entry] of Object.entries(configSchema)) {
      expect(entry.type).toBeDefined(`${key} is missing a type`);
      expect(entry.title).toBeDefined(`${key} is missing a title`);
      expect(entry.description).toBeDefined(`${key} is missing a description`);
    }
  });

  it("gives every setting a default matching its declared type, as its last key", () => {
    const matches = {
      boolean: (value) => typeof value === "boolean",
      string: (value) => typeof value === "string",
      integer: (value) => Number.isInteger(value),
      number: (value) => typeof value === "number",
      array: (value) => Array.isArray(value),
      object: (value) => value !== null && typeof value === "object",
    };

    for (const [key, entry] of Object.entries(configSchema)) {
      if (entry.properties) continue;
      expect(entry.default).toBeDefined(`${key} is missing a default`);
      expect(matches[entry.type](entry.default)).toBe(
        true,
        `${key} default ${JSON.stringify(entry.default)} is not a ${entry.type}`,
      );
      const keys = Object.keys(entry);
      expect(keys[keys.length - 1]).toBe("default", `${key} does not end with its default`);
    }
  });

  it("leaves the settings unordered", () => {
    // Lumine lays the settings out on its own; an `order` key here would only
    // go stale as entries come and go.
    for (const [key, entry] of Object.entries(configSchema)) {
      expect(entry.order).toBeUndefined(`${key} still declares an order`);
    }
  });

  it("declares every setting the source reads", () => {
    const read = new Set();

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".js")) {
          const source = fs.readFileSync(full, "utf8");
          const pattern =
            /lumine\.config\.(?:get|set|observe|onDidChange|unset)\(\s*["'`]jupyter-cells\.([\w]+)/g;
          for (const match of source.matchAll(pattern)) {
            read.add(match[1]);
          }
        }
      }
    };
    walk(path.join(packageRoot, "lib"));

    expect(read.size).toBeGreaterThan(0);
    const undeclared = [...read].filter((key) => !configSchema[key]);
    expect(undeclared).toEqual([]);
  });
});
