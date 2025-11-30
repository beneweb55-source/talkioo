import { useState, useEffect, useCallback } from 'react';
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
    const [permission, setPermission] = useState<NotificationPermission>('default');

    useEffect(() => {
        if ('Notification' in window) {
            setPermission(Notification.permission);
        }
    }, []);

    const subscribeToPush = useCallback(async () => {
        if (!userId) return;
        
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
    }, [userId]);

    // If permission is already granted (returning user), ensure subscription is fresh
    useEffect(() => {
        if (userId && permission === 'granted') {
            subscribeToPush();
        }
    }, [userId, permission, subscribeToPush]);

    const requestPermission = async () => {
        if (!('Notification' in window)) return;
        
        try {
            const result = await Notification.requestPermission();
            setPermission(result);
            if (result === 'granted') {
                await subscribeToPush();
            }
        } catch (error) {
            console.error("Error requesting permission:", error);
        }
    };

    return { permission, requestPermission };
};