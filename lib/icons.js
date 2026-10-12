// Small inline line-icon set used across the marketplace UI.
// icon('search') returns an <svg> string; categoryIcon(name) picks an icon
// that fits a category name (falls back to a generic tag icon).

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 11.5a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>',
  store: '<path d="M4 9 5.5 4h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/><path d="M5 12v8h14v-8"/><path d="M10 20v-5h4v5"/>',
  food: '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M2 16h20"/><path d="M12 8V6"/><path d="M10 6h4"/><path d="M4 20h16"/>',
  decor: '<circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="5.6" r="2.6"/><circle cx="12" cy="18.4" r="2.6"/><circle cx="5.6" cy="12" r="2.6"/><circle cx="18.4" cy="12" r="2.6"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9"/><path d="M12 8v13"/><path d="M12 8c-1.5-4-5.500-3.500-4.500-1s3 1 4.500 1Z"/><path d="M12 8c1.500-4 5.500-3.500 4.500-1s-3 1-4.500 1Z"/>',
  print: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8L3 12Z"/><circle cx="7.500" cy="8.500" r="1.200"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.400 3.600-7 8-7s8 2.600 8 7"/>'
};

function icon(name, className){
  const body = PATHS[name] || PATHS.tag;
  const cls = 'icon' + (className ? ' ' + className : '');
  return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}

function categoryIcon(name){
  const n = String(name || '').toLowerCase();
  if(/cater|snack|food|kue|makan|prasmanan/.test(n)) return icon('food');
  if(/decor|dekor|flower|bunga/.test(n)) return icon('decor');
  if(/souvenir|gift|hampers/.test(n)) return icon('gift');
  if(/print|invit|undang/.test(n)) return icon('print');
  if(/photo|video|foto/.test(n)) return icon('camera');
  return icon('tag');
}

module.exports = { icon, categoryIcon };
