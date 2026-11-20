
import { useEffect, useRef, useState } from "react";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  LayersControl,
  Rectangle,
  ImageOverlay,
  useMapEvents,
  useMap,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";
import ReportExport from "./ReportExport";
import HistoricalDashboard from "./HistoricalDashboard";
import StudyAreaControls, { validateStudyArea } from "./StudyAreaControls";

const { BaseLayer } = LayersControl;

const API_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const CHENNAI = [13.0827, 80.2707];

// ==========================================
// Styles
// ==========================================

const styles = {
  panel: {
    marginTop: 22,
    padding: 24,
    background: "#172337",
    border: "1px solid #293c55",
    borderRadius: 12,
    color: "#f8fafc",
  },

  input: {
    width: "100%",
    padding: 11,
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#f8fafc",
    marginTop: 8,
    boxSizing: "border-box",
    colorScheme: "dark",
  },

  button: {
    padding: "12px 20px",
    border: "none",
    borderRadius: 8,
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: "bold",
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 16,
    marginTop: 20,
  },

  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
    marginTop: 18,
  },

  muted: {
    color: "#94a3b8",
    fontSize: 13,
  },

  detail: {
    padding: 14,
    background: "#0b1220",
    border: "1px solid #334155",
    borderRadius: 8,
    marginTop: 12,
    overflowWrap: "anywhere",
  },
};

// ==========================================
// Helpers
// ==========================================

function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined) {
    return "Unavailable";
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number.toFixed(decimals)
    : "Unavailable";
}

function formatCount(value) {
  return typeof value === "number"
    ? value.toLocaleString()
    : "Unavailable";
}

function formatDate(value) {
  if (!value) return "Unavailable";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : date.toLocaleString();
}

function percentWidth(value) {
  const number = Number(value) || 0;

  return `${Math.max(0, Math.min(100, number))}%`;
}

function getNDVIInterpretation(value) {
  if (typeof value !== "number") {
    return "Unavailable";
  }

  if (value < 0) return "Negative vegetation index";
  if (value < 0.2) return "Low vegetation signal";
  if (value < 0.4) return "Moderate vegetation signal";
  if (value < 0.6) {
    return "Moderately high vegetation signal";
  }

  return "High vegetation signal";
}

function getNDWIInterpretation(value) {
  if (typeof value !== "number") {
    return "Unavailable";
  }

  if (value <= 0) {
    return "Low water signal on average";
  }

  if (value <= 0.2) {
    return "Weak positive water signal";
  }

  if (value <= 0.4) {
    return "Moderate positive water signal";
  }

  return "Strong positive water signal";
}

