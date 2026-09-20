/*
 * OG render worker. The main thread prepares font files and hands this worker
 * their PATHS (workerData.fontFiles) — passed to resvg as `fontFiles`, which is
 * supported across resvg-js versions (`fontBuffers` is silently ignored by some
 * releases, which made every text node fall back to system fonts). One worker
 * per CPU → the pipeline scales to the full corpus (design spec §4/§F).
 */
import { parentPort, workerData } from 'node:worker_threads'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

parentPort.on('message', (job) => {
  if (job === 'stop') {
    parentPort.close()
    return
  }
  try {
    // the game room behind the plate is spliced in here so the job list never
    // carries the base64 (one copy per worker, not one per plate)
    const svg = job.room
      ? job.svg.replace(workerData.bgToken, 'data:image/jpeg;base64,' + workerData.rooms[job.room])
      : job.svg
    const resvg = new Resvg(svg, {
      font: {
        fontFiles: workerData.fontFiles,
        loadSystemFonts: false,
        defaultFontFamily: workerData.defaultFamily,
      },
      fitTo: { mode: 'width', value: 1200 },
    })
    const png = resvg.render().asPng()
    mkdirSync(dirname(job.outPath), { recursive: true })
    writeFileSync(job.outPath, png)
    parentPort.postMessage({ ok: true, outPath: job.outPath })
  } catch (err) {
    parentPort.postMessage({ ok: false, outPath: job.outPath, error: String(err) })
  }
})
