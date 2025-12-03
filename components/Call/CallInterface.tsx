import React, { useEffect, useRef, useState, useMemo, useLayoutEffect } from 'react';
import AgoraRTC, { 
    IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, ILocalVideoTrack, VideoEncoderConfiguration
} from 'agora-rtc-sdk-ng';
import { User } from '../../types';
import { getAgoraTokenAPI, sendCallSignal, logCallEnd } from '../../services/api';
import { 
    PhoneOff, Video, VideoOff, Mic, MicOff, Minimize2, Settings, X, Signal, 
    MonitorUp, User as UserIcon, Activity, Maximize2
} from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'framer-motion';

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

// --- CONFIGURATION QUALITÉ ---
// Detect mobile using both UA and screen width for robustness
const isMobileDevice = () => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

type QualityPreset = 'HD' | 'FHD' | '2K';

// Using 'any' for VideoEncoderConfiguration to allow 'optimizationMode' which might be missing in strict types
const VIDEO_PROFILES: Record<QualityPreset, any> = {
    'HD': { // 720p - Bonne balance mobile/desktop
        width: 1280, height: 720, frameRate: 30, bitrateMin: 1000, bitrateMax: 2000, optimizationMode: "motion" 
    },
    'FHD': { // 1080p - Très fluide
        width: 1920, height: 1080, frameRate: 60, bitrateMin: 2500, bitrateMax: 4000, optimizationMode: "motion" 
    },
    '2K': { // 1440p - Qualité max (PC Puissant requis)
        width: 2560, height: 1440, frameRate: 60, bitrateMin: 5000, bitrateMax: 8000, optimizationMode: "detail" 
    }
};

const SCREEN_SHARE_PROFILES = {
    HD: { width: 1920, height: 1080, frameRate: 15, bitrate: 2000 },
    FHD: { width: 1920, height: 1080, frameRate: 30, bitrate: 4000 },
    '60FPS': { width: 1920, height: 1080, frameRate: 60, bitrate: 6000 }
};

type ScreenQuality = keyof typeof SCREEN_SHARE_PROFILES;

interface DeviceInfo { label: string; deviceId: string; }

interface Participant {
    id: string | number;
    username: string;
    avatarUrl?: string;
    isLocal: boolean;
    hasVideo: boolean;
    hasAudio: boolean;
    videoTrack?: ICameraVideoTrack | ILocalVideoTrack | any;
    audioTrack?: IMicrophoneAudioTrack | any;
    isSpeaking: boolean;
    isScreenSharing: boolean; 
    joinedAt: number;
}

