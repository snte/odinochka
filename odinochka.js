document.addEventListener('DOMContentLoaded', function () {
  init();
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.tabs) update(request);
  sendResponse();
  return true;
});

function init() {
  attachUrlListObserver();
  render();
  initOptions();
  initNav();
  initAccordion('#groups', false); // activate accordion (false: multiple open, true: single open)
  closeOthers();
}

function attachUrlListObserver() {
  let groups = document.getElementById('groups');
  let RSEP = '\036';

  let observer = new MutationObserver((ml, obs) => {
    let toSkip = new Set();
    for (let mut of ml) {
      if (mut.target.id == 'groups') {
        mut.removedNodes.forEach((x) => toSkip.add(x));
      }
    }

    for (let mut of ml) {
      if (mut.target.id == 'groups') {
        for (let grp of mut.addedNodes) {
          grp.setAttribute(
            'data-urls',
            RSEP +
              Array.from(grp.getElementsByTagName('A'))
                .map((x) => x.href)
                .join(RSEP) +
              RSEP
          );
        }
      } else if (mut.target.className == 'group' && !toSkip.has(mut.target)) {
        let bf = mut.target.getAttribute('data-urls');
        mut.removedNodes.forEach(
          (x) => (bf = bf.replace(RSEP + x.href + RSEP, RSEP))
        );
        mut.addedNodes.forEach((x) => (bf += RSEP + x.href + RSEP));
        mut.target.setAttribute('data-urls', bf);
      }
    }
  });

  observer.observe(groups, {childList: true, subtree: true});
}

// Tabs and Windows

function newWindow(data) {
  chrome.windows.create({url: data.urls}, function (w) {
    w.tabs
      .filter((t, i) => data.tabs[i].pinned)
      .forEach((t) => chrome.tabs.update(t.id, {pinned: true}));
  });
}

function newTabs(data) {
  data.tabs.forEach((o) => chrome.tabs.create({url: o.url, pinned: o.pinned}));
}

function closeOthers() {
  chrome.tabs.getCurrent((current) =>
    chrome.tabs.query({url: 'chrome-extension://*/odinochka.html'}, (tabs) =>
      chrome.tabs.remove(tabs.map((t) => t.id).filter((t) => t != current.id))
    )
  );
}

// Render Functions

function render() {
  // Building tab list
  let groupdiv = document.getElementById('groups');
  groupdiv.innerHTML = '';

  groupdiv.addEventListener('click', divClickHandler);
  groupdiv.addEventListener('dragstart', divClickHandler);
  groupdiv.addEventListener('dragend', divClickHandler);
  groupdiv.addEventListener('dragenter', divClickHandler);
  groupdiv.addEventListener('dragover', divClickHandler);
  groupdiv.addEventListener('dragleave', divClickHandler);
  groupdiv.addEventListener('drop', divClickHandler);
  groupdiv.addEventListener('blur', divClickHandler, true); // onblur won't trigger, but can capture?

  window.indexedDB.open('odinochka', 5).onsuccess = function (e) {
    let db = e.target.result;
    let tx = db.transaction('tabgroups', 'readonly');
    let store = tx.objectStore('tabgroups');

    updateCount(store);

    store.openCursor(null, 'prev').onsuccess = function (e) {
      let cursor = e.target.result;
      if (cursor) {
        cursor.continue();
        groupdiv.appendChild(renderGroup(cursor.value));
      }
    };
  };
}

function renderHeader(data, header = null) {
  header = header || document.createElement('header');
  header.textContent = '';

  // add title
  let title = document.createElement('h2');
  title.className = 'title';
  title.textContent = `${data.name}`;
  title.contentEditable = false;
  header.append(title);

  header.className = 'tab';
  header.draggable = true;
  header.setAttribute('tabindex', '0');

  // add buttons
  const buttons = [
    'open-group-tabs',
    'open-group-window',
    'open-group-list',
    'star-group',
    'del-group'
  ];
  buttons.forEach(function (button) {
    let bt = document.createElement('button');
    bt.className = button;
    header.append(bt);
  });

  let date = document.createElement('span');
  date.className = 'info';
  date.textContent = `${fmtDate(data.ts)}`;
  header.append(date);

  return header;
}

