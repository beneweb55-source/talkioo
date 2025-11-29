import React, { useState, useEffect } from 'react';
import { getTrendingGifsAPI, searchGifsAPI } from '../../services/api';
import { Search, Loader2 } from 'lucide-react';

interface GifPickerProps {
    onSelect: (url: string) => void;
}

export const GifPicker: React.FC<GifPickerProps> = ({ onSelect }) => {
    const [gifs, setGifs] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [nextPos, setNextPos] = useState<string | undefined>(undefined);
    
    // Throttle search
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            fetchGifs(true);
        }, 500);
        return () => clearTimeout(timeoutId);
    }, [search]);

    const fetchGifs = async (reset = false) => {
        if (!reset && !nextPos) return;
        setLoading(true);
        try {
            const data = search.trim() 
                ? await searchGifsAPI(search, reset ? undefined : nextPos)
                : await getTrendingGifsAPI(reset ? undefined : nextPos);
            
            setGifs(prev => reset ? data.results : [...prev, ...data.results]);
            setNextPos(data.next);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
        if (scrollHeight - scrollTop <= clientHeight + 300 && !loading) {
            fetchGifs();
        }
    };

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-lg overflow-hidden">
            <div className="p-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input 
                        className="w-full pl-9 pr-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-xl text-sm outline-none dark:text-white focus:ring-2 focus:ring-brand-500/20 transition-all"
                        placeholder="Rechercher des GIFs..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        autoFocus
                    />
                </div>
            </div>
            
            <div 
                className="flex-1 overflow-y-auto p-2"
                onScroll={handleScroll}
            >
                <div className="columns-2 md:columns-3 gap-2 space-y-2">
                    {gifs.map((gif) => (
                        <div 
                            key={gif.id} 
                            className="break-inside-avoid relative rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity bg-gray-100 dark:bg-gray-800 mb-2"
                            onClick={() => onSelect(gif.media_formats.tinygif.url)}
                        >
                            <img 
                                src={gif.media_formats.tinygif.url} 
                                alt={gif.content_description} 
                                className="w-full h-auto block"
                                loading="lazy"
                                style={{ minHeight: '50px' }}
                            />
                        </div>
                    ))}
                </div>

                {loading && (
                    <div className="flex justify-center py-4 w-full">
                        <Loader2 className="animate-spin text-brand-500" />
                    </div>
                )}
                {!loading && gifs.length === 0 && (
                    <div className="text-center text-gray-400 py-10 text-sm w-full">
                        Aucun GIF trouvé
                    </div>
                )}
            </div>
            <div className="p-1 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 flex justify-end flex-shrink-0">
                <img src="https://attribution.tenor.com/img/powered_by_tenor_white.svg" alt="Powered by Tenor" className="h-4 opacity-50 dark:invert" />
            </div>
        </div>
    );
};