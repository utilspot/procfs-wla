import { useCallback, useEffect, useState } from 'react';
import { AdminPath } from './components/ProcPath';
import { SiteFooter } from './components/SiteFooter';
import { getMachines, setMachine, type Machine } from './api/admin';
import { HOST_ROOT } from './api/paths';

/**
 * The fixture switcher: **which computer the test server is being**.
 *
 * One choice for the whole of `/proc` rather than one per file, so every page
 * is looking at the same machine, the way they would be on a real one. Five of
 * the six are captures; the last is `host`, which reads the real `/proc` on the
 * computer this server runs on and is the only way to point the pages at what
 * it says right now.
 */

/** The choice that is not a capture, which the server offers last. */
const HOST_MACHINE = 'host';

function MachineButton({
  machine,
  current,
  busy,
  onPick,
}: {
  machine: Machine;
  current: string;
  busy: boolean;
  onPick: (name: string) => void;
}) {
  const selected = machine.name === current;
  const host = machine.name === HOST_MACHINE;

  return (
    <button
      type="button"
      className={`card admin__machine${selected ? ' admin__machine--selected' : ''}`}
      aria-pressed={selected}
      disabled={busy}
      onClick={() => onPick(machine.name)}
    >
      <span className="admin__machine-name">
        {machine.name}
        {host && (
          <span className="chip chip--live" title={`Reads ${HOST_ROOT} on this computer`}>
            live
          </span>
        )}
        {selected && <span className="chip admin__machine-mark">serving</span>}
      </span>
      <span className="admin__machine-description">{machine.description}</span>
    </button>
  );
}

export function AdminApp() {
  const [catalogue, setCatalogue] = useState<{ machines: Machine[]; current: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<{ name: string; at: Date } | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    getMachines(signal)
      .then((next) => {
        setCatalogue(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (signal?.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const pick = async (name: string) => {
    setBusy(true);
    try {
      const current = await setMachine(name);
      setCatalogue((previous) => (previous === null ? previous : { ...previous, current }));
      setApplied({ name: current, at: new Date() });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        {/* Spelt as the path it is served at, and leading back the way every
            other page's heading does — this page is entered directly, so the
            way out of it is worth as much as the way out of a file. */}
        <AdminPath />
        <span className="badge">debug build</span>
      </header>

      <main>
        {error !== null && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}

        {catalogue === null && error === null && (
          <p className="notice" role="status">
            Loading machines…
          </p>
        )}

        {catalogue !== null && (
          <>
            <p className="admin__lead">
              Pick which computer the test server is. The choice covers the whole of{' '}
              <code>{HOST_ROOT}</code> — every page reads the same machine, the way they would on a
              real one — and holds from now on, so reload a page to see it.
            </p>

            <section className="admin__machines" aria-label="Machines">
              {catalogue.machines.map((machine) => (
                <MachineButton
                  key={machine.name}
                  machine={machine}
                  current={catalogue.current}
                  busy={busy}
                  onPick={pick}
                />
              ))}
            </section>

            {applied !== null && (
              <p className="app__footer muted" role="status">
                Serving {applied.name} since {applied.at.toLocaleTimeString()}
              </p>
            )}
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
