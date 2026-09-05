import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { CloudflareClient, CloudflareApiError, type Env } from "./cloudflare";

function jsonText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorText(error: unknown) {
  const message =
    error instanceof CloudflareApiError
      ? `${error.message}${error.status ? ` (HTTP ${error.status})` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);

  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function createServer(env: Env) {
  const cf = new CloudflareClient(env.CF_API_TOKEN, env.CF_ACCOUNT_ID);
  const server = new McpServer({
    name: "cf-mcp-bridge",
    version: "0.1.0",
  });

  server.registerTool(
    "cloudflare_token_status",
    {
      description:
        "Verify the configured Cloudflare API token and return its status. Read-only.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonText(await cf.verifyToken());
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    "list_accounts",
    {
      description:
        "List Cloudflare accounts visible to the configured API token. Read-only.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonText(await cf.listAccounts());
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    "list_zones",
    {
      description:
        "List Cloudflare zones (domains) visible to the token. Optionally filter by exact domain name. Read-only.",
      inputSchema: {
        name: z.string().min(1).optional().describe("Optional domain name, e.g. example.com"),
      },
    },
    async ({ name }) => {
      try {
        return jsonText(await cf.listZones(name));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    "list_dns_records",
    {
      description:
        "List DNS records for a Cloudflare zone. Requires the zone ID. Read-only.",
      inputSchema: {
        zone_id: z.string().min(1).describe("Cloudflare zone ID"),
        type: z.string().min(1).optional().describe("Optional record type, e.g. A, AAAA, CNAME, TXT"),
        name: z.string().min(1).optional().describe("Optional DNS name filter"),
      },
    },
    async ({ zone_id, type, name }) => {
      try {
        return jsonText(await cf.listDnsRecords(zone_id, type, name));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    "list_workers",
    {
      description:
        "List Worker scripts for a Cloudflare account. Uses CF_ACCOUNT_ID by default. Read-only.",
      inputSchema: {
        account_id: z.string().min(1).optional().describe("Optional Cloudflare account ID override"),
      },
    },
    async ({ account_id }) => {
      try {
        return jsonText(await cf.listWorkers(account_id));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    "list_pages_projects",
    {
      description:
        "List Cloudflare Pages projects for an account. Uses CF_ACCOUNT_ID by default. Read-only.",
      inputSchema: {
        account_id: z.string().min(1).optional().describe("Optional Cloudflare account ID override"),
      },
    },
    async ({ account_id }) => {
      try {
        return jsonText(await cf.listPagesProjects(account_id));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    "list_r2_buckets",
    {
      description:
        "List R2 buckets for a Cloudflare account. Uses CF_ACCOUNT_ID by default. Read-only.",
      inputSchema: {
        account_id: z.string().min(1).optional().describe("Optional Cloudflare account ID override"),
      },
    },
    async ({ account_id }) => {
      try {
        return jsonText(await cf.listR2Buckets(account_id));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    "list_tunnels",
    {
      description:
        "List active Cloudflare Tunnels and connection summaries. Uses CF_ACCOUNT_ID by default. Read-only.",
      inputSchema: {
        account_id: z.string().min(1).optional().describe("Optional Cloudflare account ID override"),
      },
    },
    async ({ account_id }) => {
      try {
        return jsonText(await cf.listTunnels(account_id));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  server.registerTool(
    "get_tunnel_status",
    {
      description:
        "Get one Cloudflare Tunnel and its current connection metadata. Uses CF_ACCOUNT_ID by default. Read-only.",
      inputSchema: {
        tunnel_id: z.string().min(1).describe("Cloudflare Tunnel UUID"),
        account_id: z.string().min(1).optional().describe("Optional Cloudflare account ID override"),
      },
    },
    async ({ tunnel_id, account_id }) => {
      try {
        return jsonText(await cf.getTunnel(tunnel_id, account_id));
      } catch (error) {
        return errorText(error);
      }
    },
  );

  return server;
}

function unauthorized() {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": "Bearer" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "cf-mcp-bridge", version: "0.1.0" });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    if (!env.MCP_SHARED_SECRET || !env.CF_API_TOKEN) {
      return new Response("Server secrets are not configured", { status: 503 });
    }

    const authorization = request.headers.get("Authorization") ?? "";
    const prefix = "Bearer ";
    if (!authorization.startsWith(prefix)) return unauthorized();

    const presented = authorization.slice(prefix.length);
    if (!constantTimeEqual(presented, env.MCP_SHARED_SECRET)) return unauthorized();

    return createMcpHandler(() => createServer(env), {
      legacy: "stateless",
    })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
