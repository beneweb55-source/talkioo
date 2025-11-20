import { createClient } from '@supabase/supabase-js';

// Configuration directe avec les identifiants fournis
const supabaseUrl = 'https://siamsskwsvhgodvgyrwq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpYW1zc2t3c3ZoZ29kdmd5cndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NjkzNTAsImV4cCI6MjA3OTI0NTM1MH0.tWLmqTJYq8stGncuKFzMkk6pR9cFUEW28aK52EWkFOM';

// Export simple du client
export const supabase = createClient(supabaseUrl, supabaseKey);

// Fonctions utilitaires conservées pour compatibilité, mais elles renvoient toujours true ou ne font rien
export const isConfigured = () => true;

export const saveConfig = (url: string, key: string) => {
    console.log("Configuration sauvegardée en dur dans le code.");
};