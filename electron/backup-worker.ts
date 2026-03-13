/**
 * Worker-thread entry point for CPU-intensive zip operations.
 *
 * Runs in a worker_threads Worker, keeping the Electron main thread
 * (and therefore the IPC event-loop) responsive during large backups.
 *
 * Message protocol:
 *   Main → Worker: { type: 'create', sourcePath: string, destPath: string }
 *   Worker → Main: { type: 'done' } | { type: 'error', message: string }
 */
import { parentPort, workerData } from 'worker_threads';
import AdmZip from 'adm-zip';

interface WorkerInput {
  sourcePath: string;
  destPath: string;
}

const { sourcePath, destPath } = workerData as WorkerInput;

try {
  const zip = new AdmZip();
  zip.addLocalFolder(sourcePath, '');
  zip.writeZip(destPath, (err) => {
    if (err) {
      parentPort?.postMessage({ type: 'error', message: String(err) });
    } else {
      parentPort?.postMessage({ type: 'done' });
    }
  });
} catch (err) {
  parentPort?.postMessage({ type: 'error', message: String(err) });
}
