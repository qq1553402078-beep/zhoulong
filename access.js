/* 访问控制：进入填名字、只读/可编辑、申请权限、管理员审批与访客日志 */
(function () {
  'use strict';
  var API = 'https://zhoulong-studio-sync.pages.dev';
  var VIEWER_KEY = 'studio-viewer-v1';   // {name, role, status}
  var ADMIN_CODE_KEY = 'studio-admin-code-v1';
  var viewer = null;
  var adminCode = '';
  try { viewer = JSON.parse(localStorage.getItem(VIEWER_KEY) || 'null'); } catch (e) {}
  try { adminCode = localStorage.getItem(ADMIN_CODE_KEY) || ''; } catch (e) {}

  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function canEdit() { return viewer && (viewer.role === 'editor' || viewer.role === 'admin') && viewer.status === 'approved'; }
  function isAdmin() { return viewer && viewer.role === 'admin' && viewer.status === 'approved'; }

  function post(path, body, auth) {
    var headers = { 'Content-Type': 'application/json' };
    if (auth) headers['Authorization'] = 'Bearer ' + auth;
    return fetch(API + path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) }).then(r => r.json());
  }
  function get(path, auth) {
    var headers = {};
    if (auth) headers['Authorization'] = 'Bearer ' + auth;
    return fetch(API + path, { headers: headers }).then(r => r.json());
  }

  /* ---------- 登录遮罩 ---------- */
  function showLogin() {
    var mask = document.createElement('div');
    mask.id = 'access-mask';
    mask.innerHTML =
      '<div class="access-card">' +
      '<div class="access-brand">◈ CENTRAL STUDIO</div>' +
      '<h2>欢迎进入中台拍摄工作台</h2>' +
      '<p class="access-sub">请输入你的姓名后进入。你的访问会被记录，修改内容需要申请权限并经管理员批准。</p>' +
      '<input id="access-name" type="text" maxlength="32" placeholder="请输入你的姓名" autocomplete="name">' +
      '<div id="access-msg" class="access-msg"></div>' +
      '<button id="access-enter" class="access-btn">进入网站</button>' +
      '<p class="access-tip">首次进入默认为「只读」，如需编辑请在页面顶部申请权限。</p>' +
      '</div>';
    var style = document.createElement('style');
    style.textContent =
      '#access-mask{position:fixed;inset:0;z-index:99999;background:rgba(6,8,14,.96);display:flex;align-items:center;justify-content:center;padding:20px}' +
      '.access-card{width:min(460px,100%);background:#15131c;border:1px solid #3a3348;border-radius:16px;padding:34px;box-shadow:0 24px 80px #000}' +
      '.access-brand{color:#c9b3f5;font-size:13px;letter-spacing:.12em;margin-bottom:18px}' +
      '.access-card h2{color:#f5f0fa;font-size:22px;margin:0 0 10px}' +
      '.access-sub{color:#a89fb8;font-size:13px;line-height:1.7;margin:0 0 22px}' +
      '#access-name{width:100%;box-sizing:border-box;padding:13px 14px;border-radius:9px;border:1px solid #4a4258;background:#0e0c14;color:#fff;font-size:15px;outline:none}' +
      '#access-name:focus{border-color:#9b7fe0}' +
      '.access-msg{color:#e8b96b;font-size:12px;min-height:18px;margin-top:8px}' +
      '.access-btn{width:100%;margin-top:14px;padding:13px;border:0;border-radius:9px;background:#8a6fd4;color:#fff;font-size:15px;font-weight:700;cursor:pointer}' +
      '.access-btn:disabled{opacity:.6;cursor:not-allowed}' +
      '.access-tip{color:#7d748c;font-size:11px;line-height:1.6;margin:18px 0 0;text-align:center}';
    document.head.appendChild(style);
    document.body.appendChild(mask);
    var input = document.getElementById('access-name');
    var btn = document.getElementById('access-enter');
    var msg = document.getElementById('access-msg');
    var submit = function () {
      var name = (input.value || '').trim();
      if (!name) { msg.textContent = '请先填写姓名'; return; }
      btn.disabled = true; msg.textContent = '正在进入…';
      post('/access/visit', { name: name }).then(function (data) {
        if (!data || !data.name) { msg.textContent = '进入失败，请重试'; btn.disabled = false; return; }
        viewer = { name: data.name, role: data.role, status: data.status };
        try { localStorage.setItem(VIEWER_KEY, JSON.stringify(viewer)); } catch (e) {}
        mask.remove();
        applyMode();
      }).catch(function () { msg.textContent = '网络异常，请重试'; btn.disabled = false; });
    };
    btn.onclick = submit;
    input.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
    setTimeout(function () { input.focus(); }, 100);
  }

  /* ---------- 顶部状态条 ---------- */
  function ensureBar() {
    var bar = document.querySelector('.access-bar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'access-bar';
    bar.style.cssText = 'position:sticky;top:0;z-index:9000;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:9px 16px;background:#1b1726;border-bottom:1px solid #3a3348;color:#e8e0f2;font-size:13px';
    var header = document.querySelector('header');
    if (header && header.parentNode) header.parentNode.insertBefore(bar, header);
    else document.body.insertBefore(bar, document.body.firstChild);
    return bar;
  }
  function renderBar() {
    if (!viewer) return;
    var bar = ensureBar();
    var roleText = canEdit() ? (isAdmin() ? '管理员 · 可编辑' : '已授权 · 可编辑') : (viewer.status === 'pending' ? '只读 · 待审批' : '只读');
    var html = '<span>👤 ' + esc(viewer.name) + '</span>' +
      '<span style="color:#9b8fb0">·</span>' +
      '<span style="color:' + (canEdit() ? '#7ee0b0' : '#e8b96b') + '">' + roleText + '</span>' +
      '<span style="flex:1"></span>';
    if (!canEdit()) {
      html += '<button id="access-request" style="padding:6px 12px;border:1px solid #8a6fd4;background:#2a2140;color:#d9c9ff;border-radius:7px;cursor:pointer">申请编辑权限</button>';
    }
    html += '<button id="access-switch" style="padding:6px 12px;border:1px solid #4a4258;background:#241f2e;color:#cfc6db;border-radius:7px;cursor:pointer">切换身份</button>';
    bar.innerHTML = html;
    var req = document.getElementById('access-request');
    if (req) req.onclick = function () {
      req.disabled = true; req.textContent = '提交中…';
      post('/access/request', { name: viewer.name }).then(function (data) {
        viewer.status = data.status || 'pending';
        try { localStorage.setItem(VIEWER_KEY, JSON.stringify(viewer)); } catch (e) {}
        req.textContent = '已提交，等待批准';
        renderBar();
      }).catch(function () { req.disabled = false; req.textContent = '申请编辑权限'; });
    };
    document.getElementById('access-switch').onclick = function () {
      try { localStorage.removeItem(VIEWER_KEY); } catch (e) {}
      viewer = null; location.reload();
    };
  }

  /* ---------- 只读模式：禁用所有编辑入口 ---------- */
  var observer = null;
  function applyMode() {
    renderBar();
    var editable = canEdit();
    document.body.classList.toggle('access-readonly', !editable);
    if (!observer) {
      observer = new MutationObserver(function () { if (!canEdit()) disableEdits(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    if (!editable) disableEdits();
  }
  function disableEdits() {
    // 禁用保存/新增/删除/导入等操作按钮，但保留导航、标签切换、申请权限
    var keep = ['access-request', 'access-switch', 'adminCodeInput', 'adminLogin', 'adminApprove', 'adminReject', 'adminRefreshVisits'];
    document.querySelectorAll('main button, main input[type=submit]').forEach(function (b) {
      if (keep.indexOf(b.id) >= 0) return;
      var txt = (b.textContent || '').trim();
      var isNav = b.hasAttribute('data-tab') || b.hasAttribute('data-home-section') || b.hasAttribute('data-report-jump') ||
        b.hasAttribute('data-photo-next') || b.hasAttribute('data-photo-prev') || b.hasAttribute('data-photo') ||
        b.getAttribute('aria-label') === '关闭相册' || b.getAttribute('type') === 'button' && /关闭|下一张|上一张|展开/.test(txt);
      if (isNav) return;
      // 保存/新增/删除/添加/导入/移除等编辑动作
      if (/保存|新增|删除|添加|移除|导入|清空|重置|编辑|上传|创建|确认/.test(txt) || b.hasAttribute('data-delete') || b.hasAttribute('data-remove')) {
        b.disabled = true;
        b.style.opacity = '.45';
        b.style.cursor = 'not-allowed';
      }
    });
    // 禁用表单输入
    document.querySelectorAll('main input, main textarea, main select').forEach(function (el) {
      if (keep.indexOf(el.id) >= 0) return;
      if (el.type === 'search') return; // 搜索允许
      el.disabled = true;
    });
  }

  /* ---------- 管理后台面板（审批 + 访客） ---------- */
  function loadAdmin() {
    var area = document.getElementById('adminArea');
    if (!area) return;
    area.style.display = 'block';
    area.innerHTML = '<div style="color:#9b8fb0;font-size:12px">加载中…</div>';
    Promise.all([get('/admin/users', adminCode), get('/admin/visits', adminCode)]).then(function (res) {
      var users = (res[0] && res[0].users) || [];
      var visits = (res[1] && res[1].visits) || [];
      if (res[0] && res[0].error) { area.innerHTML = '<div style="color:#e88">管理员码无效</div>'; return; }
      var html = '<h4 style="color:#e8e0f2;margin:6px 0">人员权限（' + users.length + '）</h4>';
      if (!users.length) html += '<div style="color:#7d748c">暂无登记人员</div>';
      users.forEach(function (u) {
        var tag = u.role === 'admin' ? '管理员' : (u.role === 'editor' ? '可编辑' : '只读');
        var st = u.status === 'approved' ? '已批准' : (u.status === 'rejected' ? '已拒绝' : '待审批');
        html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 0;border-top:1px solid #ffffff12">' +
          '<strong style="color:#f5f0fa;min-width:80px">' + esc(u.name) + '</strong>' +
          '<span style="color:#9b8fb0">' + tag + ' · ' + st + '</span>' +
          '<span style="flex:1"></span>' +
          '<button class="admin-act adminApprove" data-name="' + esc(u.name) + '" data-role="editor" style="padding:5px 10px;border:1px solid #3ad6bf;background:#153a37;color:#8ff0dd;border-radius:6px;cursor:pointer">批准编辑</button>' +
          '<button class="admin-act adminApprove" data-name="' + esc(u.name) + '" data-role="reader" style="padding:5px 10px;border:1px solid #5c98f4;background:#16294a;color:#9dc2ff;border-radius:6px;cursor:pointer">设只读</button>' +
          '<button class="admin-act adminApprove" data-name="' + esc(u.name) + '" data-role="admin" style="padding:5px 10px;border:1px solid #b99aff;background:#2c2145;color:#d9c9ff;border-radius:6px;cursor:pointer">设管理员</button>' +
          '<button class="admin-act adminReject" data-name="' + esc(u.name) + '" style="padding:5px 10px;border:1px solid #6b4250;background:#3a1f28;color:#ffb0bd;border-radius:6px;cursor:pointer">拒绝</button>' +
          '</div>';
      });
      var d = (res[1] && res[1].date) || '';
      html += '<h4 style="color:#e8e0f2;margin:18px 0 6px">今日访客（' + d + '，' + visits.length + ' 人）</h4>';
      if (!visits.length) html += '<div style="color:#7d748c">今日暂无访问记录</div>';
      visits.forEach(function (v) {
        var t = (v.first_at || '').replace('T', ' ').slice(0, 16);
        html += '<div style="padding:6px 0;border-top:1px solid #ffffff0e;color:#cfc6db">' + esc(v.name) + ' <span style="color:#7d748c">· 首次 ' + esc(t) + ' · 访问 ' + (v.count || 1) + ' 次</span></div>';
      });
      area.innerHTML = html;
      area.querySelectorAll('.adminApprove').forEach(function (b) {
        b.onclick = function () {
          post('/admin/approve', { name: b.dataset.name, role: b.dataset.role }, adminCode).then(loadAdmin);
        };
      });
      area.querySelectorAll('.adminReject').forEach(function (b) {
        b.onclick = function () { post('/admin/reject', { name: b.dataset.name }, adminCode).then(loadAdmin); };
      });
    }).catch(function () { area.innerHTML = '<div style="color:#e88">加载失败，请重试</div>'; });
  }

  /* ---------- AI 问答助手（免费额度内的 Llama） ---------- */
  function addAIButton() {
    if (document.querySelector('#ai-assistant-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'ai-assistant-btn';
    btn.innerHTML = '✦ AI 助手';
    btn.setAttribute('aria-label', '打开AI助手');
    btn.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:8500;padding:13px 18px;border:2px solid #fff5;border-radius:26px;background:linear-gradient(135deg,#8a6fd4,#5c98f4);color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 8px 28px #000b';
    btn.onclick = openAI;
    document.body.appendChild(btn);
  }
  function openAI() {
    var box = document.createElement('div');
    box.id = 'ai-box';
    box.innerHTML =
      '<div class="ai-head">✦ AI 助手 <span style="font-size:11px;color:#9b8fb0;font-weight:400">免费</span> <button id="ai-close" style="float:right;background:none;border:0;color:#fff;cursor:pointer;font-size:18px">×</button></div>' +
      '<div class="ai-tabs"><button class="ai-tab active" data-mode="ask">问答建议</button><button class="ai-tab" data-mode="analyze">对标链接</button><button class="ai-tab" data-mode="image">AI 生图</button></div>' +
      '<div id="ai-log" class="ai-log"><div class="ai-msg ai-sys" id="ai-welcome">你好！选一个功能：问答建议、粘贴对标链接分析搭建要点、或输入画面描述生成图片。全部免费。</div></div>' +
      '<div class="ai-input-row"><input id="ai-q" placeholder="输入问题…"><button id="ai-send">发送</button></div>';
    var style = document.createElement('style');
    style.textContent =
      '#ai-box{position:fixed;left:18px;bottom:72px;z-index:8001;width:min(420px,calc(100vw - 36px));height:min(560px,calc(100vh - 100px));background:#15131c;border:1px solid #3a3348;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 50px #000a}' +
      '.ai-head{padding:12px 16px;background:#241f33;color:#e8e0f2;font-weight:700}' +
      '.ai-tabs{display:flex;border-bottom:1px solid #3a3348;background:#1b1826}' +
      '.ai-tab{flex:1;padding:10px 4px;background:none;border:0;color:#9b8fb0;font-size:12px;cursor:pointer;border-bottom:2px solid transparent}' +
      '.ai-tab.active{color:#d9c9ff;border-bottom-color:#8a6fd4;font-weight:700}' +
      '.ai-log{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}' +
      '.ai-msg{padding:9px 12px;border-radius:10px;font-size:13px;line-height:1.6;max-width:90%;overflow-wrap:anywhere;white-space:pre-wrap}' +
      '.ai-sys{background:#241f33;color:#cfc6db;align-self:flex-start}' +
      '.ai-user{background:#3a2f5c;color:#fff;align-self:flex-end}' +
      '.ai-reply{background:#1c2733;color:#dce9fc;align-self:flex-start}' +
      '.ai-img{background:#1c2733;padding:8px;border-radius:10px;align-self:flex-start;max-width:90%}' +
      '.ai-img img{max-width:100%;border-radius:6px;display:block}' +
      '.ai-input-row{display:flex;gap:8px;padding:10px;border-top:1px solid #3a3348}' +
      '.ai-input-row input{flex:1;padding:10px;border-radius:8px;border:1px solid #4a4258;background:#0e0c14;color:#fff;outline:none;font-size:13px}' +
      '.ai-input-row button{padding:10px 14px;border:0;border-radius:8px;background:#8a6fd4;color:#fff;cursor:pointer;font-weight:700}';
    document.head.appendChild(style);
    document.body.appendChild(box);
    document.getElementById('ai-close').onclick = function () { box.remove(); };
    var log = document.getElementById('ai-log');
    var q = document.getElementById('ai-q');
    var mode = 'ask';
    var welcome = {
      ask: '你好！我是工作台 AI 助手，可以帮你查询、写文案、给拍摄建议。请问需要什么？',
      analyze: '粘贴一个对标链接（https://…），我会读取页面内容，帮你拆解场景、列出搭建要点和拍摄建议。',
      image: '输入画面描述（如：极简护肤品摆拍、大理石台面、柔和光线），我用 AI 免费生成一张参考图。每天免费约 200 张。'
    };
    var ph = { ask: '输入问题…', analyze: '粘贴对标链接 https://…', image: '描述你想要的画面…' };
    document.querySelectorAll('.ai-tab').forEach(function (tab) {
      tab.onclick = function () {
        mode = tab.dataset.mode;
        document.querySelectorAll('.ai-tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
        document.getElementById('ai-welcome').textContent = welcome[mode];
        q.placeholder = ph[mode];
        log.querySelectorAll('.ai-msg:not(#ai-welcome),.ai-img').forEach(function (n) { n.remove(); });
        q.focus();
      };
    });
    function sysMsg(t) { log.insertAdjacentHTML('beforeend', '<div class="ai-msg ai-sys">' + esc(t) + '</div>'); log.scrollTop = log.scrollHeight; }
    function send() {
      var text = (q.value || '').trim();
      if (!text) return;
      q.value = '';
      log.insertAdjacentHTML('beforeend', '<div class="ai-msg ai-user">' + esc(text) + '</div>');
      log.scrollTop = log.scrollHeight;
      var endpoint, payload;
      if (mode === 'analyze') {
        endpoint = '/ai/analyze'; payload = { url: text };
      } else if (mode === 'image') {
        endpoint = '/ai/image'; payload = { prompt: text };
      } else {
        var ctx = {
          tasks: (function () { try { return JSON.parse(localStorage.getItem('studio-ops-v1') || '[]').length; } catch (e) { return 0; } })(),
          leader: (function () { try { return (JSON.parse(localStorage.getItem('studio-ops-settings-v1') || '{}').leader) || ''; } catch (e) { return ''; } })()
        };
        endpoint = '/ai/ask'; payload = { question: text, context: ctx };
      }
      sysMsg('处理中…');
      fetch(API + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); }).then(function (d) {
        var t = log.querySelector('.ai-sys:last-child'); if (t) t.remove();
        if (d.image) {
          log.insertAdjacentHTML('beforeend', '<div class="ai-img"><img src="' + d.image + '" alt="AI生成图"><div style="font-size:11px;color:#9b8fb0;margin-top:6px">AI 生成参考图 · 免费</div></div>');
        } else if (d.answer) {
          log.insertAdjacentHTML('beforeend', '<div class="ai-msg ai-reply">' + esc(d.answer) + '</div>');
        } else {
          log.insertAdjacentHTML('beforeend', '<div class="ai-msg ai-reply">' + esc(d.error || '暂时无法处理') + '</div>');
        }
        log.scrollTop = log.scrollHeight;
      }).catch(function () {
        var t = log.querySelector('.ai-sys:last-child'); if (t) t.remove();
        sysMsg('网络异常，请重试');
      });
    }
    document.getElementById('ai-send').onclick = send;
    q.onkeydown = function (e) { if (e.key === 'Enter') send(); };
    q.focus();
  }

  /* ---------- 启动 ---------- */
  function boot() {
    if (!viewer) { showLogin(); return; }
    // 登录后刷新一次权限状态（异步，不阻塞）
    post('/access/visit', { name: viewer.name }).then(function (data) {
      if (data && data.name) {
        viewer = { name: data.name, role: data.role, status: data.status };
        try { localStorage.setItem(VIEWER_KEY, JSON.stringify(viewer)); } catch (e) {}
      }
      applyMode();
    }).catch(function () { applyMode(); });
    applyMode();
    addAIButton();
    addAdminLauncher();
  }
  // 右下角"管理"悬浮按钮：点击弹出审批面板（不受页面重渲染影响）
  function addAdminLauncher() {
    if (document.querySelector('#admin-launcher')) return;
    var btn = document.createElement('button');
    btn.id = 'admin-launcher';
    btn.textContent = '管理';
    btn.style.cssText = 'position:fixed;right:18px;bottom:130px;z-index:8000;padding:9px 14px;border:1px solid #c9b3f5;border-radius:20px;background:#241f33;color:#d9c9ff;font-size:13px;font-weight:700;cursor:pointer';
    btn.onclick = openAdminModal;
    document.body.appendChild(btn);
  }
  function openAdminModal() {
    var old = document.querySelector('#admin-modal');
    if (old) { old.remove(); return; }
    var modal = document.createElement('div');
    modal.id = 'admin-modal';
    modal.innerHTML = '<div class="access-card" style="width:min(620px,100%);max-height:82vh;overflow:auto">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
      '<h2 style="color:#f5f0fa;font-size:19px;margin:0">权限与访问管理</h2>' +
      '<button id="admin-close" style="background:none;border:0;color:#aaa;cursor:pointer;font-size:22px">×</button></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0">' +
      '<input id="adminCodeInput" type="password" placeholder="输入管理员码" style="flex:1;min-width:160px;padding:9px;border-radius:7px;border:1px solid #4a4258;background:#0e0c14;color:#fff">' +
      '<button id="adminLogin" style="padding:9px 16px;border:0;border-radius:7px;background:#8a6fd4;color:#fff;cursor:pointer">解锁</button></div>' +
      '<div id="adminArea" style="display:none"></div></div>';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(6,8,14,.9);display:flex;align-items:center;justify-content:center;padding:20px';
    document.body.appendChild(modal);
    document.getElementById('admin-close').onclick = function () { modal.remove(); };
    document.getElementById('adminLogin').onclick = function () {
      var code = (document.getElementById('adminCodeInput').value || '').trim();
      if (!code) { alert('请输入管理员码'); return; }
      adminCode = code;
      try { localStorage.setItem(ADMIN_CODE_KEY, code); } catch (e) {}
      loadAdmin();
    };
    if (adminCode) { document.getElementById('adminCodeInput').value = adminCode; loadAdmin(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
