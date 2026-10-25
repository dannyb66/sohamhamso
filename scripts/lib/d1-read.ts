/** Administrative read-only D1 transport for operator reports, never website requests. */
export type D1ReadConfig = { accountId: string; databaseId: string; token: string };

export class D1ReadError extends Error {
  constructor(
    readonly tableMissing: boolean,
    status: number,
  ) {
    super(tableMissing ? 'D1 table is unavailable.' : `D1 read failed (HTTP ${status}).`);
  }
}

export async function readD1<T>(
  config: D1ReadConfig,
  sql: string,
  params: Array<string | number | null> = [],
  fetchImpl: typeof fetch = fetch,
): Promise<T[]> {
  if (!/^\s*SELECT\b/i.test(sql) || sql.replace(/;\s*$/, '').includes(';')) {
    throw new Error('D1 report transport only accepts a single SELECT.');
  }
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/d1/database/${encodeURIComponent(config.databaseId)}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = (await response.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: Array<{ success?: boolean; error?: string; results?: T[] }>;
  };
  const result = payload.result?.[0];
  if (
    !response.ok ||
    !payload.success ||
    result?.success !== true ||
    !Array.isArray(result.results)
  ) {
    const messages = [...(payload.errors ?? []).map((e) => e.message ?? ''), result?.error ?? ''];
    throw new D1ReadError(
      messages.some((message) => /no such table/i.test(message)),
      response.status,
    );
  }
  return result.results;
}
