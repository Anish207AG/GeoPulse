
import { useState } from "react";
import { jsPDF } from "jspdf";

const panelStyle = {
  marginTop: 24,
  padding: 24,
  background: "#172337",
  border: "1px solid #334155",
  borderRadius: 12,
  color: "#f8fafc",
};

const buttonStyle = {
  border: "none",
  borderRadius: 8,
  padding: "12px 18px",
  color: "#ffffff",
  fontWeight: 700,
  cursor: "pointer",
};

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined || value === "") {
    return "Unavailable";
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number.toFixed(digits)
    : "Unavailable";
}

function formatDate(value) {
  if (!value) return "Unavailable";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toISOString().slice(0, 10);
}

function addRow(rows, section, metric, value, unit = "") {
  rows.push({
    section,
    metric,
    value:
      value === null || value === undefined || value === ""
        ? "Unavailable"
        : value,
    unit,
  });
}

function addObservation(rows, section, observation, indexType) {
  if (!observation) return;

  addRow(rows, section, "Scene ID", observation.scene_id);
  addRow(
    rows,
    section,
    "Acquisition date",
    formatDate(observation.acquisition_date)
  );
  addRow(
    rows,
    section,
    "Cloud cover",
    observation.cloud_cover ?? observation.scene_cloud_cover,
    "%"
  );
  addRow(
    rows,
    section,
    "Valid pixel coverage",
    observation.valid_pixel_percentage,
    "%"
  );

  if (indexType) {
    addRow(
      rows,
      section,
      `Mean ${indexType}`,
      observation[`mean_${indexType.toLowerCase()}`] ??
        observation.mean_index
    );
  }
}

function addArea(rows, section, name, value) {
  if (!value) return;

  addRow(rows, section, `${name} - hectares`, value.area_hectares, "ha");
  addRow(rows, section, `${name} - sq km`, value.area_sq_km, "km2");

  if (value.percentage !== undefined) {
    addRow(rows, section, `${name} - percentage`, value.percentage, "%");
  }

  if (value.pixels !== undefined) {
    addRow(rows, section, `${name} - pixels`, value.pixels);
  }
}