function StatusMessage({ message }) {
  if (!message) return null;

  const isError = message.startsWith("Error");

  return (
    <p
      role="status"
      style={{
        marginTop: 16,
        color: isError ? "#f87171" : "#4ade80",
        overflowWrap: "anywhere",
      }}
    >
      {message}
    </p>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  color = "#2563eb",
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles.button,
        background: color,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ==========================================
// Map Click Selector
// ==========================================

function StudyAreaMapFocus({ selectedArea }) {
  const map = useMap();

  useEffect(() => {
    if (!selectedArea) return;

    map.fitBounds(
      [
        [selectedArea.south, selectedArea.west],
        [selectedArea.north, selectedArea.east],
      ],
      { padding: [30, 30], maxZoom: 15, animate: false }
    );
  }, [map, selectedArea?.north, selectedArea?.south, selectedArea?.east, selectedArea?.west]);

  return null;
}

function TwoClickSelector({ onMapClick }) {
  useMapEvents({
    click(event) {
      onMapClick(event.latlng);
    },
  });

  return null;
}

// ==========================================
// Statistics Card
// ==========================================

function StatCard({
  title,
  value,
  description,
  color = "#f8fafc",
}) {
  return (
    <div style={styles.detail}>
      <p style={styles.muted}>{title}</p>

      <h2
        style={{
          margin: "8px 0",
          color,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </h2>

      {description && (
        <p style={styles.muted}>{description}</p>
      )}
    </div>
  );
}

// ==========================================
// Coverage Bar
// ==========================================

function CoverageBar({
  percentage,
  color = "#38bdf8",
  title = "Valid Pixel Coverage",
}) {
  return (
    <div style={{ marginTop: 20 }}>
      <h4>{title}</h4>

      <div
        style={{
          width: "100%",
          height: 20,
          background: "#334155",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: percentWidth(percentage),
            background: color,
          }}
        />
      </div>

      <p style={styles.muted}>
        {formatNumber(percentage)}% of pixels
        passed the relevant validity checks.
      </p>

      {typeof percentage === "number" &&
        percentage < 50 && (
          <div
            style={{
              ...styles.detail,
              background: "#422006",
              borderColor: "#d97706",
              color: "#fde68a",
            }}
          >
            <strong>
              ⚠️ Low Valid-Pixel Coverage
            </strong>

            <p>
              Analysis statistics describe only
              valid pixels. They may not represent
              the entire study area.
            </p>

            <p>
              Try a longer date range to find
              clearer satellite observations.
            </p>
          </div>
        )}
    </div>
  );
}

// ==========================================
// Candidate Scene Table
// ==========================================

function CandidateSceneTable({
  candidates = [],
  selectedSceneId,
}) {
  if (!candidates.length) {
    return (
      <p style={styles.muted}>
        No candidate scene details available.
      </p>
    );
  }

  return (
    <div style={{ overflowX: "auto", marginTop: 12 }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            {[
              "Scene ID",
              "Cloud %",
              "Valid %",
              "Status",
            ].map((heading) => (
              <th
                key={heading}
                style={{
                  padding: 10,
                  textAlign: "left",
                  borderBottom: "1px solid #475569",
                }}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {candidates.map((candidate, index) => {
            const selected =
              candidate.scene_id === selectedSceneId;

            return (
              <tr
                key={`${candidate.scene_id}-${index}`}
                style={{
                  background: selected
                    ? "#164e63"
                    : "transparent",
                }}
              >
                <td style={{ padding: 10 }}>
                  {candidate.scene_id}

                  {selected && (
                    <strong> ✓ Selected</strong>
                  )}
                </td>

                <td style={{ padding: 10 }}>
                  {formatNumber(
                    candidate.scene_cloud_cover ??
                      candidate.cloud_cover
                  )}
                </td>

                <td style={{ padding: 10 }}>
                  {formatNumber(
                    candidate.valid_pixel_percentage
                  )}
                </td>

                <td style={{ padding: 10 }}>
                  {candidate.status || "Unavailable"}

                  {candidate.reason && (
                    <p style={styles.muted}>
                      {candidate.reason}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ==========================================
// Existing NDVI / NDWI Diagnostics
// ==========================================

function CoverageDiagnostics({ result }) {
  const diagnostics = result?.coverage_diagnostics;

  return (
    <details
      style={{
        ...styles.detail,
        marginTop: 24,
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          color: "#7dd3fc",
          fontWeight: "bold",
        }}
      >
        Satellite Coverage Diagnostics
      </summary>

      <div style={{ marginTop: 18 }}>
        <p>
          <strong>Scenes Evaluated:</strong>{" "}
          {result.scenes_evaluated ?? "Unavailable"}
        </p>

        <p>
          <strong>Selected Scene:</strong>{" "}
          {result.scene_id}
        </p>

        <p>
          <strong>Valid Pixels:</strong>{" "}
          {formatCount(result.valid_pixels)}
        </p>

        <p>
          <strong>Total Pixels:</strong>{" "}
          {formatCount(result.total_pixels)}
        </p>

        {diagnostics && (
          <>
            <h4 style={{ color: "#7dd3fc" }}>
              Pixel Diagnostics
            </h4>

            <p>
              Missing Band Pixels:{" "}
              {formatCount(
                diagnostics.any_band_missing_pixels
              )}
            </p>

            <p>
              Invalid SCL Pixels:{" "}
              {formatCount(
                diagnostics.invalid_scl_pixels
              )}
            </p>

            <p>
              Invalid Denominator Pixels:{" "}
              {formatCount(
                diagnostics.invalid_denominator_pixels
              )}
            </p>

            <p>
              Invalid Index Pixels:{" "}
              {formatCount(
                diagnostics.invalid_ndvi_pixels ??
                  diagnostics.invalid_ndwi_pixels
              )}
            </p>

            <p>
              Total Invalid Pixels:{" "}
              {formatCount(
                diagnostics.total_invalid_pixels
              )}
            </p>

            <p style={styles.muted}>
              Diagnostic categories may overlap.
              Do not add their counts together.
            </p>

            {diagnostics.scl_class_counts && (
              <>
                <h4>Scene Classification Counts</h4>

                <div style={styles.grid}>
                  {Object.entries(
                    diagnostics.scl_class_counts
                  ).map(([code, count]) => (
                    <div
                      key={code}
                      style={styles.detail}
                    >
                      <strong>SCL {code}</strong>
                      <p>{formatCount(count)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <h4 style={{ color: "#7dd3fc" }}>
          Evaluated Satellite Scenes
        </h4>

        <CandidateSceneTable
          candidates={result.scene_candidates}
          selectedSceneId={result.scene_id}
        />
      </div>
    </details>
  );
}

// ==========================================
// Existing NDVI / NDWI Results
// ==========================================

function AnalysisResults({ result, type }) {
  if (!result) return null;

  const isNDVI = type === "ndvi";
  const color = isNDVI ? "#4ade80" : "#38bdf8";

  const meanValue = isNDVI
    ? result.mean_ndvi
    : result.mean_ndwi;

  const detectedPercentage = isNDVI
    ? result.vegetation_percentage
    : result.water_percentage;

  const detectedPixels = isNDVI
    ? result.vegetation_pixels
    : result.water_pixels;

  const threshold = isNDVI
    ? result.vegetation_threshold ?? 0.3
    : result.water_threshold ?? 0;

  return (
    <div
      style={{
        ...styles.panel,
        background: isNDVI
          ? "#10291f"
          : "#0c2238",
        border: `1px solid ${
          isNDVI ? "#166534" : "#0369a1"
        }`,
      }}
    >
      <h3 style={{ color }}>
        {isNDVI
          ? "🌿 NDVI Vegetation Analysis Results"
          : "💧 NDWI Water Detection Results"}
      </h3>

      <p style={styles.muted}>
        {isNDVI
          ? "Calculated from real Sentinel-2 Red and Near-Infrared bands."
          : "Calculated from real Sentinel-2 Green and Near-Infrared bands."}
      </p>

      <div style={styles.grid}>
        <StatCard
          title={isNDVI ? "Mean NDVI" : "Mean NDWI"}
          value={formatNumber(meanValue, 4)}
          description={
            isNDVI
              ? getNDVIInterpretation(meanValue)
              : getNDWIInterpretation(meanValue)
          }
          color={color}
        />

        <StatCard
          title={
            isNDVI
              ? "Vegetation Among Valid Pixels"
              : "Possible Water Among Valid Pixels"
          }
          value={`${formatNumber(
            detectedPercentage
          )}%`}
          description={`Index greater than ${threshold}`}
          color={color}
        />

        <StatCard
          title="Valid Pixel Coverage"
          value={`${formatNumber(
            result.valid_pixel_percentage
          )}%`}
          description="Pixels retained after masking"
          color="#7dd3fc"
        />

        <StatCard
          title="Scene Cloud Cover"
          value={`${formatNumber(
            result.scene_cloud_cover
          )}%`}
          description="Full-scene cloud percentage"
          color="#fbbf24"
        />

        <StatCard
          title="Scenes Evaluated"
          value={
            result.scenes_evaluated ??
            "Unavailable"
          }
          description="Candidate scenes processed"
          color="#c4b5fd"
        />
      </div>

      <h4 style={{ color, marginTop: 24 }}>
        {isNDVI ? "NDVI" : "NDWI"} Statistics
      </h4>

      <p>
        Minimum Index:{" "}
        {formatNumber(
          isNDVI
            ? result.min_ndvi
            : result.min_ndwi,
          4
        )}
      </p>

      <p>
        Maximum Index:{" "}
        {formatNumber(
          isNDVI
            ? result.max_ndvi
            : result.max_ndwi,
          4
        )}
      </p>

      <p>
        {isNDVI
          ? "Vegetation Pixels"
          : "Possible Water Pixels"}
        : {formatCount(detectedPixels)}
      </p>

      <p>
        Valid Pixels:{" "}
        {formatCount(result.valid_pixels)}
      </p>

      <p>
        Total Pixels:{" "}
        {formatCount(result.total_pixels)}
      </p>

      <CoverageBar
        percentage={result.valid_pixel_percentage}
        color={color}
      />

      <h4 style={{ color, marginTop: 24 }}>
        Satellite Information
      </h4>

      <p>
        <strong>Satellite:</strong>{" "}
        {result.satellite}
      </p>

      <p>
        <strong>Source:</strong>{" "}
        {result.source}
      </p>

      <p>
        <strong>Scene ID:</strong>{" "}
        {result.scene_id}
      </p>

      <p>
        <strong>Acquisition Date:</strong>{" "}
        {formatDate(result.acquisition_date)}
      </p>

      <p>
        <strong>Cloud Masking:</strong>{" "}
        {result.cloud_masked
          ? "Enabled"
          : "Disabled"}
      </p>

      <CoverageDiagnostics result={result} />

      <p
        style={{
          ...styles.muted,
          marginTop: 20,
        }}
      >
        {isNDVI
          ? "NDVI represents vegetation-related spectral signals. It does not independently verify land-cover type."
          : "Positive NDWI may indicate water. Shadows and other surfaces can cause false positives."}
      </p>
    </div>
  );
}

// ==========================================
// Step 21: Change Percentage Bar
// ==========================================

function ChangePercentageBar({ statistics }) {
  const increase =
    Number(statistics.increase_percentage) || 0;

  const decrease =
    Number(statistics.decrease_percentage) || 0;

  const unchanged =
    Number(statistics.unchanged_percentage) || 0;

  return (
    <div style={{ marginTop: 25 }}>
      <h4>Change Distribution</h4>

      <div
        style={{
          display: "flex",
          height: 26,
          width: "100%",
          overflow: "hidden",
          borderRadius: 8,
          background: "#334155",
        }}
      >
        <div
          style={{
            width: percentWidth(increase),
            background: "#22c55e",
          }}
        />

        <div
          style={{
            width: percentWidth(decrease),
            background: "#ef4444",
          }}
        />

        <div
          style={{
            width: percentWidth(unchanged),
            background: "#64748b",
          }}
        />
      </div>

      <div style={styles.grid}>
        <StatCard
          title="Index Increased"
          value={`${formatNumber(increase)}%`}
          color="#4ade80"
        />

        <StatCard
          title="Index Decreased"
          value={`${formatNumber(decrease)}%`}
          color="#f87171"
        />

        <StatCard
          title="Within Threshold"
          value={`${formatNumber(unchanged)}%`}
          color="#cbd5e1"
        />
      </div>

      <p style={styles.muted}>
        Percentages are calculated from pixels
        valid in both satellite observations.
      </p>
    </div>
  );
}

// ==========================================
// Step 21: Change Detection Diagnostics
// ==========================================

function ChangeDiagnostics({ result }) {
  return (
    <details
      style={{
        ...styles.detail,
        marginTop: 24,
      }}
    >
      <summary
        style={{
          color: "#7dd3fc",
          fontWeight: "bold",
          cursor: "pointer",
        }}
      >
        Before / After Satellite Diagnostics
      </summary>

      <div style={{ marginTop: 20 }}>
        <h4 style={{ color: "#38bdf8" }}>
          Before Period Candidates
        </h4>

        <p>
          Scenes Evaluated:{" "}
          {result.before?.scenes_evaluated}
        </p>

        <CandidateSceneTable
          candidates={
            result.before?.scene_candidates || []
          }
          selectedSceneId={
            result.before?.scene_id
          }
        />

        <h4
          style={{
            color: "#38bdf8",
            marginTop: 28,
          }}
        >
          After Period Candidates
        </h4>

        <p>
          Scenes Evaluated:{" "}
          {result.after?.scenes_evaluated}
        </p>

        <CandidateSceneTable
          candidates={
            result.after?.scene_candidates || []
          }
          selectedSceneId={
            result.after?.scene_id
          }
        />
      </div>
    </details>
  );
}

// ==========================================
// Step 21: Change Detection Results
// ==========================================

function ChangeDetectionResults({ result }) {
  if (!result) return null;

  const stats = result.statistics || {};
  const before = result.before || {};
  const after = result.after || {};

  const isNDVI = result.index_type === "NDVI";

  return (
    <div
      style={{
        ...styles.panel,
        background: "#142235",
        border: "1px solid #6366f1",
      }}
    >
      <h3 style={{ color: "#c4b5fd" }}>
        🛰️ Satellite Change Detection Results
      </h3>

      <p style={styles.muted}>
        Comparing real Sentinel-2 observations
        using {result.index_type}.
      </p>

      <div style={styles.grid}>
        <StatCard
          title={`Before Mean ${result.index_type}`}
          value={formatNumber(
            stats.mean_before,
            4
          )}
          description={formatDate(
            before.acquisition_date
          )}
          color="#7dd3fc"
        />

        <StatCard
          title={`After Mean ${result.index_type}`}
          value={formatNumber(
            stats.mean_after,
            4
          )}
          description={formatDate(
            after.acquisition_date
          )}
          color="#c4b5fd"
        />

        <StatCard
          title="Mean Index Change"
          value={
            typeof stats.mean_change === "number"
              ? `${
                  stats.mean_change > 0 ? "+" : ""
                }${formatNumber(
                  stats.mean_change,
                  4
                )}`
              : "Unavailable"
          }
          description="After minus before"
          color={
            stats.mean_change > 0
              ? "#4ade80"
              : stats.mean_change < 0
                ? "#f87171"
                : "#f8fafc"
          }
        />

        <StatCard
          title="Common Valid Coverage"
          value={`${formatNumber(
            stats.common_valid_percentage
          )}%`}
          description="Pixels valid on both dates"
          color="#38bdf8"
        />
      </div>

      <ChangePercentageBar statistics={stats} />

      <h4
        style={{
          color: "#c4b5fd",
          marginTop: 26,
        }}
      >
        Detailed Change Statistics
      </h4>

      <div style={styles.grid}>
        <StatCard
          title="Increased Pixels"
          value={formatCount(
            stats.increase_pixels
          )}
          color="#4ade80"
        />

        <StatCard
          title="Decreased Pixels"
          value={formatCount(
            stats.decrease_pixels
          )}
          color="#f87171"
        />

        <StatCard
          title="Within-Threshold Pixels"
          value={formatCount(
            stats.unchanged_pixels
          )}
          color="#cbd5e1"
        />

        <StatCard
          title="Common Valid Pixels"
          value={formatCount(
            stats.common_valid_pixels
          )}
          color="#38bdf8"
        />

        <StatCard
          title="Minimum Index Change"
          value={formatNumber(
            stats.min_change,
            4
          )}
        />

        <StatCard
          title="Maximum Index Change"
          value={formatNumber(
            stats.max_change,
            4
          )}
        />
      </div>

      <CoverageBar
        title="Common Valid-Pixel Coverage"
        percentage={
          stats.common_valid_percentage
        }
        color="#818cf8"
      />

      <h4
        style={{
          color: "#c4b5fd",
          marginTop: 26,
        }}
      >
        Satellite Observations
      </h4>

      <div style={styles.grid}>
        <div style={styles.detail}>
          <h4 style={{ color: "#7dd3fc" }}>
            Before Observation
          </h4>

          <p>
            <strong>Scene:</strong>{" "}
            {before.scene_id}
          </p>

          <p>
            <strong>Acquired:</strong>{" "}
            {formatDate(
              before.acquisition_date
            )}
          </p>

          <p>
            <strong>Cloud Cover:</strong>{" "}
            {formatNumber(
              before.cloud_cover
            )}%
          </p>

          <p>
            <strong>Valid Coverage:</strong>{" "}
            {formatNumber(
              before.valid_pixel_percentage
            )}%
          </p>

          <p>
            <strong>Scenes Evaluated:</strong>{" "}
            {before.scenes_evaluated}
          </p>
        </div>

        <div style={styles.detail}>
          <h4 style={{ color: "#c4b5fd" }}>
            After Observation
          </h4>

          <p>
            <strong>Scene:</strong>{" "}
            {after.scene_id}
          </p>

          <p>
            <strong>Acquired:</strong>{" "}
            {formatDate(
              after.acquisition_date
            )}
          </p>

          <p>
            <strong>Cloud Cover:</strong>{" "}
            {formatNumber(
              after.cloud_cover
            )}%
          </p>

          <p>
            <strong>Valid Coverage:</strong>{" "}
            {formatNumber(
              after.valid_pixel_percentage
            )}%
          </p>

          <p>
            <strong>Scenes Evaluated:</strong>{" "}
            {after.scenes_evaluated}
          </p>
        </div>
      </div>

      {!isNDVI && result.water_statistics && (
        <>
          <h4
            style={{
              color: "#38bdf8",
              marginTop: 26,
            }}
          >
            💧 Possible Water Transitions
          </h4>

          <div style={styles.grid}>
            <StatCard
              title="Before Possible-Water Pixels"
              value={formatCount(
                result.water_statistics
                  .before_possible_water_pixels
              )}
              color="#7dd3fc"
            />

            <StatCard
              title="After Possible-Water Pixels"
              value={formatCount(
                result.water_statistics
                  .after_possible_water_pixels
              )}
              color="#7dd3fc"
            />

            <StatCard
              title="Gained Possible-Water Pixels"
              value={formatCount(
                result.water_statistics
                  .gained_possible_water_pixels
              )}
              color="#4ade80"
            />

            <StatCard
              title="Lost Possible-Water Pixels"
              value={formatCount(
                result.water_statistics
                  .lost_possible_water_pixels
              )}
              color="#f87171"
            />

            <StatCard
              title="Net Possible-Water Pixel Change"
              value={formatCount(
                result.water_statistics
                  .net_possible_water_pixel_change
              )}
              color="#38bdf8"
            />
          </div>

          <p style={styles.muted}>
            Possible-water transitions use an
            NDWI threshold of zero. These are
            separate from the index-difference
            threshold used for the red/green map.
          </p>
        </>
      )}

      <ChangeDiagnostics result={result} />

      <div
        style={{
          ...styles.detail,
          marginTop: 24,
          borderColor: "#6366f1",
        }}
      >
        <strong>
          Scientific Interpretation
        </strong>

        <p style={styles.muted}>
          Green pixels indicate that the selected
          spectral index increased by at least{" "}
          {formatNumber(
            result.change_threshold,
            2
          )}.
        </p>

        <p style={styles.muted}>
          Red pixels indicate that the index
          decreased by at least the same amount.
          Transparent pixels indicate
          within-threshold change or invalid data.
        </p>

        <p style={styles.muted}>
          {isNDVI
            ? "An NDVI increase is not automatically confirmed vegetation growth. Seasonal and atmospheric differences can influence results."
            : "An NDWI change is not automatically confirmed water-body expansion or contraction. Additional validation is required."}
        </p>

        <p style={styles.muted}>
          Common valid coverage measures
          usable overlapping pixels, not
          detection accuracy.
        </p>
      </div>
    </div>
  );
}

// ==========================================
// Satellite Search Gallery
// ==========================================

function SatelliteGallery({ results }) {
  if (!results?.images?.length) return null;

  return (
    <div style={{ marginTop: 28 }}>
      <h3 style={{ color: "#7dd3fc" }}>
        Satellite Search Results
      </h3>

      <p>
        <strong>Source:</strong>{" "}
        {results.source}
      </p>

      <p>
        <strong>Satellite:</strong>{" "}
        {results.satellite}
      </p>

      <p>
        <strong>Scenes Returned:</strong>{" "}
        {results.total_results}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 18,
          marginTop: 20,
        }}
      >
        {results.images.map((image, index) => (
          <div
            key={`${image.id}-${index}`}
            style={styles.detail}
          >
            <h4 style={{ color: "#38bdf8" }}>
              Sentinel-2 Scene
            </h4>

            <p>
              <strong>Scene ID:</strong>{" "}
              {image.id}
            </p>

            <p>
              <strong>Date:</strong>{" "}
              {formatDate(image.date)}
            </p>

            <p>
              <strong>Cloud Cover:</strong>{" "}
              {formatNumber(
                image.cloud_cover
              )}%
            </p>

            {image.thumbnail ? (
              <img
                src={image.thumbnail}
                alt={`Satellite preview for ${image.id}`}
                loading="lazy"
                style={{
                  width: "100%",
                  borderRadius: 8,
                  marginTop: 10,
                }}
              />
            ) : (
              <p style={styles.muted}>
                Preview unavailable
              </p>
            )}
          </div>
        ))}
      </div>

      <p
        style={{
          ...styles.muted,
          marginTop: 20,
        }}
      >
        Satellite thumbnails are catalog
        previews, not cropped NDVI/NDWI maps.
        Scene cloud cover describes the full
        satellite scene.
      </p>
    </div>
  );
}

// ==========================================
// Step 22.3: Synchronized Before / After Maps
// ==========================================

function ComparisonMapSync({ side, mapRefs, syncingRef }) {
  const map = useMap();

  useEffect(() => {
    mapRefs.current[side] = map;
    return () => {
      if (mapRefs.current[side] === map) mapRefs.current[side] = null;
    };
  }, [map, mapRefs, side]);

  useMapEvents({
    moveend() {
      if (syncingRef.current) return;
      const other = mapRefs.current[side === "before" ? "after" : "before"];
      if (!other) return;
      const center = map.getCenter();
      const zoom = map.getZoom();
      const otherCenter = other.getCenter();
      if (other.getZoom() === zoom && otherCenter.distanceTo(center) < 0.5) return;
      syncingRef.current = true;
      other.setView(center, zoom, { animate: false });
      // Leaflet fires moveend synchronously for non-animated setView.
      syncingRef.current = false;
    },
  });
  return null;
}

function extractComparisonOverlay(result, side) {
  // Accept the period-local overlay or common backend response variants.
  const period = result?.[side];
  const options = [
    period?.overlay,
    result?.[`${side}_overlay`],
    result?.overlays?.[side],
    period?.image ? period : null,
  ];
  return options.find((item) => item?.image && item?.bounds) || null;
}

function BeforeAfterComparison({ result, opacity }) {
  const mapRefs = useRef({ before: null, after: null });
  const syncingRef = useRef(false);
  if (!result) return null;

  const beforeOverlay = extractComparisonOverlay(result, "before");
  const afterOverlay = extractComparisonOverlay(result, "after");
  const bounds = beforeOverlay?.bounds || afterOverlay?.bounds;
  const before = result.before || {};
  const after = result.after || {};
  const index = result.index_type || "Index";

  return (
    <div style={{ ...styles.panel, borderColor: "#818cf8" }}>
      <h3 style={{ color: "#c4b5fd" }}>🛰️ Before-and-After Satellite Comparison</h3>
      <p style={styles.muted}>
        Two synchronized maps of real Sentinel-2 {index} observations.
        Pan or zoom either map to move the other one.
      </p>
      {!beforeOverlay || !afterOverlay ? (
        <p style={{ color: "#fbbf24" }}>
          The API responded, but matching before/after image overlays were not found.
          Check that the response includes an image and geographic bounds for each period.
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))", gap: 16 }}>
          {[
            { side: "before", title: "Before", scene: before, overlay: beforeOverlay, color: "#7dd3fc" },
            { side: "after", title: "After", scene: after, overlay: afterOverlay, color: "#c4b5fd" },
          ].map(({ side, title, scene, overlay, color }) => (
            <div key={side} style={styles.detail}>
              <h4 style={{ color }}>{title} — {formatDate(scene.acquisition_date)}</h4>
              <p style={{ ...styles.muted, overflowWrap: "anywhere" }}>{scene.scene_id || "Scene unavailable"}</p>
              <div style={{ height: 350, width: "100%", borderRadius: 8, overflow: "hidden" }}>
                <MapContainer
                  key={`${side}-${index}-${scene.scene_id || "scene"}`}
                  bounds={bounds}
                  scrollWheelZoom
                  style={{ width: "100%", height: "100%" }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <ImageOverlay
                    url={overlay.image}
                    bounds={overlay.bounds}
                    opacity={opacity / 100}
                    interactive={false}
                    zIndex={400}
                  />
                  <ComparisonMapSync side={side} mapRefs={mapRefs} syncingRef={syncingRef} />
                </MapContainer>
              </div>
              <p style={styles.muted}>
                Mean {index}: {formatNumber(scene[`mean_${index.toLowerCase()}`] ?? scene.mean_index, 4)}
                {typeof scene.valid_pixel_percentage === "number"
                  ? ` · Valid coverage: ${formatNumber(scene.valid_pixel_percentage)}%`
                  : ""}
              </p>
            </div>
          ))}
        </div>
      )}
      <p style={styles.muted}>
        Index colors represent spectral measurements, not verified land-cover categories.
        Scene dates may differ from the requested date-window endpoints.
      </p>
    </div>
  );
}

// ==========================================
// Step 23: Vegetation Transition Results
// ==========================================

function VegetationTransitionResults({ result }) {
  if (!result) return null;

  // The vegetation API returns nested statistics objects, not flat area keys.
  const stats = result.statistics || {};
  const before = result.before || {};
  const after = result.after || {};
  const loss = stats.potential_loss || {};
  const gain = stats.potential_gain || {};
  const stable = stats.stable_vegetation || {};
  const net = stats.net_vegetation_change || {};
  const hasValue = (value) => typeof value === "number" && Number.isFinite(value);
  const hectares = (value) => hasValue(value) ? `${formatNumber(value)} ha` : "Unavailable";
  const sqKm = (value) => hasValue(value) ? `${formatNumber(value, 4)} km²` : "Unavailable";
  const percent = (value) => hasValue(value) ? `${formatNumber(value)}% of common valid pixels` : "Unavailable";
  const signedHectares = (value) => hasValue(value) ? `${value > 0 ? "+" : ""}${formatNumber(value)} ha` : "Unavailable";

  return (
    <div style={{ ...styles.panel, borderColor: "#16a34a", background: "#10271f" }}>
      <h3 style={{ color: "#86efac" }}>🌿 Vegetation Loss / Gain Results</h3>
      <p style={styles.muted}>
        Potential vegetation transitions identified by comparing aligned Sentinel-2 NDVI pixels.
        Red indicates potential loss; green indicates potential gain.
      </p>
      <div style={styles.grid}>
        <StatCard title="Potential Vegetation Loss" value={hectares(loss.area_hectares)} description={`${sqKm(loss.area_sq_km)} · ${percent(loss.percentage)}`} color="#f87171" />
        <StatCard title="Potential Vegetation Gain" value={hectares(gain.area_hectares)} description={`${sqKm(gain.area_sq_km)} · ${percent(gain.percentage)}`} color="#4ade80" />
        <StatCard title="Net Vegetation Area Change" value={signedHectares(net.area_hectares)} description={`${sqKm(net.area_sq_km)} · Gain minus loss`} color="#7dd3fc" />
        <StatCard title="Stable Vegetation" value={hectares(stable.area_hectares)} description={percent(stable.percentage)} color="#c4b5fd" />
        <StatCard title="Common Valid Pixels" value={formatCount(stats.common_valid_pixels)} description={percent(stats.common_valid_percentage)} color="#38bdf8" />
        <StatCard title="NDVI Vegetation Threshold" value={formatNumber(result.vegetation_threshold ?? 0.3, 2)} color="#fbbf24" />
      </div>
      <div style={styles.grid}>
        <div style={styles.detail}>
          <h4 style={{ color: "#7dd3fc" }}>Before Observation</h4>
          <p>Date: {formatDate(before.acquisition_date)}</p>
          <p>Scene: {before.scene_id || "Unavailable"}</p>
          <p>Mean NDVI: {formatNumber(before.mean_ndvi, 4)}</p>
          <p>Vegetation area: {hectares(stats.before_vegetation?.area_hectares)}</p>
        </div>
        <div style={styles.detail}>
          <h4 style={{ color: "#c4b5fd" }}>After Observation</h4>
          <p>Date: {formatDate(after.acquisition_date)}</p>
          <p>Scene: {after.scene_id || "Unavailable"}</p>
          <p>Mean NDVI: {formatNumber(after.mean_ndvi, 4)}</p>
          <p>Vegetation area: {hectares(stats.after_vegetation?.area_hectares)}</p>
        </div>
      </div>
      {Array.isArray(result.overlay?.legend) && (
        <div style={{ ...styles.row, marginTop: 20 }}>
          {result.overlay.legend.map((entry, index) => (
            <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 16, height: 16, background: entry.color, display: "inline-block", borderRadius: 3 }} />
              {entry.label}
            </span>
          ))}
        </div>
      )}
      <p style={{ ...styles.muted, marginTop: 18 }}>
        These are NDVI-threshold classifications, not independently verified vegetation loss or growth.
        Seasonal variation, atmospheric conditions, clouds and shadows can affect results.
        Area estimates depend on valid pixel coverage and raster resolution.
      </p>
      <ChangeDiagnostics result={result} />
    </div>
  );
}

// ==========================================
// Step 24: Water-Body Transition Results
// ==========================================

function WaterTransitionResults({ result }) {
  if (!result) return null;

  const stats = result.statistics || {};
  const before = result.before || {};
  const after = result.after || {};
  const loss = stats.potential_loss || stats.potential_water_loss || {};
  const gain = stats.potential_gain || stats.potential_water_gain || {};
  const stable = stats.stable_water || stats.stable_possible_water || {};
  const net = stats.net_water_change || stats.net_water_area_change || {};
  const beforeWater = stats.before_water || stats.before_possible_water || {};
  const afterWater = stats.after_water || stats.after_possible_water || {};
  const valid = (value) => typeof value === "number" && Number.isFinite(value);
  const hectares = (value) => valid(value) ? `${formatNumber(value)} ha` : "Unavailable";
  const sqKm = (value) => valid(value) ? `${formatNumber(value, 4)} km²` : "Unavailable";
  const percent = (value) => valid(value) ? `${formatNumber(value)}% of common valid pixels` : "Unavailable";
  const signedHectares = (value) => valid(value) ? `${value > 0 ? "+" : ""}${formatNumber(value)} ha` : "Unavailable";

  return (
    <div style={{ ...styles.panel, borderColor: "#0284c7", background: "#0c2238" }}>
      <h3 style={{ color: "#7dd3fc" }}>💧 Water-Body Loss / Gain Results</h3>
      <p style={styles.muted}>
        Potential water-state transitions identified from aligned Sentinel-2 NDWI observations.
        The classification uses a water-index threshold and does not independently verify water bodies.
      </p>

      <div style={styles.grid}>
        <StatCard title="Potential Water Loss" value={hectares(loss.area_hectares)} description={`${sqKm(loss.area_sq_km)} · ${percent(loss.percentage)}`} color="#f87171" />
        <StatCard title="Potential Water Gain" value={hectares(gain.area_hectares)} description={`${sqKm(gain.area_sq_km)} · ${percent(gain.percentage)}`} color="#38bdf8" />
        <StatCard title="Net Water Area Change" value={signedHectares(net.area_hectares)} description={`${sqKm(net.area_sq_km)} · Gain minus loss`} color="#7dd3fc" />
        <StatCard title="Stable Possible Water" value={hectares(stable.area_hectares)} description={percent(stable.percentage)} color="#c4b5fd" />
        <StatCard title="Common Valid Pixels" value={formatCount(stats.common_valid_pixels)} description={percent(stats.common_valid_percentage)} color="#38bdf8" />
        <StatCard title="NDWI Water Threshold" value={formatNumber(result.water_threshold ?? 0, 2)} color="#fbbf24" />
      </div>

      <CoverageBar title="Common Valid-Pixel Coverage" percentage={stats.common_valid_percentage} color="#38bdf8" />

      <div style={styles.grid}>
        <div style={styles.detail}>
          <h4 style={{ color: "#7dd3fc" }}>Before Observation</h4>
          <p>Date: {formatDate(before.acquisition_date)}</p>
          <p>Scene: {before.scene_id || "Unavailable"}</p>
          <p>Mean NDWI: {formatNumber(before.mean_ndwi, 4)}</p>
          <p>Possible water area: {hectares(beforeWater.area_hectares)}</p>
        </div>
        <div style={styles.detail}>
          <h4 style={{ color: "#c4b5fd" }}>After Observation</h4>
          <p>Date: {formatDate(after.acquisition_date)}</p>
          <p>Scene: {after.scene_id || "Unavailable"}</p>
          <p>Mean NDWI: {formatNumber(after.mean_ndwi, 4)}</p>
          <p>Possible water area: {hectares(afterWater.area_hectares)}</p>
        </div>
      </div>

      {Array.isArray(result.overlay?.legend) && (
        <div style={{ ...styles.row, marginTop: 20 }}>
          {result.overlay.legend.map((entry, index) => (
            <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 16, height: 16, background: entry.color, display: "inline-block", borderRadius: 3 }} />
              {entry.label}
            </span>
          ))}
        </div>
      )}

      <p style={{ ...styles.muted, marginTop: 18 }}>
        NDWI-threshold changes are potential water transitions, not confirmed flooding,
        drying, or permanent water-body changes. Shadows, seasons, cloud masking and
        satellite acquisition conditions may affect results. Areas refer to valid pixels.
      </p>
      <ChangeDiagnostics result={result} />
    </div>
  );
}

// ==========================================
// Main GeoPulse Component
// ==========================================

function ChennaiMap() {
  // ----------------------------------------
  // Study Area
  // ----------------------------------------

  const [firstPoint, setFirstPoint] =
    useState(null);

  const [secondPoint, setSecondPoint] =
    useState(null);

  const [submissionStatus, setSubmissionStatus] =
    useState("");

  // ----------------------------------------
  // Standard Satellite Settings
  // ----------------------------------------

  const [startDate, setStartDate] =
    useState("2025-01-01");

  const [endDate, setEndDate] =
    useState("2025-03-31");

  const [cloudCover, setCloudCover] =
    useState(30);

  // ----------------------------------------
  // Satellite Search
  // ----------------------------------------

  const [satelliteResults, setSatelliteResults] =
    useState(null);

  const [searchStatus, setSearchStatus] =
    useState("");

  // ----------------------------------------
  // NDVI
  // ----------------------------------------

  const [ndviResults, setNdviResults] =
    useState(null);

  const [ndviStatus, setNdviStatus] =
    useState("");

  // ----------------------------------------
  // NDWI
  // ----------------------------------------

  const [ndwiResults, setNdwiResults] =
    useState(null);

  const [ndwiStatus, setNdwiStatus] =
    useState("");

  // ----------------------------------------
  // Step 21: Change Detection Settings
  // ----------------------------------------

  const [
    beforeStartDate,
    setBeforeStartDate,
  ] = useState("2024-01-01");

  const [
    beforeEndDate,
    setBeforeEndDate,
  ] = useState("2024-03-31");

  const [
    afterStartDate,
    setAfterStartDate,
  ] = useState("2025-01-01");

  const [
    afterEndDate,
    setAfterEndDate,
  ] = useState("2025-03-31");

  const [
    changeIndex,
    setChangeIndex,
  ] = useState("NDVI");

  const [
    changeThreshold,
    setChangeThreshold,
  ] = useState("0.15");

  const [
    changeResults,
    setChangeResults,
  ] = useState(null);

  const [
    changeStatus,
    setChangeStatus,
  ] = useState("");

  const [vegetationResults, setVegetationResults] = useState(null);
  const [vegetationStatus, setVegetationStatus] = useState("");
  const [waterResults, setWaterResults] = useState(null);
  const [waterStatus, setWaterStatus] = useState("");

  // Step 22: Independent before/after comparison results.
  const [comparisonResults, setComparisonResults] = useState(null);
  const [comparisonStatus, setComparisonStatus] = useState("");

  // ----------------------------------------
  // Overlay State
  // ----------------------------------------

  const [activeOverlay, setActiveOverlay] =
    useState("none");

  const [overlayVisible, setOverlayVisible] =
    useState(true);

  const [overlayOpacity, setOverlayOpacity] =
    useState(75);

  // ----------------------------------------
  // Request State
  // ----------------------------------------

  const [activeRequest, setActiveRequest] =
    useState(null);

  const requestVersion = useRef(0);
  const abortController = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    return () => {
      requestVersion.current += 1;
      abortController.current?.abort();
    };
  }, []);

  // ========================================
  // Reset Functions
  // ========================================

  function cancelCurrentRequest() {
    requestVersion.current += 1;

    abortController.current?.abort();
    abortController.current = null;

    busyRef.current = false;
    setActiveRequest(null);
  }

  function resetResults() {
    cancelCurrentRequest();

    setSatelliteResults(null);
    setSearchStatus("");

    setNdviResults(null);
    setNdviStatus("");

    setNdwiResults(null);
    setNdwiStatus("");

    setChangeResults(null);
    setChangeStatus("");
    setComparisonResults(null);
    setComparisonStatus("");
    setVegetationResults(null);
    setVegetationStatus("");
    setWaterResults(null);
    setWaterStatus("");

    setActiveOverlay("none");
    setOverlayVisible(true);
    setOverlayOpacity(75);
  }

  function resetStandardResults() {
    cancelCurrentRequest();

    setSatelliteResults(null);
    setSearchStatus("");

    setNdviResults(null);
    setNdviStatus("");

    setNdwiResults(null);
    setNdwiStatus("");

    setActiveOverlay((current) =>
      current === "ndvi" || current === "ndwi"
        ? "none"
        : current
    );
  }

  function resetChangeResults() {
    cancelCurrentRequest();
    setComparisonResults(null);
    setComparisonStatus("");
    setVegetationResults(null);
    setVegetationStatus("");
    setWaterResults(null);
    setWaterStatus("");

    setChangeResults(null);
    setChangeStatus("");

    setActiveOverlay((current) =>
      current === "change" || current === "vegetation" || current === "water"
        ? "none"
        : current
    );
  }

  // ========================================
  // Map Selection
  // ========================================

  function handleMapClick(point) {
    if (!firstPoint || secondPoint) {
      setFirstPoint(point);
      setSecondPoint(null);
    } else {
      setSecondPoint(point);
    }

    setSubmissionStatus("");
    resetResults();
  }

  function clearSelection() {
    setFirstPoint(null);
    setSecondPoint(null);

    setSubmissionStatus("");
    resetResults();
  }

  function applyStudyArea(area) {
    const error = validateStudyArea(area);

    if (error) {
      setSubmissionStatus(`Error: ${error}`);
      return;
    }

    resetResults();
    setFirstPoint({ lat: area.north, lng: area.west });
    setSecondPoint({ lat: area.south, lng: area.east });
    setSubmissionStatus("Study area updated. You can now run satellite analysis.");
  }

  const selectedArea =
    firstPoint && secondPoint
      ? {
          north: Math.max(
            firstPoint.lat,
            secondPoint.lat
          ),
          south: Math.min(
            firstPoint.lat,
            secondPoint.lat
          ),
          east: Math.max(
            firstPoint.lng,
            secondPoint.lng
          ),
          west: Math.min(
            firstPoint.lng,
            secondPoint.lng
          ),
        }
      : null;

  const rectangleBounds = selectedArea
    ? [
        [
          selectedArea.south,
          selectedArea.west,
        ],
        [
          selectedArea.north,
          selectedArea.east,
        ],
      ]
    : null;

  // ========================================
  // Validation
  // ========================================

  function validateArea() {
    if (!selectedArea) {
      return "Select two corners on the map, enter coordinates, or choose a preset.";
    }

    return validateStudyArea(selectedArea);
  }

  function validateCloudCover() {
    const cloud = Number(cloudCover);

    if (
      cloudCover === "" ||
      !Number.isFinite(cloud) ||
      cloud < 0 ||
      cloud > 100
    ) {
      return "Cloud cover must be between 0 and 100.";
    }

    return null;
  }

  function validateSettings() {
    const areaError = validateArea();

    if (areaError) return areaError;

    if (!startDate || !endDate) {
      return "Select start and end dates.";
    }

    if (startDate > endDate) {
      return "Start date must be before end date.";
    }

    return validateCloudCover();
  }

  function validateChangeSettings() {
    const areaError = validateArea();

    if (areaError) return areaError;

    if (
      !beforeStartDate ||
      !beforeEndDate ||
      !afterStartDate ||
      !afterEndDate
    ) {
      return "Select all four comparison dates.";
    }

    if (beforeStartDate > beforeEndDate) {
      return "Before start date must be on or before before end date.";
    }

    if (afterStartDate > afterEndDate) {
      return "After start date must be on or before after end date.";
    }

    if (beforeEndDate >= afterStartDate) {
      return "The before period must end before the after period starts.";
    }

    const cloudError = validateCloudCover();

    if (cloudError) return cloudError;

    const threshold = Number(changeThreshold);

    if (
      changeThreshold === "" ||
      !Number.isFinite(threshold) ||
      threshold <= 0 ||
      threshold > 2
    ) {
      return "Change threshold must be greater than 0 and at most 2.";
    }

    return null;
  }

  // ========================================
  // Request Bodies
  // ========================================

  function createRequestBody() {
    return {
      ...selectedArea,
      start_date: startDate,
      end_date: endDate,
      max_cloud_cover: Number(cloudCover),
    };
  }

  function createChangeRequestBody() {
    return {
      ...selectedArea,

      before_start_date: beforeStartDate,
      before_end_date: beforeEndDate,

      after_start_date: afterStartDate,
      after_end_date: afterEndDate,

      index_type: changeIndex,

      max_cloud_cover: Number(cloudCover),

      change_threshold: Number(changeThreshold),
    };
  }

  // ========================================
  // Backend Communication
  // ========================================

  async function postToBackend(
    endpoint,
    body,
    signal
  ) {
    const response = await fetch(
      `${API_URL}${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        `Backend returned an invalid response (HTTP ${response.status}).`
      );
    }

    if (!response.ok) {
      const detail = data.detail;

      let message = "Request failed.";

      if (typeof detail === "string") {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = detail
          .map(
            (item) =>
              item.msg || "Invalid input"
          )
          .join("; ");
      } else if (data.message) {
        message = data.message;
      }

      throw new Error(message);
    }

    if (data.status !== "success") {
      throw new Error(
        data.message || "Backend processing failed."
      );
    }

    return data;
  }

  // ========================================
  // Protected Request Runner
  // ========================================

  async function runRequest({
    name,
    endpoint,
    body,
    onStart,
    onSuccess,
    onError,
  }) {
    if (busyRef.current) return;

    busyRef.current = true;

    const version = ++requestVersion.current;

    const controller = new AbortController();

    abortController.current = controller;

    setActiveRequest(name);

    onStart?.();

    try {
      const data = await postToBackend(
        endpoint,
        body,
        controller.signal
      );

      if (version !== requestVersion.current) {
        return;
      }

      onSuccess?.(data);
    } catch (error) {
      if (
        version === requestVersion.current &&
        error.name !== "AbortError"
      ) {
        onError?.(error.message);
      }
    } finally {
      if (version === requestVersion.current) {
        busyRef.current = false;
        abortController.current = null;
        setActiveRequest(null);
      }
    }
  }

  // ========================================
  // Submit Study Area
  // ========================================

  function sendAreaToBackend() {
    const error = validateArea();

    if (error) {
      setSubmissionStatus(`Error: ${error}`);
      return;
    }

    runRequest({
      name: "study-area",
      endpoint: "/api/study-area",
      body: selectedArea,

      onStart: () => {
        setSubmissionStatus(
          "Sending study area..."
        );
      },

      onSuccess: () => {
        setSubmissionStatus(
          "Study area sent to GeoPulse backend successfully!"
        );
      },

      onError: (message) => {
        setSubmissionStatus(
          `Error: ${message}`
        );
      },
    });
  }

  // ========================================
  // Search Satellite Scenes
  // ========================================

  function searchSatelliteImages() {
    const error = validateSettings();

    if (error) {
      setSearchStatus(`Error: ${error}`);
      return;
    }

    runRequest({
      name: "search",
      endpoint: "/api/satellite/search",
      body: createRequestBody(),

      onStart: () => {
        setSatelliteResults(null);

        setSearchStatus(
          "Searching Sentinel-2 satellite catalog..."
        );
      },

      onSuccess: (data) => {
        setSatelliteResults(data);

        setSearchStatus(
          data.total_results === 0
            ? "No satellite scenes found. Try another date range."
            : `Found ${data.total_results} satellite scene(s).`
        );
      },

      onError: (message) => {
        setSearchStatus(`Error: ${message}`);
      },
    });
  }

  // ========================================
  // Analyze NDVI
  // ========================================

  function analyzeNDVI() {
    const error = validateSettings();

    if (error) {
      setNdviStatus(`Error: ${error}`);
      return;
    }

    runRequest({
      name: "ndvi",
      endpoint: "/api/satellite/ndvi",
      body: createRequestBody(),

      onStart: () => {
        setNdviResults(null);

        if (activeOverlay === "ndvi") {
          setActiveOverlay("none");
        }

        setNdviStatus(
          "Processing Sentinel-2 vegetation bands. This may take some time..."
        );
      },

      onSuccess: (data) => {
        setNdviResults(data);

        if (data.overlay?.image) {
          setActiveOverlay("ndvi");
          setOverlayVisible(true);
          setOverlayOpacity(75);

          setNdviStatus(
            "NDVI analysis completed. Vegetation overlay is displayed on the map."
          );
        } else {
          setNdviStatus(
            "NDVI analysis completed, but no overlay was returned."
          );
        }
      },

      onError: (message) => {
        setNdviStatus(`Error: ${message}`);
      },
    });
  }

  // ========================================
  // Analyze NDWI
  // ========================================

  function analyzeNDWI() {
    const error = validateSettings();

    if (error) {
      setNdwiStatus(`Error: ${error}`);
      return;
    }

    runRequest({
      name: "ndwi",
      endpoint: "/api/satellite/ndwi",
      body: createRequestBody(),

      onStart: () => {
        setNdwiResults(null);

        if (activeOverlay === "ndwi") {
          setActiveOverlay("none");
        }

        setNdwiStatus(
          "Processing Sentinel-2 Green and NIR bands. This may take some time..."
        );
      },

      onSuccess: (data) => {
        setNdwiResults(data);

        if (data.overlay?.image) {
          setActiveOverlay("ndwi");
          setOverlayVisible(true);
          setOverlayOpacity(75);

          setNdwiStatus(
            "NDWI analysis completed. Possible-water overlay is displayed on the map."
          );
        } else {
          setNdwiStatus(
            "NDWI analysis completed, but no overlay was returned."
          );
        }
      },

      onError: (message) => {
        setNdwiStatus(`Error: ${message}`);
      },
    });
  }

  // ========================================
  // Step 21: Analyze Satellite Change
  // ========================================

  function analyzeChangeDetection() {
    const error = validateChangeSettings();

    if (error) {
      setChangeStatus(`Error: ${error}`);
      return;
    }

    runRequest({
      name: "change",
      endpoint: "/api/satellite/change-detection",
      body: createChangeRequestBody(),

      onStart: () => {
        setChangeResults(null);

        if (activeOverlay === "change") {
          setActiveOverlay("none");
        }

        setChangeStatus(
          `Processing real Sentinel-2 ${changeIndex} change detection. Comparing two satellite periods...`
        );
      },

      onSuccess: (data) => {
        setChangeResults(data);

        if (
          data.overlay?.image &&
          data.overlay?.bounds
        ) {
          setActiveOverlay("change");
          setOverlayVisible(true);
          setOverlayOpacity(80);

          setChangeStatus(
            `${data.index_type} change detection completed. The red/green change overlay is displayed on the map.`
          );
        } else {
          setChangeStatus(
            "Change detection completed, but no geographic overlay was returned."
          );
        }
      },

      onError: (message) => {
        setChangeStatus(
          `Error: ${message}`
        );
      },
    });
  }

  // ========================================
  // Step 22: Before / After Comparison Request
  // ========================================

  function analyzeBeforeAfterComparison() {
    const error = validateChangeSettings();
    if (error) {
      setComparisonStatus(`Error: ${error}`);
      return;
    }

    runRequest({
      name: "comparison",
      endpoint: "/api/satellite/comparison",
      body: createChangeRequestBody(),
      onStart: () => {
        setComparisonResults(null);
        setComparisonStatus(`Generating before/after ${changeIndex} maps from Sentinel-2...`);
      },
      onSuccess: (data) => {
        setComparisonResults(data);
        setComparisonStatus("Before-and-after comparison generated. Pan or zoom either map to synchronize them.");
      },
      onError: (message) => setComparisonStatus(`Error: ${message}`),
    });
  }

  // ========================================
  // Step 23: Vegetation Transition Request
  // ========================================

  function analyzeVegetationTransitions() {
    const error = validateChangeSettings();
    if (error) {
      setVegetationStatus(`Error: ${error}`);
      return;
    }

    runRequest({
      name: "vegetation",
      endpoint: "/api/satellite/vegetation-change",
      body: { ...createChangeRequestBody(), index_type: "NDVI" },
      onStart: () => {
        setVegetationResults(null);
        if (activeOverlay === "vegetation") setActiveOverlay("none");
        setVegetationStatus("Analyzing vegetation loss and gain from Sentinel-2 NDVI observations...");
      },
      onSuccess: (data) => {
        setVegetationResults(data);
        if (data.overlay?.image && data.overlay?.bounds) {
          setActiveOverlay("vegetation");
          setOverlayVisible(true);
          setOverlayOpacity(80);
          setVegetationStatus("Vegetation analysis completed. Loss/gain overlay is displayed on the main map.");
        } else {
          setVegetationStatus("Vegetation analysis completed, but the response contains no geographic overlay.");
        }
      },
      onError: (message) => setVegetationStatus(`Error: ${message}`),
    });
  }

  // ========================================
  // Step 24: Water-Body Transition Request
  // ========================================

  function analyzeWaterTransitions() {
    const error = validateChangeSettings();
    if (error) {
      setWaterStatus(`Error: ${error}`);
      return;
    }

    runRequest({
      name: "water",
      endpoint: "/api/satellite/water-change",
      body: {
        ...createChangeRequestBody(),
        index_type: "NDWI",
        water_threshold: 0,
      },
      onStart: () => {
        setWaterResults(null);
        if (activeOverlay === "water") setActiveOverlay("none");
        setWaterStatus("Analyzing possible water loss and gain from Sentinel-2 NDWI observations...");
      },
      onSuccess: (data) => {
        setWaterResults(data);
        if (data.overlay?.image && data.overlay?.bounds) {
          setActiveOverlay("water");
          setOverlayVisible(true);
          setOverlayOpacity(80);
          setWaterStatus("Water change analysis completed. The overlay is displayed on the main map.");
        } else {
          setWaterStatus("Water change analysis completed, but no geographic overlay was returned.");
        }
      },
      onError: (message) => setWaterStatus(`Error: ${message}`),
    });
  }

  // ========================================
  // Active Overlay
  // ========================================

  const activeResults =
    activeOverlay === "ndvi"
      ? ndviResults
      : activeOverlay === "ndwi"
        ? ndwiResults
        : activeOverlay === "change"
          ? changeResults
          : activeOverlay === "vegetation"
            ? vegetationResults
            : activeOverlay === "water"
              ? waterResults
              : null;

  const overlayAvailable = Boolean(
    activeResults?.overlay?.image &&
      activeResults?.overlay?.bounds
  );

  const overlayName =
    activeOverlay === "ndvi"
      ? "NDVI Vegetation"
      : activeOverlay === "ndwi"
        ? "NDWI Possible Water"
        : activeOverlay === "vegetation"
          ? "Vegetation Loss / Gain"
          : activeOverlay === "water"
            ? "Water-Body Loss / Gain"
          : activeOverlay === "change"
          ? `${
              changeResults?.index_type || ""
            } Change Detection`
          : "None";

  const overlayColor =
    activeOverlay === "ndwi"
      ? "#38bdf8"
      : activeOverlay === "change"
        ? "#c4b5fd"
        : activeOverlay === "vegetation"
          ? "#4ade80"
          : activeOverlay === "water"
            ? "#38bdf8"
        : "#4ade80";

  const busy = activeRequest !== null;

  // ========================================
  // Render
  // ========================================

  return (
    <div style={{ color: "#f8fafc" }}>
      {/* ==================================
          INTERACTIVE MAP
      ================================== */}

      <div
        style={{
          height: 450,
          width: "100%",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <MapContainer
          center={CHENNAI}
          zoom={11}
          scrollWheelZoom
          style={{
            height: "100%",
            width: "100%",
          }}
        >
          <LayersControl position="topright">
            <BaseLayer
              checked
              name="Street Map"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            </BaseLayer>

            <BaseLayer name="Satellite View">
              <TileLayer
                attribution="Tiles &copy; Esri"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            </BaseLayer>
          </LayersControl>

          <TwoClickSelector
            onMapClick={handleMapClick}
          />

          <StudyAreaMapFocus selectedArea={selectedArea} />

          {firstPoint && (
            <Marker position={firstPoint}>
              <Popup>
                First corner selected
              </Popup>
            </Marker>
          )}

          {secondPoint && (
            <Marker position={secondPoint}>
              <Popup>
                Second corner selected
              </Popup>
            </Marker>
          )}

          {rectangleBounds && (
            <Rectangle
              bounds={rectangleBounds}
              pathOptions={{
                color: "#38bdf8",
                weight: 3,
                fillColor: "#38bdf8",
                fillOpacity: 0.08,
                interactive: false,
              }}
            />
          )}

          {overlayAvailable &&
            overlayVisible && (
              <ImageOverlay
                key={`${activeOverlay}-${
                  (activeOverlay === "change" || activeOverlay === "vegetation" || activeOverlay === "water")
                    ? `${
                        changeResults?.before?.scene_id
                      }-${
                        changeResults?.after?.scene_id
                      }`
                    : activeResults?.scene_id
                }`}
                url={activeResults.overlay.image}
                bounds={
                  activeResults.overlay.bounds
                }
                opacity={overlayOpacity / 100}
                interactive={false}
                zIndex={400}
              />
            )}
        </MapContainer>
      </div>

      {/* ==================================
          MAP LAYER CONTROLS
      ================================== */}

      {(ndviResults?.overlay?.image ||
        ndwiResults?.overlay?.image ||
        changeResults?.overlay?.image ||
        vegetationResults?.overlay?.image ||
        waterResults?.overlay?.image) && (
        <div style={styles.panel}>
          <h3 style={{ color: overlayColor }}>
            🗺️ Satellite Analysis Map Layers
          </h3>

          <p style={styles.muted}>
            Switch between vegetation, possible
            water, and satellite change detection.
            Only one overlay is shown at a time.
          </p>

          <div style={styles.row}>
            {ndviResults?.overlay?.image && (
              <ActionButton
                onClick={() => {
                  setActiveOverlay("ndvi");
                  setOverlayVisible(true);
                }}
                color={
                  activeOverlay === "ndvi"
                    ? "#15803d"
                    : "#334155"
                }
              >
                🌿 NDVI Vegetation
              </ActionButton>
            )}

            {ndwiResults?.overlay?.image && (
              <ActionButton
                onClick={() => {
                  setActiveOverlay("ndwi");
                  setOverlayVisible(true);
                }}
                color={
                  activeOverlay === "ndwi"
                    ? "#0369a1"
                    : "#334155"
                }
              >
                💧 NDWI Water
              </ActionButton>
            )}

            {vegetationResults?.overlay?.image && (
              <ActionButton
                onClick={() => { setActiveOverlay("vegetation"); setOverlayVisible(true); }}
                color={activeOverlay === "vegetation" ? "#15803d" : "#334155"}
              >
                🌿 Vegetation Loss / Gain
              </ActionButton>
            )}

            {waterResults?.overlay?.image && (
              <ActionButton
                onClick={() => { setActiveOverlay("water"); setOverlayVisible(true); }}
                color={activeOverlay === "water" ? "#0369a1" : "#334155"}
              >
                💧 Water Loss / Gain
              </ActionButton>
            )}

            {changeResults?.overlay?.image && (
              <ActionButton
                onClick={() => {
                  setActiveOverlay("change");
                  setOverlayVisible(true);
                }}
                color={
                  activeOverlay === "change"
                    ? "#6366f1"
                    : "#334155"
                }
              >
                🔄 Satellite Change
              </ActionButton>
            )}
          </div>

          {overlayAvailable && (
            <>
              <div style={styles.row}>
                <ActionButton
                  onClick={() =>
                    setOverlayVisible(
                      !overlayVisible
                    )
                  }
                  color={
                    overlayVisible
                      ? "#b45309"
                      : "#15803d"
                  }
                >
                  {overlayVisible
                    ? "👁 Hide Overlay"
                    : "👁 Show Overlay"}
                </ActionButton>

                <span>
                  Active Layer:{" "}
                  <strong>
                    {overlayName}
                  </strong>
                </span>
              </div>

              <div style={{ marginTop: 22 }}>
                <label
                  htmlFor="overlay-opacity"
                  style={{
                    fontWeight: "bold",
                  }}
                >
                  Overlay Opacity:{" "}
                  {overlayOpacity}%
                </label>

                <input
                  id="overlay-opacity"
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={overlayOpacity}
                  onChange={(event) =>
                    setOverlayOpacity(
                      Number(
                        event.target.value
                      )
                    )
                  }
                  style={{
                    width: "100%",
                    marginTop: 12,
                    cursor: "pointer",
                    accentColor: overlayColor,
                  }}
                />

                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      "space-between",
                    ...styles.muted,
                  }}
                >
                  <span>Transparent</span>
                  <span>Fully Visible</span>
                </div>
              </div>

              <h4
                style={{
                  color: overlayColor,
                  marginTop: 25,
                }}
              >
                {overlayName} Color Legend
              </h4>

              <div style={styles.row}>
                {activeResults.overlay.legend?.map(
                  (item, index) => (
                    <div
                      key={`${item.label}-${index}`}
                      style={{
                        ...styles.detail,
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        marginTop: 0,
                      }}
                    >
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          background:
                            item.color,
                          border:
                            item.color ===
                            "transparent"
                              ? "1px dashed #94a3b8"
                              : "none",
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                      />

                      <span
                        style={{
                          fontSize: 13,
                        }}
                      >
                        {item.label}
                      </span>
                    </div>
                  )
                )}
              </div>

              <div style={styles.detail}>
                <p>
                  <strong>
                    Overlay Resolution:
                  </strong>{" "}
                  {activeResults.overlay.width} ×{" "}
                  {activeResults.overlay.height}
                </p>

                {activeOverlay === "change" ? (
                  <>
                    <p>
                      <strong>
                        Before Scene:
                      </strong>{" "}
                      {
                        changeResults.before
                          ?.scene_id
                      }
                    </p>

                    <p>
                      <strong>
                        After Scene:
                      </strong>{" "}
                      {
                        changeResults.after
                          ?.scene_id
                      }
                    </p>

                    <p>
                      <strong>
                        Before Date:
                      </strong>{" "}
                      {formatDate(
                        changeResults.before
                          ?.acquisition_date
                      )}
                    </p>

                    <p>
                      <strong>
                        After Date:
                      </strong>{" "}
                      {formatDate(
                        changeResults.after
                          ?.acquisition_date
                      )}
                    </p>

                    <p>
                      <strong>
                        Common Valid Coverage:
                      </strong>{" "}
                      {formatNumber(
                        changeResults.statistics
                          ?.common_valid_percentage
                      )}%
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      <strong>
                        Satellite Scene:
                      </strong>{" "}
                      {activeResults.scene_id}
                    </p>

                    <p>
                      <strong>
                        Acquisition Date:
                      </strong>{" "}
                      {formatDate(
                        activeResults.acquisition_date
                      )}
                    </p>

                    <p>
                      <strong>
                        Valid Coverage:
                      </strong>{" "}
                      {formatNumber(
                        activeResults.valid_pixel_percentage
                      )}%
                    </p>
                  </>
                )}

                <p>
                  <strong>
                    Map Alignment:
                  </strong>{" "}
                  EPSG:4326
                </p>
              </div>

              <p style={styles.muted}>
                {activeOverlay === "ndvi"
                  ? "Green shades indicate vegetation-related NDVI values."
                  : activeOverlay === "ndwi"
                    ? "Blue shades indicate positive NDWI values associated with possible water."
                    : "Green indicates an index increase, red indicates an index decrease, and transparent areas represent within-threshold change or invalid pixels."}
              </p>
            </>
          )}
        </div>
      )}

      {/* ==================================
          STUDY AREA SELECTION
      ================================== */}

      <div
        style={{
          ...styles.panel,
          background: "#0b1220",
          textAlign: "center",
        }}
      >
        <h3 style={{ color: "#38bdf8" }}>
          📍 GeoPulse Study Area Selection
        </h3>

        {!firstPoint && (
          <p>
            Click the first corner of your
            study area on the map.
          </p>
        )}

        {firstPoint && !secondPoint && (
          <p>
            Now click the opposite corner
            to create a rectangle.
          </p>
        )}

        {selectedArea && (
          <>
            <h4>
              🛰️ Selected Analysis Area
            </h4>

            <p>
              North:{" "}
              {selectedArea.north.toFixed(6)}
            </p>

            <p>
              South:{" "}
              {selectedArea.south.toFixed(6)}
            </p>

            <p>
              East:{" "}
              {selectedArea.east.toFixed(6)}
            </p>

            <p>
              West:{" "}
              {selectedArea.west.toFixed(6)}
            </p>
          </>
        )}

        <div
          style={{
            ...styles.row,
            justifyContent: "center",
          }}
        >
          <ActionButton
            onClick={clearSelection}
            color="#0284c7"
          >
            Clear Selection
          </ActionButton>

          {selectedArea && (
            <ActionButton
              onClick={sendAreaToBackend}
              disabled={busy}
              color="#16a34a"
            >
              {activeRequest === "study-area"
                ? "Submitting..."
                : "Submit Study Area"}
            </ActionButton>
          )}
        </div>

        <StatusMessage
          message={submissionStatus}
        />
      </div>

      <StudyAreaControls
        selectedArea={selectedArea}
        onApplyArea={applyStudyArea}
        disabled={busy}
      />

      {/* ==================================
          STANDARD SATELLITE ANALYSIS
      ================================== */}

      <div style={styles.panel}>
        <h3 style={{ color: "#38bdf8" }}>
          🛰️ Sentinel-2 Satellite Analysis
        </h3>

        <p style={styles.muted}>
          Search real satellite imagery,
          analyze vegetation, and detect
          possible water bodies in the
          selected geographical area.
        </p>

        <div style={styles.grid}>
          <label>
            Start Date

            <input
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(
                  event.target.value
                );
                resetStandardResults();
              }}
              style={styles.input}
            />
          </label>

          <label>
            End Date

            <input
              type="date"
              value={endDate}
              onChange={(event) => {
                setEndDate(
                  event.target.value
                );
                resetStandardResults();
              }}
              style={styles.input}
            />
          </label>

          <label>
            Maximum Cloud Cover (%)

            <input
              type="number"
              min="0"
              max="100"
              value={cloudCover}
              onChange={(event) => {
                setCloudCover(
                  event.target.value
                );

                resetResults();
              }}
              style={styles.input}
            />
          </label>
        </div>

        <div style={styles.row}>
          <ActionButton
            onClick={searchSatelliteImages}
            disabled={!selectedArea || busy}
            color="#2563eb"
          >
            {activeRequest === "search"
              ? "Searching Satellite Catalog..."
              : "🔎 Search Satellite Images"}
          </ActionButton>

          <ActionButton
            onClick={analyzeNDVI}
            disabled={!selectedArea || busy}
            color="#15803d"
          >
            {activeRequest === "ndvi"
              ? "Analyzing Vegetation..."
              : "🌿 Analyze Vegetation (NDVI)"}
          </ActionButton>

          <ActionButton
            onClick={analyzeNDWI}
            disabled={!selectedArea || busy}
            color="#0369a1"
          >
            {activeRequest === "ndwi"
              ? "Detecting Water..."
              : "💧 Analyze Water (NDWI)"}
          </ActionButton>
        </div>

        {!selectedArea && (
          <p style={{ color: "#fbbf24" }}>
            Select two corners on the map
            before starting satellite analysis.
          </p>
        )}

        <StatusMessage message={searchStatus} />
        <StatusMessage message={ndviStatus} />
        <StatusMessage message={ndwiStatus} />

        <AnalysisResults
          result={ndviResults}
          type="ndvi"
        />

        <AnalysisResults
          result={ndwiResults}
          type="ndwi"
        />

        <SatelliteGallery
          results={satelliteResults}
        />
      </div>

      {/* ==================================
          STEP 21: CHANGE DETECTION
      ================================== */}

      <div
        style={{
          ...styles.panel,
          border: "1px solid #6366f1",
          background: "#151d35",
        }}
      >
        <h3 style={{ color: "#c4b5fd" }}>
          🔄 Satellite Change Detection
        </h3>

        <p style={styles.muted}>
          Compare real Sentinel-2 observations
          from two different periods to identify
          NDVI or NDWI spectral-index changes
          in the selected study area.
        </p>

        <h4
          style={{
            color: "#7dd3fc",
            marginTop: 24,
          }}
        >
          Before Period
        </h4>

        <div style={styles.grid}>
          <label>
            Before Start Date

            <input
              type="date"
              value={beforeStartDate}
              onChange={(event) => {
                setBeforeStartDate(
                  event.target.value
                );
                resetChangeResults();
              }}
              style={styles.input}
            />
          </label>

          <label>
            Before End Date

            <input
              type="date"
              value={beforeEndDate}
              onChange={(event) => {
                setBeforeEndDate(
                  event.target.value
                );
                resetChangeResults();
              }}
              style={styles.input}
            />
          </label>
        </div>

        <h4
          style={{
            color: "#c4b5fd",
            marginTop: 24,
          }}
        >
          After Period
        </h4>

        <div style={styles.grid}>
          <label>
            After Start Date

            <input
              type="date"
              value={afterStartDate}
              onChange={(event) => {
                setAfterStartDate(
                  event.target.value
                );
                resetChangeResults();
              }}
              style={styles.input}
            />
          </label>

          <label>
            After End Date

            <input
              type="date"
              value={afterEndDate}
              onChange={(event) => {
                setAfterEndDate(
                  event.target.value
                );
                resetChangeResults();
              }}
              style={styles.input}
            />
          </label>
        </div>

        <h4
          style={{
            color: "#c4b5fd",
            marginTop: 24,
          }}
        >
          Change Analysis Settings
        </h4>

        <div style={styles.grid}>
          <label>
            Analysis Index

            <select
              value={changeIndex}
              onChange={(event) => {
                setChangeIndex(
                  event.target.value
                );
                resetChangeResults();
              }}
              style={styles.input}
            >
              <option value="NDVI">
                NDVI — Vegetation Index
              </option>

              <option value="NDWI">
                NDWI — Water Index
              </option>
            </select>
          </label>

          <label>
            Change Threshold

            <input
              type="number"
              min="0.01"
              max="2"
              step="0.01"
              value={changeThreshold}
              onChange={(event) => {
                setChangeThreshold(
                  event.target.value
                );
                resetChangeResults();
              }}
              style={styles.input}
            />
          </label>
        </div>

        <div
          style={{
            ...styles.detail,
            marginTop: 22,
          }}
        >
          <h4>
            How the Change Threshold Works
          </h4>

          <p style={styles.muted}>
            GeoPulse calculates:
          </p>

          <p
            style={{
              fontWeight: "bold",
              color: "#c4b5fd",
            }}
          >
            Change = After Index − Before Index
          </p>

          <p>
            🟢 Green: Index increase greater
            than or equal to the threshold.
          </p>

          <p>
            🔴 Red: Index decrease greater
            than or equal to the threshold
            in magnitude.
          </p>

          <p>
            ⚪ Transparent: Smaller changes
            or invalid pixels.
          </p>

          <p style={styles.muted}>
            Default threshold: 0.15 index units.
            This is an analysis setting, not a
            scientifically validated universal
            land-cover change threshold.
          </p>

          <p style={styles.muted}>
            Maximum cloud cover for this
            comparison:{" "}
            {formatNumber(cloudCover, 0)}%.
            You can adjust it in the
            Sentinel-2 Satellite Analysis
            settings above.
          </p>
        </div>

        <div style={styles.row}>
          <ActionButton
            onClick={analyzeChangeDetection}
            disabled={!selectedArea || busy}
            color="#6366f1"
          >
            {activeRequest === "change"
              ? "Comparing Satellite Observations..."
              : `🔄 Detect ${changeIndex} Changes`}
          </ActionButton>
        </div>

        {!selectedArea && (
          <p style={{ color: "#fbbf24" }}>
            Select a study area on the map
            before running change detection.
          </p>
        )}

        <div style={{ ...styles.detail, marginTop: 22 }}>
          <h4 style={{ color: "#c4b5fd" }}>Before-and-After Maps</h4>
          <p style={styles.muted}>
            Uses the same study area, dates, cloud limit and analysis index above.
            Creates two synchronized maps instead of the red/green difference overlay.
          </p>
          <ActionButton
            onClick={analyzeBeforeAfterComparison}
            disabled={!selectedArea || busy}
            color="#7c3aed"
          >
            {activeRequest === "comparison"
              ? "Generating Comparison Maps..."
              : `🗺️ Compare Before / After ${changeIndex}`}
          </ActionButton>
          <StatusMessage message={comparisonStatus} />
        </div>

        <BeforeAfterComparison result={comparisonResults} opacity={overlayOpacity} />

        <div style={{ ...styles.detail, marginTop: 22, borderColor: "#16a34a" }}>
          <h4 style={{ color: "#86efac" }}>Vegetation Loss / Gain Detection</h4>
          <p style={styles.muted}>
            Uses the selected study area and the before/after date ranges above.
            Vegetation detection always uses NDVI, regardless of the change-detection index selector.
          </p>
          <ActionButton
            onClick={analyzeVegetationTransitions}
            disabled={!selectedArea || busy}
            color="#15803d"
          >
            {activeRequest === "vegetation"
              ? "Detecting Vegetation Transitions..."
              : "🌿 Detect Vegetation Loss / Gain"}
          </ActionButton>
          <StatusMessage message={vegetationStatus} />
        </div>
        <VegetationTransitionResults result={vegetationResults} />

        <div style={{ ...styles.detail, marginTop: 22, borderColor: "#0284c7" }}>
          <h4 style={{ color: "#7dd3fc" }}>Water-Body Loss / Gain Detection</h4>
          <p style={styles.muted}>
            Uses the selected study area and before/after dates above. Water detection
            always uses NDWI with a threshold of 0.0, regardless of the change-index selector.
          </p>
          <ActionButton
            onClick={analyzeWaterTransitions}
            disabled={!selectedArea || busy}
            color="#0369a1"
          >
            {activeRequest === "water" ? "Detecting Water Transitions..." : "💧 Detect Water Loss / Gain"}
          </ActionButton>
          <StatusMessage message={waterStatus} />
        </div>
        <WaterTransitionResults result={waterResults} />

        <StatusMessage
          message={changeStatus}
        />

        <ChangeDetectionResults
          result={changeResults}
        />

        <HistoricalDashboard
          key={selectedArea ? `${selectedArea.north}-${selectedArea.south}-${selectedArea.east}-${selectedArea.west}` : "no-area"}
          selectedArea={selectedArea}
        />

        <ReportExport
          selectedArea={selectedArea}
          ndviResults={ndviResults}
          ndwiResults={ndwiResults}
          changeResults={changeResults}
          vegetationResults={vegetationResults}
          waterResults={waterResults}
        />
      </div>
    </div>
  );
}

export default ChennaiMap;
