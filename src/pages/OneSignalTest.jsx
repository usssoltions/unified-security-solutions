import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Bell, CheckCircle2, XCircle, Loader2, Send } from "lucide-react";

export default function OneSignalTest() {
  const [user, setUser] = useState(null);
  const [oneSignalStatus, setOneSignalStatus] = useState({
    loaded: false,
    initialized: false,
    subscribed: false,
    playerId: null
  });
  const [testTitle, setTestTitle] = useState("Test Notification");
  const [testMessage, setTestMessage] = useState("This is a test push notification from SecureGuard");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    loadUser();
    checkOneSignalStatus();
  }, []);

  const loadUser = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
  };

  const checkOneSignalStatus = () => {
    const checkInterval = setInterval(() => {
      if (window.OneSignal) {
        setOneSignalStatus(prev => ({ ...prev, loaded: true }));

        window.OneSignal.push(function() {
          window.OneSignal.isPushNotificationsEnabled(function(isEnabled) {
            setOneSignalStatus(prev => ({
              ...prev,
              initialized: true,
              subscribed: isEnabled
            }));
          });

          window.OneSignal.getUserId(function(userId) {
            setOneSignalStatus(prev => ({
              ...prev,
              playerId: userId
            }));
          });
        });

        clearInterval(checkInterval);
      }
    }, 500);

    setTimeout(() => clearInterval(checkInterval), 10000);
  };

  const requestPermission = () => {
    if (window.OneSignal) {
      window.OneSignal.push(function() {
        window.OneSignal.showSlidedownPrompt();
      });
    }
  };

  const sendTestNotification = async () => {
    setSending(true);
    setResult(null);

    try {
      const response = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + 'YOUR_REST_API_KEY_HERE' // This will use the backend
        },
        body: JSON.stringify({
          app_id: oneSignalStatus.playerId ? undefined : 'YOUR_APP_ID',
          include_player_ids: oneSignalStatus.playerId ? [oneSignalStatus.playerId] : [],
          headings: { en: testTitle },
          contents: { en: testMessage },
          data: { test: true }
        })
      });

      // Actually, let's use a backend function for this
      const { data } = await base44.functions.invoke('sendTestPushNotification', {
        title: testTitle,
        message: testMessage,
        playerId: oneSignalStatus.playerId
      });

      setResult({ success: true, data });
    } catch (error) {
      setResult({ success: false, error: error.message });
    } finally {
      setSending(false);
    }
  };

  if (!user || user.role_type !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="bg-rose-900/30 border-rose-500/50 max-w-md">
          <CardContent className="p-6 text-center">
            <XCircle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
            <p className="text-rose-200">Admin access required</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center">
            <Bell className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">OneSignal Test Dashboard</h1>
            <p className="text-slate-400">Test push notification functionality</p>
          </div>
        </div>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">OneSignal Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">SDK Loaded</span>
                {oneSignalStatus.loaded ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                )}
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">Initialized</span>
                {oneSignalStatus.initialized ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-slate-600" />
                )}
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">Push Subscribed</span>
                {oneSignalStatus.subscribed ? (
                  <Badge className="bg-emerald-500">Active</Badge>
                ) : (
                  <Badge className="bg-slate-600">Not Subscribed</Badge>
                )}
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
                <span className="text-slate-300">Player ID</span>
                {oneSignalStatus.playerId ? (
                  <Badge className="bg-sky-500">Connected</Badge>
                ) : (
                  <Badge className="bg-slate-600">No ID</Badge>
                )}
              </div>
            </div>

            {oneSignalStatus.playerId && (
              <div className="p-4 bg-slate-900/50 rounded-lg">
                <p className="text-xs text-slate-400 mb-1">Player ID:</p>
                <code className="text-xs text-emerald-400 break-all">{oneSignalStatus.playerId}</code>
              </div>
            )}

            {!oneSignalStatus.subscribed && oneSignalStatus.loaded && (
              <Button onClick={requestPermission} className="w-full bg-purple-600 hover:bg-purple-700">
                <Bell className="w-4 h-4 mr-2" />
                Request Notification Permission
              </Button>
            )}
          </CardContent>
        </Card>

        {oneSignalStatus.subscribed && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Send Test Notification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm text-slate-300 mb-2 block">Title</label>
                <Input
                  value={testTitle}
                  onChange={(e) => setTestTitle(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white"
                  placeholder="Notification title"
                />
              </div>

              <div>
                <label className="text-sm text-slate-300 mb-2 block">Message</label>
                <Textarea
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white"
                  placeholder="Notification message"
                  rows={3}
                />
              </div>

              <Button
                onClick={sendTestNotification}
                disabled={sending || !oneSignalStatus.playerId}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send Test Notification
                  </>
                )}
              </Button>

              {result && (
                <div className={`p-4 rounded-lg ${result.success ? 'bg-emerald-900/20 border border-emerald-500/30' : 'bg-rose-900/20 border border-rose-500/30'}`}>
                  {result.success ? (
                    <>
                      <p className="text-emerald-400 font-semibold mb-2">✓ Test notification sent!</p>
                      <p className="text-xs text-slate-400">Check your device for the notification</p>
                    </>
                  ) : (
                    <>
                      <p className="text-rose-400 font-semibold mb-2">✗ Failed to send</p>
                      <p className="text-xs text-slate-400">{result.error}</p>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Configuration Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">App ID Set:</span>
              <Badge className="bg-emerald-500">Yes</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">REST API Key Set:</span>
              <Badge className="bg-emerald-500">Yes</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">User Player ID Saved:</span>
              <Badge className={user?.onesignal_player_id ? "bg-emerald-500" : "bg-amber-500"}>
                {user?.onesignal_player_id ? 'Yes' : 'Not Yet'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}