
import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

const API_URL = "http://127.0.0.1:8000";

const styles = {
  panel: {
    padding: 24,
    border: "1px solid #293c55",
    borderRadius: 12,
    background: "#172337",
    color: "#f8fafc",
    marginTop: 22,
  },

  innerPanel: {
    padding: 18,
    border: "1px solid #334155",
    borderRadius: 10,
    background: "#0f172a",
    color: "#f8fafc",
    marginTop: 18,
  },

  input: {
    width: "100%",
    padding: 10,
    border: "1px solid #475569",
    borderRadius: 8,
    background: "#0b1220",
    color: "#f8fafc",
    colorScheme: "dark",
    boxSizing: "border-box",
    marginTop: 8,
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 14,
    marginTop: 18,
  },

  card: {
    padding: 16,
    border: "1px solid #334155",
    borderRadius: 10,
    background: "#111f33",
    color: "#f8fafc",
  },

  muted: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 1.7,
  },

  heading: {
    color: "#7dd3fc",
    marginTop: 0,
  },

  tableCell: {
    padding: 11,
    borderBottom: "1px solid #334155",
    color: "#e2e8f0",
    textAlign: "left",
    fontSize: 13,
  },
};

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined) {
    return "Unavailable";
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number.toFixed(digits)
    : "Unavailable";
}

function SummaryCard({ title, value, detail, color }) {
  return (
    <div style={styles.card}>
      <div style={styles.muted}>{title}</div>

      <div
        style={{
          fontSize: 23,
          fontWeight: 700,
          marginTop: 8,
          color: color || "#f8fafc",
        }}
      >
        {value}
      </div>

      {detail && (
        <div style={{ ...styles.muted, marginTop: 6 }}>
          {detail}
        </div>
      )}
    </div>
  );
}

