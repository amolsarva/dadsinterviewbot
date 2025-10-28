#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

function timestamp() {
  return new Date().toISOString()
}

function log(level, step, payload) {
  const basePayload = {
    step,
    env: {
      DEPLOY_ID: process.env.DEPLOY_ID || null,
      NETLIFY: process.env.NETLIFY || null,
    },
    ...payload,
  }
  const message = ['[diagnostic]', timestamp(), 'embed-deploy-id', step, JSON.stringify(basePayload)]
  if (level === 'error') {
    console.error(message.join(' '))
  } else {
    console.log(message.join(' '))
  }
}

log('log', 'start', { note: 'Embedding Netlify deploy identifier before build' })

const deployId = process.env.DEPLOY_ID ? String(process.env.DEPLOY_ID).trim() : ''
if (!deployId) {
  log('error', 'missing-deploy-id', {
    note: 'DEPLOY_ID must be provided by Netlify at build time. Aborting build.',
  })
  process.exit(1)
}

const outputDir = path.join(process.cwd(), '.next')
const outputFile = path.join(outputDir, 'deploy-id.json')

try {
  fs.mkdirSync(outputDir, { recursive: true })
  log('log', 'directory-ensured', { directory: outputDir })

  const payload = { deployID: deployId }
  fs.writeFileSync(outputFile, JSON.stringify(payload))
  log('log', 'deploy-id-written', { file: outputFile, payload })

  log('log', 'complete', { note: 'Successfully embedded deploy ID for runtime use.' })
} catch (error) {
  log('error', 'write-failed', {
    file: outputFile,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
  })
  process.exit(1)
}
