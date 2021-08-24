attachUrlListSycher();
render();
initOptions();
initNav();
initAccordion('#groups', false); // activate accordion (false: multiple open, true: single open)
closeOthers();

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.tabs) update(request);
  sendResponse();
  return true;
});

function attachUrlListSycher() {
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

function renderHeader(data, header = null) {
  header = header || document.createElement('header');
  header.textContent = '';

  // add title
  let title = document.createElement('span');
  title.className = 'title';
  title.textContent = `${data.name}`;
  title.contentEditable = false;
  header.append(title);

  header.className = 'tab';
  header.draggable = true;
  header.setAttribute('tabindex', '0');

  // add buttons
  let bt1 = document.createElement('span');
  bt1.className = 'bt-del-group';
  header.append(bt1);

  let bt2 = document.createElement('span');
  bt2.className = 'bt-open-group';
  header.append(bt2);

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
  let bt1 = document.createElement('span');
  bt1.className = 'bt-del-tab';
  a.append(bt1);

  return a;
}

function renderGroup(data, ddiv = null) {
  ddiv = ddiv || document.createElement('div');
  ddiv.id = data.ts;
  ddiv.innerHTML = '';

  if (data.collapsed == 0) {
    ddiv.className = 'group active';
  } else {
    ddiv.className = 'group';
  }

  ddiv.append(renderHeader(data), ...data.tabs.map((x) => renderTab(x)));

  return ddiv;
}

function render() {
  // Building tab list
  let groupdiv = document.getElementById('groups');
  groupdiv.innerHTML = '';
  for (var ev of [
    'click',
    'dblclick',
    'dragstart',
    'dragend',
    'dragover',
    'drop'
  ])
    groupdiv['on' + ev] = divclickhandler;
  groupdiv.addEventListener('blur', divclickhandler, true); // onblur won't trigger, but can capture?

  window.indexedDB.open('odinochka', 5).onsuccess = function (event) {
    let db = event.target.result;
    let tx = db.transaction('tabgroups', 'readonly');
    let store = tx.objectStore('tabgroups');

    updateCount(store);

    store.openCursor(null, 'prev').onsuccess = function (event) {
      let cursor = event.target.result;
      if (cursor) {
        cursor.continue();
        groupdiv.appendChild(renderGroup(cursor.value));
      }
    };
  };
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

  window.indexedDB.open('odinochka', 5).onsuccess = function (event) {
    let db = event.target.result;
    let tx = db.transaction('tabgroups', 'readonly');
    let store = tx.objectStore('tabgroups');

    updateCount(store);
  };
}

// UI

function updateCount(store) {
  store.index('urls').count().onsuccess = function (e) {
    document.getElementById('size').textContent = e.target.result + ' tabs';
  };
}

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

// Group Events

function groupEdit(event) {
  let me = event.target;
  let shiftclick = event.shiftKey;

  if (!shiftclick) {
    if (me.contentEditable == 'false') {
      me.oldText = me.textContent;
      me.contentEditable = 'true';
      me.focus();
    }
    return;
  }
}

function groupBlur(event) {
  var me = event.target;
  var ts = parseInt(me.parentNode.parentNode.id);

  if (me.contentEditable != 'true') {
    return;
  }
  me.contentEditable = 'false';

  var newtxt = me.textContent;
  var oldtxt = me.oldText;
  if (newtxt == oldtxt) return;

  window.indexedDB.open('odinochka', 5).onsuccess = function (event) {
    var db = event.target.result;
    var tx = db.transaction('tabgroups', 'readwrite');
    var store = tx.objectStore('tabgroups');

    store.get(ts).onsuccess = function (event) {
      var data = event.target.result;
      data.name = newtxt;
      store.put(data).onsuccess = (e) => renderHeader(data, me.parentNode);
    };
  };
}

function groupDelete(event) {
  let me = event.target.parentNode;
  let ts = parseInt(me.parentNode.id);
  let shiftclick = event.shiftKey;

  if (!shiftclick) {
    // if not shift, then was x
    if (!confirm('Delete this group?')) return;
  }

  // delete it
  window.indexedDB.open('odinochka', 5).onsuccess = function (event) {
    let db = event.target.result;
    let tx = db.transaction('tabgroups', 'readwrite');
    let store = tx.objectStore('tabgroups');

    if (!shiftclick) {
      // if not shift, then was x
      removeAndUpdateCount(store.delete(ts), me.parentNode);
      return;
    }

    store.get(ts).onsuccess = function (event) {
      var data = event.target.result;

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

function groupOpen(event) {
  let me = event.target.parentNode;

  var code = me.parentNode.innerHTML.replace(
    /draggable="true"|class="tab"|target="_blank"|style="[^"]*"/g,
    ''
  );

  chrome.tabs.create({
    url:
      'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        '<html><style>a{display:block}</style>' +
          `<title>${me.textContent}</title>` +
          code +
          '</html>'
      )
  });

  return false;
}

// Group Functions

function removeAndUpdateCount(request, me) {
  request.onsuccess = function (event) {
    me.remove();
    updateCount(request.source);
  };
}

function deleteTabFromGroup(ts, i, node) {
  // Removes target from DB object
  window.indexedDB.open('odinochka', 5).onsuccess = function (event) {
    let db = event.target.result;
    let tx = db.transaction('tabgroups', 'readwrite');
    let store = tx.objectStore('tabgroups');

    if (i == 0 && node.nextSibling == null) {
      removeAndUpdateCount(store.delete(ts), node.parentNode);
    } else {
      store.get(ts).onsuccess = function (event) {
        let data = event.target.result;

        data.tabs.splice(i, 1);
        data.urls.splice(i, 1);

        removeAndUpdateCount(store.put(data), node);
      };
    }
  };
}

function setGroupCollapse(ts, collapsed) {
  // Set group collapse in DB object
  window.indexedDB.open('odinochka', 5).onsuccess = function (event) {
    var db = event.target.result;
    var tx = db.transaction('tabgroups', 'readwrite');
    var store = tx.objectStore('tabgroups');

    store.get(ts).onsuccess = function (event) {
      var data = event.target.result;
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

// Tab Events

function tabClick(event) {
  let me = event.target;
  let ts = parseInt(me.parentNode.id);
  let restore = document.forms['options'].elements['restore'].value;
  let locked = me.parentNode.children[0].textContent.indexOf('lock') > 0;
  let i = Array.from(me.parentNode.children).indexOf(me) - 1;

  // Youtube popdown
  //if (event.clientX > me.offsetLeft + me.offsetWidth - 10) {
  //  makeyt(me);
  //  return false;
  //}

  if (event.shiftKey || event.ctrlKey || locked || restore == 'keep') {
    return true;
  }

  chrome.tabs.create({url: me.href, pinned: me.target == '_pinned'}, (t) =>
    deleteTabFromGroup(ts, i, me)
  );
  return false;
}

function tabDelete(event) {
  let me = event.target.parentNode;
  let ts = parseInt(me.parentNode.id);
  let i = Array.from(me.parentNode.children).indexOf(me) - 1;
  deleteTabFromGroup(ts, i, me);
  return false;
}

// Eventhandler

function divclickhandler(event) {
  var target = event.target;
  if (!target) return true;
  console.log('target.className: ' + target.className);

  if (target.className == 'bt-del-tab') {
    switch (event.type) {
      case 'click':
        tabDelete(event);
        return false;
    }
  } else if (target.className == 'bt-del-group') {
    switch (event.type) {
      case 'click':
        groupDelete(event);
        return false;
    }
  } else if (target.className == 'bt-open-group') {
    switch (event.type) {
      case 'click':
        groupOpen(event);
        return false;
    }
  } else if (target.className == 'title') {
    switch (event.type) {
      case 'click':
        groupEdit(event);
        return false;
      case 'blur':
        groupBlur(event);
    }
  } else if (target.className == 'tab') {
    switch (event.type) {
      case 'click':
        return target.tagName != 'A' || tabClick(event);
      //case 'dblclick':
      //  return target.tagName != 'HEADER' || tabClick(event);
      case 'dragstart':
        target.id = 'drag';
        return true;
      case 'dragover':
        event.preventDefault();
        return true;
      case 'dragend':
        target.id = '';
        return true;
      case 'drop':
        return drop(event);
    }
  }
  console.log(event); // should be impossible
  return true;
}

// Collapse
// https://jsfiddle.net/zmirko/oaqprbLh
function initAccordion(elem, option) {
  //document.addEventListener('dblclick', function (e) {
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

// Drag and Drop

function ddextract(node) {
  return {
    node: node,
    parentNode: node.parentNode,
    id: parseInt(node.parentNode.id),
    index: Array.from(node.parentNode.children).indexOf(node) - 1, // -1 to adjust for header tag
    group: node.tagName == 'HEADER'
  };
}

function drop(event) {
  event.preventDefault();

  if (event.target.id == 'drag') return; // dropped on itself

  let src = ddextract(document.getElementById('drag'));
  let tgt = ddextract(event.target);

  if (src.group && !tgt.group) return; // appending group to link makes no sense.

  let moveNode = function () {
    tgt.parentNode.insertBefore(src.node, tgt.node.nextSibling);
  };

  window.indexedDB.open('odinochka', 5).onsuccess = function (event) {
    let db = event.target.result;
    let tx = db.transaction('tabgroups', 'readwrite');
    let store = tx.objectStore('tabgroups');

    store.get(tgt.id).onsuccess = function (event1) {
      let tdata = event1.target.result;
      if (tgt.id == src.id) {
        tdata.tabs.splice(tgt.index + 1, 0, tdata.tabs[src.index]);
        tdata.tabs.splice(src.index + (src.index > tgt.index), 1);
        tdata.urls = tdata.tabs.map((t) => t.url);

        store.put(tdata).onsuccess = moveNode;
        return;
      }
      // otherwise, cross group drag and drop
      store.get(src.id).onsuccess = function (event2) {
        let sdata = event2.target.result;
        let callback;

        if (src.group && tgt.group) {
          tdata.tabs = tdata.tabs.concat(sdata.tabs);
          sdata.tabs = [];
          callback = function () {
            let toAppend = [];
            let snode = src.node;
            while (snode.nextSibling) {
              toAppend.push(snode.nextSibling);
              snode = snode.nextSibling;
            }
            src.parentNode.innerHTML = ''; //append below triggers N mutationEvents on src, but one on tgt
            tgt.parentNode.append(...toAppend);
          };
        } else {
          tdata.tabs.splice(tgt.index, 0, sdata.tabs[src.index]);
          sdata.tabs.splice(src.index, 1);
          callback = moveNode;
        }

        tdata.urls = tdata.tabs.map((t) => t.url);
        sdata.urls = sdata.tabs.map((t) => t.url);

        let req = store.put(tdata);
        if (sdata.tabs.length > 0) {
          req.onsuccess = function (event) {
            store.put(sdata).onsuccess = callback;
          };
        } else {
          req.onsuccess = function (event) {
            store.delete(sdata.ts).onsuccess = function (event) {
              let oldParent = src.parentNode;
              callback();
              oldParent.remove();
            };
          };
        }
      };
    };
  };
}

// Navbar

function initNav() {
  document.getElementById('bt-collapse').onclick = groupCollapseAll;
  document.getElementById('bt-expand').onclick = groupExpandAll;
}

function groupCollapseAll() {
  setGroupCollapseAll(1);
}
function groupExpandAll() {
  setGroupCollapseAll(0);
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

  reader.onload = function (event) {
    let tabs = JSON.parse(event.target.result);

    window.indexedDB.open('odinochka', 5).onsuccess = function (event) {
      let db = event.target.result;
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
  window.indexedDB.open('odinochka', 5).onsuccess = function (event) {
    let db = event.target.result;
    let tx = db.transaction('tabgroups', 'readonly');
    let store = tx.objectStore('tabgroups');

    updateCount(store);

    store.openCursor(null, 'prev').onsuccess = function (event) {
      let cursor = event.target.result;
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

// YouTube Functions

// var ytobserver = null;
// function makeyt(me) {
//   var ytouter = document.getElementById('ytouter');
//   if (ytobserver) ytobserver.disconnect();

//   ytVidCode = me.href.replace(/^.*v=/, '').replace(/&.*$/, '');
//   ytouter.innerHTML = `<iframe src=https://www.youtube.com/embed/${ytVidCode}
//        frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
//        allowfullscreen ></iframe>`;

//   //preserve aspect ratio on resize
//   ytouter.children[0].onload = function () {
//     var ws = window.getComputedStyle(ytouter);
//     var ar = (1.1 * Number.parseFloat(ws.height)) / Number.parseFloat(ws.width);
//     ytobserver = new MutationObserver((ml, obs) => {
//       var nw = Number.parseFloat(ytouter.style.width);
//       var nh = Number.parseFloat(ytouter.style.height);
//       var calc = Math.round(nw * ar);
//       if (nh != calc) {
//         ytouter.style.setProperty('height', `${calc}px`);
//       }
//     });

//     // Start observing the target node for configured mutations
//     ytobserver.observe(ytouter, {attributes: true});
//   };

//   ytouter.ondblclick = function () {
//     ytouter.innerHTML = '';
//     ytouter.setAttribute('style', ''); //resets the manual sizing
//     if (ytobserver) ytobserver.disconnect();
//     return false;
//   };
// }
