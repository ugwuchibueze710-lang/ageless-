(function(){
  var pg=document.getElementById('pg'), t=new URLSearchParams(location.search).get('t');
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(x){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x];}); }
  function money(n){ return '$'+((n||0)/100).toFixed(2); }
  function card(h){ pg.innerHTML='<div class="pg-card">'+h+'</div>'; }
  if(!t){ card('<h1>Link not valid</h1><p class="mut">Use the link from the email Ageless sent you.</p>'); return; }
  function load(){
    fetch('/api/sub/'+encodeURIComponent(t)).then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||'This link is not valid.'); return j; }); }).then(function(s){
      var head='<p class="kicker">Order '+esc(s.order_code)+'</p>';
      if(s.status!=='pending'){ card(head+'<h1>'+(s.status==='approved'?'Replacement approved ✓':s.status==='declined'?'Refund on its way':'This offer is closed')+'</h1><p class="mut">'+
        (s.status==='approved'?'Thanks! We\'ll get your order ready with the replacement.':s.status==='declined'?'You declined the replacement, so that item is refunded to your card. Refunds can take 5–10 business days to show.':'The store withdrew this offer. They will contact you.')+'</p><div class="btns"><a class="btn btn-neon" href="/">Back to the shop</a></div>'); return; }
      card(head+'<h1>An item in your order is unavailable</h1><p class="mut">We\'re sorry — <b>'+esc(s.original.name)+'</b> is no longer available. The store picked a replacement at the <b>same price</b>. Nothing changes unless you approve.</p>'+
        (s.message?'<p style="margin-top:10px">Message from the store: “'+esc(s.message)+'”</p>':'')+
        '<div class="swap"><figure><img src="'+esc(s.original.image_url||'/assets/img/logo-sm.png')+'" alt=""><figcaption>'+esc(s.original.name)+'<br><span class="mut">unavailable</span></figcaption></figure><div class="arrow">→</div>'+
        '<figure><img src="'+esc(s.offered.image_url||'/assets/img/logo-sm.png')+'" alt=""><figcaption><b>'+esc(s.offered.name)+'</b><br><span class="mut">'+s.original.qty+' × '+money(s.offered.unit_cents)+'</span></figcaption></figure></div>'+
        '<div class="btns"><button class="btn btn-neon" id="yes">Yes, send the replacement</button><button class="btn btn-ghost" id="no">No thanks — refund me '+money(s.refund_cents)+'</button></div><p class="co-msg" id="m" role="status"></p>');
      document.getElementById('yes').onclick=function(){ decide('approve',this); };
      document.getElementById('no').onclick=function(){ if(confirm('Decline the replacement and get a refund of '+money(s.refund_cents)+'?')) decide('decline',this); };
    }).catch(function(e){ card('<h1>Link not valid</h1><p class="mut">'+esc(e.message)+'</p>'); });
  }
  function decide(d,b){
    var all=pg.querySelectorAll('button'); [].forEach.call(all,function(x){x.disabled=true;}); b.textContent='Working…';
    fetch('/api/sub/'+encodeURIComponent(t),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:d})})
      .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||'Something went wrong.'); return j; }); })
      .then(load).catch(function(e){ var m=document.getElementById('m'); m.textContent=e.message; m.className='co-msg err'; [].forEach.call(all,function(x){x.disabled=false;}); b.textContent=d==='approve'?'Yes, send the replacement':'Try again'; });
  }
  load();
})();
