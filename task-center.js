/* 运营任务中心 · StudioTasks
 * 独立模块：运营下发拍摄需求 → 中台接收转排班 → 交付进度/反馈回显
 * 数据存 localStorage studio-ops-requests-v1，由 team-sync.js 的 requests scope 跨设备同步
 */
(function () {
  'use strict';
  const KEY = 'studio-ops-requests-v1';
  const VIEWER_KEY = 'studio-viewer-v1';
  const TASKS_KEY = 'studio-ops-v1';
  const SETTINGS_KEY = 'studio-ops-settings-v1';
  const API = 'https://zhoulong-studio-sync.pages.dev';

  const uid = () => globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2);
  const now = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);
  const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const opts = (values, cur) => values.map(v => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v || '请选择')}</option>`).join('');
  const read = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  /* ---------- 数据层 ---------- */
  function all() { const a = read(KEY, []); return Array.isArray(a) ? a : []; }
  function saveAll(list) { write(KEY, list); try { window.dispatchEvent(new Event('focus')); } catch {} }
  function config() { return all().find(r => r.id === '__config__') || { id: '__config__', opsMembers: {}, opsGroups: [], templates: [], benchmarks: [], permRequests: [] }; }
  function saveConfig(cfg) { const list = all().filter(r => r.id !== '__config__'); list.unshift(cfg); saveAll(list); }
  function requests() { return all().filter(r => r.id && r.id !== '__config__'); }
  function viewer() { return read(VIEWER_KEY, null); }
  function me() { return (viewer()?.name || '').trim(); }
  function settings() { return read(SETTINGS_KEY, {}); }

  /* 角色：
   * - 管理员（viewer.role==='admin'）：中台，全部权限
   * - 运营：名字出现在 opsMembers 映射中 → 运营，只能看自己项目组
   * - 其它（含 editor/reader 且不在运营名单）：中台成员
   */
  function isAdmin() { const v = viewer(); return !!(v && v.role === 'admin' && v.status === 'approved'); }
  function myGroup() { const g = config().opsMembers[me()]; return g || ''; }
  function isOps() { const v = viewer(); if (!v || isAdmin()) return false; return Object.hasOwn(config().opsMembers, me()); }
  function canSeeRequest(r) {
    if (isAdmin() || !isOps()) return true;          // 中台看全部
    return r.group === myGroup();                     // 运营只看本组
  }
  function rosterNames() {
    const s = settings(); const roster = s.roster || {};
    return [...new Set(Object.values(roster).flat().filter(Boolean))];
  }
  function modelNames() {
    const s = settings(); const roster = s.roster || {};
    return [...new Set(roster['模特'] || [])];
  }
  function restInfo(name, date) {
    // 复用休息表数据 studio-ops-rest-v1：{date:{name:'休'}}
    const rest = read('studio-ops-rest-v1', {});
    return rest?.[date]?.[name] || '';
  }
  function taskNameById(id) {
    const t = read(TASKS_KEY, []).find(x => x.id === id);
    return t ? (t.title || t.product || '工作安排任务') : '';
  }

  /* 交付进度：优先读关联任务的日报实际条数，否则用 request.done */
  function progressOf(r) {
    if (r.linkedTaskId) {
      const t = read(TASKS_KEY, []).find(x => x.id === r.linkedTaskId);
      if (t) {
        const done = Number(t.actual ?? t.dailyShotCount ?? r.done ?? 0) || 0;
        return { done, target: Number(r.target || t.target || 0) || 0 };
      }
    }
    return { done: Number(r.done || 0) || 0, target: Number(r.target || 0) || 0 };
  }
  const STATUS = ['待处理', '已排期', '拍摄中', '待交付', '已交付', '未完成', '已终止'];
  const DELIVER = ['拍摄分镜', '创新成片', '脚本拆解', 'AI素材／生成', '其它'];
  const PRIORITY = ['常规', '加急'];

  /* ---------- 铃铛：未读动态 ---------- */
  function notices() {
    const meName = me();
    return requests().flatMap(r => (r.history || []).filter(h => h.at && (!h.readBy || !h.readBy.includes(meName))).map(h => ({ ...h, reqId: r.id, reqTitle: r.title })));
  }

  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json());
  }

  /* ================= 渲染入口 ================= */
  function render(main) {
    if (!me()) { main.innerHTML = '<div class="panel" style="padding:30px">请先填写姓名进入网站，再使用任务中心。</div>'; return; }
    main.className = (tab() === 'tasks' ? 'tasks-page' : main.className);
    if (isOps()) renderOps(main);
    else renderCenter(main);
    bind(main);
  }
  function tab() { return (location.hash.slice(2) || 'tasks'); }

  /* ---------- 运营视图 ---------- */
  let opsTab = 'list'; // list | new | detail | board | data
  let opsDetailId = '';
  function renderOps(main) {
    const group = myGroup();
    const mine = requests().filter(r => canSeeRequest(r));
    const pending = mine.filter(r => !['已交付', '已终止'].includes(r.status)).length;
    const bar = `<div class="tc-hero"><div><div class="tc-eyebrow">OPERATIONS / 需求下发</div><h1>任务中心</h1><p>${esc(group ? group + ' · ' : '')}在这里下发拍摄需求，跟踪交付进度。</p></div><div class="tc-hero-stat">待处理 <b>${pending}</b> 项</div></div>`;
    const tabs = `<div class="tc-tabs" role="tablist">
      <button type="button" data-ops-tab="list" aria-pressed="${opsTab === 'list'}">我的下发</button>
      <button type="button" data-ops-tab="new" aria-pressed="${opsTab === 'new'}">＋ 下发任务</button>
      <button type="button" data-ops-tab="board" aria-pressed="${opsTab === 'board'}">交付看板</button>
      <button type="button" data-ops-tab="templates" aria-pressed="${opsTab === 'templates'}">任务模板</button>
      <button type="button" data-ops-tab="data" aria-pressed="${opsTab === 'data'}">数据看板</button>
      <button type="button" data-ops-tab="perm" aria-pressed="${opsTab === 'perm'}">权限申请</button>
    </div>`;
    let body = '';
    if (opsTab === 'list') body = opsList(mine);
    else if (opsTab === 'new') body = taskForm(null, true);
    else if (opsTab === 'detail') body = opsDetail(mine.find(r => r.id === opsDetailId));
    else if (opsTab === 'board') body = boardView(mine, true);
    else if (opsTab === 'templates') body = templatesView();
    else if (opsTab === 'data') body = dataBoard(mine);
    else if (opsTab === 'perm') body = permView();
    main.innerHTML = bar + tabs + `<div class="tc-bell-wrap"><button type="button" class="tc-bell" id="tcBell">🔔 消息 <span class="tc-bell-count">${notices().length}</span></button><div class="tc-bell-list" id="tcBellList" hidden></div></div>` + body;
  }

  function opsList(mine) {
    if (!mine.length) return '<div class="panel tc-empty">还没有下发任务。点「＋ 下发任务」创建第一条。</div>';
    const rows = mine.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(r => {
      const p = progressOf(r);
      const pct = p.target ? Math.min(100, Math.round(p.done / p.target * 100)) : 0;
      const overdue = r.deadline && r.deadline < today() && !['已交付', '已终止'].includes(r.status);
      return `<tr data-req-row="${esc(r.id)}">
        <td style="text-align:left"><a href="#task-detail" data-open-req="${esc(r.id)}">${esc(r.title)}</a><br><small>${esc(r.id)}</small></td>
        <td>${esc(r.deliverType || '—')}</td>
        <td>${esc(r.deadline || '—')}${overdue ? ' <span class="tc-late">已逾期</span>' : ''}</td>
        <td><div class="tc-prog"><span style="width:${pct}%"></span></div>${p.done}/${p.target}</td>
        <td><span class="tc-status tc-s-${esc(r.status)}">${esc(r.status)}</span>${r.priority === '加急' ? ' <span class="tc-urgent">加急</span>' : ''}</td>
        <td style="text-align:left">${esc((r.creator || me()))}</td>
        <td>${esc((r.createdAt || '').slice(0, 10))}</td>
        <td style="text-align:left">
          <button type="button" data-open-req="${esc(r.id)}" class="tc-link">详情</button>
          <button type="button" data-copy-req="${esc(r.id)}" class="tc-link">复制</button>
          ${r.status === '已交付' ? `<button type="button" data-accept-req="${esc(r.id)}" class="tc-link">验收</button>` : ''}
          ${!['已交付', '已终止'].includes(r.status) ? `<button type="button" data-terminate-req="${esc(r.id)}" class="tc-link tc-danger">终止</button>` : ''}
        </td></tr>`;
    }).join('');
    return `<div class="panel tc-table-wrap"><table class="tc-table"><thead><tr>
      <th style="text-align:left">任务名称</th><th>交付类型</th><th>截止</th><th>交付情况</th><th>状态</th><th style="text-align:left">创建人</th><th>创建日期</th><th style="text-align:left">操作</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
      <div class="bar"><button type="button" id="tcExport" class="tc-btn">导出本组报表</button><button type="button" data-ops-tab="new" class="tc-btn tc-primary">＋ 下发任务</button></div>`;
  }

  function opsDetail(r) {
    if (!r) { opsTab = 'list'; return opsList(requests().filter(canSeeRequest)); }
    const p = progressOf(r);
    const fb = r.feedback ? `<div class="tc-feedback"><strong>中台反馈（拍摄问题与建议）</strong><p>${esc(r.feedback.text)}</p><small>${esc(r.feedback.by)} · ${esc(r.feedback.at)}</small></div>` : '<div class="tc-muted">中台暂未填写反馈。</div>';
    const comments = (r.comments || []).map(c => `<div class="tc-comment"><b>${esc(c.by)}</b> <small>${esc(c.at)}</small><p>${esc(c.text)}</p></div>`).join('') || '<div class="tc-muted">还没有讨论。</div>';
    return `<div class="tc-detail">
      <div class="bar"><button type="button" data-ops-tab="list" class="tc-btn">← 返回列表</button><span class="spacer"></span>
        ${r.status === '已交付' ? `<button type="button" data-reject-req="${esc(r.id)}" class="tc-btn tc-danger">打回修改</button><button type="button" data-accept-req="${esc(r.id)}" class="tc-btn tc-primary">验收通过</button>` : ''}
      </div>
      <div class="panel tc-script-card">${scriptHeader(r)}
        <div class="tc-sh-meta"><span class="tc-status tc-s-${esc(r.status)}">${esc(r.status)}</span>${r.priority === '加急' ? ' <span class="tc-urgent">加急</span>' : ''}
          <span>交付类型：${esc(r.deliverType || '—')}</span><span>截止：${esc(r.deadline || '—')}</span><span>交付：${p.done}/${p.target}</span></div>
        <div class="tc-prog" style="max-width:420px"><span style="width:${p.target ? Math.min(100, Math.round(p.done / p.target * 100)) : 0}%"></span></div>
        ${benchmarkLinks(r)}${storyboardTable(r)}
      </div>
      <div class="panel" style="padding:18px;margin-top:12px"><div class="tc-sb-headline"><span class="tc-sb-bar"></span><b>交付反馈</b></div>${fb}</div>
      <div class="panel" style="padding:18px;margin-top:12px"><div class="tc-sb-headline"><span class="tc-sb-bar"></span><b>关联记录</b></div>${comments}
        <div class="bar"><input id="tcComment" placeholder="补充讨论…" style="max-width:none;flex:1"><button type="button" id="tcAddComment" data-req="${esc(r.id)}" class="tc-btn tc-primary">发送</button></div>
        <ul class="tc-history">${(r.history || []).slice().reverse().map(h => `<li><small>${esc(h.at)}</small> ${esc(h.by)}：${esc(h.text)}</li>`).join('') || '<li>暂无</li>'}</ul>
      </div>
    </div>`;
  }

  // 对标链接：兼容老的纯字符串数组与新的 {name,url} 结构
  function benchList(r){
   const arr=Array.isArray(r?.benchmarks)?r.benchmarks:[];
   return arr.map(x=>typeof x==='string'?{name:'',url:x}:(x&&typeof x==='object'?{name:x.name||'',url:x.url||''}:null)).filter(x=>x&&(x.url||x.name));
  }
  function readBench(root){
   return [...(root?.querySelectorAll('.tc-bench-row')||[])].map(row=>({
    name:(row.querySelector('.bench-name')?.value||'').trim(),
    url:(row.querySelector('.bench-url')?.value||'').trim()
   })).filter(x=>x.url||x.name);
  }
  function benchRowsHTML(items){
   const rows=items&&items.length?items:[{name:'',url:''}];
   return rows.map(x=>
    '<div class="tc-bench-row"><input class="bench-name" value="'+esc(x.name||'')+'" placeholder="链接名称，如：山药葛根粉对标">'+
    '<input class="bench-url" value="'+esc(x.url||'')+'" placeholder="粘贴对标链接，可跳钉钉/飞书/抖音">'+
    (x.url?'<a class="bench-jump" href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer" title="点击跳转">↗</a>':'<span class="bench-jump bench-jump-ph" title="填入链接后可跳转">↗</span>')+
    '<button type="button" class="bench-del tc-link" title="删除此条">×</button></div>'
   ).join('');
  }
  function benchEditor(items){
   return '<div class="tc-bench-editor"><div class="tc-bench-rows">'+benchRowsHTML(items)+'</div><button type="button" class="bench-add tc-btn">＋ 添加对标链接</button></div>';
  }
  function benchmarkLinks(r){
   const items=benchList(r);
   if(!items.length)return '';
   return '<div class="tc-bench-view"><b>对标分镜（点击跳转）：</b><div class="tc-bench-tags">'+items.map(x=>{
    const plat=/dingtalk|alidocs/i.test(x.url)?'钉钉':/feishu|larksuite/i.test(x.url)?'飞书':/douyin/i.test(x.url)?'抖音':'链接';
    return x.url?'<a class="tc-linktag" href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">'+(x.name?esc(x.name):plat)+' ↗</a>':'<span class="tc-tag">'+esc(x.name)+'</span>';
   }).join('')+'</div></div>';
  }
  function storyboardTable(r) {
    const rows = (r.storyboards || []);
    if (!rows.length) return '';
    return `<div class="tc-sb-headline"><span class="tc-sb-bar"></span><b>分镜脚本</b><span class="tc-muted">（点击可复制对标链接）</span></div>
    <table class="tc-table tc-storyboard"><thead><tr>
      <th style="width:42px">序号</th><th style="text-align:left">拍摄内容</th><th style="text-align:left">拍摄需求</th><th style="text-align:left">对标分镜</th>
    </tr></thead><tbody>` +
      rows.map(s => `<tr>
        <td>${esc(s.seq || '')}</td>
        <td style="text-align:left">${esc(s.content || '')}</td>
        <td style="text-align:left">${esc(s.need || '')}</td>
        <td style="text-align:left">${s.link ? `<a class="tc-benchmark-link" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer" title="点击跳转">${esc(s.link)}</a>` : '—'}</td>
      </tr>`).join('') + '</tbody></table>';
  }
  /* 图2 样式：发布者信息卡（脚本标题/标签/原脚本/关联任务/收藏分享） */
  function scriptHeader(r, mode) {
    const creator = r.creator || me();
    const team = r.team || '';
    const group = r.group || '';
    const pub = (r.createdAt || '').replace('T', ' ');
    const pubTags = (r.publicTags || []).map(t => `<span class="tc-tag">${esc(t)}</span>`).join('');
    const perTags = (r.personalTags || []).map(t => `<span class="tc-tag tc-tag-per">${esc(t)}</span>`).join('');
    const linkCount = r.linkedTaskId ? 1 : 0;
    return `<div class="tc-script-head">
      <div class="tc-sh-main">
        <div class="tc-sh-author"><span class="tc-avatar">${esc((creator || '?').slice(0, 1))}</span><div><b>${esc(creator)}</b>${team || group ? ' / ' + [team, group].filter(Boolean).map(esc).join(' / ') : ''}<br><small>发布时间：${esc(pub)}</small></div></div>
        <div class="tc-sh-tags">
          <span class="tc-tag tc-tag-kind">${esc(r.scriptKind || '脚本')}</span>
          ${r.category ? `<span class="tc-tag">${esc(r.category)}</span>` : ''}
        </div>
        <div class="tc-sh-line">公共标签 ${pubTags}${pubTags ? '' : '<span class="tc-muted">暂无</span>'}</div>
        <div class="tc-sh-line">个人标签 ${perTags}${perTags ? '' : '<span class="tc-muted">暂无</span>'}</div>
        ${r.originScript ? `<div class="tc-sh-line">原脚本 <span class="tc-origin">${esc(r.originScript)}</span></div>` : ''}
      </div>
      <div class="tc-sh-side">
        <div class="tc-rel-task">🔗 关联任务 <b>${linkCount}</b></div>
        ${r.linkedTaskId ? `<div class="tc-rel-name">${esc(taskNameById(r.linkedTaskId))}</div>` : ''}
        <button type="button" class="tc-fav" title="收藏">☆ 收藏</button>
        <button type="button" class="tc-share" title="分享">↗ 分享</button>
      </div>
    </div>`;
  }

  /* ---------- 中台视图 ---------- */
  let centerTab = 'pending';
  let centerOpsGroup = ''; // 运营与项目组：当前选中的项目组
  let tplFormOpen = false; // 模板页：是否展开新建模板表单
  let tplFormEditIndex = -1; // -1=新建，否则编辑该模板
  function renderCenter(main) {
    if (centerTab === 'board') centerTab = 'pending';
    if (centerTab === 'perm') centerTab = isAdmin() ? 'other' : 'pending';
    if (centerTab === 'other' && !isAdmin()) centerTab = 'pending';
    const allReqs = requests();
    const pending = allReqs.filter(r => !['已交付', '已终止'].includes(r.status)).length;
    const bell = notices().length;
    const bar = `<div class="tc-hero tc-hero-center"><div><div class="tc-eyebrow">STUDIO / 需求接收</div><h1>任务中心</h1><p>运营下发的需求汇总在这里，接收后转为工作安排，拍摄反馈回写给运营。</p></div><div class="tc-hero-stat">待处理 <b>${pending}</b> 项 · 消息 <b>${bell}</b></div></div>`;
    const pendingCount = config().permRequests.filter(p => p.status === '待审批').length;
    const tabs = `<div class="tc-tabs" role="tablist">
      <button type="button" data-center-tab="pending" aria-pressed="${centerTab === 'pending'}">待处理 / 全部任务</button>
      <button type="button" data-center-tab="templates" aria-pressed="${centerTab === 'templates'}">任务模板</button>
      <button type="button" data-center-tab="benchmarks" aria-pressed="${centerTab === 'benchmarks'}">对标库</button>
      <button type="button" data-center-tab="ops" aria-pressed="${centerTab === 'ops'}">运营与项目组</button>
      ${isAdmin() ? `<button type="button" data-center-tab="other" aria-pressed="${centerTab === 'other'}">其他${pendingCount ? ` <span class="tc-dot">${pendingCount}</span>` : ''}</button>` : ''}
    </div>`;
    const bellBox = `<div class="tc-bell-wrap"><button type="button" class="tc-bell" id="tcBell">🔔 消息 <span class="tc-bell-count">${bell}</span></button><div class="tc-bell-list" id="tcBellList" hidden></div></div>`;
    let body = '';
    if (centerTab === 'pending') body = centerList(allReqs) + '<div class="tc-board-block"><h3 style="margin:18px 0 8px;color:#3d2b63">交付看板</h3>' + boardView(allReqs, false) + '</div>';
    else if (centerTab === 'templates') body = templatesView();
    else if (centerTab === 'benchmarks') body = benchmarksView();
    else if (centerTab === 'ops') body = opsManageView();
    else if (centerTab === 'other') body = isAdmin() ? permApproveView() : '<div class="panel tc-empty">无权查看。</div>';
    main.innerHTML = bar + tabs + bellBox + body;
  }

  function centerList(allReqs) {
    const rows = allReqs.slice().sort((a, b) => {
      const pa = a.priority === '加急' ? 0 : 1, pb = b.priority === '加急' ? 0 : 1;
      return pa - pb || (b.createdAt || '').localeCompare(a.createdAt || '');
    }).map(r => {
      const p = progressOf(r);
      return `<tr data-req-row="${esc(r.id)}">
        <td style="text-align:left"><a href="#task-detail" data-open-req="${esc(r.id)}">${esc(r.title)}</a><br><small>${esc(r.id)}</small></td>
        <td>${esc(r.group || '—')}</td>
        <td>${esc(r.deliverType || '—')}</td>
        <td>${esc(r.deadline || '—')}</td>
        <td>${p.done}/${p.target}</td>
        <td><span class="tc-status tc-s-${esc(r.status)}">${esc(r.status)}</span>${r.priority === '加急' ? ' <span class="tc-urgent">加急</span>' : ''}</td>
        <td style="text-align:left">${esc(r.linkedTaskId ? taskNameById(r.linkedTaskId) : '未转排班')}</td>
        <td style="text-align:left"><button type="button" data-open-req="${esc(r.id)}" class="tc-link">处理</button></td></tr>`;
    }).join('');
    return allReqs.length ? `<div class="panel tc-table-wrap"><table class="tc-table"><thead><tr>
      <th style="text-align:left">任务名称</th><th>项目组</th><th>类型</th><th>截止</th><th>进度</th><th>状态</th><th style="text-align:left">关联排班</th><th style="text-align:left">操作</th>
      </tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="panel tc-empty">暂无运营下发的任务。运营在「任务中心 → 下发任务」创建后会出现在这里。</div>';
  }

  function boardView(list, forOps) {
    const cols = ['待处理', '已排期', '拍摄中', '待交付', '已交付', '未完成', '已终止'];
    return `<div class="tc-board">` + cols.map(c => {
      const items = list.filter(r => r.status === c);
      return `<div class="tc-board-col"><div class="tc-board-head">${c} <span>${items.length}</span></div>` +
        (items.map(r => `<div class="tc-board-card" data-open-req="${esc(r.id)}"><b>${esc(r.title)}</b><small>${esc(r.group || '')} · ${esc(r.deliverType || '')}</small><div class="tc-prog"><span style="width:${(() => { const p = progressOf(r); return p.target ? Math.min(100, Math.round(p.done / p.target * 100)) : 0; })()}%"></span></div></div>`).join('') || '<div class="tc-board-empty">—</div>') + '</div>';
    }).join('') + '</div>';
  }

  function dataBoard(list) {
    const delivered = list.filter(r => r.status === '已交付').length;
    const ongoing = list.filter(r => !['已交付', '已终止'].includes(r.status)).length;
    const totalTarget = list.reduce((s, r) => s + progressOf(r).target, 0);
    const totalDone = list.reduce((s, r) => s + progressOf(r).done, 0);
    const rate = totalTarget ? Math.round(totalDone / totalTarget * 100) : 0;
    const byGroup = {};
    list.forEach(r => { const g = r.group || '未分组'; byGroup[g] = (byGroup[g] || 0) + 1; });
    return `<div class="cards">
      <div class="card">下发总数<b>${list.length}</b></div>
      <div class="card">进行中<b>${ongoing}</b></div>
      <div class="card">已交付<b>${delivered}</b></div>
      <div class="card">交付完成率<b>${rate}%</b></div>
    </div>
    <div class="panel" style="padding:18px;margin-top:12px"><h3>按项目组</h3><p>${Object.entries(byGroup).map(([g, n]) => esc(g) + '：' + n + ' 项').join('　') || '暂无数据'}</p>
    <p class="tc-muted">累计交付 ${totalDone} / ${totalTarget} 条。</p></div>`;
  }

  /* ---------- 任务表单（新建/编辑） ---------- */
  function taskForm(r, forOps) {
    const cfg = config();
    const groups = cfg.opsGroups.slice();
    const isEdit = !!r;
    const sb = (r?.storyboards || [{ seq: 1, content: '', need: '', link: '' }]);
    return `<form id="tcForm" class="panel tc-form" data-edit="${esc(r?.id || '')}">
      <h2>${isEdit ? '编辑任务' : '下发拍摄任务'}</h2>
      <div class="tc-grid">
        <label>任务名称 <input name="title" required maxlength="80" value="${esc(r?.title || '')}" placeholder="例如：11.11 秘与产品分镜"></label>
        <label>项目组（运营组） <select name="group">${opts(['', ...groups], r?.group || (isOps() ? myGroup() : ''))}</select></label>
        <label>所属团队 <input name="team" value="${esc(r?.team || '')}" placeholder="例如：内容团队"></label>
        <label>脚本标签 <select name="scriptKind">${opts(['脚本', '视频', '素材', '成片'], r?.scriptKind || '脚本')}</select></label>
        <label>品类 <input name="category" value="${esc(r?.category || '')}" placeholder="例如：秘与洗液"></label>
        <label>交付类型 <select name="deliverType">${opts(DELIVER, r?.deliverType || DELIVER[0])}</select></label>
        <label>截止日期 <input type="date" name="deadline" value="${esc(r?.deadline || '')}"></label>
        <label>优先级 <select name="priority">${opts(PRIORITY, r?.priority || '常规')}</select></label>
        <label>目标条数 <input type="number" min="0" name="target" value="${esc(r?.target || '')}" placeholder="例如：30"></label>
      </div>
      <div class="tc-grid" style="margin-top:12px">
        <label>公共标签（逗号分隔） <input name="publicTags" value="${esc((r?.publicTags || []).join('、'))}" placeholder="例如：平台:抖音、平台:小红书"></label>
        <label>个人标签（逗号分隔） <input name="personalTags" value="${esc((r?.personalTags || []).join('、'))}" placeholder="例如：重点跟进"></label>
        <label>原脚本 <input name="originScript" value="${esc(r?.originScript || '')}" placeholder="例如：玉米糊口播"></label>
      </div>
      ${benchEditor(benchList(r))}
      <div class="tc-sb-head"><h3>分镜脚本</h3><button type="button" id="tcAddSb" class="tc-btn">＋ 添加分镜</button></div>
      <p class="tc-field-hint">按镜头逐行填写：拍摄内容写画面，拍摄需求写要点，对标分镜粘贴参考链接（可点击跳转）。</p>
      <div id="tcStoryboards">${sb.map((s, i) => sbRow(s, i)).join('')}</div>
      ${cfg.templates.length ? `<div class="bar"><label>从模板套用 <select id="tcTemplate"><option value="">选择模板…</option>${cfg.templates.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('')}</select></label></div>` : ''}
      <div class="bar"><label><input type="checkbox" name="saveAsTemplate" style="width:auto"> 存为模板</label><label>模板名 <input name="templateName" placeholder="可选" style="max-width:200px"></label></div>
      <div class="bar"><button type="submit" class="tc-btn tc-primary">${isEdit ? '保存修改' : '下发任务'}</button><span role="status"></span></div>
    </form>`;
  }
  function sbRow(s, i) {
    return `<div class="tc-sb-row" data-sb="${i}">
      <input class="sb-seq" value="${esc(s.seq || i + 1)}" placeholder="序号" style="width:44px">
      <input class="sb-content" value="${esc(s.content || '')}" placeholder="拍摄内容，如：产品摆桌特写">
      <input class="sb-need" value="${esc(s.need || '')}" placeholder="拍摄需求，如：1:1 复刻、补光">
      <input class="sb-link" value="${esc(s.link || '')}" placeholder="对标链接（可留空）">
      <button type="button" class="tc-sb-del tc-link" title="删除">×</button>
    </div>`;
  }

  /* ---------- 中台任务处理详情 ---------- */
  let centerDetailId = '';
  function editableStoryboard(r) {
    const rows = (r.storyboards && r.storyboards.length) ? r.storyboards : [{ seq: 1, content: '', need: '', link: '' }];
    return rows.map((s, i) => `<div class="tc-sb-row" data-sbrow>
      <input class="sb-seq" value="${esc(s.seq || i + 1)}" placeholder="序号" style="width:42px">
      <input class="sb-content" value="${esc(s.content || '')}" placeholder="拍摄内容">
      <input class="sb-need" value="${esc(s.need || '')}" placeholder="拍摄需求">
      <input class="sb-link" value="${esc(s.link || '')}" placeholder="对标分镜链接">
      <button type="button" class="tc-sb-del tc-link" title="删除分镜">×</button>
    </div>`).join('');
  }
  function centerDetail(r) {
    if (!r) return centerList(requests());
    const p = progressOf(r);
    const linked = r.linkedTaskId ? `<span class="tc-ok">已转排班：${esc(taskNameById(r.linkedTaskId))}</span>` : '<span class="tc-warn">尚未转排班</span>';
    const crew = modelNames();
    const cfg = config();
    return `<form id="tcEditForm" data-req="${esc(r.id)}" class="tc-detail">
      <div class="bar"><button type="button" data-center-tab="pending" class="tc-btn">← 返回</button><span class="spacer"></span>
        ${r.linkedTaskId ? `<button type="button" id="tcGoSchedule" data-task="${esc(r.linkedTaskId)}" class="tc-btn">跳转到工作安排 ↗</button>` : `<button type="button" id="tcToSchedule" data-req="${esc(r.id)}" class="tc-btn tc-primary">转为工作安排 →</button>`}
        <button type="submit" class="tc-btn tc-primary">💾 保存全部修改</button>
      </div>
      <div class="panel tc-script-card">
        <div class="tc-script-head"><div class="tc-sh-main">
          <div class="tc-sh-author"><span class="tc-avatar">${esc((r.creator || me()).slice(0, 1))}</span><div><b>${esc(r.creator || me())}</b> / <input name="team" class="tc-inline" value="${esc(r.team || '')}" placeholder="团队"> / <input name="group" class="tc-inline" value="${esc(r.group || '')}" placeholder="运营组"><br><small>发布时间：${esc((r.createdAt || '').replace('T', ' '))}</small></div></div>
          <div class="tc-sh-tags"><select name="scriptKind" class="tc-inline">${opts(['脚本', '视频', '素材', '成片'], r.scriptKind || '脚本')}</select><input name="category" class="tc-inline" value="${esc(r.category || '')}" placeholder="品类"></div>
          <div class="tc-sh-line">任务名称 <input name="title" class="tc-inline tc-inline-wide" value="${esc(r.title || '')}" placeholder="任务名称"></div>
          <div class="tc-sh-line">公共标签 <input name="publicTags" class="tc-inline tc-inline-wide" value="${esc((r.publicTags || []).join('、'))}" placeholder="平台:抖音、平台:小红书"></div>
          <div class="tc-sh-line">个人标签 <input name="personalTags" class="tc-inline tc-inline-wide" value="${esc((r.personalTags || []).join('、'))}" placeholder="个人标签"></div>
          <div class="tc-sh-line">原脚本 <input name="originScript" class="tc-inline tc-inline-wide" value="${esc(r.originScript || '')}" placeholder="原脚本"></div>
        </div><div class="tc-sh-side"><div class="tc-rel-task">🔗 关联任务 <b>${r.linkedTaskId ? 1 : 0}</b></div>${linked}<button type="button" class="tc-fav" title="收藏">☆ 收藏</button><button type="button" class="tc-share" title="分享">↗ 分享</button></div></div>
        <div class="tc-sh-meta">
          <label>状态 <select name="status">${opts(STATUS, r.status)}</select></label>
          <label>优先级 <select name="priority">${opts(PRIORITY, r.priority || '常规')}</select></label>
          <label>交付类型 <select name="deliverType">${opts(DELIVER, r.deliverType || DELIVER[0])}</select></label>
          <label>截止 <input type="date" name="deadline" value="${esc(r.deadline || '')}"></label>
          <label>目标 <input type="number" min="0" name="target" value="${esc(r.target || '')}" style="width:70px"></label>
          <label>进度 <input type="number" min="0" name="done" value="${p.done}" style="width:70px"></label>
        </div>
        <div class="tc-editor-section" style="padding:12px 20px">
          ${benchEditor(benchList(r))}
        </div>
        <div class="tc-sb-headline" style="padding:6px 20px"><span class="tc-sb-bar"></span><b>分镜脚本</b><button type="button" id="tcAddSbRow" class="tc-btn" style="margin-left:auto">＋ 添加分镜</button></div>
        <p class="tc-field-hint" style="padding:0 20px">按镜头逐行填写：拍摄内容写画面，拍摄需求写要点，对标分镜粘贴参考链接（可点击跳转）。</p>
        <div id="tcEditStoryboards" style="padding:0 20px">${editableStoryboard(r)}</div>
      </div>
      <div class="panel" style="padding:18px;margin-top:12px"><div class="tc-sb-headline"><span class="tc-sb-bar"></span><b>模特选择</b><span class="tc-muted">（休息自动标注）</span></div>
        <div class="tc-models">${crew.map(n => { const rest = restInfo(n, r.deadline || today()); return `<label class="tc-model ${rest === '休' ? 'tc-rest' : ''}"><input type="checkbox" name="models" value="${esc(n)}" ${(r.models || []).includes(n) ? 'checked' : ''}> ${esc(n)}${rest === '休' ? ' · 休息' : ''}</label>`; }).join('') || '<span class="tc-muted">名册里暂无模特</span>'}</div>
      </div>
      <div class="panel" style="padding:18px;margin-top:12px"><div class="tc-sb-headline"><span class="tc-sb-bar"></span><b>拍摄问题与建议反馈</b></div>
        <textarea name="feedback" rows="3" style="width:100%" placeholder="拍摄中遇到的问题、给运营的建议…">${esc(r.feedback?.text || '')}</textarea>
        <div class="bar"><label><input type="checkbox" name="asTemplate" style="width:auto"> 存为任务模板</label><label>模板名 <input name="templateName" placeholder="可选" style="max-width:200px"></label></div>
      </div>
      <div class="panel" style="padding:18px;margin-top:12px"><div class="tc-sb-headline"><span class="tc-sb-bar"></span><b>关联记录</b></div>
        ${(r.comments || []).map(c => `<div class="tc-comment"><b>${esc(c.by)}</b> <small>${esc(c.at)}</small><p>${esc(c.text)}</p></div>`).join('') || '<div class="tc-muted">还没有讨论。</div>'}
        <div class="bar"><input id="tcComment" placeholder="补充讨论…" style="max-width:none;flex:1"><button type="button" id="tcAddComment" data-req="${esc(r.id)}" class="tc-btn tc-primary">发送</button></div>
        <ul class="tc-history">${(r.history || []).slice().reverse().map(h => `<li><small>${esc(h.at)}</small> ${esc(h.by)}：${esc(h.text)}</li>`).join('')}</ul>
      </div>
      <div class="bar"><button type="submit" class="tc-btn tc-primary">💾 保存全部修改</button><span role="status"></span></div>
    </form>`;
  }

  /* ---------- 配置视图 ---------- */
  function templatesView() {
    const t = config().templates;
    const head = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><h2 style="margin:0">任务模板</h2><p class="tc-muted" style="margin:4px 0">建好模板后，点「用此模板下发」即可一键带出内容。</p></div><button type="button" id="tcTplNew" class="tc-btn tc-primary">＋ 新建模板</button></div>`;
    const form = tplFormOpen ? tplForm(tplFormEditIndex >= 0 ? t[tplFormEditIndex] : null) : '';
    const list = t.length ? `<div class="tc-tpl-grid" style="margin-top:14px">${t.map((x, i) => `<div class="tc-tpl-card">
        <div class="tc-tpl-head"><b>${esc(x.name)}</b><span class="tc-tag">${esc(x.deliverType || '任务')}</span></div>
        <div class="tc-tpl-meta">${esc(x.scriptKind || x.scriptTitle || '')}${x.category ? ' · ' + esc(x.category) : ''}${x.target ? ' · 目标 ' + esc(x.target) + ' 条' : ''}</div>
        ${x.brief ? `<div class="tc-tpl-desc"><b>拍摄内容：</b>${esc(x.brief)}</div>` : ''}
        ${x.need ? `<div class="tc-tpl-desc"><b>拍摄需求：</b>${esc(x.need)}</div>` : ''}
        ${benchmarkLinks(x)}
        <div class="bar"><button type="button" data-use-template="${i}" class="tc-btn tc-primary">用此模板下发</button><button type="button" data-edit-template="${i}" class="tc-btn">编辑</button><button type="button" data-del-template="${i}" class="tc-btn tc-danger">删除</button></div>
      </div>`).join('')}</div>` : (tplFormOpen ? '' : '<p class="tc-muted" style="margin-top:14px">还没有模板，点右上角「＋ 新建模板」创建第一个。</p>');
    return `<div class="panel" style="padding:18px">${head}${form}${list}</div>`;
  }
  const DEFAULT_TPL_CATEGORIES = ['秘与紧致丹', '秘与洗液', '山药秘与葛根粉', '除臭贴', 'LILIA二硫化硒洗发水', 'LILOO紧致丹', '毛囊炎洗发水'];
  function tplCategories() { const c = config(); return Array.isArray(c.tplCategories) && c.tplCategories.length ? c.tplCategories : DEFAULT_TPL_CATEGORIES.slice(); }
  function tplDeliverTypes() { const c = config(); return Array.isArray(c.tplDeliverTypes) && c.tplDeliverTypes.length ? c.tplDeliverTypes : DELIVER.slice(); }
  function tplScriptKinds() { const c = config(); return Array.isArray(c.tplScriptKinds) && c.tplScriptKinds.length ? c.tplScriptKinds : ['脚本', '视频', '素材', '成片']; }
  function tplDatalist(id, list) { return `<datalist id="${id}">${list.map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist>`; }
  // 可管理标签的输入框：点「＋」展开面板，可点选已有标签、删除、新增（就地操作不重绘表单）
  function tagField(name, label, key, list, value, placeholder, datalistId) {
    return `<label class="tc-tag-label">${label} <span class="tc-tag-field"><input name="${name}" list="${datalistId}" value="${esc(value || '')}" placeholder="${placeholder}"><button type="button" class="tc-tpl-add" data-tag-open="${key}" title="管理标签">＋</button></span>
      <span class="tc-tag-panel" data-tag-panel="${key}" hidden>
        <span class="tc-tag-chips">${list.map(v => `<span class="tc-tag-chip" data-tag-pick="${esc(v)}">${esc(v)}<button type="button" class="tc-tag-chip-del" data-tag-del="${esc(v)}" title="删除">×</button></span>`).join('')}</span>
        <span class="tc-tag-new"><input class="tc-tag-new-input" placeholder="输入新标签后按回车或点添加"><button type="button" class="tc-tag-new-add">添加</button></span>
      </span></label>`;
  }
  function tplForm(tpl) {
    const x = tpl || {};
    return `<form id="tcTplForm" class="tc-tpl-form" data-index="${tplFormEditIndex}" style="margin-top:14px;padding:14px;border:1px solid #d8cfe8;border-radius:10px;background:#faf8ff">
      ${tplDatalist('tcTplCatOpts', tplCategories())}${tplDatalist('tcTplDeliverOpts', tplDeliverTypes())}${tplDatalist('tcTplScriptOpts', tplScriptKinds())}
      <div class="tc-grid">
        <label>模板名称 <input name="name" required value="${esc(x.name || '')}" placeholder="例如：玉米粉对标模板"></label>
        ${tagField('category', '品类', 'tplCategories', tplCategories(), x.category, '选择或输入新品', 'tcTplCatOpts')}
        <label>目标条数 <input type="number" min="0" name="target" value="${esc(x.target || '')}" placeholder="例如：30"></label>
        ${tagField('deliverType', '交付类型', 'tplDeliverTypes', tplDeliverTypes(), x.deliverType, '选择或输入', 'tcTplDeliverOpts')}
        ${tagField('scriptKind', '脚本标签', 'tplScriptKinds', tplScriptKinds(), x.scriptKind, '选择或输入', 'tcTplScriptOpts')}
      </div>
      ${benchEditor(benchList(x))}
      <div class="tc-tpl-fields">
        <label style="display:block;margin-top:10px">拍摄内容 <textarea name="brief" class="tc-tpl-textarea" rows="2" placeholder="这个模板要拍什么内容、怎么拍">${esc(x.brief || '')}</textarea></label>
        <label style="display:block;margin-top:8px">拍摄需求 <textarea name="need" class="tc-tpl-textarea" rows="2" placeholder="拍摄要求、注意事项、复刻要点等">${esc(x.need || '')}</textarea></label>
      </div>
      <div class="bar"><button type="submit" class="tc-btn tc-primary">保存模板</button><button type="button" id="tcTplCancel" class="tc-btn">取消</button></div>
    </form>`;
  }
  function benchmarksView() {
    const b = config().benchmarks;
    return `<div class="panel" style="padding:18px"><h2>对标库</h2><p class="tc-muted">运营下发的对标链接自动沉淀，可反复复用。</p>
      <div class="bar"><input id="tcBenchInput" placeholder="粘贴对标链接" style="max-width:none;flex:1"><button type="button" id="tcBenchAdd" class="tc-btn tc-primary">加入对标库</button></div>
      ${b.map((u, i) => `<div class="tc-cfg-row"><a href="${esc(u)}" target="_blank" rel="noopener noreferrer" class="tc-linktag">打开 ↗</a> <span class="tc-muted">${esc(u)}</span> <button type="button" data-del-bench="${i}" class="tc-link tc-danger">删除</button></div>`).join('') || '<p class="tc-muted">暂无对标链接。</p>'}</div>`;
  }
  function opsManageView() {
    const cfg = config();
    const groups = Array.isArray(cfg.opsGroups) ? cfg.opsGroups : [];
    const roles = cfg.opsRoles || {};
    if (!centerOpsGroup || !groups.includes(centerOpsGroup)) centerOpsGroup = groups[0] || '';
    const groupList = groups.length ? groups.map(g => {
      const cnt = Object.values(cfg.opsMembers).filter(x => x === g).length;
      return `<div class="tc-og-item${g === centerOpsGroup ? ' active' : ''}" data-og-pick="${esc(g)}"><span>${esc(g)} <small>(${cnt})</small></span><button type="button" class="tc-og-del" data-og-del="${esc(g)}" title="删除项目组">×</button></div>`;
    }).join('') : '<p class="tc-muted" style="font-size:12px">还没有项目组，先在下面添加一个。</p>';
    const members = centerOpsGroup ? Object.entries(cfg.opsMembers).filter(([, g]) => g === centerOpsGroup) : [];
    const memberRows = members.length ? members.map(([n]) => `<tr>
      <td style="text-align:left"><b>${esc(n)}</b></td>
      <td style="text-align:left">${esc(roles[n] || '运营')}</td>
      <td><button type="button" class="tc-link" data-om-edit="${esc(n)}">编辑</button> <button type="button" class="tc-link tc-danger" data-om-del="${esc(n)}">删除</button></td>
    </tr>`).join('') : '<tr><td colspan="3" class="tc-muted">这个组还没有成员，在下面添加。</td></tr>';
    return `<div class="panel" style="padding:18px"><h2>运营人员与项目组</h2>
      <p class="tc-muted">左侧先建项目组，点选组后在右侧添加成员和角色。登记后该姓名登录即进入「运营视角」，只能看到本组任务。</p>
      <div class="tc-og-layout">
        <div class="tc-og-side">
          <div class="tc-og-title">项目组</div>
          <div class="tc-og-list">${groupList}</div>
          <div class="tc-og-add"><input id="tcOgNew" placeholder="新项目组名称"><button type="button" id="tcOgAdd" class="tc-btn tc-primary">＋ 添加组</button></div>
        </div>
        <div class="tc-og-main">
          <div class="tc-og-title">${centerOpsGroup ? esc(centerOpsGroup) + ' · 成员' : '成员（请先选项目组）'}</div>
          <table class="tc-table"><thead><tr><th style="text-align:left">姓名</th><th style="text-align:left">角色</th><th>操作</th></tr></thead><tbody>${memberRows}</tbody></table>
          <div class="tc-og-add" style="margin-top:10px"><input id="tcOmName" placeholder="成员姓名"><input id="tcOmRole" placeholder="角色（如 运营/组长/模特）"><button type="button" id="tcOmAdd" class="tc-btn tc-primary" ${centerOpsGroup ? '' : 'disabled'}>＋ 添加成员</button></div>
        </div>
      </div>
    </div>`;
  }
  function permView() {
    const mine = config().permRequests.filter(p => p.by === me());
    return `<div class="panel" style="padding:18px"><h2>权限申请</h2>
      <p class="tc-muted">需要查看其它项目组或更大权限时，在这里提交申请，中台管理员审批。</p>
      <div class="tc-grid">
        <label>申请查看的项目组 <select id="tcPermGroup">${opts(config().opsGroups, '')}</select></label>
        <label>权限范围 <select id="tcPermScope">${opts(['查看该项目组', '查看全部项目组', '编辑权限'], '查看该项目组')}</select></label>
      </div>
      <label style="display:block;margin:10px 0">申请理由 <textarea id="tcPermReason" rows="2" placeholder="说明用途…"></textarea></label>
      <button type="button" id="tcPermSubmit" class="tc-btn tc-primary">提交申请</button>
      <h3>我的申请</h3>${mine.map(p => `<div class="tc-cfg-row">${esc(p.group)} · ${esc(p.scope)} — <span class="tc-status tc-s-${esc(p.status)}">${esc(p.status)}</span></div>`).join('') || '<p class="tc-muted">暂无</p>'}
    </div>`;
  }
  function permApproveView() {
    const list = config().permRequests;
    return `<div class="panel" style="padding:18px"><h2>权限申请审批</h2>
      ${list.map((p, i) => `<div class="tc-cfg-row"><b>${esc(p.by)}</b> 申请 ${esc(p.scope)}（${esc(p.group || '全部')}）— <span class="tc-status tc-s-${esc(p.status)}">${esc(p.status)}</span>
        ${p.status === '待审批' ? `<button type="button" data-perm-ok="${i}" class="tc-link">批准</button><button type="button" data-perm-no="${i}" class="tc-link tc-danger">拒绝</button>` : ''}</div>`).join('') || '<p class="tc-muted">暂无申请。</p>'}
    </div>`;
  }

  /* ================= 事件绑定 ================= */
  function bind(main) {
    const q = s => main.querySelector(s);
    const qa = s => [...main.querySelectorAll(s)];

    qa('[data-ops-tab]').forEach(b => b.onclick = () => { opsTab = b.dataset.opsTab; render(main); });
    qa('[data-center-tab]').forEach(b => b.onclick = () => {
      centerTab = b.dataset.centerTab;
      if (centerTab === 'detail') return;
      render(main);
    });
    qa('[data-open-req]').forEach(b => b.onclick = () => {
      if (isOps()) { opsTab = 'detail'; opsDetailId = b.dataset.openReq; }
      else { centerDetailId = b.dataset.openReq; centerTab = 'detail'; }
      // detail 视图：中台需要在 pending 容器内替换
      if (!isOps()) { render(main); const box = q('#tcCenterDetailHost'); if (box) box.innerHTML = centerDetail(requests().find(r => r.id === centerDetailId)); }
      else render(main);
    });

    // 中台 detail 需要在 renderCenter 里插入 host
    if (!isOps() && centerTab === 'detail') {
      const host = document.createElement('div'); host.id = 'tcCenterDetailHost';
      main.appendChild(host);
      host.innerHTML = centerDetail(requests().find(r => r.id === centerDetailId));
      bindDetail(host);
    }

    // 铃铛
    const bell = q('#tcBell'), bellList = q('#tcBellList');
    if (bell && bellList) bell.onclick = () => {
      bellList.hidden = !bellList.hidden;
      if (!bellList.hidden) {
        const ns = notices();
        bellList.innerHTML = ns.length ? ns.map(n => `<div class="tc-bell-item"><b>${esc(n.reqTitle)}</b> ${esc(n.text)}<button type="button" data-read-notice="${esc(n.reqId)}|${esc(n.at)}" class="tc-link">已读</button></div>`).join('') : '<div class="tc-muted">暂无新消息</div>';
        bellList.querySelectorAll('[data-read-notice]').forEach(b => b.onclick = () => {
          const [rid, at] = b.dataset.readNotice.split('|');
          const list = all(); const r = list.find(x => x.id === rid);
          if (r) { (r.history || []).forEach(h => { if (h.at === at) (h.readBy ??= []).push(me()); }); saveAll(list); }
          render(main);
        });
      }
    };

    bindForm(main);
    bindDetail(main);
    bindMisc(main);
  }

  function bindDetail(root) {
    if (!root) return;
    const q = s => root.querySelector(s);
    // 可编辑详情：添加/删除分镜行
    const addSbRow = q('#tcAddSbRow');
    if (addSbRow) addSbRow.onclick = () => {
      const box = q('#tcEditStoryboards');
      const i = box ? box.children.length : 0;
      box?.insertAdjacentHTML('beforeend', `<div class="tc-sb-row" data-sbrow>
        <input class="sb-seq" value="${i + 1}" style="width:42px">
        <input class="sb-content" placeholder="拍摄内容"><input class="sb-need" placeholder="拍摄需求">
        <input class="sb-link" placeholder="对标分镜链接"><button type="button" class="tc-sb-del tc-link" title="删除分镜">×</button></div>`);
      bindSbDel(root);
    };
    if (root.querySelector('#tcEditStoryboards')) bindSbDel(root);
    // 可编辑详情：保存全部
    const editForm = q('#tcEditForm');
    if (editForm) editForm.onsubmit = e => {
      e.preventDefault();
      const list = all(), r = list.find(x => x.id === editForm.dataset.req); if (!r) return;
      const fd = new FormData(editForm);
      const val = k => (fd.get(k) ?? '').toString().trim();
      const split = v => String(v || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean);
      const storyboards = [...root.querySelectorAll('#tcEditStoryboards [data-sbrow]')].map(row => ({
        seq: row.querySelector('.sb-seq')?.value || '', content: row.querySelector('.sb-content')?.value || '',
        need: row.querySelector('.sb-need')?.value || '', link: row.querySelector('.sb-link')?.value || ''
      })).filter(s => s.content || s.need || s.link);
      Object.assign(r, {
        title: val('title') || r.title, scriptTitle: r.scriptTitle || '', team: val('team'), group: val('group'),
        scriptKind: val('scriptKind') || '脚本', category: val('category'), publicTags: split(val('publicTags')),
        personalTags: split(val('personalTags')), originScript: val('originScript'),
        status: val('status') || r.status, priority: val('priority') || '常规', deliverType: val('deliverType'),
        deadline: val('deadline'), target: Number(val('target')) || 0, brief: r.brief || '',
        benchmarks: readBench(root), storyboards,
        models: fd.getAll('models'), done: Number(val('done')) || 0
      });
      const fb = val('feedback');
      if (fb) r.feedback = { text: fb, by: me(), at: now() };
      const cfg = config();
      benchList(r).forEach(x => { const u = x.url; if (u && !cfg.benchmarks.includes(u)) cfg.benchmarks.push(u); });
      if (val('asTemplate') === 'on' && val('templateName')) {
        cfg.templates.push({ name: val('templateName'), title: r.title, scriptTitle: r.scriptTitle, scriptKind: r.scriptKind, category: r.category, deliverType: r.deliverType, target: r.target, brief: r.brief, benchmarks: r.benchmarks, storyboards });
      }
      saveConfig(cfg);
      // 若已转排班，同步进度到关联任务
      if (r.linkedTaskId) {
        const tasks = read(TASKS_KEY, []);
        const t = tasks.find(x => x.id === r.linkedTaskId);
        if (t) { t.actual = r.done; t.target = r.target; t.deadline = r.deadline; t.status = r.status; t.priority = r.priority; write(TASKS_KEY, tasks); }
      }
      (r.history ??= []).push({ by: me(), at: now(), text: '编辑任务（任务中心）', readBy: [], kind: 'mid' });
      saveAll(list);
      const st = editForm.querySelector('[role="status"]'); if (st) st.textContent = '✓ 已保存';
    };
    // 跳转工作安排
    const goSched = q('#tcGoSchedule');
    if (goSched) goSched.onclick = () => { location.hash = '#/schedule'; };
    // 转为工作安排（复用 bindDetail 已有的 tcToSchedule 在下方）
    const addComment = q('#tcAddComment');
    if (addComment) addComment.onclick = () => {
      const input = q('#tcComment'), text = (input?.value || '').trim();
      if (!text) return;
      const list = all(), r = list.find(x => x.id === addComment.dataset.req);
      if (!r) return;
      (r.comments ??= []).push({ by: me(), at: now(), text });
      (r.history ??= []).push({ by: me(), at: now(), text: '添加讨论', readBy: [] });
      saveAll(list); render(root.closest('#main') || document.querySelector('#main'));
    };
    const saveProgress = q('#tcSaveProgress');
    if (saveProgress) saveProgress.onclick = () => {
      const list = all(), r = list.find(x => x.id === saveProgress.dataset.req); if (!r) return;
      const status = q('#tcStatus').value, done = Number(q('#tcDone').value) || 0, feedback = (q('#tcFeedback').value || '').trim(), urgent = q('#tcUrgent').checked;
      r.status = status; r.done = done; r.priority = urgent ? '加急' : '常规';
      if (feedback) r.feedback = { text: feedback, by: me(), at: now() };
      (r.history ??= []).push({ by: me(), at: now(), text: `更新进度：${status} ${done}条${urgent ? '（加急）' : ''}`, readBy: [] });
      saveAll(list); render(document.querySelector('#main'));
    };
    const saveModels = q('#tcSaveModels');
    if (saveModels) saveModels.onclick = () => {
      const list = all(), r = list.find(x => x.id === saveModels.dataset.req); if (!r) return;
      r.models = [...root.querySelectorAll('.tc-model input:checked')].map(c => c.value);
      (r.history ??= []).push({ by: me(), at: now(), text: '更新模特选择', readBy: [] });
      saveAll(list); render(document.querySelector('#main'));
    };
    const toSchedule = q('#tcToSchedule');
    if (toSchedule) toSchedule.onclick = () => {
      const list = all(), r = list.find(x => x.id === toSchedule.dataset.req); if (!r) return;
      const tasks = read(TASKS_KEY, []);
      const date = r.deadline || today();
      const newTask = {
        id: uid(), date, product: r.title, type: r.deliverType || '', title: r.title,
        lead: '', handModel: '', model: (r.models || []).join('、'), assistant: '', retouch: '',
        target: r.target || '', actual: '', dailyShotCount: '', notes: r.brief || '',
        status: '待拍摄', priority: r.priority || '常规', assigned: dateTime(date) + '', due: date + 'T18:00',
        requestId: r.id, group: r.group || ''
      };
      tasks.push(newTask); write(TASKS_KEY, tasks);
      r.linkedTaskId = newTask.id; r.status = '已排期';
      (r.history ??= []).push({ by: me(), at: now(), text: '转为工作安排任务', readBy: [] });
      saveAll(list);
      try { window.dispatchEvent(new Event('studio-team-refresh')); } catch {}
      if (confirm('已转为工作安排任务。是否立即前往「工作安排」查看？')) location.hash = '#/schedule';
      else render(document.querySelector('#main'));
    };
  }
  function dateTime(d) { return (d || today()) + 'T09:00'; }

  function bindForm(main) {
    const form = main.querySelector('#tcForm'); if (!form) return;
    main.querySelector('#tcAddSb')?.addEventListener('click', () => {
      const box = main.querySelector('#tcStoryboards');
      box.insertAdjacentHTML('beforeend', sbRow({}, box.children.length));
      bindSbDel(main);
    });
    bindSbDel(main);
    const tpl = main.querySelector('#tcTemplate');
    if (tpl) tpl.onchange = () => {
      const t = config().templates[Number(tpl.value)]; if (!t) return;
      form.elements.title.value = t.title || ''; form.elements.deliverType.value = t.deliverType || DELIVER[0];
      form.elements.target.value = t.target || ''; form.elements.brief.value = t.brief || '';
      if (form.elements.scriptKind) form.elements.scriptKind.value = t.scriptKind || '脚本';
      if (form.elements.category) form.elements.category.value = t.category || '';
      const benchBox = main.querySelector('#tcForm .tc-bench-rows');
      if (benchBox) benchBox.innerHTML = benchRowsHTML(t.benchmarks || []);
      if (t.storyboards) { main.querySelector('#tcStoryboards').innerHTML = t.storyboards.map((s, i) => sbRow(s, i)).join(''); bindSbDel(main); }
    };
    form.onsubmit = e => {
      e.preventDefault();
      const fd = new FormData(form), status = form.querySelector('[role="status"]');
      const title = (fd.get('title') || '').trim();
      if (!title) { status.textContent = '请填写任务名称'; return; }
      const storyboards = [...main.querySelectorAll('#tcStoryboards .tc-sb-row')].map(row => ({
        seq: row.querySelector('.sb-seq').value, content: row.querySelector('.sb-content').value,
        need: row.querySelector('.sb-need').value, link: row.querySelector('.sb-link').value
      })).filter(s => s.content || s.need || s.link);
      const splitTags = v => String(v || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean);
      const benchmarks = readBench(main.querySelector('#tcForm'));
      const editId = form.dataset.edit;
      const list = all();
      const r = editId ? list.find(x => x.id === editId) : { id: uid(), creator: me(), createdAt: now(), status: '待处理', done: 0, history: [], comments: [] };
      if (!r) { status.textContent = '任务不存在'; return; }
      Object.assign(r, {
        title, scriptTitle: (fd.get('scriptTitle') || '').trim(), team: (fd.get('team') || '').trim(),
        scriptKind: fd.get('scriptKind') || '脚本', category: (fd.get('category') || '').trim(),
        publicTags: splitTags(fd.get('publicTags')), personalTags: splitTags(fd.get('personalTags')),
        originScript: (fd.get('originScript') || '').trim(),
        group: fd.get('group') || '', deliverType: fd.get('deliverType'), deadline: fd.get('deadline') || '',
        priority: fd.get('priority'), target: Number(fd.get('target')) || 0, brief: fd.get('brief') || '',
        benchmarks, storyboards, models: r.models || []
      });
      // 对标库沉淀
      const cfg = config();
      benchmarks.forEach(x => { const u = x.url || x; if (u && !cfg.benchmarks.includes(u)) cfg.benchmarks.push(u); });
      // 存模板
      if (fd.get('saveAsTemplate') && (fd.get('templateName') || '').trim()) {
        cfg.templates.push({ name: fd.get('templateName').trim(), title: r.title, scriptTitle: r.scriptTitle, scriptKind: r.scriptKind, category: r.category, deliverType: r.deliverType, target: r.target, brief: r.brief, benchmarks, storyboards });
      }
      saveConfig(cfg);
      if (!editId) list.push(r);
      (r.history ??= []).push({ by: me(), at: now(), text: editId ? '编辑任务' : '下发任务', readBy: [] });
      saveAll(list);
      opsTab = 'list'; render(document.querySelector('#main'));
    };
  }
  function bindSbDel(main) {
    main.querySelectorAll('.tc-sb-del').forEach(b => b.onclick = () => { b.closest('.tc-sb-row')?.remove(); });
  }

  function bindMisc(main) {
    const qa = s => [...main.querySelectorAll(s)];
    // 用模板下发：以模板内容新建一个任务并打开编辑
    qa('[data-use-template]').forEach(b => b.onclick = () => {
      const t = config().templates[Number(b.dataset.useTemplate)]; if (!t) return;
      const list = all();
      const r = {
        id: uid(), creator: me(), createdAt: now(), status: '待处理', done: 0, history: [], comments: [],
        title: (t.title || t.name || '模板任务'), scriptTitle: t.scriptTitle || '', scriptKind: t.scriptKind || '脚本',
        team: settings().leader || '', group: isOps() ? myGroup() : '', category: t.category || '',
        deliverType: t.deliverType || DELIVER[0], target: t.target || 0, brief: t.brief || '', need: t.need || '',
        benchmarks: t.benchmarks || [], storyboards: [], models: [], publicTags: [], personalTags: [], originScript: ''
      };
      (r.history ??= []).push({ by: me(), at: now(), text: '由模板「' + (t.name || '任务') + '」创建', readBy: [] });
      list.push(r); saveAll(list);
      if (isOps()) { opsTab = 'detail'; opsDetailId = r.id; }
      else { centerTab = 'detail'; centerDetailId = r.id; }
      render(document.querySelector('#main'));
    });
    // 模板页：新建/取消/加行/保存/编辑
    const tplNew = main.querySelector('#tcTplNew');
    if (tplNew) tplNew.onclick = () => { tplFormOpen = true; tplFormEditIndex = -1; render(main); };
    const tplCancel = main.querySelector('#tcTplCancel');
    if (tplCancel) tplCancel.onclick = () => { tplFormOpen = false; tplFormEditIndex = -1; render(main); };
    // 标签面板：点＋展开，点选/增删标签就地操作，不重绘表单（避免丢失已填内容）
    const tagInputName = { tplCategories: 'category', tplDeliverTypes: 'deliverType', tplScriptKinds: 'scriptKind' };
    const tagDatalistId = { tplCategories: 'tcTplCatOpts', tplDeliverTypes: 'tcTplDeliverOpts', tplScriptKinds: 'tcTplScriptOpts' };
    qa('[data-tag-open]').forEach(b => b.onclick = () => {
      const panel = main.querySelector('[data-tag-panel="' + b.dataset.tagOpen + '"]');
      if (!panel) return;
      qa('[data-tag-panel]').forEach(p => { if (p !== panel) p.hidden = true; });
      panel.hidden = !panel.hidden;
    });
    qa('[data-tag-pick]').forEach(chip => chip.onclick = ev => {
      if (ev.target.closest('[data-tag-del]')) return;
      const panel = chip.closest('[data-tag-panel]'); if (!panel) return;
      const input = main.querySelector('[name="' + (tagInputName[panel.dataset.tagPanel] || '') + '"]');
      if (input) input.value = chip.dataset.tagPick;
      panel.hidden = true;
    });
    qa('[data-tag-del]').forEach(btn => btn.onclick = ev => {
      ev.stopPropagation();
      const key = btn.closest('[data-tag-panel]').dataset.tagPanel;
      const val = btn.dataset.tagDel; const cfg = config();
      cfg[key] = (cfg[key] || []).filter(v => v !== val); saveConfig(cfg);
      btn.closest('[data-tag-chip]')?.remove();
      const dl = main.querySelector('#' + tagDatalistId[key]);
      dl?.querySelector('option[value="' + CSS.escape(val) + '"]')?.remove();
    });
    qa('.tc-tag-new-add').forEach(add => add.onclick = () => {
      const panel = add.closest('[data-tag-panel]'); const key = panel.dataset.tagPanel;
      const input = panel.querySelector('.tc-tag-new-input'); const val = (input.value || '').trim();
      if (!val) { input.focus(); return; }
      const cfg = config(); const list = Array.isArray(cfg[key]) ? cfg[key] : [];
      if (!list.includes(val)) {
        list.push(val); cfg[key] = list; saveConfig(cfg);
        panel.querySelector('.tc-tag-chips').insertAdjacentHTML('beforeend', `<span class="tc-tag-chip" data-tag-pick="${esc(val)}">${esc(val)}<button type="button" class="tc-tag-chip-del" data-tag-del="${esc(val)}" title="删除">×</button></span>`);
        const dl = main.querySelector('#' + tagDatalistId[key]);
        dl?.insertAdjacentHTML('beforeend', `<option value="${esc(val)}"></option>`);
        const chip = panel.querySelector('.tc-tag-chips .tc-tag-chip:last-child');
        chip.onclick = ev => { if (ev.target.closest('[data-tag-del]')) return; const p = chip.closest('[data-tag-panel]'); const inp = main.querySelector('[name="' + (tagInputName[p.dataset.tagPanel] || '') + '"]'); if (inp) inp.value = val; p.hidden = true; };
        chip.querySelector('[data-tag-del]').onclick = ev => {
          ev.stopPropagation(); const cfg2 = config(); cfg2[key] = (cfg2[key] || []).filter(v => v !== val); saveConfig(cfg2); chip.remove();
          main.querySelector('#' + tagDatalistId[key])?.querySelector('option[value="' + CSS.escape(val) + '"]')?.remove();
        };
      }
      input.value = ''; input.focus();
    });
    qa('.tc-tag-new-input').forEach(inp => inp.onkeydown = ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); inp.closest('.tc-tag-panel').querySelector('.tc-tag-new-add').click(); }
    });
    qa('[data-edit-template]').forEach(b => b.onclick = () => { tplFormOpen = true; tplFormEditIndex = Number(b.dataset.editTemplate); render(main); });
    const tplFormEl = main.querySelector('#tcTplForm');
    if (tplFormEl) {
      tplFormEl.onsubmit = ev => {
        ev.preventDefault();
        const fd = new FormData(tplFormEl);
        const name = (fd.get('name') || '').trim(); if (!name) return;
        const tpl = {
          name, deliverType: (fd.get('deliverType') || '').trim(), scriptTitle: '',
          scriptKind: (fd.get('scriptKind') || '').trim(), category: (fd.get('category') || '').trim(), target: Number(fd.get('target'))||0,
          brief: (fd.get('brief') || '').trim(), need: (fd.get('need') || '').trim(), benchmarks: readBench(tplFormEl)
        };
        const cfg = config();
        const idx = Number(tplFormEl.dataset.index);
        if (idx >= 0 && cfg.templates[idx]) cfg.templates[idx] = tpl; else cfg.templates.push(tpl);
        saveConfig(cfg);
        tplFormOpen = false; tplFormEditIndex = -1;
        render(document.querySelector('#main'));
      };
    }
    qa('[data-copy-req]').forEach(b => b.onclick = () => {
      const r = requests().find(x => x.id === b.dataset.copyReq); if (!r) return;
      opsTab = 'new';
      const clone = { ...r, id: '', title: r.title + '（副本）', createdAt: '', createdBy: me() };
      // 直接渲染带值的表单
      main.innerHTML = renderOpsHeader() + taskForm(clone, true);
      opsTab = 'new'; bind(main); bindForm(main);
    });
    qa('[data-open-req]').forEach(b => { /* handled in bind */ });
    qa('[data-terminate-req]').forEach(b => b.onclick = () => {
      const reason = prompt('请输入终止原因：', ''); if (reason == null) return;
      const list = all(), r = list.find(x => x.id === b.dataset.terminateReq); if (!r) return;
      r.status = '已终止'; r.terminateReason = reason;
      (r.history ??= []).push({ by: me(), at: now(), text: '终止任务：' + reason, readBy: [] });
      saveAll(list); render(main);
    });
    qa('[data-accept-req]').forEach(b => b.onclick = () => {
      const list = all(), r = list.find(x => x.id === b.dataset.acceptReq); if (!r) return;
      r.status = '已交付'; r.acceptedAt = now();
      (r.history ??= []).push({ by: me(), at: now(), text: '验收通过', readBy: [] });
      saveAll(list); render(main);
    });
    qa('[data-reject-req]').forEach(b => b.onclick = () => {
      const reason = prompt('打回原因：', ''); if (!reason) return;
      const list = all(), r = list.find(x => x.id === b.dataset.rejectReq); if (!r) return;
      r.status = '拍摄中'; r.rejectReason = reason;
      (r.history ??= []).push({ by: me(), at: now(), text: '打回修改：' + reason, readBy: [] });
      saveAll(list); render(main);
    });
    // 配置：运营人员与项目组（两级：组 → 成员/角色）
    qa('[data-og-pick]').forEach(b => b.onclick = () => { centerOpsGroup = b.dataset.ogPick; render(main); });
    const ogAdd = main.querySelector('#tcOgAdd');
    if (ogAdd) ogAdd.onclick = () => {
      const inp = main.querySelector('#tcOgNew'); const name = (inp.value || '').trim(); if (!name) return;
      const cfg = config(); cfg.opsGroups = cfg.opsGroups || [];
      if (!cfg.opsGroups.includes(name)) { cfg.opsGroups.push(name); centerOpsGroup = name; saveConfig(cfg); render(main); }
    };
    qa('[data-og-del]').forEach(b => b.onclick = ev => {
      ev.stopPropagation(); const g = b.dataset.ogDel; const cfg = config();
      cfg.opsGroups = (cfg.opsGroups || []).filter(x => x !== g);
      Object.keys(cfg.opsMembers).forEach(n => { if (cfg.opsMembers[n] === g) delete cfg.opsMembers[n]; });
      if (centerOpsGroup === g) centerOpsGroup = '';
      saveConfig(cfg); render(main);
    });
    const omAdd = main.querySelector('#tcOmAdd');
    if (omAdd) omAdd.onclick = () => {
      if (!centerOpsGroup) return;
      const nInp = main.querySelector('#tcOmName'), rInp = main.querySelector('#tcOmRole');
      const name = (nInp.value || '').trim(), role = (rInp.value || '').trim();
      if (!name) return;
      const cfg = config(); cfg.opsMembers[name] = centerOpsGroup;
      cfg.opsRoles = cfg.opsRoles || {}; cfg.opsRoles[name] = role || '运营';
      saveConfig(cfg); render(main);
    };
    qa('[data-om-edit]').forEach(b => b.onclick = () => {
      const name = b.dataset.omEdit; const cfg = config(); cfg.opsRoles = cfg.opsRoles || {};
      const role = prompt('编辑「' + name + '」的角色：', cfg.opsRoles[name] || '运营');
      if (role != null) { cfg.opsRoles[name] = role.trim() || '运营'; saveConfig(cfg); render(main); }
    });
    qa('[data-om-del]').forEach(b => b.onclick = () => {
      const name = b.dataset.omDel; const cfg = config();
      delete cfg.opsMembers[name]; if (cfg.opsRoles) delete cfg.opsRoles[name];
      saveConfig(cfg); render(main);
    });
    const benchAdd = main.querySelector('#tcBenchAdd');
    if (benchAdd) benchAdd.onclick = () => {
      const v = main.querySelector('#tcBenchInput').value.trim(); if (!v) return;
      const cfg = config(); if (!cfg.benchmarks.includes(v)) cfg.benchmarks.push(v); saveConfig(cfg); render(main);
    };
    qa('[data-del-bench]').forEach(b => b.onclick = () => { const cfg = config(); cfg.benchmarks.splice(Number(b.dataset.delBench), 1); saveConfig(cfg); render(main); });
    qa('[data-del-template]').forEach(b => b.onclick = () => { const cfg = config(); cfg.templates.splice(Number(b.dataset.delTemplate), 1); saveConfig(cfg); render(main); });
    // 权限申请
    const permSubmit = main.querySelector('#tcPermSubmit');
    if (permSubmit) permSubmit.onclick = () => {
      const cfg = config();
      cfg.permRequests.push({ by: me(), group: main.querySelector('#tcPermGroup').value, scope: main.querySelector('#tcPermScope').value, reason: main.querySelector('#tcPermReason').value.trim(), status: '待审批', at: now() });
      saveConfig(cfg); render(main);
    };
    qa('[data-perm-ok]').forEach(b => b.onclick = () => { const cfg = config(); cfg.permRequests[Number(b.dataset.permOk)].status = '已批准'; saveConfig(cfg); render(main); });
    qa('[data-perm-no]').forEach(b => b.onclick = () => { const cfg = config(); cfg.permRequests[Number(b.dataset.permNo)].status = '已拒绝'; saveConfig(cfg); render(main); });
    // 导出
    const exp = main.querySelector('#tcExport');
    if (exp) exp.onclick = () => exportCSV(requests().filter(canSeeRequest));
  }
  function renderOpsHeader() {
    const group = myGroup();
    return `<div class="tc-hero"><div><div class="tc-eyebrow">OPERATIONS / 需求下发</div><h1>任务中心</h1><p>${esc(group ? group + ' · ' : '')}在这里下发拍摄需求，跟踪交付进度。</p></div></div>`;
  }
  function exportCSV(list) {
    const head = ['任务ID', '任务名称', '项目组', '交付类型', '截止', '状态', '优先级', '完成', '目标', '创建人', '创建时间'];
    const rows = list.map(r => { const p = progressOf(r); return [r.id, r.title, r.group, r.deliverType, r.deadline, r.status, r.priority, p.done, p.target, r.creator, r.createdAt]; });
    const csv = '\uFEFF' + [head, ...rows].map(row => row.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = '任务中心报表_' + today() + '.csv'; a.click();
  }

  /* 对标链接编辑器：增删行 + 跳转预览（事件委托，render 重建后仍有效） */
  document.addEventListener('click', e => {
    const add = e.target.closest?.('.bench-add');
    if (add) { const rows = add.closest('.tc-bench-editor')?.querySelector('.tc-bench-rows'); if (rows) rows.insertAdjacentHTML('beforeend', benchRowsHTML([{}])); return; }
    const del = e.target.closest?.('.bench-del');
    if (del) { const row = del.closest('.tc-bench-row'); if (row) {
      const rows = row.parentElement;
      if (rows && rows.children.length > 1) row.remove();
      else { const n = row.querySelector('.bench-name'), u = row.querySelector('.bench-url'); if (n) n.value=''; if (u) u.value=''; const j=row.querySelector('.bench-jump'); if(j){j.className='bench-jump bench-jump-ph';j.removeAttribute('href');} }
    } return; }
    const jump = e.target.closest?.('.bench-jump');
    if (jump && jump.tagName === 'A' && jump.href) { e.preventDefault(); window.open(jump.href, '_blank', 'noopener'); return; }
  });
  document.addEventListener('input', e => {
    if (!e.target.classList?.contains('bench-url')) return;
    const row = e.target.closest('.tc-bench-row'); if (!row) return;
    const j = row.querySelector('.bench-jump'); if (!j) return;
    const url = e.target.value.trim();
    if (url) { j.className = 'bench-jump'; j.setAttribute('href', /^https?:\/\//i.test(url) ? url : 'https://' + url); }
    else { j.className = 'bench-jump bench-jump-ph'; j.removeAttribute('href'); }
  });

  /* team-sync 刷新后重绘当前标签 */
  window.addEventListener('studio-team-refresh', () => {
    const main = document.querySelector('#main');
    if (main && (location.hash.slice(2) === 'tasks')) render(main);
  });

  window.StudioTasks = { render, isOps, myGroup, requests, config };
})();
