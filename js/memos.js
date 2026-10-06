(function (global) {
  'use strict';

  let editingId = null;
  let currentDateKey = null;

  function init() {
    document.getElementById('memo-add').addEventListener('click', () => openModal(null));
    document.getElementById('memo-cancel').addEventListener('click', () => {
      document.getElementById('modal-memo').close();
    });
    document.getElementById('form-memo').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = document.getElementById('memo-text').value.trim();
      if (!text || !currentDateKey) return;
      if (editingId) {
        const existing = await DB.get('memos', editingId);
        if (existing) {
          existing.text = text;
          existing.updatedAt = new Date().toISOString();
          await DB.put('memos', existing);
        }
      } else {
        await DB.put('memos', {
          id: DB.uid(),
          dateKey: currentDateKey,
          text,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      document.getElementById('modal-memo').close();
      await renderForDay(currentDateKey);
      if (global.Calendar) Calendar.render();
      if (global.App) App.toast('メモを保存しました');
    });
  }

  function openModal(memo) {
    editingId = memo ? memo.id : null;
    document.getElementById('memo-modal-title').textContent = memo ? 'メモを編集' : 'メモを追加';
    document.getElementById('memo-text').value = memo ? memo.text : '';
    const dlg = document.getElementById('modal-memo');
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  async function renderForDay(dateKey) {
    currentDateKey = dateKey;
    const list = document.getElementById('day-memos');
    const empty = document.getElementById('day-memos-empty');
    const memos = await DB.getByIndex('memos', 'byDate', dateKey);
    memos.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    list.innerHTML = '';
    empty.hidden = memos.length > 0;
    for (const m of memos) {
      const li = document.createElement('li');
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = m.text;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = (m.updatedAt || m.createdAt || '').slice(0, 16).replace('T', ' ');
      body.appendChild(meta);
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = '編集';
      editBtn.addEventListener('click', () => openModal(m));
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', async () => {
        if (!confirm('このメモを削除しますか？')) return;
        await DB.del('memos', m.id);
        await renderForDay(dateKey);
        if (global.Calendar) Calendar.render();
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      li.appendChild(body);
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  global.Memos = { init, renderForDay, setDateKey: (k) => { currentDateKey = k; } };
})(typeof window !== 'undefined' ? window : self);
