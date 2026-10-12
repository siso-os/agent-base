import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AppFrame, RailButton, SpacesRail, type RailSpaceSlot } from "@siso/shell";
import "@siso/tokens/siso.css";
import "@siso/shell/shell.css";
import { Bot, Factory, Briefcase, House, ListChecks, Mic, Globe, Landmark, Blocks, BookOpen, CircleHelp } from "lucide-react";

function Preview() {
  const [openSpace, setOpenSpace] = useState("agent-base");

  const spaces: RailSpaceSlot[] = [
    {
      id: "agent-base",
      colour: "#22d3ee",
      button: <RailButton label="Agent Base" Icon={Bot} active={openSpace === "agent-base"} onClick={() => setOpenSpace("agent-base")} />,
    },
    {
      id: "app-factory",
      colour: "#3b82f6",
      button: <RailButton label="App Factory" Icon={Factory} active={openSpace === "app-factory"} onClick={() => setOpenSpace("app-factory")} />,
    },
    {
      id: "agency",
      colour: "#FFA726",
      button: <RailButton label="Agency" Icon={Briefcase} active={openSpace === "agency"} onClick={() => setOpenSpace("agency")} />,
    },
  ];

  const modules = {
    "agent-base": [
      <RailButton key="agents" label="Agents" Icon={House} />,
      <RailButton key="tasks" label="Tasks" Icon={ListChecks} />,
      <RailButton key="voice" label="Voice" Icon={Mic} />,
      <RailButton key="browser" label="Browser" Icon={Globe} />,
      <RailButton key="estate" label="Estate" Icon={Landmark} />,
      <RailButton key="hub" label="Agents Hub" Icon={Blocks} />,
    ],
    "app-factory": [<RailButton key="factory" label="App Factory" Icon={Factory} />],
    agency: [
      <RailButton key="rolodex" label="Rolodex" Icon={Briefcase} />,
    ],
  };

  return (
    <AppFrame
      top={<div />}
      rail={<SpacesRail open={openSpace} spaces={spaces}>{modules[openSpace as keyof typeof modules]}</SpacesRail>}
      railFooter={
        <>
          <RailButton label="Library" Icon={BookOpen} />
          <RailButton label="Questions" Icon={CircleHelp} />
          <div style={{ flex: 1 }} />
          <span className="siso-app__orb" title="Shaan">SS</span>
        </>
      }
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--crm-color-text-muted)" }}>
        Click a space button to change the open space
      </div>
    </AppFrame>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
