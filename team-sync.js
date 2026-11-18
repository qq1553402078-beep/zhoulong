(() => {
  const endpoint = 'https://zhoulong-studio-sync.pages.dev/sync';
  const scopes = {
    tasks: 'studio-ops-v1',
    rest: 'studio-ops-rest-v1',
    daily: 'studio-ops-daily-output-v1',
    monthly: 'studio-ops-monthly-output-v1',
    management: 'studio-ops-management-v1',
    settings: 'studio-settings-v1'
  };
  const cacheKey = 'studio-team-sync-baseline-v1';
  const codeKey = 'studio-team-access-v1';
  const read = (storage, key, fallback) => {
    try { return JSON.parse(storage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  const sameRecords = (left, right) => Object.keys(left).length === Object.keys(right).length
    && Object.entries(left).every(([index, value]) => equal(value, right[index]));

  function capture() {
    const records = Object.create(null);
    for (const [scope, key] of Object.entries(scopes)) {
      const data = read(localStorage, key, scope === 'tasks' ? [] : {});
      if (scope === 'tasks') {
        for (const task of data) if (task?.id) records[JSON.stringify([scope, task.id])] = task;
      } else if (scope === 'rest' || scope === 'daily' || scope === 'monthly') {
        for (const [date, people] of Object.entries(data)) {
          for (const [name, value] of Object.entries(people ?? {})) {
            records[JSON.stringify([scope, date, name])] = value;
          }
        }
      } else if (scope === 'settings') {
        records[JSON.stringify([scope, 'all'])] = data;
      } else {
        for (const [period, value] of Object.entries(data)) {
          records[JSON.stringify([scope, period])] = value;
        }
      }
    }
    return records;
  }

  function apply(records) {
    const data = { tasks: [], rest: Object.create(null), daily: Object.create(null),
      monthly: Object.create(null), management: Object.create(null), settings: Object.create(null) };
    for (const [index, value] of Object.entries(records)) {
      if (value === null) continue;
      const [scope, id, name] = JSON.parse(index);
      if (scope === 'tasks') data.tasks.push(value);
      else if (scope === 'settings') data.settings = value;
      else if (scope === 'rest' || scope === 'daily' || scope === 'monthly') {
        (data[scope][id] ??= Object.create(null))[name] = value;
      } else if (Object.hasOwn(scopes, scope)) data[scope][id] = value;
    }
    for (const [scope, key] of Object.entries(scopes)) {
      localStorage.setItem(key, JSON.stringify(data[scope]));
    }
  }

  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = '连接团队同步';
  document.querySelector('header nav').after(control);
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.style.cssText = 'font-size:12px;padding:4px 8px';
  control.after(status);

  let syncing = false;
  let code = localStorage.getItem(codeKey) || sessionStorage.getItem(codeKey) || '';
  if (code) localStorage.setItem(codeKey, code);
  const request = async (method, body) => {
    const response = await fetch(endpoint, {
      method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + code, 'Content-Type': 'application/json' }
    });
    if (response.status === 401) throw new Error('团队访问码无效');
    if (response.status === 409) return null;
    if (!response.ok) throw new Error('云端暂不可用');
    return response.json();
  };

  async function sync() {
    if (!code || syncing || document.hidden) return;
    syncing = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const cloud = await request('GET');
        const local = capture();
        const baseline = read(localStorage, cacheKey, null);
        const merged = Object.assign(Object.create(null), cloud.records);
        for (const [index, value] of Object.entries(local)) {
          if (baseline ? !equal(value, baseline[index]) : !Object.hasOwn(merged, index)) merged[index] = value;
        }
        if (baseline) {
          for (const index of Object.keys(baseline)) if (!Object.hasOwn(local, index)) merged[index] = null;
        }
        const editing = document.querySelector('#main')?.contains(document.activeElement)
          && document.activeElement.matches('input,select,textarea,[contenteditable]');
        if (editing) {
          status.textContent = '正在编辑 · 保存后同步';
          return;
        }
        let latest = cloud;
        if (!sameRecords(merged, cloud.records)) {
          latest = await request('PUT', { revision: cloud.revision, records: merged });
          if (!latest) continue;
        }
        const current = capture();
        if (!sameRecords(current, local)) continue;
        const visible = Object.fromEntries(Object.entries(latest.records).filter(([, value]) => value !== null));
        if (!sameRecords(local, visible)) {
          apply(visible);
          window.dispatchEvent(new Event('studio-team-refresh'));
        }
        localStorage.setItem(cacheKey, JSON.stringify(visible));
        control.textContent = '团队同步';
        status.textContent = '已同步';
        return;
      }
      throw new Error('有其他同事正在保存，稍后重试');
    } catch (error) {
      status.textContent = (error.message === '团队访问码无效' ? error.message : '同步待重试') + ' · 本机记录已保留';
    } finally {
      syncing = false;
    }
  }

  control.onclick = () => {
    if (syncing) return;
    const next = prompt('输入团队同步访问码', '');
    if (!next?.trim()) return;
    code = next.trim();
    localStorage.setItem(codeKey, code);
    status.textContent = '连接中…';
    sync();
  };
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', sync);
  setInterval(sync, 6000);
  sync();
})();
