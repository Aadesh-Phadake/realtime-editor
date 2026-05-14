import React,{useState , useRef, useEffect} from 'react'
import Client from '../components/Client'
import Editor from '../components/Editor'
import {initSocket} from '../socket'
import ACTIONS from '@shared/Actions.js';
import { Navigate, useLocation ,useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'

const EditorPage = () => {
  const socketRef = useRef(null);
  const codeRef = useRef(null);
  const location = useLocation();
  const { roomId } = useParams();
  const reactNavigator = useNavigate();
  const [clients, setClients] = useState([]);
  const [output, setOutput] = useState('');
  const [language, setLanguage] = useState('cpp'); 
  const [code, setCode] = useState(() => localStorage.getItem(`code-${roomId}`) || '');
  const [customInput, setCustomInput] = useState('');

  // ── Codeforces state ──
  const [showCfModal, setShowCfModal] = useState(false);
  const [cfUrl, setCfUrl] = useState('');
  const [cfLoading, setCfLoading] = useState(false);
  const [cfProblem, setCfProblem] = useState(null);
  const [cfPanelOpen, setCfPanelOpen] = useState(true);
  const [activeSample, setActiveSample] = useState(0);
  // Sample test cases — user adds them manually
  const [cfSamples, setCfSamples] = useState([]);
  const [showAddSample, setShowAddSample] = useState(false);
  const [newSampleInput, setNewSampleInput] = useState('');
  const [newSampleOutput, setNewSampleOutput] = useState('');

  useEffect(()=> {
    const init = async () => {
      socketRef.current = await initSocket();
      socketRef.current.on('connect', () => {
        if (clients.length <= 1) {
          const localCode = localStorage.getItem(`code-${roomId}`) || '';
          codeRef.current = localCode;
          setCode(localCode);
        }
      });
      socketRef.current.on('connect_error', (err) => {
        console.error(`Connection error: ${err.message}`);
        toast.error('Connection failed, please try again later.');
        reactNavigator('/');
      });
      socketRef.current.on('connect_failed', (err) => {
        console.error(`Connection failed: ${err.message}`);
        toast.error('Connection failed, please try again later.');
        reactNavigator('/');
      });
      socketRef.current.emit(ACTIONS.JOIN, {
        roomId,
        username: location.state?.username,
      });

      socketRef.current.on(ACTIONS.JOINED, ({ clients, username, socketId }) => {
        setClients(clients);
        if (clients.length <= 1) {
          const localCode = localStorage.getItem(`code-${roomId}`) || '';
          codeRef.current = localCode;
          setCode(localCode);
        }
        if (username !== location.state?.username) {
          toast.success(`${username} has joined the room.`);
        }
        setTimeout(() => {
          socketRef.current.emit(ACTIONS.SYNC_CODE, {
            code: codeRef.current,
            socketId,
          });
        }, 100);
      });

      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
        toast.success(`${username} has left the room.`);
        setClients((prev) => prev.filter(client => client.socketId !== socketId));
      });
    };
    init();
    return () => {
      if (socketRef.current) {
        socketRef.current.off(ACTIONS.JOINED);
        socketRef.current.off(ACTIONS.DISCONNECTED);
        socketRef.current.disconnect();
      }
    };
  }, [roomId]);


  function copyRoomId() {
    try {
      navigator.clipboard.writeText(roomId);
      toast.success('Room ID copied to clipboard');
    } catch (error) {
      console.error('Failed to copy room ID:', error);
      toast.error('Failed to copy Room ID');
    }
  }
  function leaveRoom() {
    reactNavigator('/');
  }
  if(!location.state) {
    return <Navigate to='/'/>
  }

  async function runCode() {
    setOutput('⏳ Running...');
    const languageIds = { c: 50, cpp: 54, java: 62, csharp: 51, javascript: 63, python: 71 };
    const code = codeRef.current || '';
    const payload = {
      source_code: code,
      language_id: languageIds[language],
      stdin: customInput,
    };
  
    try {
      const res = await fetch('https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RapidAPI-Key': import.meta.env.VITE_JUDGE0_API_KEY,
          'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
        },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      setOutput(result.stdout || result.stderr || result.compile_output || 'No output');
    } catch (err) {
      setOutput('Error running code');
      console.error(err);
    }
  }

  // ── Fetch Codeforces problem metadata + samples from API ──
  async function fetchCfProblem() {
    if (!cfUrl.trim()) {
      toast.error('Please enter a Codeforces URL');
      return;
    }
    setCfLoading(true);
    try {
      const res = await fetch(`/api/codeforces?url=${encodeURIComponent(cfUrl.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to fetch problem');
        setCfLoading(false);
        return;
      }
      setCfProblem(data);
      setCfPanelOpen(true);
      // Auto-populate scraped samples
      const scraped = data.samples || [];
      setCfSamples(scraped);
      setActiveSample(0);
      setShowCfModal(false);
      // Auto-fill first sample input
      if (scraped.length > 0) {
        setCustomInput(scraped[0].input);
        toast.success(`Loaded: ${data.title} (${scraped.length} test case${scraped.length > 1 ? 's' : ''} found)`);
      } else {
        toast.success(`Loaded: ${data.title} — add test cases manually`);
      }
    } catch (err) {
      console.error(err);
      toast.error('Network error fetching problem');
    }
    setCfLoading(false);
  }

  // ── Add sample test case ──
  function addSample() {
    if (!newSampleInput.trim() && !newSampleOutput.trim()) {
      toast.error('Enter at least input or output');
      return;
    }
    const updated = [...cfSamples, { input: newSampleInput, output: newSampleOutput }];
    setCfSamples(updated);
    setNewSampleInput('');
    setNewSampleOutput('');
    setShowAddSample(false);
    setActiveSample(updated.length - 1);
    setCustomInput(newSampleInput);
    toast.success(`Test case ${updated.length} added`);
  }

  function deleteSample(idx) {
    const updated = cfSamples.filter((_, i) => i !== idx);
    setCfSamples(updated);
    if (activeSample >= updated.length) {
      setActiveSample(Math.max(0, updated.length - 1));
    }
  }

  function selectSample(idx) {
    setActiveSample(idx);
    if (cfSamples[idx]) {
      setCustomInput(cfSamples[idx].input);
    }
  }

  function closeProblem() {
    setCfProblem(null);
    setCfPanelOpen(false);
    setCfSamples([]);
  }

  // Custom vertical splitter logic
  const [editorHeight, setEditorHeight] = React.useState(window.innerHeight * 0.7);
  const dragging = React.useRef(false);

  const onMouseDown = () => {
    dragging.current = true;
    document.body.style.cursor = 'row-resize';
  };
  const onMouseUp = () => {
    dragging.current = false;
    document.body.style.cursor = '';
  };
  const onMouseMove = (e) => {
    if (!dragging.current) return;
    const wrapRect = document.querySelector('.editorWrap').getBoundingClientRect();
    let newHeight = e.clientY - wrapRect.top;
    newHeight = Math.max(100, Math.min(newHeight, window.innerHeight - 100));
    setEditorHeight(newHeight);
  };
  React.useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  });

  // Check if expected output matches actual
  const expectedOutput = cfSamples[activeSample]?.output || '';
  const outputMatches = output && expectedOutput && output.trim() === expectedOutput.trim();

  return (
    <div className={`mainWrap ${cfProblem && cfPanelOpen ? 'mainWrap--withProblem' : ''}`}>
      {/* ── Sidebar ── */}
      <div className='aside'>
        <div className='asideInner'>
          <div className='logo'>
            <img className='logoImg' src='/logo.png' alt='logo' />
          </div>
          <h3 className='editorTitle'>Connected</h3>
          <div className={`clientsList ${cfProblem ? 'clientsList--compact' : ''}`}>
            {clients.map((client) => (
              <Client username={client.username} key={client.socketId} socketId={client.socketId} />
            ))}
          </div>
        </div>

        {/* Import CF Problem button */}
        <button className='btn cfImportBtn' onClick={() => setShowCfModal(!showCfModal)}>
          🏆 Import CF Problem
        </button>

        {/* CF URL Modal */}
        {showCfModal && (
          <div className='cfModal'>
            <label className='cfModalLabel'>Paste Codeforces URL:</label>
            <input
              type='text'
              className='cfUrlInput'
              placeholder='https://codeforces.com/problemset/problem/1/A'
              value={cfUrl}
              onChange={e => setCfUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchCfProblem()}
            />
            <button
              className='btn cfFetchBtn'
              onClick={fetchCfProblem}
              disabled={cfLoading}
            >
              {cfLoading ? <span className='cfSpinner'></span> : '🔍 Fetch Problem'}
            </button>
          </div>
        )}

        <button className='btn copyBtn' onClick={copyRoomId}>Copy Room ID</button>
        <button className='btn leaveBtn' onClick={leaveRoom}>Leave</button>
      </div>

      {/* ── Problem Panel (shown only when problem is loaded) ── */}
      {cfProblem && cfPanelOpen && (
        <div className='problemPanel'>
          <div className='problemPanelHeader'>
            <h2 className='problemTitle'>{cfProblem.title}</h2>
            <div className='problemActions'>
              <button className='problemToggleBtn' onClick={() => setCfPanelOpen(false)} title='Collapse'>◀</button>
              <button className='problemCloseBtn' onClick={closeProblem} title='Close'>✕</button>
            </div>
          </div>

          {/* Problem metadata */}
          <div className='problemMeta'>
            {cfProblem.rating && <span className='problemTag'>⭐ {cfProblem.rating}</span>}
            {cfProblem.tags?.map((tag, i) => (
              <span key={i} className='problemTag'>{tag}</span>
            ))}
          </div>

          {/* Link to open on Codeforces */}
          <div className='problemLink'>
            <a href={cfProblem.url} target='_blank' rel='noopener noreferrer'>
              🔗 Open on Codeforces
            </a>
          </div>

          {/* Sample test cases section */}
          <div className='problemSamples'>
            <div className='problemSamplesHeader'>
              <h3 className='problemSamplesTitle'>Test Cases ({cfSamples.length})</h3>
              <button className='btn sampleAddBtn' onClick={() => setShowAddSample(!showAddSample)}>
                {showAddSample ? '✕ Cancel' : '+ Add Test'}
              </button>
            </div>

            {/* Add sample form */}
            {showAddSample && (
              <div className='addSampleForm'>
                <div className='addSampleRow'>
                  <div className='addSampleCol'>
                    <label className='addSampleLabel'>Input</label>
                    <textarea
                      className='addSampleArea'
                      placeholder='Paste sample input...'
                      value={newSampleInput}
                      onChange={e => setNewSampleInput(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                  <div className='addSampleCol'>
                    <label className='addSampleLabel'>Expected Output</label>
                    <textarea
                      className='addSampleArea'
                      placeholder='Paste expected output...'
                      value={newSampleOutput}
                      onChange={e => setNewSampleOutput(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                </div>
                <button className='btn sampleSaveBtn' onClick={addSample}>
                  ✓ Save Test Case
                </button>
              </div>
            )}

            {/* List of sample test cases */}
            {cfSamples.map((sample, idx) => (
              <div key={idx} className={`problemSampleCard ${activeSample === idx ? 'problemSampleCard--active' : ''}`}>
                <div className='sampleCardHeader'>
                  <span>Test {idx + 1}</span>
                  <div className='sampleCardActions'>
                    <button
                      className='btn sampleUseBtn'
                      onClick={() => selectSample(idx)}
                    >
                      {activeSample === idx ? '✓ Active' : '▶ Use'}
                    </button>
                    <button className='sampleDeleteBtn' onClick={() => deleteSample(idx)} title='Delete'>🗑</button>
                  </div>
                </div>
                <div className='sampleCardBody'>
                  <div className='sampleBlock'>
                    <div className='sampleBlockLabel'>Input</div>
                    <pre className='samplePre'>{sample.input || '(empty)'}</pre>
                  </div>
                  <div className='sampleBlock'>
                    <div className='sampleBlockLabel'>Expected</div>
                    <pre className='samplePre'>{sample.output || '(empty)'}</pre>
                  </div>
                </div>
              </div>
            ))}

            {cfSamples.length === 0 && !showAddSample && (
              <div className='noSamples'>
                No test cases yet. Click "+ Add Test" to paste sample I/O from the problem page.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Collapsed problem tab ── */}
      {cfProblem && !cfPanelOpen && (
        <button className='problemExpandTab' onClick={() => setCfPanelOpen(true)} title='Show problem panel'>
          📄 {cfProblem.title}
        </button>
      )}

      {/* ── Editor + I/O Area ── */}
      <div className='editorWrap' style={{position: 'relative', height: '100vh', overflow: 'hidden'}}>
        <div style={{height: editorHeight, width: '100%', overflow: 'auto'}}>
          <Editor
            socketRef={socketRef}
            roomId={roomId}
            onCodeChange={newCode => {
              codeRef.current = newCode;
              setCode(newCode);
              localStorage.setItem(`code-${roomId}`, newCode);
            }}
          />
        </div>
        <div
          style={{
            height: '8px',
            width: '100%',
            background: '#23243a',
            cursor: 'row-resize',
            position: 'relative',
            zIndex: 2,
          }}
          onMouseDown={onMouseDown}
        >
          <div style={{height: '100%', width: '100%', borderRadius: '4px', background: '#4aee88', opacity: 0.3}}></div>
        </div>
        <div style={{height: `calc(100% - ${editorHeight}px - 8px)`, width: '100%', overflow: 'auto'}}>
          <div className="compilerWrap">
            <div className="compilerToolbar">
              <select value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="c">C</option>
                <option value="cpp">C++</option>
                <option value="java">Java</option>
                <option value="csharp">C#</option>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
              </select>
              <button className="btn runBtn" onClick={runCode}>
                <span className="runIcon">▶</span> Run
              </button>
              {/* Sample test case selector tabs */}
              {cfSamples.length > 0 && (
                <div className='sampleTabs'>
                  {cfSamples.map((_, idx) => (
                    <button
                      key={idx}
                      className={`sampleTab ${activeSample === idx ? 'sampleTab--active' : ''}`}
                      onClick={() => selectSample(idx)}
                    >
                      Test {idx + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="ioContainer">
              <div className="ioPanel">
                <div className="ioPanelHeader">
                  <span className="ioPanelIcon">⌨</span> Custom Input
                </div>
                <textarea
                  className="inputArea"
                  placeholder={"Paste your test input here...\ne.g.\n5\n1 2 3 4 5"}
                  value={customInput}
                  onChange={e => setCustomInput(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="ioPanel">
                <div className="ioPanelHeader">
                  <span className="ioPanelIcon">📤</span> Output
                  {cfSamples.length > 0 && output && output !== '⏳ Running...' && (
                    <span className={`verdictBadge ${outputMatches ? 'verdictBadge--ac' : 'verdictBadge--wa'}`}>
                      {outputMatches ? '✓ Match' : '✗ Mismatch'}
                    </span>
                  )}
                </div>
                <pre className="outputArea">{output}</pre>
                {cfSamples.length > 0 && expectedOutput && (
                  <div className='expectedOutputWrap'>
                    <div className='expectedOutputLabel'>Expected Output</div>
                    <pre className='expectedOutputPre'>{expectedOutput}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditorPage