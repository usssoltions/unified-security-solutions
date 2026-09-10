import React from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Lightweight page transition — a short fade + 8px slide that gives the app
 * native-like page-change feedback without full-screen flashes or expensive
 * animation loops (one 180ms ease-out, no looping, GPU-friendly opacity/
 * transform only). Honours the OS "remove animations" / prefers-reduced-motion
 * setting (renders instantly with no motion when reduced motion is set —
 * see also the global reduced-motion rule in index.css). Navigation and
 * back-stack behaviour are untouched: React Router only re-keys the wrapper.
 */
export default function PageTransition({ routeKey, children }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      key={routeKey}
      initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}