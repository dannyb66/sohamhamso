import { describe, expect, it, vi } from 'vitest';
import { assertCountsOnlySql } from '../../scripts/demand-dashboard';
import { D1ReadError, readD1 } from '../../scripts/lib/d1-read';

const config = { accountId: 'account', databaseId: 'database', token: 'test-token' };

describe('D1 operator report transport', () => {
  it('rejects union and join escape hatches in the subscriber count guard', () => {
    for (const sql of [
      'SELECT COUNT(*) FROM subscribers UNION SELECT unsubscribe_token FROM subscribers',
      'SELECT COUNT(*) FROM subscribers JOIN other_table ON 1=1',
    ])
      expect(() => assertCountsOnlySql(sql)).toThrow('PII guard');
  });
  it('binds aggregate parameters and reads D1 results', async () => {
    const mock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        result: [{ success: true, results: [{ n: 4 }] }],
      }),
    );
    const sql = 'SELECT COUNT(*) AS n FROM subscribers WHERE subscribed_at >= ?';
    assertCountsOnlySql(sql);
    await expect(readD1(config, sql, ['2026-10-25'], mock)).resolves.toEqual([{ n: 4 }]);
    expect(mock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/account/d1/database/database/query',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sql, params: ['2026-10-25'] }),
      }),
    );
  });

  it('rejects mutations before any API request', async () => {
    const mock = vi.fn();
    await expect(readD1(config, 'DELETE FROM subscribers', [], mock)).rejects.toThrow(
      'single SELECT',
    );
    await expect(readD1(config, 'SELECT 1; DELETE FROM subscribers', [], mock)).rejects.toThrow(
      'single SELECT',
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it('fails closed for HTTP and per-query errors without exposing the response body', async () => {
    for (const response of [
      Response.json(
        { success: false, errors: [{ message: 'private provider detail' }] },
        { status: 403 },
      ),
      Response.json({ success: true, result: [{ success: false, error: 'private query detail' }] }),
      Response.json({ success: true, result: [] }),
    ]) {
      await expect(
        readD1(config, 'SELECT 1', [], vi.fn().mockResolvedValue(response)),
      ).rejects.toThrow(/^D1 read failed/);
    }
  });

  it('distinguishes an absent optional history table from an empty successful result', async () => {
    const mock = vi.fn().mockResolvedValue(
      Response.json(
        {
          success: false,
          errors: [{ message: 'no such table: search_misses' }],
        },
        { status: 400 },
      ),
    );
    await expect(readD1(config, 'SELECT query FROM search_misses', [], mock)).rejects.toMatchObject(
      { tableMissing: true },
    );
    expect(new D1ReadError(true, 400).message).toBe('D1 table is unavailable.');
  });
});