function buildReportRows({
  selectedArea,
  ndviResults,
  ndwiResults,
  changeResults,
  vegetationResults,
  waterResults,
}) {
  const rows = [];

  addRow(rows, "Report", "Project", "GeoPulse");
  addRow(rows, "Report", "Generated at", new Date().toISOString());
  addRow(rows, "Report", "Satellite source", "Sentinel-2 Level-2A");

  if (selectedArea) {
    for (const key of ["north", "south", "east", "west"]) {
      addRow(
        rows,
        "Study Area",
        `${key[0].toUpperCase()}${key.slice(1)}`,
        formatNumber(selectedArea[key], 6),
        "degrees"
      );
    }

    const { north, south, east, west } = selectedArea;
    const radians = Math.PI / 180;
    const areaKm2 =
      6371.0088 ** 2 *
      (east - west) *
      radians *
      (Math.sin(north * radians) - Math.sin(south * radians));

    if (Number.isFinite(areaKm2) && areaKm2 > 0) {
      addRow(rows, "Study Area", "Approximate area", areaKm2.toFixed(4), "km2");
      addRow(
        rows,
        "Study Area",
        "Approximate area",
        (areaKm2 * 100).toFixed(2),
        "ha"
      );
    }
  }

  for (const [name, result, index] of [
    ["NDVI Analysis", ndviResults, "NDVI"],
    ["NDWI Analysis", ndwiResults, "NDWI"],
  ]) {
    if (!result) continue;

    addRow(rows, name, "Scene ID", result.scene_id);
    addRow(rows, name, "Acquisition date", formatDate(result.acquisition_date));
    addRow(rows, name, `Mean ${index}`, result[`mean_${index.toLowerCase()}`]);
    addRow(rows, name, `Minimum ${index}`, result[`min_${index.toLowerCase()}`]);
    addRow(rows, name, `Maximum ${index}`, result[`max_${index.toLowerCase()}`]);
    addRow(rows, name, "Valid coverage", result.valid_pixel_percentage, "%");
    addRow(rows, name, "Cloud cover", result.scene_cloud_cover, "%");
    addRow(rows, name, "Valid pixels", result.valid_pixels);

    if (index === "NDVI") {
      addRow(rows, name, "Vegetation pixels", result.vegetation_pixels);
      addRow(rows, name, "Vegetation percentage", result.vegetation_percentage, "%");
    } else {
      addRow(rows, name, "Possible water pixels", result.water_pixels);
      addRow(rows, name, "Possible water percentage", result.water_percentage, "%");
    }
  }

  if (changeResults) {
    const stats = changeResults.statistics || {};
    const index = changeResults.index_type || "Index";
    const section = `${index} Change Detection`;

    addRow(rows, section, "Index", index);
    addRow(rows, section, "Change threshold", changeResults.change_threshold);
    addRow(rows, section, "Mean before", stats.mean_before);
    addRow(rows, section, "Mean after", stats.mean_after);
    addRow(rows, section, "Mean change", stats.mean_change);
    addRow(rows, section, "Increased pixels", stats.increase_pixels);
    addRow(rows, section, "Decreased pixels", stats.decrease_pixels);
    addRow(rows, section, "Within-threshold pixels", stats.unchanged_pixels);
    addRow(rows, section, "Increase percentage", stats.increase_percentage, "%");
    addRow(rows, section, "Decrease percentage", stats.decrease_percentage, "%");
    addRow(rows, section, "Unchanged percentage", stats.unchanged_percentage, "%");
    addRow(rows, section, "Common valid pixels", stats.common_valid_pixels);
    addRow(
      rows,
      section,
      "Common valid coverage",
      stats.common_valid_percentage,
      "%"
    );

    addObservation(rows, `${section} - Before`, changeResults.before, index);
    addObservation(rows, `${section} - After`, changeResults.after, index);
  }

  for (const [name, result, index, stableKey, beforeKey, afterKey, netKey] of [
    [
      "Vegetation Transitions",
      vegetationResults,
      "NDVI",
      "stable_vegetation",
      "before_vegetation",
      "after_vegetation",
      "net_vegetation_change",
    ],
    [
      "Water Transitions",
      waterResults,
      "NDWI",
      "stable_water",
      "before_water",
      "after_water",
      "net_water_change",
    ],
  ]) {
    if (!result) continue;

    const stats = result.statistics || {};

    addRow(
      rows,
      name,
      "Classification threshold",
      index === "NDVI"
        ? result.vegetation_threshold
        : result.water_threshold
    );

    addRow(rows, name, "Common valid pixels", stats.common_valid_pixels);
    addRow(rows, name, "Common valid coverage", stats.common_valid_percentage, "%");
    addRow(
      rows,
      name,
      `Mean ${index} change`,
      stats[`mean_${index.toLowerCase()}_change`]
    );

    addArea(rows, name, "Potential loss", stats.potential_loss);
    addArea(rows, name, "Potential gain", stats.potential_gain);
    addArea(rows, name, "Stable classified area", stats[stableKey]);
    addArea(rows, name, "Before classified area", stats[beforeKey]);
    addArea(rows, name, "After classified area", stats[afterKey]);
    addArea(rows, name, "Net area change", stats[netKey]);

    addObservation(rows, `${name} - Before`, result.before, index);
    addObservation(rows, `${name} - After`, result.after, index);
  }

  addRow(
    rows,
    "Methodology",
    "Interpretation",
    "Spectral-index changes are potential transitions, not verified land-cover changes."
  );
  addRow(
    rows,
    "Methodology",
    "Limitations",
    "Clouds, shadows, seasonal variation, and acquisition conditions can affect results."
  );
  addRow(
    rows,
    "Methodology",
    "Coverage",
    "Valid pixel coverage is not detection accuracy."
  );

  return rows;
}