function renderTab(tab, a = null) {
  a = a || document.createElement('a');
  a.textContent = tab.title;
  a.href = tab.url;
  if (tab.favicon) {
    a.style.setProperty('--bg-favicon', `url("${tab.favicon}")`);
  }
  a.className = 'tab';
  a.target = tab.pinned ? '_pinned' : '_blank';
  a.draggable = true;

  // add button
  let bt1 = document.createElement('button');
  bt1.className = 'del-tab';
  a.append(bt1);

  return a;
}

function renderGroup(data, ddiv = null) {
  ddiv = ddiv || document.createElement('div');
  ddiv.id = data.ts;
  ddiv.setAttribute('data-name', data.name);
  ddiv.innerHTML = '';
  ddiv.className = 'group';
  if (data.collapsed == 0) ddiv.classList.add('active');
  if (data.star == 1) ddiv.classList.add('star');

  ddiv.append(renderHeader(data), ...data.tabs.map((x) => renderTab(x)));

  return ddiv;
}

// Update

function update(data) {
  let groupdiv = document.getElementById('groups');
  let child = groupdiv.children.length ? groupdiv.children[0] : null;

  if (child && data.ts == child.id) {
    groupdiv.replaceChild(renderGroup(data), child);
  } else {
    // if child is null, then append
    groupdiv.insertBefore(renderGroup(data), child);
  }

  for (let i in data.update) {
    let node = document.getElementById(i);
    if (!node) continue;
    if (data.update[i] == 'd') {
      node.remove();
    } else {
      groupdiv.replaceChild(renderGroup(data.update[i]), node);
    }
  }

  window.indexedDB.open('odinochka', 5).onsuccess = function (e) {
    let db = e.target.result;
    let tx = db.transaction('tabgroups', 'readonly');
    let store = tx.objectStore('tabgroups');

    updateCount(store);
  };
}

function updateCount(store) {
  store.index('urls').count().onsuccess = function (e) {
    document.getElementById('size').textContent = e.target.result + ' tabs';
  };
}

function removeAndUpdateCount(request, me) {
  request.onsuccess = function (e) {
    me.remove();
    updateCount(request.source);
  };
}

// Eventhandler

function divClickHandler(e) {
  var target = e.target;
  if (!target) return true;

  if (target.tagName == 'BUTTON' && e.type == 'click') {
    switch (target.className) {
      case 'del-tab':
        tabDelete(e);
        e.preventDefault();
        return false;
      case 'del-group':
        groupDelete(e);
        return false;
      case 'open-group-tabs':
        groupOpenTabs(e);
        return false;
      case 'open-group-window':
        groupOpenWindow(e);
        return false;
      case 'open-group-list':
        groupOpenList(e);
        return false;
      case 'star-group':
        groupStar(e);
        return false;
    }
  } else if (target.classList.contains('title')) {
    switch (e.type) {
      case 'click':
        groupEdit(e);
        return false;
      case 'blur':
        groupBlur(e);
    }
  } else if (target.classList.contains('tab')) {
    const groups = document.getElementById('groups');

    switch (e.type) {
      case 'click':
        return target.tagName != 'A' || tabClick(e);

      // Draggable element
      case 'dragstart':
        target.id = 'drag';
        groups.dataset.drag = target.tagName;
        return true;
      case 'dragend':
        target.id = '';
        groups.dataset.drag = '';
        return true;
    }

    // Disable 'A' drop targets when dragging 'HEADER'
    if (
      groups.dataset.drag == 'A' ||
      (groups.dataset.drag == 'HEADER' && target.tagName == 'HEADER')
    ) {
      switch (e.type) {
        // Drop target
        case 'dragenter':
          e.preventDefault();
          target.classList.add('drag-over');
          return true;
        case 'dragover':
          e.preventDefault();
          target.classList.add('drag-over');
          return true;
        case 'dragleave':
          target.classList.remove('drag-over');
          return true;
        case 'drop':
          target.classList.remove('drag-over');
          return drop(e);
      }
    }
  }
  //console.log(e); // should be impossible
  return true;
}

// Sorting

