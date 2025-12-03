/**
 * Workers.js 代码工具 - 仅保留代码编辑器，支持自定义名称保存。
 *
 * 验证模式：单访问令牌/密码 (ACCESS_PASSWORD)
 * 验证方式：URL参数 (?token=) 或 HTTP头 (X-Access-Token)
 * 状态码：未授权访问返回 403 Forbidden，以避免浏览器弹出原生 Basic Auth 弹窗。
 */

export default {
    async fetch(request, env, ctx) {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        // 注意：现在 API 请求需要 Content-Type: application/json
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Token', 
      };
  
      const url = new URL(request.url);
  
      // 0. 访问密码验证 (如果 ACCESS_PASSWORD 环境变量已设置)
      if (env.ACCESS_PASSWORD) {
          const expectedPassword = env.ACCESS_PASSWORD;
          // 尝试从请求头或 URL 参数中获取令牌
          const requestToken = request.headers.get('X-Access-Token') || url.searchParams.get('token');
  
          if (requestToken !== expectedPassword) {
              // 返回 403 Forbidden 页面和密码输入框，以阻止浏览器弹出原生的 Basic Auth 认证框。
              const unauthorizedHtml = `<!DOCTYPE html>
              <html lang="zh-CN">
              <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>需要访问令牌</title>
                  <style>
                      body { font-family: sans-serif; text-align: center; padding-top: 50px; background: #f4f4f4; }
                      .box { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: inline-block; max-width: 350px; }
                      h2 { color: #667eea; margin-bottom: 20px; }
                      input[type="password"] { padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px; width: 100%; box-sizing: border-box; }
                      button { padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; transition: background 0.3s; }
                      button:hover { background: #764ba2; }
                  </style>
              </head>
              <body>
                  <div class="box">
                      <h2>🔒 需要访问令牌</h2>
                      <p>请输入访问令牌/密码以继续操作。</p>
                      <form onsubmit="event.preventDefault(); window.location.href=window.location.pathname+'?token=' + document.getElementById('tokenInput').value;">
                          <input type="password" id="tokenInput" placeholder="访问令牌/密码" required>
                          <button type="submit">提交</button>
                      </form>
                      <p style="font-size:0.8em; color:#999; margin-top: 15px;">（API 请求请使用 X-Access-Token 头）</p>
                  </div>
              </body>
              </html>`;
              
              return new Response(unauthorizedHtml, {
                  status: 403, // 更改为 403 Forbidden
                  headers: {
                      'Content-Type': 'text/html; charset=UTF-8',
                      // 移除 WWW-Authenticate 头
                  },
              });
          }
      }
  
  
      // 1. 处理 CORS 预检
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 200,
          headers: corsHeaders,
        });
      }
  
      // 2. API: 保存代码到 KV (POST /api/save)
      if (url.pathname === '/api/save' && request.method === 'POST') {
        try {
          if (!env.CODE_KV) {
            throw new Error('KV 未绑定，请在后台设置 CODE_KV');
          }
          
          // **!!! 关键修改：从请求 body 中解析 JSON 数据 !!!**
          const body = await request.json(); 
          const text = body.code;
          let customId = body.id; // 获取自定义 ID
          
          if (!text || text.trim().length === 0) {
            return new Response(JSON.stringify({ error: '内容不能为空' }), { status: 400, headers: corsHeaders });
          }
          
          let id;
          if (customId) {
            // 验证并清理 ID (仅允许字母数字、连字符和下划线，转为小写)
            customId = customId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
            
            if (customId.length < 3 || customId.length > 50) {
               return new Response(JSON.stringify({ error: '自定义名称长度须在 3-50 字符之间' }), { status: 400, headers: corsHeaders });
            }
            
            // 检查 ID 是否已存在 (如果存在则不允许覆盖)
            const existingCode = await env.CODE_KV.get(customId);
            if (existingCode !== null) {
              return new Response(JSON.stringify({ error: `名称 '${customId}' 已存在。请更换一个名称。` }), { status: 409, headers: corsHeaders });
            }
            id = customId;
          } else {
            // 生成 8 位随机 ID
            id = crypto.randomUUID().substring(0, 8);
          }
  
          // 存入 KV (默认过期时间 30 天)
          await env.CODE_KV.put(id, text, { expirationTtl: 60 * 60 * 24 * 30 });
          
          return new Response(JSON.stringify({ success: true, id: id }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } catch (err) {
          // 如果 JSON 解析失败，会进入这里
          return new Response(JSON.stringify({ error: err.message || '无效的请求格式，请确保内容是 JSON。' }), { status: 500, headers: corsHeaders });
        }
      }
  
      // 3. API: 获取代码 (GET /api/get?id=xxx)
      if (url.pathname === '/api/get' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (id && env.CODE_KV) {
          const code = await env.CODE_KV.get(id);
          if (code) {
            return new Response(JSON.stringify({ code: code }), {
               headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
      }
      
      // 4. API: 删除代码 (DELETE /api/delete?id=xxx)
      if (url.pathname === '/api/delete' && request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!id) {
          return new Response(JSON.stringify({ error: '缺少 ID 参数' }), { status: 400, headers: corsHeaders });
        }
        if (!env.CODE_KV) {
            return new Response(JSON.stringify({ error: 'KV 未绑定' }), { status: 500, headers: corsHeaders });
        }
  
        try {
          await env.CODE_KV.delete(id);
          
          return new Response(JSON.stringify({ success: true, id: id }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }
  
      // 5. API: 列出所有代码 ID (GET /api/list)
      if (url.pathname === '/api/list' && request.method === 'GET') {
        if (!env.CODE_KV) {
            return new Response(JSON.stringify({ error: 'KV 未绑定' }), { status: 500, headers: corsHeaders });
        }
        try {
          // 列出所有 Key，不获取 Value
          const listResult = await env.CODE_KV.list();
          
          const ids = listResult.keys.map(key => key.name);
  
          return new Response(JSON.stringify({ 
              success: true, 
              ids: ids, 
              list_complete: listResult.list_complete 
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }
  
      // 6. 返回前端 HTML 页面
      const htmlContent = `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Workers.js 代码存储工具</title>
      <style>
          *{margin:0;padding:0;box-sizing:border-box}
          body{font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;padding:20px}
          .container{max-width:1400px;margin:0 auto;background:rgba(255,255,255,0.95);border-radius:15px;box-shadow:0 20px 40px rgba(0,0,0,0.1);overflow:hidden}
          header{background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);color:white;padding:30px;text-align:center;position:relative}
          header h1{font-size:2.5em;margin-bottom:10px;text-shadow:2px 2px 4px rgba(0,0,0,0.3)}
          header p{font-size:1.2em;opacity:0.9}
          /* 布局修改：只保留一列 */
          .main-content{display:block;padding:30px} 
          .editor-section{background:white;border-radius:10px;box-shadow:0 5px 15px rgba(0,0,0,0.08);overflow:hidden;display:flex;flex-direction:column}
          .section-header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:15px 20px;font-weight:bold;display:flex;justify-content:space-between;align-items:center}
          
          /* Key 输入区域样式 */
          .key-input-wrapper {
              padding: 10px 20px 0;
              background: #f0f0f5;
              border-bottom: 1px solid #e0e0e0;
          }
          .key-input-wrapper label {
              font-size: 14px;
              font-weight: 600;
              color: #444;
              display: block;
              margin-bottom: 5px;
          }
          #customKeyInput {
              width: 100%;
              padding: 8px;
              border: 1px solid #ccc;
              border-radius: 4px;
              box-sizing: border-box;
              margin-bottom: 10px;
          }
  
          .editor-wrapper{padding:20px;height:70vh;min-height:400px;overflow:auto;flex-grow:1} /* 增加高度 */
          #codeInput{width:100%;height:100%;border:2px solid #e0e0e0;border-radius:8px;padding:15px;font-family:"Consolas","Monaco","Courier New",monospace;font-size:14px;resize:none;outline:none;transition:border-color 0.3s}
          #codeInput:focus{border-color:#667eea}
          .controls{padding:20px 30px;background:#f8f9fa;display:flex;gap:15px;flex-wrap:wrap;justify-content:center}
          button{padding:12px 24px;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;transition:all 0.3s;display:flex;align-items:center;gap:8px}
          
          .btn-primary{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white}
          .btn-primary:hover{transform:translateY(-2px);box-shadow:0 5px 15px rgba(102,126,234,0.4)}
          
          .btn-success{background:linear-gradient(135deg,#42e695 0%,#3bb2b8 100%);color:white}
          .btn-success:hover{transform:translateY(-2px);box-shadow:0 5px 15px rgba(66,230,149,0.4)}
          .btn-success:disabled{opacity:0.7;cursor:not-allowed;transform:none}
          
          .btn-secondary{background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);color:white}
          .btn-secondary:hover{transform:translateY(-2px);box-shadow:0 5px 15px rgba(240,147,251,0.4)}
          
          .btn-danger{background:linear-gradient(135deg,#ff6b6b 0%,#ee5a24 100%);color:white}
          .btn-danger:hover{transform:translateY(-2px);box-shadow:0 5px 15px rgba(255,107,107,0.4)}
          .btn-danger:disabled{opacity:0.7;cursor:not-allowed;transform:none}
          
          .toast{position:fixed;top:20px;right:20px;background:#28a745;color:white;padding:15px 20px;border-radius:8px;box-shadow:0 5px 15px rgba(0,0,0,0.2);opacity:0;transform:translateY(-20px);transition:all 0.3s;z-index:1000}
          .toast.error{background:#dc3545}
          .toast.show{opacity:1;transform:translateY(0)}
          
          .loading-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.8);display:none;justify-content:center;align-items:center;z-index:10}
          .spinner{width:40px;height:40px;border:4px solid #f3f3f3;border-top:4px solid #667eea;border-radius:50%;animation:spin 1s linear infinite}
          @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
          
          /* Modal Styles */
          .modal-overlay {
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background: rgba(0, 0, 0, 0.6);
              display: none; 
              justify-content: center;
              align-items: center;
              z-index: 1000;
          }
          .modal-overlay.active {
              display: flex;
          }
          .modal-content {
              background: white;
              padding: 20px;
              border-radius: 10px;
              width: 90%;
              max-width: 600px;
              max-height: 80vh;
              overflow: hidden;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
              display: flex;
              flex-direction: column;
          }
          .modal-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 1px solid #eee;
              padding-bottom: 10px;
              margin-bottom: 10px;
          }
          .modal-header h2 {
              margin: 0;
              color: #667eea;
          }
          .close-btn {
              background: none;
              border: none;
              font-size: 24px;
              cursor: pointer;
              color: #999;
              line-height: 1;
          }
          .modal-body {
              flex-grow: 1;
              overflow-y: auto;
              padding-right: 5px; 
          }
          .list-item {
              padding: 8px 10px;
              border-bottom: 1px dashed #eee;
              cursor: pointer;
              color: #005cc5;
              font-family: monospace;
              font-weight: bold;
              transition: background 0.2s;
          }
          .list-item:hover {
              background: #f8f9fa;
              text-decoration: underline;
          }
          .list-empty, .list-hint {
              text-align: center;
              color: #999;
              padding: 10px;
              font-size: 0.9em;
          }
          @media (max-width:768px){
              .main-content{padding:20px}
              header h1{font-size:2em}
              .controls{flex-direction:column;align-items:stretch}
              .modal-content{max-height: 90vh; width: 95%;}
          }
      </style>
  </head>
  <body>
      <div class="container">
          <header>
              <h1>🚀 Workers.js 代码存储工具</h1>
              <p>基于 Cloudflare Workers KV 的代码片段存储与共享工具</p>
          </header>
          
          <div class="main-content">
              <div class="editor-section">
                  <div class="section-header">
                      <span>📝 代码编辑器</span>
                      <span id="inputStats">0 行 · 0 字符</span>
                  </div>
                  
                  <div class="key-input-wrapper">
                      <label for="customKeyInput">自定义名称/ID (可选):</label>
                      <input type="text" id="customKeyInput" placeholder="例如: my-worker-function-v2 (不填则自动生成 ID)" maxlength="50">
                  </div>
  
                  <div class="editor-wrapper" style="position:relative">
                      <textarea id="codeInput" placeholder="在此输入您的代码..."></textarea>
                      <div id="loadingOverlay" class="loading-overlay"><div class="spinner"></div></div>
                  </div>
              </div>
              
              </div>
  
          <div class="controls">
              <button class="btn-success" id="btnSave" onclick="saveToCloud()"><span>☁️</span> 保存/分享</button>
              <button class="btn-secondary" onclick="copyCode()"><span>📑</span> 复制代码</button>
              <button class="btn-secondary" onclick="showSavedList()"><span>📋</span> 查看列表</button>
              <button class="btn-danger" id="btnDelete" onclick="deleteCodePrompt()" disabled>
                  <span>❌</span> 删除此代码
              </button>
              <button class="btn-danger" onclick="clearAll()"><span>🗑️</span> 清空内容</button>
          </div>
  
          </div>
      
      <div id="toast" class="toast"></div>
  
      <div id="listModal" class="modal-overlay">
          <div class="modal-content">
              <div class="modal-header">
                  <h2>已保存的代码片段 ID</h2>
                  <button class="close-btn" onclick="closeSavedList()">&times;</button>
              </div>
              <div id="listBody" class="modal-body">
                  <p class="list-empty">加载中...</p>
              </div>
              <div class="modal-footer">
                  <p class="list-hint">点击 ID 即可加载代码。</p>
              </div>
          </div>
      </div>
  
      <script>
          let highlightTimeout;
  
          function getLoadedId() {
              const urlParams = new URLSearchParams(window.location.search);
              return urlParams.get('id');
          }
  
          function getAuthToken() {
              const urlParams = new URLSearchParams(window.location.search);
              return urlParams.get('token');
          }
  
          function updateDeleteButton() {
              const id = getLoadedId();
              const btnDelete = document.getElementById("btnDelete");
              
              if (id) {
                  btnDelete.disabled = false;
                  btnDelete.title = '删除当前加载的代码片段 (ID: ' + id + ')';
              } else {
                  btnDelete.disabled = true;
                  btnDelete.title = '请先通过链接加载代码才能删除';
              }
          }
  
          document.addEventListener("DOMContentLoaded", function(){
              const codeInput=document.getElementById("codeInput");
              codeInput.addEventListener("input",handleInput);
              
              const id = getLoadedId();
              if(id){
                  loadCodeFromCloud(id);
              }
              
              updateDeleteButton();
          });
  
          function handleInput(){
              clearTimeout(highlightTimeout);
              // 延迟更新字符统计信息
              highlightTimeout=setTimeout(function(){updateInputStats()},200);
          }
  
          // --- List Functions ---
          function showSavedList() {
              const modal = document.getElementById('listModal');
              modal.classList.add('active');
              fetchSavedList();
          }
  
          function closeSavedList() {
              document.getElementById('listModal').classList.remove('active');
          }
  
          async function fetchSavedList() {
              const listBody = document.getElementById('listBody');
              listBody.innerHTML = '<p class="list-empty">加载中... <div class="spinner" style="margin:10px auto;"></div></p>';
              
              const token = getAuthToken();
              const headers = token ? { 'X-Access-Token': token } : {};
  
              try {
                  const response = await fetch('/api/list', { headers });
                  const data = await response.json();
  
                  if (response.ok && data.success) {
                      if (data.ids && data.ids.length > 0) {
                          listBody.innerHTML = '';
                          data.ids.forEach(id => {
                              const item = document.createElement('div');
                              item.className = 'list-item';
                              item.textContent = id;
                              item.onclick = () => {
                                  const tokenParam = token ? '&token=' + token : '';
                                  window.location.href = window.location.pathname + '?id=' + id + tokenParam;
                                  closeSavedList();
                              };
                              listBody.appendChild(item);
                          });
                          
                          if (!data.list_complete) {
                              const hint = document.createElement('p');
                              hint.style.cssText = 'font-size:0.8em; color:orange; margin-top:10px; text-align:center;';
                              hint.textContent = '注意：列表可能不完整（Cloudflare KV限制）。';
                              listBody.appendChild(hint);
                          }
  
                      } else {
                          listBody.innerHTML = '<p class="list-empty">暂无保存的代码片段。</p>';
                      }
                  } else {
                      listBody.innerHTML = '<p class="list-empty" style="color:red;">加载列表失败: ' + (data.error || 'API 错误') + '</p>';
                  }
              } catch (e) {
                  listBody.innerHTML = '<p class="list-empty" style="color:red;">网络连接失败或 KV 未正确绑定。</p>';
              }
          }
          // --- End List Functions ---
          
          function getAuthHeaders(includeContentType = true) {
              const token = getAuthToken();
              const headers = {};
              if (token) headers['X-Access-Token'] = token;
              // 注意: 在 saveToCloud 中我们会手动设置 Content-Type: application/json
              // 在其他 API (GET/DELETE/LIST) 中不需要 Content-Type
              return headers; 
          }
  
          async function saveToCloud() {
              const code = document.getElementById("codeInput").value;
              // **!!! 关键修改：获取自定义 Key/ID !!!**
              const customKey = document.getElementById("customKeyInput").value.trim(); 
  
              if(!code.trim()) {
                  showToast("内容为空，无法保存", true);
                  return;
              }
  
              const btn = document.getElementById("btnSave");
              const originalText = btn.innerHTML;
              btn.innerHTML = '<span>⏳</span> 保存中...';
              btn.disabled = true;
  
              try {
                  // 设置 headers
                  const headers = getAuthHeaders();
                  headers['Content-Type'] = 'application/json'; // 必须指定 JSON
  
                  // 构建 payload
                  const payload = {
                      code: code
                  };
                  if (customKey) {
                      payload.id = customKey; // 将自定义 Key 加入 payload
                  }
                  
                  const response = await fetch('/api/save', {
                      method: 'POST',
                      headers: headers,
                      body: JSON.stringify(payload) // 发送 JSON
                  });
                  
                  const data = await response.json();
                  
                  if(response.ok && data.success) { // 检查 response.ok 确保 4xx 错误也被捕获
                      const tokenParam = getAuthToken() ? '&token=' + getAuthToken() : '';
                      const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?id=' + data.id + tokenParam;
                      window.history.pushState({path:newUrl},'',newUrl);
                      
                      navigator.clipboard.writeText(newUrl);
                      showToast("已保存！分享链接已复制 (ID: " + data.id + ")");
                      updateDeleteButton();
                      // 清空自定义 Key 输入框
                      document.getElementById("customKeyInput").value = '';
                  } else {
                      showToast("保存失败: " + (data.error || "未知错误"), true);
                  }
              } catch(e) {
                  showToast("网络错误或请求格式错误: " + e.message, true);
              } finally {
                  btn.innerHTML = originalText;
                  btn.disabled = false;
              }
          }
  
          async function loadCodeFromCloud(id) {
              const loader = document.getElementById("loadingOverlay");
              loader.style.display = "flex";
              
              const token = getAuthToken();
              const tokenParam = token ? '&token=' + token : '';
              const headers = token ? { 'X-Access-Token': token } : {};
  
              try {
                  const response = await fetch('/api/get?id=' + id + tokenParam, { headers });
                  if(response.ok) {
                      const data = await response.json();
                      document.getElementById("codeInput").value = data.code;
                      updateInputStats();
                      showToast("代码加载成功 (ID: " + id + ")");
                      document.getElementById("customKeyInput").value = id; // 加载时填入自定义 Key 框
                  } else {
                      showToast("未找到指定的代码片段或认证失败", true);
                      clearAll(true);
                  }
              } catch(e) {
                  showToast("加载失败: " + e.message, true);
              } finally {
                  loader.style.display = "none";
                  updateDeleteButton();
              }
          }
  
          function deleteCodePrompt() {
              const id = getLoadedId();
              if (!id) return;
  
              if (confirm("⚠️ 确认删除？此操作不可逆，代码片段 ID: " + id)) {
                  deleteCodeFromCloud(id);
              }
          }
  
          async function deleteCodeFromCloud(id) {
              const btn = document.getElementById("btnDelete");
              const originalText = btn.innerHTML;
              btn.innerHTML = '<span>⏳</span> 删除中...';
              btn.disabled = true;
  
              try {
                  const headers = getAuthHeaders();
                  const response = await fetch('/api/delete?id=' + id, {
                      method: 'DELETE',
                      headers: headers
                  });
                  
                  const data = await response.json();
                  
                  if (response.ok && data.success) {
                      showToast("删除成功！代码片段 " + id + " 已从 KV 空间移除。");
                      clearAll(true);
                  } else {
                      showToast("删除失败: " + (data.error || "未知错误"), true);
                  }
              } catch(e) {
                  showToast("网络错误: " + e.message, true);
              } finally {
                  btn.innerHTML = originalText;
                  updateDeleteButton();
              }
          }
          
          function updateInputStats(){
              const code=document.getElementById("codeInput").value;
              const lines=code.split('\\n').length;
              const chars=code.length;
              document.getElementById("inputStats").textContent=lines+" 行 · "+chars+" 字符"
          }
  
          function copyCode(){
              const code=document.getElementById("codeInput").value;
              if(!code) return;
              navigator.clipboard.writeText(code).then(function(){
                  showToast("代码已复制到剪贴板！")
              }).catch(function(){
                  const textarea=document.createElement("textarea");
                  textarea.value=code;
                  document.body.appendChild(textarea);
                  textarea.select();
                  document.execCommand("copy");
                  document.body.removeChild(textarea);
                  showToast("代码已复制到剪贴板！")
              })
          }
  
          function clearAll(skipToast){
              document.getElementById("codeInput").value="";
              document.getElementById("customKeyInput").value=""; // 清空自定义 Key 输入框
              
              // 重置统计信息
              document.getElementById("inputStats").textContent="0 行 · 0 字符";
              
              // 清除 URL 参数 (保留 token)
              const token = getAuthToken();
              let newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
              if (token) {
                  newUrl += '?token=' + token;
              }
              window.history.pushState({path:newUrl},'',newUrl);
              
              updateDeleteButton();
              
              if (!skipToast) showToast("内容已清空！")
          }
  
          function showToast(message, isError){
              const toast=document.getElementById("toast");
              toast.textContent=message;
              if(isError) toast.classList.add("error");
              else toast.classList.remove("error");
              
              toast.classList.add("show");
              setTimeout(function(){toast.classList.remove("show")},3000)
          }
      </script>
  </body>
  </html>`;
  
      return new Response(htmlContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=UTF-8',
          ...corsHeaders,
        },
      });
    }
  };
