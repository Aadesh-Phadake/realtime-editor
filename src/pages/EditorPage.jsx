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
      <div className='editorWrap'>
        <Editor  socketRef={socketRef} roomId={roomId} onCodeChange={(code) => {codeRef.current = code;}} />
      </div>
    </div>
  )
}

export default EditorPage