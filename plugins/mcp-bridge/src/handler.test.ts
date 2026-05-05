import { strict as assert } from "node:assert";

import { deepNormalizeSchema, normalizeJsonSchema } from "./schema.ts";

// Missing input → default empty object schema
assert.deepStrictEqual(normalizeJsonSchema(undefined), {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
});
assert.deepStrictEqual(normalizeJsonSchema(null), {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
});
assert.deepStrictEqual(normalizeJsonSchema("not an object"), {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
});

// Object schema missing properties → adds them
assert.deepStrictEqual(normalizeJsonSchema({ type: "object" }), {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
});

// Object schema with properties → preserves them, adds missing fields
const input1 = {
  type: "object",
  properties: { name: { type: "string" } },
};
const result1 = normalizeJsonSchema(input1);
assert.equal(result1.type, "object");
assert.deepStrictEqual(result1.properties, { name: { type: "string" } });
assert.deepStrictEqual(result1.required, []);
assert.equal(result1.additionalProperties, false);

// Preserves existing required array
const input2 = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
};
const result2 = normalizeJsonSchema(input2);
assert.deepStrictEqual(result2.required, ["id"]);

// Preserves existing additionalProperties: false
const input3 = { type: "object", properties: {}, additionalProperties: false };
const result3 = normalizeJsonSchema(input3);
assert.equal(result3.additionalProperties, false);

// Does NOT overwrite additionalProperties if already set (even to true)
const input4 = { type: "object", properties: {}, additionalProperties: true };
const result4 = normalizeJsonSchema(input4);
assert.equal(result4.additionalProperties, true);

// Nested object properties are recursively normalized
const nested = {
  type: "object",
  properties: {
    child: { type: "object" },
  },
};
const nestedResult = normalizeJsonSchema(nested);
assert.deepStrictEqual((nestedResult.properties as Record<string, Record<string, unknown>>).child, {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
});

// Array items are recursively normalized
const withArray = {
  type: "object",
  properties: {
    items: { type: "array", items: { type: "object" } },
  },
};
const arrayResult = normalizeJsonSchema(withArray);
const normalizedArrayItems = (arrayResult.properties as Record<string, Record<string, unknown>>).items;
assert.deepStrictEqual((normalizedArrayItems.items as Record<string, unknown>), {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
});

// $defs are recursively normalized
const withDefs = {
  type: "object",
  properties: {},
  $defs: {
    Thing: { type: "object" },
  },
};
const defsResult = normalizeJsonSchema(withDefs);
const defs = defsResult.$defs as Record<string, Record<string, unknown>>;
assert.deepStrictEqual(defs.Thing, {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
});

// anyOf/oneOf/allOf items are normalized
const withAnyOf = {
  type: "object",
  properties: {
    value: { anyOf: [{ type: "object" }, { type: "string" }] },
  },
};
const anyOfResult = normalizeJsonSchema(withAnyOf);
const anyOf = anyOfResult.properties as Record<string, { anyOf: unknown[] }>;
assert.deepStrictEqual(anyOf.value.anyOf[0] as Record<string, unknown>, {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
});
assert.deepStrictEqual(anyOf.value.anyOf[1] as Record<string, string>, { type: "string" });

// Non-object types pass through unchanged
assert.deepStrictEqual(normalizeJsonSchema({ type: "string" }), { type: "string" });
assert.deepStrictEqual(normalizeJsonSchema({ type: "number" }), { type: "number" });
assert.deepStrictEqual(normalizeJsonSchema({ type: "boolean" }), { type: "boolean" });

// deepNormalizeSchema: preserves explicit scalar schema details in recursive call
const nestedSchema = {
  type: "object",
  properties: {
    payload: {
      oneOf: [{ type: "object", properties: { id: { type: "string" } } }, { type: "null" }],
    },
  },
};
const deepResult = deepNormalizeSchema(nestedSchema);
const deepProperties = deepResult.properties as Record<string, { oneOf: Array<Record<string, unknown>> }>;
assert.equal(deepResult.type, "object");
assert.deepStrictEqual(deepProperties.payload.oneOf[0], {
  type: "object",
  properties: { id: { type: "string" } },
  required: [],
  additionalProperties: false,
});
assert.deepStrictEqual(deepProperties.payload.oneOf[1], { type: "null" });

console.log("All tests passed.");
