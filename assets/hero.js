// Ageless hero — real storefront photo, neon sign re-lit on the real letters,
// cord runs down the stone pillar into a wall outlet, working on/off switch.
(function(){
  var IW=3536, IH=1990;                         // photo coordinate space (extended storefront)
  var LET={x:1222,y:212,w:1089,h:296};          // the AGELESS letters on the black panel
  var PANEL={x:1184,y:178,w:1176,h:359};
  var CORD_START={x:2296,y:530};                // cord leaves the bottom of the sign
  var PILLAR_TOP={x:2166,y:668};                // top of stone pillar between door & window
  var OUTLET={x:2161,y:1610};
  var SWITCH={x:2161,y:1392};
  var LIGHTS=[{x:1058,y:618},{x:1560,y:618},{x:1324,y:812}];
  var FOCUS={x0:1120,x1:2420};                  // must stay visible on narrow screens

  var hero=document.getElementById('hero'), scene=document.getElementById('scene'),
      bg=document.getElementById('heroBg'), sign=document.getElementById('neonSign'),
      wire=document.getElementById('wire'), wp=document.getElementById('wirePath'), ws=document.getElementById('wireShine'),
      outlet=document.getElementById('outlet'), sw=document.getElementById('neonSwitch'), hint=document.getElementById('switchHint'),
      spill=document.getElementById('spill'), rays=document.querySelectorAll('.rays span'), sparkle=document.getElementById('sparkle'),
      fgImgs=document.querySelectorAll('.fg img');
  var s=1, ox=0, oy=0, W=0, H=0, mobile=false;

  function P(p){return [ox+p.x*s, oy+p.y*s];}
  function px(el,x,y,w,h){el.style.left=x+'px';el.style.top=y+'px';if(w!=null)el.style.width=w+'px';if(h!=null)el.style.height=h+'px';}

  function layout(){
    W=scene.clientWidth; mobile=innerWidth<=760;
    var vh=window.visualViewport?visualViewport.height:innerHeight;
    if(mobile){
      s=W/(FOCUS.x1-FOCUS.x0); var top=56; H=Math.round(IH*s)+top; scene.style.height=H+'px';
      ox=W/2-(FOCUS.x0+FOCUS.x1)/2*s; oy=top;
    } else {
      scene.style.height=''; H=scene.clientHeight;
      s=Math.max(W/IW,H/IH);
      if((FOCUS.x1-FOCUS.x0)*s>W){s=W/(FOCUS.x1-FOCUS.x0);}
      ox=W/2-(FOCUS.x0+FOCUS.x1)/2*s; ox=Math.min(0,Math.max(W-IW*s,ox));
      oy=Math.min(0,Math.max(H-IH*s, 84-PANEL.y*s));
    }
    px(bg,ox,oy,IW*s,IH*s);
    var l=P(LET); px(sign,l[0],l[1],LET.w*s,LET.h*s);
    var pc=P({x:PANEL.x+PANEL.w/2,y:PANEL.y+PANEL.h/2});
    px(spill,pc[0]-PANEL.w*s*.85,pc[1]-PANEL.h*s*1.4,PANEL.w*s*1.7,PANEL.h*s*2.8);
    // cord
    var a=P(CORD_START), b=P(PILLAR_TOP), o=P(OUTLET), plugTop=o[1]-50*s;
    var d='M'+a[0]+' '+a[1]+' C'+(a[0]+6*s)+' '+(a[1]+110*s)+' '+(b[0]+70*s)+' '+(b[1]-60*s)+' '+b[0]+' '+b[1]+
          ' C'+(b[0]-16*s)+' '+(b[1]+300*s)+' '+(o[0]+14*s)+' '+(plugTop-380*s)+' '+o[0]+' '+plugTop;
    wp.setAttribute('d',d); ws.setAttribute('d',d);
    var sw_=Math.max(2.5,9*s); wp.style.strokeWidth=sw_; ws.style.strokeWidth=Math.max(.8,sw_*.25);
    var ow=Math.max(20,70*s), oh=ow*1.5; px(outlet,o[0]-ow/2,o[1]-oh/2+10*s,ow,oh);
    var swc=P(SWITCH), sww=Math.max(22,66*s), swh=sww*1.55; px(sw,swc[0]-sww/2,swc[1]-swh/2,sww,swh);
    hint.style.left=(swc[0]-sww/2-10)+'px'; hint.style.top=(swc[1]-10)+'px'; hint.style.transform='translateX(-100%)';
    rays.forEach(function(r,i){var p=P(LIGHTS[i]);r.style.left=(p[0]-r.offsetWidth/2)+'px';r.style.top=p[1]+'px';});
    if(!sparkle.childElementCount) makeSparkles();
  }

  function makeSparkles(){
    var cols=['#ff4fd8','#a45bff','#5ef2ff','#ffd88a','#ffffff'], n=innerWidth<760?16:34, html='';
    for(var i=0;i<n;i++){
      var z=(2+Math.random()*5).toFixed(1), star=Math.random()<.35;
      html+='<i class="'+(star?'star':'')+'" style="left:'+(Math.random()*100).toFixed(1)+'%;top:'+(20+Math.random()*75).toFixed(1)+
        '%;--z:'+(star?z*2.4:z)+'px;--c:'+cols[i%cols.length]+';--d:'+(5+Math.random()*7).toFixed(1)+'s;--dl:-'+(Math.random()*10).toFixed(1)+'s;--r:'+(60+Math.random()*160|0)+'px"></i>';
    }
    sparkle.innerHTML=html;
  }

  // ---- neon switch + sound ----
  var actx=null, hum=null;
  function audio(){ if(!actx){ try{ actx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } return actx; }
  function click(){
    var c=audio(); if(!c) return;
    var t=c.currentTime, b=c.createBuffer(1,c.sampleRate*.05,c.sampleRate), d=b.getChannelData(0);
    for(var i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,6);
    var src=c.createBufferSource(), g=c.createGain(); src.buffer=b; g.gain.value=.5; src.connect(g).connect(c.destination); src.start(t);
  }
  function buzzSound(on){
    var c=audio(); if(!c) return;
    if(on){
      var o=c.createOscillator(), g=c.createGain(), f=c.createBiquadFilter();
      o.type='sawtooth'; o.frequency.value=120; f.type='lowpass'; f.frequency.value=420;
      g.gain.setValueAtTime(0,c.currentTime); g.gain.linearRampToValueAtTime(.035,c.currentTime+.08); g.gain.linearRampToValueAtTime(.008,c.currentTime+.9);
      o.connect(f).connect(g).connect(c.destination); o.start(); o.stop(c.currentTime+1.2);
    }
  }
  var on=true;
  function setNeon(v,user){
    on=v; sign.classList.toggle('on',on); hero.classList.toggle('off',!on); document.body.classList.toggle('neon-off',!on);
    sw.setAttribute('aria-pressed',on?'true':'false'); sw.setAttribute('aria-label',on?'Turn the neon sign off':'Turn the neon sign on');
    if(on){ sign.classList.remove('ignite'); void sign.offsetWidth; sign.classList.add('ignite'); }
    if(user){ click(); buzzSound(on); hint.classList.add('gone'); }
  }
  sw.addEventListener('click',function(){ setNeon(!on,true); });

  // random neon buzz / flicker
  (function buzz(){ setTimeout(function(){ if(on){ sign.classList.remove('buzz'); void sign.offsetWidth; sign.classList.add('buzz'); } buzz(); }, 3000+Math.random()*7000); })();

  // ---- foreground plush: scroll parallax + gentle sway ----
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches, lastY=scrollY, vel=0;
  function tick(t){
    var y=scrollY; vel+=((y-lastY)-vel)*.15; lastY=y;
    fgImgs.forEach(function(im,i){
      var k=[.45,.35,.6][i], sway=Math.sin(t/1000*(.6+i*.17)+i*2)*1.6 + vel*.12*(i%2?-1:1);
      im.style.transform='translateY('+(-y*k)+'px) rotate('+sway.toFixed(2)+'deg)';
    });
    if(!reduce) requestAnimationFrame(tick);
  }

  addEventListener('resize',function(){ clearTimeout(window.__agL); window.__agL=setTimeout(layout,80); });
  layout(); setTimeout(layout,300);
  if(!reduce) requestAnimationFrame(tick);
  setNeon(true,false);
})();
