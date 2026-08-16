// Configuration manager for payment checker
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'scenarios.json');
const RESULTS_DIR = path.join(__dirname, '..', 'results');

// Ensure results directory exists
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function loadScenarios() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(data);
    }
    return [];
  } catch (err) {
    console.error('Error loading scenarios:', err.message);
    return [];
  }
}

function saveScenarios(scenarios) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(scenarios, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error saving scenarios:', err.message);
    return false;
  }
}

function addScenario(scenario) {
  const scenarios = loadScenarios();
  scenario.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  scenario.createdAt = new Date().toISOString();
  scenarios.push(scenario);
  saveScenarios(scenarios);
  return scenario;
}

function updateScenario(id, updates) {
  const scenarios = loadScenarios();
  const idx = scenarios.findIndex(s => s.id === id);
  if (idx === -1) return null;
  scenarios[idx] = { ...scenarios[idx], ...updates, id, updatedAt: new Date().toISOString() };
  saveScenarios(scenarios);
  return scenarios[idx];
}

function deleteScenario(id) {
  const scenarios = loadScenarios();
  const filtered = scenarios.filter(s => s.id !== id);
  if (filtered.length === scenarios.length) return false;
  saveScenarios(filtered);
  return true;
}

function saveResult(scenarioName, result) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}_${scenarioName.replace(/[^a-z0-9]/gi, '_')}.json`;
  const filepath = path.join(RESULTS_DIR, filename);
  
  // Remove large screenshot from file storage to save space
  const { screenshot, ...rest } = result;
  fs.writeFileSync(filepath, JSON.stringify(rest, null, 2), 'utf-8');
  
  return { filepath, filename };
}

function getResults(limit = 50) {
  try {
    const files = fs.readdirSync(RESULTS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);
    
    return files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf-8'));
      return { filename: f, ...data };
    });
  } catch (err) {
    return [];
  }
}

module.exports = {
  loadScenarios,
  saveScenarios,
  addScenario,
  updateScenario,
  deleteScenario,
  saveResult,
  getResults
};
