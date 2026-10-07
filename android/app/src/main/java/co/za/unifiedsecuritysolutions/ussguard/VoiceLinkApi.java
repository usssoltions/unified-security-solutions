package co.za.unifiedsecuritysolutions.ussguard;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;

/**
 * USS VOICE LINK (pilot) — thin HTTPS client for the voiceLink gateway.
 * The call-scoped token (delivered only inside the callee's own push) is the
 * only credential carried; it expires with the call and never persists.
 */
public final class VoiceLinkApi {
    private static final String TAG = "USSGuard";
    public static final String GATEWAY_URL =
        "https://guard-track-pro-26cedab8.base44.app/functions/voiceLink";

    private VoiceLinkApi() {}

    /** POST one gateway action. Returns the parsed response, or null on failure. */
    public static JSONObject post(String action, String callId, String token, JSONObject extra) {
        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("action", action);
            if (callId != null) body.put("call_id", callId);
            if (token != null) body.put("token", token);
            if (extra != null) {
                java.util.Iterator<String> keys = extra.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    body.put(k, extra.get(k));
                }
            }

            URL url = new URL(GATEWAY_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }

            int code = conn.getResponseCode();
            BufferedReader reader = new BufferedReader(new InputStreamReader(
                code >= 400 ? conn.getErrorStream() : conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            reader.close();

            if (code >= 400) {
                android.util.Log.w(TAG, "voiceLink " + action + " -> HTTP " + code + ": " + sb);
                try { return new JSONObject(sb.toString()); } catch (Exception e) { return null; }
            }
            return new JSONObject(sb.toString());
        } catch (Exception e) {
            android.util.Log.e(TAG, "voiceLink " + action + " failed", e);
            return null;
        } finally {
            if (conn != null) try { conn.disconnect(); } catch (Exception ignored) {}
        }
    }
}