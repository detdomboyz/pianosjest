import type {View} from '../../piano-staff-view';
import type {Projection} from '../../piano-catalog-adapter';

const staffLines=[0,2,4,6,8].map(position=><line key={position} x1="24" x2="616" y1={128-position*8} y2={128-position*8} className="staff-line"/>);
const noteY=(position:number)=>128-position*8;

/** Server-compatible, read-only React view. It never imports the catalog archive. */
export function StaffReader({view,title,idPrefix,execution,mode='study'}:{readonly view:View;readonly title:string;readonly idPrefix:string;readonly execution?:Projection['execution'];readonly mode?:'study'|'first'}){
  const id=idPrefix,hasNotes=view.notes.length>0,executionMatches=!execution||execution.documentRevision===view.documentRevision;
  const study=mode==='study';
  const assignments=new Map(executionMatches?execution?.assignments.map(a=>[a.noteId,a] as const):[]);
  return <section className="reader" aria-labelledby={id+'-heading'} data-view-status={view.status}>
    <header className="reader-heading"><h1 id={id+'-heading'}>{title}</h1><p>{study?'Ноты знакомой позиции. Сначала найди ключ и положение каждой ноты.':'Прочитай ноты слева направо. До ответа названия и пальцы скрыты.'}</p></header>
    {hasNotes?<figure className="score-sheet">
      <svg viewBox="0 0 640 208" role="img" aria-labelledby={id+'-score-title '+id+'-score-desc'}>
        <title id={id+'-score-title'}>{(view.clef==='treble'?'Скрипичный':'Басовый')+' ключ: '+(study?'открытый образец для разбора':'первая проба без подсказки')}</title>
        <desc id={id+'-score-desc'}>{study?view.notes.map(n=>n.label).join(', ')+'. Показаны положения высот; длительности и пальцы доступны в разборе.':'Четыре нотные головки на пяти линейках. Текстовые названия доступны отдельной практикой после раскрытия.'}</desc>
        {staffLines}
        <text className="clef" x="34" y={view.clef==='treble'?112:80} aria-hidden="true">{view.clef==='treble'?'\uE050':'\uE062'}</text>
        {view.notes.map((n,i)=>{const x=138+i*440/Math.max(1,view.notes.length-1),y=noteY(n.staffPosition);return <g key={n.noteId} {...(study?{'data-note-id':n.noteId,'data-part-id':n.partId,'data-midi':n.midi,'data-staff-position':n.staffPosition,'data-start-beat':n.startBeat,'data-duration-beats':n.durationBeats}:{})}>
          {n.ledgerPositions.map(position=><line key={position} x1={x-15} x2={x+15} y1={noteY(position)} y2={noteY(position)} className="ledger-line"/>)}
          <ellipse cx={x} cy={y} rx="9" ry="6.2" transform={'rotate(-18 '+x+' '+y+')'} className="note-head"/>
        </g>;})}
      </svg>
      <figcaption>{study?'Сейчас читаем высоты. Это открытый образец, без зачёта исполнения.':'Сейчас проверяется только порядок высот. Ритм, пальцы и художественное качество не оцениваются.'}</figcaption>
    </figure>:<div className="unavailable"><h2>Эту запись пока нельзя показать</h2><p>Исходные ноты сохранены. Выбери подготовленный пример или вернись к исходной записи.</p></div>}
    {view.warnings.length>0?<aside className="limitations" aria-label="Ограничения записи"><h2>Что пока не показано</h2><ul>{view.warnings.map((w,i)=><li key={w.code+':'+(w.noteId||'')+':'+i} data-warning-code={w.code}>{w.message}</li>)}</ul></aside>:null}
    {!executionMatches?<p className="limitations">Назначения пальцев относятся к другой редакции и не показаны.</p>:null}
    {hasNotes&&study?<details className="reading-details"><summary>Названия, пальцы и время нот</summary><p>Назови ноты до раскрытия, затем сверь себя. Пальцы и удобство движения проверяются у инструмента.</p><table><caption>Данные выбранной фразы</caption><thead><tr><th scope="col">Нота</th><th scope="col">Рука, палец</th><th scope="col">Вступление, доли</th><th scope="col">Звучание, доли</th></tr></thead><tbody>{view.notes.map(n=>{const a=assignments.get(n.noteId);return <tr key={n.noteId}><th scope="row">{n.label}</th><td>{a?(a.hand==='left'?'Левая':'Правая')+', '+a.finger:'Не назначены'}</td><td>{n.startBeat}</td><td>{n.durationBeats}</td></tr>;})}</tbody></table></details>:null}
  </section>;
}
