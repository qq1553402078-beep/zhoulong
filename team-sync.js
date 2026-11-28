(() => {
  const endpoint = 'https://zhoulong-studio-sync.pages.dev/sync';
  const scopes = {
    tasks: 'studio-ops-v1',
    rest: 'studio-ops-rest-v1',
    daily: 'studio-ops-daily-output-v1',
    monthly: 'studio-ops-monthly-output-v1',
    management: 'studio-ops-management-v1',
    settings: 'studio-ops-settings-v1',
    requests: 'studio-ops-requests-v1'
  };
  const cacheKey = 'studio-team-sync-baseline-v1';
  const codeKey = 'studio-team-access-v1';
  const read = (storage, key, fallback) => {
    try { return JSON.parse(storage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  // 管理后台上传的照片以 base64 存在设置里，一张图可达 650KB；服务端单请求上限约 300KB。
  // 图片可能藏在数组里（gallery[].src），必须递归清理所有层级，否则仍会 413。
  // 清理只影响上传副本，本机数据不动；云端写回时再把大图按原路径恢复。
  const BIG_FIELD = 120000;
  const isBig = value => typeof value === 'string' && value.length > BIG_FIELD;
  const stripBigDeep = value => {
    if (isBig(value)) return '';
    if (Array.isArray(value)) return value.map(stripBigDeep);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(k => { out[k] = stripBigDeep(value[k]); });
      return out;
    }
    return value;
  };
  const restoreBig = (target, pairs) => {
    pairs.forEach(([path, value]) => {
      let node = target;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (node[key] == null || typeof node[key] !== 'object') return;
        node = node[key];
      }
      if (node && typeof node === 'object') node[path[path.length - 1]] = value;
    });
    return target;
  };
  // 压缩后的图约 60KB，单张能同步；但多张累加仍可能超过服务端上限。
  // 总量预算：超限时把最大的图片字段让位（置空），保证请求永远不超；本机图片在 apply 时恢复。
  const SYNC_BUDGET = 360000;
  const isImage = value => typeof value === 'string' && value.indexOf('data:image/') === 0;
  const fitBudget = records => {
    const size = () => JSON.stringify(records).length;
    if (size() <= SYNC_BUDGET) return;
    const imgs = [];
    const scan = (value, path) => {
      if (isImage(value)) { imgs.push({ path, len: value.length }); return; }
      if (Array.isArray(value)) value.forEach((v, i) => scan(v, path.concat(i)));
      else if (value && typeof value === 'object') Object.keys(value).forEach(k => scan(value[k], path.concat(k)));
    };
    Object.entries(records).forEach(([idx, v]) => scan(v, [idx]));
    imgs.sort((a, b) => b.len - a.len);
    for (const it of imgs) {
      if (size() <= SYNC_BUDGET) break;
      let node = records;
      for (let i = 0; i < it.path.length - 1; i++) node = node[it.path[i]];
      if (node && typeof node === 'object') node[it.path[it.path.length - 1]] = '';
    }
  };
  // 恢复本机图片：收集所有 data:image 字段（含压缩后的 60KB 图），不只超大字段
  const collectImages = (value, path, out) => {
    if (isImage(value)) { out.push([path, value]); return; }
    if (Array.isArray(value)) value.forEach((v, i) => collectImages(v, path.concat(i), out));
    else if (value && typeof value === 'object') Object.keys(value).forEach(k => collectImages(value[k], path.concat(k), out));
  };
  // 旧版同步键与页面不一致，导致自定义类型/设置从未真正同步。首次运行把旧记录搬过来，已有设置优先。
  try {
    const oldSettings = read(localStorage, 'studio-settings-v1', null);
    const currentSettings = read(localStorage, 'studio-ops-settings-v1', null);
    if (oldSettings && Object.keys(oldSettings).length && (!currentSettings || !Object.keys(currentSettings).length)) {
      localStorage.setItem('studio-ops-settings-v1', JSON.stringify(oldSettings));
    }
  } catch {}

  const sameRecords = (left, right) => Object.keys(left).length === Object.keys(right).length
    && Object.entries(left).every(([index, value]) => equal(value, right[index]));

  function capture() {
    const records = Object.create(null);
    for (const [scope, key] of Object.entries(scopes)) {
      const data = read(localStorage, key, (scope === 'tasks' || scope === 'requests') ? [] : {});
      if (scope === 'tasks' || scope === 'requests') {
        for (const task of data) if (task?.id) records[JSON.stringify([scope, task.id])] = stripBigDeep(task);
      } else if (scope === 'rest' || scope === 'daily' || scope === 'monthly') {
        for (const [date, people] of Object.entries(data)) {
          for (const [name, value] of Object.entries(people ?? {})) {
            records[JSON.stringify([scope, date, name])] = stripBigDeep(value);
          }
        }
      } else if (scope === 'settings') {
        records[JSON.stringify([scope, 'all'])] = stripBigDeep(data);
      } else {
        for (const [period, value] of Object.entries(data)) {
          records[JSON.stringify([scope, period])] = stripBigDeep(value);
        }
      }
    }
    fitBudget(records);
    return records;
  }

  function apply(records) {
    const data = { tasks: [], requests: [], rest: Object.create(null), daily: Object.create(null),
      monthly: Object.create(null), management: Object.create(null), settings: Object.create(null) };
    for (const [index, value] of Object.entries(records)) {
      if (value === null) continue;
      const [scope, id, name] = JSON.parse(index);
      if (scope === 'tasks' || scope === 'requests') data[scope].push(value);
      else if (scope === 'settings') data.settings = value;
      else if (scope === 'rest' || scope === 'daily' || scope === 'monthly') {
        (data[scope][id] ??= Object.create(null))[name] = value;
      } else if (Object.hasOwn(scopes, scope)) data[scope][id] = value;
    }
    for (const [scope, key] of Object.entries(scopes)) {
      // 云端数据覆盖本机时，把本机的大图按原路径恢复回去，避免照片丢失。
      // 大图只存在于设置（首页主视觉/配图/相册），且设置为固定对象结构，按路径恢复不会错位。
      if (scope === 'settings') {
        const localSettings = read(localStorage, key, {});
        const bigPairs = [];
        collectImages(localSettings, [], bigPairs);
        const merged = bigPairs.length ? restoreBig(data.settings, bigPairs) : data.settings;
        localStorage.setItem(key, JSON.stringify(merged));
      } else {
        localStorage.setItem(key, JSON.stringify(data[scope]));
      }
    }
  }

  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = '团队同步';
  document.querySelector('header nav').after(control);
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.style.cssText = 'font-size:12px;padding:4px 8px';
  control.after(status);

  let syncing = false;
  // 内置团队访问码：无需手动输码，打开即自动同步（localStorage/sessionStorage 已存的值优先）
  const BUILTIN_CODE = '2309c2e405e86590625b870c378fb4a1';
  let code = localStorage.getItem(codeKey) || sessionStorage.getItem(codeKey) || BUILTIN_CODE;
  if (code) localStorage.setItem(codeKey, code);
  const request = async (method, body) => {
    const send = useCode => fetch(endpoint, {
      method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + useCode, 'Content-Type': 'application/json' }
    });
    let response = await send(code);
    // 本机存过错误访问码（以前手动输错过被记住）会自动回退到内置正确码并纠正本地存储，
    // 之后所有人都不会再因为本机旧码一直卡在「访问码无效」。
    if (response.status === 401 && code !== BUILTIN_CODE) {
      code = BUILTIN_CODE;
      try { localStorage.setItem(codeKey, code); sessionStorage.setItem(codeKey, code); } catch {}
      response = await send(code);
    }
    if (response.status === 401) throw new Error('团队访问码无效');
    // 409(版本冲突) 和 5xx(云端临时故障) 都交给外层重试，不再一次失败就放弃
    if (response.status === 409 || response.status >= 500) return null;
    if (!response.ok) throw new Error('云端暂不可用 ' + response.status);
    return response.json();
  };

  async function sync() {
    if (!code || syncing || document.hidden) return;
    syncing = true;
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        // 多人同时保存时略微错开重试，避免一直撞在同一个版本上
        if (attempt) await new Promise(resolve => setTimeout(resolve, 200 * attempt));
        const cloud = await request('GET');
        if (!cloud) continue; // GET 遇到 5xx，稍后重试
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
      throw new Error('云端繁忙，稍后重试');
    } catch (error) {
      const reason = error.name === 'TimeoutError' || /timeout|abort/i.test(error.message || '') ? '连接超时'
        : error.message === '团队访问码无效' ? '访问码无效'
        : /^云端暂不可用/.test(error.message || '') ? error.message
        : error.message === '云端繁忙，稍后重试' ? '云端繁忙'
        : '网络异常';
      status.textContent = '同步待重试（' + reason + '）· 本机记录已保留';
      status.title = error.message || String(error);
    } finally {
      syncing = false;
    }
  }

  // 点按钮直接重试；不需要每次输码（换码用 Shift+点击，保留入口）
  control.onclick = event => {
    if (syncing) return;
    if (event.shiftKey) {
      const next = prompt('输入团队同步访问码', code || '');
      if (!next?.trim()) return;
      code = next.trim();
      localStorage.setItem(codeKey, code);
    }
    status.textContent = '连接中…';
    sync();
  };
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', sync);
  setInterval(sync, 6000);
  sync();
})();
