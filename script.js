let countyData = [];
let iowaGeoJSON = null;

const DATA_FILE = "IA-County-clean.csv";
const COUNTY_GEOJSON_URL = "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json";

const siteSelect = document.getElementById("siteSelect");
const sexSelect = document.getElementById("sexSelect");
const outcomeSelect = document.getElementById("outcomeSelect");
const periodSelect = document.getElementById("periodSelect");
const chartDiv = document.getElementById("chart");
const tableDiv = document.getElementById("table");

async function loadData() {
  try {
    const [csvResponse, geoResponse] = await Promise.all([
      fetch(DATA_FILE),
      fetch(COUNTY_GEOJSON_URL)
    ]);

    if (!csvResponse.ok) {
      throw new Error(`Could not load ${DATA_FILE}`);
    }
    if (!geoResponse.ok) {
      throw new Error("Could not load county GeoJSON");
    }

    const csvText = await csvResponse.text();
    const geojson = await geoResponse.json();

    countyData = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true
    }).data;

    // Clean FIPS immediately
    countyData.forEach(d => {
      d.FIPS = String(d.FIPS || "").padStart(5, "0");
    });

    // Keep Iowa counties only
    iowaGeoJSON = {
      type: "FeatureCollection",
      features: geojson.features.filter(f => String(f.id).startsWith("19"))
    };

    populateFilters();
    updateView();
  } catch (err) {
    chartDiv.innerHTML = `<div class="warning">${err.message}</div>`;
    tableDiv.innerHTML = "";
    console.error(err);
  }
}

function populateFilters() {
  const sexOptions = uniqueSorted(countyData.map(d => d.Sex));
  const siteOptions = uniqueSorted(countyData.map(d => d.Site));

  sexOptions.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.text = v;
    sexSelect.add(opt);
  });

  siteOptions.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.text = v;
    siteSelect.add(opt);
  });

  // Set defaults similar to your notebook workflow if present
  if (sexOptions.includes("Both")) {
    sexSelect.value = "Both";
  } else if (sexOptions.length > 0) {
    sexSelect.value = sexOptions[0];
  }

  if (siteOptions.includes("All Sites")) {
    siteSelect.value = "All Sites";
  } else if (siteOptions.length > 0) {
    siteSelect.value = siteOptions[0];
  }

  outcomeSelect.value = "Cancer";
  periodSelect.value = "Percentage Change";
}
function cleanNumeric(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "") return null;

  const cleaned = s.replaceAll(",", "").replaceAll("%", "");
  const num = Number(cleaned);

  return Number.isFinite(num) ? num : null;
}

function findValueColumn(columns, outcome, period) {
  const lowerMap = {};
  columns.forEach(c => {
    lowerMap[c] = c.toLowerCase();
  });

  let keyword;
  if (outcome === "Cancer") {
    keyword = "rate";
  } else if (outcome === "Population") {
    keyword = "pop";
  } else {
    return [];
  }

  let matches = [];

  if (period === "2000-2011") {
    matches = columns.filter(c =>
      lowerMap[c].includes(keyword) && lowerMap[c].endsWith("_0011")
    );
  } else if (period === "2012-2022") {
    matches = columns.filter(c =>
      lowerMap[c].includes(keyword) && lowerMap[c].endsWith("_1222")
    );
  } else if (period === "Percentage Change") {
    matches = columns.filter(c =>
      lowerMap[c].includes(keyword) && lowerMap[c].includes("pc_")
    );
  }

  return matches;
}

function updateView() {
  const site = siteSelect.value;
  const sex = sexSelect.value;
  const outcome = outcomeSelect.value;
  const period = periodSelect.value;

  const filtered = countyData.filter(d => d.Site === site && d.Sex === sex);

  if (filtered.length === 0) {
    chartDiv.innerHTML = `<div class="warning">No rows found for Site = ${site}, Sex = ${sex}.</div>`;
    tableDiv.innerHTML = "";
    return;
  }

  const columns = Object.keys(filtered[0]);
  const matches = findValueColumn(columns, outcome, period);

  if (matches.length === 0) {
    chartDiv.innerHTML = `<div class="warning">No column matched Outcome = ${outcome} and Period = ${period}.</div>`;
    tableDiv.innerHTML = "";
    return;
  }

  if (matches.length > 1) {
    chartDiv.innerHTML = `<div class="warning">Multiple columns matched: ${matches.join(", ")}. Tighten the column-matching logic in script.js.</div>`;
    tableDiv.innerHTML = "";
    return;
  }

  const valueCol = matches[0];
  renderMap(filtered, valueCol, outcome, period, site, sex);
  renderTable(filtered, valueCol, outcome, period);
}

