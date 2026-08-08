import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, MessageCircle, Download } from "lucide-react";
import { visitorQrImageUrl, visitorPassMessage, buildWhatsAppLink } from "@/lib/whatsapp";

export default function VisitorQrShareModal({ visitor, hostName, onClose }) {
  if (!visitor) return null;

  const qrUrl = visitorQrImageUrl(visitor.qr_code);
  const msg = visitorPassMessage({
    visitorName: visitor.visitor_name,
    hostName,
    unitNumber: visitor.unit_number,
    validFrom: visitor.valid_from,
    validUntil: visitor.valid_until,
    otp: visitor.otp_code,
    qrImageUrl: qrUrl,
    qrCode: visitor.qr_code,
  });
  const waLink = visitor.visitor_phone ? buildWhatsAppLink(visitor.visitor_phone, msg) : null;

  const download = () => {
    const a = document.createElement("a");
    a.href = qrUrl;
    a.download = `Visitor_QR_${visitor.qr_code || "code"}.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[80] p-4">
      <Card className="w-full max-w-sm bg-slate-800 border-slate-700">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-base">Visitor QR Pass</CardTitle>
            <button onClick={onClose} className="text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-center">
            <img src={qrUrl} alt="Visitor QR Code" className="w-48 h-48 bg-white p-2 rounded-lg" />
          </div>
          <div className="text-center space-y-0.5">
            <p className="text-white font-semibold">{visitor.visitor_name}</p>
            {visitor.visitor_phone && <p className="text-slate-400 text-xs">{visitor.visitor_phone}</p>}
            {visitor.vehicle_registration && <p className="text-slate-400 text-xs">Vehicle: {visitor.vehicle_registration}</p>}
            <p className="text-sky-400 font-mono text-sm tracking-widest mt-1">{visitor.otp_code}</p>
          </div>
          {waLink ? (
            <Button onClick={() => window.open(waLink, "_blank")} className="w-full bg-emerald-600 hover:bg-emerald-700 h-12">
              <MessageCircle className="w-5 h-5 mr-2" /> Send QR to Visitor
            </Button>
          ) : (
            <p className="text-amber-400 text-xs text-center">Add a visitor phone number to send via WhatsApp</p>
          )}
          <Button onClick={download} variant="outline" className="w-full border-slate-600 text-slate-300">
            <Download className="w-4 h-4 mr-2" /> Download QR
          </Button>
          <Button onClick={onClose} variant="ghost" className="w-full text-slate-300">Done</Button>
        </CardContent>
      </Card>
    </div>
  );
}