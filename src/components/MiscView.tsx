import { useMemo } from 'react';
import {
  describeDevice,
  deviceNumber,
  DYNAMIC_MINORS,
  isDynamic,
  MISC_MAJOR,
  parseMisc,
  summarize,
  type MiscDevice,
} from '../lib/misc';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function DeviceRow({ device }: { device: MiscDevice }) {
  const described = describeDevice(device.name);
  const dynamic = isDynamic(device);

  return (
    <tr className="misc__row">
      <td className="misc__minor">{device.minor}</td>
      <td className="misc__number" title={`Character device ${deviceNumber(device)}`}>
        {deviceNumber(device)}
      </td>
      <td className="misc__name">{device.name}</td>
      <td className="misc__kind">
        {dynamic ? (
          <span
            className="chip"
            title={`Handed out of the pool of ${DYNAMIC_MINORS} when the driver registered, so it differs between machines`}
          >
            dynamic
          </span>
        ) : (
          <span className="muted" title="Written into the kernel's headers, the same everywhere">
            fixed
          </span>
        )}
      </td>
      <td className="misc__what">
        {described === null ? (
          <span className="muted" title="This page has no note for this device">
            —
          </span>
        ) : (
          described
        )}
      </td>
    </tr>
  );
}

export function MiscView({ content }: { content: string }) {
  const info = useMemo(() => parseMisc(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  if (info.devices.length === 0) {
    return (
      <p className="notice notice--warn">
        No devices found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="devices" value={String(summary.total)} />
        <Stat label="fixed minors" value={String(summary.static.length)} />
        <Stat label="dynamic minors" value={String(summary.dynamic.length)} />
        <Stat label="pool left" value={`${summary.poolFree} of ${DYNAMIC_MINORS}`} />
      </section>

      <p className="models" data-testid="dynamic">
        {summary.dynamic.map((device) => (
          <span
            key={device.minor}
            className="chip chip--model"
            title="Given its minor at registration, counting down from 63"
          >
            {device.name} <span className="count">{device.minor}</span>
          </span>
        ))}
      </p>

      <div className="card mounts">
        <table className="mounts__table misc__table" aria-label="Misc character devices">
          <thead>
            <tr>
              <th scope="col">Minor</th>
              <th scope="col">Device</th>
              <th scope="col">Name</th>
              <th scope="col">Minor from</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          <tbody>
            {info.devices.map((device) => (
              <DeviceRow key={`${device.minor}-${device.name}`} device={device} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        The number in this file is a <strong>minor only</strong>. Everything here shares major{' '}
        <strong>{MISC_MAJOR}</strong> — that is what the misc driver is for, giving a device too
        small to deserve a major of its own a minor under a shared one — so the pair beside each
        name is what the device node actually is. The file itself never mentions the{' '}
        {MISC_MAJOR}; <code>/proc/devices</code> is where that lives, against the name{' '}
        <code>misc</code>. The minor also says where the number came from: below{' '}
        {DYNAMIC_MINORS} it was handed out of a pool when the driver registered, counting{' '}
        <strong>downwards from {DYNAMIC_MINORS - 1}</strong>, so it differs between machines and
        between boots; at {DYNAMIC_MINORS} or above it is written into the kernel&rsquo;s headers
        and is the same everywhere. The name is the driver&rsquo;s own, and udev usually — not
        always — makes <code>/dev/&lt;name&gt;</code> out of it: <code>device-mapper</code> turns
        up as <code>/dev/mapper/control</code>. The order is the kernel&rsquo;s list, newest
        registration first, rather than anything sorted.
      </p>
    </>
  );
}
