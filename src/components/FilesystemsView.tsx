import { useMemo } from 'react';
import {
  isInternal,
  kindOf,
  mountOrder,
  NODEV,
  parseFilesystems,
  summarize,
  type Filesystem,
} from '../lib/filesystems';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** How each kind is labelled, and where its data comes from. */
const KINDS = {
  device: { label: 'block device', title: 'A mount of this needs a block device' },
  network: { label: 'network', title: 'Its data comes from a server, so it needs no device' },
  virtual: { label: 'virtual', title: 'The kernel makes its contents up; there is nothing behind it' },
} as const;

function FilesystemRow({ filesystem }: { filesystem: Filesystem }) {
  const kind = kindOf(filesystem);

  return (
    <tr className="fs__row">
      <td className="fs__name">
        {filesystem.name}
        {isInternal(filesystem) && (
          <span
            className="chip"
            title="Registered for the kernel's own use; mounting it from userspace fails"
          >
            kernel only
          </span>
        )}
      </td>
      <td className="fs__field">
        {filesystem.requiresDevice ? (
          <span className="muted" title="The kernel prints nothing in this field">
            —
          </span>
        ) : (
          NODEV
        )}
      </td>
      <td className="fs__kind">
        <span className="chip" title={KINDS[kind].title}>
          {KINDS[kind].label}
        </span>
      </td>
    </tr>
  );
}

export function FilesystemsView({ content }: { content: string }) {
  const info = useMemo(() => parseFilesystems(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);
  const order = useMemo(() => mountOrder(info), [info]);

  if (info.filesystems.length === 0) {
    return (
      <p className="notice notice--warn">
        No filesystems found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="filesystems" value={String(summary.total)} />
        <Stat label="need a device" value={String(summary.device.length)} />
        <Stat label="network" value={String(summary.network.length)} />
      </section>

      {order.length > 0 && (
        <p className="models" data-testid="mount-order">
          {order.map((filesystem) => (
            <span key={filesystem.name} className="chip chip--model">
              {filesystem.name}
            </span>
          ))}
        </p>
      )}

      <div className="card mounts">
        <table className="mounts__table fs__table" aria-label="Registered filesystems">
          <thead>
            <tr>
              <th scope="col">Filesystem</th>
              <th scope="col">First field</th>
              <th scope="col">Backed by</th>
            </tr>
          </thead>
          <tbody>
            {info.filesystems.map((filesystem) => (
              <FilesystemRow key={filesystem.name} filesystem={filesystem} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        This is what the kernel can mount <strong>now</strong> — built in, or brought in by a module
        — and not what is mounted; a type missing here can still be mounted if that mount autoloads
        its module. The first field is either <code>{NODEV}</code> or nothing, and it says only that
        the filesystem <strong>needs no block device</strong>: the virtual ones the kernel makes up
        as it goes and the network ones fed by a server are both <code>{NODEV}</code>, and telling
        those apart is done here by name rather than by anything the file says. The order is
        registration order, so the entries the kernel started with come first and a module loaded
        later sits at the end — and it is the order <code>mount</code> works through, skipping the{' '}
        <code>{NODEV}</code> entries, when it is given no <code>-t</code>. The chips above are that
        list, in that order.
      </p>
    </>
  );
}