function groupSortAbc() {
  var groups = document.querySelectorAll('.group');

  /*
  [].slice.call(groups).sort(function(a, b) {
      var textA = a.getAttribute('data-name').toLowerCase()
      var textB = b.getAttribute('data-name').toLowerCase()
      return (textA < textB) ? -1 : (textA > textB) ? 1 : 0;
  })
    .forEach(function(el) {el.parentNode.appendChild(el)});
  */

  Array.from(groups).sort((a, b) =>
    a.dataset.name.toLowerCase().localeCompare(b.dataset.name.toLowerCase())
  )
    .forEach(el => el.parentNode.appendChild(el));

}
function groupSortId() {
  var groups = document.querySelectorAll('.group');

  Array.from(groups).sort((a, b) =>
    a.id.localeCompare(b.id)
  )
    .forEach(el => el.parentNode.appendChild(el));

}

// Tab Events

function tabClick(e) {
  let me = e.target;
  let ts = parseInt(me.parentNode.id);
  let restore = document.forms['options'].elements['restore'].value;
  let locked = me.parentNode.children[0].textContent.indexOf('lock') > 0;
  let i = Array.from(me.parentNode.children).indexOf(me) - 1;

  if (e.shiftKey || e.ctrlKey || locked || restore == 'keep') {
    return true;
  }

  chrome.tabs.create({url: me.href, pinned: me.target == '_pinned'}, (t) =>
    deleteTabFromGroup(ts, i, me)
  );
  return false;
}

function tabDelete(e) {
  let me = e.target.parentNode;
  let ts = parseInt(me.parentNode.id);
  let i = Array.from(me.parentNode.children).indexOf(me) - 1;
  deleteTabFromGroup(ts, i, me);
  return false;
}

// Group Events

function groupEdit(e) {
  let me = e.target;
  let shiftclick = e.shiftKey;

  if (!shiftclick) {
    if (me.contentEditable == 'false') {
      me.oldText = me.textContent;
      me.contentEditable = 'true';
      me.focus();
      me.onkeydown = blurOnEnterKey;
    }
    return;
  }
}

function blurOnEnterKey(e) {
  if (!e) {
    e = window.event;
  }
  var keyCode = e.which || e.keyCode,
    target = e.target || e.srcElement;
  if (keyCode === 13) {
    if (e.preventDefault) {
      e.preventDefault();
    } else {
      e.returnValue = false;
    }
    target.blur();
  }
}

function groupBlur(e) {
  var me = e.target;
  var ts = parseInt(me.parentNode.parentNode.id);

  if (me.contentEditable != 'true') {
    return;
  }
  me.contentEditable = 'false';

  var newtxt = me.textContent;
  var oldtxt = me.oldText;
  if (newtxt == oldtxt) return;

  me.parentNode.parentNode.setAttribute('data-name', newtxt);

  window.indexedDB.open('odinochka', 5).onsuccess = function (e) {
    var db = e.target.result;
    var tx = db.transaction('tabgroups', 'readwrite');
    var store = tx.objectStore('tabgroups');

    store.get(ts).onsuccess = function (e) {
      var data = e.target.result;
      data.name = newtxt;
      store.put(data).onsuccess = (e) => renderHeader(data, me.parentNode);
    };
  };
}

function groupDelete(e) {
  let me = e.target.parentNode;
  let ts = parseInt(me.parentNode.id);
  let shiftclick = e.shiftKey;

  if (!shiftclick) {
    // if not shift, then was x
    if (!confirm('Delete this group?')) return;
  }

  // delete it
  window.indexedDB.open('odinochka', 5).onsuccess = function (e) {
    let db = e.target.result;
    let tx = db.transaction('tabgroups', 'readwrite');
    let store = tx.objectStore('tabgroups');

    if (!shiftclick) {
      // if not shift, then was x
      removeAndUpdateCount(store.delete(ts), me.parentNode);
      return;
    }

    store.get(ts).onsuccess = function (e) {
      var data = e.target.result;

      // smart selection
      var group = document.forms['options'].elements['group'].value;
      let restore = document.forms['options'].elements['restore'].value;
      let locked = data.name.indexOf('lock') > -1;

      if (group == 'new') {
        newWindow(data);
      } else if (group == 'current') {
        newTabs(data);
      } else if (group == 'smart') {
        chrome.tabs.query(
          {windowId: chrome.windows.WINDOW_ID_CURRENT, pinned: false},
          (w) => (w.length <= 1 ? newTabs(data) : newWindow(data))
        );
      }

      // clean up
      if (!locked && restore != 'keep') {
        removeAndUpdateCount(store.delete(ts), me.parentNode);
      }
    };
  };
}