function renderMap(rows, valueCol, outcome, period, site, sex) {
  const mapRows = rows
    .map(d => ({
      FIPS: String(d.FIPS).padStart(5, "0"),
      value: cleanNumeric(d[valueCol]),
      County: d.County || d.COUNTY || d.NAME || ""
    }))
    .filter(d => d.FIPS.startsWith("19"));

  const validRows = mapRows.filter(d => d.value !== null);

  if (validRows.length === 0) {
    chartDiv.innerHTML = `<div class="warning">The selected column (${valueCol}) has no numeric values after cleaning.</div>`;
    return;
  }

  let colorscale;
  let zmin;
  let zmax;
  let colorbarTitle = `${outcome}<br>${period}`;

  if (period === "Percentage Change") {
    const maxAbs = Math.max(...validRows.map(d => Math.abs(d.value)), 1);
    zmin = -maxAbs;
    zmax = maxAbs;
    colorscale = [
      [0.0, "blue"],
      [0.5, "rgb(230,230,230)"],
      [1.0, "red"]
    ];
  } else {
    const vals = validRows.map(d => d.value);
    zmin = Math.min(...vals);
    zmax = Math.max(...vals);
    if (zmin === zmax) zmax = zmin + 1e-9;

    colorscale = [
      [0.0, "rgb(255,245,240)"],
      [0.2, "rgb(254,224,210)"],
      [0.4, "rgb(252,187,161)"],
      [0.6, "rgb(252,146,114)"],
      [0.8, "rgb(251,106,74)"],
      [1.0, "rgb(203,24,29)"]
    ];
  }

  const trace = {
    type: "choropleth",
    geojson: iowaGeoJSON,
    featureidkey: "id",
    locations: validRows.map(d => d.FIPS),
    z: validRows.map(d => d.value),
    text: validRows.map(d => d.County || d.FIPS),
    hovertemplate:
      "<b>%{text}</b><br>" +
      `${valueCol}: %{z}<br>` +
      "<extra></extra>",
    colorscale: colorscale,
    zmin: zmin,
    zmax: zmax,
    marker: {
      line: {
        color: "black",
        width: 0.5
      }
    },
    colorbar: {
      title: {
        text: colorbarTitle,
        side: "bottom"
      },
      orientation: "h",
      thickness: 18,
      len: 0.65,
      x: 0.5,
      xanchor: "center",
      y: -0.08
    }
  };

  const layout = {
    title: {
      text: `${site} | ${sex} | ${outcome} | ${period}`,
      x: 0.5
    },
    margin: { l: 10, r: 10, t: 60, b: 80 },
    geo: {
      fitbounds: "locations",
      visible: false,
      showcountries: false,
      showlakes: false,
      showland: true, 
      landcolor: "white",
      bgcolor: "white"
    },
    paper_bgcolor: "white",
    plot_bgcolor: "white"
  };

  Plotly.newPlot(chartDiv, [trace], layout, { responsive: true, displayModeBar: false });
}

function renderTable(rows, valueCol, outcome, period) {
  const tableRows = rows
    .map(d => ({
      county: d.County || d.COUNTY || d.NAME || d.FIPS,
      fips: String(d.FIPS).padStart(5, "0"),
      value: cleanNumeric(d[valueCol])
    }))
    .filter(d => d.value !== null)
    .sort((a, b) => b.value - a.value);

  let html = `<p class="table-note"><strong>Ranked counties</strong><br>${outcome} | ${period} | ${valueCol}</p>`;
  html += "<table>";
  html += "<tr><th>Rank</th><th>County</th><th>FIPS</th><th>Value</th></tr>";

  tableRows.forEach((d, i) => {
    html += `
      <tr>
        <td>${i + 1}</td>
        <td>${d.county}</td>
        <td>${d.fips}</td>
        <td>${d.value.toFixed(2)}</td>
      </tr>
    `;
  });

  html += "</table>";
  tableDiv.innerHTML = html;
}

siteSelect.onchange = updateView;
sexSelect.onchange = updateView;
outcomeSelect.onchange = updateView;
periodSelect.onchange = updateView;

loadData();
