import sg from '@sendgrid/mail'
const FROM = process.env.MAIL_FROM || 'bot@example.com'
if (process.env.SENDGRID_API_KEY) sg.setApiKey(process.env.SENDGRID_API_KEY)
export async function sendSummaryEmail(to, subject, html){
  if (!process.env.SENDGRID_API_KEY) return { skipped:true }
  return sg.send({ to, from: FROM, subject, html })
}
