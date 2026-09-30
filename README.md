# mcp-dialect-fix

Stop **JSON Schema declares an unsupported dialect** from failing every tool call in Claude Desktop and Cowork.

MCP servers built on `@modelcontextprotocol/sdk` v1 advertise each tool's `inputSchema` and `outputSchema` as JSON Schema draft-07. Claude Desktop and Cowork validate JSON Schema 2020-12 only: the tool list loads, and every tool call then fails with "JSON Schema declares an unsupported dialect". Deleting `$schema` is not enough: a zod tuple is still `items: [...]` plus `additionalItems: false`, and strict Ajv 2020 rejects that with `items must be object,boolean`. Clients on MCP TypeScript SDK >= 2.0.0 accept draft-07 ([typescript-sdk#2534](https://github.com/modelcontextprotocol/typescript-sdk/pull/2534)), so this package is for Claude Desktop and Cowork (and other strict 2020-12-only validators) running servers you can't easily upgrade.

`mcp-dialect-fix` rewrites those schemas to 2020-12. It is a stdio proxy, a `check` command for CI, and two library functions.

## Install

Node.js 18 or newer.

```bash
npm install mcp-dialect-fix
```

The package is ESM. `@modelcontextprotocol/sdk` is an optional peer dependency, used only if you call `fixDialect` from your own server. The CLI does not load the SDK.

## Claude Desktop

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "mcp-dialect-fix", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Documents"]
    }
  }
}
```

`npx` talks to `mcp-dialect-fix`. Everything after `--` is the real server. stdout stays the JSON-RPC channel.

## CLI proxy

```bash
npx -y mcp-dialect-fix -- <server command...>
```

The proxy spawns the server and copies newline-delimited JSON-RPC both ways. It rewrites `tools/list` results and forwards every other line unchanged, including non-JSON log lines. Server stderr is copied to the proxy's stderr. The server's exit code is forwarded, and `SIGINT`, `SIGTERM`, and `SIGHUP` are forwarded to the server.

A response is rewritten only when its id matches a `tools/list` request seen on the way in. A payload that merely looks like a tool list is left alone.

## Library

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { convertSchema, fixDialect } from "mcp-dialect-fix";

await server.connect(fixDialect(new StdioServerTransport()));

const schema = convertSchema(draft07Schema);
```

`fixDialect` wraps any SDK v1 transport. `convertSchema` is a pure function: it returns a new schema and does not mutate the input. `convertSchema(convertSchema(schema))` deep-equals `convertSchema(schema)`.

## Check schemas in CI

```bash
npx mcp-dialect-fix check -- node server.js
```

`check` spawns the server, sends `initialize` and `notifications/initialized`, then `tools/list`, and follows `nextCursor`. It prints a short report and exits:

- `0` when every `inputSchema` and `outputSchema` is JSON Schema 2020-12
- `1` when any tool fails
- `2` when the server cannot be started, the handshake fails, or the server does not finish within 15 seconds

A schema fails when any of these is true outside non-schema keywords such as `enum`, `const`, `default`, and `examples`:

- `$schema` is present and is not `https://json-schema.org/draft/2020-12/schema` (a trailing `#` is accepted)
- `items` is an array
- `additionalItems`, `definitions`, or `dependencies` is present
- the schema does not compile with Ajv 2020 (`ajv/dist/2020`, default strictness, `validateFormats: false`)

Format annotations such as `email` are not dialect errors. Array-form `items` still fails compilation (`items must be object,boolean`).

```text
2 tool(s) are not JSON Schema 2020-12.

echo
  inputSchema:
    - $schema is http://json-schema.org/draft-07/schema#
    - strict Ajv 2020: no schema with key or ref "http://json-schema.org/draft-07/schema#"
  outputSchema:
    - $schema is http://json-schema.org/draft-07/schema#
    - items is an array at /properties/pair
    - additionalItems is present at /properties/pair
    - strict Ajv 2020: no schema with key or ref "http://json-schema.org/draft-07/schema#"

lookup
  inputSchema:
    - $schema is http://json-schema.org/draft-07/schema#
    - definitions is present
    - strict Ajv 2020: no schema with key or ref "http://json-schema.org/draft-07/schema#"
```

A clean server prints `OK: N tool(s) use JSON Schema 2020-12.`

```yaml
- name: Check MCP tool schemas
  run: npx mcp-dialect-fix check -- node server.js
```

## What gets converted

Only the root schema receives `$schema: https://json-schema.org/draft/2020-12/schema`. Nested `$schema` values are removed.

| Draft-04/06/07 | JSON Schema 2020-12 |
| --- | --- |
| `items: [schema, ...]` | `prefixItems: [schema, ...]` |
| `additionalItems` beside an array `items` | `items` (`false` stays `false`; a schema is converted) |
| `additionalItems` beside a non-array `items`, or with no `items` | removed (it does not apply in those drafts) |
| `definitions` | `$defs` (existing `$defs` keys win) |
| `$ref: "#/definitions"` and `"#/definitions/..."` | `"#/$defs"` and `"#/$defs/..."`, including nested refs and JSON Pointer escapes such as `~0` and `~1` |
| `dependencies` property-name arrays | `dependentRequired` |
| `dependencies` schemas | `dependentSchemas` |

Subschemas are rewritten in `properties`, `patternProperties`, `additionalProperties`, `items`, `prefixItems`, `contains`, `propertyNames`, `unevaluatedItems`, `unevaluatedProperties`, `not`, `if` / `then` / `else`, `allOf` / `anyOf` / `oneOf`, `$defs` / `definitions`, `dependentSchemas`, and `contentSchema`. Other keywords (`description`, `format`, `examples`, `const`, `enum`, `default`, …) are copied through.

External `$ref`s, including ones whose fragment contains `/definitions/`, are not rewritten.

## Why

`@modelcontextprotocol/sdk` v1 (1.31.0) still emits draft-07 from zod, including tuple `items` arrays. Claude Desktop and Cowork then fail each tool call:

- [anthropics/claude-code#88882](https://github.com/anthropics/claude-code/issues/88882) — server-filesystem unusable in Claude Desktop since 2025.11.25
- [anthropics/claude-code#94351](https://github.com/anthropics/claude-code/issues/94351) — first-party Filesystem extension rejected
- [modelcontextprotocol/typescript-sdk#2084](https://github.com/modelcontextprotocol/typescript-sdk/issues/2084) — SDK regression; fix PRs [#2085](https://github.com/modelcontextprotocol/typescript-sdk/pull/2085) and [#2653](https://github.com/modelcontextprotocol/typescript-sdk/pull/2653) were still unmerged
- [mongodb-js/mongodb-mcp-server#1427](https://github.com/mongodb-js/mongodb-mcp-server/issues/1427) — every tool unusable

When the SDK starts emitting 2020-12 itself, this package is still the shim for pinned and bundled servers that keep shipping the old schemas.

## License

MIT © Salman Khan