function groupOpenList(e) {
  let me = e.target.parentNode;

  var title = me.parentNode.querySelector('.title').innerHTML;
  var regx =
    /draggable="true"|class="tab"|target="_blank"|style="[^"]*"|tabindex="[^"]*"|contenteditable="[^"]*"|<\s*button[^>]*>(.*?)<\s*\/\s*button>/g;
  var code = me.parentNode.innerHTML.replace(regx, '');

  chrome.tabs.create({
    url:
      'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        `<html><head><title>${title}</title><style>body{font-family:-apple-system,sans-serif;padding:1rem} a,.title,.info{display:block} .title{font-size:2rem;margin:0} header{margin-bottom:1rem}</style></head><body>` +
          code +
          '</body></html>'
      )
  });
  return false;
}

function groupOpenTabs(e) {
  groupOpen(e, false);
}
function groupOpenWindow(e) {
  groupOpen(e, true);
}

function groupOpen(e, openwindow) {
  let me = e.target.parentNode;
  let ts = parseInt(me.parentNode.id);

  window.indexedDB.open('odinochka', 5).onsuccess = function (e) {
    let db = e.target.result;
    let tx = db.transaction('tabgroups', 'readwrite');
    let store = tx.objectStore('tabgroups');

    store.get(ts).onsuccess = function (e) {
      var data = e.target.result;
      if (openwindow) {
        newWindow(data);
      } else {
        newTabs(data);
      }
    };
  };
}

function groupStar(e) {
  let me = e.target.parentNode;
  let ts = parseInt(me.parentNode.id);

  if (me.parentNode.classList.contains('star')) {
    setGroupStar(ts, 0);
    me.parentNode.classList.remove('star');
  } else {
    setGroupStar(ts, 1);
    me.parentNode.classList.add('star');
  }
}

// Group Functions

function deleteTabFromGroup(ts, i, node) {
  // Removes target from DB object
  window.indexedDB.open('odinochka', 5).onsuccess = function (e) {
    let db = e.target.result;
    let tx = db.transaction('tabgroups', 'readwrite');
    let store = tx.objectStore('tabgroups');

    if (i == 0 && node.nextSibling == null) {
      removeAndUpdateCount(store.delete(ts), node.parentNode);
    } else {
      store.get(ts).onsuccess = function (e) {
        let data = e.target.result;

        data.tabs.splice(i, 1);
        data.urls.splice(i, 1);

        removeAndUpdateCount(store.put(data), node);
      };
    }
  };
}

function setGroupCollapse(ts, collapsed) {
  // Set group collapse in DB object
  window.indexedDB.open('odinochka', 5).onsuccess = function (e) {
    var db = e.target.result;
    var tx = db.transaction('tabgroups', 'readwrite');
    var store = tx.objectStore('tabgroups');

    store.get(ts).onsuccess = function (e) {
      var data = e.target.result;
      data.collapsed = collapsed;
      store.put(data);
    };
  };
}

function setGroupCollapseAll(collapsed) {
  var elementList = document.querySelectorAll('#groups .group');
  Array.prototype.forEach.call(elementList, function (e) {
    if (collapsed == 1) {
      e.classList.remove('active');
    } else {
      e.classList.add('active');
    }
    setGroupCollapse(parseInt(e.id), collapsed);
  });
}

function groupCollapseAll() {
  setGroupCollapseAll(1);
}
function groupExpandAll() {
  setGroupCollapseAll(0);
}

function setGroupStar(ts, starred) {
  // Set group starred in DB object
  window.indexedDB.open('odinochka', 5).onsuccess = function (e) {
    var db = e.target.result;
    var tx = db.transaction('tabgroups', 'readwrite');
    var store = tx.objectStore('tabgroups');

    store.get(ts).onsuccess = function (e) {
      var data = e.target.result;
      data.star = starred;
      store.put(data);
    };
  };
}

