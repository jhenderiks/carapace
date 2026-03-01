export function normalizeJsonSchema(inputSchema: unknown): Record<string, unknown> {
  if (!isPlainObject(inputSchema)) {
    return {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    };
  }

  return deepNormalizeSchema(inputSchema);
}

export function deepNormalizeSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...schema };

  // Infer type when missing but properties exist
  if (!out.type && out.properties) {
    out.type = "object";
  }

  // Object schema: ensure properties, required, additionalProperties
  if (out.type === "object") {
    if (!isPlainObject(out.properties)) {
      out.properties = {};
    }
    if (!Array.isArray(out.required)) {
      out.required = [];
    }
    if (out.additionalProperties === undefined) {
      out.additionalProperties = false;
    }

    // Recursively normalize each property schema
    const props = out.properties as Record<string, unknown>;
    const normalizedProps: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(props)) {
      normalizedProps[key] = isPlainObject(propSchema)
        ? deepNormalizeSchema(propSchema)
        : propSchema;
    }
    out.properties = normalizedProps;

    // Normalize additionalProperties if it's a schema object
    if (isPlainObject(out.additionalProperties)) {
      out.additionalProperties = deepNormalizeSchema(
        out.additionalProperties as Record<string, unknown>,
      );
    }
  }

  // Array schema: normalize items
  if (out.type === "array" && isPlainObject(out.items)) {
    out.items = deepNormalizeSchema(out.items as Record<string, unknown>);
  }

  // Normalize $defs / definitions
  for (const defsKey of ["$defs", "definitions"] as const) {
    if (isPlainObject(out[defsKey])) {
      const defs = out[defsKey] as Record<string, unknown>;
      const normalizedDefs: Record<string, unknown> = {};
      for (const [key, defSchema] of Object.entries(defs)) {
        normalizedDefs[key] = isPlainObject(defSchema)
          ? deepNormalizeSchema(defSchema)
          : defSchema;
      }
      out[defsKey] = normalizedDefs;
    }
  }

  // Normalize combinators (anyOf, oneOf, allOf)
  for (const combinator of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(out[combinator])) {
      out[combinator] = (out[combinator] as unknown[]).map((item) =>
        isPlainObject(item) ? deepNormalizeSchema(item) : item,
      );
    }
  }

  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
