import React from 'react'
import Avatar from './Avatar';


const Client = ({username}) => {
  return (
    <div className='client'>
        <Avatar name={username} size={50}/>
        <span className='userName'>{username}</span>
    </div>
  )
}

export default Client