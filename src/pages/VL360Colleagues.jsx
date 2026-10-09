import React from "react";
import { useVL360 } from "@/hooks/useVL360";
import VL360Shell from "@/components/vl360/VL360Shell";
import ColleagueListPanel from "@/components/vl360/ColleagueListPanel";

/**
 * VL360Colleagues — permitted personnel list (Call a Colleague / Individual
 * message destinations). Selecting a person offers Voice Call, Video Call and
 * Send Message, which open that person's configured conversation.
 */
export default function VL360Colleagues() {
  const ctx = useVL360();
  return (
    <VL360Shell ctx={ctx} title="Colleagues" subtitle="Select a person to connect">
      <ColleagueListPanel siteId={ctx.data?.duty?.site_id || null} />
    </VL360Shell>
  );
}