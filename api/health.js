export const config = { runtime: 'edge' }
export default async function handler(req){
  const env = {
    GOOGLE: !!process.env.GOOGLE_API_KEY,
    BLOB: !!process.env.BLOB_READ_WRITE_TOKEN,
    KV_URL: !!process.env.KV_REST_API_URL,
    KV_TOKEN: !!process.env.KV_REST_API_TOKEN,
    SENDGRID: !!process.env.SENDGRID_API_KEY,
    MAIL_FROM: process.env.MAIL_FROM || null
  }
  return new Response(JSON.stringify({ ok:true, env }), { status:200, headers:{'Content-Type':'application/json'} })
}
