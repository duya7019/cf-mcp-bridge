export interface Env {
  CF_API_TOKEN: string;
  MCP_SHARED_SECRET: string;
  CF_ACCOUNT_ID?: string;
}

type ApiEnvelope<T> = {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: Array<{ code?: number; message?: string }>;
  result_info?: {
    page?: number;
    per_page?: number;
    total_pages?: number;
    count?: number;
    total_count?: number;
    cursors?: { after?: string; before?: string };
  };
};

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

export class CloudflareClient {
  private readonly baseUrl = "https://api.cloudflare.com/client/v4";

  constructor(
    private readonly apiToken: string,
    private readonly defaultAccountId?: string,
  ) {
    if (!apiToken) throw new Error("CF_API_TOKEN is required");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    const text = await response.text();
    let parsed: ApiEnvelope<T> | undefined;
    try {
      parsed = text ? (JSON.parse(text) as ApiEnvelope<T>) : undefined;
    } catch {
      throw new CloudflareApiError(
        `Cloudflare API returned non-JSON (${response.status})`,
        response.status,
        text.slice(0, 1000),
      );
    }

    if (!response.ok || !parsed?.success) {
      const message =
        parsed?.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
        `Cloudflare API request failed (${response.status})`;
      throw new CloudflareApiError(message, response.status, parsed);
    }

    return parsed.result;
  }

  private accountId(accountId?: string): string {
    const id = accountId ?? this.defaultAccountId;
    if (!id) {
      throw new Error(
        "An account_id is required. Pass account_id to the tool or set CF_ACCOUNT_ID as a Worker secret/variable.",
      );
    }
    return id;
  }

  async verifyToken() {
    return this.request<{
      id: string;
      status: string;
      not_before?: string;
      expires_on?: string;
    }>("/user/tokens/verify");
  }

  async listAccounts() {
    return this.request<Array<{ id: string; name: string }>>("/accounts?per_page=50");
  }

  async listZones(name?: string) {
    const params = new URLSearchParams({ per_page: "50" });
    if (name) params.set("name", name);
    return this.request<
      Array<{
        id: string;
        name: string;
        status: string;
        paused: boolean;
        type: string;
        account?: { id: string; name: string };
      }>
    >(`/zones?${params.toString()}`);
  }

  async listDnsRecords(zoneId: string, recordType?: string, name?: string) {
    const params = new URLSearchParams({ per_page: "100" });
    if (recordType) params.set("type", recordType);
    if (name) params.set("name", name);
    return this.request<
      Array<{
        id: string;
        type: string;
        name: string;
        content: string;
        proxied?: boolean;
        ttl: number;
        comment?: string;
      }>
    >(`/zones/${encodeURIComponent(zoneId)}/dns_records?${params.toString()}`);
  }

  async listWorkers(accountId?: string) {
    const id = this.accountId(accountId);
    return this.request<
      Array<{
        id: string;
        etag?: string;
        modified_on?: string;
        created_on?: string;
        compatibility_date?: string;
        usage_model?: string;
      }>
    >(`/accounts/${encodeURIComponent(id)}/workers/scripts`);
  }

  async listPagesProjects(accountId?: string) {
    const id = this.accountId(accountId);
    return this.request<
      Array<{
        id: string;
        name: string;
        subdomain?: string;
        domains?: string[];
        created_on?: string;
        production_branch?: string;
      }>
    >(`/accounts/${encodeURIComponent(id)}/pages/projects`);
  }

  async listR2Buckets(accountId?: string) {
    const id = this.accountId(accountId);
    return this.request<
      Array<{
        name: string;
        creation_date?: string;
        location?: string;
        storage_class?: string;
      }>
    >(`/accounts/${encodeURIComponent(id)}/r2/buckets`);
  }

  async listTunnels(accountId?: string) {
    const id = this.accountId(accountId);
    const params = new URLSearchParams({ per_page: "100", is_deleted: "false" });
    return this.request<
      Array<{
        id: string;
        name: string;
        status?: string;
        created_at?: string;
        deleted_at?: string | null;
        connections?: Array<{
          colo_name?: string;
          id?: string;
          is_pending_reconnect?: boolean;
          opened_at?: string;
        }>;
      }>
    >(`/accounts/${encodeURIComponent(id)}/cfd_tunnel?${params.toString()}`);
  }

  async getTunnel(tunnelId: string, accountId?: string) {
    const id = this.accountId(accountId);
    return this.request<{
      id: string;
      name: string;
      status?: string;
      created_at?: string;
      deleted_at?: string | null;
      connections?: Array<{
        colo_name?: string;
        id?: string;
        is_pending_reconnect?: boolean;
        opened_at?: string;
      }>;
    }>(`/accounts/${encodeURIComponent(id)}/cfd_tunnel/${encodeURIComponent(tunnelId)}`);
  }
}
