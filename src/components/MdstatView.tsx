import { useMemo } from 'react';
import {
  bytesOf,
  describeAction,
  describeFlag,
  formatBytes,
  formatFinish,
  isDegraded,
  missingMembers,
  parseMdstat,
  summarize,
  type MdArray,
  type MdMember,
} from '../lib/mdstat';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** One member, its position in the array, and what state it is in. */
function Member({ member }: { member: MdMember }) {
  const failed = member.flags.includes('F');

  return (
    <li className={failed ? 'chip chip--bug' : 'chip'} title={`position ${member.role}`}>
      {member.device}
      {member.flags.map((flag) => (
        <span key={flag} className="md__flag" title={describeFlag(flag) ?? `flag ${flag}`}>
          {flag}
        </span>
      ))}
    </li>
  );
}

/**
 * The per-position status field, one character per member: `U` for up and `_`
 * for a hole. It is the quickest read of an array's health, so it is kept as
 * the kernel wrote it and explained rather than turned into prose.
 */
function Status({ status }: { status: string }) {
  return (
    <span className="md__status">
      [
      {[...status].map((character, index) => (
        <span
          key={index}
          className={character === 'U' ? 'md__up' : 'md__down'}
          title={
            character === 'U'
              ? `position ${index}: up`
              : `position ${index}: no working member here`
          }
        >
          {character}
        </span>
      ))}
      ]
    </span>
  );
}

function Progress({ array }: { array: MdArray }) {
  const progress = array.progress;
  if (progress === null) return null;

  const described = describeAction(progress.action) ?? 'What the kernel is doing to this array';

  if (progress.queued !== null) {
    return (
      <p className="md__progress">
        <span className="chip" title={described}>
          {progress.action}
        </span>{' '}
        <span className="muted" title="Queued behind another array's work rather than running">
          {progress.queued.toLowerCase()}
        </span>
      </p>
    );
  }

  return (
    <p className="md__progress">
      <span className="chip" title={described}>
        {progress.action}
      </span>
      <span className="md__bar" title={`${progress.percent}% done`}>
        <span className="md__segment" style={{ width: `${progress.percent ?? 0}%` }} />
      </span>
      <span className="md__figures">
        {progress.percent}%
        {progress.finishMinutes !== null && ` · ${formatFinish(progress.finishMinutes)} left`}
        {progress.speedKBs !== null && ` · ${formatBytes(progress.speedKBs * 1024)}/s`}
      </span>
    </p>
  );
}

function Array_({ array }: { array: MdArray }) {
  const degraded = isDegraded(array);
  const missing = missingMembers(array);
  const bytes = bytesOf(array);

  return (
    <section className={degraded ? 'card md md--degraded' : 'card md'}>
      <h3 className="md__name">
        {array.name}
        {array.level !== null && <span className="chip chip--model">{array.level}</span>}
        {array.state.map((state) => (
          <span key={state} className="chip">
            {state}
          </span>
        ))}
        {degraded === true && (
          <span
            className="chip chip--bug"
            title={
              missing === null
                ? 'A member position has no working device behind it'
                : `${missing} member${missing === 1 ? '' : 's'} short of what the array expects`
            }
          >
            degraded
          </span>
        )}
      </h3>

      <dl className="md__facts">
        {bytes !== null && (
          <>
            <dt>Size</dt>
            <dd>{formatBytes(bytes)}</dd>
          </>
        )}
        {array.expected !== null && (
          <>
            <dt>Members</dt>
            <dd>
              {array.working} of {array.expected} working
              {array.status !== null && (
                <>
                  {' '}
                  <Status status={array.status} />
                </>
              )}
            </dd>
          </>
        )}
        {array.metadata !== null && (
          <>
            <dt>Metadata</dt>
            <dd>version {array.metadata}</dd>
          </>
        )}
        {array.geometry !== null && (
          <>
            <dt>Geometry</dt>
            <dd>{array.geometry}</dd>
          </>
        )}
        {array.bitmap !== null && (
          <>
            <dt>Bitmap</dt>
            <dd title="A write-intent bitmap, which lets a resync copy only what changed">
              {array.bitmap.pagesUsed}/{array.bitmap.pagesTotal} pages, {array.bitmap.chunkKB} KB
              chunk
            </dd>
          </>
        )}
      </dl>

      <ul className="chips md__members">
        {array.members.map((member) => (
          <Member key={`${member.device}-${member.role}`} member={member} />
        ))}
      </ul>

      <Progress array={array} />
    </section>
  );
}

export function MdstatView({ content }: { content: string }) {
  const info = useMemo(() => parseMdstat(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  if (info.arrays.length === 0) {
    return (
      <p className="notice" role="status">
        No arrays are assembled on this machine. The md driver is loaded — that is why this file
        exists at all — but nothing is running on it
        {info.personalities.length === 0
          ? ', and no RAID levels are registered either, so a module would have to be loaded before one could be started'
          : `, though this kernel can drive ${info.personalities.join(', ')}`}
        .
      </p>
    );
  }

  return (
    <>
      {summary.degraded.length > 0 && (
        <p className="notice notice--warn" role="alert">
          {summary.degraded.map((array) => array.name).join(', ')}{' '}
          {summary.degraded.length === 1 ? 'is' : 'are'} running degraded — short of a member, and
          serving data with less redundancy than the level provides. Another failure may lose the
          array.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="arrays" value={String(summary.arrays)} />
        <Stat label="active" value={String(summary.active)} />
        <Stat label="capacity" value={formatBytes(summary.totalBytes)} />
        {summary.rebuilding.length > 0 && (
          <Stat label="rebuilding" value={String(summary.rebuilding.length)} />
        )}
      </section>

      {summary.personalities.length > 0 && (
        <p className="models" data-testid="personalities">
          {summary.personalities.map((personality) => (
            <span
              key={personality}
              className="chip chip--model"
              title="A RAID level this kernel can drive"
            >
              {personality}
            </span>
          ))}
        </p>
      )}

      <div className="md__arrays">
        {info.arrays.map((array) => (
          <Array_ key={array.name} array={array} />
        ))}
      </div>

      {info.unused.length > 0 && (
        <p className="disks__note muted">
          Unused devices: {info.unused.join(', ')} — known to md, and part of no array.
        </p>
      )}

      <p className="disks__note muted">
        The pair at the end of each array&rsquo;s blocks line is the health of it:{' '}
        <strong>members expected over members working</strong>, then one character per position,{' '}
        <code>U</code> for up and <code>_</code> for a hole. An array with a hole still serves
        data — it has simply spent the redundancy it was built with. A failed member stays listed,
        marked <code>F</code>, until something removes it. When the kernel is working on an array
        the word it uses matters: <strong>recovery</strong> is rebuilding a replacement and{' '}
        <strong>resync</strong> is making existing members agree, while <strong>check</strong>{' '}
        only reads and compares without changing anything. Work on one array is queued behind work
        on another, which is what <code>DELAYED</code> means where a percentage would be.
      </p>
    </>
  );
}
