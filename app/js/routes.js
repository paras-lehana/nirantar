export const APP_VERSION = '1.2.1';   // bump with app/CHANGELOG.md
// The 8-step story (same order and names as the live Snowflake app) plus the tools.
export const TOUR = [
  { n: 1, verb: 'Spot', page: 'map', route: '#/map', title: 'Plant Map', q: 'Which machine is in trouble?', icon: 'map' },
  { n: 2, verb: 'Understand', page: 'machine', route: '#/machine', title: 'Machine Detail', q: 'What exactly is wrong, and how sure are we?', icon: 'machine' },
  { n: 3, verb: 'Prioritise', page: 'triage', route: '#/triage', title: 'Alert Triage', q: 'Is it the most urgent problem, and what does it cost?', icon: 'alert' },
  { n: 4, verb: 'Decide', page: 'whatif', route: '#/whatif', title: 'What If', q: 'Fix it now or wait for a planned window?', icon: 'decide' },
  { n: 5, verb: 'Approve', page: 'orders', route: '#/orders', title: 'Work Orders', q: 'Is the repair plan ready? Approve it.', icon: 'orders' },
  { n: 6, verb: 'Ask why', page: 'copilot', route: '#/copilot', title: 'Ask Copilot', q: 'Why is it failing, and will the AI break the rules?', icon: 'chat' },
  { n: 7, verb: 'Measure', page: 'oee', route: '#/oee', title: 'OEE', q: 'What does this mean for plant output?', icon: 'gauge' },
  { n: 8, verb: 'Verify', page: 'trust', route: '#/trust', title: 'Trust Audit', q: 'Can I trust the predictions and the actions?', icon: 'shield' },
];
// Tools are grouped in the rail and on the More page (group order = TOOL_GROUPS).
export const TOOL_GROUPS = ['Plan and act', 'Analyse', 'Run the demo', 'About'];
export const TOOLS = [
  { page: 'home', route: '#/', title: 'Home', q: 'What is happening right now, and where do I start?', icon: 'home', group: null },
  { page: 'spares', route: '#/spares', title: 'Spares & logistics', q: 'Do we have the parts, and where?', icon: 'box', group: 'Plan and act' },
  { page: 'schedule', route: '#/schedule', title: 'Maintenance calendar', q: 'When does each job happen, and what else fits in the same stop?', icon: 'calendar', group: 'Plan and act' },
  { page: 'tech', route: '#/tech', title: 'Technician view', q: 'What does the person doing the repair see on their phone?', icon: 'phone', group: 'Plan and act' },
  { page: 'reliability', route: '#/reliability', title: 'Reliability & root cause', q: 'Which failures cost the most, and why do they repeat?', icon: 'pareto', group: 'Analyse' },
  { page: 'compare', route: '#/compare', title: 'Compare machines', q: 'Is this machine different from its identical siblings?', icon: 'compare', group: 'Analyse' },
  { page: 'energy', route: '#/energy', title: 'Energy', q: 'Which machines waste power before they fail?', icon: 'bolt', group: 'Analyse' },
  { page: 'rules', route: '#/rules', title: 'Alarm rules', q: 'Where should alarm limits sit so people are not flooded?', icon: 'sliders', group: 'Analyse' },
  { page: 'roi', route: '#/roi', title: 'Business case', q: 'What is predictive maintenance worth for a plant like yours?', icon: 'rupee', group: 'Analyse' },
  { page: 'brief', route: '#/brief', title: 'Shift brief', q: 'What should the morning meeting know?', icon: 'doc', group: 'Run the demo' },
  { page: 'presenter', route: '#/presenter', title: 'Presenter', q: 'Run a live demo: inject faults, jump time.', icon: 'play', group: 'Run the demo' },
  { page: 'data', route: '#/data', title: 'Data & scenarios', q: 'Load sample data, switch scenario, export.', icon: 'data', group: 'Run the demo' },
  { page: 'judges', route: '#/judges', title: 'For judges: brief coverage', q: 'How does Nirantar meet the brief and the CoCo guidelines, and where do I see each point?', icon: 'award', group: 'About' },
  { page: 'built', route: '#/built', title: 'How it is built', q: 'What runs in Snowflake, and how was it built with CoCo?', icon: 'layers', group: 'About' },
  { page: 'help', route: '#/help', title: 'Help & glossary', q: 'What do these words and colours mean?', icon: 'help', group: 'About' },
];
export const PAGES = Object.fromEntries([...TOUR, ...TOOLS].map(p => [p.page, p]));
