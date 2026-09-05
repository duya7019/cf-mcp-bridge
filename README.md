# cf-mcp-bridge

A small, read-only Model Context Protocol (MCP) bridge for Cloudflare, deployed on Cloudflare Workers.

The bridge is intentionally narrow: it exposes a handful of useful Cloudflare account inspection tools instead of wrapping the entire Cloudflare API. The MCP endpoint fails closed unless both the Cloudflare API token and the MCP client secret are configured.

## Current tools

- `cloudflare_token_status` — verify the configured Cloudflare API token
- `list_accounts` — list accounts visible to the token
- `list_zones` — list zones/domains, optionally filtered by name
- `list_dns_records` — inspect DNS records for a zone
- `list_workers` — list Worker scripts
- `list_pages_projects` — list Pages projects
- `list_r2_buckets` — list R2 buckets
- `list_tunnels` — list active Cloudflare Tunnels and connections
- `get_tunnel_status` — inspect one Tunnel

All current tools are **read-only**. There are no DNS mutation, Worker deployment, R2 deletion, cache purge, or Tunnel mutation tools in v0.1.

## Architecture

```text
MCP client
   |
   | Authorization: Bearer <MCP_SHARED_SECRET>
   v
Cloudflare Worker /mcp
   |
   | CF_API_TOKEN (Worker secret)
   v
Cloudflare API
```

`GET /health` is public and returns only service health. `/mcp` requires the bearer secret.

The Cloudflare API token never needs to be stored in an MCP client. It stays in the Worker secret store.

## Requirements

- Node.js 20+
- A Cloudflare account
- Wrangler authenticated to the Cloudflare account
- A **read-only / least-privilege Cloudflare API token**

Cloudflare recommends `createMcpHandler()` for new stateless MCP servers. This project uses the current Streamable HTTP stateless handler rather than the deprecated `McpAgent` path.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars` with local values:

```dotenv
CF_API_TOKEN="..."
CF_ACCOUNT_ID="..."
MCP_SHARED_SECRET="..."
```

Generate a strong MCP shared secret, for example:

```bash
openssl rand -hex 32
```

Then run:

```bash
npm run dev
```

The MCP endpoint will normally be:

```text
http://localhost:8787/mcp
```

Health check:

```bash
curl http://localhost:8787/health
```

## Test with MCP Inspector

Run the inspector in another terminal:

```bash
npx @modelcontextprotocol/inspector@latest
```

Use the local MCP URL and send this header:

```text
Authorization: Bearer <MCP_SHARED_SECRET>
```

Then connect and use **List Tools**.

## Deploy to Cloudflare Workers

Authenticate Wrangler if needed:

```bash
npx wrangler login
```

Set the secrets. Do not put real values in `wrangler.jsonc` or commit them to Git.

```bash
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put MCP_SHARED_SECRET
npx wrangler secret put CF_ACCOUNT_ID
```

`CF_ACCOUNT_ID` is technically not sensitive, but storing it alongside the other deployment values keeps the repository generic. You may also configure it as a normal Worker variable if you prefer.

Deploy:

```bash
npm run deploy
```

The endpoint will be similar to:

```text
https://cf-mcp-bridge.<your-workers-subdomain>.workers.dev/mcp
```

## Cloudflare API token permissions

Create a dedicated token for this bridge. Do **not** use the Global API Key.

Only grant permissions for the tools you actually want enabled. The exact Cloudflare permission labels can vary by product and account configuration, but the token should be limited to read access for the relevant resources, such as:

- Account / account information: read
- Zone: read
- DNS: read
- Workers Scripts: read
- Pages: read
- R2: read
- Cloudflare Tunnel: read

Restrict the token to the specific account and zones whenever possible.

If a tool returns a Cloudflare permission error, add only the missing read scope rather than broadening the token to edit access.

## Connect from an MCP client

Clients that support remote Streamable HTTP and custom headers can connect directly to `/mcp` with the bearer secret.

For clients that use a local proxy, `mcp-remote` can bridge to the remote endpoint. The exact header configuration depends on the client/version; keep `MCP_SHARED_SECRET` on the local machine and never embed the Cloudflare API token in the client.

## Security model

The v0.1 security model is deliberately simple:

1. A dedicated Cloudflare API token is stored only as a Worker secret.
2. The Cloudflare API token should be read-only and resource-scoped.
3. The `/mcp` endpoint requires an independent bearer secret.
4. If required secrets are missing, `/mcp` returns `503` instead of starting insecurely.
5. The repository contains no credentials.
6. No destructive MCP tools exist.

For a single-user deployment this is a pragmatic first layer. The next security upgrade is to put the MCP endpoint behind **Cloudflare Access / OAuth**, so MCP clients authenticate through an identity provider rather than a static shared secret.

## Planned v0.2

- Cloudflare Access / OAuth protection
- Audit log reader
- Worker/Pages deployment status and recent failures
- Better pagination for very large accounts
- Explicit output schemas
- Tests against mocked Cloudflare API responses

Write actions should be added only as a separate, deliberately scoped layer, ideally using a second Cloudflare API token with narrowly limited edit permissions.

## Useful commands

```bash
npm run dev
npm run typecheck
npm run deploy
```

## References

- Cloudflare Agents MCP docs: https://developers.cloudflare.com/agents/model-context-protocol/
- Remote MCP server guide: https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/
- MCP handler API: https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/
- Cloudflare API: https://developers.cloudflare.com/api/

## License

Private/internal use unless you choose to add a license later.