// Drag and Drop

function drop(e) {
  e.preventDefault();

  if (e.target.id == 'drag') return; // dropped on itself

  let src = ddextract(document.getElementById('drag'));
  let tgt = ddextract(e.target);

  if (src.group && !tgt.group) return; // appending group to link makes no sense.

  let moveNode = function () {
    tgt.parentNode.insertBefore(src.node, tgt.node.nextSibling);
  };

  window.indexedDB.open('odinochka', 5).onsuccess = function (e) {
    let db = e.target.result;
    let tx = db.transaction('tabgroups', 'readwrite');
    let store = tx.objectStore('tabgroups');

    store.get(tgt.id).onsuccess = function (e2) {
      let tdata = e2.target.result;

      // Same group drag and drop
      if (tgt.id == src.id) {
        tdata.tabs.splice(tgt.index + 1, 0, tdata.tabs[src.index]);
        tdata.tabs.splice(src.index + (src.index > tgt.index), 1);
        tdata.urls = tdata.tabs.map((t) => t.url);

        store.put(tdata).onsuccess = moveNode;
        return;
      }
      // Cross group drag and drop
      else {
        store.get(src.id).onsuccess = function (e3) {
          let sdata = e3.target.result;
          let callback;

          // Source and target are groups
          if (src.group && tgt.group) {
            // insert source tabs before target tabs
            tdata.tabs = sdata.tabs.concat(tdata.tabs);
            sdata.tabs = [];
            callback = function () {
              let toAppend = [];
              let snode = src.node;
              while (snode.nextSibling) {
                toAppend.push(snode.nextSibling);
                snode = snode.nextSibling;
              }
              src.parentNode.innerHTML = ''; //append below triggers N mutationEvents on src, but one on tgt
              // insert tabs after Header
              tgt.parentNode.firstChild.after(...toAppend);
            };
          } else {
            tdata.tabs.splice(tgt.index + 1, 0, sdata.tabs[src.index]);
            sdata.tabs.splice(src.index, 1);
            callback = moveNode;
          }

          tdata.urls = tdata.tabs.map((t) => t.url);
          sdata.urls = sdata.tabs.map((t) => t.url);

          let req = store.put(tdata);
          if (sdata.tabs.length > 0) {
            req.onsuccess = function (e) {
              store.put(sdata).onsuccess = callback;
            };
          } else {
            req.onsuccess = function (e) {
              store.delete(sdata.ts).onsuccess = function (e) {
                let oldParent = src.parentNode;
                callback();
                oldParent.remove();
              };
            };
          }
        };
      }
    };
  };
}

function ddextract(node) {
  return {
    node: node,
    parentNode: node.parentNode,
    id: parseInt(node.parentNode.id),
    index: Array.from(node.parentNode.children).indexOf(node) - 1, // -1 to adjust for header tag
    group: node.tagName == 'HEADER'
  };
}

// Navbar

function initNav() {
  document.getElementById('group-collapse-all').onclick = groupCollapseAll;
  document.getElementById('group-expand-all').onclick = groupExpandAll;
  document.getElementById('group-sort-abc').onclick = groupSortAbc;
  document.getElementById('group-sort-id').onclick = groupSortId;
}

// Collapse
// https://jsfiddle.net/zmirko/oaqprbLh
function initAccordion(elem, option) {
  document.addEventListener('click', function (e) {
    if (!e.target.matches(elem + ' header.tab')) return;
    else {
      if (!e.target.parentElement.classList.contains('active')) {
        if (option == true) {
          var elementList = document.querySelectorAll(elem + ' .group');
          Array.prototype.forEach.call(elementList, function (e) {
            e.classList.remove('active');
          });
        }
        e.target.parentElement.classList.add('active');
        setGroupCollapse(parseInt(e.target.parentElement.id), 0);
      } else {
        e.target.parentElement.classList.remove('active');
        setGroupCollapse(parseInt(e.target.parentElement.id), 1);
      }
    }
  });
}

// Filter

