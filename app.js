'use strict';
const { subjects, sections, questions } = COMPANION;
const byId = new Map(questions.map(q => [q.id, q]));
const chapter = q => q.section.split('.')[0];
const sectionTitle = id => sections[id].name;
const subjectTitle = id => subjects[id];
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const letters = 'ABCDE';
const percent = (n, d) => d ? Math.round(100 * n / d) + '%' : '—';
const dateLabel = t => new Date(t).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
const key = 'licensure-companion-v1';
const main = document.querySelector('main');
let savedText = null;
let storageIssue = '';
function initialDatabase() {
  const id = uid();
  return {active:id, profiles:{[id]:{name:'Learner', sessions:[], current:null}}};
}
function readDatabase() {
  try {
    savedText = localStorage.getItem(key);
    if (savedText) {
      const db = JSON.parse(savedText);
      if (!db.profiles?.[db.active] || !Array.isArray(db.profiles[db.active].sessions)) throw new Error('profile');
      return db;
    }
  } catch {
    storageIssue = 'Browser storage is unavailable or unreadable. This session can continue in memory.';
  }
  return initialDatabase();
}
let db = readDatabase();
const learner = () => db.profiles[db.active];
const activeSession = () => learner().sessions.find(s => s.id === learner().current);
let page = 'practice', selected = null, feedback = null, reviewId = null;
let auditSessionId = null;
function save() {
  if (storageIssue) return;
  try {
    const latest = localStorage.getItem(key);
    if (latest !== savedText) {
      db = readDatabase();
      resetView();
      render();
      throw new Error('Progress changed in another tab. Reopen the question and try again.');
    }
    savedText = JSON.stringify(db);
    localStorage.setItem(key,savedText);
  } catch (error) {
    if (error.message.startsWith('Progress changed')) { alert(error.message); throw error; }
    storageIssue = 'Your browser could not save this change. Progress will remain available in this tab.';
  }
}
function shuffled(list) {
  const out = list.slice();
  for (let i = out.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [out[i],out[j]]=[out[j],out[i]];
  }
  return out;
}
function newSession(ids, title) {
  const s = {id:uid(),ids,title,answers:{},flags:{},cursor:0,started:Date.now(),finished:null};
  learner().sessions.unshift(s);
  learner().current=s.id;
  selected=null; feedback=null; auditSessionId=null; reviewId=null;
  return s;
}
function ensureSession() {
  if (activeSession()) return;
  const first = questions[0];
  newSession([first.id,...shuffled(questions.filter(q => q.section===first.section && q.id!==first.id)).slice(0,14).map(q=>q.id)],'Cardiology');
  save();
}
function records(sessions=learner().sessions) {
  return sessions.flatMap(s => Object.entries(s.answers).map(([id,a])=>({id,q:byId.get(id),...a}))).filter(r=>r.q);
}
function latestByQuestion() {
  const latest = new Map();
  for (const r of records()) if (!latest.has(r.id) || latest.get(r.id).at < r.at) latest.set(r.id,r);
  return latest;
}
function groups(rows,getGroup) {
  const map = new Map();
  for (const row of rows) {
    const id = getGroup(row.q);
    const g = map.get(id) || {id,n:0,correct:0};
    g.n++; g.correct += Number(row.choice===row.q.answer);
    map.set(id,g);
  }
  return [...map.values()].sort((a,b)=>a.correct/a.n-b.correct/b.n || b.n-a.n || a.id.localeCompare(b.id,undefined,{numeric:true}));
}
function button(action,label,cls='',value='',extra='') {
  return '<button class="'+cls+'" data-action="'+action+'" data-v="'+esc(value)+'" '+extra+'>'+label+'</button>';
}
function heading(over,title,sub,action='') {
  return '<div class="intro"><div><div class="eyebrow">'+over+'</div><h1>'+esc(title)+'</h1><p class="sub">'+esc(sub)+'</p></div>'+action+'</div>';
}
const source = q => '§ '+q.section+' · '+sectionTitle(q.section)+' · printed p. '+q.page+' (PDF p. '+(q.page+7)+')';
const progress = (n,d) => '<div class="track" aria-hidden="true"><i style="width:'+ (d ? 100*n/d : 0)+'%"></i></div>';
const metricCard = (value,label) => '<div class="card metriccard"><div class="metric">'+esc(value)+'</div><div class="count">'+label+'</div></div>';
function resetView() {selected=null; feedback=null; reviewId=null; auditSessionId=null; page='practice'; settings=defaultSettings();}
function show(where) { page=where; selected=null; feedback=null; reviewId=null; auditSessionId=null; render(true); }
function explanation(q, choice, ordinal, previous=false) {
  const correct = choice === q.answer;
  return '<section class="card review '+(correct?'':'miss')+'"><div class="mini">Question '+ordinal+' · Answer review</div><h2 class="'+(correct?'goodtext':'badtext')+'">'+(correct?'Correct':'Incorrect')+' · '+letters[q.answer]+'. '+esc(q.options[q.answer])+'</h2>'+
    (!correct?'<p class="detail">Your answer · '+letters[choice]+'. '+esc(q.options[choice])+'</p>':'')+
    '<p class="sectiongap">'+esc(q.reasons[q.answer])+'</p><div class="source">The High-Yield Licensure Companion · '+esc(source(q))+'</div>'+
    '<details open><summary>Why the other options are wrong</summary><ul>'+q.options.map((o,i)=>i===q.answer?'':'<li><b>'+letters[i]+'. '+esc(o)+'</b> — '+esc(q.reasons[i])+'</li>').join('')+'</ul></details>'+
    (previous?button('dismiss','Close review','textbtn sectiongap'):'')+'</section>';
}
function previousFeedback(s) {
  if (!feedback || !s.answers[feedback]) return '';
  return explanation(byId.get(feedback),s.answers[feedback].choice,s.ids.indexOf(feedback)+1,true);
}
function questionCard(s,q) {
  const a = s.answers[q.id], current=s.cursor, flag = s.flags[q.id];
  const index = q.stem.lastIndexOf('. ');
  const split = index>=0 && q.stem.trim().endsWith('?') ? index+1 : -1;
  const stem = split>0 ? esc(q.stem.slice(0,split))+'<span class="lead">'+esc(q.stem.slice(split).trim())+'</span>' : esc(q.stem);
  const choices=q.options.map((o,i)=>{
    const state = a ? i===q.answer?'correct':i===a.choice?'wrong':'' : i===selected?'selected':'';
    const tag=a?(i===q.answer?'Correct answer':i===a.choice?'Your answer':''):'';
    return button('choose','<span class="letter">'+letters[i]+'</span><span>'+esc(o)+'</span>'+(tag?'<small>'+tag+'</small>':''),'option '+state,i,a?'disabled':'aria-pressed="'+(selected===i)+'"');
  }).join('');
  const next = a && (s.cursor<s.ids.length-1 || s.finished);
  return '<section class="card exam"><div class="examhead"><strong>Question '+(current+1)+' of '+s.ids.length+'</strong><span>'+esc(subjectTitle(chapter(q)))+'</span></div>'+
    '<div class="examcontent"><p class="stem">'+stem+'</p><div class="choices" role="group" aria-label="Answer choices">'+choices+'</div></div>'+
    '<div class="examfoot">'+button('flag',flag?'★ Flagged':'☆ Flag question',flag?'flagged':'quiet','', 'aria-pressed="'+Boolean(flag)+'"')+
    (a ? (next?button(s.finished&&current===s.ids.length-1?'audit':'forward',s.finished&&current===s.ids.length-1?'View score':'Next question','primary'):'') : button('submit','Submit answer','primary','',selected===null?'disabled':''))+'</div></section>'+
    (a?explanation(q,a.choice,current+1):'');
}
function rail(s) {
  const n=Object.keys(s.answers).length;
  return '<aside class="stack rail"><section class="card"><div class="spread"><h2>Question navigator</h2></div><div class="metric">'+n+'<span class="count"> / '+s.ids.length+'</span></div><div class="count">questions answered</div>'+progress(n,s.ids.length)+
    '<div class="gridnums">'+s.ids.map((id,i)=>{
      const a=s.answers[id],st=a?a.choice===byId.get(id).answer?'good':'bad':'';
      return button('jump',String(i+1),'num '+st+(i===s.cursor?' current':'')+(s.flags[id]?' flag':''),i,'aria-label="Question '+(i+1)+', '+(a?st==='good'?'correct':'incorrect':'unanswered')+(s.flags[id]?', flagged':'')+'"'+(i===s.cursor?' aria-current="step"':''));
    }).join('')+'</div><div class="legend"><span><i class="swatch good"></i>Correct</span><span><i class="swatch bad"></i>Incorrect</span><span>☆ Flagged</span></div></section>'+
    '<section class="card railnote"><div class="mini">Study record</div><h2 class="sectiongap">'+esc(learner().name)+'’s progress</h2><p>See your accuracy by field and the concepts to review.</p>'+button('dashboard','View dashboard','textbtn')+'</section></aside>';
}
function practiceView() {
  const s = activeSession();
  if (s.finished && !reviewId) return auditView(s);
  return heading('Practice session',s.title,'Step 2 CK–style practice · Single best answer · Untimed')+
    '<div class="layout"><div class="stack">'+previousFeedback(s)+questionCard(s,byId.get(s.ids[s.cursor]))+'</div>'+rail(s)+'</div>';
}
function defaultSettings() { return {mode:'subject',subjects:['8'],topics:[],pool:'all',from:1,to:243,count:15}; }
let settings=defaultSettings();
function candidateQuestions() {
  const f=settings,latest=latestByQuestion();
  return questions.filter(q => {
    if (f.mode==='pages') {
      if (!(f.from>=1 && f.to<=243 && f.from<=f.to && q.page>=f.from && q.page<=f.to)) return false;
    } else if (!f.subjects.includes(chapter(q)) || f.topics.length && !f.topics.includes(q.section)) return false;
    const last=latest.get(q.id);
    return f.pool==='all' || (f.pool==='unseen'?!last:last && last.choice!==q.answer);
  });
}
function subjectChips(from,to) {
  return Object.entries(subjects).filter(([id])=>+id>=from&&+id<=to).map(([id,name])=>button('subject',esc(name)+' <span>'+questions.filter(q=>chapter(q)===id).length+'</span>','chip '+(settings.subjects.includes(id)?'on':''),id,'aria-pressed="'+settings.subjects.includes(id)+'"')).join('');
}
function segment(action, entries, active) {
  return '<div class="segments">'+entries.map(([v,label])=>button(action,label,v===active?'on':'',v,'aria-pressed="'+(v===active)+'"')).join('')+'</div>';
}
function topicList() {
  const ids = new Set(questions.map(q=>q.section));
  return settings.subjects.slice().sort((a,b)=>a-b).map(id=>{
    const list=Object.keys(sections).filter(sec=>ids.has(sec)&&sec.split('.')[0]===id);
    return '<div class="sectiongap"><h3>'+esc(subjectTitle(id))+'</h3><div class="topiclist">'+list.map(sec=>{
      const qs=questions.filter(q=>q.section===sec);
      return '<label class="topic"><input data-topic="'+sec+'" type="checkbox" '+(settings.topics.includes(sec)?'checked':'')+'><span>'+esc(sectionTitle(sec))+'<small>§ '+sec+' · '+qs.length+' '+(qs.length===1?'case':'cases')+'</small></span></label>';
    }).join('')+'</div></div>';
  }).join('');
}
function builder() {
  const f=settings,pool=candidateQuestions(),count=Math.min(f.count,pool.length);
  return heading('Practice setup','New test','Choose a field, narrow it to a topic, and set your block length.')+
  '<div class="layout"><div class="stack"><section class="card"><div class="boxhead"><h2>What to study</h2>'+segment('mode',[['subject','By subject & topic'],['pages','By book pages']],f.mode)+'</div>'+
  (f.mode==='subject'?'<div class="sectiongap mini">Basic sciences</div><div class="chips">'+subjectChips(1,7)+'</div><div class="sectiongap mini">Clinical sciences</div><div class="chips">'+subjectChips(8,12)+'</div><div class="row sectiongap">'+button('allsubjects','Select all subjects','quiet')+button('clearsubjects','Clear','textbtn')+'</div>'+
  (f.subjects.length?'<hr class="sectiongap"><p class="detail">Select topics to narrow the block. An empty topic selection includes all topics in your selected subjects.</p>'+topicList():'') :
  '<p class="detail">Enter the page numbers printed in the companion (1–243).</p><div class="row"><label class="field">From page<input id="from" type="number" min="1" max="243" value="'+f.from+'"></label><label class="field">To page<input id="to" type="number" min="1" max="243" value="'+f.to+'"></label></div>')+
  '</section><section class="card"><h2>Which questions</h2><div class="sectiongap">'+segment('pool',[['all','All questions'],['unseen','Unseen only'],['missed','Got wrong last time']],f.pool)+'</div></section></div>'+
  '<aside class="stack"><div class="card"><div class="mini">Block settings</div><div class="metric" id="available">'+pool.length+'</div><div class="count">matching questions</div><div class="sectiongap"><label class="field">Requested questions<input id="count" type="number" min="1" max="'+questions.length+'" value="'+f.count+'"></label></div><p class="detail" id="blocknote">'+blockNote(pool,count)+'</p>'+button('start','Start test','primary sectiongap','',count>0?'':'disabled')+'</div></aside></div>';
}
function blockNote(pool,count) {return count>0 ? 'This block will use '+count+' distinct '+(count===1?'question.':'questions.') : pool.length?'Enter a positive block length.':'No matching questions. Adjust your selection.';}
function refreshAvailable() {
  const p=candidateQuestions(),n=Math.min(p.length,settings.count);
  document.querySelector('#available').textContent=p.length;
  document.querySelector('#blocknote').textContent=blockNote(p,n);
  document.querySelector('[data-action="start"]').disabled=!(n>0);
}
function startBlock() {
  const pool=candidateQuestions(),n=Math.min(settings.count,pool.length);
  if (!Number.isInteger(n)||n<1) return;
  const title=settings.mode==='pages'?'Book pages '+settings.from+'–'+settings.to:settings.topics.length===1?sectionTitle(settings.topics[0]):settings.subjects.length===1?subjectTitle(settings.subjects[0]):'Mixed practice';
  newSession(shuffled(pool).slice(0,n).map(q=>q.id),title);
  save(); show('practice');
}
function table(rows, name, label) {
  return '<div class="scroll"><table class="data"><thead><tr><th>'+label+'</th><th>Correct / answered</th><th>Accuracy</th></tr></thead><tbody>'+
    rows.map(g=>'<tr><td>'+esc(name(g.id))+'</td><td>'+g.correct+' / '+g.n+'</td><td>'+percent(g.correct,g.n)+'</td></tr>').join('')+'</tbody></table></div>';
}
function reread(rows) {
  if (!rows.length) return '<p class="empty">No missed concepts in this selection.</p>';
  return rows.map(r=>'<div class="studyitem"><b>'+esc(r.q.concept)+'</b><small>'+esc(source(r.q))+'</small></div>').join('');
}
function dashboard() {
  const all=records(),latest=[...latestByQuestion().values()],g=groups(latest,chapter),topics=groups(latest,q=>q.section);
  const misses=latest.filter(r=>r.choice!==r.q.answer),weak=g.filter(v=>v.correct<v.n);
  const bySubject=new Map(g.map(v=>[v.id,v]));
  const fields=g.concat(Object.keys(subjects).filter(id=>!bySubject.has(id)).map(id=>({id,n:0,correct:0})));
  return heading('Personal dashboard','Your progress',learner().name+' · Latest answer per question · Saved in this browser')+
    '<div class="stack"><div class="metrics">'+metricCard(percent(latest.length-misses.length,latest.length),'Current accuracy')+metricCard(latest.length+' / '+questions.length,'Distinct questions answered')+metricCard(learner().sessions.filter(s=>s.finished).length,'Completed blocks')+'</div>'+
    '<div class="layout"><div class="stack"><section class="card"><h2>Performance by field</h2><p class="detail">Lowest accuracy first. Unattempted fields show a dash.</p>'+table(fields,subjectTitle,'Field')+'</section><section class="card"><h2>Performance by topic</h2>'+
    (topics.length?table(topics,id=>'§ '+id+' · '+sectionTitle(id),'Topic'):'<p class="empty">Submit your first answer to see topic-level results.</p>')+'</section></div>'+
    '<aside class="stack"><section class="card railnote"><div class="mini">Focus field</div><h2 class="sectiongap">'+esc(weak.length?subjectTitle(weak[0].id):latest.length?'All attempted items correct':'Awaiting your first answer')+'</h2><p class="detail">'+(weak.length?weak[0].correct+' correct out of '+weak[0].n+' distinct questions.':latest.length?'Choose an unseen question to extend your coverage.':'Your lowest-scoring field will appear here.')+'</p>'+
    (weak.length?button('focus','Practice missed questions','primary',weak[0].id):button('new','Configure a test','textbtn'))+'</section><section class="card"><h2>Concepts to re-read</h2>'+reread(misses)+'</section></aside></div>'+
    '<div class="count">'+all.length+' total submissions across completed and in-progress blocks.</div></div>';
}
function auditView(s) {
  const rows=records([s]),misses=rows.filter(r=>r.choice!==r.q.answer),num=rows.length-misses.length;
  return heading('Performance audit',s.title,'Completed '+dateLabel(s.finished)+' · '+s.ids.length+' questions')+'<div class="stack">'+previousFeedback(s)+
  '<div class="metrics">'+metricCard(percent(num,s.ids.length),'Block score')+metricCard(num,'Correct')+metricCard(misses.length,'Incorrect')+'</div><div class="layout"><div class="stack"><section class="card"><h2>Subtopic results</h2><p class="detail">Ordered from lowest to highest accuracy.</p>'+table(groups(rows,q=>q.section),id=>'§ '+id+' · '+sectionTitle(id),'Subtopic')+'</section><section class="card"><h2>Concepts to re-read</h2>'+reread(misses)+'</section></div><aside class="card"><h2>Review this block</h2><p class="detail">Revisit answers and explanations for each case.</p>'+button('reviewblock','Review questions','primary',s.id)+'<div class="sectiongap">'+button('new','Build another test','quiet')+'</div></aside></div></div>';
}
function historyView() {
  return heading('Personal record','Test history',learner().name+' · Resume a block or inspect a completed audit.')+'<section class="card"><h2>Practice blocks</h2>'+learner().sessions.map(s=>{
    const rows=records([s]),score=rows.filter(r=>r.q.answer===r.choice).length;
    return '<div class="historyrow spread"><div><b>'+esc(s.title)+'</b><div class="count">'+dateLabel(s.started)+' · '+(s.finished?'Completed · '+percent(score,s.ids.length):'In progress · '+rows.length+' / '+s.ids.length+' answered')+'</div></div>'+button(s.finished?'historyaudit':'resume',s.finished?'View audit':'Resume','quiet',s.id)+'</div>';
  }).join('')+'</section>';
}
function render(scroll=false) {
  ensureSession();
  document.querySelector('nav').innerHTML=[['practice','Practice'],['new','New test'],['dashboard','Dashboard'],['history','History']].map(([v,l])=>button(v,l,page===v?'on':'','',page===v?'aria-current="page"':'')).join('');
  const profile=document.querySelector('#profile');
  profile.textContent=learner().name.trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
  profile.title='Learner profiles · '+learner().name;profile.setAttribute('aria-label',profile.title);
  main.innerHTML=(storageIssue?'<p role="alert" class="notice">'+esc(storageIssue)+'</p>':'')+
    (page==='new'?builder():page==='dashboard'?dashboard():page==='history'?historyView():auditSessionId?auditView(learner().sessions.find(s=>s.id===auditSessionId)):practiceView());
  if (scroll) { window.scrollTo(0,0); main.focus({preventScroll:true}); }
}
function manageProfiles() {
  const dialog=document.querySelector('#profiles');
  document.querySelector('#modal').innerHTML='<div class="spread"><h2>Learner profiles</h2>'+button('close','Close','quiet')+'</div><p class="detail">Profiles keep separate progress on this browser and device. Anyone using this browser can open a profile.</p><label class="field">Current learner<select id="learner-select">'+Object.entries(db.profiles).map(([id,p])=>'<option value="'+id+'" '+(id===db.active?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label><form id="add-learner"><label class="field">New learner name<input name="name" required maxlength="40" autocomplete="off"></label><button class="primary">Create profile</button></form>';
  dialog.showModal();
}
document.querySelector('#profile').addEventListener('click',manageProfiles);
document.addEventListener('submit',e=>{
  if(e.target.id!=='add-learner')return;
  e.preventDefault();
  const input=e.target.elements.name,name=input.value.trim();
  if(!name || Object.values(db.profiles).some(p=>p.name.toLowerCase()===name.toLowerCase())){
    input.setCustomValidity('Enter a unique learner name.');input.reportValidity();return;
  }
  const id=uid(); db.profiles[id]={name,sessions:[],current:null}; db.active=id;
  document.querySelector('#profiles').close(); resetView(); save(); render(true);
});
document.addEventListener('input',e=>{
  if(e.target.name==='name')e.target.setCustomValidity('');
  if(['count','from','to'].includes(e.target.id)) {
    const number=e.target.valueAsNumber;
    settings[e.target.id]=Number.isInteger(number)&&number>0?number:0; refreshAvailable();
  }
});
document.addEventListener('change',e=>{
  if(e.target.id==='learner-select'){
    db.active=e.target.value;document.querySelector('#profiles').close();resetView();save();render(true);
  }
  if(e.target.dataset.topic){
    const id=e.target.dataset.topic;
    settings.topics=e.target.checked?[...settings.topics,id]:settings.topics.filter(v=>v!==id);
    refreshAvailable();
  }
});
function submitAnswer(s) {
  const id=s.ids[s.cursor];
  if(selected===null || s.answers[id])return;
  s.answers[id]={choice:selected,at:Date.now()};
  selected=null; feedback=id;
  const next=s.ids.findIndex((v,i)=>i>s.cursor && !s.answers[v]);
  s.cursor=next>=0?next:s.ids.findIndex(v=>!s.answers[v]);
  if(s.cursor<0){s.finished=Date.now();s.cursor=s.ids.length-1;reviewId=null;}
  save();render(true);
}
document.addEventListener('click',e=>{
  const target=e.target.closest('[data-action]');
  if(!target||target.disabled)return;
  const action=target.dataset.action,v=target.dataset.v;
  const s=activeSession(),id=s.ids[s.cursor];
  if(['dashboard','new','history','practice'].includes(action)){show(action);return;}
  switch(action){
    case 'choose':
      if(s.answers[id])return;
      selected=Number(v);
      document.querySelectorAll('[data-action="choose"]').forEach((el,i)=>{el.classList.toggle('selected',i===selected);el.setAttribute('aria-pressed',String(i===selected));});
      document.querySelector('[data-action="submit"]').disabled=false;return;
    case 'submit':submitAnswer(s);return;
    case 'flag':s.flags[id]=!s.flags[id];save();break;
    case 'jump':case 'forward':s.cursor=action==='jump'?Number(v):Math.min(s.cursor+1,s.ids.length-1);selected=null;feedback=null;save();break;
    case 'dismiss':feedback=null;break;
    case 'mode':case 'pool':settings[action]=v;break;
    case 'subject':settings.subjects=settings.subjects.includes(v)?settings.subjects.filter(x=>x!==v):[...settings.subjects,v];settings.topics=settings.topics.filter(sec=>settings.subjects.includes(sec.split('.')[0]));break;
    case 'allsubjects':settings.subjects=Object.keys(subjects);settings.topics=[];break;
    case 'clearsubjects':settings.subjects=[];settings.topics=[];break;
    case 'start':startBlock();return;
    case 'focus':settings={...defaultSettings(),subjects:[v],pool:'missed'};show('new');return;
    case 'reviewblock':case 'resume':learner().current=v;activeSession().cursor=action==='reviewblock'?0:activeSession().cursor;page='practice';auditSessionId=null;reviewId=action==='reviewblock'?v:null;feedback=null;selected=null;save();render(true);return;
    case 'historyaudit':page='practice';auditSessionId=v;feedback=null;reviewId=null;render(true);return;
    case 'audit':auditSessionId=s.id;feedback=null;reviewId=null;render(true);return;
    case 'close':document.querySelector('#profiles').close();return;
    default:return;
  }
  render();
  if (['mode','pool','subject','flag'].includes(action)) document.querySelector('[data-action="'+action+'"][data-v="'+CSS.escape(v)+'"]')?.focus({preventScroll:true});
});
window.addEventListener('storage',e=>{
  if(e.key===key||e.key===null){
    db=readDatabase();resetView();document.querySelector('#profiles').close();render();
  }
});
render();


