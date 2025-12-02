import React, { useEffect, useRef, useState, useMemo } from 'react';
import AgoraRTC, { 
    IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, ILocalVideoTrack, 
    UID
} from 'agora-rtc-sdk-ng';
import { User } from '../../types';
import { getAgoraTokenAPI, sendCallSignal } from '../../services/api';
import { 
    PhoneOff, Video, VideoOff, Mic, MicOff, Minimize2, Settings, X, Signal, 
    MonitorUp, Maximize2, Mic as MicIcon, Camera as CameraIcon, Speaker, User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MotionDiv = motion.div as any;
const MotionButton = motion.button as any;

interface CallInterfaceProps {
    conversationId: string;
    currentUser: User;
    targetUser?: User | null;
    isCaller: boolean;
    callType: 'audio' | 'video';
    onClose: () => void;
}

// --- CONFIGURATION ---
const isMobile = window.innerWidth < 768;

const CAMERA_ENCODER_CONFIG: any = isMobile ? {
    width: { ideal: 1280, min: 640 },
    height: { ideal: 720, min: 480 },
    frameRate: { min: 30, max: 60, ideal: 60 },
    bitrateMin: 1500, bitrateMax: 3000,
    optimizationMode: "motion"
} : {
    width: { ideal: 1920, min: 1280 },
    height: { ideal: 1080, min: 720 },
    frameRate: { min: 30, max: 60, ideal: 60 },
    bitrateMin: 3000, bitrateMax: 6000,
    optimizationMode: "motion"
};

const SCREEN_SHARE_PROFILES = {
    HD: { width: 1280, height: 720, frameRate: 60, bitrate: 3000 },
    FHD: { width: 1920, height: 1080, frameRate: 60, bitrate: 5000 },
    '2K': { width: 2560, height: 1440, frameRate: 60, bitrate: 7000 },
    '2K+': { width: 3840, height: 2160, frameRate: 60, bitrate: 9000 }
};

type ScreenQuality = keyof typeof SCREEN_SHARE_PROFILES;

interface DeviceInfo { label: string; deviceId: string; }

// Structure unifiée pour gérer Local et Remote de la même façon dans la grille
interface Participant {
    id: string | number; // UID Agora
    username: string;
    avatarUrl?: string;
    isLocal: boolean;
    hasVideo: boolean;
    hasAudio: boolean;
    videoTrack?: ICameraVideoTrack | ILocalVideoTrack | any; // Type 'any' pour remote track compatibilité
    audioTrack?: IMicrophoneAudioTrack | any;
    isSpeaking: boolean; // VAD
}

export const CallInterface: React.FC<CallInterfaceProps> = ({ conversationId, currentUser, targetUser, isCaller, callType, onClose }) => {
    // --- STATE ---
    const [remoteJoined, setRemoteJoined] = useState(false);
    
    // Core Agora
    const client = useRef<IAgoraRTCClient | null>(null);
    const localAudioTrack = useRef<IMicrophoneAudioTrack | null>(null);
    const localVideoTrack = useRef<ICameraVideoTrack | null>(null);
    const localScreenTrack = useRef<ILocalVideoTrack | null>(null);
    
    // Audio Elements
    const ringbackRef = useRef<HTMLAudioElement | null>(null);

    // Participants State (Local + Remotes combined for UI)
    const [localParticipant, setLocalParticipant] = useState<Participant>({
        id: currentUser.id,
        username: 'Moi',
        avatarUrl: currentUser.avatar_url || undefined,
        isLocal: true,
        hasVideo: callType === 'video',
        hasAudio: true,
        isSpeaking: false
    });
    
    // Map of remote participants
    const [remoteParticipants, setRemoteParticipants] = useState<Participant[]>([]);

    // UI Controls
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoEnabled, setIsVideoEnabled] = useState(callType === 'video');
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [showQualityMenu, setShowQualityMenu] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [callStatus, setCallStatus] = useState(isCaller ? 'Sonnerie en cours...' : 'Connexion...');
    const [networkQuality, setNetworkQuality] = useState<number>(0);

    // Devices
    const [mics, setMics] = useState<DeviceInfo[]>([]);
    const [cams, setCams] = useState<DeviceInfo[]>([]);
    const [speakers, setSpeakers] = useState<DeviceInfo[]>([]);
    const [selectedMic, setSelectedMic] = useState('');
    const [selectedCam, setSelectedCam] = useState('');
    const [selectedSpeaker, setSelectedSpeaker] = useState('');

    // --- AUTO-MUTE BACKGROUND (PERFORMANCE) ---
    useEffect(() => {
        const handleVisibilityChange = async () => {
            if (document.hidden) {
                if (localVideoTrack.current && isVideoEnabled) {
                    await localVideoTrack.current.setEnabled(false);
                }
            } else {
                if (localVideoTrack.current && isVideoEnabled && !isScreenSharing) {
                    await localVideoTrack.current.setEnabled(true);
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isVideoEnabled, isScreenSharing]);

    // --- DEVICE FETCHING ---
    useEffect(() => {
        const fetchDevices = async () => {
            try {
                const devices = await AgoraRTC.getDevices();
                setMics(devices.filter(d => d.kind === 'audioinput').map(d => ({ label: d.label || 'Microphone', deviceId: d.deviceId })));
                setCams(devices.filter(d => d.kind === 'videoinput').map(d => ({ label: d.label || 'Camera', deviceId: d.deviceId })));
                setSpeakers(devices.filter(d => d.kind === 'audiooutput').map(d => ({ label: d.label || 'Speaker', deviceId: d.deviceId })));
            } catch (e) { console.error("Error fetching devices", e); }
        };
        fetchDevices();
        AgoraRTC.onMicrophoneChanged = fetchDevices;
        AgoraRTC.onCameraChanged = fetchDevices;
        AgoraRTC.onPlaybackDeviceChanged = fetchDevices;
    }, []);

    const switchMicrophone = async (deviceId: string) => {
        setSelectedMic(deviceId);
        if (localAudioTrack.current) await localAudioTrack.current.setDevice(deviceId);
    };
    const switchCamera = async (deviceId: string) => {
        setSelectedCam(deviceId);
        if (localVideoTrack.current) await localVideoTrack.current.setDevice(deviceId);
    };
    const switchSpeaker = async (deviceId: string) => {
        setSelectedSpeaker(deviceId);
        remoteParticipants.forEach(u => {
             // @ts-ignore
             if (u.audioTrack && u.audioTrack.setAudioOutput) u.audioTrack.setAudioOutput(deviceId);
        });
    };

    // --- INITIALIZATION ---
    useEffect(() => {
        if (isCaller) {
            ringbackRef.current = new Audio('https://upload.wikimedia.org/wikipedia/commons/c/cd/US_ringback_tone.ogg');
            ringbackRef.current.loop = true;
            ringbackRef.current.play().catch(() => {});
        }

        const initCall = async () => {
            try {
                const { token, appId } = await getAgoraTokenAPI(conversationId);
                client.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

                // --- EVENT LISTENERS ---

                // User Published (Video/Audio)
                client.current.on('user-published', async (user, mediaType) => {
                    await client.current?.subscribe(user, mediaType);
                    
                    setRemoteParticipants(prev => {
                        const existing = prev.find(p => p.id === user.uid);
                        // Default remote user structure
                        const newUser = existing || {
                            id: user.uid,
                            username: targetUser?.username || `User ${user.uid}`,
                            avatarUrl: targetUser?.avatar_url || undefined,
                            isLocal: false,
                            hasVideo: user.hasVideo,
                            hasAudio: user.hasAudio,
                            videoTrack: user.videoTrack,
                            audioTrack: user.audioTrack,
                            isSpeaking: false
                        };

                        if (mediaType === 'video') {
                            newUser.videoTrack = user.videoTrack;
                            newUser.hasVideo = true;
                        } else {
                            newUser.audioTrack = user.audioTrack;
                            newUser.hasAudio = true;
                            user.audioTrack?.play();
                        }
                        
                        return existing ? prev.map(p => p.id === user.uid ? newUser : p) : [...prev, newUser];
                    });
                });

                // User Unpublished (Mute/Disable)
                client.current.on('user-unpublished', (user, mediaType) => {
                     setRemoteParticipants(prev => prev.map(p => p.id === user.uid ? {
                        ...p,
                        [mediaType === 'video' ? 'hasVideo' : 'hasAudio']: false
                    } : p));
                });

                // User Left
                client.current.on('user-left', (user) => {
                    setRemoteParticipants(prev => prev.filter(p => p.id !== user.uid));
                    if (client.current?.remoteUsers.length === 0) {
                        setRemoteJoined(false);
                        setCallStatus('Appel terminé');
                        setTimeout(endCall, 1000);
                    }
                });

                client.current.on('user-joined', () => {
                    setRemoteJoined(true);
                    setCallStatus('Connecté');
                    if (ringbackRef.current) { ringbackRef.current.pause(); ringbackRef.current = null; }
                });

                // --- VOLUME INDICATOR (VAD) ---
                client.current.enableAudioVolumeIndicator();
                client.current.on("volume-indicator", volumes => {
                    volumes.forEach((volume) => {
                        const threshold = 5; // Sensitivity
                        // Local
                        if (volume.uid === currentUser.id || volume.uid === 0) {
                             setLocalParticipant(prev => ({...prev, isSpeaking: volume.level > threshold}));
                        } 
                        // Remote
                        else {
                            setRemoteParticipants(prev => prev.map(p => p.id === volume.uid ? {...p, isSpeaking: volume.level > threshold} : p));
                        }
                    });
                });

                client.current.on('network-quality', (stats) => setNetworkQuality(stats.downlinkNetworkQuality));

                // --- JOIN & PUBLISH ---
                await client.current.join(appId, conversationId, token, currentUser.id);

                // Create Local Tracks
                localAudioTrack.current = await AgoraRTC.createMicrophoneAudioTrack();
                if(selectedMic) await localAudioTrack.current.setDevice(selectedMic);
                
                await client.current.publish(localAudioTrack.current);
                setLocalParticipant(p => ({...p, audioTrack: localAudioTrack.current, hasAudio: true}));

                if (callType === 'video') {
                    localVideoTrack.current = await AgoraRTC.createCameraVideoTrack({ encoderConfig: CAMERA_ENCODER_CONFIG });
                    if(selectedCam) await localVideoTrack.current.setDevice(selectedCam);
                    
                    await client.current.publish(localVideoTrack.current);
                    
                    setLocalParticipant(p => ({...p, videoTrack: localVideoTrack.current, hasVideo: true}));
                    setIsVideoEnabled(true);
                }

            } catch (error) {
                console.error("Init failed", error);
                setCallStatus("Erreur connexion");
                if (ringbackRef.current) ringbackRef.current.pause();
                setTimeout(onClose, 2000);
            }
        };

        initCall();

        return () => {
            if (ringbackRef.current) ringbackRef.current.pause();
            localAudioTrack.current?.close();
            localVideoTrack.current?.close();
            localScreenTrack.current?.close();
            client.current?.leave();
        };
    }, []);

    // --- ACTIONS ---
    const toggleMute = async () => {
        if (localAudioTrack.current) {
            await localAudioTrack.current.setEnabled(isMuted);
            setIsMuted(!isMuted);
            setLocalParticipant(p => ({...p, hasAudio: isMuted}));
        }
    };

    const toggleVideo = async () => {
        if (isScreenSharing) { alert("Arrêtez le partage d'écran d'abord."); return; }
        if (localVideoTrack.current) {
            await localVideoTrack.current.setEnabled(!isVideoEnabled);
            setIsVideoEnabled(!isVideoEnabled);
            setLocalParticipant(p => ({...p, hasVideo: !isVideoEnabled}));
        } else {
            localVideoTrack.current = await AgoraRTC.createCameraVideoTrack({ encoderConfig: CAMERA_ENCODER_CONFIG });
            if(selectedCam) await localVideoTrack.current.setDevice(selectedCam);
            await client.current?.publish(localVideoTrack.current);
            setLocalParticipant(p => ({...p, videoTrack: localVideoTrack.current, hasVideo: true}));
            setIsVideoEnabled(true);
        }
    };

    const startScreenShare = async (quality: ScreenQuality) => {
        setShowQualityMenu(false);
        try {
            if (localVideoTrack.current) { 
                await client.current?.unpublish(localVideoTrack.current); 
                setIsVideoEnabled(false);
                setLocalParticipant(p => ({...p, hasVideo: false})); 
            }
            const config = SCREEN_SHARE_PROFILES[quality];
            const screenTrack = await AgoraRTC.createScreenVideoTrack({ encoderConfig: { ...config, bitrateMax: config.bitrate }, optimizationMode: "motion" });
            const actualTrack = Array.isArray(screenTrack) ? screenTrack[0] : screenTrack;
            await client.current?.publish(actualTrack);
            localScreenTrack.current = actualTrack;
            setIsScreenSharing(true);
            setLocalParticipant(p => ({...p, videoTrack: actualTrack, hasVideo: true}));
            
            actualTrack.on("track-ended", stopScreenShare);
        } catch (e) { 
            console.error("Share failed", e); 
            if (localVideoTrack.current) { 
                await client.current?.publish(localVideoTrack.current); 
                setIsVideoEnabled(true); 
                setLocalParticipant(p => ({...p, hasVideo: true}));
            } 
        }
    };

    const stopScreenShare = async () => {
        if (localScreenTrack.current) {
            await client.current?.unpublish(localScreenTrack.current);
            localScreenTrack.current.close(); localScreenTrack.current = null; setIsScreenSharing(false);
            if (localVideoTrack.current) { 
                await client.current?.publish(localVideoTrack.current); 
                setIsVideoEnabled(true); 
                setLocalParticipant(p => ({...p, videoTrack: localVideoTrack.current, hasVideo: true}));
            }
        }
    };

    const endCall = () => { if (targetUser) sendCallSignal('reject', { conversationId, targetId: targetUser.id, userId: currentUser.id }); onClose(); };
    const getNetworkIcon = () => { if (networkQuality > 4) return <Signal size={16} className="text-red-500" />; if (networkQuality > 2) return <Signal size={16} className="text-yellow-500" />; return <Signal size={16} className="text-green-500" />; };

    // --- GRID COMPUTATION ---
    const allParticipants = useMemo(() => {
        // Only show remote users if they have joined (unless waiting screen)
        if (!remoteJoined) return [];
        return [localParticipant, ...remoteParticipants];
    }, [localParticipant, remoteParticipants, remoteJoined]);

    // Grid CSS class generator
    const getGridClass = (count: number) => {
        if (count <= 1) return 'grid-cols-1 grid-rows-1';
        if (count === 2) return 'grid-cols-1 md:grid-cols-2'; // Stack on mobile, side-by-side on desktop
        if (count <= 4) return 'grid-cols-2 grid-rows-2';
        return 'grid-cols-3';
    };

    // --- MINI PLAYER RENDER ---
    if (isMinimized) {
        return (
            <MotionDiv drag dragMomentum={false} initial={{ scale: 0 }} animate={{ scale: 1 }} className="fixed bottom-24 right-4 z-[100] w-32 h-48 bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden flex flex-col cursor-pointer" onClick={() => setIsMinimized(false)}>
                 <div className="flex-1 relative bg-black">
                     {remoteJoined && remoteParticipants.length > 0 ? (
                         <Tile participant={remoteParticipants[0]} isMini={true} />
                     ) : (
                         <div className="w-full h-full flex items-center justify-center"><UserIcon className="text-gray-500"/></div>
                     )}
                     <div className="absolute top-2 right-2 w-8 h-12 bg-gray-800 rounded border border-white/20 overflow-hidden">
                        <Tile participant={localParticipant} isMini={true} />
                     </div>
                 </div>
            </MotionDiv>
        );
    }

    return (
        <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-[#1a1a1a] text-white flex flex-col font-sans overflow-hidden">
            
            {/* --- HEADER --- */}
            <div className="absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
                    <button onClick={() => setIsMinimized(true)} className="hover:text-gray-300"><Minimize2 size={18}/></button>
                    <div className="w-[1px] h-4 bg-white/20"></div>
                    <div>
                        <h2 className="font-bold text-sm leading-none flex items-center gap-2">
                            {targetUser?.username || 'Appel'}
                            {remoteJoined && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>}
                        </h2>
                        <span className="text-[10px] text-gray-400 flex items-center gap-1">{getNetworkIcon()} {callStatus}</span>
                    </div>
                </div>
                <button onClick={() => setShowSettings(true)} className="pointer-events-auto p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full border border-white/10 transition-colors"><Settings size={18} className="text-gray-300" /></button>
            </div>

            {/* --- SETTINGS MODAL --- */}
            <AnimatePresence>
                {showSettings && (
                    <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="bg-gray-800 w-full max-w-sm rounded-2xl p-6 border border-gray-700 relative shadow-2xl">
                            <button onClick={() => setShowSettings(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={20}/></button>
                            <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><Settings size={18} className="text-brand-500"/> Paramètres</h3>
                            <div className="space-y-4">
                                <div><label className="text-xs font-semibold text-gray-400 uppercase mb-2 block">Microphone</label><select value={selectedMic} onChange={(e) => switchMicrophone(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm">{mics.map(m => <option key={m.deviceId} value={m.deviceId}>{m.label}</option>)}</select></div>
                                <div><label className="text-xs font-semibold text-gray-400 uppercase mb-2 block">Caméra</label><select value={selectedCam} onChange={(e) => switchCamera(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm">{cams.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}</select></div>
                                <div><label className="text-xs font-semibold text-gray-400 uppercase mb-2 block">Haut-parleur</label><select value={selectedSpeaker} onChange={(e) => switchSpeaker(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm">{speakers.map(s => <option key={s.deviceId} value={s.deviceId}>{s.label}</option>)}</select></div>
                            </div>
                            <button onClick={() => setShowSettings(false)} className="w-full mt-6 bg-brand-600 hover:bg-brand-500 text-white py-3 rounded-xl font-bold transition-colors">OK</button>
                        </div>
                    </MotionDiv>
                )}
            </AnimatePresence>

            {/* --- MAIN GRID STAGE --- */}
            <div className="flex-1 w-full h-full relative p-2 md:p-4 flex items-center justify-center overflow-hidden">
                {!remoteJoined ? (
                    // WAITING SCREEN
                    <div className="flex flex-col items-center justify-center animate-in fade-in zoom-in duration-500">
                        <div className="relative mb-8">
                            <div className="h-32 w-32 md:h-40 md:w-40 rounded-full bg-gray-800 p-1 ring-4 ring-white/5 relative z-10 overflow-hidden shadow-2xl">
                                {targetUser?.avatar_url ? <img src={targetUser.avatar_url} className="w-full h-full rounded-full object-cover" /> : <div className="w-full h-full rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-4xl font-bold">{targetUser?.username?.[0]}</div>}
                            </div>
                            <div className="absolute inset-0 rounded-full bg-brand-500/20 animate-ping" />
                        </div>
                        <h3 className="text-2xl font-bold mb-2">Appel en cours...</h3>
                        <p className="text-gray-400 text-sm">En attente de réponse</p>
                    </div>
                ) : (
                    // ACTIVE GRID
                    <div className={`grid gap-2 md:gap-4 w-full h-full max-w-7xl max-h-[85vh] transition-all duration-500 ease-in-out ${getGridClass(allParticipants.length)}`}>
                        {allParticipants.map(participant => (
                            <Tile key={participant.id} participant={participant} />
                        ))}
                    </div>
                )}
            </div>

            {/* --- CONTROLS DOCK --- */}
            <div className="flex justify-center pb-6 pt-4 w-full z-40">
                <div className="flex items-center gap-3 px-6 py-3 bg-gray-900/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl">
                    <ControlBtn active={!isMuted} onClick={toggleMute} onIcon={<Mic size={20}/>} offIcon={<MicOff size={20}/>} />
                    <ControlBtn active={isVideoEnabled} onClick={toggleVideo} onIcon={<Video size={20}/>} offIcon={<VideoOff size={20}/>} />
                    
                    <div className="relative">
                        <ControlBtn active={isScreenSharing} onClick={() => { if(isScreenSharing) stopScreenShare(); else setShowQualityMenu(!showQualityMenu); }} onIcon={<MonitorUp size={20} className="text-white"/>} offIcon={<MonitorUp size={20}/>} className={isScreenSharing ? 'bg-green-600' : ''} />
                        <AnimatePresence>
                            {showQualityMenu && !isScreenSharing && (
                                <MotionDiv initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: -15 }} exit={{ opacity: 0 }} className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-800 border border-white/10 p-2 rounded-xl shadow-xl min-w-[140px] flex flex-col gap-1">
                                    {Object.keys(SCREEN_SHARE_PROFILES).map((q) => (<button key={q} onClick={() => startScreenShare(q as ScreenQuality)} className="px-3 py-2 text-sm text-left hover:bg-white/10 rounded-lg text-gray-200">{q}</button>))}
                                </MotionDiv>
                            )}
                        </AnimatePresence>
                    </div>

                    <div className="w-px h-8 bg-white/10 mx-1"></div>
                    <MotionButton onClick={endCall} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl shadow-lg shadow-red-600/20"><PhoneOff size={24} /></MotionButton>
                </div>
            </div>
        </MotionDiv>
    );
};

// --- SUB-COMPONENTS ---

const ControlBtn = ({ active, onClick, onIcon, offIcon, className = '' }: any) => (
    <MotionButton onClick={onClick} whileHover={{ scale: 1.1, y: -2 }} whileTap={{ scale: 0.95 }} className={`p-3.5 rounded-xl transition-all ${active ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-white text-gray-900'} ${className}`}>
        {active ? onIcon : offIcon}
    </MotionButton>
);

const Tile = ({ participant, isMini = false }: { participant: Participant, isMini?: boolean }) => {
    // Refs for Agora play
    const videoRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (videoRef.current && participant.videoTrack) {
            participant.videoTrack.play(videoRef.current);
        }
    }, [participant.videoTrack]);

    return (
        <div className={`relative w-full h-full bg-gray-800 rounded-2xl overflow-hidden shadow-lg border transition-all duration-300 ${participant.isSpeaking && !isMini ? 'border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.3)] ring-1 ring-green-500' : 'border-white/5'}`}>
            {/* Video Layer */}
            {participant.hasVideo ? (
                <div ref={videoRef} className="w-full h-full [&>div]:!w-full [&>div]:!h-full [&>video]:!object-cover" />
            ) : (
                // Avatar Fallback (Audio Only)
                <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 relative p-4">
                    {/* Audio Wave Animation */}
                    {participant.isSpeaking && !isMini && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-green-500/20 rounded-full animate-ping" />
                    )}
                    
                    <div className={`relative z-10 rounded-full bg-gray-700 overflow-hidden border-4 border-gray-800 shadow-xl ${isMini ? 'w-10 h-10' : 'w-24 h-24 md:w-32 md:h-32'}`}>
                        {participant.avatarUrl ? <img src={participant.avatarUrl} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center text-gray-400 font-bold text-2xl">{participant.username[0]}</div>}
                    </div>
                    {!isMini && <p className="mt-4 font-bold text-lg text-gray-200">{participant.username}</p>}
                </div>
            )}

            {/* Overlays */}
            {!isMini && (
                <div className="absolute bottom-4 left-4 flex gap-2 pointer-events-none">
                    <div className="bg-black/40 backdrop-blur-md px-3 py-1 rounded-lg flex items-center gap-2 border border-white/10">
                        {participant.isSpeaking && <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"/>}
                        <span className="text-xs font-bold text-white shadow-sm">{participant.username} {participant.isLocal && '(Vous)'}</span>
                    </div>
                    {!participant.hasAudio && <div className="bg-red-500/80 backdrop-blur-md p-1.5 rounded-lg text-white"><MicOff size={14}/></div>}
                </div>
            )}
            
            {/* Status Icons if No Video */}
            {!participant.hasVideo && !isMini && (
                <div className="absolute top-4 right-4 bg-black/40 backdrop-blur-md px-2 py-1 rounded text-xs text-gray-300 border border-white/5 flex items-center gap-1">
                   <VideoOff size={12}/> Caméra off
                </div>
            )}
        </div>
    );
};
