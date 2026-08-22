import { useMemo } from 'react';
import {
  CASCADE_CHANNEL,
  controllerOf,
  ISA_CHANNELS,
  isCascade,
  parseDma,
  summarize,
  widthOf,
  type DmaChannel,
} from '../lib/dma';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function ChannelRow({ channel, holder }: { channel: number; holder: DmaChannel | undefined }) {
  const cascade = isCascade(channel);
  const free = holder === undefined;

  return (
    <tr className={free ? 'dma__row dma__row--free' : 'dma__row'}>
      <td className="dma__channel">{channel}</td>
      <td className="dma__device">
        {holder === undefined ? (
          <span className="muted">free</span>
        ) : (
          <>
            {holder.device}
            {/* The kernel already calls this channel `cascade`, so the badge
                says what that means rather than repeating the name. */}
            {cascade && (
              <span
                className="chip"
                title="Chains the second controller to the first; it cannot carry data"
              >
                not usable
              </span>
            )}
          </>
        )}
      </td>
      <td className="dma__number">{widthOf(channel)}-bit</td>
      <td className="dma__number">{controllerOf(channel)}</td>
    </tr>
  );
}

export function DmaView({ content }: { content: string }) {
  const info = useMemo(() => parseDma(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  /**
   * `No DMA` is a statement, not an empty list: the machine has no ISA DMA
   * controller at all, so there is nothing to tabulate.
   */
  if (!info.supported) {
    return (
      <p className="notice" role="status">
        This machine has no ISA DMA controller — the kernel reports{' '}
        <code>No DMA</code> rather than a channel list, which is normal on ARM64 and anything else
        without the legacy 8237 pair. Modern devices do their own bus-mastering and never appear
        here.
      </p>
    );
  }

  if (!summary.isa) {
    // A channel outside 0–7 means some other controller, so the eight-channel
    // picture below would be a fiction.
    return (
      <>
        <section className="summary" data-testid="summary">
          <Stat label="allocated" value={String(summary.allocated)} />
        </section>

        <div className="card mounts">
          <table className="mounts__table dma__table" aria-label="Allocated DMA channels">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">Allocated to</th>
              </tr>
            </thead>
            <tbody>
              {info.channels.map((entry) => (
                <tr key={entry.channel} className="dma__row">
                  <td className="dma__channel">{entry.channel}</td>
                  <td className="dma__device">{entry.device}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="disks__note muted">
          A channel outside 0–7 means a controller other than the ISA 8237 pair, so nothing about
          8-bit and 16-bit halves or the cascade applies here.
        </p>
      </>
    );
  }

  const holders = new Map(info.channels.map((entry) => [entry.channel, entry]));

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="allocated" value={`${summary.allocated} of ${ISA_CHANNELS}`} />
        <Stat label="carrying data" value={String(summary.inUse.length)} />
        <Stat label="free" value={String(summary.free.length)} />
      </section>

      {summary.inUse.length > 0 && (
        <p className="models">
          {summary.inUse.map((entry) => (
            <span key={entry.channel} className="chip chip--model">
              {entry.device} <span className="count">ch {entry.channel}</span>
            </span>
          ))}
        </p>
      )}

      <div className="card mounts">
        <table className="mounts__table dma__table" aria-label="ISA DMA channels">
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col">Allocated to</th>
              <th scope="col">Width</th>
              <th scope="col">Controller</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ISA_CHANNELS }, (_, channel) => (
              <ChannelRow key={channel} channel={channel} holder={holders.get(channel)} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        The file lists <strong>only allocated channels</strong>, so the free rows above are inferred
        rather than read — a machine with no ISA cards shows a single line. The eight channels are
        two cascaded 8237 controllers: 0–3 move 8 bits at a time, 4–7 move 16, and channel{' '}
        {CASCADE_CHANNEL} is the cascade chaining the second to the first, which is why it is always
        allocated and never usable. Modern hardware bus-masters instead and never appears here.
      </p>
    </>
  );
}
