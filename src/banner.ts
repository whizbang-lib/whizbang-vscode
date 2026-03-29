import {
  BANNER_WIDTH, BANNER_HEIGHT, BACKGROUND_R, BACKGROUND_G, BACKGROUND_B,
  plainBanner, colorDataBase64
} from './bannerData.generated';

const ESC = '\x1b';
const BACKGROUND = `${ESC}[48;2;${BACKGROUND_R};${BACKGROUND_G};${BACKGROUND_B}m`;
const RESET = `${ESC}[0m`;
const STAR_CHARS = ['.', '\u00B7', '\u2219', '*', '\u22C5', '\u2726'];

/**
 * Returns the plain text banner lines (no ANSI codes).
 */
export function getPlainBanner(): string[] {
  return plainBanner;
}

/**
 * Renders the banner with true-color ANSI escape codes.
 * Includes random star decorations in background spaces.
 */
export function renderAnsiBanner(): string {
  const colorBytes = Buffer.from(colorDataBase64, 'base64');
  const lines: string[] = [''];

  for (let row = 0; row < BANNER_HEIGHT; row++) {
    const line = plainBanner[row];
    let result = '';
    let col = 0;

    while (col < BANNER_WIDTH) {
      const idx = (row * BANNER_WIDTH + col) * 3;
      const r = colorBytes[idx];
      const g = colorBytes[idx + 1];
      const b = colorBytes[idx + 2];

      // Find run of same color
      const runStart = col;
      while (col < BANNER_WIDTH) {
        const nextIdx = (row * BANNER_WIDTH + col) * 3;
        if (colorBytes[nextIdx] !== r || colorBytes[nextIdx + 1] !== g || colorBytes[nextIdx + 2] !== b) {
          break;
        }
        col++;
      }

      const text = line.substring(runStart, col);
      const isBg = r === BACKGROUND_R && g === BACKGROUND_G && b === BACKGROUND_B;

      if (isBg) {
        // Background segment — sprinkle stars
        for (const ch of text) {
          if (ch === ' ' && Math.random() < 1 / 12) {
            const brightness = Math.floor(Math.random() * 36) + 220;
            const star = STAR_CHARS[Math.floor(Math.random() * STAR_CHARS.length)];
            result += `${BACKGROUND}${ESC}[38;2;${brightness};${brightness + 5};${brightness + 10}m${star}${RESET}`;
          } else {
            result += `${BACKGROUND}${ESC}[38;2;${r};${g};${b}m${ch}${RESET}`;
          }
        }
      } else {
        result += `${BACKGROUND}${ESC}[38;2;${r};${g};${b}m${text}${RESET}`;
      }
    }

    // EOL padding
    result += `${BACKGROUND}  ${RESET}`;
    lines.push(result);
  }

  lines.push('');
  return lines.join('\r\n');
}
