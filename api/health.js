export const config = { runtime:'nodejs' }
export default async function handler(req,res){
  return res.status(200).json({ok:true,env:Object.keys(process.env)})
}
