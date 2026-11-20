
import { useEffect, useState } from "react";
import "./App.css";
import ChennaiMap from "./components/ChennaiMap";
function App() {
  const [apiStatus, setApiStatus] = useState("Checking...");

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"}/api/health`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Backend unavailable");
        }
        return response.json();
      })
      .then((data) => setApiStatus(data.status))
      .catch(() => setApiStatus("Disconnected"));
  }, []);

  return (
    <div className="app">
      <header className="navbar">
        <h2>🌍 GeoPulse</h2>
        <span>Geospatial Intelligence Platform</span>
      </header>

      <main className="dashboard">
        <p className="tag">SATELLITE INTELLIGENCE SYSTEM</p>

        <h1>Understand how our world changes.</h1>

        <p className="description">
          AI-powered satellite monitoring and geographical
          change detection for Chennai, Tamil Nadu.
        </p>

        <div className="status-card">
          <h3>System Status</h3>
          <p>
            Backend: <strong>{apiStatus}</strong>
          </p>
          <p>Study Area: Chennai, Tamil Nadu</p>
          <p>Project: GeoPulse</p>
        </div>

        <div className="feature-grid">
          <div className="feature">
            <h3>🛰️ Satellite Data</h3>
            <p>Multi-date satellite imagery analysis.</p>
          </div>

          <div className="feature">
            <h3>🤖 AI Detection</h3>
            <p>Identify geographical changes.</p>
          </div>

          <div className="feature">
            <h3>🗺️ Interactive Maps</h3>
            <p>Visualize detected changes geographically.</p>
          </div>
                </div>

        <section className="map-section">
          <h2>🗺️ Chennai Geospatial Map</h2>
          <p>Explore Chennai using an interactive map.</p>
          <ChennaiMap />
        </section>

      </main>
    </div>
  );
}

export default App;
