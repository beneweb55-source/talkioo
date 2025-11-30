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
                console.log("Push notifications not supported on this browser.");
                return;
            }

            try {
                // Use a simple relative path string.
                const scriptUrl = '/serviceWorker.js';
                
                const registration = await navigator.serviceWorker.register(scriptUrl, { scope: '/' });
                await navigator.serviceWorker.ready;

                if (!isMounted) return;

                // Request Permission (User interaction might be needed in some browsers, but often works if initiated early)
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    console.log("Push notification permission denied.");
                    return;
                }

                // Get VAPID Key from Backend
                const { publicKey } = await getVapidPublicKeyAPI();
                if (!publicKey) throw new Error("No public key returned");
                
                const convertedVapidKey = urlBase64ToUint8Array(publicKey);

                // Subscribe
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: convertedVapidKey
                });

                // Send Subscription to Backend
                await subscribeToPushAPI(subscription);
                console.log("Push notifications subscribed successfully.");

            } catch (error: any) {
                // Silent fail for common permission/security issues to avoid console spam
                if (error.name === 'SecurityError' || error.name === 'InvalidStateError' || error.name === 'NotAllowedError') {
                    return;
                } 
                console.error("Failed to subscribe to push notifications:", error);
            }
        };

        const init = () => {
            setTimeout(subscribeToPush, 2000); // Wait a bit for app to settle
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