function cssFilter(x) {
  let node = document.getElementById('cssfilterstyle');
  let newfiltertxt = x.target.value;
  if (newfiltertxt == '') {
    node.innerHTML = '';
  } else {
    selector = `a.tab:not([href*="${newfiltertxt}"])`;
    selector2 = `div.group:not([data-urls*="${newfiltertxt}"])`;
    node.innerHTML = `${selector}, ${selector2} {display:none}`;
  }
}

// Options

function initOptions() {
  let DEFAULT_OPTIONS = {
    dupe: 'keep',
    restore: 'remove',
    group: 'smart',
    pinned: 'skip',
    favicon: 'show',
    order: 'desc',
    grabfocus: 'always',
    advanced: ''
  };

  chrome.storage.local.get(DEFAULT_OPTIONS, function (o) {
    for (let i in o) {
      if (i == 'advanced') {
        document.forms['options'].elements[i].value = o[i];
        continue;
      }
      document.forms['options'].elements[i].forEach(
        (e) => (e.checked = e.value == o[i])
      );
    }
    if (o.favicon == 'show')
      document.getElementById('faviconstyle').media = 'all'; //set initial state
    if (o.order == 'asc') document.getElementById('orderstyle').media = 'all'; //set initial state
  });

  document.forms['options'].onchange = function (e) {
    let o = {};
    o[e.target.name] = e.target.value;
    chrome.storage.local.set(o);
  };

  document.getElementById('filter').oninput = debounce(cssFilter, 50);

  handle_sty = function (e) {
    document.getElementById(this.name + 'style').media = this.dataset.media;
  };
  document
    .querySelectorAll('[name=favicon], [name=order]')
    .forEach((e) => (e.onchange = handle_sty));

  // Import / Export feature
  document.getElementById('importfile').onchange = function () {
    this.setAttribute('value', this.value);
  };
  document.getElementById('import').onclick = doImport;
  document.getElementById('export').onclick = doExport;
}

function debounce(func, wait, immediate) {
  let timeout;
  return function (e) {
    const context = e,
      args = arguments;
    const later = () => {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}

// Import & Export

function doImport() {
  const selectedFile =
    document.forms['options'].elements['importfile'].files[0];

  let reader = new FileReader();

  reader.onload = function (e) {
    let tabs = JSON.parse(e.target.result);

    window.indexedDB.open('odinochka', 5).onsuccess = function (e) {
      let db = e.target.result;
      let tx = db.transaction('tabgroups', 'readwrite');
      let store = tx.objectStore('tabgroups');

      let saveNext = function () {
        if (tabs.length) {
          store.put(tabs.pop()).onsuccess = saveNext;
        } else {
          render();
        }
      };
      saveNext();
    };
  };
  reader.readAsText(selectedFile);

  return false;
}

function doExport() {
  let result = [];
  window.indexedDB.open('odinochka', 5).onsuccess = function (e) {
    let db = e.target.result;
    let tx = db.transaction('tabgroups', 'readonly');
    let store = tx.objectStore('tabgroups');

    updateCount(store);

    store.openCursor(null, 'prev').onsuccess = function (e) {
      let cursor = e.target.result;
      if (cursor) {
        result.push(cursor.value);
        cursor.continue();
      } else {
        // snippet by elite, https://stackoverflow.com/a/45831357
        let filename = 'odinochka.json';
        let blob = new Blob([JSON.stringify(result)], {type: 'text/plain'});
        let e = document.createEvent('MouseEvents'),
          a = document.createElement('a');
        a.download = filename;
        a.href = window.URL.createObjectURL(blob);
        a.dataset.downloadurl = ['text/plain', a.download, a.href].join(':');
        e.initEvent(
          'click',
          true,
          false,
          window,
          0,
          0,
          0,
          0,
          0,
          false,
          false,
          false,
          false,
          0,
          null
        );
        a.dispatchEvent(e);
      }
    };
  };
  return false;
}

// Helper

function fmtDate(ts) {
  let fmt = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  };
  let d = new Date();
  let thisYear = d.getYear();
  d.setTime(ts);
  if (d.getYear() != thisYear) fmt.year = 'numeric';
  return d.toLocaleString(undefined, fmt); //undefined uses browser default
}
