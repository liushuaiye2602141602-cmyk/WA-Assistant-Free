/* Read the first worksheet of ordinary XLSX files using browser ZIP/XML APIs. */
(function(g) {
  'use strict';
  async function readXlsx(file) {
    if (file.size > 20 * 1024 * 1024) throw new Error('Excel 文件不能超过 20 MB');
    const bytes = new Uint8Array(await file.arrayBuffer()); const view = new DataView(bytes.buffer);
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error('不是有效的 XLSX 文件');
    let offset = view.getUint32(end + 16, true); const count = view.getUint16(end + 10, true);
    const entries = new Map(); const decode = b => new TextDecoder().decode(b);
    for (let i = 0; i < count; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Excel ZIP 目录损坏');
      const nameLen = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
      entries.set(decode(bytes.slice(offset + 46, offset + 46 + nameLen)), { method: view.getUint16(offset + 10, true), size: view.getUint32(offset + 20, true), expanded: view.getUint32(offset + 24, true), pos: view.getUint32(offset + 42, true) });
      offset += 46 + nameLen + extra + comment;
    }
    async function xml(name) {
      const e = entries.get(name); if (!e) throw new Error('Excel 缺少：' + name);
      if (e.expanded > 32 * 1024 * 1024) throw new Error('Excel 工作表过大');
      const start = e.pos + 30 + view.getUint16(e.pos + 26, true) + view.getUint16(e.pos + 28, true);
      let data = bytes.slice(start, start + e.size);
      if (e.method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else if (e.method !== 0) throw new Error('不支持此 Excel 压缩方式');
      const doc = new DOMParser().parseFromString(decode(data), 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('Excel XML 损坏');
      return doc;
    }
    const book = await xml('xl/workbook.xml'), rels = await xml('xl/_rels/workbook.xml.rels');
    const sheet = book.getElementsByTagName('sheet')[0]; if (!sheet) return [];
    const relId = sheet.getAttribute('r:id');
    const relation = Array.from(rels.getElementsByTagName('Relationship')).find(r => r.getAttribute('Id') === relId);
    const path = relation?.getAttribute('Target'); if (!path) throw new Error('Excel 首个工作表关系缺失');
    const sheetPath = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
    const shared = entries.has('xl/sharedStrings.xml') ? Array.from((await xml('xl/sharedStrings.xml')).getElementsByTagName('si')).map(si => Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join('')) : [];
    return Array.from((await xml(sheetPath)).getElementsByTagName('row')).map(row => {
      const values = [];
      for (const c of row.getElementsByTagName('c')) {
        let index = 0; for (const char of (c.getAttribute('r') || 'A').replace(/\d/g, '')) index = index * 26 + char.charCodeAt(0) - 64;
        const v = c.getElementsByTagName('v')[0]?.textContent || '';
        values[index - 1] = c.getAttribute('t') === 's' ? shared[Number(v)] || '' : c.getAttribute('t') === 'inlineStr' ? Array.from(c.getElementsByTagName('t')).map(t => t.textContent).join('') : v;
      }
      return Array.from({ length: values.length }, (_, i) => values[i] || '');
    }).filter(r => r.some(Boolean));
  }
  g.WAReadXlsx = readXlsx;
  g.WAWriteXlsx = async function(rows) {
    const esc = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const col = n => { let s=''; do { s=String.fromCharCode(65+n%26)+s; n=Math.floor(n/26)-1; } while(n>=0); return s; };
    const z = new WAZip.ZipWriter();
    await z.add('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    await z.add('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    await z.add('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Contacts" sheetId="1" r:id="rId1"/></sheets></workbook>');
    await z.add('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    await z.add('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+rows.map((row,r)=>`<row r="${r+1}">`+row.map((v,c)=>`<c r="${col(c)}${r+1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('')+'</row>').join('')+'</sheetData></worksheet>');
    return new Blob([z.build()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  };
})(globalThis);
