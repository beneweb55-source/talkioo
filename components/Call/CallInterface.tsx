import React, { useEffect, useRef, useState } from 'react';
import AgoraRTC, { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, ILocalVideoTrack, ILocalAudioTrack } from 'agora-rtc-sdk-ng';
import { User } from '../../types';
import { getAgoraTokenAPI, sendCallSignal } from '../../services/api';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Maximize2, Minimize2, Monitor, Settings, X, Signal, LayoutGrid, MonitorUp } from 'lucide-react';
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

// Profils de qualité pour le partage d'écran
const SCREEN_SHARE_PROFILES = {
    HD: { width: 1280, height: 720, frameRate: 30, bitrate: 1130 },    // 720p
    FHD: { width: 1920, height: 1080, frameRate: 30, bitrate: 2000 },   // 1080p
    '2K': { width: 2560, height: 1440, frameRate: 30, bitrate: 3000 },  // 1440p
    '2K+': { width: 3840, height: 2160, frameRate: 30, bitrate: 4000 }  // 4K
};

type ScreenQuality = keyof typeof SCREEN_SHARE_PROFILES;

export const CallInterface: React.FC<CallInterfaceProps> = ({ conversationId, currentUser, targetUser, isCaller, callType, onClose }) => {
    // --- STATE ---
    const [joined, setJoined] = useState(false);
    const [remoteUsers, setRemoteUsers] = useState<any[]>([]);
    
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

    const [callStatus, setCallStatus] = useState(isCaller ? 'Appel en cours...' : 'Connexion...');
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
                client.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

                // Event Listeners
                client.current.on('user-published', async (user, mediaType) => {
                    await client.current?.subscribe(user, mediaType);
                    if (mediaType === 'video') {
                        setRemoteUsers(prev => {
                            const exists = prev.find(u => u.uid === user.uid);
                            return exists ? prev : [...prev, user];
                        });
                    }
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
                    setCallStatus('Connecté');
                    // Stop ringback when user joins
                    if (ringbackRef.current) {
                        ringbackRef.current.pause();
                        ringbackRef.current = null;
                    }
                });

                client.current.on('user-left', () => {
                    setRemoteUsers(prev => prev.filter(u => true)); 
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
                localAudioTrack.current = await AgoraRTC.createMicrophoneAudioTrack();
                await client.current.publish(localAudioTrack.current);

                if (callType === 'video') {
                    localVideoTrack.current = await AgoraRTC.createCameraVideoTrack();
                    await client.current.publish(localVideoTrack.current);
                    localVideoTrack.current.play('local-player');
                    setIsVideoEnabled(true);
                }

                setJoined(true);

            } catch (error) {
                console.error("Call init failed:", error);
                setCallStatus("Échec connexion");
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
            // Si on partage l'écran, on ne peut pas activer la caméra en même temps (dans cette implémentation simple)
            alert("Arrêtez le partage d'écran pour réactiver la caméra.");
            return;
        }

        if (localVideoTrack.current) {
            // Si la track existe déjà, on toggle juste l'état
            await localVideoTrack.current.setEnabled(!isVideoEnabled);
            setIsVideoEnabled(!isVideoEnabled);
        } else {
            // Création de la track si elle n'existe pas (cas départ audio)
            try {
                localVideoTrack.current = await AgoraRTC.createCameraVideoTrack();
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
            // 1. Configurer l'encodeur selon la qualité
            const config = SCREEN_SHARE_PROFILES[quality];
            
            // 2. Créer la track d'écran
            // Note: createScreenVideoTrack retourne un tableau ou une track simple selon version, ici on assume track simple ou on gère
            const screenTrack = await AgoraRTC.createScreenVideoTrack({
                encoderConfig: {
                    ...config,
                    bitrateMax: config.bitrate
                },
                optimizationMode: "detail" // Privilégier la netteté pour le texte
            });

            // Gérer le cas où createScreenVideoTrack retourne un tableau [video, audio]
            const actualVideoTrack = Array.isArray(screenTrack) ? screenTrack[0] : screenTrack;

            // 3. Arrêter la caméra si elle tourne
            if (localVideoTrack.current) {
                await client.current?.unpublish(localVideoTrack.current);
                localVideoTrack.current.setEnabled(false);
                setIsVideoEnabled(false); 
            }

            // 4. Publier l'écran
            await client.current?.publish(actualVideoTrack);
            localScreenTrack.current = actualVideoTrack;
            
            // Afficher preview local (optionnel, souvent on ne veut pas voir son propre écran en miroir infini)
            // actualVideoTrack.play('local-player'); 
            
            setIsScreenSharing(true);

            // 5. Gestion de l'arrêt natif (bouton "Arrêter le partage" du navigateur)
            actualVideoTrack.on("track-ended", stopScreenShare);

        } catch (e) {
            console.error("Screen share failed", e);
            alert("Impossible de partager l'écran.");
        }
    };

    const stopScreenShare = async () => {
        if (localScreenTrack.current) {
            await client.current?.unpublish(localScreenTrack.current);
            localScreenTrack.current.close();
            localScreenTrack.current = null;
            setIsScreenSharing(false);

            // Relancer la caméra automatiquement pour fluidité
            if (!localVideoTrack.current) {
                 localVideoTrack.current = await AgoraRTC.createCameraVideoTrack();
            }
            await client.current?.publish(localVideoTrack.current);
            localVideoTrack.current.setEnabled(true);
            localVideoTrack.current.play('local-player');
            setIsVideoEnabled(true);
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
                className="fixed bottom-24 right-4 z-[100] w-28 h-40 bg-gray-900 rounded-2xl shadow-2xl border-2 border-brand-500 overflow-hidden cursor-pointer"
                onClick={() => setIsMinimized(false)}
            >
                <div className="w-full h-full relative">
                    {remoteUsers.length > 0 ? (
                        <div id={`remote-player-mini-${remoteUsers[0].uid}`} className="w-full h-full bg-black" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gray-800 text-white"><Phone size={24} className="animate-pulse" /></div>
                    )}
                    {/* Hack to replay video in mini view if needed, or simple placeholder */}
                </div>
            </MotionDiv>
        );
    }

    // --- FULL VIEW (RESPONSIVE) ---
    return (
        <MotionDiv 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#111] text-white overflow-hidden flex flex-col md:flex-row"
        >
            {/* --- HEADER (MOBILE ONLY) --- */}
            <div className="md:hidden absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent">
                <div className="flex items-center gap-3">
                    <button onClick={() => setIsMinimized(true)} className="p-2 bg-white/10 backdrop-blur-md rounded-full"><Minimize2 size={20}/></button>
                    <div>
                        <h2 className="font-bold text-lg leading-none">{targetUser?.username || 'Groupe'}</h2>
                        <span className="text-xs opacity-70 flex items-center gap-1">{getNetworkIcon()} {callStatus}</span>
                    </div>
                </div>
            </div>

            {/* --- MAIN STAGE (VIDEO GRID) --- */}
            <div className="flex-1 relative flex items-center justify-center p-0 md:p-4 bg-black/50">
                {remoteUsers.length === 0 ? (
                    // WAITING STATE
                    <div className="flex flex-col items-center justify-center animate-pulse">
                        <div className="h-32 w-32 md:h-48 md:w-48 rounded-full bg-gray-800 border-4 border-gray-700 flex items-center justify-center mb-6 overflow-hidden shadow-2xl relative">
                            {targetUser?.avatar_url ? (
                                <img src={targetUser.avatar_url} className="w-full h-full object-cover opacity-60" />
                            ) : (
                                <span className="text-6xl font-bold text-gray-500">{targetUser?.username?.[0]}</span>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-tr from-brand-500/20 to-purple-500/20"></div>
                        </div>
                        <h3 className="text-2xl md:text-3xl font-bold mb-2">{targetUser ? targetUser.username : 'En attente...'}</h3>
                        <p className="text-gray-400">Sonnerie en cours...</p>
                    </div>
                ) : (
                    // GRID LAYOUT
                    <div className={`
                        w-full h-full grid gap-2 md:gap-4 transition-all duration-500
                        ${remoteUsers.length === 1 ? 'grid-cols-1' : ''}
                        ${remoteUsers.length === 2 ? 'grid-cols-1 md:grid-cols-2' : ''}
                        ${remoteUsers.length >= 3 ? 'grid-cols-2' : ''}
                    `}>
                        {remoteUsers.map(user => (
                            <div key={user.uid} className="relative w-full h-full bg-gray-900 rounded-none md:rounded-3xl overflow-hidden shadow-2xl group">
                                <div id={`remote-player-${user.uid}`} className="w-full h-full object-cover transform scale-100 md:group-hover:scale-105 transition-transform duration-700" />
                                <div className="absolute bottom-4 left-4 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full text-sm font-medium border border-white/10">
                                    Utilisateur {user.uid}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* --- LOCAL PIP (Picture in Picture) --- */}
                {/* Mobile: Top Right floating. PC: Bottom Right fixed inside stage or separate */}
                {(isVideoEnabled || isScreenSharing) && (
                    <MotionDiv 
                        drag
                        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }} // Libre mais limité
                        className={`
                            absolute z-30 overflow-hidden shadow-2xl border border-white/20 bg-gray-800
                            ${isScreenSharing ? 'border-brand-500 border-2' : ''}
                            w-28 h-40 rounded-xl right-4 top-20 md:top-auto md:bottom-24 md:w-48 md:h-32 md:rounded-2xl
                            md:right-8
                        `}
                    >
                        {isScreenSharing ? (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 text-white">
                                <MonitorUp size={32} className="text-brand-500 mb-2" />
                                <span className="text-[10px] uppercase font-bold text-brand-500">Partage actif</span>
                            </div>
                        ) : (
                            <div id="local-player" className="w-full h-full object-cover" />
                        )}
                        <div className="absolute bottom-1 right-1">
                            {isMuted && <div className="bg-red-500 p-1 rounded-full"><MicOff size={10} /></div>}
                        </div>
                    </MotionDiv>
                )}
            </div>

            {/* --- CONTROLS BAR (PC & MOBILE ADAPTIVE) --- */}
            <div className={`
                bg-gray-900/80 backdrop-blur-xl border-t md:border-t-0 md:border-l border-white/5 
                flex md:flex-col items-center justify-around md:justify-center gap-4 md:gap-8 
                p-4 md:px-6 md:py-0 w-full md:w-28 z-40
                pb-safe md:pb-0
            `}>
                
                {/* PC Header in Sidebar */}
                <div className="hidden md:flex flex-col items-center gap-2 mb-auto mt-6">
                    <div className="h-12 w-12 rounded-full bg-gray-800 flex items-center justify-center text-xl font-bold">
                        {targetUser?.username?.[0]}
                    </div>
                    <span className="text-xs font-mono opacity-50">{callStatus}</span>
                </div>

                {/* --- MAIN CONTROLS --- */}

                {/* Mute */}
                <MotionButton whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={toggleMute} className={`p-3 md:p-4 rounded-2xl transition-all ${isMuted ? 'bg-white text-gray-900' : 'bg-gray-800/80 text-white hover:bg-gray-700'}`}>
                    {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                </MotionButton>

                {/* Video */}
                <MotionButton whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={toggleVideo} className={`p-3 md:p-4 rounded-2xl transition-all ${!isVideoEnabled ? 'bg-white text-gray-900' : 'bg-gray-800/80 text-white hover:bg-gray-700'}`}>
                    {isVideoEnabled ? <Video size={24} /> : <VideoOff size={24} />}
                </MotionButton>

                {/* Screen Share (With Quality Menu) */}
                <div className="relative">
                    <MotionButton 
                        whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} 
                        onClick={() => {
                            if (isScreenSharing) stopScreenShare();
                            else setShowQualityMenu(!showQualityMenu);
                        }}
                        className={`p-3 md:p-4 rounded-2xl transition-all ${isScreenSharing ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/40' : 'bg-gray-800/80 text-white hover:bg-gray-700'}`}
                    >
                        {isScreenSharing ? <X size={24} /> : <MonitorUp size={24} />}
                    </MotionButton>

                    {/* QUALITY MENU POPUP */}
                    <AnimatePresence>
                        {showQualityMenu && !isScreenSharing && (
                            <MotionDiv 
                                initial={{ opacity: 0, scale: 0.8, y: 20 }}
                                animate={{ opacity: 1, scale: 1, y: -10 }}
                                exit={{ opacity: 0, scale: 0.8, y: 20 }}
                                className="absolute bottom-full md:bottom-auto md:left-full md:top-1/2 md:-translate-y-1/2 mb-4 md:mb-0 md:ml-4 bg-gray-800/90 backdrop-blur-xl border border-white/10 p-3 rounded-2xl shadow-2xl min-w-[180px] z-50 flex flex-col gap-1"
                            >
                                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider px-2 py-1 mb-1">Qualité Partage</div>
                                {Object.keys(SCREEN_SHARE_PROFILES).map((q) => (
                                    <button
                                        key={q}
                                        onClick={() => startScreenShare(q as ScreenQuality)}
                                        className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium hover:bg-white/10 rounded-lg transition-colors text-left"
                                    >
                                        <span className={q.includes('2K') ? 'text-brand-400' : 'text-white'}>{q}</span>
                                        <span className="text-[10px] opacity-50 bg-black/20 px-1.5 rounded">
                                            {q === 'HD' && '720p'}
                                            {q === 'FHD' && '1080p'}
                                            {q === '2K' && '1440p'}
                                            {q === '2K+' && '4K'}
                                        </span>
                                    </button>
                                ))}
                            </MotionDiv>
                        )}
                    </AnimatePresence>
                </div>

                {/* Hang Up */}
                <MotionButton whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={endCall} className="p-4 md:p-5 rounded-full bg-red-500 text-white shadow-xl shadow-red-500/30 hover:bg-red-600 mt-auto md:mb-6">
                    <PhoneOff size={28} />
                </MotionButton>

                 {/* PC Minify Button (Bottom of Sidebar) */}
                 <button onClick={() => setIsMinimized(true)} className="hidden md:block mt-2 p-2 text-gray-500 hover:text-white transition-colors">
                    <Minimize2 size={20} />
                </button>
            </div>
        </MotionDiv>
    );
};