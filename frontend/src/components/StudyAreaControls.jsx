import { useEffect, useState } from "react";

export const MAX_STUDY_AREA_KM2 = 250;

const PRESETS = [
  {
    name: "Chennai — Small Demo Area",
    north: 13.09,
    south: 13.06,
    east: 80.29,
    west: 80.25,
  },
  {
    name: "Chennai — Southern Demo Area",
    north: 12.98,
    south: 12.93,
    east: 80.25,
    west: 80.19,
  },
  {
    name: "Chennai — Western Demo Area",
    north: 13.09,
    south: 13.04,
    east: 80.21,
    west: 80.15,
  },
];

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0f172a",
  color: "#f8fafc",
  border: "1px solid #475569",
  borderRadius: 8,
  padding: 10,
  marginTop: 7,
};

const buttonStyle = {
  padding: "11px 16px",
  border: "none",
  borderRadius: 8,
  color: "#ffffff",
  fontWeight: "bold",
  cursor: "pointer",
};

function calculateAreaKm2(area) {
  if (!area) return null;

  const north = Number(area.north);
  const south = Number(area.south);
  const east = Number(area.east);
  const west = Number(area.west);

  if (![north, south, east, west].every(Number.isFinite)) {
    return null;
  }

  if (north <= south || east <= west) return null;

  const radians = Math.PI / 180;
  const radiusKm = 6371.0088;

  return (
    radiusKm ** 2 *
    (east - west) *
    radians *
    (Math.sin(north * radians) - Math.sin(south * radians))
  );
}

export function validateStudyArea(area) {
  if (!area) {
    return "Select a study area first.";
  }

  const { north, south, east, west } = area;

  if (
    [north, south, east, west].some(
      (value) =>
        value === "" ||
        value === null ||
        value === undefined ||
        !Number.isFinite(Number(value))
    )
  ) {
    return "Enter valid numbers for all four coordinates.";
  }

  const n = Number(north);
  const s = Number(south);
  const e = Number(east);
  const w = Number(west);

  if (n > 90 || s < -90 || e > 180 || w < -180) {
    return "Latitude must be between -90 and 90, and longitude between -180 and 180.";
  }

  if (n <= s || e <= w) {
    return "North must exceed South, and East must exceed West.";
  }

  const size = calculateAreaKm2({ north: n, south: s, east: e, west: w });

  if (!Number.isFinite(size) || size <= 0) {
    return "The selected rectangle must have a positive area.";
  }

  if (size > MAX_STUDY_AREA_KM2) {
    return `Study area is too large (${size.toFixed(2)} km²). Maximum allowed in GeoPulse is ${MAX_STUDY_AREA_KM2} km².`;
  }

  return null;
}

