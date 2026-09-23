import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { AuthPage } from "./pages/Auth";
import { CommandsPage } from "./pages/Commands";
import { HomePage } from "./pages/Home";
import { LeaderboardPage } from "./pages/Leaderboard";
import { MissionPlayPage } from "./pages/MissionPlay";
import { MissionsPage } from "./pages/Missions";
import { ProfilePage } from "./pages/Profile";
import { RankedPage } from "./pages/Ranked";
import { SandboxPage } from "./pages/Sandbox";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<AuthPage />} />
        <Route path="missions" element={<MissionsPage />} />
        <Route path="missions/:slug" element={<MissionPlayPage />} />
        <Route
          path="ranked"
          element={
            <RequireAuth>
              <RankedPage />
            </RequireAuth>
          }
        />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route
          path="profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />
        <Route path="lab" element={<SandboxPage />} />
        <Route path="commandes" element={<CommandsPage />} />
        <Route path="*" element={<p className="p-6 text-slate-400">Page introuvable.</p>} />
      </Route>
    </Routes>
  );
}
