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
    const resvg = new Resvg(job.svg, {
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
