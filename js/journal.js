// =================== JOURNAL ===================
let journalEntries = load('journal_entries', {});
let journalCurrentDate = new Date();

const MOODS = [
  { e: '😊', l: '행복' }, { e: '🥰', l: '설렘' }, { e: '😌', l: '평온' },
  { e: '💪', l: '의욕' }, { e: '🤩', l: '신남' }, { e: '😄', l: '즐거움' },
  { e: '🤔', l: '고민' }, { e: '😴', l: '피곤' }, { e: '😔', l: '슬픔' },
  { e: '🥺', l: '속상' }, { e: '😰', l: '불안' }, { e: '😤', l: '답답' },
  { e: '😡', l: '화남' }, { e: '🌧', l: '우울' }, { e: '😶', l: '무감각' },
];

let _jSaveTimer = null;