export const CallInterface: React.FC<CallInterfaceProps> = ({ conversationId, currentUser, targetUser, isCaller, callType, onClose }) => {
    // --- STATE ---
    const [remoteJoined, setRemoteJoined] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const constraintsRef = useRef<HTMLDivElement>(null); // For dragging constraints
    const isMobile = isMobileDevice();
    
    // Core Agora
    const client = useRef<IAgoraRTCClient | null>(null);
    const localAudioTrack = useRef<IMicrophoneAudioTrack | null>(null);
    const localVideoTrack = useRef<ICameraVideoTrack | null>(null);
    const localScreenTrack = useRef<ILocalVideoTrack | null>(null);
    
    const ringbackRef = useRef<HTMLAudioElement | null>(null);
    const hangupSoundRef = useRef<HTMLAudioElement | null>(null);

    // Call Duration
    const [startTime] = useState(Date.now());

    // Participants State
    const [localParticipant, setLocalParticipant] = useState<Participant>({
        id: currentUser.id,
        username: 'Moi',
        avatarUrl: currentUser.avatar_url || undefined,
        isLocal: true,
        hasVideo: callType === 'video',
        hasAudio: true,
        isSpeaking: false,
        isScreenSharing: false,
        joinedAt: Date.now()
    });
    
    const [remoteParticipants, setRemoteParticipants] = useState<Participant[]>([]);

    // UI Controls
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoEnabled, setIsVideoEnabled] = useState(callType === 'video');
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    
    // Config State
    const [videoQuality, setVideoQuality] = useState<QualityPreset>(isMobile ? 'HD' : 'FHD');

    // Window State
    const [isMinimized, setIsMinimized] = useState(false);
    const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

    const [showQualityMenu, setShowQualityMenu] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [callStatus, setCallStatus] = useState(isCaller ? 'Sonnerie...' : 'Connexion...');
    const [networkQuality, setNetworkQuality] = useState<number>(0);

    // Feedback State
    const [showFeedback, setShowFeedback] = useState(false);

    // Devices
    const [mics, setMics] = useState<DeviceInfo[]>([]);
    const [cams, setCams] = useState<DeviceInfo[]>([]);
    const [speakers, setSpeakers] = useState<DeviceInfo[]>([]);
    const [selectedMic, setSelectedMic] = useState('');
    const [selectedCam, setSelectedCam] = useState('');
    const [selectedSpeaker, setSelectedSpeaker] = useState('');

    useEffect(() => {
        const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // --- ANIMATION VARIANTS (Optimized for drag stability) ---
    // Note: We use fixed pixel values for Mini mode to prevent flexbox resizing weirdness during drag
    const containerVariants: Variants = {
        full: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100dvh', // Modern mobile viewport unit covers URL bar
            borderRadius: 0,
            x: 0,
            y: 0,
            scale: 1,
            zIndex: 9999,
            transition: { type: 'spring', stiffness: 200, damping: 25 }
        },
        mini: {
            position: 'fixed',
            top: 'auto',
            left: 'auto', 
            // Initial position (Bottom Right)
            right: 16,
            bottom: isMobile ? 100 : 24, 
            width: isMobile ? 120 : 320,
            height: isMobile ? 180 : 180, // Vertical ratio for mobile
            borderRadius: 16,
            zIndex: 9999,
            scale: 1,
            boxShadow: "0px 10px 40px rgba(0,0,0,0.5)",
            transition: { type: 'spring', stiffness: 200, damping: 25 }
        }
    };

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

    // --- CHANGE QUALITY ON THE FLY ---
    const handleQualityChange = async (newQuality: QualityPreset) => {
        setVideoQuality(newQuality);
        if (localVideoTrack.current) {
            try {
                await localVideoTrack.current.setEncoderConfiguration(VIDEO_PROFILES[newQuality]);
            } catch (e) { console.error("Failed to switch quality", e); }
        }
    };

    // --- INITIALIZATION ---
    useEffect(() => {
        if (isCaller) {
            ringbackRef.current = new Audio('https://upload.wikimedia.org/wikipedia/commons/c/cd/US_ringback_tone.ogg');
            ringbackRef.current.loop = true;
            ringbackRef.current.play().catch(() => {});
        }

        hangupSoundRef.current = new Audio('https://www.myinstants.com/media/sounds/discord-leave.mp3');
        hangupSoundRef.current.volume = 0.5;

        const initCall = async () => {
            try {
                const { token, appId } = await getAgoraTokenAPI(conversationId);
                client.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

                client.current.on('user-published', async (user, mediaType) => {
                    await client.current?.subscribe(user, mediaType);
                    setRemoteParticipants(prev => {
                        const existing = prev.find(p => p.id === user.uid);
                        const newUser = existing || {
                            id: user.uid,
                            username: targetUser?.id === user.uid ? targetUser.username : `User ${user.uid}`,
                            avatarUrl: targetUser?.id === user.uid ? (targetUser.avatar_url || undefined) : undefined,
                            isLocal: false,
                            hasVideo: user.hasVideo,
                            hasAudio: user.hasAudio,
                            videoTrack: user.videoTrack,
                            audioTrack: user.audioTrack,
                            isSpeaking: false,
                            isScreenSharing: false, 
                            joinedAt: Date.now()
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

                client.current.on('user-unpublished', (user, mediaType) => {
                     setRemoteParticipants(prev => prev.map(p => p.id === user.uid ? {
                        ...p,
                        [mediaType === 'video' ? 'hasVideo' : 'hasAudio']: false
                    } : p));
                });

                client.current.on('user-left', (user) => {
                    setRemoteParticipants(prev => prev.filter(p => p.id !== user.uid));
                    if (client.current?.remoteUsers.length === 0) {
                        setRemoteJoined(false);
                        setCallStatus('Appel terminé');
                        setTimeout(() => { if (!isCaller) onClose(); }, 2000);
                    }
                });

                client.current.on('user-joined', () => {
                    setRemoteJoined(true);
                    setCallStatus('Connecté');
                    if (ringbackRef.current) { ringbackRef.current.pause(); ringbackRef.current = null; }
                });

                client.current.enableAudioVolumeIndicator();
                client.current.on("volume-indicator", volumes => {
                    const threshold = 5; 
                    volumes.forEach(volume => {
                        const isSpeaking = volume.level > threshold;
                        if (volume.uid === 0 || volume.uid === currentUser.id) {
                            setLocalParticipant(prev => (prev.isSpeaking !== isSpeaking ? { ...prev, isSpeaking } : prev));
                        } else {
                            setRemoteParticipants(prev => {
                                const index = prev.findIndex(p => p.id === volume.uid);
                                if (index !== -1 && prev[index].isSpeaking !== isSpeaking) {
                                    const newArr = [...prev];
                                    newArr[index] = { ...newArr[index], isSpeaking };
                                    return newArr;
                                }
                                return prev;
                            });
                        }
                    });
                });

                client.current.on('network-quality', (stats) => setNetworkQuality(stats.downlinkNetworkQuality));

                await client.current.join(appId, conversationId, token, currentUser.id);

                localAudioTrack.current = await AgoraRTC.createMicrophoneAudioTrack();
                if(selectedMic) await localAudioTrack.current.setDevice(selectedMic);
                await client.current.publish(localAudioTrack.current);
                setLocalParticipant(p => ({...p, audioTrack: localAudioTrack.current, hasAudio: true}));

                if (callType === 'video') {
                    localVideoTrack.current = await AgoraRTC.createCameraVideoTrack({ 
                        encoderConfig: VIDEO_PROFILES[videoQuality] 
                    });
                    if(selectedCam) await localVideoTrack.current.setDevice(selectedCam);
                    await client.current.publish(localVideoTrack.current);
                    setLocalParticipant(p => ({...p, videoTrack: localVideoTrack.current, hasVideo: true}));
                    setIsVideoEnabled(true);
                }

            } catch (error) {
                console.error("Init failed", error);
                setCallStatus("Erreur");
                if (ringbackRef.current) ringbackRef.current.pause();
            }
        };

        initCall();

        return () => {
            if (ringbackRef.current) ringbackRef.current.pause();
            localAudioTrack.current?.stop();
            localAudioTrack.current?.close();
            localVideoTrack.current?.stop();
            localVideoTrack.current?.close();
            localScreenTrack.current?.stop();
            localScreenTrack.current?.close();
            if (client.current) {
                client.current.leave();
                client.current.removeAllListeners();
            }
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
            localVideoTrack.current = await AgoraRTC.createCameraVideoTrack({ encoderConfig: VIDEO_PROFILES[videoQuality] });
            if(selectedCam) await localVideoTrack.current.setDevice(selectedCam);
            await client.current?.publish(localVideoTrack.current);
            setLocalParticipant(p => ({...p, videoTrack: localVideoTrack.current, hasVideo: true}));
            setIsVideoEnabled(true);
        }
    };

    const toggleMinimize = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setIsMinimized(!isMinimized);
    };

    const startScreenShare = async (quality: ScreenQuality) => {
        setShowQualityMenu(false);
        try {
            if (localVideoTrack.current) { 
                await client.current?.unpublish(localVideoTrack.current); 
                setIsVideoEnabled(false);
                setLocalParticipant(p => ({...p, hasVideo: false })); 
            }
            const config = SCREEN_SHARE_PROFILES[quality];
            const screenTrack = await AgoraRTC.createScreenVideoTrack({ encoderConfig: { ...config, bitrateMax: config.bitrate }, optimizationMode: "detail" });
            const actualTrack = Array.isArray(screenTrack) ? screenTrack[0] : screenTrack;
            await client.current?.publish(actualTrack);
            localScreenTrack.current = actualTrack;
            setIsScreenSharing(true);
            setLocalParticipant(p => ({...p, videoTrack: actualTrack, hasVideo: true, isScreenSharing: true }));
            
            actualTrack.on("track-ended", stopScreenShare);
        } catch (e) { 
            console.error("Share failed", e); 
            if (localVideoTrack.current) { 
                await client.current?.publish(localVideoTrack.current); 
                setIsVideoEnabled(true); 
                setLocalParticipant(p => ({...p, hasVideo: true }));
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
                setLocalParticipant(p => ({...p, videoTrack: localVideoTrack.current, hasVideo: true, isScreenSharing: false }));
            }
        }
    };

    const endCall = () => { 
        if (targetUser) sendCallSignal('reject', { conversationId, targetId: targetUser.id, userId: currentUser.id });
        if (hangupSoundRef.current) hangupSoundRef.current.play().catch(e => console.error(e));
        
        const duration = Math.floor((Date.now() - startTime) / 1000);
        logCallEnd(conversationId, duration, currentUser.id);

        if (client.current) client.current.leave();
        setShowFeedback(true);
        setTimeout(onClose, 100);
    };

    const getNetworkIcon = () => { if (networkQuality > 4) return <Signal size={16} className="text-red-500" />; if (networkQuality > 2) return <Signal size={16} className="text-yellow-500" />; return <Signal size={16} className="text-green-500" />; };

    // --- LAYOUT LOGIC ---
    const focusParticipant = useMemo(() => {
        if (localParticipant.isScreenSharing) return localParticipant;
        return remoteParticipants.find(p => p.isScreenSharing);
    }, [localParticipant, remoteParticipants]);

    const gridParticipants = useMemo(() => {
        let all = [localParticipant, ...remoteParticipants];
        if (focusParticipant) {
            all = all.filter(p => p.id !== focusParticipant.id);
        }
        return all;
    }, [localParticipant, remoteParticipants, focusParticipant]);

    // --- RENDER ---
    return (
        <>
            {/* Constraints Container for Dragging - Stays Fixed behind Mini Mode */}
            {isMinimized && <div ref={constraintsRef} className="fixed inset-4 pointer-events-none z-[9990]" />}

            <MotionDiv 
                drag={isMinimized}
                dragConstraints={constraintsRef}
                dragElastic={0} // ABSOLUTELY NO ELASTICITY
                dragMomentum={false} // Precise dropping without inertia
                initial="full"
                animate={isMinimized ? "mini" : "full"}
                variants={containerVariants}
                className="bg-[#121212] overflow-hidden shadow-2xl touch-none flex flex-col"
                style={{ 
                    // Crucial: Use origin to prevent jumpy layout transitions
                    transformOrigin: isMinimized ? 'bottom right' : 'center center',
                    // Border only in mini mode
                    border: isMinimized ? '1px solid rgba(255,255,255,0.1)' : 'none'
                }}
            >
                {/* --- MINI MODE CONTENT --- */}
                {isMinimized ? (
                    <div className="w-full h-full relative cursor-move" onClick={(e) => toggleMinimize(e)}>
                         <div className="w-full h-full bg-gray-900 flex flex-col items-center justify-center relative overflow-hidden">
                            {remoteJoined && remoteParticipants.length > 0 ? (
                                <Tile participant={focusParticipant || remoteParticipants[0]} isMini={true} fit="cover" />
                            ) : (
                                <div className="flex flex-col items-center justify-center text-gray-500">
                                    <div className="animate-pulse mb-2"><UserIcon size={24} /></div>
                                    <span className="text-[10px] font-medium">{callStatus}</span>
                                </div>
                            )}
                         </div>

                         {/* Self View Overlay (PIP) */}
                         <div className="absolute bottom-2 right-2 w-[30%] aspect-[3/4] bg-gray-800 rounded-lg border border-white/20 overflow-hidden shadow-lg z-20 pointer-events-none">
                            <Tile participant={localParticipant} isMini={true} fit="cover" />
                         </div>

                         {/* Hover Overlay */}
                         <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                             <Maximize2 className="text-white drop-shadow-md" size={24} />
                         </div>
                    </div>
                ) : (
                    /* --- FULL MODE CONTENT --- */
                    <div className="w-full h-full flex flex-col relative">
                        {/* Header */}
                        <div className="absolute top-0 left-0 right-0 p-4 pt-[calc(env(safe-area-inset-top)+1rem)] z-30 flex justify-between items-start pointer-events-none bg-gradient-to-b from-black/80 to-transparent">
                            <button onClick={(e) => toggleMinimize(e)} className="pointer-events-auto p-3 bg-white/10 backdrop-blur-md rounded-full text-white hover:bg-white/20 transition-colors">
                                <Minimize2 size={24}/>
                            </button>
                            <div className="flex flex-col items-center pointer-events-auto mt-2">
                                <h2 className="font-bold text-lg drop-shadow-md flex items-center gap-2 text-white">
                                    {targetUser?.username || (remoteParticipants.length > 0 ? "Conférence" : "Appel")}
                                    {remoteJoined && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]"></div>}
                                </h2>
                                <span className="text-xs text-gray-300 font-medium flex items-center gap-1.5 bg-black/30 px-2 py-0.5 rounded-full backdrop-blur-sm mt-1">
                                    {getNetworkIcon()} {callStatus}
                                </span>
                            </div>
                            <button onClick={() => setShowSettings(true)} className="pointer-events-auto p-3 bg-white/10 backdrop-blur-md rounded-full text-white hover:bg-white/20 transition-colors">
                                <Settings size={24}/>
                            </button>
                        </div>

                        {/* Settings Modal */}
                        <AnimatePresence>
                            {showSettings && (
                                <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
                                    <div className="bg-gray-900 w-full max-w-sm rounded-3xl p-6 border border-gray-800 relative shadow-2xl">
                                        <div className="flex justify-between items-center mb-6">
                                            <h3 className="text-xl font-bold flex items-center gap-2 text-white"><Settings size={20} className="text-brand-500"/> Paramètres</h3>
                                            <button onClick={() => setShowSettings(false)} className="p-2 bg-gray-800 rounded-full text-gray-400 hover:text-white"><X size={20}/></button>
                                        </div>
                                        <div className="space-y-5 text-gray-200">
                                            <div>
                                                <label className="text-xs font-bold text-gray-500 uppercase mb-3 block flex items-center gap-2"><Activity size={14}/> Qualité Vidéo</label>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {Object.keys(VIDEO_PROFILES).map((q) => (
                                                        <button key={q} onClick={() => handleQualityChange(q as QualityPreset)} className={`py-2.5 rounded-xl text-sm font-bold border transition-all ${videoQuality === q ? 'bg-brand-500 border-brand-500 text-white shadow-lg shadow-brand-500/20' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}>{q}</button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div><label className="text-xs font-bold text-gray-500 uppercase mb-2 block">Microphone</label><select value={selectedMic} onChange={(e) => switchMicrophone(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-brand-500">{mics.map(m => <option key={m.deviceId} value={m.deviceId}>{m.label}</option>)}</select></div>
                                            <div><label className="text-xs font-bold text-gray-500 uppercase mb-2 block">Caméra</label><select value={selectedCam} onChange={(e) => switchCamera(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-brand-500">{cams.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}</select></div>
                                        </div>
                                    </div>
                                </MotionDiv>
                            )}
                        </AnimatePresence>

                        {/* Grid */}
                        <div ref={containerRef} className="flex-1 w-full h-full relative flex flex-col bg-gray-950">
                            {!remoteJoined && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
                                    <div className="relative mb-8">
                                        <div className="h-32 w-32 md:h-40 md:w-40 rounded-full bg-gray-800 p-1 ring-4 ring-white/5 relative z-10 overflow-hidden shadow-2xl">
                                            {targetUser?.avatar_url ? <img src={targetUser.avatar_url} className="w-full h-full rounded-full object-cover" /> : <div className="w-full h-full rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-4xl font-bold text-white">{targetUser?.username?.[0]}</div>}
                                        </div>
                                        <div className="absolute -inset-4 rounded-full border-2 border-brand-500/30 animate-ping"></div>
                                        <div className="absolute -inset-8 rounded-full border border-brand-500/10 animate-ping delay-300"></div>
                                    </div>
                                    <h3 className="text-2xl font-bold mb-2 animate-pulse text-white">{callStatus}</h3>
                                </div>
                            )}

                            <div className="w-full h-full flex flex-col p-0 md:p-4 gap-0 md:gap-2">
                                {focusParticipant ? (
                                    <div className="flex-1 flex flex-col md:flex-row gap-2 h-full overflow-hidden relative">
                                        <div className="flex-1 bg-black md:rounded-3xl overflow-hidden relative shadow-2xl">
                                            <Tile participant={focusParticipant} fit="contain" />
                                            <div className="absolute top-20 left-4 bg-black/60 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 backdrop-blur-md border border-white/10 z-20 text-white">
                                                <MonitorUp size={12} className="text-brand-500"/>
                                                {focusParticipant.isLocal ? 'Vous partagez' : `${focusParticipant.username}`}
                                            </div>
                                        </div>
                                        <div className={`flex md:flex-col gap-2 overflow-auto h-[120px] md:h-full md:w-[200px] bg-black/20 p-2 z-20 ${gridParticipants.length === 0 ? 'hidden' : ''}`}>
                                            {gridParticipants.map(p => (
                                                <div key={p.id} className="min-w-[100px] md:min-w-0 md:h-[140px] bg-gray-900 rounded-xl overflow-hidden flex-shrink-0 border border-white/10 relative shadow-lg">
                                                    <Tile participant={p} fit="cover" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className={`
                                        w-full h-full grid transition-all duration-500 ease-in-out gap-[2px] md:gap-3
                                        ${gridParticipants.length <= 1 ? 'grid-cols-1' :
                                          gridParticipants.length === 2 ? (isMobile ? 'grid-cols-1 grid-rows-2' : 'grid-cols-2') :
                                          gridParticipants.length <= 4 ? 'grid-cols-2 grid-rows-2' :
                                          (isMobile ? 'grid-cols-2' : 'grid-cols-3')}
                                    `}>
                                        {gridParticipants.map(p => (
                                            <div key={p.id} className={`relative w-full h-full bg-gray-900 overflow-hidden shadow-2xl ${isMobile ? '' : 'rounded-3xl border border-white/5'}`}>
                                                <Tile participant={p} fit="cover" />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Controls (Floating Island) */}
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4 flex justify-center pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
                            <div className="flex items-center justify-between gap-1 px-4 py-3 bg-gray-900/80 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] shadow-2xl w-full">
                                <ControlBtn active={!isMuted} onClick={toggleMute} onIcon={<Mic size={24}/>} offIcon={<MicOff size={24}/>} label="Micro" />
                                <ControlBtn active={isVideoEnabled} onClick={toggleVideo} onIcon={<Video size={24}/>} offIcon={<VideoOff size={24}/>} label="Caméra" />
                                {!isMobile && (
                                    <div className="relative">
                                        <ControlBtn active={isScreenSharing} onClick={() => { if(isScreenSharing) stopScreenShare(); else setShowQualityMenu(!showQualityMenu); }} onIcon={<MonitorUp size={24} className="text-white"/>} offIcon={<MonitorUp size={24}/>} className={isScreenSharing ? 'bg-green-600 text-white border-green-500' : ''} label="Partage" />
                                        <AnimatePresence>
                                            {showQualityMenu && !isScreenSharing && (
                                                <MotionDiv initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: -15 }} exit={{ opacity: 0 }} className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 bg-gray-800 border border-white/10 p-2 rounded-2xl shadow-xl min-w-[140px] flex flex-col gap-1">
                                                    {Object.keys(SCREEN_SHARE_PROFILES).map((q) => (<button key={q} onClick={() => startScreenShare(q as ScreenQuality)} className="px-3 py-2 text-sm text-left hover:bg-white/10 rounded-xl text-gray-200 font-medium transition-colors">{q}</button>))}
                                                </MotionDiv>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                )}
                                <MotionButton onClick={endCall} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="h-16 w-24 bg-red-600 hover:bg-red-500 text-white rounded-[2rem] shadow-lg shadow-red-600/30 flex items-center justify-center transition-colors ml-2">
                                    <PhoneOff size={32} fill="currentColor" />
                                </MotionButton>
                            </div>
                        </div>
                    </div>
                )}
            </MotionDiv>
        </>
    );
};

const ControlBtn = ({ active, onClick, onIcon, offIcon, className = '', label }: any) => (
    <div className="flex flex-col items-center gap-1">
        <MotionButton 
            onClick={onClick} 
            whileHover={{ scale: 1.05 }} 
            whileTap={{ scale: 0.95 }} 
            className={`
                h-14 w-14 rounded-full flex items-center justify-center transition-all duration-200 border
                ${active 
                    ? 'bg-white/10 text-white border-white/5 hover:bg-white/20' 
                    : 'bg-white text-gray-900 border-white hover:bg-gray-200'} 
                ${className}
            `}
        >
            {active ? onIcon : offIcon}
        </MotionButton>
    </div>
);

const Tile = ({ participant, fit = "cover", isMini = false }: { participant: Participant, fit?: "cover" | "contain", isMini?: boolean }) => {
    const videoRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const container = videoRef.current;
        if (container && participant.videoTrack) {
            try {
                const shouldMirror = participant.isLocal && !participant.isScreenSharing;
                participant.videoTrack.stop(); 
                participant.videoTrack.play(container, { mirror: shouldMirror, fit });
                // Force CSS transform if needed
                const videoElement = container.querySelector('video');
                if (videoElement) {
                    videoElement.style.objectFit = fit;
                    videoElement.style.transform = shouldMirror ? 'scaleX(-1)' : 'none';
                }
            } catch(e) { console.error("Track play error:", e); }
        }
        return () => { try { if (participant.videoTrack) participant.videoTrack.stop(); } catch(e) {} };
    }, [participant.videoTrack, fit, participant.isScreenSharing, isMini, participant.isLocal]); 

    // Active Speaker Border (Green Glow)
    const activeBorderClass = participant.isSpeaking && !isMini && !participant.isLocal
        ? 'ring-4 ring-green-500 z-10' 
        : '';

    return (
        <div className={`w-full h-full relative transition-all duration-200 group ${activeBorderClass}`}>
            {participant.hasVideo ? (
                <div ref={videoRef} className="w-full h-full bg-black flex items-center justify-center" />
            ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 relative p-4">
                    {participant.isSpeaking && !isMini && (
                        <>
                            <div className="absolute w-32 h-32 bg-brand-500/20 rounded-full animate-ping"></div>
                            <div className="absolute w-40 h-40 bg-brand-500/10 rounded-full animate-pulse delay-75"></div>
                        </>
                    )}
                    <div className={`relative z-10 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 overflow-hidden border-4 border-gray-800 shadow-2xl ${isMini ? 'w-12 h-12' : 'w-24 h-24 md:w-32 md:h-32'}`}>
                        {participant.avatarUrl ? <img src={participant.avatarUrl} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center text-gray-400 font-bold text-2xl">{participant.username[0]}</div>}
                    </div>
                </div>
            )}
            
            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            {!isMini && (
                <>
                    <div className="absolute bottom-24 md:bottom-4 left-4 flex flex-col items-start gap-1 pointer-events-none max-w-[85%] z-20">
                        <div className="flex items-center gap-2">
                            <span className="text-sm md:text-base font-bold text-white shadow-black drop-shadow-md truncate">{participant.username} {participant.isLocal && '(Vous)'}</span>
                            {!participant.hasAudio && <div className="bg-red-500/90 p-1 rounded-md text-white shadow-sm"><MicOff size={12}/></div>}
                        </div>
                    </div>
                    {!participant.hasVideo && (
                        <div className="absolute top-4 right-4 bg-black/40 backdrop-blur-md px-2 py-1 rounded-lg text-[10px] text-gray-300 border border-white/10 flex items-center gap-1 z-20">
                           <VideoOff size={12}/> Caméra coupée
                        </div>
                    )}
                </>
            )}
        </div>
    );
};