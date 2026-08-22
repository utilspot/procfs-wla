import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Reads a file from the test server's fixtures, so the UI tests run against
 * exactly the bytes the server serves. Resolved from the project root because
 * `import.meta.url` is an http URL under the jsdom environment.
 */
function readFixture(setDir: string, name: string, path: string): string {
  return readFileSync(resolve(process.cwd(), 'server/fixtures', setDir, name, path), 'utf8');
}

export function readCpuInfoFixture(name: string): string {
  return readFixture('cpuinfo', name, 'proc/cpuinfo');
}

export function readMountsFixture(name: string): string {
  return readFixture('mounts', name, 'proc/mounts');
}

export function readSessionIdFixture(name: string, pid = 'self'): string {
  return readFixture('sessionid', name, `proc/${pid}/sessionid`);
}

export function readPidMountsFixture(name: string, pid = 'self'): string {
  return readFixture('pid-mounts', name, `proc/${pid}/mounts`);
}

export function readMountinfoFixture(name: string, pid = 'self'): string {
  return readFixture('mountinfo', name, `proc/${pid}/mountinfo`);
}

export function readDiskstatsFixture(name: string): string {
  return readFixture('diskstats', name, 'proc/diskstats');
}

export function readVersionFixture(name: string): string {
  return readFixture('version', name, 'proc/version');
}

export function readStatFixture(name: string): string {
  return readFixture('stat', name, 'proc/stat');
}

export function readCryptoFixture(name: string): string {
  return readFixture('crypto', name, 'proc/crypto');
}

export function readDmaFixture(name: string): string {
  return readFixture('dma', name, 'proc/dma');
}

export function readExecDomainsFixture(name: string): string {
  return readFixture('execdomains', name, 'proc/execdomains');
}

export function readFbFixture(name: string): string {
  return readFixture('fb', name, 'proc/fb');
}

export function readFilesystemsFixture(name: string): string {
  return readFixture('filesystems', name, 'proc/filesystems');
}

export function readIomemFixture(name: string): string {
  return readFixture('iomem', name, 'proc/iomem');
}

export function readIoportsFixture(name: string): string {
  return readFixture('ioports', name, 'proc/ioports');
}

export function readKallsymsFixture(name: string): string {
  return readFixture('kallsyms', name, 'proc/kallsyms');
}

export function readKeysFixture(name: string): string {
  return readFixture('keys', name, 'proc/keys');
}

export function readKeyUsersFixture(name: string): string {
  return readFixture('key-users', name, 'proc/key-users');
}

export function readLatencyStatsFixture(name: string): string {
  return readFixture('latency_stats', name, 'proc/latency_stats');
}

export function readLoadAvgFixture(name: string): string {
  return readFixture('loadavg', name, 'proc/loadavg');
}

export function readLocksFixture(name: string): string {
  return readFixture('locks', name, 'proc/locks');
}

export function readMdstatFixture(name: string): string {
  return readFixture('mdstat', name, 'proc/mdstat');
}

export function readMeminfoFixture(name: string): string {
  return readFixture('meminfo', name, 'proc/meminfo');
}

export function readMiscFixture(name: string): string {
  return readFixture('misc', name, 'proc/misc');
}

export function readPageTypeInfoFixture(name: string): string {
  return readFixture('pagetypeinfo', name, 'proc/pagetypeinfo');
}

export function readSoftIrqsFixture(name: string): string {
  return readFixture('softirqs', name, 'proc/softirqs');
}

export function readSwapsFixture(name: string): string {
  return readFixture('swaps', name, 'proc/swaps');
}

export function readTimerListFixture(name: string): string {
  return readFixture('timer_list', name, 'proc/timer_list');
}

export function readUptimeFixture(name: string): string {
  return readFixture('uptime', name, 'proc/uptime');
}

export function readVersionSignatureFixture(name: string): string {
  return readFixture('version_signature', name, 'proc/version_signature');
}

export function readVmallocInfoFixture(name: string): string {
  return readFixture('vmallocinfo', name, 'proc/vmallocinfo');
}

export function readVmstatFixture(name: string): string {
  return readFixture('vmstat', name, 'proc/vmstat');
}

export function readZoneInfoFixture(name: string): string {
  return readFixture('zoneinfo', name, 'proc/zoneinfo');
}

/**
 * `/proc/<pid>/maps` — every region of one process's address space. Each line
 * of it is a header line of {@link readSmapsFixture}'s file, which is the same
 * mappings with the accounting filled in.
 */
