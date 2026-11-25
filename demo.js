// Synthetic geometry only: no customer data.
export function makeDemo(){
 const entities=[]; const line=(x1,y1,x2,y2,color='#a5b9c6')=>entities.push({type:'line',p1:{x:x1,y:y1},p2:{x:x2,y:y2},color});
 for(let i=0;i<=80;i++){line(i*5,0,i*5,300,'#00ffff');line(0,i*3.75,400,i*3.75,'#00ffff')}
 for(let x=20;x<=380;x+=90)for(let y=30;y<=270;y+=80){line(x,y,x+60,y,'#dbe8ed');line(x+60,y,x+60,y+50,'#dbe8ed');line(x+60,y+50,x,y+50,'#dbe8ed');line(x,y+50,x,y,'#dbe8ed');line(x,y,x+60,y+50,'#819eaf');entities.push({type:'circle',c:{x:x+30,y:y+25},r:8,color:'#bdcbd3'})}
 entities.push({type:'text',p:{x:130,y:285},text:'合成測試圖 · 中文標註',height:9,color:'#e0ebf0'});
 return {unit:null,extents:{min:{x:0,y:0},max:{x:400,y:300}},entities,protos:[],inserts:[],dimensions:[],skipped:{count:0},warnings:[],synthetic:true};
}
