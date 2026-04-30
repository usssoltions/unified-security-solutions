import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Brain, Sparkles, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";

export default function AIDocumentScanner({ onResult, scanMode }) {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const documentPrompts = {
    sa_id: `Analyze this South African ID document. Extract: 13-digit ID number, full name, date of birth, gender, nationality. 
    Also check for authenticity signs. Return JSON.`,
    drivers_licence: `Analyze this South African Driver's Licence card. Extract: licence number, full name, ID number, 
    vehicle codes (A1,A,B,C,EB etc), issue date, expiry date, restrictions. Return JSON.`,
    vehicle_disc: `Analyze this South African Vehicle Licence Disc. Extract: registration number (e.g. CA 123-456), 
    vehicle make, model, engine number, disc expiry date, registered owner. Return JSON.`,
  };

  const handleCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessing(true);
    setResult(null);
    setError(null);

    const { file_url } = await base44.integrations.Core.UploadFile({ file });

    const analysisResult = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert South African document verification AI. ${documentPrompts[scanMode] || documentPrompts.sa_id}
      
      IMPORTANT: Be very precise with ID numbers and registration numbers. If you cannot read a field clearly, say "unclear".
      Assess authenticity: look for signs of tampering, damage, or inconsistencies.
      
      Return JSON with: document_type, id_number, full_name, registration_number, licence_number, 
      expiry_date, vehicle_codes, confidence (0-100), authenticity_status ("valid"/"suspicious"/"unclear"), authenticity_notes`,
      file_urls: [file_url],
      response_json_schema: {
        type: "object",
        properties: {
          document_type: { type: "string" },
          id_number: { type: "string" },
          full_name: { type: "string" },
          registration_number: { type: "string" },
          licence_number: { type: "string" },
          expiry_date: { type: "string" },
          vehicle_codes: { type: "string" },
          confidence: { type: "number" },
          authenticity_status: { type: "string" },
          authenticity_notes: { type: "string" }
        }
      }
    });

    setResult(analysisResult);
    setProcessing(false);

    const primaryId = analysisResult.id_number || analysisResult.licence_number || analysisResult.registration_number;
    if (onResult) {
      onResult({ ...analysisResult, primary_id: primaryId });
    }
  };

  const confidenceColor = (score) => {
    if (score >= 85) return "bg-emerald-600";
    if (score >= 65) return "bg-amber-600";
    return "bg-rose-600";
  };

  return (
    <div className="space-y-3">
      <input type="file" accept="image/*" capture="environment" onChange={handleCapture} className="hidden" id="ai-doc-capture" />
      
      <label htmlFor="ai-doc-capture">
        <div className={`w-full border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-3 cursor-pointer active:scale-95 transition-all ${
          processing ? "border-purple-400/50 bg-purple-500/10" : "border-purple-500/40 bg-purple-500/5 hover:bg-purple-500/10"
        }`}>
          {processing ? (
            <>
              <div className="relative">
                <Brain className="w-10 h-10 text-purple-400 animate-pulse" />
                <Sparkles className="w-4 h-4 text-purple-300 animate-spin absolute -top-1 -right-1" />
              </div>
              <div className="text-center">
                <p className="text-purple-300 font-semibold">AI Processing Document...</p>
                <p className="text-slate-500 text-xs mt-1">Extracting & verifying data</p>
              </div>
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="w-14 h-14 bg-purple-500/20 rounded-full flex items-center justify-center">
                <Camera className="w-7 h-7 text-purple-400" />
              </div>
              <div className="text-center">
                <p className="text-purple-400 font-bold text-base">AI Document Scan</p>
                <p className="text-slate-400 text-xs mt-1">
                  {scanMode === "sa_id" && "Scan SA ID Book or Smart ID Card"}
                  {scanMode === "drivers_licence" && "Scan Driver's Licence Card"}
                  {scanMode === "vehicle_disc" && "Scan Vehicle Licence Disc"}
                </p>
                <p className="text-slate-500 text-xs mt-1">AI will automatically extract all information</p>
              </div>
            </>
          )}
        </div>
      </label>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-400" />
                <span className="text-purple-300 text-xs font-bold uppercase tracking-wider">AI Result</span>
              </div>
              <div className="flex items-center gap-2">
                {result.confidence && (
                  <Badge className={`${confidenceColor(result.confidence)} text-xs`}>
                    {result.confidence}% match
                  </Badge>
                )}
                {result.authenticity_status === "valid" && (
                  <Badge className="bg-emerald-600 text-xs flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Valid
                  </Badge>
                )}
                {result.authenticity_status === "suspicious" && (
                  <Badge className="bg-rose-600 text-xs flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Suspicious
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              {result.full_name && (
                <div className="col-span-2">
                  <p className="text-slate-500 text-xs">Name</p>
                  <p className="text-white font-bold text-base">{result.full_name}</p>
                </div>
              )}
              {result.id_number && (
                <div>
                  <p className="text-slate-500 text-xs">ID Number</p>
                  <p className="text-emerald-400 font-mono font-semibold">{result.id_number}</p>
                </div>
              )}
              {result.licence_number && (
                <div>
                  <p className="text-slate-500 text-xs">Licence No.</p>
                  <p className="text-sky-400 font-mono font-semibold">{result.licence_number}</p>
                </div>
              )}
              {result.registration_number && (
                <div>
                  <p className="text-slate-500 text-xs">Registration</p>
                  <p className="text-amber-400 font-mono font-bold">{result.registration_number}</p>
                </div>
              )}
              {result.expiry_date && (
                <div>
                  <p className="text-slate-500 text-xs">Expiry</p>
                  <p className="text-white text-sm">{result.expiry_date}</p>
                </div>
              )}
              {result.vehicle_codes && (
                <div>
                  <p className="text-slate-500 text-xs">Vehicle Codes</p>
                  <p className="text-white text-sm">{result.vehicle_codes}</p>
                </div>
              )}
            </div>

            {result.authenticity_notes && result.authenticity_status !== "valid" && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-amber-300 text-xs">{result.authenticity_notes}</p>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}