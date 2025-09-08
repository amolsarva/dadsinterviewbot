export const config = { runtime:'nodejs' }
export default async function handler(req,res){
  const body = typeof req.body==='object'?req.body:JSON.parse(req.body||'{}')
  return res.status(200).json({ok:true,reply:"Mock question",transcript:body.text||"",end_intent:false})
}