export function readPidMapsFixture(name: string, pid = 'self'): string {
  return readFixture('pid-maps', name, `proc/${pid}/maps`);
}

/**
 * A fixture here is a machine with several processes in it, so this one takes
 * the pid as well — `self` being the process the page reads by default.
 */
export function readSmapsFixture(name: string, pid: string): string {
  return readFixture('smaps', name, `proc/${pid}/smaps`);
}

/** The same, for the other files that belong to a process rather than a machine. */
export function readLimitsFixture(name: string, pid: string): string {
  return readFixture('limits', name, `proc/${pid}/limits`);
}

/**
 * `/proc/<pid>/cmdline`, which is the process's argument vector — not
 * `/proc/cmdline`, the kernel's boot line, which {@link readCmdlineFixture}
 * reads.
 */
export function readPidCmdlineFixture(name: string, pid: string): string {
  return readFixture('pid-cmdline', name, `proc/${pid}/cmdline`);
}

/**
 * `/proc/<pid>/io` — what one process has read and written, counted twice: once
 * at the syscall layer and once at the storage layer.
 */
export function readPidIoFixture(name: string, pid = 'self'): string {
  return readFixture('pid-io', name, `proc/${pid}/io`);
}

/**
 * `/proc/<pid>/time_in_state` — how long one task has run at each clock
 * frequency. The per-task half of {@link readUidTimeInStateFixture}'s file, and
 * from the same Android driver.
 */
export function readPidTimeInStateFixture(name: string, pid = 'self'): string {
  return readFixture('pid-time_in_state', name, `proc/${pid}/time_in_state`);
}

/** `/proc/<pid>/syscall` — where one process is, in a single line. */
export function readSyscallFixture(name: string, pid: string): string {
  return readFixture('syscall', name, `proc/${pid}/syscall`);
}

/**
 * `/proc/<pid>/schedstat` — one task's three scheduler counters. Not
 * {@link readSchedStatFixture}'s file, which is the machine's per-CPU ones.
 */
export function readPidSchedStatFixture(name: string, pid = 'self'): string {
  return readFixture('pid-schedstat', name, `proc/${pid}/schedstat`);
}

/**
 * `/proc/<pid>/statm` — a process's memory in seven counts of pages, two of
 * which the kernel froze at zero.
 */
export function readPidStatmFixture(name: string, pid = 'self'): string {
  return readFixture('pid-statm', name, `proc/${pid}/statm`);
}

/**
 * `/proc/<pid>/stat`, the process's own accounting line — not `/proc/stat`,
 * the machine's CPU totals, which {@link readStatFixture} reads.
 */
export function readPidStatFixture(name: string, pid: string): string {
  return readFixture('pid-stat', name, `proc/${pid}/stat`);
}

/** `/proc/<pid>/comm` — one thread's name, and the newline after it. */
export function readCommFixture(name: string, pid: string): string {
  return readFixture('comm', name, `proc/${pid}/comm`);
}

/** `/proc/<pid>/uid_map` — how one process's user namespace lines its ids up. */
export function readUidMapFixture(name: string, pid: string): string {
  return readFixture('uid_map', name, `proc/${pid}/uid_map`);
}

/**
 * `/proc/<pid>/setgroups` — whether `setgroups()` may be called in one
 * process's user namespace, which is the rule guarding the file below.
 */
export function readPidSetgroupsFixture(name: string, pid = 'self'): string {
  return readFixture('pid-setgroups', name, `proc/${pid}/setgroups`);
}

/**
 * `/proc/<pid>/gid_map` — the same for groups. A separate set of captures
 * because what a group makes different is worth its own shapes: the one line an
 * unprivileged writer may put there, and the device groups held at their host
 * numbers.
 */
export function readGidMapFixture(name: string, pid: string): string {
  return readFixture('gid_map', name, `proc/${pid}/gid_map`);
}

/**
 * `/proc/<pid>/stack` — one task's kernel stack, frame by frame. The whole
 * chain {@link readWchanFixture}'s file names a single frame of.
 */
export function readPidStackFixture(name: string, pid = 'self'): string {
  return readFixture('pid-stack', name, `proc/${pid}/stack`);
}

/** `/proc/<pid>/wchan` — the kernel function one process is asleep in. */
export function readWchanFixture(name: string, pid: string): string {
  return readFixture('wchan', name, `proc/${pid}/wchan`);
}

/**
 * `/proc/<pid>/cgroup` — where one process sits on each hierarchy. Not
 * {@link readCgroupsFixture}, which is `/proc/cgroups`, the machine's table of
 * controllers.
 */
