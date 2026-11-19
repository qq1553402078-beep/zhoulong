/* 访问控制：进入填名字、只读/可编辑、申请权限、管理员审批与访客日志 */
(function () {
  'use strict';
  var API = 'https://zhoulong-studio-sync.pages.dev';
  var VIEWER_KEY = 'studio-viewer-v1';   // {name, role, status}
  var NAME_KEY = 'studio-viewer-name-v1'; // 只记名字：保证只输一次
  var ADMIN_CODE_KEY = 'studio-admin-code-v1';
  var viewer = null;
  var adminCode = '';
  var savedName = '';
  try { viewer = JSON.parse(localStorage.getItem(VIEWER_KEY) || 'null'); } catch (e) {}
  try { savedName = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}
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
        try { localStorage.setItem(VIEWER_KEY, JSON.stringify(viewer)); localStorage.setItem(NAME_KEY, data.name); } catch (e) {}
        mask.remove();
        // 首次进入也要挂载悬浮按钮（否则手机第一次打开看不到 AI 助手/管理）
        addAIButton();
        addAdminLauncher();
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
    btn.innerHTML = '✨ 中台小秘书';
    btn.setAttribute('aria-label', '打开中台小秘书');
    btn.style.cssText = 'position:fixed;right:18px;top:64px;z-index:8500;padding:13px 20px;border:2px solid #fff8;border-radius:26px;background:linear-gradient(135deg,#a76bf0,#e05fa8,#5c98f4);background-size:200% auto;color:#fff;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 8px 30px #000c,0 0 22px #c56bff66;letter-spacing:.02em;animation:secGlow 3s linear infinite';
    var st = document.createElement('style');
    st.textContent = '@keyframes secGlow{0%{background-position:0% center}100%{background-position:200% center}}';
    document.head.appendChild(st);
    btn.onclick = openAI;
    document.body.appendChild(btn);
  }
  function openAI() {
    var box = document.createElement('div');
    box.id = 'ai-box';
    box.innerHTML =
      '<div class="ai-head">✨ 中台小秘书 <span style="font-size:11px;color:#d8b8ff;font-weight:400">你的拍摄搭子 · 免费</span> <button id="ai-close" style="float:right;background:none;border:0;color:#fff;cursor:pointer;font-size:18px">×</button></div>' +
      '<div class="ai-tabs"><button class="ai-tab active" data-mode="ask">随便聊聊</button><button class="ai-tab" data-mode="analyze">拆对标</button><button class="ai-tab" data-mode="image">生个图</button></div>' +
      '<div id="ai-log" class="ai-log"><div class="ai-msg ai-sys" id="ai-welcome"></div></div>' +
      '<div id="ai-attach" class="ai-attach" hidden><img id="ai-attach-img" alt="已选图片"><button type="button" id="ai-attach-remove" title="移除图片">×</button></div>' +
      '<div class="ai-input-row"><label class="ai-upload" title="添加产品图／参考图">＋<input id="ai-file" type="file" accept="image/*" hidden></label><input id="ai-q" placeholder="问我点什么…"><button id="ai-send">发送</button></div>';
    var style = document.createElement('style');
    style.textContent =
      '#ai-box{position:fixed;right:18px;top:112px;z-index:8001;width:min(420px,calc(100vw - 36px));height:min(580px,calc(100vh - 140px));background:#15131c;border:1px solid #5a456e;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 60px #000c,0 0 30px #a76bf033}' +
      '.ai-head{padding:12px 16px;background:linear-gradient(135deg,#3a2450,#242044);color:#f3eaff;font-weight:800}' +
      '.ai-tabs{display:flex;border-bottom:1px solid #3a3348;background:#1b1826}' +
      '.ai-tab{flex:1;padding:10px 4px;background:none;border:0;color:#9b8fb0;font-size:12px;cursor:pointer;border-bottom:2px solid transparent}' +
      '.ai-tab.active{color:#e6d2ff;border-bottom-color:#a76bf0;font-weight:700}' +
      '.ai-log{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}' +
      '.ai-msg{padding:9px 12px;border-radius:10px;font-size:13px;line-height:1.6;max-width:92%;overflow-wrap:anywhere;white-space:pre-wrap}' +
      '.ai-sys{background:#241f33;color:#cfc6db;align-self:flex-start}' +
      '.ai-user{background:#3a2f5c;color:#fff;align-self:flex-end}' +
      '.ai-reply{background:#1c2733;color:#dce9fc;align-self:flex-start}' +
      '.ai-demo{display:inline-block;margin:5px 4px 0 0;padding:7px 11px;border:1px solid #6b4fa0;border-radius:18px;background:#2a2040;color:#dcc7ff;font-size:12px;cursor:pointer;transition:.15s}' +
      '.ai-demo:hover{background:#3d2b5e;transform:translateY(-1px)}' +
      '.ai-img{background:#1c2733;padding:8px;border-radius:10px;align-self:flex-start;max-width:90%}' +
      '.ai-img img{max-width:100%;border-radius:6px;display:block}' +
      '.ai-input-row{display:flex;gap:8px;padding:10px;border-top:1px solid #3a3348;align-items:center}' +
      '.ai-upload{width:38px;height:38px;flex:none;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;border:1px dashed #7a5fae;border-radius:8px;color:#c9b3f5;cursor:pointer;background:#1d1730}' +
      '.ai-upload:hover{background:#2a2042}' +
      '.ai-input-row input{flex:1;min-width:0;padding:10px;border-radius:8px;border:1px solid #4a4258;background:#0e0c14;color:#fff;outline:none;font-size:13px}' +
      '.ai-input-row button{padding:10px 14px;border:0;border-radius:8px;background:linear-gradient(135deg,#a76bf0,#e05fa8);color:#fff;cursor:pointer;font-weight:700}' +
      '.ai-attach{position:relative;display:inline-block;margin:10px 14px 0;padding:4px;border:1px solid #6b4fa0;border-radius:8px;background:#1d1730;align-self:flex-end;max-width:150px}' +
      '.ai-attach img{max-width:140px;max-height:100px;border-radius:5px;display:block}' +
      '.ai-attach button{position:absolute;top:-8px;right:-8px;width:22px;height:22px;border:0;border-radius:50%;background:#e05fa8;color:#fff;font-size:15px;line-height:22px;cursor:pointer}' +
      '.ai-userimg{max-width:150px;border-radius:6px;display:block;margin-bottom:4px}';
    document.head.appendChild(style);
    document.body.appendChild(box);
    document.getElementById('ai-close').onclick = function () { box.remove(); };
    var log = document.getElementById('ai-log');
    var q = document.getElementById('ai-q');
    var mode = 'ask';
    var attachedImage = ''; // 压缩后的 data URL（含头）
    // 前端压缩图片：最长边 <=1000px、JPEG 质量 0.72，控制在 ~150KB 内
    function compressImage(file, cb) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var max = 1000, w = img.width, h = img.height;
          if (w > max || h > max) { var s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // 防透明PNG转JPEG变黑
          ctx.drawImage(img, 0, 0, w, h);
          cb(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = function () { cb(''); };
        img.src = e.target.result;
      };
      reader.onerror = function () { cb(''); };
      reader.readAsDataURL(file);
    }
    var fileInput = document.getElementById('ai-file');
    var attachBox = document.getElementById('ai-attach');
    fileInput.onchange = function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      compressImage(file, function (dataUrl) {
        attachedImage = dataUrl;
        document.getElementById('ai-attach-img').src = dataUrl;
        attachBox.hidden = false;
        q.focus();
      });
      fileInput.value = '';
    };
    document.getElementById('ai-attach-remove').onclick = function () {
      attachedImage = ''; attachBox.hidden = true;
    };
    var demos = {
      ask: [
        '按抖音信息流逻辑，给这个产品写一段带货文案（3秒钩子+痛点+卖点）',
        '居家场景带货要怎么打光？给我主光/辅光/轮廓光的具体补光方案',
        '新品除臭贴有哪些信息流拍摄角度和卖点钩子可以挖？',
        '给我起 5 个抓眼球的抖音带货标题'
      ],
      analyze: [
        '贴个对标链接，按抖音信息流逻辑拆它的3秒钩子、场景、灯光和转化套路',
        '这个爆款视频为什么能留住人？帮我拆镜头和打光'
      ],
      image: [
        '居家场景带货：温馨客厅、原木桌、产品陈列、暖色氛围灯+补光、竖屏9:16',
        '产品照片搭景：极简大理石台面+绿植点缀、侧逆光轮廓光、高级质感、竖屏',
        '除臭贴信息流海报：干净背景、产品特写、清晨柔光、卖点突出、竖屏广告感',
        '夜景氛围感带货：暖光台灯、木质背景、生活化陈列、竖屏9:16'
      ]
    };
    var ph = { ask: '问我点什么…（可传产品图）', analyze: '粘贴对标链接，或传参考图…', image: '描述画面，或只传产品图…' };
    function renderWelcome() {
      var w = document.getElementById('ai-welcome');
      var intro = {
        ask: '嗨～我是中台小秘书 ✨ 满脑子都是抖音信息流那点事儿：3秒钩子、搭景打光、带货文案、起标题，随叫随到 😉\n📎 点左下角「＋」上传你的产品图，我就能看图给你搭场景、教打光～',
        analyze: '把对标链接丢给我，我按抖音信息流逻辑帮你拆——3秒怎么留人、场景怎么搭、灯怎么打、怎么转化 👀\n也可以直接传一张对标截图，我照样拆给你看～',
        image: '想要啥画面直接说，我按抖音带货场景给你生成竖屏参考图 🎨\n📎 传一张你的产品图，我会把产品融进场景里出参考图，一天免费出 200 张～'
      }[mode];
      w.textContent = intro;
      if (demos[mode] && demos[mode].length) {
        var wrap = document.createElement('div');
        wrap.style.marginTop = '8px';
        demos[mode].forEach(function (d) {
          var b = document.createElement('button');
          b.className = 'ai-demo';
          b.textContent = d.length > 30 ? d.slice(0, 30) + '…' : d;
          b.title = d;
          b.onclick = function () { q.value = d; send(); };
          wrap.appendChild(b);
        });
        w.appendChild(wrap);
      }
    }
    document.querySelectorAll('.ai-tab').forEach(function (tab) {
      tab.onclick = function () {
        mode = tab.dataset.mode;
        document.querySelectorAll('.ai-tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
        log.querySelectorAll('.ai-msg:not(#ai-welcome),.ai-img').forEach(function (n) { n.remove(); });
        renderWelcome();
        q.placeholder = ph[mode];
        q.focus();
      };
    });
    renderWelcome();
    function sysMsg(t) { log.insertAdjacentHTML('beforeend', '<div class="ai-msg ai-sys">' + esc(t) + '</div>'); log.scrollTop = log.scrollHeight; }
    // 从网站真实数据构造人效摘要，杜绝 AI 凭空编人名
    function realStats() {
      var people = [];
      try {
        var settings = JSON.parse(localStorage.getItem('studio-ops-settings-v1') || '{}');
        var roster = settings.roster || {};
        Object.keys(roster).forEach(function (g) {
          (Array.isArray(roster[g]) ? roster[g] : []).forEach(function (n) { if (n && people.indexOf(n) < 0) people.push(n); });
        });
      } catch (e) {}
      var tasks = [];
      try { tasks = JSON.parse(localStorage.getItem('studio-ops-v1') || '[]') || []; } catch (e) {}
      var stat = {};
      people.forEach(function (n) { stat[n] = { tasks: 0, shots: 0 }; });
      var roleKeys = ['lead', 'assistant', 'model', 'retouch', 'handModel'];
      tasks.forEach(function (t) {
        var participants = {};
        roleKeys.forEach(function (k) {
          var v = t[k];
          (Array.isArray(v) ? v : String(v || '').split('、')).forEach(function (n) { n = String(n).trim(); if (n) participants[n] = 1; });
        });
        var shot = (t.dailyShotCount != null && t.dailyShotCount !== '') ? Number(t.dailyShotCount) : Number(t.actual || 0);
        if (!isFinite(shot)) shot = 0;
        Object.keys(participants).forEach(function (n) { if (stat[n]) { stat[n].tasks++; stat[n].shots += shot; } });
      });
      var ranked = people.map(function (n) { return { name: n, tasks: stat[n].tasks, shots: stat[n].shots }; })
        .sort(function (a, b) { return b.tasks - a.tasks; });
      return { people: people, ranked: ranked, totalTasks: tasks.length };
    }
    function send() {
      var text = (q.value || '').trim();
      var img = attachedImage;
      if (!text && !img) return;
      q.value = '';
      // 用户气泡：有图先显示缩略图
      var bubble = document.createElement('div');
      bubble.className = 'ai-msg ai-user';
      if (img) { var im = document.createElement('img'); im.className = 'ai-userimg'; im.src = img; bubble.appendChild(im); }
      if (text) bubble.appendChild(document.createTextNode(text));
      log.appendChild(bubble);
      log.scrollTop = log.scrollHeight;
      var endpoint, payload;
      if (mode === 'analyze') {
        endpoint = '/ai/analyze'; payload = { url: text, image: img };
      } else if (mode === 'image') {
        endpoint = '/ai/image'; payload = { prompt: text, image: img };
      } else {
        var ctx = {
          leader: (function () { try { return (JSON.parse(localStorage.getItem('studio-ops-settings-v1') || '{}').leader) || ''; } catch (e) { return ''; } })(),
          name: viewer && viewer.name ? viewer.name : (savedName || ''),
          stats: realStats()
        };
        endpoint = '/ai/ask'; payload = { question: text || '看看这张图片，给我搭建和打光建议', context: ctx, image: img };
      }
      // 发送后清空附件
      attachedImage = ''; attachBox.hidden = true;
      sysMsg('让我想想哈…马上就好 😉');
      fetch(API + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); }).then(function (d) {
        var t = log.querySelector('.ai-sys:last-child'); if (t) t.remove();
        if (d.image) {
          var promptLine = d.prompt ? '<div style="font-size:11px;color:#b9a7d6;margin-top:6px;line-height:1.5">✨ 实际用的画面词：<span style="color:#d9c9ff">' + esc(d.prompt) + '</span><br><span style="color:#7d748c">可复制去别的 AI 生图工具用</span></div>' : '';
          log.insertAdjacentHTML('beforeend', '<div class="ai-img"><img src="' + d.image + '" alt="AI生成图"><div style="font-size:11px;color:#9b8fb0;margin-top:6px">中台小秘书生成 · 免费</div>' + promptLine + '</div>');
        } else if (d.answer) {
          log.insertAdjacentHTML('beforeend', '<div class="ai-msg ai-reply">' + esc(d.answer) + '</div>');
        } else {
          log.insertAdjacentHTML('beforeend', '<div class="ai-msg ai-reply">' + esc(d.error || '暂时无法处理') + '</div>');
        }
        log.scrollTop = log.scrollHeight;
      }).catch(function () {
        var t = log.querySelector('.ai-sys:last-child'); if (t) t.remove();
        sysMsg('哎呀网络打了个盹，再戳我一下嘛～');
      });
    }
    document.getElementById('ai-send').onclick = send;
    q.onkeydown = function (e) { if (e.key === 'Enter') send(); };
    q.focus();
  }

  /* ---------- 启动 ---------- */
  function boot() {
    // 名字只输一次：本地有 viewer 或历史名字，都静默恢复，不再弹窗
    var name = viewer && viewer.name ? viewer.name : (savedName || '');
    if (!name) { showLogin(); return; }
    // 用已记住的名字刷新权限状态（异步，不阻塞），不要求再次输入
    post('/access/visit', { name: name }).then(function (data) {
      if (data && data.name) {
        viewer = { name: data.name, role: data.role, status: data.status };
        try { localStorage.setItem(VIEWER_KEY, JSON.stringify(viewer)); localStorage.setItem(NAME_KEY, data.name); } catch (e) {}
      }
      applyMode();
    }).catch(function () { applyMode(); });
    // 先用本地缓存的 viewer 立即渲染，避免等待
    if (viewer) applyMode();
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
