(()=>{
 const style=document.createElement('style');style.textContent=`.db-launch{position:fixed;right:22px;bottom:24px;z-index:90;background:#dec89b;color:#191919;border:1px solid #ead9b9;border-radius:32px;padding:14px 20px;box-shadow:0 8px 35px #0006;cursor:pointer}.db-panel{position:fixed;right:22px;bottom:84px;width:min(410px,calc(100vw - 24px));height:min(610px,calc(100dvh - 110px));background:#17191f;color:#eee;border:1px solid #635847;border-radius:20px;z-index:100;box-shadow:0 25px 90px #0009;display:flex;flex-direction:column;overflow:hidden;font:14px/1.6 sans-serif}.db-panel[hidden]{display:none}.db-head{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid #ffffff18}.db-head small{display:block;color:#cbb58b;font-size:11px;letter-spacing:2px}.db-panel button{cursor:pointer;background:#30323b;color:#eee;border:1px solid #ffffff24;border-radius:9px;padding:7px 11px}.db-body{overflow:auto;flex:1;padding:18px}.db-note{padding:14px;border:1px solid #776443;border-radius:12px;background:#c4a76b0c;color:#dfcfb0}.db-note a{color:#e6c88f}.db-prompts{display:flex;flex-wrap:wrap;gap:7px;margin:15px 0}.db-msg{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0;padding:12px;border-radius:12px;background:#242731}.db-msg.user{background:#393429}.db-form{padding:14px;border-top:1px solid #ffffff18}.db-form textarea{box-sizing:border-box;width:100%;min-height:80px;resize:vertical;background:#0e1015;color:white;border:1px solid #55515a;border-radius:10px;padding:10px;font:inherit}.db-actions{display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px}.db-actions span{font-size:11px;color:#aaa}.db-actions button{background:#dec89b;color:#17191f}.db-panel button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:600px){.db-panel{right:12px;bottom:80px}.db-launch{right:12px;bottom:16px}}`;
 document.head.append(style);
 const launch=document.createElement('button');launch.className='db-launch';launch.textContent='✦ 豆包助手';launch.setAttribute('aria-expanded','false');document.body.append(launch);
 const panel=document.createElement('section');panel.className='db-panel';panel.hidden=true;panel.setAttribute('aria-label','豆包工作助手');panel.innerHTML=`<header class="db-head"><div><small>STUDIO / AI ASSISTANT</small><strong>豆包 · 创作助手</strong></div><button type="button" aria-label="关闭豆包助手">✕</button></header><div class="db-body"><div class="db-note" role="status"><span class="db-state">连接后可在这里使用豆包。</span> <button type="button" class="db-connect">连接豆包</button></div><div class="db-prompts"><button type="button">拆解拍摄需求</button><button type="button">写一版口播</button><button type="button">意识流创意</button></div><div class="db-messages" aria-live="polite"></div></div><form class="db-form"><textarea maxlength="4000" aria-label="向豆包提问" placeholder="输入拍摄需求、口播方向或创意问题…"></textarea><div class="db-actions"><span>只发送本次对话，不自动读取排班</span><button type="submit" disabled>发送</button></div></form>`;document.body.append(panel);
 let ready=false,busy=false,history=[];const note=panel.querySelector('.db-note'),send=panel.querySelector('[type=submit]'),input=panel.querySelector('textarea'),messages=panel.querySelector('.db-messages');
 const show=()=>{panel.hidden=!panel.hidden;launch.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)input.focus()};launch.onclick=show;panel.querySelector('.db-head button').onclick=show;
 const prompts=['请将以下运营需求整理成拍摄清单，列出场景、道具、模特动作、镜头和需确认事项：\n','请写一版自然、有真实感的口播脚本。产品：\n受众：\n卖点：\n时长：\n','请设计一组意识流拍摄方案，表达自由、放松、洒脱与享受。产品：\n场景：\n'];panel.querySelectorAll('.db-prompts button').forEach((b,i)=>b.onclick=()=>{input.value=prompts[i];input.focus()});
 function add(role,text){const el=document.createElement('div');el.className='db-msg '+role;el.textContent=text;messages.append(el);el.scrollIntoView({block:'nearest'})}
 const server='https://studio-ops-1112.abuzzfancy1.chatgpt.site';
 const state=note.querySelector('.db-state'), connect=note.querySelector('.db-connect');
 let bridge=null, pending=null, sequence=0, connectTimer;
 const setReady=(value,message)=>{
  ready=value;
  state.textContent=message;
  send.disabled=!ready||busy;
  connect.textContent=ready?'重新连接':'连接豆包';
 };
 connect.onclick=()=>{
  if(busy)return;
  bridge=window.open(server+'/doubao-connect','studioDoubaoConnect','popup,width=540,height=660');
  clearTimeout(connectTimer);
  setReady(false,bridge?'请在弹窗中完成登录，随后返回此面板。':'请允许本站打开连接弹窗。');
  if(bridge)connectTimer=setTimeout(()=>{if(!ready)setReady(false,'连接尚未完成，请检查登录弹窗或重新连接。')},30000);
 };
 window.addEventListener('message',event=>{
  if(event.origin!==server||!bridge||event.source!==bridge)return;
  const data=event.data;
  if(data?.type==='studio-doubao-ready'){
   clearTimeout(connectTimer);
   setReady(data.ready===true,data.ready===true?'豆包已连接。请保留连接窗口。':'豆包服务暂未就绪，请稍后重连。');
  }else if(data?.type==='studio-doubao-reply'&&pending?.id===data.id){
   if(data.error)pending.reject(Error(data.error));
   else if(typeof data.reply==='string'&&data.reply.trim())pending.resolve(data.reply);
   else pending.reject(Error('模型未返回文本'));
  }
 });
 panel.querySelector('form').onsubmit=async event=>{
  event.preventDefault();
  const content=input.value.trim();
  if(!ready||busy||!content)return;
  if(!bridge||bridge.closed){setReady(false,'连接窗口已关闭，请重新连接。');return}
  busy=true;send.disabled=true;send.textContent='生成中…';
  add('user',content);input.value='';
  const next=[...history,{role:'user',content}].slice(-10);
  let timeout;
  try{
   const reply=await new Promise((resolve,reject)=>{
    const id=++sequence;
    pending={id,resolve,reject};
    timeout=setTimeout(()=>reject(Error('请求超时，请检查连接窗口后重试。')),47000);
    bridge.postMessage({type:'studio-doubao-chat',id,messages:next},server);
   });
   add('assistant',reply);
   history=[...next,{role:'assistant',content:reply}];
  }catch(error){add('assistant',error.message);if(!input.value)input.value=content}
  finally{clearTimeout(timeout);pending=null;busy=false;send.disabled=!ready;send.textContent='发送'}
 };
})();
