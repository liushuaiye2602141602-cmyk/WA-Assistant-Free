const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const base=path.resolve(__dirname,'..');
for(const file of ['lib/zip.js','content/exporter.js'])vm.runInThisContext(fs.readFileSync(path.join(base,file),'utf8'));
function wave(){const samples=1600,b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(3000*Math.sin(2*Math.PI*440*i/8000)),44+i*2);return b;}
function entries(buffer){const bytes=new Uint8Array(buffer),view=new DataView(buffer),files=new Map();let pos=0;while(view.getUint32(pos,true)===0x04034b50){const size=view.getUint32(pos+18,true),nl=view.getUint16(pos+26,true),el=view.getUint16(pos+28,true),start=pos+30+nl+el;files.set(new TextDecoder().decode(bytes.slice(pos+30,pos+30+nl)),bytes.slice(start,start+size));pos=start+size;}return files;}
(async()=>{
 assert.equal(WAExporter.safeFilename('..'),'chat');
 assert.equal(WAExporter.safeFilename('CON.txt'),'_CON.txt');
 assert.equal(WAExporter.safeFilename('报告. '),'报告');
 assert.equal(WAExporter.safeFilename('a\u0000b.txt'),'a_b.txt');
 const safeZip=entries(await (await WAExporter.toZip({id:'123@lid',title:'..'},[],[])).arrayBuffer());
 assert.ok(safeZip.has('chat/chat.html'));assert.equal([...safeZip.keys()].some(name=>name.split('/').includes('..')),false);
 const wav=wave(),chat={id:'8613800000000@c.us',title:'语音测试',phone:'8613800000000'};
 const messages=['one','two','mp3','missing','empty',''].map((id,i)=>({id,time:Date.now()+i,fromMe:false,type:i<2?'ptt':'audio',isVoice:i<2,isAudio:true,isMedia:true,filename:i<2?'voice.ogg':'',mimetype:i<2?'audio/wav':i===2?'audio/mpeg':'audio/ogg',duration:.2}));
 global.WABridge={downloadMedia:async id=>{if(id==='missing')throw new Error('media expired');if(id==='empty')return new Blob([],{type:'audio/ogg'});if(id==='mp3')return {data:Buffer.from('ID3fixture').toString('base64'),mimetype:'audio/mpeg'};return {data:Uint8Array.from(wav).buffer,mimetype:'audio/wav'};}};
 const media=await WAExporter.fetchMediaForMessages(messages);
 assert.equal(media[0].filename,'voice.wav');assert.equal(media[1].filename,'voice_2.wav');assert.match(media[2].filename,/\.mp3$/);assert.equal(media.filter(x=>x.missing).length,3);
 assert.deepEqual(Buffer.from(await media[0].blob.arrayBuffer()),wav);
 assert.equal(WAExporter.mediaResultToBlob({data:new Uint8Array([1,2]),mimetype:'audio/ogg'}).size,2);
 assert.equal(WAExporter.mediaResultToBlob({data:'data:audio/ogg;base64,YWI=',mimetype:'audio/ogg'}).size,2);
 assert.equal(WAExporter.mediaResultToBlob({data:42}),null);
 const otherRealm=vm.runInNewContext('new Uint8Array([1,2,3]).buffer');assert.equal(WAExporter.mediaResultToBlob({data:otherRealm,mimetype:'audio/ogg'}).size,3);
 const map=new Map(media.filter(x=>x.blob).map(x=>[x.filename,x.blob]));
 const html=await WAExporter.toHtml(chat,messages,{mediaMode:'embed',mediaMap:map});assert.match(html,/<audio controls preload="metadata" src="data:audio\/wav;base64,/);assert.match(html,/下载语音/);assert.match(html,/语音\/音频下载失败/);assert.equal((html.match(/<audio /g)||[]).length,3);
 const zip=entries(await (await WAExporter.toZip(chat,messages,media)).arrayBuffer());
 const prefix='语音测试 - 8613800000000/';assert.deepEqual(Buffer.from(zip.get(prefix+'media/voice.wav')),wav);assert.ok(zip.has(prefix+'media/voice_2.wav'));assert.ok(zip.has(prefix+'媒体下载失败.txt'));
 const md=new TextDecoder().decode(zip.get(prefix+'chat.md')),relativeHtml=new TextDecoder().decode(zip.get(prefix+'chat.html'));
 assert.match(md,/media\/voice_2\.wav/);assert.match(relativeHtml,/src="media\/voice_2\.wav"/);assert.equal((relativeHtml.match(/<audio /g)||[]).length,3);
 assert.equal(md.includes('](media/'+messages[3].exportFilename+')'),false);
 const json=JSON.parse(WAExporter.toJson(chat,messages));assert.equal(json.messages[0].isVoice,true);assert.equal(json.messages[0].mimetype,'audio/wav');assert.equal(json.messages[3].mediaMissing,true);
 assert.match(WAExporter.toTxt(chat,messages),/voice_2\.wav/);
 const downloads=[];global.document={body:{appendChild:()=>{}},createElement:()=>({click(){downloads.push({url:this.href,name:this.download});},remove:()=>{}})};
 WABridge.waitReady=async()=>true;WABridge.getMessagesForChat=async()=>[{chatId:chat.id,chatName:chat.title,phone:chat.phone,items:messages}];WABridge.getProfilePicture=async()=>'';
 const originalTimeout=global.setTimeout;global.setTimeout=(fn,ms)=>ms===30000?0:originalTimeout(fn,ms);
 let result;try{result=await WAExporter.exportChats([{id:chat.id,name:chat.title,phone:chat.phone}],{formats:['zip','html'],includeMedia:true});}finally{global.setTimeout=originalTimeout;}
 assert.equal(result.length,2);assert.equal(result[0].audio,3);assert.equal(result[1].missingAudio,3);downloads.forEach(d=>URL.revokeObjectURL(d.url));
 const {chromium}=require('C:/Users/liush/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage();await page.setContent(html);await page.waitForFunction(()=>Number.isFinite(document.querySelector('audio').duration)&&document.querySelector('audio').duration>0);assert.ok(await page.locator('audio').first().evaluate(a=>a.duration>.1));}finally{await browser.close();}
 console.log('PASS: voice/audio bytes, MIME/extensions, duplicate names, failed/empty media, ZIP links, standalone HTML audio decoding, JSON/TXT metadata, export statistics. No real WhatsApp downloads.');
})().catch(e=>{console.error(e);process.exitCode=1;});
