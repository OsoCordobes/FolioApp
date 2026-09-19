export function extractEnvelope(events, operationId) {
  const pieces = new Map();
  let total;
  for (const event of events) {
    for (const line of String(event.text ?? '').split(/\r?\n/)) {
      const match = line.match(/^FOLIO_RECOVERY_V1 ([a-zA-Z0-9_-]+) (\d+)\/(\d+) ([A-Za-z0-9+/=]+)$/);
      if (!match || match[1] !== operationId) continue;
      const index = Number(match[2]);
      const count = Number(match[3]);
      if (!Number.isInteger(index) || index < 1 || index > count || count > 2000 || (total !== undefined && count !== total)) throw new Error('Incomplete or inconsistent recovery log');
      if (pieces.has(index) && pieces.get(index) !== match[4]) throw new Error('Incomplete or inconsistent recovery log');
      total = count;
      pieces.set(index, match[4]);
    }
  }
  if (!total || pieces.size !== total) throw new Error('Incomplete or inconsistent recovery log');
  const encoded = Array.from({ length: total }, (_, i) => pieces.get(i + 1)).join('');
  const envelope = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  if (envelope.context?.operationId !== operationId) throw new Error('Recovery operation mismatch');
  return envelope;
}