function HistoryChart({
  observations,
  dataKey,
  color,
  title,
}) {
  return (
    <div style={styles.innerPanel}>
      <h3 style={styles.heading}>{title}</h3>

      <div style={{ width: "100%", height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={observations}
            margin={{
              top: 10,
              right: 20,
              left: 0,
              bottom: 12,
            }}
          >
            <CartesianGrid
              stroke="#334155"
              strokeDasharray="3 3"
            />

            <XAxis
              dataKey="date"
              stroke="#cbd5e1"
              tick={{ fill: "#cbd5e1", fontSize: 11 }}
              angle={-25}
              textAnchor="end"
              height={65}
            />

            <YAxis
              domain={[-1, 1]}
              stroke="#cbd5e1"
              tick={{ fill: "#cbd5e1", fontSize: 12 }}
            />

            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #475569",
                borderRadius: 8,
                color: "#f8fafc",
              }}
              labelStyle={{ color: "#f8fafc" }}
              itemStyle={{ color }}
            />

            <Legend
              wrapperStyle={{ color: "#e2e8f0" }}
            />

            <Line
              type="linear"
              dataKey={dataKey}
              name={title}
              stroke={color}
              strokeWidth={3}
              dot={{ r: 5, fill: color }}
              activeDot={{ r: 7 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function HistoricalDashboard({
  selectedArea,
}) {
  const [startDate, setStartDate] =
    useState("2024-01-01");

  const [endDate, setEndDate] =
    useState("2025-12-31");

  const [cloudCover, setCloudCover] = useState(20);
  const [maxObservations, setMaxObservations] = useState(4);

  const [historyData, setHistoryData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // A changed study area must not display results
  // calculated for the previous area.
  const areaKey = selectedArea
    ? [
        selectedArea.north,
        selectedArea.south,
        selectedArea.east,
        selectedArea.west,
      ].join(",")
    : "";

  useEffect(() => {
    setHistoryData(null);
    setError("");
  }, [areaKey]);

  async function runHistoricalAnalysis() {
    setError("");
    setHistoryData(null);

    if (!selectedArea) {
      setError("Please select a study area first.");
      return;
    }

    if (!startDate || !endDate || startDate > endDate) {
      setError("Please select a valid date range.");
      return;
    }

    const cloud = Number(cloudCover);

    if (
      cloudCover === "" ||
      !Number.isFinite(cloud) ||
      cloud < 0 ||
      cloud > 100
    ) {
      setError("Cloud cover must be between 0 and 100.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `${API_URL}/api/satellite/history`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            north: Number(selectedArea.north),
            south: Number(selectedArea.south),
            east: Number(selectedArea.east),
            west: Number(selectedArea.west),
            start_date: startDate,
            end_date: endDate,
            max_cloud_cover: cloud,
            max_observations: Number(maxObservations),
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : "Historical analysis failed."
        );
      }

      setHistoryData(result);
    } catch (err) {
      setError(
        err.message || "Unable to load historical data."
      );
    } finally {
      setLoading(false);
    }
  }

  const observations = historyData?.observations || [];
  const summary = historyData?.summary;

  return (
    <section style={styles.panel}>
      <h2
        style={{
          ...styles.heading,
          textAlign: "center",
        }}
      >
        🛰️ Historical Satellite Monitoring
      </h2>

      <p
        style={{
          ...styles.muted,
          textAlign: "center",
        }}
      >
        Monitor historical vegetation and possible-water
        spectral signals using real Sentinel-2 Level-2A
        observations.
      </p>

      {!selectedArea && (
        <p style={{ color: "#fbbf24" }}>
          Select a study area on the map first.
        </p>
      )}

      <div style={styles.grid}>
        <label>
          Start Date
          <input
            type="date"
            style={styles.input}
            value={startDate}
            disabled={loading}
            onChange={(e) =>
              setStartDate(e.target.value)
            }
          />
        </label>

        <label>
          End Date
          <input
            type="date"
            style={styles.input}
            value={endDate}
            disabled={loading}
            onChange={(e) =>
              setEndDate(e.target.value)
            }
          />
        </label>

        <label>
          Maximum Cloud Cover (%)
          <input
            type="number"
            min="0"
            max="100"
            style={styles.input}
            value={cloudCover}
            disabled={loading}
            onChange={(e) =>
              setCloudCover(e.target.value)
            }
          />
        </label>

        <label>
          Maximum Observations
          <select
            style={styles.input}
            value={maxObservations}
            disabled={loading}
            onChange={(e) =>
              setMaxObservations(Number(e.target.value))
            }
          >
            {[2, 3, 4, 5, 6].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        style={{
          textAlign: "center",
          marginTop: 22,
        }}
      >
        <button
          type="button"
          disabled={loading || !selectedArea}
          onClick={runHistoricalAnalysis}
          style={{
            padding: "12px 22px",
            border: "none",
            borderRadius: 8,
            background: "#2563eb",
            color: "#ffffff",
            fontWeight: 700,
            cursor:
              loading || !selectedArea
                ? "not-allowed"
                : "pointer",
            opacity:
              loading || !selectedArea ? 0.6 : 1,
          }}
        >
          {loading
            ? "Processing Satellite Observations..."
            : "Run Historical Analysis"}
        </button>
      </div>

      {loading && (
        <p
          role="status"
          style={{
            color: "#7dd3fc",
            textAlign: "center",
          }}
        >
          Processing real Sentinel-2 imagery.
          Please wait...
        </p>
      )}

      {error && (
        <div
          role="alert"
          style={{
            ...styles.innerPanel,
            borderColor: "#ef4444",
            color: "#fca5a5",
          }}
        >
          {error}
        </div>
      )}

      {historyData && summary && (
        <>
          <h3
            style={{
              ...styles.heading,
              marginTop: 30,
              textAlign: "center",
            }}
          >
            Historical Analysis Summary
          </h3>

          <div style={styles.grid}>
            <SummaryCard
              title="Observations"
              value={summary.observation_count}
              detail="Successfully processed scenes"
              color="#7dd3fc"
            />

            <SummaryCard
              title="NDVI Change"
              value={formatNumber(summary.ndvi_change)}
              detail="Last mean minus first mean"
              color="#4ade80"
            />

            <SummaryCard
              title="NDWI Change"
              value={formatNumber(summary.ndwi_change)}
              detail="Last mean minus first mean"
              color="#38bdf8"
            />

            <SummaryCard
              title="Monitoring Period"
              value={`${summary.observation_count} dates`}
              detail={`${summary.first_date} to ${summary.last_date}`}
              color="#c4b5fd"
            />
          </div>

          <HistoryChart
            observations={observations}
            dataKey="mean_ndvi"
            color="#4ade80"
            title="Mean NDVI Trend"
          />

          <HistoryChart
            observations={observations}
            dataKey="mean_ndwi"
            color="#38bdf8"
            title="Mean NDWI Trend"
          />

          <div style={styles.innerPanel}>
            <h3 style={styles.heading}>
              Satellite Observation History
            </h3>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr style={{ background: "#1e293b" }}>
                    {[
                      "Date",
                      "Scene ID",
                      "Cloud %",
                      "Mean NDVI",
                      "Mean NDWI",
                      "NDVI Coverage %",
                      "NDWI Coverage %",
                    ].map((heading) => (
                      <th
                        key={heading}
                        style={{
                          ...styles.tableCell,
                          color: "#7dd3fc",
                        }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {observations.map((item) => (
                    <tr key={item.scene_id}>
                      <td style={styles.tableCell}>
                        {item.date}
                      </td>

                      <td
                        style={{
                          ...styles.tableCell,
                          overflowWrap: "anywhere",
                        }}
                      >
                        {item.scene_id}
                      </td>

                      <td style={styles.tableCell}>
                        {formatNumber(
                          item.cloud_cover,
                          2
                        )}
                      </td>

                      <td style={styles.tableCell}>
                        {formatNumber(item.mean_ndvi)}
                      </td>

                      <td style={styles.tableCell}>
                        {formatNumber(item.mean_ndwi)}
                      </td>

                      <td style={styles.tableCell}>
                        {formatNumber(
                          item.ndvi_valid_coverage,
                          2
                        )}
                      </td>

                      <td style={styles.tableCell}>
                        {formatNumber(
                          item.ndwi_valid_coverage,
                          2
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={styles.innerPanel}>
            <h3 style={styles.heading}>
              Data Quality and Limitations
            </h3>

            <p style={{ color: "#e2e8f0" }}>
              Catalog scenes retrieved:{" "}
              <strong>
                {historyData.catalog_items_retrieved}
              </strong>
            </p>

            <p style={{ color: "#e2e8f0" }}>
              Failed scene evaluations:{" "}
              <strong>
                {historyData.failed_scenes?.length || 0}
              </strong>
            </p>

            <ul
              style={{
                color: "#cbd5e1",
                lineHeight: 1.9,
                paddingLeft: 24,
              }}
            >
              {(historyData.limitations || []).map(
                (item, index) => (
                  <li key={index}>{item}</li>
                )
              )}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
