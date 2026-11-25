// Test double for core's Worker protocol. Does not parse CAD files.
self.onmessage=({data})=>{const {id,name}=data;if(name==='hang.dxf')return;if(name==='error.dxf'){self.postMessage({id,type:'error',code:'parse-failed',message:'受控錯誤'});return}setTimeout(()=>self.postMessage({id,type:'result',scene:{synthetic:true,name},stats:{}}),name==='slow.dxf'?300:10)};
