const assert=require('node:assert/strict'),path=require('node:path'),zlib=require('node:zlib');
const {chromium}=require('C:/Users/liush/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=path.resolve(__dirname,'..');
function zip(entries){
 const local=[],central=[];let offset=0;
 for(const [name,content,declaredSize]of entries){
  const filename=Buffer.from(name),raw=Buffer.from(content),data=zlib.deflateRawSync(raw);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(8,8);header.writeUInt32LE(data.length,18);header.writeUInt32LE(declaredSize??raw.length,22);header.writeUInt16LE(filename.length,26);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,6);directory.writeUInt16LE(8,10);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(declaredSize??raw.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);
  local.push(header,filename,data);central.push(directory,filename);offset+=header.length+filename.length+data.length;
 }
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(Buffer.concat(central).length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,...central,end]);
}
const book='<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Contacts" r:id="rId1"/></sheets></workbook>';
const rels='<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
function fixture(sheet,declared){return zip([['xl/workbook.xml',book],['xl/_rels/workbook.xml.rels',rels],['xl/worksheets/sheet1.xml',sheet,declared]]);}
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage();await page.addScriptTag({path:path.join(base,'content/xlsx-reader.js')});
  const read=buffer=>page.evaluate(async bytes=>{try{return {rows:await WAReadXlsx(new File([new Uint8Array(bytes)],'fixture.xlsx'))};}catch(e){return {error:e.message};}},Array.from(buffer));
  assert.deepEqual((await read(fixture('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>phone</t></is></c><c r="B1" t="inlineStr"><is><t>姓名</t></is></c></row></sheetData></worksheet>'))).rows,[['phone','姓名']]);
  assert.match((await read(Buffer.from('broken'))).error,/有效/);
  const badOffset=fixture('<worksheet/>');badOffset.writeUInt32LE(0xffffffff,badOffset.length-6);assert.match((await read(badOffset)).error,/偏移/);
  assert.match((await read(fixture('<worksheet><row><c r="ZZZ9999999"><v>1</v></c></row></worksheet>'))).error,/坐标/);
  assert.match((await read(fixture('<worksheet/>',1))).error,/大小/);
  assert.match((await read(fixture(' '.repeat(33*1024*1024),1))).error,/解压后过大/);
  console.log('PASS: compressed XLSX, short/corrupt ZIP, size mismatch, invalid coordinates, streamed decompression limit. No user files.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
