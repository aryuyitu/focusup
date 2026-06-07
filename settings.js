// Settings page to view/add/remove blocked URLs
async function getStoredBlockedUrls() {
  try {
    const data = await chrome.storage.local.get(['blockedUrls']);
    if (data && Array.isArray(data.blockedUrls)) return data.blockedUrls.slice();
  } catch (e) { /* ignore */ }
  try {
    const resp = await fetch(chrome.runtime.getURL('config/blocked_urls.json'));
    const defaults = await resp.json();
    return Array.isArray(defaults) ? defaults.slice() : [];
  } catch (e) {
    return [];
  }
}

function renderList(urls) {
  const list = document.getElementById('list');
  list.innerHTML = '';
  if (!urls || urls.length === 0) {
    list.innerText = 'No blocked sites configured.';
    return;
  }
  for (const url of urls) {
    const div = document.createElement('div');
    div.className = 'item';
    const span = document.createElement('span');
    span.innerText = url;
    const btn = document.createElement('button');
    btn.className = 'btn remove';
    btn.innerText = 'Remove';
    btn.addEventListener('click', async () => {
      const filtered = urls.filter(u => u !== url);
      await chrome.storage.local.set({ blockedUrls: filtered });
      urls = filtered;
      renderList(urls);
    });
    div.appendChild(span);
    div.appendChild(btn);
    list.appendChild(div);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  let urls = await getStoredBlockedUrls();
  renderList(urls);

  document.getElementById('addBtn').addEventListener('click', async () => {
    const input = document.getElementById('newUrl');
    const val = (input.value || '').trim();
    if (!val) return;
    // normalize: remove protocol and trailing slashes
    const cleaned = val.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!urls.includes(cleaned)) {
      urls.push(cleaned);
      await chrome.storage.local.set({ blockedUrls: urls });
      renderList(urls);
      input.value = '';
    }
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    try {
      const resp = await fetch(chrome.runtime.getURL('config/blocked_urls.json'));
      const defaults = await resp.json();
      const arr = Array.isArray(defaults) ? defaults.slice() : [];
      await chrome.storage.local.set({ blockedUrls: arr });
      urls = arr;
      renderList(urls);
    } catch (e) {
      // ignore
    }
  });

  document.getElementById('closeBtn').addEventListener('click', () => {
    window.close();
  });
});
