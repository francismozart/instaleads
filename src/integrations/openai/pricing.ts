/**
 * Model pricing (USD per 1M tokens). Used to estimate the cost of each call so
 * the panel can show cost-per-lead and cost-per-active-customer, and so the
 * budget guard can stop the system at the monthly ceiling.
 *
 * Prices are configurable and intentionally conservative; unknown models fall
 * back to a default so accounting never silently reports zero.
 */
export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICES: Record<string, ModelPrice> = {
  "gpt-4.1": { inputPerMillion: 2.0, outputPerMillion: 8.0 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "gpt-4.1-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

const DEFAULT_PRICE: ModelPrice = { inputPerMillion: 2.5, outputPerMillion: 10.0 };

export function priceFor(model: string): ModelPrice {
  return PRICES[model] ?? DEFAULT_PRICE;
}

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = priceFor(model);
  const cost = (promptTokens / 1_000_000) * p.inputPerMillion + (completionTokens / 1_000_000) * p.outputPerMillion;
  // round to 6 decimals to keep sums stable
  return Math.round(cost * 1e6) / 1e6;
}
