import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  ReferenceLine,
} from "recharts";

const COLORS = {
  green: "#22c55e",
  red: "#ef4444",
  blue: "#38bdf8",
  purple: "#a78bfa",
  gray: "#94a3b8",
};

const styles = {
  panel: {
    marginTop: 22,
    padding: 22,
    background: "#172337",
    border: "1px solid #334155",
    borderRadius: 12,
    color: "#f8fafc",
  },
  chart: {
    width: "100%",
    height: 320,
    marginTop: 16,
  },
  muted: {
    color: "#94a3b8",
    fontSize: 13,
  },
};

function validNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatValue(value, decimals = 2) {
  const number = validNumber(value);
  return number === null ? "Unavailable" : number.toFixed(decimals);
}

function ChartPanel({ title, description, children }) {
  return (
    <section style={styles.panel}>
      <h3 style={{ color: "#7dd3fc", marginTop: 0 }}>
        {title}
      </h3>

      {description && (
        <p style={styles.muted}>{description}</p>
      )}

      <div style={styles.chart}>{children}</div>
    </section>
  );
}

function IndexComparisonChart({ result, title, indexType }) {
  if (!result) return null;

  const stats = result.statistics || {};
  const key = indexType.toLowerCase();

  const before =
    validNumber(stats[`mean_before_${key}`]) ??
    validNumber(stats.mean_before) ??
    validNumber(result.before?.[`mean_${key}`]);

  const after =
    validNumber(stats[`mean_after_${key}`]) ??
    validNumber(stats.mean_after) ??
    validNumber(result.after?.[`mean_${key}`]);

  if (before === null || after === null) return null;

  const data = [
    { period: "Before", value: before },
    { period: "After", value: after },
  ];

  return (
    <ChartPanel
      title={title}
      description={`Comparison of mean ${indexType} values from selected Sentinel-2 observations.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 20, right: 25, left: 10, bottom: 10 }}
        >
          <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
          <XAxis dataKey="period" stroke="#cbd5e1" />
          <YAxis
            stroke="#cbd5e1"
            domain={[-1, 1]}
            tickFormatter={(value) => Number(value).toFixed(2)}
          />
          <Tooltip
            formatter={(value) => [
              formatValue(value, 4),
              `Mean ${indexType}`,
            ]}
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #475569",
              color: "#f8fafc",
            }}
          />
          <ReferenceLine y={0} stroke="#64748b" />
          <Line
            type="linear"
            dataKey="value"
            name={`Mean ${indexType}`}
            stroke={COLORS.blue}
            strokeWidth={3}
            dot={{ r: 6 }}
            activeDot={{ r: 8 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

function AreaTransitionChart({ result, type }) {
  if (!result) return null;

  const stats = result.statistics || {};
  const isWater = type === "water";

  const stableKey = isWater
    ? "stable_water"
    : "stable_vegetation";

  const values = [
    {
      name: "Potential Loss",
      hectares: validNumber(stats.potential_loss?.area_hectares),
      color: COLORS.red,
    },
    {
      name: "Potential Gain",
      hectares: validNumber(stats.potential_gain?.area_hectares),
      color: COLORS.green,
    },
    {
      name: isWater ? "Stable Water" : "Stable Vegetation",
      hectares: validNumber(stats[stableKey]?.area_hectares),
      color: COLORS.blue,
    },
  ].filter((item) => item.hectares !== null);

  if (!values.length) return null;

  return (
    <ChartPanel
      title={
        isWater
          ? "💧 Water-State Transition Areas"
          : "🌿 Vegetation-State Transition Areas"
      }
      description="Area estimates in hectares, calculated from pixels valid in both observations."
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={values}
          margin={{ top: 20, right: 20, left: 10, bottom: 45 }}
        >
          <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
          <XAxis
            dataKey="name"
            stroke="#cbd5e1"
            interval={0}
            angle={-15}
            textAnchor="end"
            height={65}
            tick={{ fontSize: 11 }}
          />
          <YAxis stroke="#cbd5e1" width={65} />
          <Tooltip
            formatter={(value) => [
              `${formatValue(value)} ha`,
              "Area",
            ]}
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #475569",
              color: "#f8fafc",
            }}
          />
          <Bar
            dataKey="hectares"
            name="Area (ha)"
            radius={[5, 5, 0, 0]}
            isAnimationActive={false}
          >
            {values.map((item) => (
              <Cell key={item.name} fill={item.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

function ChangeDistributionChart({ result }) {
  if (!result) return null;

  const stats = result.statistics || {};

  const values = [
    {
      name: "Increased",
      percentage: validNumber(stats.increase_percentage),
      color: COLORS.green,
    },
    {
      name: "Decreased",
      percentage: validNumber(stats.decrease_percentage),
      color: COLORS.red,
    },
    {
      name: "Within Threshold",
      percentage: validNumber(stats.unchanged_percentage),
      color: COLORS.gray,
    },
  ].filter((item) => item.percentage !== null);

  if (!values.length) return null;

  return (
    <ChartPanel
      title={`🔄 ${result.index_type || "Index"} Change Distribution`}
      description="Percentage of common valid pixels classified by the selected index-difference threshold."
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={values}
          margin={{ top: 20, right: 20, left: 10, bottom: 45 }}
        >
          <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
          <XAxis
            dataKey="name"
            stroke="#cbd5e1"
            interval={0}
            angle={-15}
            textAnchor="end"
            height={65}
            tick={{ fontSize: 11 }}
          />
          <YAxis stroke="#cbd5e1" domain={[0, 100]} />
          <Tooltip
            formatter={(value) => [
              `${formatValue(value)}%`,
              "Common Valid Pixels",
            ]}
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #475569",
              color: "#f8fafc",
            }}
          />
          <Bar
            dataKey="percentage"
            name="Percentage"
            radius={[5, 5, 0, 0]}
            isAnimationActive={false}
          >
            {values.map((item) => (
              <Cell key={item.name} fill={item.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

export default function SatelliteCharts({
  changeResults = null,
  vegetationResults = null,
  waterResults = null,
}) {
  const hasResults =
    Boolean(changeResults) ||
    Boolean(vegetationResults) ||
    Boolean(waterResults);

  if (!hasResults) return null;

  return (
    <section
      style={{
        marginTop: 30,
        paddingTop: 20,
        borderTop: "1px solid #475569",
      }}
    >
      <h2 style={{ color: "#f8fafc" }}>
        📊 Step 25 — Satellite Analysis Charts
      </h2>

      <p style={styles.muted}>
        These charts visualize actual GeoPulse backend results.
        They are comparisons of selected observations, not
        continuous satellite time-series measurements.
      </p>

      {changeResults && (
        <>
          <IndexComparisonChart
            result={changeResults}
            title={`🛰️ Before / After ${changeResults.index_type || "Index"}`}
            indexType={changeResults.index_type || "NDVI"}
          />

          <ChangeDistributionChart result={changeResults} />
        </>
      )}

      {vegetationResults && (
        <>
          <IndexComparisonChart
            result={vegetationResults}
            title="🌿 Before / After Mean NDVI"
            indexType="NDVI"
          />

          <AreaTransitionChart
            result={vegetationResults}
            type="vegetation"
          />
        </>
      )}

      {waterResults && (
        <>
          <IndexComparisonChart
            result={waterResults}
            title="💧 Before / After Mean NDWI"
            indexType="NDWI"
          />

          <AreaTransitionChart
            result={waterResults}
            type="water"
          />
        </>
      )}

      <p style={{ ...styles.muted, marginTop: 20 }}>
        Important: NDVI and NDWI are spectral indices.
        Changes in their values do not independently confirm
        vegetation growth, deforestation, flooding, or water-body
        expansion. Seasonal and atmospheric conditions may
        influence the observations.
      </p>
    </section>
  );
}