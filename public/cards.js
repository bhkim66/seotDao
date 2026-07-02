// 화투패 SVG 렌더링 (1~10월, 광/열끗 문양)
'use strict';

const HWATU = (() => {
  // 월별 간략 문양 (viewBox 0 0 60 90 내부에 그림)
  const motifs = {
    1: (k) => `
      ${sun(k)}
      <path d="M14 82 L20 50 L26 82 Z" fill="#1a6b30"/>
      <path d="M10 68 L20 40 L30 68 Z" fill="#238a3e"/>
      <path d="M13 55 L20 32 L27 55 Z" fill="#2da34c"/>
      <rect x="18" y="78" width="4" height="8" fill="#5d3a1a"/>`,
    2: () => `
      <path d="M12 78 Q28 60 22 30 Q20 18 26 12" stroke="#5d3a1a" stroke-width="3" fill="none"/>
      ${blossom(24, 26, '#e8467c')} ${blossom(16, 46, '#e8467c')} ${blossom(26, 60, '#d63a6e')}
      <ellipse cx="40" cy="38" rx="9" ry="6" fill="#f2b632"/>
      <circle cx="47" cy="34" r="4" fill="#f2b632"/>
      <circle cx="48.5" cy="33" r="1" fill="#222"/>
      <path d="M31 38 L22 41 L31 42 Z" fill="#3f7d2c"/>`,
    3: (k) => `
      ${sun(k, '#c9376b')}
      ${blossom(18, 60, '#f28cb0')} ${blossom(34, 70, '#f28cb0')} ${blossom(26, 76, '#e8779f')}
      ${k ? '' : blossom(30, 30, '#f28cb0') + blossom(16, 38, '#e8779f') + blossom(42, 44, '#f28cb0')}`,
    4: (y) => `
      <path d="M16 84 Q22 60 18 36" stroke="#2b2b2b" stroke-width="3" fill="none"/>
      <path d="M30 84 Q34 62 30 40" stroke="#2b2b2b" stroke-width="3" fill="none"/>
      <path d="M44 84 Q46 64 42 44" stroke="#2b2b2b" stroke-width="3" fill="none"/>
      <ellipse cx="18" cy="34" rx="5" ry="8" fill="#3a3a3a"/>
      <ellipse cx="30" cy="38" rx="5" ry="8" fill="#3a3a3a"/>
      <ellipse cx="42" cy="42" rx="5" ry="8" fill="#3a3a3a"/>
      ${y ? bird(36, 16) : ''}`,
    5: () => `
      <path d="M30 84 Q26 56 14 34" stroke="#2f8a3d" stroke-width="3.5" fill="none"/>
      <path d="M30 84 Q32 54 46 30" stroke="#2f8a3d" stroke-width="3.5" fill="none"/>
      <path d="M30 84 Q30 52 30 26" stroke="#37a049" stroke-width="3.5" fill="none"/>
      <rect x="14" y="66" width="32" height="10" rx="2" fill="#c9376b"/>
      <path d="M27 26 q3 -8 6 0 q-3 5 -6 0" fill="#8a4fd3"/>`,
    6: () => `
      <circle cx="30" cy="42" r="13" fill="#c9376b"/>
      <circle cx="30" cy="42" r="7" fill="#e8779f"/>
      <circle cx="30" cy="42" r="3" fill="#f2b632"/>
      <path d="M14 66 Q30 56 46 66 Q30 76 14 66" fill="#2f8a3d"/>
      <path d="M30 55 L30 66" stroke="#2f8a3d" stroke-width="3"/>`,
    7: (y) => `
      <path d="M16 84 Q24 58 20 38" stroke="#a33b2a" stroke-width="3" fill="none"/>
      <path d="M32 84 Q38 60 34 40" stroke="#a33b2a" stroke-width="3" fill="none"/>
      <ellipse cx="20" cy="36" rx="5" ry="8" fill="#c9376b"/>
      <ellipse cx="34" cy="38" rx="5" ry="8" fill="#c9376b"/>
      <ellipse cx="44" cy="48" rx="5" ry="8" fill="#c9376b"/>
      ${y ? boar() : ''}`,
    8: (k, y) => `
      ${k ? `<circle cx="30" cy="30" r="15" fill="#f5f0e1" stroke="#ccc7b8" stroke-width="1"/>` : ''}
      <path d="M4 70 Q30 52 56 70 L56 90 L4 90 Z" fill="#2b2b2b"/>
      ${y ? bird(20, 20) + bird(34, 14) + bird(44, 24) : ''}`,
    9: (y) => `
      <circle cx="30" cy="48" r="11" fill="#f2b632"/>
      ${petals(30, 48, 15, '#e8a51f')}
      <circle cx="30" cy="48" r="5" fill="#c9376b"/>
      <path d="M18 70 Q30 62 42 70" stroke="#2f8a3d" stroke-width="3" fill="none"/>
      ${y ? `<rect x="18" y="74" width="24" height="9" rx="2" fill="#c9376b"/><text x="30" y="81.5" font-size="7" fill="#f5f0e1" text-anchor="middle" font-weight="bold">壽</text>` : ''}`,
    10: (y) => `
      ${maple(16, 34)} ${maple(40, 26)} ${maple(30, 52)}
      ${y ? deer() : ''}`,
  };

  function sun(k, color = '#e23c3c') {
    return k
      ? `<circle cx="30" cy="26" r="14" fill="${color}"/>
         <text x="30" y="32" font-size="15" fill="#f5f0e1" text-anchor="middle" font-weight="bold" font-family="serif">光</text>`
      : '';
  }
  function blossom(x, y, c) {
    let s = '';
    for (let i = 0; i < 5; i++) {
      const a = (i * 72 - 90) * Math.PI / 180;
      s += `<circle cx="${x + Math.cos(a) * 4}" cy="${y + Math.sin(a) * 4}" r="3.2" fill="${c}"/>`;
    }
    return s + `<circle cx="${x}" cy="${y}" r="2" fill="#f2b632"/>`;
  }
  function petals(x, y, r, c) {
    let s = '';
    for (let i = 0; i < 8; i++) {
      const a = i * 45 * Math.PI / 180;
      s += `<ellipse cx="${x + Math.cos(a) * r}" cy="${y + Math.sin(a) * r}" rx="4" ry="4" fill="${c}"/>`;
    }
    return s;
  }
  function bird(x, y) {
    return `<path d="M${x - 6} ${y} Q${x} ${y - 6} ${x + 6} ${y} Q${x} ${y - 2} ${x - 6} ${y}" fill="#2b2b2b"/>`;
  }
  function boar() {
    return `<ellipse cx="30" cy="24" rx="13" ry="8" fill="#5d4a3a"/>
      <circle cx="41" cy="22" r="5" fill="#5d4a3a"/>
      <circle cx="43" cy="21" r="1.2" fill="#222"/>
      <rect x="22" y="30" width="3" height="5" fill="#4a3a2d"/>
      <rect x="34" y="30" width="3" height="5" fill="#4a3a2d"/>`;
  }
  function deer() {
    return `<ellipse cx="30" cy="74" rx="11" ry="7" fill="#b5722e"/>
      <circle cx="41" cy="68" r="4.5" fill="#b5722e"/>
      <path d="M42 64 L45 57 M43 64 L48 60" stroke="#7d4e1d" stroke-width="1.5"/>
      <circle cx="42.5" cy="67" r="1" fill="#222"/>`;
  }
  function maple(x, y) {
    return `<path d="M${x} ${y - 8} L${x + 3} ${y - 2} L${x + 8} ${y - 3} L${x + 4} ${y + 2} L${x + 6} ${y + 8} L${x} ${y + 4} L${x - 6} ${y + 8} L${x - 4} ${y + 2} L${x - 8} ${y - 3} L${x - 3} ${y - 2} Z" fill="#d64f2a"/>`;
  }

  // 카드 앞면 SVG
  function face(card) {
    const { m, k, y } = card;
    const art = m === 8 ? motifs[8](k, y) : m === 1 || m === 3 ? motifs[m](k) : motifs[m](y);
    return `<svg class="hwatu" viewBox="0 0 60 90" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="58" height="88" rx="7" fill="#f5efdc" stroke="#b8b095" stroke-width="1.5"/>
      <rect x="4" y="4" width="52" height="82" rx="5" fill="none" stroke="#d8d0b5" stroke-width="1"/>
      <g clip-path="url(#cc${m}${k ? 'k' : ''}${y ? 'y' : ''})">${art}</g>
      <clipPath id="cc${m}${k ? 'k' : ''}${y ? 'y' : ''}"><rect x="4" y="4" width="52" height="82" rx="5"/></clipPath>
      <circle cx="12" cy="12" r="8" fill="#c9376b"/>
      <text x="12" y="16" font-size="10" fill="#fff" text-anchor="middle" font-weight="bold">${m}</text>
      ${k ? `<rect x="38" y="70" width="18" height="14" rx="3" fill="#f2b632"/><text x="47" y="81" font-size="11" fill="#8a2b2b" text-anchor="middle" font-weight="bold" font-family="serif">光</text>` : ''}
    </svg>`;
  }

  // 카드 뒷면 SVG
  function back() {
    return `<svg class="hwatu" viewBox="0 0 60 90" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="58" height="88" rx="7" fill="#a41e22" stroke="#6d1114" stroke-width="2"/>
      <rect x="6" y="6" width="48" height="78" rx="5" fill="none" stroke="#c8555a" stroke-width="1.5"/>
      <circle cx="30" cy="45" r="14" fill="none" stroke="#c8555a" stroke-width="2"/>
      <circle cx="30" cy="45" r="7" fill="#c8555a"/>
      <circle cx="30" cy="45" r="3" fill="#a41e22"/>
    </svg>`;
  }

  return { face, back };
})();
