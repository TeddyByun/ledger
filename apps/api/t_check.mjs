import ExcelJS from 'exceljs';
import fs from 'fs';
const f = '/home/coder/ledger/apps/api/test/fixtures/statements/shinhan_card/2604_신한카드-이용대금명세서_(4월사용).xlsx';
const buffer = fs.readFileSync(f);
const wb = new ExcelJS.Workbook();
try {
  await wb.xlsx.load(buffer);
  console.log('ExcelJS LOAD OK, sheets=', wb.worksheets.length);
  let n=0;
  for (const ws of wb.worksheets) {
    ws.eachRow({includeEmpty:false},(row, rn)=>{
      const values = row.values;
      for (let i=1;i<values.length;i++){
        const v = values[i];
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          if (n++ < 15) console.log('row',rn,'col',i, JSON.stringify(v).slice(0,200), '| keys=', Object.keys(v));
        }
      }
    });
  }
  console.log('total object cells:', n);
} catch(e) {
  console.log('ExcelJS FAILED:', e.message);
}
