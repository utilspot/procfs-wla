import { useMemo } from 'react';
import {
  BANNER,
  builtForAnotherKernel,
  fieldsOf,
  KERNEL_VERSION_SINCE,
  parseAsoundVersion,
  summarize,
  USERSPACE_NOTE,
} from '../lib/asound-version';

/** The one chip that has to explain a whole era, kept out of the markup. */
const OUT_OF_TREE_TITLE =
  'The packaged alsa-driver build added this line; a kernel building its own sound stack never ' +
  'printed one';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function AsoundVersionView({ content }: { content: string }) {
  const version = useMemo(() => parseAsoundVersion(content), [content]);
  const summary = useMemo(() => (version === null ? null : summarize(version)), [version]);
  const fields = useMemo(() => (version === null ? [] : fieldsOf(version)), [version]);

  if (version === null || summary === null) {
    return (
      <p className="notice notice--warn">
        No ALSA banner in this file. It is one line — <code>{BANNER}</code> and a version — printed
        by the sound core itself, so anything else here came from somewhere other than{' '}
        <code>snd_info_version_read</code>. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.form === 'unknown' && (
        <p className="notice notice--warn" role="status" data-testid="unknown-form">
          The version field reads <code>{summary.printed}</code>, which is neither shape this file
          has ever had: a kernel prints <code>k</code> and its own release, and a kernel from before{' '}
          {KERNEL_VERSION_SINCE} printed ALSA&rsquo;s <code>1.0.x</code> number. Something other than
          the sound core wrote this, or it was built with <code>CONFIG_SND_VERSION</code> set by
          hand.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat
          label="file says"
          value={summary.printed}
          title="The version field exactly as the kernel printed it, without its full stop"
        />
        <Stat
          label="which is"
          value={
            summary.form === 'kernel'
              ? 'the kernel release'
              : summary.form === 'alsa'
                ? "ALSA's own release"
                : 'neither'
          }
        />
        {summary.series !== null && (
          <Stat
            label="series"
            value={summary.series}
            title="The series the release names, which is how a kernel is talked about"
          />
        )}
        {summary.localVersion !== null && (
          <Stat
            label="local version"
            value={summary.localVersion}
            title="What the distribution appended to the release — its build number, its flavour, or both"
          />
        )}
        {summary.compiled !== null && (
          <Stat
            label="built for"
            value={summary.compiled.release}
            title="The kernel this module was compiled against, fixed when it was built"
          />
        )}
      </section>

      {summary.form === 'kernel' && (
        <p className="notice" role="status" data-testid="kernel-release">
          <strong>This is the kernel release, not an ALSA version.</strong> The core prints{' '}
          <code>&quot;{BANNER} k%s.\n&quot;</code> over <code>init_utsname()-&gt;release</code>, so
          the <code>k</code> is a literal and <strong>{summary.release}</strong> is what{' '}
          <code>uname -r</code> says on this machine. ALSA stopped having a version of its own here
          in {KERNEL_VERSION_SINCE}: asked which one a machine runs, this file answers with the
          kernel. {USERSPACE_NOTE}.
        </p>
      )}

      {summary.form === 'alsa' && (
        <p className="notice" role="status" data-testid="alsa-release">
          <strong>This kernel is older than {KERNEL_VERSION_SINCE}</strong> — or its sound stack did
          not come from its own tree. <code>{summary.alsaRelease}</code> is{' '}
          <code>CONFIG_SND_VERSION</code>, the number the alsa-driver package carried, and it moved
          on its own schedule rather than the kernel&rsquo;s. From {KERNEL_VERSION_SINCE} onwards
          this field is the kernel release with a <code>k</code> in front of it, so the shape of the
          line alone dates the machine.
        </p>
      )}

      {builtForAnotherKernel(version) && (
        <p className="notice notice--warn" role="status" data-testid="built-elsewhere">
          The module says it was compiled for <code>{summary.compiled?.release}</code> and the
          banner names <code>{summary.release}</code>. The compile line is fixed when the module is
          built and the release above is read now, so this is a module built against one kernel and
          loaded into another.
        </p>
      )}

      <p className="models" data-testid="flags">
        {summary.outOfTree && (
          <span className="chip chip--model" title={OUT_OF_TREE_TITLE}>
            out-of-tree build
          </span>
        )}
        {summary.built !== null && (
          <span
            className="chip chip--model"
            title="CONFIG_SND_DATE, which the kernel tree leaves empty"
          >
            dated {summary.built}
          </span>
        )}
        {summary.compiled?.smp === true && (
          <span
            className="chip chip--model"
            title="Built for a kernel with CONFIG_SMP, back when that was worth printing"
          >
            SMP
          </span>
        )}
        {!summary.terminated && (
          <span
            className="chip chip--flag"
            title="The kernel prints a full stop after the version; this line has none"
          >
            no trailing full stop
          </span>
        )}
      </p>

      <div className="card mounts asnd">
        <table className="mounts__table asnd__table" aria-label="ALSA version fields">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Value</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.label} className="asnd__row">
                <td className="asnd__label">{field.label}</td>
                <td className="asnd__value">{field.value}</td>
                <td className="asnd__note">{field.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        This file exists because the <strong>sound core is loaded</strong>, and that is all it
        proves. <code>/proc/asound</code> is made by <code>snd</code> when the module initialises,
        and <code>version</code> is a static entry in it — so a machine with no sound hardware at all
        still has this file, while a machine that has never loaded <code>snd</code> has neither it
        nor the directory around it, and the read 404s. What says whether there is anything to play
        through is <code>/proc/asound/cards</code> beside it, which is empty on a machine whose only
        card is a driver waiting for hardware. The version itself is printed from a fixed format
        string, <code>&quot;{BANNER} k%s.\n&quot;</code>, and three things about that read wrong at
        first glance. <strong>The <code>k</code> is a literal</strong>, put there to mark the number
        as a kernel release; it is not part of any version, and stripping it gives{' '}
        <code>uname -r</code> exactly. <strong>The release comes from <code>init_utsname()</code></strong>
        , the initial UTS namespace rather than the reader&rsquo;s, so what this file names is the
        kernel that is actually running. And <strong>the full stop is the kernel&rsquo;s</strong> —
        it ends a sentence rather than a version — so the usual way of reading this file, everything
        after the word <code>Version</code>, yields a string with a period stuck to it that then
        matches nothing. Before {KERNEL_VERSION_SINCE} the same line carried{' '}
        <code>CONFIG_SND_VERSION</code>, ALSA&rsquo;s own <code>1.0.x</code> number, optionally
        followed by <code>CONFIG_SND_DATE</code> in parentheses — empty in the tree, and filled in by
        the packaged alsa-driver build, which also printed a second line saying which kernel it had
        been compiled for. That number is the one thing people usually want from here and the one
        thing a modern kernel does not print: {USERSPACE_NOTE}. Anything about the hardware is in{' '}
        <code>/proc/asound/cards</code> and the per-card directories under it.
      </p>
    </>
  );
}
