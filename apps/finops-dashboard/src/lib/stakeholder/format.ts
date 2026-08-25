/**
 * pt-BR formatting for cards.
 *
 * Formatting is not recalculation: these functions only choose how a verified
 * number is written. None of them changes the magnitude of the value.
 */

const NAO_AVALIADO = "Not assessed";

export function formatCurrency(value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return NAO_AVALIADO;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return NAO_AVALIADO;
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)}%`;
}

/** Percentage with an explicit sign for changes. */
export function formatSignedPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return NAO_AVALIADO;
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPercent(value, digits)}`;
}

export function formatCount(value: number | null, suffix = ""): string {
  if (value === null || !Number.isFinite(value)) return NAO_AVALIADO;
  const formatted = new Intl.NumberFormat("pt-BR").format(value);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

/** Free text that may be absent and never becomes a silent empty string. */
export function formatText(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : NAO_AVALIADO;
}

export { NAO_AVALIADO };
