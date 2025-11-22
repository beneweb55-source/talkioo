import { useEffect } from 'react';
import { getVapidPublicKeyAPI, subscribeToPushAPI } from '../services/api';

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export const usePushNotifications = (userId: string | undefined) => {
    useEffect(() => {
        if (!userId) return;

        let isMounted = true;

        const subscribeToPush = async () => {
            if (!isMounted) return;
            
            // Basic support check
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                return;
            }

            // Secure Context check (Service Workers require HTTPS or localhost)
            if (!window.isSecureContext) {
                // Silently return in insecure contexts
                return;
            }

            try {
                // Use a simple relative path string.
                // The browser resolves this relative to the document's location.
                const scriptUrl = './serviceWorker.js';
                
                // We use 'scope: ./' to ensure it controls the current path downwards.
                const registration = await navigator.serviceWorker.register(scriptUrl, { scope: './' });
                
                // Wait for it to be ready
                await navigator.serviceWorker.ready;

                if (!isMounted) return;

                // Request Permission
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    // Silently return if permission denied
                    return;
                }

                // Get VAPID Key
                const { publicKey } = await getVapidPublicKeyAPI();
                const convertedVapidKey = urlBase64ToUint8Array(publicKey);

                // Subscribe
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: convertedVapidKey
                });

                // Send to Backend
                await subscribeToPushAPI(subscription);
                console.log("Push notifications subscribed successfully.");

            } catch (error: any) {
                // Silently ignore known environment restrictions to prevent console noise
                if (error.name === 'SecurityError' || error.name === 'InvalidStateError') {
                    return;
                } 
                if (error.message && error.message.includes('Invalid URL')) {
                     return;
                }

                // Only log real unexpected errors
                console.error("Failed to subscribe to push notifications:", error);
            }
        };

        // Delay execution slightly to ensure document is fully active and resources loaded
        const init = () => {
            setTimeout(subscribeToPush, 1000);
        };

        if (document.readyState === 'complete') {
            init();
        } else {
            window.addEventListener('load', init);
        }

        return () => {
            isMounted = false;
            window.removeEventListener('load', init);
        };

    }, [userId]);
};