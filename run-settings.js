let serial=0;
export function newRunSeed(){
 const random=globalThis.crypto?.randomUUID?.()||`${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
 return `${Date.now().toString(36)}-${(++serial).toString(36)}-${random.slice(0,12)}`;
}
export function normalizeSettings(config){
 config.settings.rangePolicy='text';
 config.settings.combatMode=config.settings.combatMode==='extended'?'extended':'official';
 config.settings.seedMode=config.settings.seedMode==='fixed'?'fixed':'auto';
 config.settings.seed=String(config.settings.seed||'ARCADIA-01');
 return config;
}
export function runSeed(config,explicitSeed){
 if(explicitSeed!==undefined)return String(explicitSeed);
 return config.settings.seedMode==='fixed'?String(config.settings.seed||'ARCADIA-01'):newRunSeed();
}
