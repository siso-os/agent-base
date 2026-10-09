import type { HttpRuntime } from "../server.ts";
import { miniAgentsRoutes } from "../mini-agents.ts";
import { remoteInventoryRoutes } from "./remote.area.ts";
import { deliveryRoutes } from "./delivery.area.ts";
import { productMapRoutes } from "./product-map.area.ts";
import { browserDiagnosticRoutes, browserRoutes } from "./browser.area.ts";
import { feedbackRoutes } from "./feedback.area.ts";
import { spacesRoutes } from "./spaces.area.ts";
import { changesRoutes } from "./changes.area.ts";
import { attentionRoutes } from "./attention.area.ts";
import { versionRoutes, releaseLeavesRoutes, shippingRoutes } from "./release.area.ts";
import { scratchpadRoutes } from "./scratchpad.area.ts";
import { serviceLeavesRoutes } from "./services.area.ts";
import { usageRoutes, spendRoutes } from "./usage.area.ts";
import { directoryRoutes, directoryWritesRoutes } from "./directory.area.ts";
import { communicationsRoutes } from "./communications.area.ts";
import { libraryActionsRoutes } from "./library-actions.area.ts";
import { agentActionsRoutes } from "./agent-actions.area.ts";
import { hubRoutes } from "./hub.area.ts";
import { taskEventsRoutes, tasksRoutes } from "./tasks.area.ts";
import { boardRoutes } from "./board.area.ts";
import { agentRecordsRoutes } from "./agent-records.area.ts";
import { selectionRoutes } from "./selection.area.ts";
import { reviewsRoutes } from "./reviews.area.ts";
import { projectsRoutes } from "./projects.area.ts";
import { uploadsRoutes } from "./uploads.area.ts";
import { workspacesRoutes } from "./workspaces.area.ts";
import { agentLaunchRoutes } from "./agent-launch.area.ts";
import { agentSessionRoutes, agentReadRoutes } from "./agent-session.area.ts";
import { timelineRoutes } from "./timeline.area.ts";
import { staticRoutes } from "./static.area.ts";

/** Explicit built-in order, identical to the former server dispatch. Filename discovery does not register these areas. */
export function builtinRoutes(runtime: HttpRuntime) {
  return [
    miniAgentsRoutes(runtime),
    remoteInventoryRoutes(runtime),
    deliveryRoutes(runtime),
    productMapRoutes(runtime),
    browserDiagnosticRoutes(runtime),
    feedbackRoutes(runtime),
    spacesRoutes(runtime),
    changesRoutes(runtime),
    attentionRoutes(runtime),
    versionRoutes(runtime),
    scratchpadRoutes(runtime),
    releaseLeavesRoutes(runtime),
    serviceLeavesRoutes(runtime),
    usageRoutes(runtime),
    shippingRoutes(runtime),
    spendRoutes(runtime),
    directoryRoutes(runtime),
    browserRoutes(runtime),
    communicationsRoutes(runtime),
    libraryActionsRoutes(runtime),
    agentActionsRoutes(runtime),
    hubRoutes(runtime),
    taskEventsRoutes(runtime),
    selectionRoutes(runtime),
    tasksRoutes(runtime),
    boardRoutes(runtime),
    agentRecordsRoutes(runtime),
    reviewsRoutes(runtime),
    projectsRoutes(runtime),
    directoryWritesRoutes(runtime),
    uploadsRoutes(runtime),
    workspacesRoutes(runtime),
    agentLaunchRoutes(runtime),
    agentSessionRoutes(runtime),
    timelineRoutes(runtime),
    agentReadRoutes(runtime),
    staticRoutes(runtime),
  ];
}
