import React, { useEffect, useRef } from "react";
import { Download, FileArchive, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AndroidDownload() {
  const linkRef = useRef(null);

  useEffect(() => {
    // Auto-trigger download after a short delay
    const timer = setTimeout(() => {
      if (linkRef.current) linkRef.current.click();
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const fileUrl = `${import.meta.env.BASE_URL}USSGuard-Android-Final.zip`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <Card className="max-w-md w-full bg-slate-900 border-slate-700 p-8 text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-sky-400 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-sky-500/30">
          <FileArchive className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Android Project Download</h1>
        <p className="text-slate-400 text-sm mb-6">
          USSGuard native Android wrapper with OneSignal v5 SDK integration.
        </p>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-6">
          <p className="text-amber-400 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Add your <code className="text-amber-300">google-services.json</code> to <code className="text-amber-300">android/app/</code> before building.</span>
          </p>
        </div>

        <a ref={linkRef} href={fileUrl} download="USSGuard-Android-Final.zip" className="hidden" />

        <Button
          onClick={() => window.open(fileUrl, "_blank")}
          className="w-full bg-sky-500 hover:bg-sky-600 h-12 text-base shadow-lg shadow-sky-500/30"
        >
          <Download className="w-5 h-5 mr-2" />
          Download Android Project
        </Button>

        <p className="text-slate-500 text-xs mt-4">
          If the download doesn't start automatically, click the button above.
        </p>
      </Card>
    </div>
  );
}