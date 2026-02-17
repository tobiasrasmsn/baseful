import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import About from "./pages/About";
import DatabaseDetail from "./pages/DatabaseDetail";
import DatabaseConnections from "./pages/DatabaseConnections";
import Settings from "./pages/Settings";
import SQLEditor from "./pages/SQLEditor";
import Tables from "./pages/Tables";
import Containers from "./pages/Containers";
import Monitoring from "./pages/Monitoring";
import WebServer from "./pages/WebServer";
import Branches from "./pages/branches/Branches";
import Backup from "./pages/Backup";
import Sidebar from "./components/dashboard/sidebar";
import MobileDock from "./components/dashboard/MobileDock";
import { ThemeProvider } from "./components/theme-provider";
import { DatabaseProvider } from "./context/DatabaseContext";
import { ProjectProvider } from "./context/ProjectContext";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="baseful-theme">
      <Router>
        <ProjectProvider>
          <DatabaseProvider>
            <div className="bg-background h-dvh w-full flex flex-row">
              {/* Desktop Sidebar - hidden on mobile */}
              <div className="hidden md:block">
                <Sidebar />
              </div>

              <main className="p-2 bg-background flex h-full flex-1 min-w-0 pb-2">
                <div className="bg-card/75 overflow-y-auto overflow-x-hidden border border-border rounded-md h-full w-full">
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/about" element={<About />} />
                    <Route
                      path="/db/:id/dashboard"
                      element={<DatabaseDetail />}
                    />
                    <Route path="/db/:id/branches" element={<Branches />} />
                    <Route
                      path="/db/:id/integrations"
                      element={<DatabaseDetail />}
                    />
                    <Route path="/db/:id/settings" element={<Settings />} />
                    <Route
                      path="/db/:id/overview"
                      element={<DatabaseDetail />}
                    />
                    <Route path="/db/:id/monitoring" element={<Monitoring />} />
                    <Route path="/db/:id/sql-editor" element={<SQLEditor />} />
                    <Route
                      path="/db/:id/connections"
                      element={<DatabaseConnections />}
                    />
                    <Route path="/db/:id/tables" element={<Tables />} />
                    <Route path="/db/:id/containers" element={<Containers />} />
                    <Route path="/db/:id/web-server" element={<WebServer />} />
                    <Route path="/db/:id/backup" element={<Backup />} />
                  </Routes>
                </div>
              </main>

              {/* Mobile Dock - hidden on desktop */}
              <MobileDock />
            </div>
          </DatabaseProvider>
        </ProjectProvider>
      </Router>
    </ThemeProvider>
  );
}

export default App;
