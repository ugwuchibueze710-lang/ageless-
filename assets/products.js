// Ageless product list — photos are cut from the store's own shelf photos.
// confirmed:true  = price read from the store's own shelf tag / window sign.
// confirmed:false = placeholder price, to be confirmed by the owner.
window.PRODUCTS = [
  { id:'ear-hat',       name:'Light-Up Ear Hat',        cat:'hats',        price:19.99, img:'ear-hat.jpg',       confirmed:true,  note:'Plush hat with flapping ears that light up' },
  { id:'lavender-bear', name:'Lavender Bear Plush',     cat:'plush',       price:25.00, img:'lavender-bear.jpg', confirmed:true,  note:'Big, soft & cuddly' },
  { id:'blue-plush',    name:'Blue Alien Plush',        cat:'plush',       price:20.00, img:'blue-plush.jpg',    confirmed:true,  note:'Fan-favorite blue buddy' },
  { id:'yellow-duck',   name:'Yellow Duck Plush',       cat:'plush',       price:19.99, img:'yellow-duck.jpg',   confirmed:true,  note:'Soft, squishy, adorable' },
  { id:'mini-plush',    name:'Mini Plush',              cat:'plush',       price:15.00, img:'mini-plush.jpg',    confirmed:true,  note:'From the $15 plush bins' },
  { id:'rainbow-plush', name:'Rainbow Alien Plush',     cat:'plush',       price:20.00, img:'rainbow-plush.jpg', confirmed:false, note:'Tie-dye rainbow colors' },
  { id:'spooky-bunny',  name:'Spooky Bunny Plush',      cat:'plush',       price:25.00, img:'spooky-bunny.jpg',  confirmed:false, note:'Pastel goth cuteness' },
  { id:'figures',       name:'Boxed Anime Figure',      cat:'figures',     price:49.99, img:'figures.jpg',       confirmed:false, note:'Collector figures — ask for characters in stock' },
  { id:'keychains',     name:'Anime Keychain',          cat:'accessories', price:10.00, img:'keychains.jpg',     confirmed:false, note:'Rubber keychains — dozens of characters' },
  { id:'shoe-charms',   name:'Shoe Charm',              cat:'accessories', price:3.00,  img:'shoe-charms.jpg',   confirmed:false, note:'Pick from hundreds in the charm bins' },
  { id:'paw-squishy',   name:'Cat Paw Squishy',         cat:'accessories', price:9.99,  img:'paw-squishy.jpg',   confirmed:false, note:'Squishy paw stress toy' }
];
window.CATS = [
  { id:'all', name:'All' }, { id:'plush', name:'Plush' }, { id:'hats', name:'Ear Hats' },
  { id:'figures', name:'Figures' }, { id:'accessories', name:'Keychains & Charms' }
];
