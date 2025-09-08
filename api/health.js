export const config = { runtime:'nodejs' }
export default async function handler(req,res){
  const env={ GOOGLE:!!process.env.GOOGLE_API_KEY, BLOB:!!process.env.BLOB_READ_WRITE_TOKEN, SENDGRID:!!process.env.SENDGRID_API_KEY, MAIL_FROM:process.env.MAIL_FROM||null }
  return res.status(200).json({ ok:true, env })
}
