import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QrCode, Printer, Mail, MessageSquare, Download } from "lucide-react";
import QRCode from "qrcode";
import { base44 } from "@/api/base44Client";

export default function CheckpointQRGenerator({ checkpoint, siteName }) {
  const canvasRef = useRef(null);
  const [qrGenerated, setQrGenerated] = React.useState(false);

  React.useEffect(() => {
    if (checkpoint.qr_code && canvasRef.current) {
      generateQR();
    }
  }, [checkpoint.qr_code]);

  const generateQR = async () => {
    try {
      const qrData = JSON.stringify({
        checkpoint_id: checkpoint.id,
        qr_code: checkpoint.qr_code,
        site_name: siteName,
        checkpoint_name: checkpoint.name,
        location: checkpoint.location,
        generated_at: new Date().toISOString()
      });

      await QRCode.toCanvas(canvasRef.current, qrData, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      setQrGenerated(true);
    } catch (error) {
      console.error('Error generating QR code:', error);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL();

    printWindow.document.write(`
      <html>
        <head>
          <title>Checkpoint QR Code - ${checkpoint.name}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 40px;
            }
            .qr-container {
              border: 3px solid #000;
              padding: 20px;
              display: inline-block;
              margin: 20px auto;
            }
            h1 { font-size: 28px; margin-bottom: 10px; }
            .code { font-size: 24px; font-weight: bold; margin: 15px 0; }
            .details { font-size: 14px; color: #666; }
            img { margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="qr-container">
            <h1>${siteName}</h1>
            <h2>${checkpoint.name}</h2>
            <img src="${dataUrl}" alt="QR Code" />
            <div class="code">${checkpoint.qr_code}</div>
            <div class="details">
              <p>Scan this QR code to log checkpoint visit</p>
              <p>Location: ${checkpoint.location.lat.toFixed(6)}, ${checkpoint.location.lng.toFixed(6)}</p>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    const link = document.createElement('a');
    link.download = `QR_${checkpoint.qr_code}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  const handleEmail = async () => {
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL();
    const email = prompt('Enter email address:');
    
    if (!email) return;

    try {
      await base44.integrations.Core.SendEmail({
        to: email,
        subject: `Checkpoint QR Code - ${checkpoint.name}`,
        body: `
          <h2>${siteName} - ${checkpoint.name}</h2>
          <p><strong>QR Code:</strong> ${checkpoint.qr_code}</p>
          <img src="${dataUrl}" alt="QR Code" style="width: 300px; height: 300px;" />
          <p>Location: ${checkpoint.location.lat.toFixed(6)}, ${checkpoint.location.lng.toFixed(6)}</p>
          <p>Print this QR code and place it at the checkpoint location.</p>
        `
      });
      alert('QR code sent to email!');
    } catch (error) {
      alert('Failed to send email: ' + error.message);
    }
  };

  const handleWhatsApp = () => {
    const message = encodeURIComponent(
      `🛡️ Checkpoint QR Code\n\n` +
      `Site: ${siteName}\n` +
      `Checkpoint: ${checkpoint.name}\n` +
      `Code: ${checkpoint.qr_code}\n` +
      `Location: ${checkpoint.location.lat.toFixed(6)}, ${checkpoint.location.lng.toFixed(6)}\n\n` +
      `Download and print the QR code from the system.`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  if (!checkpoint.qr_code) {
    return null;
  }

  return (
    <Card className="bg-slate-900/50 border-slate-700">
      <CardContent className="p-4">
        <div className="flex flex-col items-center gap-4">
          <canvas ref={canvasRef} className="bg-white p-2 rounded" />
          
          {qrGenerated && (
            <div className="grid grid-cols-2 gap-2 w-full">
              <Button
                size="sm"
                variant="outline"
                onClick={handlePrint}
                className="border-slate-600 text-slate-300"
              >
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownload}
                className="border-slate-600 text-slate-300"
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleEmail}
                className="border-slate-600 text-slate-300"
              >
                <Mail className="w-4 h-4 mr-2" />
                Email
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleWhatsApp}
                className="border-slate-600 text-slate-300"
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                WhatsApp
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}