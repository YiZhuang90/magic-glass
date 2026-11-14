// 测试用“假摄像头”：替换 tracker.update，按 window.__spec 生成 21 点手部关键点，按 window.__faces 生成人脸框。
// spec: [{ g: 'open'|'fist'|'point', X, Y（掌心在内部画布上的位置）| cx, cy（掌心的摄像头坐标）, hand: 'left'|'right' }]
// faces: [{ X, Y（脸中心在内部画布上的位置）| cx, cy, h（脸高，摄像头归一化）}]
() => {
  const OPEN=[[0,.55],[-.28,.42],[-.5,.22],[-.64,.02],[-.76,-.16],[-.3,-.35],[-.36,-.72],[-.39,-.95],[-.41,-1.15],[-.02,-.42],[-.02,-.84],[-.02,-1.1],[-.02,-1.32],[.24,-.36],[.28,-.74],[.3,-.97],[.32,-1.15],[.45,-.25],[.54,-.52],[.6,-.7],[.64,-.86]];
  const FIST=[[0,.55],[-.28,.42],[-.46,.16],[-.4,-.06],[-.2,-.12],[-.3,-.35],[-.34,-.55],[-.3,-.32],[-.28,-.2],[-.02,-.42],[-.03,-.62],[-.02,-.37],[-.02,-.24],[.24,-.36],[.25,-.55],[.24,-.32],[.22,-.2],[.45,-.25],[.48,-.4],[.44,-.24],[.4,-.14]];
  const POINT=OPEN.map((p,i)=>i<9?p:FIST[i]);
  const T={open:OPEN,fist:FIST,point:POINT};
  const tr=__mg.tracker; tr.landmarker={setOptions(){}}; tr.stream={}; tr.backend='模拟'; tr.hands=[];
  tr.faceDetector={}; tr.faceBackend='模拟'; tr.facesOn=true;
  const st=document.querySelector('#stage');
  const cam=(o)=> o.cx!=null ? [o.cx,o.cy] : __mg.input.screenToCam(o.X/st.width, o.Y/st.height);
  window.__spec=[]; window.__faces=[];
  tr.update=()=>{ tr.videoW=640; tr.videoH=480;
    tr.faces=window.__faces.map(f=>{ const [x,y]=cam(f), h=f.h||0.14, w=h*0.75; return {x:x-w/2,y:y-h/2,w,h,score:0.9}; }); tr.faceSeq++;
    tr.hands=window.__spec.map(h=>{ const size=0.13, tpl=T[h.g], sx=h.hand==='left'?-1:1;
      const pc=[0,5,9,13,17].reduce((a,i)=>[a[0]+tpl[i][0]/5,a[1]+tpl[i][1]/5],[0,0]);
      const [nx,ny]=cam(h);
      // 模板是（镜像后的）右手；左手左右翻转。MediaPipe 原始标签与真实左右相反（输入未镜像）
      return {landmarks:tpl.map(([x,y])=>({x:nx+sx*(x-pc[0])*size/1.333, y:ny+(y-pc[1])*size, z:0})),
              handedness: h.hand ? (h.hand==='left'?'Right':'Left') : null, score: 0.95}; });
    return window.__spec.length>0; };
}
