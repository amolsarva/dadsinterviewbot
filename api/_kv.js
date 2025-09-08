// No-op KV shim retained for backward imports. Not used in v3.5 (Blob-only).
export async function getSession(){ return null }
export async function putSession(){ return null }
export async function listSessions(){ return { items: [] } }