export function readPidCgroupFixture(name: string, pid: string): string {
  return readFixture('pid-cgroup', name, `proc/${pid}/cgroup`);
}

/**
 * `/proc/<pid>/auxv` — the one fixture that is **not text**, so it is read as
 * the bytes it is rather than through {@link readFixture}. Decoding it would
 * replace the pointers in it, which is the whole point of the page that reads
 * it.
 */
export function readAuxvFixture(name: string, pid: string): Uint8Array {
  const path = resolve(process.cwd(), 'server/fixtures/auxv', name, `proc/${pid}/auxv`);
  return new Uint8Array(readFileSync(path));
}

/**
 * `/proc/<pid>/autogroup` — the scheduling group a process shares with its
 * session, which is why a fixture gives two of its pids the same line.
 */
export function readAutogroupFixture(name: string, pid: string): string {
  return readFixture('autogroup', name, `proc/${pid}/autogroup`);
}

/** `/proc/<pid>/status` — the readable superset of the accounting line. */
export function readStatusFixture(name: string, pid: string): string {
  return readFixture('status', name, `proc/${pid}/status`);
}

/**
 * `/proc/<pid>/net/arp` — the IPv4 neighbours of the network namespace that
 * process is in, which is why a fixture holds a different table per pid.
 */
export function readNetArpFixture(name: string, pid = 'self'): string {
  return readFixture('net-arp', name, `proc/${pid}/net/arp`);
}

/**
 * `/proc/<pid>/net/connector` — what is registered on the connector bus, which
 * exists only in the initial network namespace. A fixture showing that gives
 * one of its pids no file at all, so this throws for it, as the server 404s.
 */
export function readNetConnectorFixture(name: string, pid = 'self'): string {
  return readFixture('net-connector', name, `proc/${pid}/net/connector`);
}

/** `/proc/<pid>/net/dev` — every interface in that process's namespace. */
export function readNetDevFixture(name: string, pid = 'self'): string {
  return readFixture('net-dev', name, `proc/${pid}/net/dev`);
}

export function readConsolesFixture(name: string): string {
  return readFixture('consoles', name, 'proc/consoles');
}

export function readTtyDriversFixture(name: string): string {
  return readFixture('tty-drivers', name, 'proc/tty/drivers');
}

export function readTtyLdiscsFixture(name: string): string {
  return readFixture('tty-ldiscs', name, 'proc/tty/ldiscs');
}

/**
 * `/proc/driver/rtc` — the hardware clock. A machine with no RTC has no file,
 * which is why the Raspberry Pi capture has none and the page 404s there.
 */
export function readDriverRtcFixture(name: string): string {
  return readFixture('driver-rtc', name, 'proc/driver/rtc');
}

/**
 * `/proc/sysvipc/shm` — every System V shared memory segment in one IPC
 * namespace. One capture is a 32-bit kernel from before `rss` and `swap` were
 * printed, so a fixture here can hold fourteen columns rather than sixteen.
 */
export function readSysvipcShmFixture(name: string): string {
  return readFixture('sysvipc-shm', name, 'proc/sysvipc/shm');
}

/**
 * `/proc/sysvipc/sem` — the semaphore sets of one IPC namespace, beside the
 * segments {@link readSysvipcShmFixture} reads. Ten columns and no pid among
 * them, so a capture here says what exists rather than what is using it.
 */
export function readSysvipcSemFixture(name: string): string {
  return readFixture('sysvipc-sem', name, 'proc/sysvipc/sem');
}

/**
 * `/proc/sysvipc/msg` — the message queues of one IPC namespace, the third of
 * the IPC files and the only one showing live state: a capture here holds what
 * was sitting in each queue at the moment it was taken.
 */
export function readSysvipcMsgFixture(name: string): string {
  return readFixture('sysvipc-msg', name, 'proc/sysvipc/msg');
}

/**
 * `/proc/asound/version` — the one line the sound core prints about itself.
 * A capture here is either the modern form, where the version is the kernel
 * release with a `k` in front of it, or one from before the kernel started
 * printing its own release there.
 */
export function readAsoundVersionFixture(name: string): string {
  return readFixture('asound-version', name, 'proc/asound/version');
}

/**
 * `/proc/asound/timers` — every timer ALSA has registered, the kernel's own
 * among them. A capture here holds whichever of the global timers that kernel
 * has, a line per PCM substream, and the clients holding any of them open.
 */
export function readAsoundTimersFixture(name: string): string {
  return readFixture('asound-timers', name, 'proc/asound/timers');
}

