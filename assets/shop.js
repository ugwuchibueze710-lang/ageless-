// Ageless shop — product grid, cinematic "fly into the cart" + restock, cart drawer, checkout.
(function(){
  var P=window.PRODUCTS, CATS=window.CATS, byId={};
  P.forEach(function(p){byId[p.id]=p;});
  var grid=document.getElementById('grid'), chips=document.getElementById('chips'),
      cartBtn=document.getElementById('cartBtn'), countEl=document.getElementById('cartCount'),
      drawer=document.getElementById('drawer'), drawerBg=document.getElementById('drawerBg'),
      drBody=document.getElementById('drBody'), drTotal=document.getElementById('drTotal'), drFoot=document.getElementById('drFoot'),
      co=document.getElementById('checkout'), coTotal=document.getElementById('coTotal'), coMsg=document.getElementById('coMsg');
  var IMG='assets/img/toys/';
  var money=function(n){return '$'+n.toFixed(2);};
  var cart={}; try{ cart=JSON.parse(localStorage.getItem('ageless-cart')||'{}')||{}; }catch(e){ cart={}; }
  function save(){ try{ localStorage.setItem('ageless-cart',JSON.stringify(cart)); }catch(e){} }

  // ---------- grid ----------
  var cur='all';
  function renderChips(){
    chips.innerHTML=CATS.map(function(c){return '<button class="chip" role="tab" data-c="'+c.id+'" aria-selected="'+(c.id===cur)+'">'+c.name+'</button>';}).join('');
  }
  function renderGrid(){
    var list=P.filter(function(p){return cur==='all'||p.cat===cur;});
    grid.innerHTML=list.map(function(p,i){
      return '<article class="card enter" style="animation-delay:'+(i*60)+'ms" data-id="'+p.id+'">'+
        '<div class="c-img"><img src="'+IMG+p.img+'" alt="'+p.name+'" loading="lazy"><span class="shine"></span></div>'+
        '<div class="c-body"><h3 class="c-name">'+p.name+'</h3><p class="c-note">'+p.note+'</p>'+
        '<div class="c-row"><span class="c-price">'+money(p.price)+'</span>'+
        '<button class="btn btn-neon add" data-id="'+p.id+'">Add to Cart</button></div></div></article>';
    }).join('');
  }
  chips.addEventListener('click',function(e){var b=e.target.closest('.chip'); if(!b) return; cur=b.dataset.c; renderChips(); renderGrid();});

  // ---------- fly to cart ----------
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fly(card,id){
    var img=card.querySelector('.c-img img'), r=img.getBoundingClientRect(), t=cartBtn.getBoundingClientRect();
    if(reduce){ add(id); return; }
    var f=document.createElement('img'); f.src=img.src; f.className='flyer';
    var size=Math.min(r.width,r.height); f.style.width=size+'px'; f.style.height=size+'px';
    f.style.left=(r.left+(r.width-size)/2)+'px'; f.style.top=(r.top+(r.height-size)/2)+'px';
    document.body.appendChild(f);
    // the toy leaves the shelf…
    img.classList.remove('restock'); img.classList.add('leave');
    var sx=r.left+r.width/2, sy=r.top+r.height/2, ex=t.left+t.width/2, ey=t.top+t.height/2;
    var dx=ex-sx, dy=ey-sy, peak=-Math.max(90,Math.min(200,Math.abs(dy)*.35)), dur=900, t0=performance.now(), spin=(Math.random()<.5?-1:1)*540, lastTrail=0;
    function step(now){
      var k=Math.min(1,(now-t0)/dur), e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
      var x=dx*e, y=dy*e + peak*4*k*(1-k)*(1-.0), sc=1-.86*e, rot=spin*e;
      // squash on launch, stretch mid-flight
      var sq=k<.12?1-.25*Math.sin(k/.12*Math.PI):1+.12*Math.sin(k*Math.PI);
      f.style.transform='translate('+x+'px,'+y+'px) rotate('+rot+'deg) scale('+(sc*sq)+','+(sc/sq)+')';
      f.style.opacity=k>.9?(1-(k-.9)*10):1;
      if(now-lastTrail>28){ lastTrail=now; var tr=document.createElement('i'); tr.className='trail';
        tr.style.left=(sx+x-4)+'px'; tr.style.top=(sy+y-4)+'px'; document.body.appendChild(tr); setTimeout(function(){tr.remove();},700); }
      if(k<1) requestAnimationFrame(step); else land();
    }
    function land(){
      f.remove(); add(id);
      cartBtn.classList.remove('bump'); void cartBtn.offsetWidth; cartBtn.classList.add('bump');
      burst(ex,ey);
    }
    requestAnimationFrame(step);
    // …and a fresh one drops back onto the shelf
    setTimeout(function(){ img.classList.remove('leave'); void img.offsetWidth; img.classList.add('restock');
      card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }, 520);
  }
  function burst(x,y){
    var cols=['#fff','#fff','#e6dcff','#c9b6ff','#fff'];
    for(var i=0;i<14;i++){
      var p=document.createElement('i'); p.className='trail';
      var a=Math.PI*2*i/14, d=30+Math.random()*30;
      p.style.left=(x-4)+'px'; p.style.top=(y-4)+'px'; p.style.background=cols[i%5]; p.style.boxShadow='0 0 10px '+cols[i%5];
      p.style.transition='transform .6s cubic-bezier(.2,.9,.3,1)'; document.body.appendChild(p);
      (function(p,a,d){ requestAnimationFrame(function(){ p.style.transform='translate('+Math.cos(a)*d+'px,'+Math.sin(a)*d+'px)'; }); setTimeout(function(){p.remove();},700); })(p,a,d);
    }
  }
  grid.addEventListener('click',function(e){
    var b=e.target.closest('.add'); if(!b) return;
    var card=b.closest('.card'); fly(card,b.dataset.id);
    b.classList.add('added'); b.textContent='Added ✓';
    setTimeout(function(){ b.classList.remove('added'); b.textContent='Add to Cart'; },1300);
  });

  // ---------- cart ----------
  function add(id,n){ cart[id]=(cart[id]||0)+(n||1); if(cart[id]<=0) delete cart[id]; save(); renderCart(); }
  function total(){ var t=0; for(var k in cart) if(byId[k]) t+=byId[k].price*cart[k]; return t; }
  function count(){ var c=0; for(var k in cart) c+=cart[k]; return c; }
  function renderCart(){
    var c=count(); if(countEl.textContent!=String(c)){ countEl.textContent=c; countEl.classList.remove('pop'); void countEl.offsetWidth; countEl.classList.add('pop'); }
    var ids=Object.keys(cart).filter(function(k){return byId[k];});
    drBody.innerHTML=ids.length?ids.map(function(k){var p=byId[k];
      return '<div class="li"><img src="'+IMG+p.img+'" alt=""><div><div class="li-name">'+p.name+'</div><div class="li-price">'+money(p.price)+' each</div>'+
        '<div class="qty"><button data-q="-1" data-id="'+k+'" aria-label="Less">−</button><span>'+cart[k]+'</span><button data-q="1" data-id="'+k+'" aria-label="More">+</button></div></div>'+
        '<div><div class="li-tot">'+money(p.price*cart[k])+'</div><button class="li-rm" data-rm="'+k+'">Remove</button></div></div>';
    }).join(''):'<p class="dr-empty">Your cart is empty.<br>Go grab something cute ✦</p>';
    drTotal.textContent=coTotal.textContent=money(total());
    drFoot.style.display=ids.length&&co.hidden?'':'none';
  }
  drBody.addEventListener('click',function(e){
    var q=e.target.closest('[data-q]'); if(q){ add(q.dataset.id,+q.dataset.q); return; }
    var rm=e.target.closest('[data-rm]'); if(rm){ delete cart[rm.dataset.rm]; save(); renderCart(); }
  });
  function open(v){ drawer.classList.toggle('open',v); drawerBg.classList.toggle('open',v); drawer.setAttribute('aria-hidden',!v); if(!v){ showCheckout(false); } }
  cartBtn.addEventListener('click',function(){ open(true); });
  drawerBg.addEventListener('click',function(){ open(false); });
  document.getElementById('drawerX').addEventListener('click',function(){ open(false); });
  addEventListener('keydown',function(e){ if(e.key==='Escape') open(false); });

  // ---------- checkout ----------
  function showCheckout(v){ co.hidden=!v; drBody.style.display=v?'none':''; coMsg.textContent=''; coMsg.className='co-msg'; renderCart(); }
  document.getElementById('toCheckout').addEventListener('click',function(){ showCheckout(true); });
  document.getElementById('backToCart').addEventListener('click',function(){ showCheckout(false); });
  co.addEventListener('change',function(e){
    if(e.target.name==='method'){ var del=e.target.value==='delivery'; document.getElementById('addrFields').hidden=!del;
      ['street','city','zip'].forEach(function(n){ co.elements[n].required=del; }); }
  });
  co.addEventListener('submit',function(e){
    e.preventDefault();
    if(!count()){ coMsg.textContent='Your cart is empty.'; coMsg.className='co-msg err'; return; }
    var f=co.elements, btn=document.getElementById('placeOrder');
    var order={
      customer:{ name:f.name.value.trim(), phone:f.phone.value.trim(), email:f.email.value.trim() },
      method:f.method.value,
      address:f.method.value==='delivery'?{ street:f.street.value.trim(), city:f.city.value.trim(), zip:f.zip.value.trim() }:null,
      notes:f.notes.value.trim(),
      items:Object.keys(cart).filter(function(k){return byId[k];}).map(function(k){var p=byId[k];return {id:k,name:p.name,price:p.price,qty:cart[k],img:IMG+p.img};})
    };
    btn.disabled=true; btn.textContent='Sending…';
    fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(order)})
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){ if(!r.ok) throw new Error(j.error||'Order could not be sent'); return j; }); })
      .then(function(j){
        cart={}; save(); renderCart(); co.reset(); document.getElementById('addrFields').hidden=true;
        coMsg.textContent='Order #'+(j.id||'')+' received! The store will contact you to confirm.'; coMsg.className='co-msg ok';
      })
      .catch(function(err){ coMsg.textContent='Online ordering isn’t live yet — please call (317) 599-2537. ('+err.message+')'; coMsg.className='co-msg err'; })
      .finally(function(){ btn.disabled=false; btn.textContent='Place Order'; });
  });

  renderChips(); renderGrid(); renderCart();
})();
