import test from 'node:test';import assert from 'node:assert/strict';
import {positionalSQL} from '../tools/data/positional.mjs';
const bad=(n)=>e=>e.number===n;
test('canonical ODBC markers translate independently of bound values',()=>{
 const text="select ?, '?', \"?\", [a?]],b], `?` /* ? /* ? */ */ -- ?\n, ?";
 assert.equal(positionalSQL(text,'pg',2),text.replace('select ?','select $1').replace(', ?',', $2'));
 assert.equal(positionalSQL(text,'mssql',2),text.replace('select ?','select @p1').replace(', ?',', @p2'));
 for(const driver of ['sqlite','mysql','odbc','oledb'])assert.equal(positionalSQL('select ?, ?',driver,2),'select ?, ?');
});
test('PostgreSQL dollar quotes, escaped literals and bounded comment nesting are preserved',()=>{
 const text=String.raw`select $$?$$, $tag$ ? $tag$, E'\\?' , E'\'?', ?`;
 assert.equal(positionalSQL(text,'pg',1),text.slice(0,-1)+'$1');
 assert.equal(positionalSQL('select 1 # ?\n, ?','mysql',1),'select 1 # ?\n, ?');
 for(const sql of ["SELECT '", 'SELECT /* ?', 'SELECT $$?'])assert.throws(()=>positionalSQL(sql,'pg',0),bad(3001));
 assert.throws(()=>positionalSQL('/*'.repeat(65),'pg',0),bad(7));
});
test('canonical marker count and supported driver are strict',()=>{
 assert.throws(()=>positionalSQL('SELECT ?','pg',0),bad(3001));assert.throws(()=>positionalSQL('SELECT ?','mssql',2),bad(3001));
 assert.throws(()=>positionalSQL('SELECT ?','custom',1),bad(3251));assert.throws(()=>positionalSQL('SELECT ?','pg',1025));
});
