import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { ToastProvider } from "./components/ui";
import { I18nProvider } from "./lib/i18n";
import { ServerPicker } from "./pages/ServerPicker";
import { GuildLayout } from "./pages/GuildLayout";
import { Overview } from "./pages/Overview";
import { Members } from "./pages/Members";
import { EventLog } from "./pages/EventLog";
import { Levels } from "./pages/Levels";
import { Mee6Import } from "./pages/Mee6Import";
import { Welcome } from "./pages/Welcome";
import { ReactionRoles } from "./pages/ReactionRoles";
import { Moderation } from "./pages/Moderation";
import { Automod } from "./pages/Automod";
import { CustomCommands } from "./pages/CustomCommands";
import { Timers } from "./pages/Timers";
import { Automations } from "./pages/Automations";
import { TempVoice } from "./pages/TempVoice";
import { Settings } from "./pages/Settings";
import { ServerLog } from "./pages/ServerLog";
import { BotProfile } from "./pages/BotProfile";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: (n, e) => n < 2 && !("status" in (e as object) && [401, 403, 404].includes((e as unknown as { status: number }).status)) } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <I18nProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ServerPicker />} />
            <Route path="/g/:guildId" element={<GuildLayout />}>
              <Route index element={<Overview />} />
              <Route path="members" element={<Members />} />
              <Route path="events" element={<EventLog />} />
              <Route path="levels" element={<Levels />} />
              <Route path="import" element={<Mee6Import />} />
              <Route path="welcome" element={<Welcome />} />
              <Route path="reaction-roles" element={<ReactionRoles />} />
              <Route path="moderation" element={<Moderation />} />
              <Route path="automod" element={<Automod />} />
              <Route path="commands" element={<CustomCommands />} />
              <Route path="timers" element={<Timers />} />
              <Route path="automations" element={<Automations />} />
              <Route path="voice" element={<TempVoice />} />
              <Route path="server-log" element={<ServerLog />} />
              <Route path="settings" element={<Settings />} />
              <Route path="profile" element={<BotProfile />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
