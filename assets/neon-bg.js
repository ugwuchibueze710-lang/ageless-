// Floating mini neon AGELESS logos — background + foreground layers, synced to scroll.
// Each one hums, flickers and buzzes like the main sign, and dims when the switch is off.
(function(){
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DPR=Math.min(window.devicePixelRatio||1,1.5);
  var bg=document.createElement('canvas'), fg=document.createElement('canvas');
  bg.id='neonBg'; fg.id='neonFg'; bg.setAttribute('aria-hidden','true'); fg.setAttribute('aria-hidden','true');
  document.body.prepend(bg); document.body.appendChild(fg);
  var bctx=bg.getContext('2d'), fctx=fg.getContext('2d');
  var W=0,H=0, parts=[], fparts=[], sprites=null;
  var COLORS=[['#ffffff','#ffffff'],['#ffffff','#ffffff'],['#e9e1ff','#ffffff'],['#c4adff','#ffffff'],['#ffffff','#fbf8ff']];

  function mk(w,h){var c=document.createElement('canvas');c.width=w;c.height=h;return c;}
  function build(letters){
    var S=220, h=Math.round(S*letters.height/letters.width), pad=50, out={lit:[],dim:[],litB:[],dimB:[]};
    function tint(col){ var c=mk(S,h), x=c.getContext('2d'); x.drawImage(letters,0,0,S,h); x.globalCompositeOperation='source-in'; x.fillStyle=col; x.fillRect(0,0,S,h); return c; }
    COLORS.forEach(function(cp){
      var core=tint(cp[1]), glow=tint(cp[0]);
      [false,true].forEach(function(blur){
        var c=mk(S+pad*2,h+pad*2), x=c.getContext('2d'); if(blur) x.filter='blur(5px)';
        x.shadowColor=cp[0]; x.shadowBlur=34; x.drawImage(glow,pad,pad); x.drawImage(glow,pad,pad);
        x.shadowBlur=14; x.drawImage(glow,pad,pad); x.shadowColor='#fff'; x.shadowBlur=4; x.drawImage(core,pad,pad);
        x.shadowBlur=0; x.drawImage(core,pad,pad);
        (blur?out.litB:out.lit).push(c);
        var d=mk(S+pad*2,h+pad*2), y=d.getContext('2d'); if(blur) y.filter='blur(5px)';
        y.globalAlpha=.45; y.drawImage(tint('#6b6476'),pad,pad);
        (blur?out.dimB:out.dim).push(d);
      });
    });
    return out;
  }
  function rnd(a,b){return a+Math.random()*(b-a);}
  function make(layer){
    var p={x:Math.random(),y:Math.random(),rot:rnd(-.3,.3),sway:rnd(0,6.28),swaySp:rnd(.2,.6),drift:rnd(.004,.014),
      hum:rnd(0,6.28),buzz:0,nextBuzz:rnd(1,14),c:(Math.random()*COLORS.length)|0};
    if(layer==='far'){p.size=rnd(10,18);p.a=rnd(.3,.55);p.par=.12;}
    else if(layer==='mid'){p.size=rnd(20,34);p.a=rnd(.45,.7);p.par=.3;}
    else if(layer==='near'){p.size=rnd(40,64);p.a=rnd(.5,.8);p.par=.55;}
    else {p.size=rnd(90,150);p.a=rnd(.07,.14);p.par=1.25;}
    return p;
  }
  function populate(){
    var area=W*H; parts=[]; fparts=[];
    var nf=Math.round(area/6000), nm=Math.round(area/19000), nn=Math.round(area/65000), nfg=Math.max(3,Math.round(area/200000));
    for(var i=0;i<nf;i++) parts.push(make('far'));
    for(i=0;i<nm;i++) parts.push(make('mid'));
    for(i=0;i<nn;i++) parts.push(make('near'));
    for(i=0;i<nfg;i++) fparts.push(make('fg'));
  }
  function resize(){
    W=innerWidth; H=innerHeight;
    [bg,fg].forEach(function(c){c.width=W*DPR;c.height=H*DPR;c.style.width=W+'px';c.style.height=H+'px';});
    bctx.setTransform(DPR,0,0,DPR,0,0); fctx.setTransform(DPR,0,0,DPR,0,0); populate();
  }
  var last=performance.now();
  function draw(ctx,list,now,dt,blurred){
    var sy=window.scrollY||0, off=document.body.classList.contains('neon-off');
    ctx.clearRect(0,0,W,H); ctx.globalCompositeOperation=off?'source-over':'lighter';
    for(var i=0;i<list.length;i++){
      var p=list[i];
      if(!reduce){
        p.y-=p.drift*dt/1000*.25; if(p.y<-.2) p.y+=1.4;
        p.nextBuzz-=dt/1000; if(p.nextBuzz<=0){p.buzz=rnd(.25,.9);p.nextBuzz=rnd(3,18);}
        if(p.buzz>0) p.buzz-=dt/1000;
      }
      var span=H*1.4, y=((p.y*span-sy*p.par)%span+span)%span-H*.2, x=p.x*W+Math.sin(now/1000*p.swaySp+p.sway)*10;
      var lit=!off, alpha=p.a;
      if(lit){ alpha*=.88+.12*Math.sin(now/1000*7+p.hum); if(p.buzz>0){var f=Math.random(); if(f<.45){lit=false;alpha=p.a*.6;} else alpha*=f;} }
      else alpha=p.a*.5;
      var set=lit?(blurred?sprites.litB:sprites.lit):(blurred?sprites.dimB:sprites.dim), img=set[p.c];
      var h=p.size*1.6, w=h*img.width/img.height;
      ctx.save(); ctx.globalAlpha=Math.max(0,Math.min(1,alpha)); ctx.translate(x,y); ctx.rotate(p.rot); ctx.drawImage(img,-w/2,-h/2,w,h); ctx.restore();
    }
  }
  function frame(now){ var dt=Math.min(64,now-last); last=now; if(sprites){draw(bctx,parts,now,dt,false);draw(fctx,fparts,now,dt,true);} if(!reduce) requestAnimationFrame(frame); }
  addEventListener('resize',function(){clearTimeout(window.__agNR);window.__agNR=setTimeout(resize,150);});
  if(reduce) addEventListener('scroll',function(){requestAnimationFrame(frame);},{passive:true});
  document.addEventListener('visibilitychange',function(){last=performance.now();});
  resize();
  var im=new Image(); im.onload=function(){ sprites=build(im); requestAnimationFrame(frame); }; im.src='assets/img/logo-letters.png';
})();
