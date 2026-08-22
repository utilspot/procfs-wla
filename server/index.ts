import { createApp } from './app.js';
import { choices, currentMachine, HOST_MACHINE, MACHINE_ENV } from './machines.js';
import { API_ROOT, LIST_ROOT } from '../src/api/paths.js';

const PORT = Number(process.env.PORT ?? 3001);

createApp().listen(PORT, () => {
  console.log(`mock filesystem server listening on http://localhost:${PORT}`);
  console.log(`  serving /proc as: ${currentMachine()}`);

  for (const machine of choices()) {
    const mark = machine.name === currentMachine() ? '->' : '  ';
    console.log(`  ${mark} ${machine.name.padEnd(13)} ${machine.description}`);
  }

  console.log(`  pin one with ${MACHINE_ENV}=<name>, ${HOST_MACHINE} included`);
  console.log(`  GET ${API_ROOT}/<path>   -> that file, e.g. GET ${API_ROOT}/cpuinfo`);
  console.log(`  GET ${LIST_ROOT}/<path>    -> what is in that directory, e.g. ${LIST_ROOT}/`);
  console.log(`  GET /fixtures          -> the machines, and which one is being served`);
  console.log(`  PUT /fixtures/current  -> {"name":"container"} switches to it`);
});
