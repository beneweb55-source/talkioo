import React, { useState, useEffect, useRef } from 'react';
import { getStickersAPI, uploadStickerAPI } from '../../services/api';
import { Sticker } from '../../types';
import { Loader2, Plus, UploadCloud } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MotionDiv = motion.div as any;

interface StickerPickerProps {
    onSelect: (url: string) => void;
}

export const StickerPicker: React.FC<StickerPickerProps> = ({ onSelect }) => {
    const [stickers, setStickers] = useState<Sticker[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'all' | 'mine'>('all');
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const fetchStickers = async () => {
            try {
                const data = await getStickersAPI();
                setStickers(data);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchStickers();
    }, []);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setUploading(true);
            try {
                const newSticker = await uploadStickerAPI(e.target.files[0]);
                setStickers(prev => [newSticker, ...prev]);
                // Automatically switch to 'mine' or ensure it's visible
            } catch (err) {
                alert("Erreur upload sticker");
            } finally {
                setUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        }
    };

    const filteredStickers = activeTab === 'mine' 
        ? stickers.filter(s => s.user_id !== null) 
        : stickers;

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-3 border-b border-gray-100 dark:border-gray-800">
                <button 
                    onClick={() => setActiveTab('all')}
                    className={`flex-1 text-sm font-medium py-1.5 rounded-lg transition-colors ${activeTab === 'all' ? 'bg-brand-50 text-brand-600 dark:bg-brand-900/30' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                    Tous
                </button>
                <button 
                    onClick={() => setActiveTab('mine')}
                    className={`flex-1 text-sm font-medium py-1.5 rounded-lg transition-colors ${activeTab === 'mine' ? 'bg-brand-50 text-brand-600 dark:bg-brand-900/30' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                    Mes Stickers
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                {activeTab === 'mine' && (
                    <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="mb-3 p-3 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl flex items-center justify-center gap-2 cursor-pointer hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/10 transition-colors text-gray-400 hover:text-brand-500"
                    >
                        {uploading ? <Loader2 className="animate-spin" size={20}/> : <Plus size={20}/>}
                        <span className="text-sm font-medium">Importer un Sticker</span>
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/png,image/gif,image/webp" onChange={handleUpload} />
                    </div>
                )}

                {loading ? (
                     <div className="flex justify-center py-10"><Loader2 className="animate-spin text-brand-500" /></div>
                ) : (
                    <div className="grid grid-cols-3 gap-3">
                        {filteredStickers.length === 0 && !uploading && (
                            <p className="col-span-3 text-center text-gray-400 text-sm py-4">Aucun sticker disponible</p>
                        )}
                        {filteredStickers.map(sticker => (
                            <MotionDiv 
                                key={sticker.id}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                className="aspect-square flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded-xl p-2 cursor-pointer hover:shadow-sm"
                                onClick={() => onSelect(sticker.url)}
                            >
                                <img src={sticker.url} alt="Sticker" className="w-full h-full object-contain" />
                            </MotionDiv>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};