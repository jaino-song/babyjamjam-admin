import { runWorkerCli, type WorkerEnvironment } from "infrastructure/eformsign-backup/worker/cli";
import { createRealFsProbe } from "infrastructure/eformsign-backup/worker/fs-probe";

/**
 * Child process of T-WRK-13 and T-WRK-17. Everything comes from argv: the worker CLI arguments, plus
 *   --kill-at <runner fault point>   SIGKILL this process when the runner reaches that point
 *   --statfs-type <number>           report this filesystem type for every path (an NFS stand-in)
 * The real clock, uuid source, `/proc/locks` and fetch are used, so under `flock -F` this is the real lock holder.
 */
function takeFlag(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const value = args[index + 1];
    args.splice(index, 2);
    return value;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const killAt = takeFlag(args, "--kill-at");
    const statfsType = takeFlag(args, "--statfs-type");
    const environment: WorkerEnvironment = {};
    if (killAt !== undefined) {
        environment.runnerFault = (point) => { if (point === killAt) process.kill(process.pid, "SIGKILL"); };
    }
    if (statfsType !== undefined) {
        const real = createRealFsProbe();
        environment.probe = {
            statfs: async (target) => ({ ...(await real.statfs(target)), type: Number(statfsType) }),
            readProcLocks: () => real.readProcLocks(),
        };
    }
    process.exitCode = await runWorkerCli(args, environment);
}
void main();
