# mcp-dialect-fix

Fix `JSON Schema declares an unsupported dialect` errors in Claude Desktop and newer MCP clients.

MCP servers built on `@modelcontextprotocol/sdk` v1 advertise tool `inputSchema`/`outputSchema` in JSON Schema draft-07. Clients that validate JSON Schema 2020-12 reject those tools. `mcp-dialect-fix` converts the schemas to 2020-12:

- a stdio proxy: `npx -y mcp-dialect-fix -- <server command...>`
- a library: `fixDialect(transport)` and `convertSchema(schema)`
- a CI check: `npx mcp-dialect-fix check -- node server.js`

Work in progress. Not published to npm yet.

License: MIT
