import React, { useEffect, useRef, useState } from 'react';
import AgoraRTC, { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, ILocalVideoTrack, VideoEncoderConfigurationPreset } from 'agora-rtc-sdk-ng';
import { User } from '../../types';
import { getAgoraTokenAPI, sendCallSignal } from '../../services/api';
import { PhoneOff, Video, VideoOff, Mic, MicOff, Minimize2, Settings, X, Signal, MonitorUp, MoreVertical, LayoutGrid, User as UserIcon } from 'lucide-react';
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

// --- CONFIGURATION QUALITÉ VIDEO (CAMERA) ---
const isMobile = window.innerWidth < 768;

// Configuration Force 60 FPS & Haute Qualité
const CAMERA_ENCODER_CONFIG: any = isMobile ? {
    // Mobile: 720p @ 60fps (1080p sur mobile web chauffe trop et lag)
    width: { ideal: 1280, min: 640 },
    height: { ideal: 720, min: 480 },
    frameRate: { min: 30, max: 60, ideal: 60 },
    bitrateMin: 1500,
    bitrateMax: 3000,
    optimizationMode: "motion" // Priorité à la fluidité (FPS) sur la netteté
} : {
    // PC: 1080p @ 60fps
    width: { ideal: 1920, min: 1280 },
    height: { ideal: 1080, min: 720 },
    frameRate: { min: 30, max: 60, ideal: 60 },
    bitrateMin: 3000,
    bitrateMax: 6000,
    optimizationMode: "motion"
};

// Profils de qualité pour le partage d'écran (60 FPS FORCÉ)
const SCREEN_SHARE_PROFILES = {
    HD: { width: 1280, height: 720, frameRate: 60, bitrate: 3000 },     // 720p 60fps
    FHD: { width: 1920, height: 1080, frameRate: 60, bitrate: 5000 },   // 1080p 60fps
    '2K': { width: 2560, height: 1440, frameRate: 60, bitrate: 7000 },  // 1440p 60fps
    '2K+': { width: 3840, height: 2160, frameRate: 60, bitrate: 9000 }  // 4K 60fps
};

type ScreenQuality = keyof typeof SCREEN_SHARE_PROFILES;

