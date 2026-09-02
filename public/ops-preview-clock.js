// Cosmetic live clock for the ops preview pages — gives the "command
// center" feel. No-op if the bar isn't present on a page.
(function () {
  var clk = document.getElementById('clk');
  var dte = document.getElementById('dte');
  if (!clk) return;
  var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var mon = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  function tick() {
    var n = new Date();
    var hh = String(n.getHours()).padStart(2, '0');
    var mm = String(n.getMinutes()).padStart(2, '0');
    clk.textContent = hh + ':' + mm;
    if (dte) dte.textContent = days[n.getDay()] + ' ' + n.getDate() + ' ' +
      mon[n.getMonth()] + ' ' + n.getFullYear();
  }
  tick();
  setInterval(tick, 15000);
})();
