exports.structure = (context) => {
  const root = context.getRootSyntaxNode();
  return {
    children: root.namedChildren.map((node) => ({
      type: node.type,
      marker: Boolean(node.childForFieldName("marker")),
      bodyType: node.childForFieldName("body")?.type,
    })),
    layers: context.getLanguageLayers().map((layer) => layer.scopeName),
  };
};

exports.indexTraversal = async (context, params, { signal }) => {
  const root = context.getRootSyntaxNode();
  let walks = 0,
    descents = 0,
    siblings = 0;
  const tree = new Proxy(root.tree, {
    get(target, property) {
      if (property === "walk")
        return () => {
          walks++;
          return new Proxy(target.walk(), {
            get(cursor, key) {
              if (key === "gotoFirstChild")
                return () => {
                  if (++descents > 1) throw new Error("Cell indexing descended into a body");
                  return cursor.gotoFirstChild();
                };
              if (key === "gotoNextSibling")
                return () => {
                  siblings++;
                  return cursor.gotoNextSibling();
                };
              const value = Reflect.get(cursor, key, cursor);
              return typeof value === "function" ? value.bind(cursor) : value;
            },
          });
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await require("../../lib/syntax-index").ipython(
    {
      ...context,
      getRootSyntaxNode: () => ({ tree }),
      getLanguageLayers() {
        throw new Error("Cell indexing inspected injection trees");
      },
    },
    params,
    { signal, emit: async () => {} },
  );
  return { walks, descents, siblings, children: root.childCount };
};
