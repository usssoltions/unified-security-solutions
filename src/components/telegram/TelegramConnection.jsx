import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, CheckCircle2, XCircle, RefreshCw, ExternalLink, MessageCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * TelegramConnection — User-facing Telegram enrollment component.
 *
 * Flow:
 *   Connect Telegram → backend creates one-time token → opens t.me deep link
 *   User taps START in Telegram → webhook captures chat_id → user record updated
 *   Frontend detects connection via realtime subscription + light refetch.
 *
 * Disconnect clears the mapping and revokes pending tokens.
 * Test sends a real notification through the production engine.
 */
export default function TelegramConnection({ user, externalRecipientId }) {
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [deepLink, setDeepLink] = useState(null);
  const [startCommand, setStartCommand] = useState(null);
  const [copied, setCopied] = useState(false);
  const [waitingForConnection, setWaitingForConnection] = useState(false);
  const [checking, setChecking] = useState(false);

  const isExternal = Boolean(externalRecipientId);

  // Authoritative status: refetch the live backend record on every mount so
  // the badge reflects the REAL active mapping, never a stale frontend flag.
  const { data: liveMe } = useQuery({
    queryKey: ["telegramLiveStatus", user?.id],
    queryFn: () => base44.auth.me(),
    enabled: !isExternal && Boolean(user?.id),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const statusUser = (!isExternal && liveMe) ? liveMe : user;
  const isConnected = Boolean(statusUser?.telegram_connected);

  const telegramUsername = statusUser?.telegram_username;

  // Light refetch to detect connection after user opens Telegram
  useEffect(() => {
    if (!waitingForConnection) return;
    let attempts = 0;
    const maxAttempts = 18; // 3 minutes at 10s intervals
    const interval = setInterval(async () => {
      attempts++;
      try {
        const me = await base44.auth.me();
            if (me?.telegram_connected) {
              setWaitingForConnection(false);
              queryClient.invalidateQueries({ queryKey: ["currentUser"] });
              queryClient.invalidateQueries({ queryKey: ["telegramLiveStatus"] });
            }
      } catch (_) {}
      if (attempts >= maxAttempts) {
        setWaitingForConnection(false);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [waitingForConnection, queryClient]);

  // Realtime subscription for connection status
  useEffect(() => {
    if (isExternal || !user?.id) return;
    const unsub = base44.entities.User.subscribe((event) => {
      if (event.data?.id === user.id && event.data?.telegram_connected) {
        setWaitingForConnection(false);
        queryClient.invalidateQueries({ queryKey: ["currentUser"] });
        queryClient.invalidateQueries({ queryKey: ["telegramLiveStatus"] });
      }
    });
    return unsub;
  }, [user?.id, isExternal, queryClient]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setTestResult(null);
    try {
      const res = await base44.functions.invoke("createTelegramEnrollment", {
        externalRecipientId: isExternal ? externalRecipientId : undefined,
      });
      if (res?.deep_link) {
        setDeepLink(res.deep_link);
        setStartCommand(res.start_command || null);
        setCopied(false);
        window.open(res.deep_link, "_blank");
        setWaitingForConnection(true);
      } else {
        // Token generation failed — surface the real safe error, never silence.
        setTestResult({ success: false, message: res?.error || "Unable to create Telegram enrollment. Please try again." });
      }
    } catch (e) {
      setTestResult({ success: false, message: e.message || "Failed to start enrollment" });
    } finally {
      setConnecting(false);
    }
  }, [isExternal, externalRecipientId]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const recipientId = isExternal ? externalRecipientId : user?.id;
      const res = await base44.functions.invoke("sendComprehensiveNotification", {
        recipientIds: isExternal ? [] : [recipientId],
        externalRecipientIds: isExternal ? [recipientId] : [],
        channels: { inApp: false, push: false, email: false, telegram: true },
        type: "system",
        title: "USS Telegram Test Notification",
        message: "This is a test notification from Unified Security Solutions confirming your Telegram connection is working.",
        priority: "medium",
        moduleKey: "security",
        eventKey: `telegram_test_${Date.now()}`,
      });
      const tgResult = res?.results?.find((r) => r.channel === "telegram");
      if (tgResult?.status === "sent") {
        setTestResult({ success: true, message: "Test sent successfully. Check your Telegram." });
      } else if (tgResult?.status === "failed") {
        setTestResult({ success: false, message: tgResult.error || "Telegram delivery failed" });
      } else {
        setTestResult({ success: false, message: "Telegram not connected or delivery skipped" });
      }
    } catch (e) {
      setTestResult({ success: false, message: e.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  }, [isExternal, externalRecipientId, user?.id]);

  // Manual authoritative check — refetches the live backend record. Never
  // trusts cached local state.
  const handleCheckConnection = useCallback(async () => {
    setChecking(true);
    try {
      const me = await base44.auth.me();
      queryClient.invalidateQueries({ queryKey: ["telegramLiveStatus"] });
      if (me?.telegram_connected) {
        setWaitingForConnection(false);
        setTestResult({ success: true, message: "Telegram connected successfully." });
        queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      } else {
        setTestResult({
          success: false,
          message: "Not connected yet. Make sure you sent the Step 2 command in the bot chat, then check again.",
        });
      }
    } catch (e) {
      setTestResult({ success: false, message: e.message || "Could not check connection status." });
    } finally {
      setChecking(false);
    }
  }, [queryClient]);

  const copyStartCommand = useCallback(async () => {
    if (!startCommand) return;
    try {
      await navigator.clipboard.writeText(startCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {
      setCopied(false);
    }
  }, [startCommand]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await base44.functions.invoke("disconnectTelegram", {
        externalRecipientId: isExternal ? externalRecipientId : undefined,
      });
      setShowDisconnectDialog(false);
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      setTestResult(null);
    } catch (e) {
      setTestResult({ success: false, message: e.message || "Disconnect failed" });
    } finally {
      setDisconnecting(false);
    }
  }, [isExternal, externalRecipientId, queryClient]);

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-sky-400" />
          Telegram Notifications
        </CardTitle>
        <CardDescription className="text-slate-400">
          Connect Telegram once to receive automatic USS notifications
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">Status:</span>
            {isConnected ? (
              <Badge className="bg-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="border-slate-600 text-slate-400">
                Not Connected
              </Badge>
            )}
          </div>
          {telegramUsername && (
            <span className="text-slate-400 text-sm">@{telegramUsername}</span>
          )}
        </div>

        {/* Waiting indicator */}
        {waitingForConnection && !isConnected && (
          <div className="flex items-center gap-2 p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg">
            <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
            <span className="text-sky-300 text-sm">
              Waiting for Telegram connection... Open the link and tap START in Telegram. If the chat is already open, send the command below instead.
            </span>
          </div>
        )}

        {/* Manual /start command — Telegram only auto-sends the deep-link
            start parameter the FIRST time a bot chat is opened. For an
            existing chat (reconnect, or a second user of the same Telegram
            account) the user must send /start <token> themselves. */}
        {startCommand && !isConnected && (
          <div className="p-3 bg-slate-900/60 border border-slate-700 rounded-lg space-y-2">
            <p className="text-slate-400 text-xs">
              No START button in the bot chat? Copy this and send it as a message to the bot:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 text-[11px] leading-snug text-sky-300 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 break-all">
                {startCommand}
              </code>
              <Button
                type="button"
                variant="outline"
                className="border-slate-600 text-slate-200 hover:bg-slate-700 active:scale-95 shrink-0"
                onClick={copyStartCommand}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div
            className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
              testResult.success
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                : "bg-rose-500/10 border border-rose-500/20 text-rose-300"
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {!isConnected ? (
            <Button
              onClick={handleConnect}
              disabled={connecting || waitingForConnection}
              className="bg-sky-600 hover:bg-sky-700 active:scale-95"
            >
              {connecting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4 mr-2" />
              )}
              Connect Telegram
            </Button>
          ) : (
            <>
              <Button
                onClick={handleTest}
                disabled={testing}
                variant="outline"
                className="border-slate-600 text-slate-200 hover:bg-slate-700 active:scale-95"
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Send Test Notification
              </Button>
              <Button
                onClick={() => setShowDisconnectDialog(true)}
                disabled={disconnecting}
                variant="outline"
                className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 active:scale-95"
              >
                Disconnect Telegram
              </Button>
            </>
          )}
        </div>

        {deepLink && !isConnected && (
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 text-xs underline flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" /> Reopen Telegram link
          </a>
        )}
      </CardContent>

      {/* Disconnect Confirmation */}
      <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <AlertDialogContent className="bg-slate-800 border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Disconnect Telegram?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              You will stop receiving Telegram notifications. You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-700 text-white hover:bg-slate-600">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}