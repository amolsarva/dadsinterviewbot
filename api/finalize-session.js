export const config = { runtime:'nodejs' }
export default async function handler(req,res){
  try{
    return res.status(200).json({ok:true,manifestUrl:'mock://session',totalTurns:0,totalDurationMs:0})
  }catch(e){ return res.status(500).json({ok:false,error:String(e)}) }
}
