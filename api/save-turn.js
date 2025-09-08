import { saveBlob } from './_blob.js'
export const config = { runtime:'nodejs' }
export default async function handler(req,res){
  try{
    const body = typeof req.body==='object'?req.body:JSON.parse(req.body||'{}')
    const { sessionId, turn } = body||{}
    if(!sessionId||!turn) return res.status(400).json({ok:false,error:'missing'})
    return res.status(200).json({ok:true, userAudioUrl:'mock://audio', manifestUrl:'mock://manifest'})
  }catch(e){ return res.status(500).json({ok:false,error:String(e)}) }
}
