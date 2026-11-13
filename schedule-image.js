let ocrLibrary;
async function readScheduleImage(file) {
  if (!ocrLibrary) {
    ocrLibrary = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error('识别组件加载失败')); };
      document.head.append(script);
    }).catch(error => { ocrLibrary = null; throw error; });
  }
  await ocrLibrary;
  const worker = await Tesseract.createWorker('chi_sim+eng');
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

function bindScheduleImage({ date, roster, products, types, saveRows }) {
  const dialog = document.querySelector('#scheduleImageDialog');
  const form = dialog.querySelector('form');
  const source = form.elements.source;
  const drafts = dialog.querySelector('#imageDrafts');
  const status = dialog.querySelector('[role=status]');
  const file = form.elements.image;
  const controls = [...form.querySelectorAll('button,input,textarea')];
  const normalize = value => value.replace(/\s+/g, '');
  const match = (line, items) => items.filter(item => normalize(line).includes(normalize(item))).join('、');
  const field = (label, key, value, type = 'text') => {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    input.dataset.key = key;
    input.value = value;
    wrapper.append(input);
    return wrapper;
  };
  function preview() {
    drafts.replaceChildren();
    for (const line of source.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
      const parts = line.match(/(?:(\d{4})[年./-])?(\d{1,2})[月./-](\d{1,2})(?:日|\b)/);
      const day = parts ? [parts[1] || date.slice(0,4), parts[2].padStart(2,'0'), parts[3].padStart(2,'0')].join('-') : date;
      const lead = match(line, roster.lead);
      const model = match(line, roster.model);
      const product = match(line, products);
      const type = match(line, types);
      const row = document.createElement('fieldset');
      row.append(
        field('导入这行','include','yes','checkbox'), field('日期','date',day,'date'),
        field('摄影师','lead',lead), field('模特','model',model),
        field('手模','handModel',''), field('品类','product',product),
        field('拍摄类型','type',type), field('运营要求（识别原文）','notes',line,'textarea')
      );
      row.querySelector('[type=checkbox]').checked = Boolean(lead || model || product || type);
      drafts.append(row);
    }
    status.textContent = '请核对勾选的行，补齐未匹配的品类或拍摄类型。';
  }
  document.querySelector('#importScheduleImage').onclick = () => dialog.showModal();
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  form.elements.preview.onclick = preview;
  source.oninput = () => { drafts.replaceChildren(); };
  file.onchange = async () => {
    if (!file.files[0]) return;
    drafts.replaceChildren();
    controls.forEach(control => { control.disabled = true; });
    status.textContent = '正在识别截图，首次需要加载中文识别模型…';
    try {
      source.value = await readScheduleImage(file.files[0]);
      preview();
    } catch {
      status.textContent = '截图识别失败。请重试，或粘贴截图文字后生成预览。';
    } finally {
      controls.forEach(control => { control.disabled = false; });
      file.value = '';
    }
  };
  form.onsubmit = event => {
    event.preventDefault();
    const selected = [...drafts.children].filter(row => row.querySelector('[type=checkbox]').checked);
    if (!selected.length) { status.textContent = '请先预览并勾选需要导入的行。'; return; }
    const rows = selected.map(row => Object.fromEntries([...row.querySelectorAll('[data-key]')].filter(input => input.type !== 'checkbox').map(input => [input.dataset.key,input.value.trim()])));
    status.textContent = saveRows(rows) || '';
  };
}
