/** Human-readable byte size shared by every workspace file surface. */
export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${String(size)} B`;
  const kib = size / 1024;
  if (kib < 1024) return `${formatScaledFileSize(kib)} KB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${formatScaledFileSize(mib)} MB`;
  return `${formatScaledFileSize(mib / 1024)} GB`;
}

function formatScaledFileSize(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

export function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost === 0) return "$0";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