/**
 * `/proc/asound/pcm` — the PCM devices a machine has, which is the list its
 * cards registered rather than anything playing. A capture here can be empty:
 * the sound core with no card under it has no device to print.
 */
export function readAsoundPcmFixture(name: string): string {
  return readFixture('asound-pcm', name, 'proc/asound/pcm');
}

/**
 * `/proc/asound/modules` — the module that registered each card, one line per
 * card rather than per module. A capture here can be empty: the loop prints
 * only the card slots that are taken.
 */
export function readAsoundModulesFixture(name: string): string {
  return readFixture('asound-modules', name, 'proc/asound/modules');
}

/**
 * `/proc/asound/devices` — every character device the sound core registered,
 * which is a node under `/dev/snd` each. A capture here always has at least the
 * sequencer and the timer: those two belong to the core rather than to a card.
 */
export function readAsoundDevicesFixture(name: string): string {
  return readFixture('asound-devices', name, 'proc/asound/devices');
}

/**
 * `/proc/asound/cards` — the registered sound cards, two lines each. A capture
 * here is never empty: with no card the kernel prints `--- no soundcards ---`
 * rather than nothing.
 */
export function readAsoundCardsFixture(name: string): string {
  return readFixture('asound-cards', name, 'proc/asound/cards');
}

/**
 * `/proc/sys/user/<limit>` — the `ucount` ceilings, and the only fixtures here
 * from `/proc/sys`, where a file is a setting rather than a report.
 *
 * A capture here is a whole `/proc/sys/user` rather than one file: the twelve
 * limits are one mechanism and a machine has all of them, so a scenario names
 * the machine and the second argument picks the file — the way a `smaps`
 * fixture takes the pid.
 */
export function readSysUserFixture(scenario: string, name: string): string {
  return readFixture('sys-user', scenario, `proc/sys/user/${name}`);
}

/**
 * `/proc/scsi/scsi` — every device the SCSI midlayer has attached, three lines
 * each. A capture here is never empty: the `Attached devices:` header is
 * printed whether or not anything is under it, so a machine with nothing
 * attached is a file holding that one line.
 */
export function readScsiFixture(name: string): string {
  return readFixture('scsi', name, 'proc/scsi/scsi');
}

/**
 * `/proc/scsi/device_info` — the midlayer's blacklist, which is the kernel's
 * own table rather than anything about the machine: the same kernel prints the
 * same file whether or not it has ever seen one of these devices. A capture
 * here is either that list whole or an excerpt cut to the entries a scenario is
 * about.
 */
export function readScsiDeviceInfoFixture(name: string): string {
  return readFixture('scsi-device-info', name, 'proc/scsi/device_info');
}

/**
 * `/proc/scsi/sg/version` — the generic SCSI driver's one line: a packed number,
 * the same version as a string, and the date the driver last changed its own,
 * which is the driver's date rather than the kernel's.
 */
export function readSgVersionFixture(name: string): string {
  return readFixture('sg-version', name, 'proc/scsi/sg/version');
}

/**
 * `/proc/scsi/sg/devices` — a line of nine numbers per device the generic
 * driver has a node for, with no header of its own and no column naming the sg
 * device: the line's position is what says which `/dev/sg*` it is. A capture
 * here can be empty, which is a driver with no device rather than a failed read.
 */
export function readSgDevicesFixture(name: string): string {
  return readFixture('sg-devices', name, 'proc/scsi/sg/devices');
}

/**
 * `/proc/scsi/sg/device_strs` — the names of the devices the file beside it
 * counts, in the widths INQUIRY gives them and named only by their position. A
 * device that has gone prints `<no active device>` here where `devices` prints
 * nine `-1`s.
 */
export function readSgDeviceStrsFixture(name: string): string {
  return readFixture('sg-device-strs', name, 'proc/scsi/sg/device_strs');
}

/**
 * `/proc/scsi/sg/device_hdr` — the nine names the columns of
 * `/proc/scsi/sg/devices` go by, and nothing else. The kernel prints a string
 * literal, so a capture here is the same on every machine; the fixtures that
 * differ from it are **invented**, to exercise what the page does when a header
 * names columns the app does not parse by.
 */
export function readSgDeviceHdrFixture(name: string): string {
  return readFixture('sg-device-hdr', name, 'proc/scsi/sg/device_hdr');
}

/**
 * `/proc/scsi/sg/def_reserved_size` — the size of the reserved buffer a newly
 * opened `/dev/sg*` gets, which is a **default** rather than a fact about any
 * descriptor already open. Writable, within a megabyte.
 */
