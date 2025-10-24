export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const formatTimestamp = () => new Date().toISOString()

const envSummary = () => ({
  totalKeys: Object.keys(process.env).length,
  nodeEnv: process.env.NODE_ENV ?? null,
  platform: process.env.NETLIFY === 'true' ? 'netlify' : process.env.VERCEL ? 'vercel' : 'custom',
})

const logStep = (step: string, payload?: Record<string, unknown>) => {
  const summary = envSummary()
  const merged = { ...payload, envSummary: summary }
  console.log(`[diagnostic] ${formatTimestamp()} ${step} ${JSON.stringify(merged)}`)
}

const logError = (step: string, error: unknown, payload?: Record<string, unknown>) => {
  const summary = envSummary()
  const normalizedError =
    error instanceof Error
      ? { message: error.message, name: error.name, stack: error.stack }
      : { message: 'Non-error rejection', value: error }
  const merged = { ...payload, envSummary: summary, error: normalizedError }
  console.error(`[diagnostic] ${formatTimestamp()} ${step} ${JSON.stringify(merged)}`)
}

export async function GET() {
  const stepBase = 'diagnostics.deploy.get'
  try {
    logStep(`${stepBase}:start`)

    const deployIdSource = process.env.MY_DEPLOY_ID
      ? 'MY_DEPLOY_ID'
      : process.env.NETLIFY_DEPLOY_ID
      ? 'NETLIFY_DEPLOY_ID'
      : process.env.DEPLOY_ID
      ? 'DEPLOY_ID'
      : null

    if (!deployIdSource) {
      logError(`${stepBase}:missing`, new Error('Deploy ID variables are not set'))
    }

    const deployId =
      process.env.MY_DEPLOY_ID ??
      process.env.NETLIFY_DEPLOY_ID ??
      process.env.DEPLOY_ID ??
      '(undefined)'

    const allKeys = Object.keys(process.env).filter((key) => key.toUpperCase().includes('DEPLOY'))

    const responsePayload = { deployId, deployIdSource: deployIdSource ?? 'none', allKeys }

    logStep(`${stepBase}:resolved`, responsePayload)

    return Response.json(responsePayload)
  } catch (error) {
    logError(`${stepBase}:error`, error)
    throw error instanceof Error
      ? new Error(`[diagnostic] deploy inspection failed: ${error.message}`)
      : new Error('[diagnostic] deploy inspection failed: non-error rejection')
  }
}
