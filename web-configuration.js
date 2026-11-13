// Keep historical saved settings usable after removing deprecated Web-only controls.
export function cleanWebConfiguration(config) {
    if (!config || typeof config !== 'object')
        return config;
    if (config.settings)
        config.settings.combatMode = 'official';
    if (!Array.isArray(config.skills) || !Array.isArray(config.units))
        return config;
    const retired = new Set(config.skills.filter(skill => skill?.kind === 'passive').map(skill => skill.id));
    config.skills = config.skills.filter(skill => skill?.kind !== 'passive');
    for (const unit of config.units) {
        delete unit.reactiveKite;
        delete unit.reactiveKiteLimit;
        if (Array.isArray(unit.skills))
            unit.skills = unit.skills.filter(id => !retired.has(id));
        for (const rule of unit.rules || []) {
            if (rule.action === 'skill' && retired.has(rule.skillId)) {
                rule.action = 'carry';
                rule.skillId = '';
                rule.target = 'self';
                rule.autoMove = false;
            }
        }
    }
    return config;
}
