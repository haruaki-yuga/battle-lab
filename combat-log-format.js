// 表示用の純粋関数。判定やBSの持続処理そのものは変更しない。
export function combatLogTypeLabel(type, message = '') {
    if (type === 'miss')
        return /ファンブル|行使に失敗/.test(message) ? '失敗' : '回避';
    return null;
}
// BS1個＝ラベル1個。同名・同残りターンでも統合しない。
// リプレイのステータス欄には、残りターンだけを表示する。
export function bsStatusLabel(entry) {
    const name = String(entry?.name ?? '');
    const remaining = Math.max(0, Number(entry?.remaining) || 0);
    return `${name}：${remaining}T`;
}
// BS付与ログでは、付与時に効果時間が2倍になった個体だけを明示する。
export function bsLogLabel(entry) {
    return `${bsStatusLabel(entry)}${entry?.durationDoubled === true ? '（時間2倍）' : ''}`;
}
