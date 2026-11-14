type QueryClient = {
  query: (statement: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};

type QueryPool = {
  connect: () => Promise<QueryClient>;
};

/**
 * Commits a unit of PPO work only when every database write succeeds.
 */
export async function withPpoTransaction<T>(pool: QueryPool, work: (client: QueryClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
  }
}

// STUB: original export missing from this repository.
import { makeStub } from "./_stub";
export const allocatePpoWalletCoins: any = makeStub();