export const CallInterface: React.FC<CallInterfaceProps> = ({ conversationId, currentUser, targetUser, isCaller, callType, onClose }) => {
    // --- STATE ---
    const [remoteJoined, setRemoteJoined] = useState(false); // Est-ce que l'autre a décroché ?
    const [remoteUsers, setRemoteUsers] = useState<any[]>([]); // Utilisateurs avec VIDEO active
    
    // Tracks Locaux
    const localAudioTrack = useRef<IMicrophoneAudioTrack | null>(null);
    const localVideoTrack = useRef<ICameraVideoTrack | null>(null);
    const localScreenTrack = useRef<ILocalVideoTrack | null>(null);
    
    // Audio Elements
    const ringbackRef = useRef<HTMLAudioElement | null>(null);

    // Controls UI
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoEnabled, setIsVideoEnabled] = useState(callType === 'video');
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [showQualityMenu, setShowQualityMenu] = useState(false);
    
    // Network Quality
    const [networkQuality, setNetworkQuality] = useState<number>(0); // 0-5

    const [callStatus, setCallStatus] = useState(isCaller ? 'Sonnerie en cours...' : 'Connexion...');
    const client = useRef<IAgoraRTCClient | null>(null);

    // --- INITIALISATION ---
    useEffect(() => {
        // Init Ringback sound if caller
        if (isCaller) {
            ringbackRef.current = new Audio('https://upload.wikimedia.org/wikipedia/commons/c/cd/US_ringback_tone.ogg');
            ringbackRef.current.loop = true;
            ringbackRef.current.play().catch(e => console.log("Ringback blocked", e));
        }

        const initCall = async () => {
            try {
                const { token, appId } = await getAgoraTokenAPI(conversationId);
                
                // Mode 'rtc' pour communication temps réel, codec VP8 (meilleure compatibilité mobile) ou H264
                client.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

                // Event Listeners
                client.current.on('user-published', async (user, mediaType) => {
                    await client.current?.subscribe(user, mediaType);
                    
                    // Si remote publie de la vidéo, on l'ajoute à la liste pour l'affichage grid
                    if (mediaType === 'video') {
                        setRemoteUsers(prev => {
                            const exists = prev.find(u => u.uid === user.uid);
                            return exists ? prev : [...prev, user];
                        });
                    }
                    // Si audio, on joue simplement
                    if (mediaType === 'audio') {
                        user.audioTrack?.play();
                    }
                });

                client.current.on('user-unpublished', (user, mediaType) => {
                    if (mediaType === 'video') {
                        setRemoteUsers(prev => prev.filter(u => u.uid !== user.uid));
                    }
                });

                client.current.on('user-joined', () => {
                    setRemoteJoined(true); // L'utilisateur a rejoint !
                    setCallStatus('Connecté');
                    
                    // Stop ringback immediately
                    if (ringbackRef.current) {
                        ringbackRef.current.pause();
                        ringbackRef.current.currentTime = 0;
                        ringbackRef.current = null;
                    }
                });

                client.current.on('user-left', () => {
                    setRemoteJoined(false);
                    setRemoteUsers([]); 
                    if (targetUser) {
                        setCallStatus('Appel terminé');
                        setTimeout(endCall, 1000);
                    }
                });

                client.current.on('network-quality', (stats) => {
                    setNetworkQuality(stats.downlinkNetworkQuality);
                });

                // Join Channel
                await client.current.join(appId, conversationId, token, currentUser.id);

                // Publish Local Tracks
                // 1. Audio
                localAudioTrack.current = await AgoraRTC.createMicrophoneAudioTrack();
                await client.current.publish(localAudioTrack.current);

                // 2. Video (if enabled)
                if (callType === 'video') {
                    // Création de la piste vidéo avec la config Haute Qualité / 60 FPS
                    localVideoTrack.current = await AgoraRTC.createCameraVideoTrack({
                        encoderConfig: CAMERA_ENCODER_CONFIG
                    });
                    
                    await client.current.publish(localVideoTrack.current);
                    localVideoTrack.current.play('local-player');
                    setIsVideoEnabled(true);
                }

            } catch (error) {
                console.error("Call init failed:", error);
                setCallStatus("Échec connexion");
                if (ringbackRef.current) {
                    ringbackRef.current.pause();
                    ringbackRef.current = null;
                }
                setTimeout(onClose, 2000);
            }
        };

        initCall();

        return () => {
            if (ringbackRef.current) {
                ringbackRef.current.pause();
                ringbackRef.current = null;
            }
            localAudioTrack.current?.close();
            localVideoTrack.current?.close();
            localScreenTrack.current?.close();
            client.current?.leave();
        };
    }, []);

    // Gestion du rendu des vidéos distantes
    useEffect(() => {
        remoteUsers.forEach(user => {
            if (user.videoTrack) {
                user.videoTrack.play(`remote-player-${user.uid}`);
            }
        });
    }, [remoteUsers]);

    // --- ACTIONS ---

    const toggleMute = async () => {
        if (localAudioTrack.current) {
            await localAudioTrack.current.setEnabled(isMuted); // Toggle inverse
            setIsMuted(!isMuted);
        }
    };

    const toggleVideo = async () => {
        if (isScreenSharing) {
            alert("Arrêtez le partage d'écran pour réactiver la caméra.");
            return;
        }

        if (localVideoTrack.current) {
            await localVideoTrack.current.setEnabled(!isVideoEnabled);
            setIsVideoEnabled(!isVideoEnabled);
        } else {
            try {
                // Création à la volée avec la config Haute Qualité
                localVideoTrack.current = await AgoraRTC.createCameraVideoTrack({
                    encoderConfig: CAMERA_ENCODER_CONFIG
                });
                await client.current?.publish(localVideoTrack.current);
                localVideoTrack.current.play('local-player');
                setIsVideoEnabled(true);
            } catch (e) {
                console.error("No camera access", e);
            }
        }
    };

    const startScreenShare = async (quality: ScreenQuality) => {
        setShowQualityMenu(false);
        try {
            // Stop camera first if active
            if (localVideoTrack.current) {
                await client.current?.unpublish(localVideoTrack.current);
                // Don't close track, keep it for later, just unpublish
                setIsVideoEnabled(false); 
            }

            const config = SCREEN_SHARE_PROFILES[quality];
            
            // Create screen track
            const screenTrack = await AgoraRTC.createScreenVideoTrack({
                encoderConfig: {
                    ...config,
                    bitrateMax: config.bitrate
                },
                optimizationMode: "motion" // Force 60fps priority
            });

            const actualVideoTrack = Array.isArray(screenTrack) ? screenTrack[0] : screenTrack;

            await client.current?.publish(actualVideoTrack);
            localScreenTrack.current = actualVideoTrack;
            
            setIsScreenSharing(true);

            // Native stop handler (browser button)
            actualVideoTrack.on("track-ended", stopScreenShare);

        } catch (e) {
            console.error("Screen share failed", e);
            // Resume camera if screen share failed
            if (!isScreenSharing && localVideoTrack.current) {
                 await client.current?.publish(localVideoTrack.current);
                 setIsVideoEnabled(true);
            }
        }
    };

    const stopScreenShare = async () => {
        if (localScreenTrack.current) {
            await client.current?.unpublish(localScreenTrack.current);
            localScreenTrack.current.close();
            localScreenTrack.current = null;
            setIsScreenSharing(false);

            // Auto-resume camera
            if (localVideoTrack.current) {
                await client.current?.publish(localVideoTrack.current);
                localVideoTrack.current.play('local-player');
                setIsVideoEnabled(true);
            } else {
                 localVideoTrack.current = await AgoraRTC.createCameraVideoTrack({
                     encoderConfig: CAMERA_ENCODER_CONFIG
                 });
                 await client.current?.publish(localVideoTrack.current);
                 localVideoTrack.current.play('local-player');
                 setIsVideoEnabled(true);
            }
        }
    };

    const endCall = () => {
        if (targetUser) {
            sendCallSignal('reject', { conversationId, targetId: targetUser.id, userId: currentUser.id });
        }
        onClose();
    };

    // --- RENDER HELPERS ---

    const getNetworkIcon = () => {
        if (networkQuality > 4) return <Signal size={16} className="text-red-500" />;
        if (networkQuality > 2) return <Signal size={16} className="text-yellow-500" />;
        return <Signal size={16} className="text-green-500" />;
    };

    // --- MINIMIZED VIEW ---
    if (isMinimized) {
        return (
            <MotionDiv 
                drag dragMomentum={false}
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                className="fixed bottom-24 right-4 z-[100] w-28 h-40 bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden cursor-pointer"
                onClick={() => setIsMinimized(false)}
            >
                <div className="w-full h-full relative">
                    {remoteJoined ? (
                        remoteUsers.length > 0 ? (
                            <div id={`remote-player-mini-${remoteUsers[0].uid}`} className="w-full h-full bg-black object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-800 text-white">
                                {targetUser?.avatar_url ? <img src={targetUser.avatar_url} className="w-full h-full object-cover"/> : <UserIcon size={32}/>}
                            </div>
                        )
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gray-900 text-white animate-pulse">
                            <Signal size={24} />
                        </div>
                    )}
                </div>
            </MotionDiv>
        );
    }

    // --- FULL VIEW ---
    return (
        <MotionDiv 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#1a1a1a] text-white overflow-hidden flex flex-col font-sans"
        >
            {/* --- HEADER --- */}
            <div className="absolute top-0 left-0 right-0 p-6 z-20 flex justify-between items-center bg-gradient-to-b from-black/60 to-transparent">
                <div className="flex items-center gap-4">
                    <button onClick={() => setIsMinimized(true)} className="p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full transition-colors">
                        <Minimize2 size={20}/>
                    </button>
                    <div>
                        <h2 className="font-bold text-lg md:text-xl leading-none flex items-center gap-2">
                            {targetUser?.username || 'Appel Groupe'}
                            {remoteJoined && <span className="bg-green-500/20 text-green-400 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">En ligne</span>}
                        </h2>
                        <span className="text-xs text-gray-400 flex items-center gap-1.5 mt-1">
                            {getNetworkIcon()} {callStatus}
                        </span>
                    </div>
                </div>
                <div className="h-10 w-10 bg-white/5 rounded-full flex items-center justify-center">
                    <Settings size={20} className="text-gray-400" />
                </div>
            </div>

            {/* --- MAIN STAGE --- */}
            <div className="flex-1 relative flex items-center justify-center p-4">
                
                {/* WAITING SCREEN (If remote hasn't joined yet) */}
                {!remoteJoined ? (
                    <div className="flex flex-col items-center justify-center z-10">
                        <div className="relative">
                            <div className="h-32 w-32 md:h-40 md:w-40 rounded-full bg-gray-800 p-1 ring-4 ring-white/5 mb-8 relative z-10">
                                {targetUser?.avatar_url ? (
                                    <img src={targetUser.avatar_url} className="w-full h-full rounded-full object-cover" />
                                ) : (
                                    <div className="w-full h-full rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-4xl font-bold">
                                        {targetUser?.username?.[0]}
                                    </div>
                                )}
                            </div>
                            {/* Ripple Effect */}
                            <div className="absolute inset-0 rounded-full bg-brand-500/20 animate-ping" />
                            <div className="absolute inset-0 rounded-full bg-brand-500/10 animate-ping delay-75" style={{ animationDuration: '2s' }} />
                        </div>
                        <h3 className="text-2xl font-bold mb-2">Appel en cours...</h3>
                        <p className="text-gray-400 text-sm">En attente de réponse</p>
                    </div>
                ) : (
                    // ACTIVE CALL GRID
                    <div className="w-full h-full max-w-6xl mx-auto flex items-center justify-center">
                        {remoteUsers.length === 0 ? (
                            // AUDIO ONLY VIEW (Connected but no video)
                            <div className="flex flex-col items-center justify-center">
                                <div className="h-32 w-32 rounded-full bg-gray-800 border-4 border-green-500/50 flex items-center justify-center mb-4 relative">
                                    {targetUser?.avatar_url ? (
                                        <img src={targetUser.avatar_url} className="w-full h-full rounded-full object-cover opacity-80" />
                                    ) : (
                                        <UserIcon size={48} className="text-gray-400" />
                                    )}
                                    <div className="absolute -bottom-2 bg-green-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full">AUDIO</div>
                                </div>
                                <p className="text-xl font-semibold">{targetUser?.username}</p>
                            </div>
                        ) : (
                            // VIDEO GRID
                            <div className={`
                                w-full h-full grid gap-4 transition-all duration-500
                                ${remoteUsers.length === 1 ? 'grid-cols-1' : 'grid-cols-2 md:grid-cols-3'}
                            `}>
                                {remoteUsers.map(user => (
                                    <div key={user.uid} className="relative w-full h-full bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-white/5 group">
                                        <div id={`remote-player-${user.uid}`} className="w-full h-full object-cover" />
                                        <div className="absolute top-4 right-4 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg text-sm font-medium border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
                                            User {user.uid}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* --- LOCAL PIP (Me) --- */}
                <AnimatePresence>
                    {(isVideoEnabled || isScreenSharing) && (
                        <MotionDiv 
                            drag
                            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }} 
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            className={`
                                absolute right-4 bottom-24 md:bottom-28 w-32 h-44 md:w-56 md:h-36 bg-gray-800 rounded-2xl 
                                shadow-2xl overflow-hidden border-2 border-white/10 z-30 cursor-grab active:cursor-grabbing
                                ${isScreenSharing ? 'border-brand-500' : ''}
                            `}
                        >
                            {isScreenSharing ? (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900">
                                    <MonitorUp size={24} className="text-brand-500 mb-2"/>
                                    <span className="text-[10px] font-bold text-gray-400 uppercase">Votre écran</span>
                                </div>
                            ) : (
                                <div id="local-player" className="w-full h-full object-cover" />
                            )}
                            
                            {isMuted && (
                                <div className="absolute bottom-2 right-2 bg-red-500/90 p-1.5 rounded-full shadow-sm">
                                    <MicOff size={12} className="text-white" />
                                </div>
                            )}
                        </MotionDiv>
                    )}
                </AnimatePresence>
            </div>

            {/* --- BOTTOM CONTROLS (DOCK STYLE) --- */}
            <div className="flex justify-center pb-8 pt-4 w-full z-40 bg-gradient-to-t from-black/80 to-transparent">
                <div className="flex items-center gap-3 md:gap-4 px-6 py-3 bg-gray-900/80 backdrop-blur-2xl border border-white/10 rounded-full shadow-2xl relative">
                    
                    {/* Mic Toggle */}
                    <MotionButton 
                        onClick={toggleMute}
                        whileHover={{ scale: 1.1, y: -2 }}
                        whileTap={{ scale: 0.95 }}
                        className={`p-3.5 rounded-full transition-all ${isMuted ? 'bg-white text-gray-900' : 'bg-white/10 text-white hover:bg-white/20'}`}
                    >
                        {isMuted ? <MicOff size={22}/> : <Mic size={22}/>}
                    </MotionButton>

                    {/* Video Toggle */}
                    <MotionButton 
                        onClick={toggleVideo}
                        whileHover={{ scale: 1.1, y: -2 }}
                        whileTap={{ scale: 0.95 }}
                        className={`p-3.5 rounded-full transition-all ${!isVideoEnabled ? 'bg-white text-gray-900' : 'bg-white/10 text-white hover:bg-white/20'}`}
                    >
                        {isVideoEnabled ? <Video size={22}/> : <VideoOff size={22}/>}
                    </MotionButton>

                    {/* Screen Share (With Menu) */}
                    <div className="relative">
                        <MotionButton 
                            onClick={() => {
                                if (isScreenSharing) stopScreenShare();
                                else setShowQualityMenu(!showQualityMenu);
                            }}
                            whileHover={{ scale: 1.1, y: -2 }}
                            whileTap={{ scale: 0.95 }}
                            className={`p-3.5 rounded-full transition-all ${isScreenSharing ? 'bg-green-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                        >
                            {isScreenSharing ? <X size={22}/> : <MonitorUp size={22}/>}
                        </MotionButton>

                        <AnimatePresence>
                            {showQualityMenu && !isScreenSharing && (
                                <MotionDiv
                                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                                    animate={{ opacity: 1, y: -15, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.9 }}
                                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-800 border border-white/10 p-2 rounded-xl shadow-xl min-w-[140px] flex flex-col gap-1 overflow-hidden"
                                >
                                    <div className="text-[10px] font-bold text-gray-500 uppercase px-2 mb-1">Qualité 60 FPS</div>
                                    {Object.keys(SCREEN_SHARE_PROFILES).map((q) => (
                                        <button 
                                            key={q}
                                            onClick={() => startScreenShare(q as ScreenQuality)}
                                            className="px-3 py-2 text-sm text-left hover:bg-white/10 rounded-lg text-gray-200 transition-colors flex justify-between"
                                        >
                                            <span>{q}</span>
                                            {q.includes('2K') && <span className="text-[10px] bg-brand-500/20 text-brand-400 px-1 rounded">HQ</span>}
                                        </button>
                                    ))}
                                </MotionDiv>
                            )}
                        </AnimatePresence>
                    </div>

                    <div className="w-px h-8 bg-white/10 mx-1"></div>

                    {/* Hang Up (REDESIGNED BUTTON) */}
                    <MotionButton 
                        onClick={endCall}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="px-8 py-3.5 bg-red-600 hover:bg-red-500 text-white rounded-2xl shadow-xl shadow-red-600/30 border border-red-500/20 transition-all flex items-center justify-center"
                    >
                        <PhoneOff size={28} fill="currentColor" />
                    </MotionButton>
                </div>
            </div>
        </MotionDiv>
    );
};