function escapeCSV(value) {
  let text = String(value ?? "");

  // Prevent spreadsheet programs from interpreting values as formulas.
  if (/^[\s]*[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCSV(rows) {
  const header = ["Section", "Metric", "Value", "Unit"];
  const lines = [
    header.map(escapeCSV).join(","),
    ...rows.map((row) =>
      [row.section, row.metric, row.value, row.unit]
        .map(escapeCSV)
        .join(",")
    ),
  ];

  const blob = new Blob(["\uFEFF", lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `GeoPulse_Report_${new Date().toISOString().slice(0, 10)}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadPDF(rows) {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 18;
  const right = 18;
  const contentWidth = pageWidth - left - right;
  const bottomLimit = pageHeight - 22;

  let y = 24;
  let currentSection = "";

  function newPage() {
    pdf.addPage();
    y = 22;
    currentSection = "";
  }

  function ensureSpace(height) {
    if (y + height > bottomLimit) newPage();
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(21);
  pdf.setTextColor(22, 78, 124);
  pdf.text("GeoPulse", left, y);

  y += 9;
  pdf.setFontSize(12);
  pdf.setTextColor(65, 80, 100);
  pdf.text("Satellite Analysis Report", left, y);

  y += 12;
  pdf.setDrawColor(190, 205, 220);
  pdf.line(left, y, pageWidth - right, y);
  y += 9;

  for (const row of rows) {
    if (currentSection !== row.section) {
      ensureSpace(15);

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setTextColor(22, 78, 124);
      pdf.text(row.section, left, y);

      y += 8;
      currentSection = row.section;
    }

    const valueText =
      `${row.value}${row.unit ? ` ${row.unit}` : ""}`;

    const line = `${row.metric}: ${valueText}`;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(35, 45, 60);

    const wrapped = pdf.splitTextToSize(line, contentWidth);
    const lineHeight = 4.7;
    const blockHeight = wrapped.length * lineHeight + 3;

    ensureSpace(blockHeight);
    pdf.text(wrapped, left, y);

    y += blockHeight;
  }

  const pages = pdf.getNumberOfPages();

  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFontSize(8);
    pdf.setTextColor(120, 130, 145);

    pdf.text(
      `GeoPulse | Page ${page} of ${pages}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: "center" }
    );
  }

  pdf.save(`GeoPulse_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export default function ReportExport({
  selectedArea = null,
  ndviResults = null,
  ndwiResults = null,
  changeResults = null,
  vegetationResults = null,
  waterResults = null,
}) {
  const [status, setStatus] = useState("");

  const hasAnalysis = Boolean(
    ndviResults ||
    ndwiResults ||
    changeResults ||
    vegetationResults ||
    waterResults
  );

  const reportData = {
    selectedArea,
    ndviResults,
    ndwiResults,
    changeResults,
    vegetationResults,
    waterResults,
  };

  function handleExport(type) {
    try {
      setStatus("");

      if (!selectedArea || !hasAnalysis) {
        setStatus("Run at least one satellite analysis before exporting.");
        return;
      }

      const rows = buildReportRows(reportData);

      if (type === "pdf") {
        downloadPDF(rows);
      } else {
        downloadCSV(rows);
      }

      setStatus(`${type.toUpperCase()} report generated.`);
    } catch (error) {
      console.error("GeoPulse report export error:", error);
      setStatus(`Error: ${error.message}`);
    }
  }

  return (
    <section style={panelStyle}>
      <h2 style={{ color: "#7dd3fc", marginTop: 0 }}>
        PDF and CSV Report Export
      </h2>

      <p style={{ color: "#94a3b8", fontSize: 13 }}>
        Export the currently available satellite analysis results
        and selected study-area coordinates.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 20,
        }}
      >
        <button
          type="button"
          disabled={!selectedArea || !hasAnalysis}
          onClick={() => handleExport("pdf")}
          style={{
            ...buttonStyle,
            background: "#2563eb",
            opacity: hasAnalysis && selectedArea ? 1 : 0.5,
          }}
        >
          Download PDF Report
        </button>

        <button
          type="button"
          disabled={!selectedArea || !hasAnalysis}
          onClick={() => handleExport("csv")}
          style={{
            ...buttonStyle,
            background: "#15803d",
            opacity: hasAnalysis && selectedArea ? 1 : 0.5,
          }}
        >
          Download CSV Report
        </button>
      </div>

      {status && (
        <p
          role="status"
          style={{
            marginTop: 16,
            color: status.startsWith("Error")
              ? "#f87171"
              : "#4ade80",
          }}
        >
          {status}
        </p>
      )}

      <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 18 }}>
        Reports contain numerical measurements and metadata
        available from completed analyses. Map images and charts
        are not included in this initial export version.
        Results are not independently verified land-cover changes.
      </p>
    </section>
  );
}