export default function StudyAreaControls({
  selectedArea,
  onApplyArea,
  disabled = false,
}) {
  const [draft, setDraft] = useState({
    north: "",
    south: "",
    east: "",
    west: "",
  });

  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraft({
      north: selectedArea?.north?.toFixed(6) ?? "",
      south: selectedArea?.south?.toFixed(6) ?? "",
      east: selectedArea?.east?.toFixed(6) ?? "",
      west: selectedArea?.west?.toFixed(6) ?? "",
    });
    setMessage("");
  }, [
    selectedArea?.north,
    selectedArea?.south,
    selectedArea?.east,
    selectedArea?.west,
  ]);

  const draftArea = {
    north: draft.north,
    south: draft.south,
    east: draft.east,
    west: draft.west,
  };

  const currentSize = calculateAreaKm2(selectedArea);
  const draftError = validateStudyArea(draftArea);

  function applyArea(area) {
    const error = validateStudyArea(area);

    if (error) {
      setMessage(`Error: ${error}`);
      return;
    }

    onApplyArea({
      north: Number(area.north),
      south: Number(area.south),
      east: Number(area.east),
      west: Number(area.west),
    });

    setMessage("Study area applied successfully.");
  }

  function handlePreset(event) {
    const preset = PRESETS.find(
      (item) => item.name === event.target.value
    );

    if (!preset) return;

    setDraft({
      north: String(preset.north),
      south: String(preset.south),
      east: String(preset.east),
      west: String(preset.west),
    });

    applyArea(preset);
  }

  return (
    <section
      style={{
        marginTop: 22,
        padding: 24,
        background: "#172337",
        border: "1px solid #334155",
        borderRadius: 12,
        color: "#f8fafc",
      }}
    >
      <h3 style={{ color: "#7dd3fc", marginTop: 0 }}>
        📍Advanced Study Area Selection
      </h3>

      <p style={{ color: "#94a3b8", fontSize: 13 }}>
        Continue selecting two corners on the map, enter coordinates
        manually, or use a Chennai demonstration preset.
      </p>

      {currentSize !== null && (
        <div
          style={{
            background: "#0b1220",
            border: "1px solid #334155",
            borderRadius: 8,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <strong>Currently Selected Area</strong>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 14,
              marginTop: 14,
            }}
          >
            <div>
              <span style={{ color: "#94a3b8" }}>
                Approximate Area
              </span>
              <h2 style={{ color: "#38bdf8" }}>
                {currentSize.toFixed(2)} km²
              </h2>
            </div>

            <div>
              <span style={{ color: "#94a3b8" }}>
                Approximate Area
              </span>
              <h2 style={{ color: "#4ade80" }}>
                {(currentSize * 100).toFixed(2)} ha
              </h2>
            </div>
          </div>

          {currentSize > MAX_STUDY_AREA_KM2 && (
            <p style={{ color: "#fbbf24" }}>
              ⚠️ This selection exceeds the GeoPulse frontend
              area limit. Choose a smaller rectangle.
            </p>
          )}
        </div>
      )}

      <label style={{ display: "block" }}>
        <strong>Quick Selection Presets</strong>

        <select
          defaultValue=""
          onChange={handlePreset}
          disabled={disabled}
          style={inputStyle}
        >
          <option value="">Choose a demonstration area</option>
          {PRESETS.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>

      <p style={{ color: "#94a3b8", fontSize: 12 }}>
        Presets are illustrative geographic rectangles, not
        official administrative boundaries.
      </p>

      <h4 style={{ color: "#c4b5fd", marginTop: 24 }}>
        Manual Coordinate Entry
      </h4>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 16,
        }}
      >
        {[
          ["north", "North Latitude"],
          ["south", "South Latitude"],
          ["east", "East Longitude"],
          ["west", "West Longitude"],
        ].map(([key, label]) => (
          <label key={key}>
            {label}

            <input
              type="number"
              step="any"
              value={draft[key]}
              disabled={disabled}
              onChange={(event) => {
                setDraft((previous) => ({
                  ...previous,
                  [key]: event.target.value,
                }));
                setMessage("");
              }}
              placeholder={label}
              style={inputStyle}
            />
          </label>
        ))}
      </div>

      <div style={{ marginTop: 20 }}>
        <button
          type="button"
          disabled={disabled || Boolean(draftError)}
          onClick={() => applyArea(draftArea)}
          style={{
            ...buttonStyle,
            background: "#2563eb",
            opacity: disabled || draftError ? 0.55 : 1,
          }}
        >
          Apply Coordinates to Map
        </button>
      </div>

      {draftError && (
        <p style={{ color: "#fbbf24", fontSize: 13 }}>
          {draftError}
        </p>
      )}

      {message && (
        <p
          role="status"
          style={{
            color: message.startsWith("Error")
              ? "#f87171"
              : "#4ade80",
          }}
        >
          {message}
        </p>
      )}

      <p
        style={{
          color: "#94a3b8",
          fontSize: 12,
          marginTop: 20,
        }}
      >
        Area is estimated from the latitude/longitude rectangle
        on a spherical Earth. Maximum frontend selection:
        {" "}{MAX_STUDY_AREA_KM2} km². This limit is a
        conservative GeoPulse setting, not a satellite-data
        provider limit.
      </p>
    </section>
  );
}