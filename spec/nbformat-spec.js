const {
  parseNotebook,
  makeCodeCell,
  makeMarkdownCell,
  makeNotebook,
  stringifyNotebook,
} = require("../lib/nbformat");

// lib/nbformat.js replaced @nteract/commutable, and its whole contract is
// "what commutable did, byte for byte" — key order, the legacy cell-metadata
// blobs, the multiline split, the 2-space stringify with no trailing newline.
// The golden string below is the pin: an export produced before the switch
// must equal one produced after it.
describe("the nbformat model", () => {
  describe("parsing", () => {
    it("joins array sources and output texts into strings", () => {
      const nb = parseNotebook({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [
          {
            cell_type: "code",
            source: ["a = 1\n", "b = 2"],
            outputs: [
              { output_type: "stream", name: "stdout", text: ["one\n", "two\n"] },
              {
                output_type: "display_data",
                data: { "text/plain": ["line\n", "line"], "application/vnd+json": { x: 1 } },
                metadata: {},
              },
            ],
            execution_count: 1,
            metadata: {},
          },
        ],
      });

      expect(nb.cells[0].source).toBe("a = 1\nb = 2");
      expect(nb.cells[0].outputs[0].text).toBe("one\ntwo\n");
      expect(nb.cells[0].outputs[1].data["text/plain"]).toBe("line\nline");
      // JSON mimetypes hold real structures, never multiline encodings.
      expect(nb.cells[0].outputs[1].data["application/vnd+json"]).toEqual({ x: 1 });
    });

    it("normalizes CRLF sources and tolerates a missing source", () => {
      const nb = parseNotebook({
        nbformat: 4,
        nbformat_minor: 4,
        metadata: {},
        cells: [
          { cell_type: "code", source: "a\r\nb", outputs: [], metadata: {} },
          { cell_type: "markdown", metadata: {} },
        ],
      });
      expect(nb.cells[0].source).toBe("a\nb");
      expect(nb.cells[1].source).toBe("");
    });

    it("refuses anything that is not a v4 notebook", () => {
      expect(() => parseNotebook({ nbformat: 3, nbformat_minor: 0 })).toThrowError(TypeError);
      expect(() => parseNotebook(null)).toThrowError(TypeError);
    });
  });

  describe("serialization", () => {
    it("writes exactly what @nteract/commutable used to write", () => {
      const notebook = makeNotebook([makeCodeCell("x = 1\ny = 2"), makeMarkdownCell("hello")], {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      });

      // Built with the commutable pipeline this module replaced:
      // emptyNotebook.setIn(["metadata","kernelspec"], spec) + emptyCodeCell/
      // emptyMarkdownCell.set("source", …) + appendCellToNotebook + toJS +
      // stringifyNotebook.
      const golden = [
        "{",
        '  "cells": [',
        "    {",
        '      "cell_type": "code",',
        '      "source": [',
        '        "x = 1\\n",',
        '        "y = 2"',
        "      ],",
        '      "outputs": [],',
        '      "execution_count": null,',
        '      "metadata": {',
        '        "jupyter": {',
        '          "source_hidden": false,',
        '          "outputs_hidden": false',
        "        },",
        '        "nteract": {',
        '          "transient": {',
        '            "deleting": false',
        "          }",
        "        }",
        "      }",
        "    },",
        "    {",
        '      "cell_type": "markdown",',
        '      "source": [',
        '        "hello"',
        "      ],",
        '      "metadata": {',
        '        "nteract": {',
        '          "transient": {',
        '            "deleting": false',
        "          }",
        "        }",
        "      }",
        "    }",
        "  ],",
        '  "metadata": {',
        '    "kernelspec": {',
        '      "display_name": "Python 3",',
        '      "language": "python",',
        '      "name": "python3"',
        "    }",
        "  },",
        '  "nbformat": 4,',
        '  "nbformat_minor": 0',
        "}",
      ].join("\n");

      expect(stringifyNotebook(notebook)).toBe(golden);
    });

    it("writes an empty source as an empty array, and no kernelspec without one", () => {
      const notebook = makeNotebook([makeCodeCell("")]);
      expect(notebook.cells[0].source).toEqual([]);
      expect(notebook.metadata).toEqual({});
    });

    it("round-trips its own output", () => {
      const notebook = makeNotebook([makeCodeCell("a = 1\nb = 2"), makeMarkdownCell("t\next")]);
      const back = parseNotebook(JSON.parse(stringifyNotebook(notebook)));
      expect(back.cells.map((cell) => cell.source)).toEqual(["a = 1\nb = 2", "t\next"]);
      expect(back.cells.map((cell) => cell.cell_type)).toEqual(["code", "markdown"]);
    });
  });
});
