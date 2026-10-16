/** Compile with: tsc --noEmit --strict --target ES2022 --module NodeNext tools/layout-types-smoke.mts */
import {LayoutEngine,LayoutMode,type GridLayout,type MasonryLayout,type Track,type LayoutNode} from '../packages/auto-layout/src/index.js';
const template:Track[]=[{repeat:'auto-fit',before:['start'],after:['end'],tracks:[{size:'1fr',min:'var(--min, 100)'}]}];
const node:LayoutNode={id:'a',bounds:{width:100,height:30},widthMode:'fill',gridColumnStart:'start',gridColumnEnd:-1};
const engine=new LayoutEngine([node],{layout:'Grid',columns:template,rows:'minmax(20,1fr)',gridTemplateAreas:['a a'],direction:'rtl',layoutVariables:{'--min':100},width:400,height:100});
engine.configure({reverse:true,wrapReverse:false,gridTemplateAreas:'',layoutVariables:'{"--min":120}'});
engine.update('a',{gridArea:'',gridColumnStart:1,gridColumnEnd:'span 2'});engine.arrange();
const grid:GridLayout|null=engine.getGridLayout();if(grid){const name:string|undefined=grid.columns[0]?.names[0];const count:number=grid.cells[0].columnSpan;void name;void count;}
const masonry=new LayoutEngine([{id:1,bounds:{width:100,height:30},widthMode:'fill'}],{layout:LayoutMode.Masonry,columns:2,width:400,height:100});masonry.arrange();
const packed:MasonryLayout|null=masonry.getMasonryLayout();if(packed){const direction:'ltr'|'rtl'=packed.direction;const span:number=packed.cells[0].laneSpan;void direction;void span;}
// @ts-expect-error: direction is a finite logical-direction vocabulary
engine.configure({direction:'up'});
// @ts-expect-error: reverse is a Boolean, not a string
engine.configure({reverse:'yes'});
// @ts-expect-error: a grid line is a selector string or number, not an object
engine.update('a',{gridRowStart:{name:'row'}});
