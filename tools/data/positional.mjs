/** Translate explicit ODBC markers, never values or SQL sent in native mode. */
import {assertData} from '../../src/data/common.js';
export function positionalSQL(sql,driver,parameterCount){
  assertData(typeof sql==='string'&&sql.length<=1000000,'Invalid command');
  assertData(Number.isSafeInteger(parameterCount)&&parameterCount>=0&&parameterCount<=1024,'Invalid parameter count');
  driver=String(driver).toLowerCase();
  const pg=['pg','postgresql'].includes(driver),ms=['mssql','sqlserver'].includes(driver),mysql=['mysql','mariadb'].includes(driver);
  assertData(pg||ms||mysql||['sqlite','odbc','oledb'].includes(driver),'Positional parameters are unsupported by this driver',3251);
  let i=0,start=0,count=0;const out=[];
  while(i<sql.length){
    const c=sql[i],next=sql[i+1];
    if(c==='-'&&next==='-'||mysql&&c==='#'){const end=sql.indexOf('\n',i);i=end<0?sql.length:end+1;continue;}
    if(c==='/'&&next==='*'){
      i+=2;let depth=1;
      while(i<sql.length&&depth){if(sql[i]==='/'&&sql[i+1]==='*'){assertData(++depth<=64,'SQL comment nesting limit',7);i+=2;}else if(sql[i]==='*'&&sql[i+1]==='/'){depth--;i+=2;}else i++;}
      assertData(depth===0,'Unterminated SQL comment',3001);continue;
    }
    if(c==="'"||c==='"'||c==='`'||c==='['){
      const close=c==='['?']':c,escape=mysql||pg&&c==="'"&&i>0&&/[eE]/.test(sql[i-1])&&(i<2||!/[\w$]/.test(sql[i-2]));
      let ended=false;i++;
      while(i<sql.length){if(escape&&sql[i]==='\\'){i+=2;continue;}if(sql[i]===close){if(sql[i+1]===close){i+=2;continue;}i++;ended=true;break;}i++;}
      assertData(ended,'Unterminated SQL quoted token',3001);continue;
    }
    if(pg&&c==='$'&&(i===0||!/[\w$]/.test(sql[i-1]))){
      const quote=/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i,i+130));
      if(quote){const end=sql.indexOf(quote[0],i+quote[0].length);assertData(end>=0,'Unterminated SQL dollar quote',3001);i=end+quote[0].length;continue;}
    }
    if(c==='?'){assertData(++count<=1024,'Too many SQL parameters',7);out.push(sql.slice(start,i),pg?'$'+count:ms?'@p'+count:'?');start=++i;continue;}
    i++;
  }
  assertData(count===parameterCount,'Positional marker count does not match parameters',3001);
  out.push(sql.slice(start));return out.join('');
}
