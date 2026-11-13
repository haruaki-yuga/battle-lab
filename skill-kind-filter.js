// Filter skill library by the actual recovery effect, not only the primary kind.
export function skillMatchesKind(skill, kind = 'all') {
    if (!skill || skill.kind === 'passive')
        return false;
    if (kind === 'all')
        return true;
    const effects = skill.effects || {};
    if (kind === 'hp')
        return skill.kind === 'hp' || skill.kind === 'ha' || Number(effects.extraHP) > 0;
    if (kind === 'ap')
        return skill.kind === 'ap' || skill.kind === 'ha';
    if (kind === 'cleanse')
        return skill.kind === 'cleanse' || Number(effects.bsHeal) > 0 || Number(effects.offensiveCleanse) > 0;
    return skill.kind === kind;
}
