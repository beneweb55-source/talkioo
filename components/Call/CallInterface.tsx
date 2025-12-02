import React, { useEffect, useRef, useState } from 'react';
import AgoraRTC, { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack, IRemoteAudioTrack } from 'agora-rtc-sdk-ng';
import { User } from '../../types';
import { getAgoraTokenAPI, sendCallSignal } from '../../services/api';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Maximize2, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MotionDiv = motion.div as any;

interface CallInterfaceProps {
    conversationId: string;
    currentUser: User;
    targetUser?: User | null; // Null if group call
    isCaller: boolean;
    callType: 'audio' | 'video';
    onClose: () => void;
}

export const CallInterface: React.FC<CallInterfaceProps> = ({ conversationId, currentUser, targetUser, isCaller, callType, onClose }) => {
    const [joined, setJoined] = useState(false);
    const [users, setUsers] = useState<any[]>([]);
    const [localTracks, setLocalTracks] = useState<(IMicrophoneAudioTrack | ICameraVideoTrack)[]>([]);
    
    // Controls
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(callType === 'audio');
    const [isMinimized, setIsMinimized] = useState(false);

    // Call Status
    const [callStatus, setCallStatus] = useState(isCaller ? 'Calling...' : 'Connecting...');

    const client = useRef<IAgoraRTCClient | null>(null);

    useEffect(() => {
        const initCall = async () => {
            try {
                // 1. Get Token from Backend
                const { token, appId } = await getAgoraTokenAPI(conversationId);
                
                // 2. Initialize Client
                client.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

                // 3. Setup Events
                client.current.on('user-published', async (user, mediaType) => {
                    await client.current?.subscribe(user, mediaType);
                    if (mediaType === 'video') {
                        setUsers(prev => {
                            const exists = prev.find(u => u.uid === user.uid);
                            if (exists) return prev; // Already added
                            return [...prev, user];
                        });
                    }
                    if (mediaType === 'audio') {
                        user.audioTrack?.play();
                    }
                });

                client.current.on('user-unpublished', (user, mediaType) => {
                    if (mediaType === 'video') {
                        setUsers(prev => prev.filter(u => u.uid !== user.uid));
                    }
                });

                client.current.on('user-joined', () => {
                    setCallStatus('Connected');
                });

                client.current.on('user-left', () => {
                    setUsers(prev => prev.filter(u => true)); // Logic to remove user, or end call if 1:1
                    if (!targetUser) return; // Group call logic might differ
                    setCallStatus('User Left');
                    setTimeout(onClose, 1000);
                });

                // 4. Join Channel
                // Use currentUser.id as the UID (string) if possible, but Agora Web SDK prefers number or string.
                // Our backend gen token uses string account.
                await client.current.join(appId, conversationId, token, currentUser.id);

                // 5. Create & Publish Local Tracks
                if (callType === 'video') {
                    const tracks = await AgoraRTC.createMicrophoneAndCameraTracks();
                    setLocalTracks(tracks);
                    await client.current.publish(tracks);
                    const [audio, video] = tracks;
                    video.play('local-player');
                } else {
                    const audio = await AgoraRTC.createMicrophoneAudioTrack();
                    setLocalTracks([audio]);
                    await client.current.publish(audio);
                }

                setJoined(true);

            } catch (error) {
                console.error("Call init failed:", error);
                setCallStatus("Connection Failed");
                setTimeout(onClose, 2000);
            }
        };

        initCall();

        return () => {
            localTracks.forEach(track => { track.stop(); track.close(); });
            client.current?.leave();
        };
    }, []);

    // Handle Remote Videos
    useEffect(() => {
        users.forEach(user => {
            if (user.videoTrack) {
                user.videoTrack.play(`remote-player-${user.uid}`);
            }
        });
    }, [users]);

    const toggleMute = async () => {
        if (localTracks[0]) {
            await localTracks[0].setEnabled(isMuted); // Logic inverted: setEnabled(true) unmutes
            setIsMuted(!isMuted);
        }
    };

    const toggleVideo = async () => {
        if (localTracks[1]) {
            await localTracks[1].setEnabled(isVideoOff);
            setIsVideoOff(!isVideoOff);
        }
    };

    const endCall = () => {
        if (targetUser) {
            sendCallSignal('reject', { conversationId, targetId: targetUser.id, userId: currentUser.id }); // Reuse reject as generic hangup signal
        }
        onClose();
    };

    return (
        <AnimatePresence>
            {!isMinimized ? (
                <MotionDiv 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    className="fixed inset-0 z-[100] bg-gray-900 flex flex-col"
                >
                    {/* Header */}
                    <div className="absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-start bg-gradient-to-b from-black/60 to-transparent">
                        <div className="text-white">
                            <h2 className="text-xl font-bold drop-shadow-md">{targetUser ? targetUser.username : 'Group Call'}</h2>
                            <p className="text-sm opacity-80 animate-pulse">{callStatus}</p>
                        </div>
                        <button onClick={() => setIsMinimized(true)} className="p-2 bg-white/10 rounded-full text-white hover:bg-white/20">
                            <Minimize2 size={24} />
                        </button>
                    </div>

                    {/* Main Video Area */}
                    <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
                        
                        {/* Remote Videos Grid */}
                        {users.length > 0 ? (
                            <div className={`w-full h-full grid ${users.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-1`}>
                                {users.map(user => (
                                    <div key={user.uid} id={`remote-player-${user.uid}`} className="w-full h-full bg-gray-800 relative">
                                        <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">User {user.uid.slice(0,4)}...</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center text-white/50">
                                <div className="h-32 w-32 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                                    {targetUser?.avatar_url ? (
                                        <img src={targetUser.avatar_url} className="w-full h-full rounded-full object-cover opacity-50" />
                                    ) : (
                                        <span className="text-4xl font-bold">{targetUser?.username[0]}</span>
                                    )}
                                </div>
                                <p>En attente...</p>
                            </div>
                        )}

                        {/* Local Video (Floating PiP) */}
                        {callType === 'video' && (
                            <div className="absolute bottom-24 right-4 w-32 h-48 bg-gray-800 rounded-xl overflow-hidden shadow-2xl border-2 border-white/20 z-10">
                                <div id="local-player" className="w-full h-full object-cover" />
                                {isVideoOff && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white">
                                        <VideoOff size={24} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Controls Footer */}
                    <div className="h-24 bg-gray-900 flex items-center justify-center gap-6 pb-4">
                        <button onClick={toggleMute} className={`p-4 rounded-full transition-all ${isMuted ? 'bg-white text-gray-900' : 'bg-gray-700 text-white hover:bg-gray-600'}`}>
                            {isMuted ? <MicOff size={28} /> : <Mic size={28} />}
                        </button>
                        
                        <button onClick={endCall} className="p-5 rounded-full bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600 transform hover:scale-110 transition-all">
                            <PhoneOff size={32} />
                        </button>

                        {callType === 'video' && (
                            <button onClick={toggleVideo} className={`p-4 rounded-full transition-all ${isVideoOff ? 'bg-white text-gray-900' : 'bg-gray-700 text-white hover:bg-gray-600'}`}>
                                {isVideoOff ? <VideoOff size={28} /> : <Video size={28} />}
                            </button>
                        )}
                    </div>
                </MotionDiv>
            ) : (
                // Minimized View
                <MotionDiv 
                    drag 
                    whileHover={{ scale: 1.05 }}
                    initial={{ scale: 0 }} animate={{ scale: 1 }} 
                    className="fixed bottom-20 right-4 z-[100] w-24 h-32 bg-gray-800 rounded-xl shadow-2xl border-2 border-brand-500 overflow-hidden cursor-pointer"
                    onClick={() => setIsMinimized(false)}
                >
                    <div className="w-full h-full bg-black relative">
                        {/* Show remote video if available, else local */}
                        {users.length > 0 && <div className="absolute inset-0 bg-green-500/20 animate-pulse"></div>}
                        <div className="absolute inset-0 flex items-center justify-center text-white">
                            <Phone size={24} />
                        </div>
                    </div>
                </MotionDiv>
            )}
        </AnimatePresence>
    );
};