export function readSgDefReservedSizeFixture(name: string): string {
  return readFixture('sg-def-reserved-size', name, 'proc/scsi/sg/def_reserved_size');
}

/**
 * `/proc/scsi/sg/debug` — the only file in that directory that is nested, and
 * the only one about **users** rather than devices: a block per device that has
 * a descriptor open, and nothing for the rest. A capture here is usually its
 * header line alone, which is what an idle machine prints.
 */
export function readSgDebugFixture(name: string): string {
  return readFixture('sg-debug', name, 'proc/scsi/sg/debug');
}

/**
 * `/proc/scsi/sg/allow_dio` — whether direct I/O is permitted at all, which is
 * a **gate** rather than a switch: the request has to ask for it as well, and
 * with this at 0 one that asks is quietly copied instead.
 */
export function readSgAllowDioFixture(name: string): string {
  return readFixture('sg-allow-dio', name, 'proc/scsi/sg/allow_dio');
}

/** `/proc/irq/default_smp_affinity` — the mask a new interrupt starts with. */
export function readDefaultSmpAffinityFixture(name: string): string {
  return readFixture('default_smp_affinity', name, 'proc/irq/default_smp_affinity');
}

export function readCgroupsFixture(name: string): string {
  return readFixture('cgroups', name, 'proc/cgroups');
}

export function readBuddyInfoFixture(name: string): string {
  return readFixture('buddyinfo', name, 'proc/buddyinfo');
}

export function readBootConfigFixture(name: string): string {
  return readFixture('bootconfig', name, 'proc/bootconfig');
}

export function readPartitionsFixture(name: string): string {
  return readFixture('partitions', name, 'proc/partitions');
}

export function readSchedStatFixture(name: string): string {
  return readFixture('schedstat', name, 'proc/schedstat');
}

export function readModulesFixture(name: string): string {
  return readFixture('modules', name, 'proc/modules');
}

export function readInterruptsFixture(name: string): string {
  return readFixture('interrupts', name, 'proc/interrupts');
}

export function readSlabInfoFixture(name: string): string {
  return readFixture('slabinfo', name, 'proc/slabinfo');
}

export function readCmdlineFixture(name: string): string {
  return readFixture('cmdline', name, 'proc/cmdline');
}

export function readDevicesFixture(name: string): string {
  return readFixture('devices', name, 'proc/devices');
}

/**
 * `/proc/uid_time_in_state` — CPU time per uid at each clock frequency, which
 * only a kernel built with `CONFIG_CPU_FREQ_TIMES` has. The `raspberry-pi`
 * capture is the one the test server serves; the rest are shapes no machine
 * here has, read by the tests alone.
 */
export function readUidTimeInStateFixture(name: string): string {
  return readFixture('uid_time_in_state', name, 'proc/uid_time_in_state');
}

/**
 * `/proc/gpu_load` — the Mali driver's own file: how long the GPU and each
 * context that has opened it have been active. The `raspberry-pi` capture is
 * the one the test server serves.
 */
export function readGpuLoadFixture(name: string): string {
  return readFixture('gpu_load', name, 'proc/gpu_load');
}

/**
 * `/proc/gpu_memory` — the other half of what that driver publishes: the pages
 * the GPU is holding, and which process each of them is for. The
 * `raspberry-pi` capture is the one the test server serves, and its rows are
 * the processes holding a context in that machine's `gpu_load`.
 */
export function readGpuMemoryFixture(name: string): string {
  return readFixture('gpu_memory', name, 'proc/gpu_memory');
}

/**
 * `/proc/uid_io/stats` — per-uid I/O from Android's `uid_sys_stats` driver,
 * eleven numbers a line. The `raspberry-pi` capture is the one the test server
 * serves.
 */
export function readUidIoStatsFixture(name: string): string {
  return readFixture('uid_io-stats', name, 'proc/uid_io/stats');
}

/**
 * `/proc/<pid>/environ` — the environment a process was started with, written
 * the way its arguments are: `NAME=value` with a NUL between them.
 */
export function readPidEnvironFixture(name: string, pid = 'self'): string {
  return readFixture('pid-environ', name, `proc/${pid}/environ`);
}

/**
 * `/proc/<pid>/coredump_filter` — which of a process's mappings go into its
 * core file, as the eight hex digits `%08lx` writes.
 */
export function readPidCoredumpFilterFixture(name: string, pid = 'self'): string {
  return readFixture('pid-coredump_filter', name, `proc/${pid}/coredump_filter`);
}
