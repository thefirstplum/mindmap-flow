// =================== 홈 화면 ===================
// 앱을 여는 이유를 만드는 화면. 기존엔 홈이 없어서 열면 노트 목록이 바로 떴고,
// "뭘 해야 하지"에 답을 주지 못했다.
//
// 세 블록으로 구성:
//   1. 이어서 하기 — `프로젝트/*` 태그가 붙은 노트 중 프로젝트별 최신 1개.
//      프로젝트 세션 로그가 아무리 쌓여도 홈은 프로젝트 수만큼만 보인다.
//   2. 최근 메모  — 프로젝트 태그가 없는 노트(요리·독서·잡생각 등) 최신 6개.
//      프로젝트 기록이 일반 메모를 덮지 않게 분리한다.
//   3. 묶음      — 최상위 태그별 개수. 눌러서 해당 태그로 필터된 노트 목록으로 이동.
//
// 데이터는 getAllNotes()(memo.js)를 그대로 쓴다. 홈 전용 저장소는 없다.

const PROJECT_TAG_PREFIX = '프로젝트/';

// 노트에 붙은 프로젝트명을 돌려준다 (없으면 null).
// '프로젝트/타로' → '타로'
function noteProject(note) {
  for (const t of (note.tags || [])) {
    if (t.startsWith(PROJECT_TAG_PREFIX)) {
      const name = t.slice(PROJECT_TAG_PREFIX.length).split('/')[0];
      if (name) return name;
    }
  }
  return null;
}

// "3일 전" / "오늘" 같은 상대 표기. 목록의 dateStr과 톤을 맞춘다.
function homeRelDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}`;
}

// 본문 첫 줄 — 목록 미리보기와 같은 역할.
// 프로젝트 세션 기록은 첫 줄에 한 줄 요약을 두기로 약속돼 있어서
// 마크다운 헤더/이미지/빈 줄을 건너뛰면 그 요약이 잡힌다.
function homeSnippet(note, max = 60) {
  const src = note.content || '';
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;        // 마크다운 헤더
    if (line.startsWith('![')) continue;       // 이미지
    if (line.startsWith('---')) continue;      // 구분선
    if (line.startsWith('<!--')) continue;     // 주석(코멘트 자리 표시)
    const clean = line.replace(/^[-*+]\s*(\[[ x]\]\s*)?/, '').replace(/[*_`>]/g, '');
    if (clean) return clean.length > max ? clean.slice(0, max) + '…' : clean;
  }
  return note.type === 'mindmap' ? '마인드맵' : '내용 없음';
}

