(function(){
  var pg=document.getElementById('pg'), q=new URLSearchParams(location.search), c=q.get('c'), t=q.get('t');
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
      var L=LABEL[o.status]||[o.status,''];
      pg.innerHTML='<div class="pg-card">'+
        (o.paid_at?'<p class="kicker">Thank you, '+esc(o.name.split(' ')[0])+'!</p>':'')+
        '<h1>Order '+esc(o.code)+'</h1><p><span class="pill '+L[1]+'">'+esc(L[0])+'</span></p>'+
        (o.status==='pending_payment'?'<p class="mut" style="margin-top:10px">Your payment is still processing. This page updates by itself.</p>':'')+
        (o.status==='awaiting_approval'?'<p class="mut" style="margin-top:10px">An item was unavailable. Check your email for the replacement offer and approve or decline it.</p>':'')+
        '<h2>'+(o.fulfillment==='shipping'?'Shipping to':'Pickup')+'</h2><p class="mut">'+
        (o.fulfillment==='shipping'?esc(o.address.street)+(o.address.street2?', '+esc(o.address.street2):'')+'<br>'+esc(o.address.city)+', '+esc(o.address.state)+' '+esc(o.address.zip):esc(o.pickup_instructions||'At Ageless inside Eastland Mall.'))+'</p>'+
        (o.tracking_number?'<p>Tracking: <b>'+esc(o.tracking_carrier||'')+' '+esc(o.tracking_number)+'</b></p>':'')+
        '<h2>Items</h2><div class="o-items">'+o.items.map(function(i){ return '<div class="li"><img src="'+esc(i.image_url||'/assets/img/logo-sm.png')+'" alt=""><div><div class="li-name">'+esc(i.name)+(i.variation_name&&i.variation_name!=='Regular'?' <small>· '+esc(i.variation_name)+'</small>':'')+'</div>'+
          '<div class="li-price">'+i.qty+' × '+money(i.unit_cents)+(i.original_name?' · replaces '+esc(i.original_name):'')+(i.status==='refunded'?' · refunded':'')+'</div></div><div class="li-tot">'+money(i.unit_cents*i.qty)+'</div></div>'; }).join('')+'</div>'+
        '<div class="sum" style="margin-top:10px"><div class="dr-total sm"><span>Subtotal</span><b>'+money(o.subtotal_cents)+'</b></div><div class="dr-total sm"><span>Shipping</span><b>'+(o.shipping_cents?money(o.shipping_cents):'Free')+'</b></div>'+
        '<div class="dr-total sm"><span>Tax</span><b>'+money(o.tax_cents)+'</b></div><div class="dr-total"><span>Total</span><b>'+money(o.total_cents)+'</b></div>'+
        (o.refunded_cents?'<div class="dr-total sm"><span>Refunded</span><b>−'+money(o.refunded_cents)+'</b></div>':'')+(o.card?'<p class="fine">Paid with '+esc(o.card)+'</p>':'')+'</div>'+
        '<p class="mut" style="margin-top:16px">Questions? Call Ageless at <a href="tel:+13175992537">(317) 599-2537</a> and mention order '+esc(o.code)+'.</p>'+
        '<div class="btns"><a class="btn btn-neon" href="/#shop">Keep shopping</a></div></div>';
      if(o.status==='pending_payment') setTimeout(load,5000);
    }).catch(function(e){ fail(e.message); });
  }
  load();
})();
