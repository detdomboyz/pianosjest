'use client';
import { useEffect, useRef, useState } from 'react';
import * as Bank from '../../piano-reading-bank';
import * as Controller from '../../piano-reading-controller';
import * as Store from '../../piano-reading-store';
import * as Staff from '../../piano-staff-view';
import * as Midi from '../../piano-reading-midi';
import { StaffReader } from '../../web-reader/src/StaffReader';
import specification from '../generated/reading-spec.json';
const bank = Bank.build(specification as Bank.Specification), UI_KEY = 'music-reading-ui-v1';
type MaterialMode = 'short' | 'full' | 'hidden';
const modeNames: Record<MaterialMode, string> = { short: 'Кратко', full: 'Развёрнуто', hidden: 'Скрыто' };
const codes: Record<string, string> = { LOCKS_UNAVAILABLE: 'Этот браузер не может согласовать историю между вкладками. Открой страницу в современном браузере по безопасному адресу.', STORAGE_UNAVAILABLE: 'История недоступна. Разреши хранение данных для этой страницы или открой обычное окно браузера.', STORAGE_READ_FAILED: 'Не удалось прочитать историю. Проверь доступ к данным сайта и повтори действие.', STORAGE_WRITE_FAILED: 'История не записалась. Освободи место в хранилище сайта и повтори сохранение; существующие записи оставлены.', SAVE_NOT_CONFIRMED: 'Запись не удалось подтвердить. Повтори сохранение; результат пока не подтверждён.', HISTORY_INVALID: 'История повреждена. Сохрани её резервную копию; автоматического сброса нет.', HISTORY_VERSION: 'Эта версия истории пока не поддерживается. Сохрани файл для совместимой версии.', HISTORY_NOT_EMPTY: 'Здесь уже есть другая история. Сохрани оба файла; объединение пока не поддерживается.', ATTEMPT_ACTIVE: 'Сначала закончи попытку или закрой её без результата.', RELEASE_REQUIRED: 'Отпусти все клавиши и снова нажми «Завершить ответ».', SESSION_NOT_FOUND: 'Попытка не найдена в истории. Закрой её без результата и проверь хранилище.' };
function emptyStore(): Store.Store { return Store.create(); }
function initial(clef: Staff.Clef) { return Controller.create({ store: emptyStore(), bank, clef, now: () => '', sessionId: () => '' }).snapshot(); }
export function ReadingScreen({ clef }: {
    readonly clef: Staff.Clef;
}) {
    const [view, setView] = useState(() => initial(clef)), controller = useRef<Controller.Controller | null>(null), connection = useRef<Midi.Connection | null>(null);
    const [ports, setPorts] = useState<{
        id: string;
        name: string;
    }[]>([]), [portId, setPortId] = useState(''), [midiBusy, setMidiBusy] = useState(false), [midiMessage, setMidiMessage] = useState('MIDI пока не подключён.'), [material, setMaterial] = useState<MaterialMode>('short'), [expanded, setExpanded] = useState(false), [preferenceMessage, setPreferenceMessage] = useState(''), [transfer, setTransfer] = useState(false), [importText, setImportText] = useState(''), [importNotice, setImportNotice] = useState('');
    useEffect(() => {
        let active = true;
        let engine: Controller.Controller;
        try {
            engine = Controller.create({ store: Store.create({ storage: window.localStorage, locks: navigator.locks }), bank, clef, now: () => new Date().toISOString(), sessionId: () => crypto.randomUUID(), onChange: s => { if (active)
                    setView(s); } });
        }
        catch {
            engine = Controller.create({ store: emptyStore(), bank, clef, now: () => new Date().toISOString(), sessionId: () => crypto.randomUUID(), onChange: s => { if (active)
                    setView({ ...s, code: 'STORAGE_UNAVAILABLE' }); } });
        }
        controller.current = engine;
        void engine.refresh();
        const midi = Midi.create({ requestAccess: typeof navigator.requestMIDIAccess === 'function' ? o => navigator.requestMIDIAccess(o) : undefined, onInput: e => engine.input(e), onInterrupted: () => { if (active) {
                setPortId('');
                setMidiMessage('Вход MIDI прерван. Эта попытка остаётся практикой.');
            } void engine.interrupt(); }, onPorts: p => { if (active)
                setPorts(p); } });
        connection.current = midi;
        const interrupt = () => { void engine.interrupt(); };
        const visibility = () => { if (document.visibilityState !== 'visible')
            interrupt(); };
        window.addEventListener('blur', interrupt);
        window.addEventListener('pagehide', interrupt);
        document.addEventListener('visibilitychange', visibility);
        try {
            const raw = window.localStorage.getItem(UI_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                if (saved.version === 1 && ['short', 'full', 'hidden'].includes(saved.mode)) {
                    setMaterial(saved.mode);
                    setExpanded(saved.mode === 'full');
                }
            }
        }
        catch {
            setPreferenceMessage('Вид разбора не удалось прочитать. Можно выбрать его заново.');
        }
        return () => { active = false; void engine.interrupt(); midi.dispose(); window.removeEventListener('blur', interrupt); window.removeEventListener('pagehide', interrupt); document.removeEventListener('visibilitychange', visibility); controller.current = null; connection.current = null; };
    }, [clef]);
    const activeAttempt = view.phase === 'active' || view.phase === 'unsaved' || view.phase === 'saving', first = view.mode === 'first' && activeAttempt, staff = Staff.project(view.item.music, view.item.notation), execution = { version: 1 as const, instrument: 'piano' as const, documentRevision: view.item.music.revision, assignments: view.item.music.notes.map((n, i) => ({ noteId: n.id, hand: view.item.hand, finger: view.item.fingers[i] })) };
    const title = first ? 'Прочитай новую запись' : view.phase === 'finished' ? 'Разбор после ответа' : 'Разбери знакомый образец';
    const status = view.busy ? 'Сохраняем…' : view.phase === 'exhausted' ? 'Новых записей в этом небольшом банке не осталось. Продолжи практику.' : view.phase === 'finished' ? (view.result?.outcome === 'first-pitch-order-matched' ? 'Порядок высот совпал в первой пробе. Вернись позже к другой записи.' : view.result?.outcome === 'first-needs-repeat' ? 'Порядок высот пока не совпал. Разбери запись и повтори в практике.' : view.result?.matched ? 'Высоты совпали в практике. Это не новая первая проба.' : 'Практика сохранена. Сверь порядок высот с разбором.') : activeAttempt ? (view.reasons.length ? 'Практика: использована помощь, повтор или прерывание.' : 'Первая проба: ответь до раскрытия названий.') : view.phase === 'blocked' ? 'Новую запись пока нельзя открыть. История не сброшена.' : view.remaining === 0 ? 'В этом банке нет новых неопубликованных записей для первой пробы. Выбери практику.' : 'Сначала разбери образец; затем выбери другую запись без подсказок.';
    function materialChange(value: MaterialMode) { setMaterial(value); setExpanded(value === 'full'); try {
        window.localStorage.setItem(UI_KEY, JSON.stringify({ version: 1, mode: value }));
        setPreferenceMessage('');
    }
    catch {
        setPreferenceMessage('Этот вид применён, но не сохранён. Проверь доступ к хранилищу.');
    } }
    async function start(kind: 'first' | 'practice' | 'variation') { if (connection.current?.heldCount()) {
        setMidiMessage('Перед новой записью отпусти все клавиши MIDI.');
        return;
    } setTransfer(false); setImportNotice(''); await controller.current?.start(kind); }
    async function connect() { setMidiBusy(true); try {
        const p = await connection.current?.connect();
        setMidiMessage(p?.length ? 'Выбери вход MIDI.' : 'Доступ получен, но подключённых входов MIDI нет. Экранные клавиши доступны для практики.');
    }
    catch {
        setMidiMessage('Не удалось подключить MIDI. Проверь поддержку браузера, разрешение и подключение инструмента.');
    }
    finally {
        setMidiBusy(false);
    } }
    async function selectPort(id: string) { setMidiBusy(true); try {
        await connection.current?.select(id);
        setPortId(id);
        setMidiMessage('MIDI подключён. Во время ответа звук автоматически не включается.');
    }
    catch {
        setPortId('');
        setMidiMessage('Вход недоступен. Проверь подключение и выбери его снова.');
    }
    finally {
        setMidiBusy(false);
    } }
    function screenNote(midi: number) { controller.current?.input({ type: 'note-on', midi, source: 'pointer' }); controller.current?.input({ type: 'note-off', midi, source: 'pointer' }); }
    const error = view.code ? codes[view.code] || 'Действие не завершено. Проверь доступ к истории и повтори; данные не сброшены.' : null;
    return <main id="main"><nav className="reading-nav" aria-label="Выбрать раздел чтения"><a href="/">Выбор ключа</a><a href="/reading/treble/" aria-current={clef === 'treble' ? 'page' : undefined}>Скрипичный ключ</a><a href="/reading/bass/" aria-current={clef === 'bass' ? 'page' : undefined}>Басовый ключ</a></nav>
    <div className="practice-heading"><p>{clef === 'treble' ? 'Правая рука' : 'Левая рука'} · сначала высоты, затем музыка</p><div className="midi-controls"><button type="button" onClick={() => void connect()} disabled={midiBusy}>Подключить MIDI</button>{ports.length ? <label>Вход MIDI<select value={portId} onChange={e => void selectPort(e.target.value)} disabled={midiBusy}><option value="" disabled>Выбрать вход</option>{ports.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : null}</div></div>
    <p className="midi-status" role="status">{midiMessage}</p>
    <div className="attempt-status" role="status" aria-live="polite"><p>{status}</p>{activeAttempt ? <p>Получено нажатий: {new Intl.NumberFormat('ru-RU').format(view.captured)}. Ожидается 4. Удерживается клавиш: {view.held}.</p> : null}{error ? <p className="error-message">{error}</p> : null}</div>
    {!first ? <section className="preparation" aria-label="Как заниматься"><div className="material-control"><label>Разбор<select value={material} onChange={e => materialChange(e.target.value as MaterialMode)}>{Object.entries(modeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><span role="status">{preferenceMessage}</span></div>{material !== 'hidden' ? <><button type="button" className={'material-preview ' + (expanded ? 'expanded' : '')} aria-expanded={expanded} aria-controls="reading-explanation" onClick={() => setExpanded(e => !e)}><span className="material-copy">{clef === 'treble' ? 'Найди до первой октавы большим пальцем правой руки. Ре и ми лежат под 2-м и 3-м.' : 'Найди до малой октавы 5-м пальцем левой руки. Ре и ми лежат под 4-м и 3-м.'} Сначала назови каждую ноту на листе, затем найди её на клавиатуре. При повторе высоты отпусти клавишу и нажми заново. </span><span className="material-toggle">{expanded ? 'Свернуть разбор' : 'Развернуть разбор'}</span></button><div id="reading-explanation" hidden={!expanded}>{expanded ? <><p>Один блок занимает примерно 3–5 минут. Работай без спешки: сначала ключ и положение ноты, затем клавиша. Пять линеек считаются снизу; промежуток — отдельная ступень. Боль или напряжение — повод остановиться и проверить посадку.</p><p>Сверь названия и пальцы открытого образца. Потом открой новую запись без названий. MIDI сравнит только порядок высот; пальцы и удобство движения проверяй самостоятельно. После перерыва выбери другой ещё не открытый рисунок. Успешная проба не означает устойчивого навыка.</p><p>Это техническая практика проекта, без цитирования произведения. <a href="https://www.open.edu/openlearn/history-the-arts/music/an-introduction-music-theory/content-section-2.2">О нотных ключах</a>.</p></> : null}</div></> : null}</section> : null}
    <StaffReader view={staff} title={title} idPrefix={'reading-' + clef} execution={execution} mode={first ? 'first' : 'study'}/>
    <div className="attempt-actions">{!activeAttempt ? <><button type="button" className="primary" onClick={() => void start('first')} disabled={view.busy || view.remaining === 0} aria-describedby="reading-pool-status">Открыть новую запись</button><button type="button" onClick={() => void start('practice')} disabled={view.busy}>Практиковать образец</button><button type="button" onClick={() => void start('variation')} disabled={view.busy}>Другая фраза для практики</button><p id="reading-pool-status">Новых для первой пробы: {view.remaining}. Опубликованные и уже открытые фразы остаются практикой.</p></> : <><button type="button" className="primary" onClick={() => void controller.current?.finish()} disabled={view.busy}>{view.phase === 'unsaved' ? 'Повторить сохранение' : 'Завершить ответ'}</button>{view.mode === 'first' ? <button type="button" onClick={() => void controller.current?.reveal()} disabled={view.busy}>Показать названия — перейти к практике</button> : null}<button type="button" onClick={() => void controller.current?.cancel()} disabled={view.busy}>Закрыть без результата</button></>}</div>
    {view.mode === 'study' && view.phase === 'active' ? <section className="screen-input" aria-label="Экранные клавиши для практики"><p>Экранные клавиши отмечают порядок высот в практике.</p>{(clef === 'treble' ? [60, 62, 64] : [48, 50, 52]).map((m, i) => <button type="button" key={m} onClick={() => screenNote(m)}>{['До', 'Ре', 'Ми'][i]} {clef === 'treble' ? 'первой' : 'малой'} октавы</button>)}</section> : null}
    {!activeAttempt ? <section className="history-transfer"><button type="button" aria-expanded={transfer} aria-controls="reading-transfer" onClick={() => setTransfer(v => !v)}>Перенести историю чтения</button><div id="reading-transfer" hidden={!transfer}>{transfer ? <><p>История хранится в этом браузере. Сохрани JSON перед переходом на другой адрес или устройство. Импорт доступен в пустую историю; другая существующая история не заменяется.</p><button type="button" onClick={() => void controller.current?.exportHistory()} disabled={view.busy}>Подготовить экспорт</button>{view.exportText ? <label>История для копирования<textarea readOnly value={view.exportText} rows={5}/></label> : null}<label>История для импорта<textarea value={importText} onChange={e => setImportText(e.target.value)} rows={5} spellCheck={false} autoComplete="off" name="reading-history-import"/></label><button type="button" disabled={view.busy || !importText.trim()} onClick={async () => { await controller.current?.importHistory(importText); const saved = controller.current?.snapshot(); setImportNotice(saved && !saved.busy && saved.code === null && saved.phase === 'ready' ? 'История импортирована. Известные элементы остаются практикой.' : 'Импорт не выполнен. Проверь сообщение выше.'); }}>Импортировать в пустую историю</button><p role="status">{importNotice}</p></> : null}</div></section> : null}
    <p className="scope-note">Это чтение высот, без оценки длительностей и пауз. Нотные головки показывают положение звуков; полный ритмический рисунок здесь ещё не записан. История этого раздела не доказывает знакомство во всех прежних редакциях и вне сервиса.</p>
  </main>;
}