function renderHome() {
  const root = document.getElementById('home-body');
  if (!root || typeof getAllNotes !== 'function') return;
  const notes = getAllNotes();

  // ── 1. 이어서 하기 ────────────────────────────────
  // 프로젝트별로 가장 최근 노트 하나만. 정렬은 최근 작업 순.
  // 프로젝트별로 소속 노트를 전부 모아 카드 한 장을 만든다.
  // 카드에 들어가는 수치는 전부 노트 내용에서 실제로 계산한 값이다.
  const byProject = new Map();
  for (const n of notes) {
    const proj = noteProject(n);
    if (!proj) continue;
    if (!byProject.has(proj)) byProject.set(proj, []);
    byProject.get(proj).push(n);
  }
  const projects = [...byProject.entries()].map(([name, list]) => {
    list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    const latest = list[0];
    const stats = projectStats(list);
    return { name, latest, list, stats, t: new Date(latest.updatedAt || 0).getTime() };
  }).sort((a, b) => b.t - a.t);

  const projectHtml = projects.length
    ? projects.map(p => {
        const s = p.stats;
        // 진행률은 체크박스가 하나라도 있을 때만 의미가 있다
        const bar = s.todoTotal > 0 ? `
          <div class="home-progress">
            <span class="home-progress-label">할 일 ${s.todoDone}/${s.todoTotal}</span>
            <div class="home-progress-track"><div class="home-progress-fill" style="width:${s.pct}%"></div></div>
            <span class="home-progress-pct">${s.pct}%</span>
          </div>` : `
          <div class="home-progress">
            <span class="home-progress-label">노트 ${p.list.length}개</span>
            <div class="home-progress-track"></div>
          </div>`;
        const tile = (icon, label, n) =>
          `<div class="home-tile${n ? '' : ' is-zero'}"><span class="mi mi-sm">${icon}</span><b>${n}</b><span class="home-tile-label">${label}</span></div>`;
        return `
        <div class="home-card home-card-proj" onclick="goToTag('${PROJECT_TAG_PREFIX}${escapeHtml(p.name).replace(/'/g, "\\'")}')">
          <div class="home-card-head">
            <div class="home-card-title">${escapeHtml(p.name)}</div>
            <div class="home-card-time">${homeRelDate(p.latest.updatedAt)}</div>
          </div>
          <div class="home-card-sub">${escapeHtml(homeSnippet(p.latest, 80))}</div>
          ${bar}
          <div class="home-tiles">
            ${tile('edit_note', '메모', s.memo)}
            ${tile('account_tree', '마인드맵', s.mindmap)}
            ${tile('check_box', '할 일', s.todoTotal)}
            ${tile('image', '이미지', s.image)}
          </div>
        </div>`;
      }).join('')
    : `<div class="home-card home-empty">
         아직 프로젝트 기록이 없어요.<br>
         메모에 <code>프로젝트/이름</code> 태그를 붙이면 여기 모입니다.
       </div>`;

  // ── 1-b. 오늘의 할 일 ────────────────────────────
  // 프로젝트 노트의 미완료 체크박스(`- [ ]`)를 모은다. 별도 할 일 저장소를
  // 만들지 않는 이유: 관리할 대상이 하나 더 늘면 그 자체가 부담이 된다.
  // 에이전트가 `## 다음`에 적어둔 항목이 자연스럽게 여기로 올라온다.
  const todos = [];
  for (const p of projects) {
    for (const n of p.list) {
      for (const m of (n.content || '').matchAll(/^[-*+]\s*\[ \]\s*(.+)$/gm)) {
        todos.push({ proj: p.name, text: m[1].trim(), note: n });
        if (todos.length >= 6) break;
      }
      if (todos.length >= 6) break;
    }
    if (todos.length >= 6) break;
  }
  const todoHtml = todos.length
    ? `<div class="home-card">${todos.map(t => `
        <div class="home-todo" onclick="selectNote('${t.note.type}', ${t.note.id})">
          <span class="home-todo-box"></span>
          <span class="home-todo-text">${escapeHtml(t.text)}</span>
          <span class="home-todo-tag">${escapeHtml(t.proj)}</span>
        </div>`).join('')}</div>`
    : '';

  // ── 2. 최근 메모 (프로젝트 아닌 것) ──────────────────
  const general = notes
    .filter(n => !noteProject(n))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 6);

  const generalHtml = general.length
    ? `<div class="home-card">${general.map(n => `
        <div class="home-row" onclick="selectNote('${n.type}', ${n.id})">
          <span class="mi mi-sm home-row-icon">${n.type === 'mindmap' ? 'account_tree' : 'edit_note'}</span>
          <div class="home-row-body">
            <div class="home-row-title">${escapeHtml(n.title) || '제목 없음'}</div>
            <div class="home-row-sub">${escapeHtml(homeSnippet(n))}</div>
          </div>
          <span class="home-row-date">${homeRelDate(n.updatedAt)}</span>
        </div>`).join('')}</div>`
    : `<div class="home-card home-empty">메모가 없어요.</div>`;

  // ── 3. 묶음 (최상위 태그별 개수) ─────────────────────
  // '프로젝트/타로' → '프로젝트' 로 묶어서 최상위만 센다.
  const groups = new Map();
  for (const n of notes) {
    for (const t of (n.tags || [])) {
      const top = t.split('/')[0];
      if (!top) continue;
      groups.set(top, (groups.get(top) || 0) + 1);
    }
  }
  const groupHtml = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `
      <button class="home-group-chip" onclick="goToTag('${escapeHtml(name).replace(/'/g, "\\'")}')">
        ${escapeHtml(name)}<span>${count}</span>
      </button>`).join('');

  root.innerHTML = `
    <section class="home-sec">
      <div class="home-sec-head"><span>이어서 하기</span></div>
      ${projectHtml}
    </section>
    ${todoHtml ? `
    <section class="home-sec">
      <div class="home-sec-head"><span>오늘의 할 일</span></div>
      ${todoHtml}
    </section>` : ''}
    <section class="home-sec">
      <div class="home-sec-head">
        <span>최근 메모</span>
        <button class="home-sec-more" onclick="navigateTo('memo')">전체 보기</button>
      </div>
      ${generalHtml}
    </section>
    <section class="home-sec">
      <div class="home-sec-head"><span>묶음</span></div>
      <div class="home-groups">${groupHtml}</div>
    </section>`;
}

// 프로젝트에 속한 노트들에서 카드에 쓸 수치를 뽑는다.
// 전부 노트 내용에서 계산 — 별도로 저장하는 상태값은 없다.
function projectStats(list) {
  let memo = 0, mindmap = 0, image = 0, todoTotal = 0, todoDone = 0;
  for (const n of list) {
    if (n.type === 'mindmap') mindmap++; else memo++;
    const c = n.content || '';
    image += (c.match(/!\[[^\]]*\]\(/g) || []).length;
    const open = (c.match(/^[-*+]\s*\[ \]/gm) || []).length;
    const done = (c.match(/^[-*+]\s*\[x\]/gmi) || []).length;
    todoTotal += open + done;
    todoDone += done;
  }
  const pct = todoTotal ? Math.round((todoDone / todoTotal) * 100) : 0;
  return { memo, mindmap, image, todoTotal, todoDone, pct };
}

// 제목이 '[타로] 프롬프트 최적화' 형태면 앞의 프로젝트 태그를 뗀다.
// 홈에서는 왼쪽 칩이 이미 프로젝트를 보여주므로 중복이다.
function stripProjectPrefix(title) {
  return (title || '').replace(/^\s*\[[^\]]+\]\s*/, '') || (title || '');
}

// 묶음 칩 → 노트 페이지로 이동하면서 해당 태그 필터 적용
function goToTag(tag) {
  if (typeof navigateTo === 'function') navigateTo('memo');
  if (typeof setTagFilter === 'function') setTagFilter(tag);
}
