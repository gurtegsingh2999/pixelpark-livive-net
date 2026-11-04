/**
 * Guest estimate of `hostNow - localNow`.
 * One sample is `hostAt - (sentAt + rtt / 2)`.
 */
export function createClockOffset(maxSamples = 8) {
  const samples = [];
  return {
    note({ sentAt, hostAt, receivedAt } = {}) {
      const sent = Number(sentAt);
      const host = Number(hostAt);
      const received = Number(receivedAt);
      const rtt = received - sent;
      if (!Number.isFinite(sent) || !Number.isFinite(host) || !Number.isFinite(received)) return this.offset;
      if (rtt < 0) return this.offset;
      samples.push(host - (sent + rtt / 2));
      if (samples.length > maxSamples) samples.shift();
      return this.offset;
    },
    get offset() {
      if (!samples.length) return 0;
      const sorted = [...samples].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2) return sorted[mid];
      return (sorted[mid - 1] + sorted[mid]) / 2;
    },
    get synced() {
      return samples.length > 0;
    },
    hostToLocal(hostAt) {
      return Number(hostAt) - this.offset;
    }
  };
}
