import React,{useState} from 'react'
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const Home = () => {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  
  const createNewRoom = (e) => {
    e.preventDefault();
    const id =uuidv4();
    setRoomId(id);
    toast.success("Created a new room");
  }

  const joinRoom = (e) => {
    if(!roomId || !username){
      toast.error("Room ID and Username are required");
      return;
    }
    navigate(`/editor/${roomId}`, {
      state: { username ,},
    });
  }
  
  const handleInputEnter = (e) => {
    if(e.code === 'Enter'){
      if(!roomId || !username){
        toast.error("Room ID and Username are required");
        return;
      }
      joinRoom(e);
    }
  }

  return (
    <div className='homePageWrapper'>
      <div className='formWrapper'>
        <img className='homePageLogo' src="/logo.png" alt="Logo" />
        <h4 className='mainLabel'>Paste Invitation ROOM ID :</h4>
        <div className='inputGroup'>
          <input type="text" className='inputBox' placeholder='ROOM ID' value={roomId} onChange={(e)=>setRoomId(e.target.value)} onKeyUp={handleInputEnter}/>
          <input type="text" className='inputBox' placeholder='USER NAME' onChange={(e)=>setUsername(e.target.value)} value={username} onKeyUp={handleInputEnter}/>
          <button className='btn joinBtn' onClick={joinRoom}>Join</button>
          <span className="createInfo">
            If you don't have an invite then create &nbsp;
            <a onClick={createNewRoom} href="/editor/new" className='createNewBtn'>new room</a>
          </span>
        </div>
      
      </div>
      <footer>
        <h4>Built with ❤️ by &nbsp; <a href="https://github.com/Aadesh-Phadake" target="_blank" rel="noopener noreferrer" className='createNewBtn'>Aadesh Phadake</a></h4>
      </footer>
    </div>
  )
}

export default Home