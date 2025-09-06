export const runtime='edge';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})}
export default async function handler(req){
  if(req.method!=='POST'&&req.method!=='GET')return json({error:'Method Not Allowed'},405);
  const key=process.env.OPENAI_API_KEY;
  if(!key){console.error('Missing OPENAI_API_KEY');return json({error:'Missing OPENAI_API_KEY'},500)}
  const body={model:'gpt-4o-realtime-preview',voice:'verse',instructions:'Intro line',modalities:['audio','text'],turn_detection:{type:'server_vad'}};
  let resp;try{resp=await fetch('https://api.openai.com/v1/realtime/sessions',{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json','OpenAI-Beta':'realtime=v1'},body:JSON.stringify(body)})}catch(e){console.error('fetch error',e);return json({error:'Network error'},502)}
  const text=await resp.text();
  if(!resp.ok){console.error('upstream error',resp.status,text);return json({error:'OpenAI Realtime error',status:resp.status,body:text},502)}
  try{return json(JSON.parse(text))}catch(e){console.error('parse error',e);return json({error:'Invalid JSON',body:text},502)}
}