(function(){
  var pg=document.getElementById('pg'), q=new URLSearchParams(location.search), c=q.get('c'), t=q.get('t');
  function prettyDay(d){ var t=new Date(d+'T12:00:00Z'); if(isNaN(t)) return d; var L=document.documentElement.lang||'en'; try{ return t.toLocaleDateString(L,{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'}); }catch(e){ return t.toDateString(); } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(x){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x];}); }
  function money(n){ return '$'+((n||0)/100).toFixed(2); }
  var LABEL={pending_payment:['Waiting for payment','warn'],payment_failed:['Payment did not go through','bad'],paid:['Paid — being prepared',''],processing:['Being prepared',''],
    awaiting_approval:['Waiting for your approval','warn'],ready_for_pickup:['Ready for pickup',''],shipped:['Shipped',''],completed:['Completed',''],
    canceled:['Canceled','bad'],refunded:['Refunded','bad'],expired:['Checkout expired','bad']};
  function fail(m){ pg.innerHTML='<div class="pg-card"><h1>Order not found</h1><p class="mut">'+esc(m)+'</p><div class="btns"><a class="btn btn-neon" href="/">Back to the shop</a></div></div>'; }
  if(!c||!t){ fail('Use the link from your confirmation email to see your order.'); return; }
  function load(){
    fetch('/api/orders/'+encodeURIComponent(c)+'?t='+encodeURIComponent(t)).then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||'Order not found.'); return j.order; }); })
    .then(function(o){
      var unpaid=o.pay_at_pickup&&!o.paid_at, open=['processing','ready_for_pickup','awaiting_approval'].indexOf(o.status)>=0;
      var L=unpaid&&o.status==='processing'?['Reserved — pay when you pick up','']:unpaid&&o.status==='ready_for_pickup'?['Ready — pay when you pick up','']:(LABEL[o.status]||[o.status,'']);
      pg.innerHTML='<div class="pg-card">'+
        ((o.paid_at||unpaid)&&o.status!=='canceled'?'<p class="kicker">Thank you, '+esc(o.name.split(' ')[0])+'!</p>':'')+
        '<h1>Order '+esc(o.code)+'</h1><p><span class="pill '+L[1]+'">'+esc(L[0])+'</span></p>'+
        (o.status==='pending_payment'?'<p class="mut" style="margin-top:10px">Your payment is still processing. This page updates by itself.</p>':'')+
        (unpaid&&open?'<p style="margin-top:12px"><b>Pay '+money(o.total_cents)+' when you pick up</b> (cash or card, plus sales tax if any). We\'ll hold your order for '+o.hold_days+' days.</p>':'')+
        (o.ready_text&&open&&o.status!=='ready_for_pickup'&&o.status!=='shipped'?'<p class="mut" style="margin-top:6px">'+esc(o.ready_text)+(o.fulfillment==='shipping'?' We\'ll email you the delivery day when it ships.':' We\'ll email you when it\'s ready.')+'</p>':'')+
        (o.status==='ready_for_pickup'?'<p style="margin-top:12px"><b>Your order is ready — come pick it up at Ageless.</b></p>':'')+
        (o.eta_date&&o.status==='shipped'?'<p style="margin-top:12px;font-size:1.1em">Arriving <b>'+esc(prettyDay(o.eta_date))+'</b></p>'+(o.eta_note?'<p class="mut">'+esc(o.eta_note)+'</p>':''):'')+
        (o.status==='awaiting_approval'?'<p class="mut" style="margin-top:10px">An item was unavailable. Check your email for the replacement offer and approve or decline it.</p>':'')+
        '<h2>'+(o.fulfillment==='shipping'?'Shipping to':'Pickup')+'</h2><p class="mut">'+
        (o.fulfillment==='shipping'?esc(o.address.street)+(o.address.street2?', '+esc(o.address.street2):'')+'<br>'+esc(o.address.city)+', '+esc(o.address.state)+' '+esc(o.address.zip):esc(o.pickup_instructions||'At Ageless inside Eastland Mall.'))+'</p>'+
        (o.tracking_number?'<p>Tracking: <b>'+esc(o.tracking_carrier||'')+' '+esc(o.tracking_number)+'</b></p>':'')+
        '<h2>Items</h2><div class="o-items">'+o.items.map(function(i){ return '<div class="li"><img src="'+esc(i.image_url||'/assets/img/logo-sm.png')+'" alt=""><div><div class="li-name">'+esc(i.name)+(i.variation_name&&i.variation_name!=='Regular'?' <small>· '+esc(i.variation_name)+'</small>':'')+'</div>'+
          '<div class="li-price">'+i.qty+' × '+(i.list_cents?'<s>'+money(i.list_cents)+'</s> ':'')+money(i.unit_cents)+(i.original_name?' · replaces '+esc(i.original_name):'')+(i.status==='refunded'?' · refunded':'')+'</div></div><div class="li-tot">'+money(i.unit_cents*i.qty)+'</div></div>'; }).join('')+'</div>'+
        '<div class="sum" style="margin-top:10px"><div class="dr-total sm"><span>Subtotal</span><b>'+money(o.subtotal_cents)+'</b></div><div class="dr-total sm"><span>Shipping</span><b>'+(o.shipping_cents?money(o.shipping_cents):'Free')+'</b></div>'+
        (o.discount_cents?'<div class="dr-total sm save"><span>You saved</span><b>'+money(o.discount_cents)+'</b></div>':'')+
        (unpaid?'':'<div class="dr-total sm"><span>Tax</span><b>'+money(o.tax_cents)+'</b></div>')+'<div class="dr-total"><span>'+(unpaid?'Due at pickup':'Total')+'</span><b>'+money(o.total_cents)+'</b></div>'+
        (o.refunded_cents?'<div class="dr-total sm"><span>Refunded</span><b>−'+money(o.refunded_cents)+'</b></div>':'')+(o.card?'<p class="fine">Paid with '+esc(o.card)+'</p>':'')+'</div>'+
        '<p class="mut" style="margin-top:16px">Questions? Call Ageless at <a href="tel:+13175992537">(317) 599-2537</a> and mention order '+esc(o.code)+'.</p>'+
        '<div class="btns"><a class="btn btn-neon" href="/#shop">Keep shopping</a></div></div>';
      if(o.status==='pending_payment') setTimeout(load,5000);
    }).catch(function(e){ fail(e.message); });
  }
  load();
})();
