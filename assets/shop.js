// Ageless shop — live catalog from the admin, cinematic "fly into the cart" + restock,
// product detail, cart capped at real stock, and Square checkout when the store has connected Square.
(function(){
  var grid=document.getElementById('grid'), chips=document.getElementById('chips'), qIn=document.getElementById('q'),
      cartBtn=document.getElementById('cartBtn'), countEl=document.getElementById('cartCount'),
      drawer=document.getElementById('drawer'), drawerBg=document.getElementById('drawerBg'),
      drBody=document.getElementById('drBody'), drTotal=document.getElementById('drTotal'), drFoot=document.getElementById('drFoot'),
      co=document.getElementById('checkout'), coMsg=document.getElementById('coMsg'), placeBtn=document.getElementById('placeOrder');
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  var money=function(c){ return '$'+(c/100).toFixed(2); };
  function api(path,body){
    return fetch('/api'+path, body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){ if(!r.ok){ var e=new Error(j.error||'Something went wrong. Please try again.'); e.data=j; e.status=r.status; throw e; } return j; }); });
  }

  var CFG={paymentsEnabled:false}, PRODUCTS=[], CATS=[], VAR={}, PROD={};
  // cart: { variationId: qty }
  var cart={}; try{ cart=JSON.parse(localStorage.getItem('ageless-cart2')||'{}')||{}; }catch(e){ cart={}; }
  function save(){ try{ localStorage.setItem('ageless-cart2',JSON.stringify(cart)); }catch(e){} }

  // Only items the store has set a quantity for can be ordered (no overselling); others show "In store only".
  function canAdd(v){ return !!v && v.available!=null && v.available>0; }
  function maxQty(v){ return v.available==null?99:Math.min(99,v.available); }
  function stockLabel(p){
    if(p.variations.every(function(v){return v.available===0;})) return {cls:'out',t:'Out of stock'};
    if(p.sale_percent) return {cls:'sale',t:'−'+p.sale_percent+'%'};
    if(!p.quantity_set) return {cls:'store',t:'In store only'};
    var a=p.variations.reduce(function(t,v){return t+(v.available||0);},0);
    if(a>0&&a<=3) return {cls:'low',t:'Only '+a+' left'};
    return null;
  }

  // ---------- grid ----------
  var cur='all';
  function renderChips(){
    var all=[{slug:'all',name:'All'}].concat(CATS.filter(function(c){ return PRODUCTS.some(function(p){return p.category===c.slug;}); }));
    chips.innerHTML=all.map(function(c){return '<button class="chip" role="tab" data-c="'+esc(c.slug)+'" aria-selected="'+(c.slug===cur)+'">'+esc(c.name)+'</button>';}).join('');
  }
  function renderGrid(){
    var q=(qIn.value||'').trim().toLowerCase();
    var list=PRODUCTS.filter(function(p){ return (cur==='all'||p.category===cur) && (!q || (p.name+' '+(p.description||'')+' '+(p.category_name||'')).toLowerCase().indexOf(q)>=0); });
    if(!list.length){ grid.innerHTML='<p class="shop-msg">'+(PRODUCTS.length?'Nothing matches that. Try another word or category.':'New toys are coming soon — visit the store to see everything on the shelves.')+'</p>'; return; }
    grid.innerHTML=list.map(function(p,i){
      var v=p.variations[0], st=stockLabel(p), multi=p.variations.length>1, ok=p.variations.some(canAdd);
      var lp=p.variations.filter(function(x){return x.price_cents===p.min_price_cents;})[0].list_cents;
      var price=(multi&&p.variations.some(function(x){return x.price_cents!==p.min_price_cents;})?'From ':'')+(lp?'<s>'+money(lp)+'</s> ':'')+money(p.min_price_cents);
      return '<article class="card enter'+(ok?'':' sold')+'" style="animation-delay:'+(i*60)+'ms" data-id="'+p.id+'">'+
        '<div class="c-img" data-open="'+p.id+'"><img src="'+esc(p.images[0]||'assets/img/logo-sm.png')+'" alt="'+esc(p.name)+'" loading="lazy"><span class="shine"></span>'+
        (st?'<span class="badge-st '+st.cls+'">'+st.t+'</span>':'')+(p.featured?'<span class="badge-st feat">★ Featured</span>':'')+'</div>'+
        '<div class="c-body"><h3 class="c-name"><a href="#p/'+esc(p.slug)+'" data-open="'+p.id+'">'+esc(p.name)+'</a></h3><p class="c-note">'+esc(p.description||'')+'</p>'+
        '<div class="c-row"><span class="c-price">'+price+'</span>'+
        (multi?'<button class="btn btn-neon" data-open="'+p.id+'"'+(ok?'':' disabled')+'>'+(ok?'Choose':'Sold out')+'</button>'
              :'<button class="btn btn-neon add" data-v="'+v.id+'"'+(ok?'':' disabled')+'>'+(ok?'Add to Cart':(v.available===0?'Sold out':'In store'))+'</button>')+
        '</div></div></article>';
    }).join('');
  }
  chips.addEventListener('click',function(e){var b=e.target.closest('.chip'); if(!b) return; cur=b.dataset.c; renderChips(); renderGrid();});
  qIn.addEventListener('input',function(){ renderGrid(); });

  // ---------- fly to cart ----------
  var pending={};
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fly(img,vid,qty,restockEl){
    var r=img.getBoundingClientRect(), t=cartBtn.getBoundingClientRect();
    if(reduce){ add(vid,qty); return; }
    pending[vid]=(pending[vid]||0)+qty;
    var f=document.createElement('img'); f.src=img.src; f.className='flyer';
    var size=Math.min(r.width,r.height,260); f.style.width=size+'px'; f.style.height=size+'px';
    f.style.left=(r.left+(r.width-size)/2)+'px'; f.style.top=(r.top+(r.height-size)/2)+'px';
    document.body.appendChild(f);
    if(restockEl){ img.classList.remove('restock'); img.classList.add('leave'); }
    var sx=r.left+r.width/2, sy=r.top+r.height/2, ex=t.left+t.width/2, ey=t.top+t.height/2;
    var dx=ex-sx, dy=ey-sy, peak=-Math.max(90,Math.min(200,Math.abs(dy)*.35)), dur=900, t0=performance.now(), spin=(Math.random()<.5?-1:1)*540, lastTrail=0;
    function step(now){
      var k=Math.min(1,(now-t0)/dur), e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
      var x=dx*e, y=dy*e + peak*4*k*(1-k), sc=1-.86*e, rot=spin*e;
      var sq=k<.12?1-.25*Math.sin(k/.12*Math.PI):1+.12*Math.sin(k*Math.PI);
      f.style.transform='translate('+x+'px,'+y+'px) rotate('+rot+'deg) scale('+(sc*sq)+','+(sc/sq)+')';
      f.style.opacity=k>.9?(1-(k-.9)*10):1;
      if(now-lastTrail>28){ lastTrail=now; var tr=document.createElement('i'); tr.className='trail';
        tr.style.left=(sx+x-4)+'px'; tr.style.top=(sy+y-4)+'px'; document.body.appendChild(tr); setTimeout(function(){tr.remove();},700); }
      if(k<1) requestAnimationFrame(step); else land();
    }
    function land(){
      f.remove(); pending[vid]-=qty; add(vid,qty);
      cartBtn.classList.remove('bump'); void cartBtn.offsetWidth; cartBtn.classList.add('bump');
      burst(ex,ey);
    }
    requestAnimationFrame(step);
    if(restockEl) setTimeout(function(){ img.classList.remove('leave'); void img.offsetWidth; img.classList.add('restock');
      restockEl.classList.remove('flash'); void restockEl.offsetWidth; restockEl.classList.add('flash'); }, 520);
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
  function flashBtn(b,txt){ b.classList.add('added'); var o=b.textContent; b.textContent=txt||'Added ✓'; setTimeout(function(){ b.classList.remove('added'); b.textContent=o; },1300); }
  grid.addEventListener('click',function(e){
    var o=e.target.closest('[data-open]'); if(o){ e.preventDefault(); openProduct(+o.dataset.open); return; }
    var b=e.target.closest('.add'); if(!b||b.disabled) return;
    var v=VAR[b.dataset.v]; if(!roomFor(v,1)){ flashBtn(b,'Max in cart'); return; }
    var card=b.closest('.card'); fly(card.querySelector('.c-img img'),v.id,1,card); flashBtn(b);
  });
  function roomFor(v,n){ return canAdd(v) && (cart[v.id]||0)+(pending[v.id]||0)+n<=maxQty(v); }

  // ---------- product detail ----------
  var pd=$('pd'), pdBg=$('pdBg'), curP=null, curV=null, pdQ=1;
  function openProduct(id,noHash){
    var p=PROD[id]; if(!p) return; curP=p; pdQ=1;
    $('pdCat').textContent=p.category_name||''; $('pdName').textContent=p.name; $('pdDesc').textContent=p.description||'';
    $('pdImg').src=p.images[0]||'assets/img/logo-sm.png'; $('pdImg').alt=p.name;
    $('pdThumbs').innerHTML=p.images.length>1?p.images.map(function(u,i){return '<button type="button" data-i="'+i+'"'+(i?'':' class="on"')+'><img src="'+esc(u)+'" alt=""></button>';}).join(''):'';
    var multi=p.variations.length>1; $('pdVarWrap').hidden=!multi;
    $('pdVar').innerHTML=p.variations.map(function(v){return '<option value="'+v.id+'">'+esc(v.name)+' — '+money(v.price_cents)+(v.available===0?' (sold out)':'')+'</option>';}).join('');
    var first=p.variations.filter(canAdd)[0]||p.variations[0]; $('pdVar').value=first.id; pickVar(first.id);
    pd.hidden=pdBg.hidden=false; document.body.classList.add('noscroll'); requestAnimationFrame(function(){ pd.classList.add('open'); });
    if(!noHash && location.hash!=='#p/'+p.slug) history.replaceState(null,'','#p/'+p.slug);
    $('pdX').focus();
  }
  function pickVar(id){
    curV=VAR[id]; pdQ=1; $('pdQty').textContent=1; $('pdPrice').innerHTML=(curV.list_cents?'<s>'+money(curV.list_cents)+'</s> ':'')+money(curV.price_cents);
    var s=curV.available===0?'Sold out':curV.available==null?'Available in the store — call to check':curV.available<=3?'Only '+curV.available+' left':'In stock';
    $('pdStock').textContent=s; $('pdStock').className='pd-stock'+(curV.available===0?' out':'');
    var ok=canAdd(curV); $('pdAdd').disabled=!ok; $('pdAdd').textContent=ok?'Add to Cart':(curV.available===0?'Sold out':'In store only');
  }
  function closeProduct(){ pd.classList.remove('open'); pd.hidden=pdBg.hidden=true; document.body.classList.remove('noscroll'); if(/^#p\//.test(location.hash)) history.replaceState(null,'',location.pathname+location.search+'#shop'); }
  $('pdVar').addEventListener('change',function(){ pickVar(this.value); });
  $('pdThumbs').addEventListener('click',function(e){ var b=e.target.closest('[data-i]'); if(!b) return; $('pdImg').src=curP.images[+b.dataset.i]; [].forEach.call(this.children,function(x){x.classList.toggle('on',x===b);}); });
  $('pdMinus').onclick=function(){ pdQ=Math.max(1,pdQ-1); $('pdQty').textContent=pdQ; };
  $('pdPlus').onclick=function(){ if((cart[curV.id]||0)+pdQ<maxQty(curV)) pdQ++; $('pdQty').textContent=pdQ; };
  $('pdAdd').onclick=function(){ var b=this; if(!roomFor(curV,pdQ)){ flashBtn(b,'Max in cart'); return; } fly($('pdImg'),curV.id,pdQ,null); flashBtn(b); setTimeout(closeProduct,350); };
  $('pdX').onclick=closeProduct; pdBg.onclick=closeProduct;
  function fromHash(){ var m=location.hash.match(/^#p\/(.+)$/); if(!m) return; var p=PRODUCTS.filter(function(x){return x.slug===decodeURIComponent(m[1]);})[0]; if(p) openProduct(p.id,true); }
  addEventListener('hashchange',fromHash);

  // ---------- cart ----------
  function add(id,n){ cart[id]=(cart[id]||0)+(n||1); var v=VAR[id]; if(v&&cart[id]>maxQty(v)) cart[id]=maxQty(v); if(cart[id]<=0) delete cart[id]; save(); renderCart(); }
  function lines(){ return Object.keys(cart).filter(function(k){return VAR[k];}).map(function(k){ return {v:VAR[k],p:PROD[VAR[k].product_id],qty:cart[k]}; }); }
  function subtotal(){ return lines().reduce(function(t,l){return t+l.v.price_cents*l.qty;},0); }
  function count(){ return lines().reduce(function(t,l){return t+l.qty;},0); }
  function renderCart(){
    var c=count(); if(countEl.textContent!=String(c)){ countEl.textContent=c; countEl.classList.remove('pop'); void countEl.offsetWidth; countEl.classList.add('pop'); }
    var L=lines();
    drBody.innerHTML=L.length?L.map(function(l){ var v=l.v,p=l.p, warn=!canAdd(v)?(v.available===0?'Sold out — please remove':'Not available online — please remove'):(v.available!=null&&l.qty>v.available?'Only '+v.available+' left':'');
      return '<div class="li"><img src="'+esc(p.images[0]||'')+'" alt=""><div><div class="li-name">'+esc(p.name)+(p.variations.length>1?' <small>· '+esc(v.name)+'</small>':'')+'</div><div class="li-price">'+(v.list_cents?'<s>'+money(v.list_cents)+'</s> ':'')+money(v.price_cents)+' each</div>'+
        (warn?'<div class="li-warn">'+warn+'</div>':'')+
        '<div class="qty"><button data-q="-1" data-id="'+v.id+'" aria-label="Less">−</button><span>'+l.qty+'</span><button data-q="1" data-id="'+v.id+'" aria-label="More"'+(l.qty>=maxQty(v)?' disabled':'')+'>+</button></div></div>'+
        '<div><div class="li-tot">'+money(v.price_cents*l.qty)+'</div><button class="li-rm" data-rm="'+v.id+'">Remove</button></div></div>';
    }).join(''):'<p class="dr-empty">Your cart is empty.<br>Go grab something cute ✦</p>';
    drTotal.textContent=money(subtotal());
    drFoot.style.display=L.length&&co.hidden?'':'none';
  }
  drBody.addEventListener('click',function(e){
    var q=e.target.closest('[data-q]'); if(q){ add(q.dataset.id,+q.dataset.q); return; }
    var rm=e.target.closest('[data-rm]'); if(rm){ delete cart[rm.dataset.rm]; save(); renderCart(); }
  });
  function open(v){ drawer.classList.toggle('open',v); drawerBg.classList.toggle('open',v); drawer.setAttribute('aria-hidden',!v); if(!v){ showCheckout(false); } }
  cartBtn.addEventListener('click',function(){ open(true); });
  drawerBg.addEventListener('click',function(){ open(false); });
  $('drawerX').addEventListener('click',function(){ open(false); });
  addEventListener('keydown',function(e){ if(e.key==='Escape'){ if(!pd.hidden) closeProduct(); else open(false); } });

  // ---------- checkout ----------
  var STATES='AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
  co.elements.state.innerHTML+=STATES.map(function(s){return '<option>'+s+'</option>';}).join('');
  var step=1, started=null, card=null, payments=null, quoteT=null;
  function msg(t,kind){ coMsg.innerHTML=t||''; coMsg.className='co-msg'+(kind?' '+kind:''); }
  function showCheckout(v){
    co.hidden=!v; drBody.style.display=v?'none':''; msg('');
    if(!v){ resetPay(); }
    else { setupFulfil(); quote(); }
    renderCart();
  }
  function resetPay(){ step=1; started=null; $('coStep1').hidden=false; $('coStep2').hidden=true; $('coTaxRow').hidden=true; $('coTaxNote').hidden=false;
    placeBtn.disabled=false; delete placeBtn.dataset.accept; if(card){ try{card.destroy();}catch(e){} card=null; } btnLabel(); }
  function payWay(){ var r=co.querySelector('input[name=pay]:checked'); return method()==='shipping'?'card':(r?r.value:'store'); }
  function btnLabel(){ if(step===1) placeBtn.textContent=payWay()==='store'?'Reserve for pickup':'Continue to payment';
    $('sqNote').hidden=payWay()==='store'; $('coTaxNote').textContent=payWay()==='store'?'Sales tax, if any, is added at the register when you pay.':'Sales tax, if any, is added at payment.'; }
  $('toCheckout').addEventListener('click',function(){ showCheckout(true); });
  $('backToCart').addEventListener('click',function(){ showCheckout(false); });
  function setupFulfil(){
    var sh=CFG.shipping||{}, pk=CFG.pickup||{};
    $('optPayNow').hidden=!CFG.paymentsEnabled; $('optPayStore').hidden=!CFG.payInStore;
    var cur=co.querySelector('input[name=pay]:checked');
    if(!cur||(cur.value==='card'&&!CFG.paymentsEnabled)||(cur.value==='store'&&!CFG.payInStore)) co.querySelector('input[name=pay][value='+(CFG.paymentsEnabled?'card':'store')+']').checked=true;
    $('soonNote').hidden=CFG.paymentsEnabled;
    $('optShip').hidden=!sh.enabled; $('optPickup').hidden=!pk.enabled;
    if(!pk.enabled&&sh.enabled) co.elements.method.value='shipping';
    if(pk.enabled&&!sh.enabled) co.elements.method.value='pickup';
    $('pickupNote').textContent=pk.enabled?[pk.instructions,pk.ready].filter(Boolean).join(' '):'';
    $('shipNote').textContent=[sh.note||'Ships within the United States only.',sh.time,sh.freeOverCents?'Free shipping over '+money(sh.freeOverCents)+'.':''].filter(Boolean).join(' ');
    toggleAddr();
  }
  function method(){ return co.elements.method.value; }
  function toggleAddr(){ var s=method()==='shipping'; $('addrFields').hidden=!s; $('pickupNote').hidden=s;
    $('payWay').hidden=s||!(CFG.paymentsEnabled&&CFG.payInStore); btnLabel(); }
  co.addEventListener('change',function(e){ if(e.target.name==='method'){ toggleAddr(); quote(); } if(e.target.name==='pay') btnLabel(); });
  function items(){ return lines().map(function(l){return {variation_id:l.v.id,qty:l.qty};}); }
  function quote(){
    clearTimeout(quoteT);
    quoteT=setTimeout(function(){
      if(!items().length) return;
      api('/checkout/quote',{items:items(),fulfillment:method()}).then(function(q){
        $('coSaveRow').hidden=!q.saved_cents; $('coSave').textContent='−'+money(q.saved_cents||0);
        $('coSub').textContent=money(q.subtotal_cents); $('coShip').textContent=method()==='shipping'?(q.shipping_cents?money(q.shipping_cents):'Free'):'Free (pickup)';
        $('coTotal').textContent=money(q.subtotal_cents+q.shipping_cents);
        if(q.problems.length){ msg(q.problems.map(function(p){return esc((p.name?p.name+': ':'')+p.reason);}).join('<br>'),'err'); placeBtn.disabled=true; }
        else { msg(''); placeBtn.disabled=false; }
      }).catch(function(e){ msg(esc(e.message),'err'); });
    },150);
  }
  function details(){
    var f=co.elements, d={ customer:{name:f.name.value.trim(),email:f.email.value.trim(),phone:f.phone.value.trim()}, fulfillment:method(), notes:f.notes.value.trim(), items:items() };
    if(d.fulfillment==='shipping') d.address={street:f.street.value.trim(),street2:f.street2.value.trim(),city:f.city.value.trim(),state:f.state.value,zip:f.zip.value.trim()};
    return d;
  }
  function loadSquare(){
    if(window.Square) return Promise.resolve();
    return new Promise(function(res,rej){ var s=document.createElement('script');
      s.src=CFG.square.env==='production'?'https://web.squarecdn.com/v1/square.js':'https://sandbox.web.squarecdn.com/v1/square.js';
      s.onload=res; s.onerror=function(){ rej(new Error('The secure payment form could not load. Check your connection and try again.')); }; document.head.appendChild(s); });
  }
  function showPayment(s){
    started=s; step=2; $('coStep1').hidden=true; $('coStep2').hidden=false;
    $('coSub').textContent=money(s.subtotal_cents); $('coShip').textContent=s.shipping_cents?money(s.shipping_cents):(method()==='shipping'?'Free':'Free (pickup)');
    $('coTaxRow').hidden=false; $('coTax').textContent=money(s.tax_cents); $('coTaxNote').hidden=true; $('coTotal').textContent=money(s.total_cents);
    var mins=Math.max(1,Math.round((Date.parse(s.hold_expires_at)-Date.now())/60000));
    $('holdNote').textContent='Your items are reserved for about '+mins+' minutes while you pay.';
    placeBtn.textContent='Pay '+money(s.total_cents); placeBtn.disabled=true;
    return loadSquare().then(function(){
      payments=payments||window.Square.payments(CFG.square.appId,CFG.square.locationId);
      return payments.card();
    }).then(function(c){ card=c; return c.attach('#card-container'); }).then(function(){ placeBtn.disabled=false; });
  }
  function pay(acceptTotal){
    placeBtn.disabled=true; placeBtn.textContent='Processing…'; msg('');
    var d=details();
    var verification={ amount:(started.total_cents/100).toFixed(2), currencyCode:'USD', intent:'CHARGE', customerInitiated:true, sellerKeyedIn:false,
      billingContact:{ givenName:d.customer.name, email:d.customer.email, phone:d.customer.phone } };
    return card.tokenize(verification).then(function(r){
      if(r.status!=='OK') throw new Error((r.errors&&r.errors[0]&&r.errors[0].message)||'Please check your card details.');
      return api('/checkout/pay',{code:started.code,token:started.token,sourceId:r.token,acceptTotal:acceptTotal||undefined});
    }).then(function(res){
      var link='/order.html?c='+encodeURIComponent(started.code)+'&t='+encodeURIComponent(started.token);
      cart={}; save(); renderCart();
      msg(res.status==='paid'?'Paid! Taking you to your order…':esc(res.message),'ok');
      setTimeout(function(){ location.href=link; },900);
    }).catch(function(e){
      placeBtn.textContent='Pay '+money(started.total_cents); placeBtn.disabled=false;
      if(e.data&&e.data.newTotal){ started.total_cents=e.data.newTotal; started.tax_cents=e.data.taxCents||started.tax_cents;
        $('coTax').textContent=money(started.tax_cents); $('coTotal').textContent=money(started.total_cents);
        placeBtn.textContent='Confirm & pay '+money(started.total_cents); placeBtn.dataset.accept=e.data.newTotal; msg(esc(e.message),'err'); return; }
      if(e.status===409){ msg(esc(e.message)+' <button type="button" class="linkish" id="reCart">Update cart</button>','err'); refreshCatalog(); var b=$('reCart'); if(b) b.onclick=function(){ showCheckout(false); }; return; }
      msg(esc(e.message),'err');
    });
  }
  co.addEventListener('submit',function(e){
    e.preventDefault();
    if(step===2){ if(card) pay(placeBtn.dataset.accept?+placeBtn.dataset.accept:0); return; }
    if(!count()){ msg('Your cart is empty.','err'); return; }
    var f=co.elements, d=details();
    if(d.customer.name.length<2){ msg('Please enter your full name.','err'); f.name.focus(); return; }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.customer.email)){ msg('Please enter a valid email — your receipt goes there.','err'); f.email.focus(); return; }
    if(d.customer.phone.replace(/\D/g,'').length<10){ msg('Please enter a valid phone number.','err'); f.phone.focus(); return; }
    if(d.fulfillment==='shipping'){ var a=d.address;
      if(a.street.length<4||a.city.length<2||!a.state||!/^\d{5}(-\d{4})?$/.test(a.zip)){ msg('Please fill in your full US shipping address.','err'); return; } }
    placeBtn.disabled=true; placeBtn.textContent='Reserving your items…';
    if(payWay()==='store'){
      api('/checkout/reserve',d).then(function(res){
        cart={}; save(); renderCart(); msg('Reserved! Taking you to your order…','ok');
        setTimeout(function(){ location.href='/order.html?c='+encodeURIComponent(res.code)+'&t='+encodeURIComponent(res.token); },700);
      }).catch(function(e){
        resetPay(); msg(esc(e.message)+(e.data&&e.data.problems?' <button type="button" class="linkish" id="reCart">Update cart</button>':''),'err');
        if(e.data&&e.data.problems){ refreshCatalog(); var b=$('reCart'); if(b) b.onclick=function(){ showCheckout(false); }; }
      });
      return;
    }
    api('/checkout/start',d).then(showPayment).catch(function(e){
      resetPay();
      msg(esc(e.message)+(e.data&&e.data.problems?' <button type="button" class="linkish" id="reCart">Update cart</button>':''),'err');
      if(e.data&&e.data.problems){ refreshCatalog(); var b=$('reCart'); if(b) b.onclick=function(){ showCheckout(false); }; }
    });
  });

  // ---------- load ----------
  function index(d){
    PRODUCTS=d.products; CATS=d.categories; VAR={}; PROD={};
    PRODUCTS.forEach(function(p){ PROD[p.id]=p; p.variations.forEach(function(v){ v.product_id=p.id; VAR[v.id]=v; }); });
    Object.keys(cart).forEach(function(k){ if(!VAR[k]) delete cart[k]; }); save();
  }
  function refreshCatalog(){ return api('/products').then(function(d){ index(d); renderGrid(); renderCart(); }).catch(function(){}); }
  function applySite(){
    var st=CFG.store||{}, si=CFG.site||{}, sale=CFG.sale;
    var ann=[sale?sale.label+(sale.ends?' — ends '+new Date(sale.ends+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}):''):'', si.announcement].filter(Boolean);
    var a=$('announce'); if(ann.length){ a.innerHTML=ann.map(function(t){return '<span>✦ '+esc(t)+' ✦</span>';}).join(''); a.hidden=false; } else a.hidden=true;
    var items=(si.marquee||[]).slice(); if(sale) items.unshift(sale.label);
    if(items.length){ var row=items.map(function(t){return '<span>'+esc(t)+'</span>';}).join(''); $('mqTrack').innerHTML=row+row; }
    if(st.address) $('vAddr').innerHTML=esc(st.address).replace(/\n/g,'<br>');
    if(st.hours&&st.hours.length) $('vHours').innerHTML=st.hours.map(function(h){return '<tr><td>'+esc(h[0])+'</td><td>'+esc(h[1])+'</td></tr>';}).join('');
    if(st.phone){ var tel='tel:+1'+st.phone.replace(/\D/g,'').replace(/^1(?=\d{10}$)/,''); [].forEach.call(document.querySelectorAll('a[href^="tel:"]'),function(x){ x.href=tel; if(/Call|\(\d{3}\)/.test(x.textContent)) x.textContent=x.id==='vCall'?'Call '+st.phone:st.phone; }); }
  }
  Promise.all([api('/config').catch(function(){ return {paymentsEnabled:false,payInStore:true}; }), api('/products')]).then(function(r){
    CFG=r[0]; index(r[1]); applySite(); renderChips(); renderGrid(); renderCart(); fromHash();
  }).catch(function(){
    grid.innerHTML='<p class="shop-msg">The shop could not load right now. Please refresh, or visit Ageless inside Eastland Mall.</p>'; renderCart();
  });
  document.addEventListener('visibilitychange',function(){ if(!document.hidden&&PRODUCTS.length&&co.hidden) refreshCatalog(); });
})();
