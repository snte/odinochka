window.onload = function () {
  document.getElementById('bt-sidebar-open').onclick = sidebarOpen;
  document.getElementById('bt-sidebar-close').onclick = sidebarClose;
};

function sidebarOpen() {
  document.getElementById('sidebar').style.width = '300px';
  document.getElementById('main').style.marginLeft = '300px';
  document.getElementById('main').style.marginRight = '-300px';
  document.body.classList.add('sidebar-left');
}

function sidebarClose() {
  document.getElementById('sidebar').style.width = '0';
  document.getElementById('main').style.marginLeft = '0';
  document.getElementById('main').style.marginRight = '0';
  document.body.classList.remove('sidebar-left');
}
