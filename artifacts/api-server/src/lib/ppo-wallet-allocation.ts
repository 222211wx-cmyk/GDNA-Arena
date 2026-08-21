export type PpoWalletShare = {
  id: number;
  shareRate: number;
};

/**
 * Splits a whole-coin wallet pool using largest remainder. The returned amounts
 * are in the same order as the supplied beneficiaries and always sum to pool.
 */
export function allocatePpoWalletCoins(pool: number, beneficiaries: PpoWalletShare[]): number[] {
  if (!Number.isSafeInteger(pool) || pool < 0 || beneficiaries.length === 0) {
    throw new Error("PPO wallet pool must be a non-negative whole number with beneficiaries");
  }

  const allocations = beneficiaries.map((beneficiary, index) => {
    const exact = (pool * beneficiary.shareRate) / 100;
    const amount = Math.floor(exact);
    return { index, amount, remainder: exact - amount };
  });

  let residual = pool - allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  for (const allocation of [...allocations].sort((a, b) =>
    b.remainder - a.remainder ||
    beneficiaries[b.index].shareRate - beneficiaries[a.index].shareRate ||
    beneficiaries[a.index].id - beneficiaries[b.index].id,
  )) {
    if (residual-- <= 0) break;
    allocation.amount += 1;
  }

  const amounts = allocations.map(allocation => allocation.amount);
  if (amounts.some(amount => amount < 0) || amounts.reduce((sum, amount) => sum + amount, 0) !== pool) {
    throw new Error("PPO wallet allocation did not reconcile");
  }
  return amounts;
}