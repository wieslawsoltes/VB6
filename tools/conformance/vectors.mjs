import fs from 'node:fs';
const pairs=[[17,'2'],[2,'3'],[3,'4'],[4,'1.25'],[5,'2.5'],[6,'1.0001'],[14,'1.00000000000000000001'],[11,'-1'],[8,'2'],[0,''],[1,'']];
const operations=[];
for(const op of ['+','-','*','/','\\','mod','and','or','xor','eqv','imp','^','&','cmp'])for(const [ta,va]of pairs)for(const [tb,vb]of pairs)operations.push({id:operations.length,op,a:{type:ta,value:va},b:{type:tb,value:vb},lcid:1033});
for(const [ta,va]of pairs)for(const [tb,vb]of pairs.filter(([t])=>![0,1].includes(t)))operations.push({id:operations.length,op:'convert',a:{type:ta,value:va},b:{type:tb,value:vb},lcid:1033});
const encodings=[[1252,'€ café'],[1250,'Zażółć gęślą jaźń'],[1251,'Привет'],[1253,'Ελληνικά'],[1254,'İstanbul'],[1255,'שלום'],[1256,'مرحبا'],[1257,'Ūdens'],[1258,'Việt'],[874,'ไทย'],[932,'日本語 ｶﾞ'],[936,'中文'],[949,'한국어'],[950,'中文'],[65001,'😀']].map(([page,text])=>({page,text}));
fs.writeFileSync(process.argv[2]||'vectors.json',JSON.stringify({operations,encodings},null,2));
