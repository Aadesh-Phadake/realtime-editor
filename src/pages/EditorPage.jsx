import React,{useState , useRef, useEffect} from 'react'
import Client from '../components/Client'
import Editor from '../components/Editor'
import {initSocket} from '../socket'
import ACTIONS from '@shared/Actions.js';
import { Navigate, useLocation ,useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
// Remove Split import

const EditorPage = () => {
  const socketRef = useRef(null);
  const codeRef = useRef(null);
  const location = useLocation();
  const { roomId } = useParams();
  const reactNavigator = useNavigate();
  const [clients, setClients] = useState([]);
  const [output, setOutput] = useState('');
  const [language, setLanguage] = useState('c'); // default language

  useEffect(()=> {
    const init = async () => {
      console.log('Initializing socket...');
      socketRef.current = await initSocket();
      socketRef.current.on('connect', () => {
        console.log('Socket initialized:', socketRef.current.id);
      });
      socketRef.current.on('connect_error', (err) => {
        console.error(`Connection error: ${err.message}`);
        toast.error('Connection failed, please try again later.');
        reactNavigator('/'); // Redirect to home or error page
      });
      socketRef.current.on('connect_failed', (err) => {
        console.error(`Connection failed: ${err.message}`);
        toast.error('Connection failed, please try again later.');
        reactNavigator('/'); // Redirect to home or error page
      });
      console.log('Emitting ACTIONS.JOIN with:', {
        roomId,
        username: location.state?.username,
      });
      socketRef.current.emit(ACTIONS.JOIN, {
        roomId,
        username: location.state?.username,
      });

      //listen for 'joined' event
      socketRef.current.on(ACTIONS.JOINED, ({ clients, username, socketId }) => {
        if (username !== location.state?.username) {
          toast.success(`${username} has joined the room.`);
          console.log(`${username} joined`);
        }
        setClients(clients);
        setTimeout(() => {
          socketRef.current.emit(ACTIONS.SYNC_CODE, {
            code: codeRef.current,
            socketId,
          });
        }, 100); // 100ms delay
      });
      //listen for 'disconnected' event
      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
        toast.success(`${username} has left the room.`);
        setClients((prev) => {
          return prev.filter(client => client.socketId !== socketId);
        });
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
  }, []);


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
    setOutput('Running...');
    // Judge0 language IDs: C=50, C++=54, Java=62, C#=51, JavaScript=63, Python=71
    const languageIds = { c: 50, cpp: 54, java: 62, csharp: 51, javascript: 63, python: 71 };
    const code = codeRef.current || '';
    const payload = {
      source_code: code,
      language_id: languageIds[language],
      stdin: '', // You can add input support if needed
    };
  
    try {
      // Submit code for execution
      const res = await fetch('https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RapidAPI-Key': import.meta.env.VITE_JUDGE0_API_KEY, // <-- Replace with your RapidAPI key
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

  return (
    <div className='mainWrap'>
      <div className='aside'>
        <div className='asideInner'>
          <div className='logo'>
            <img className='logoImg' src='/logo.png' alt='logo' />
          </div>
          <h3 className='editorTitle'>Connected</h3>
          <div className='clientsList'>
            {clients.map((client) => (
              <Client username={client.username} key={client.socketId} socketId={client.socketId} />
            ))}
          </div>
        </div> 
        <button className='btn copyBtn' onClick={copyRoomId}>Copy Room ID</button>
        <button className='btn leaveBtn' onClick={leaveRoom}>Leave</button>
      </div>
      <div className='editorWrap' style={{position: 'relative', height: '100vh', overflow: 'hidden'}}>
        <div style={{height: editorHeight, width: '100%', overflow: 'auto'}}>
          <Editor socketRef={socketRef} roomId={roomId} onCodeChange={code => { codeRef.current = code; }} />
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
            <select value={language} onChange={e => setLanguage(e.target.value)}>
              <option value="c">C</option>
              <option value="cpp">C++</option>
              <option value="java">Java</option>
              <option value="csharp">C#</option>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
            </select>
            <button className="btn runBtn" onClick={runCode}>Run</button>
            <pre className="outputArea">{output}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditorPage