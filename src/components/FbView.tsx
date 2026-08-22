import { useMemo } from 'react';
import {
  deviceOf,
  firmwareDriver,
  kindOf,
  parseFb,
  summarize,
  type Framebuffer,
} from '../lib/fb';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** How each kind is labelled, and what the label means. */
const KINDS = {
  drm: {
    label: 'DRM',
    title: "A modern DRM driver's fbdev emulation, not a native fbdev driver",
  },
  firmware: {
    label: 'firmware',
    title: 'Drives nothing: it writes to the buffer the firmware left running',
  },
  fbdev: {
    label: 'fbdev',
    title: 'A native fbdev driver, of which few remain',
  },
} as const;

function FbRow({ framebuffer }: { framebuffer: Framebuffer }) {
  const kind = kindOf(framebuffer);
  const firmware = firmwareDriver(framebuffer);

  return (
    <tr className="fb__row">
      <td className="fb__device">{deviceOf(framebuffer)}</td>
      <td className="fb__name">
        {framebuffer.name}
        {firmware !== null && (
          <span className="chip" title={`Set up by ${firmware}`}>
            {firmware}
          </span>
        )}
      </td>
      <td className="fb__kind">
        <span className="chip" title={KINDS[kind].title}>
          {KINDS[kind].label}
        </span>
      </td>
    </tr>
  );
}

export function FbView({ content }: { content: string }) {
  const info = useMemo(() => parseFb(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  /**
   * An empty file is a machine that registered no framebuffer, which is the
   * normal state of a server and not a failure to read anything.
   */
  if (info.framebuffers.length === 0) {
    return (
      <p className="notice" role="status">
        No framebuffer is registered on this machine. That is normal on a headless server, or on a
        kernel built without fbdev — a graphics card can still be driven through{' '}
        <code>/dev/dri</code>, since <code>/dev/fb*</code> is only the older interface.
      </p>
    );
  }

  return (
    <>
      {summary.firmwareOnly && (
        <p className="notice notice--warn" role="status">
          Every framebuffer here is a firmware handover, so no driver has taken over the hardware.
          The console works, but it is being painted into the buffer the firmware left running —
          normal early in boot, and on a machine with no driver for its card.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="framebuffers" value={String(summary.total)} />
        <Stat label="DRM" value={String(summary.drm.length)} />
        <Stat label="firmware" value={String(summary.firmware.length)} />
      </section>

      <div className="card mounts">
        <table className="mounts__table fb__table" aria-label="Registered framebuffers">
          <thead>
            <tr>
              <th scope="col">Device</th>
              <th scope="col">Driver</th>
              <th scope="col">Kind</th>
            </tr>
          </thead>
          <tbody>
            {info.framebuffers.map((framebuffer) => (
              <FbRow key={framebuffer.node} framebuffer={framebuffer} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        The number the file prints is the framebuffer&rsquo;s <strong>node</strong>, so it names{' '}
        <code>/dev/fb&lt;n&gt;</code> rather than counting the lines — a gap means one was
        unregistered, which is what happens when a real driver displaces the firmware framebuffer.
        The name is the driver&rsquo;s <code>fix.id</code>, a 16-byte field, so it is at most 15
        characters and may be cut short. A name ending in <code>drmfb</code> is a DRM
        driver&rsquo;s fbdev emulation rather than a native fbdev driver, which is what nearly
        every machine has now.
      </p>
    </>
  );
}
