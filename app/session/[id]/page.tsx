import 'server-only'
import { getSession, rememberSessionManifest, buildSessionFromManifest } from '@/lib/data'

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value || undefined
}

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  let session = await getSession(params.id)
  let manifestData: any | null = null
  let manifestUrl: string | undefined

  if (!session) {
    const rawHint = firstParam(searchParams?.manifest)
    if (rawHint) {
      try {
        manifestUrl = decodeURIComponent(rawHint)
      } catch {
        manifestUrl = rawHint
      }
    }

    if (manifestUrl) {
      try {
        const response = await fetch(manifestUrl)
        if (response.ok) {
          manifestData = await response.json()
          const createdHint =
            (manifestData && typeof manifestData.startedAt === 'string' && manifestData.startedAt) ||
            (manifestData && typeof manifestData.created_at === 'string' && manifestData.created_at) ||
            (manifestData && typeof manifestData.createdAt === 'string' && manifestData.createdAt) ||
            undefined
          const storedId = rememberSessionManifest(manifestData, params.id, createdHint, manifestUrl)
          if (storedId) {
            session = await getSession(storedId)
          }
          if (!session) {
            session = await getSession(params.id)
          }
        }
      } catch (err) {
        console.warn('Failed to hydrate session from manifest hint', err)
      }
    }
  }

  if (!session && manifestData) {
    const createdHint =
      (typeof manifestData.startedAt === 'string' && manifestData.startedAt) ||
      (typeof manifestData.created_at === 'string' && manifestData.created_at) ||
      (typeof manifestData.createdAt === 'string' && manifestData.createdAt) ||
      undefined
    const derived = buildSessionFromManifest(manifestData, params.id, createdHint)
    if (derived) {
      session = {
        ...derived,
        artifacts: {
          ...(derived.artifacts || {}),
          ...(manifestUrl ? { session_manifest: manifestUrl } : {}),
        },
      }
    }
  }

  if (!session) return <main>Not found.</main>
  return (
    <main>
      <h2 className="text-lg font-semibold mb-2">{session.title || 'Session'}</h2>
      <div className="text-xs opacity-70 mb-4">{new Date(session.created_at).toLocaleString()}</div>
      <div className="space-y-2">
        {session.turns?.map(t => (
          <div key={t.id} className="bg-white/5 rounded p-2">
            <div className="text-xs opacity-70">{t.role}</div>
            <div className="whitespace-pre-wrap">{t.text}</div>
            {t.audio_blob_url && <audio controls src={t.audio_blob_url} className="w-full mt-1" />}
          </div>
        ))}
      </div>
      <div className="mt-4 space-x-3 text-sm">
        {session.artifacts?.transcript_txt && (
          <a className="underline" href={session.artifacts.transcript_txt}>
            Transcript (txt)
          </a>
        )}
        {session.artifacts?.transcript_json && (
          <a className="underline" href={session.artifacts.transcript_json}>
            Transcript (json)
          </a>
        )}
        {session.artifacts?.session_manifest && (
          <a className="underline" href={session.artifacts.session_manifest}>
            Session manifest
          </a>
        )}
      </div>
    </main>
  )
}
