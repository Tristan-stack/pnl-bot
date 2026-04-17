export const FEE_PER_TX_USD = 1
export const FEE_PER_TOKEN_USD = 2 * FEE_PER_TX_USD

export const computeTokenFees = (uniqueTokenCount: number): number =>
  uniqueTokenCount * FEE_PER_TOKEN_USD
