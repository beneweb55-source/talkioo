import { createClient } from '@supabase/supabase-js';

// Configuration avec les identifiants fournis
const supabaseUrl = 'https://siamsskwsvhgodvgyrwq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpYW1zc2t3c3ZoZ29kdmd5cndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NjkzNTAsImV4cCI6MjA3OTI0NTM1MH0.tWLmqTJYq8stGncuKFzMkk6pR9cFUEW28aK52EWkFOM';

export const supabase = createClient(supabaseUrl, supabaseKey);
