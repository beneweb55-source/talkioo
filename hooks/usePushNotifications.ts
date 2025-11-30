import { useState, useCallback } from 'react';

export const usePushNotifications = (userId: string | undefined) => {
    // Push notifications are currently disabled in the application.
    const [permission] = useState<NotificationPermission>('default');
    const [isSubscribed] = useState(false);
    const [isLoading] = useState(false);
    const [isSupported] = useState(false);

    const requestPermission = useCallback(async () => {
        console.log("Push notifications are disabled.");
    }, []);

    const togglePush = useCallback(async () => {
        console.log("Push notifications are disabled.");
    }, []);

    return { permission, requestPermission, isSubscribed, togglePush, isLoading, isSupported };
};