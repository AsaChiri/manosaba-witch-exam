/*
 * OG render worker. The main thread decompresses fonts and hands this worker
 * the ttf paths (workerData.fontFiles); the worker reads them once into buffers
 * and renders each SVG job to PNG with resvg-js. One worker per CPU → the
 * pipeline scales to the full corpus (design spec §4/§F).
 */
import { parentPort, workerData } from 'node:worker_threads'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const fontBuffers = workerData.fontFiles.map((f) => readFileSync(f))

parentPort.on('message', (job) => {
  if (job === 'stop') {
    parentPort.close()
    return
  }
  try {
    const resvg = new Resvg(job.svg, {
      font: {
        fontBuffers,
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
