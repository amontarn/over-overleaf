import getMeta from "@/utils/meta";
import { RailElement } from "@/features/ide-react/util/rail-types";
import AiAssistantPanel from "./ai-assistant-panel";

const aiRailEntry: RailElement = {
  key: "ai-assistant",
  icon: "smart_toy",
  title: "Assistant IA",
  component: <AiAssistantPanel />,
  hide: Boolean(
    getMeta("ol-anonymous") || getMeta("ol-isRestrictedTokenMember"),
  ),
};

export default aiRailEntry;
