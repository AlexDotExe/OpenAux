/**
 * Self-contained QR Code encoder (byte mode, error-correction level M).
 *
 * Pure TypeScript — no DOM, no npm dependency, no external service. Encodes a
 * string into a square boolean matrix (`true` = dark module) that a phone camera
 * can scan. The algorithm follows ISO/IEC 18004: byte-mode data encoding,
 * Reed-Solomon error correction over GF(256), function-pattern placement, and
 * data-mask selection via the standard penalty score.
 *
 * The encoder auto-picks the smallest QR version (1–10, i.e. up to 216 data
 * codewords at level M) that fits the input, which comfortably covers join URLs.
 */

export type QrModules = boolean[][];

export interface QrCode {
  /** QR version 1–10. */
  version: number;
  /** Side length in modules (`version * 4 + 17`). */
  size: number;
  /** Error-correction level. */
  ecLevel: 'M';
  /** Row-major matrix of modules; `modules[row][col]`, `true` = dark. */
  modules: QrModules;
}

const EC_LEVEL = 'M' as const;
const MIN_VERSION = 1;
const MAX_VERSION = 10;

// Error-correction characteristics for level M, indexed by version (1-based).
// Index 0 is unused. These are the canonical ISO/IEC 18004 values.
const ECC_CODEWORDS_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const NUM_ERROR_CORRECTION_BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

// Mask-selection penalty constants (ISO/IEC 18004 §8.8.2).
const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function getBit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

/** Number of module positions available for data (before dividing by 8). */
function getNumRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) {
      result -= 36;
    }
  }
  return result;
}

/** Usable data codewords for a version at level M (after reserving EC codewords). */
function getNumDataCodewords(version: number): number {
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  return (
    rawCodewords -
    ECC_CODEWORDS_PER_BLOCK_M[version]! * NUM_ERROR_CORRECTION_BLOCKS_M[version]!
  );
}

/** Char-count-indicator bit width for byte mode at a given version. */
function byteModeCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

// --- Galois field GF(256) arithmetic (primitive polynomial 0x11D) ------------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** Reed-Solomon generator polynomial coefficients for the given degree. */
function reedSolomonComputeDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) {
        result[j] = result[j]! ^ result[j + 1]!;
      }
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** Reed-Solomon error-correction codewords for a data block. */
function reedSolomonComputeRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < divisor.length; i++) {
      result[i] = result[i]! ^ gfMultiply(divisor[i]!, factor);
    }
  }
  return result;
}

// --- Bit-level data encoding -------------------------------------------------

function encodeByteSegment(bytes: Uint8Array, version: number): number[] {
  const capacityBits = getNumDataCodewords(version) * 8;
  const bits: number[] = [];
  const appendBits = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) {
      bits.push((value >>> i) & 1);
    }
  };

  appendBits(0b0100, 4); // byte-mode indicator
  appendBits(bytes.length, byteModeCountBits(version));
  for (const byte of bytes) {
    appendBits(byte, 8);
  }

  // Terminator (up to 4 zero bits) and pad to a byte boundary.
  appendBits(0, Math.min(4, capacityBits - bits.length));
  if (bits.length % 8 !== 0) {
    appendBits(0, 8 - (bits.length % 8));
  }

  // Pack bits into codewords, then pad with the standard alternating bytes.
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i + j]!;
    }
    codewords.push(byte);
  }
  const totalDataCodewords = getNumDataCodewords(version);
  for (let pad = 0xec; codewords.length < totalDataCodewords; pad ^= 0xec ^ 0x11) {
    codewords.push(pad);
  }
  return codewords;
}

/** Split data codewords into blocks, add EC codewords, and interleave. */
function addEccAndInterleave(data: number[], version: number): number[] {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS_M[version]!;
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK_M[version]!;
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const rsDiv = reedSolomonComputeDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += dat.length;
    const ecc = reedSolomonComputeRemainder(dat, rsDiv);
    if (i < numShortBlocks) {
      dat.push(0); // placeholder so every block interleaves at the same length
    }
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  const blockLen = blocks[0]!.length;
  for (let i = 0; i < blockLen; i++) {
    for (let j = 0; j < blocks.length; j++) {
      // Skip the placeholder padding byte in the short blocks.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result.push(blocks[j]![i]!);
      }
    }
  }
  return result;
}

// --- Matrix construction -----------------------------------------------------

class QrMatrix {
  readonly version: number;
  readonly size: number;
  readonly modules: boolean[][];
  private readonly isFunction: boolean[][];

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.isFunction = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
  }

  private get(x: number, y: number): boolean {
    return this.modules[y]![x]!;
  }

  private setFunctionModule(x: number, y: number, isDark: boolean): void {
    this.modules[y]![x] = isDark;
    this.isFunction[y]![x] = true;
  }

  build(dataCodewords: number[]): void {
    this.drawFunctionPatterns();
    this.drawCodewords(dataCodewords);
    this.applyBestMask();
  }

  private drawFunctionPatterns(): void {
    const size = this.size;
    // Timing patterns.
    for (let i = 0; i < size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }

    // Finder patterns (with separators) at the three corners.
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(size - 4, 3);
    this.drawFinderPattern(3, size - 4);

    // Alignment patterns.
    const alignPositions = this.alignmentPatternPositions();
    const numAlign = alignPositions.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        const isCorner =
          (i === 0 && j === 0) ||
          (i === 0 && j === numAlign - 1) ||
          (i === numAlign - 1 && j === 0);
        if (!isCorner) {
          this.drawAlignmentPattern(alignPositions[i]!, alignPositions[j]!);
        }
      }
    }

    // Reserve format and version info areas (drawn with real bits later).
    this.drawFormatBits(0);
    this.drawVersion();
  }

  private drawFinderPattern(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  private drawAlignmentPattern(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  private alignmentPatternPositions(): number[] {
    if (this.version === 1) {
      return [];
    }
    const numAlign = Math.floor(this.version / 7) + 2;
    const step = Math.ceil((this.size - 13) / (numAlign * 2 - 2)) * 2;
    const result: number[] = [6];
    for (let pos = this.size - 7; result.length < numAlign; pos -= step) {
      result.splice(1, 0, pos);
    }
    return result;
  }

  private drawFormatBits(mask: number): void {
    const size = this.size;
    const data = (0 << 3) | mask; // EC level M ordinal for format info is 0
    let rem = data;
    for (let i = 0; i < 10; i++) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++) {
      this.setFunctionModule(8, i, getBit(bits, i));
    }
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) {
      this.setFunctionModule(14 - i, 8, getBit(bits, i));
    }

    for (let i = 0; i < 8; i++) {
      this.setFunctionModule(size - 1 - i, 8, getBit(bits, i));
    }
    for (let i = 8; i < 15; i++) {
      this.setFunctionModule(8, size - 15 + i, getBit(bits, i));
    }
    this.setFunctionModule(8, size - 8, true); // always-dark module
  }

  private drawVersion(): void {
    if (this.version < 7) {
      return;
    }
    let rem = this.version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  }

  private drawCodewords(data: number[]): void {
    const size = this.size;
    let i = 0; // bit index into the data
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) {
        right = 5;
      }
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!this.isFunction[y]![x] && i < data.length * 8) {
            this.modules[y]![x] = getBit(data[i >>> 3]!, 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  private applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y]![x]) {
          continue;
        }
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = (((x * y) % 2) + ((x * y) % 3)) === 0;
            break;
          case 6:
            invert = ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0;
            break;
          case 7:
            invert = ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
            break;
          default:
            throw new Error('unreachable mask');
        }
        if (invert) {
          this.modules[y]![x] = !this.modules[y]![x];
        }
      }
    }
  }

  private applyBestMask(): void {
    let bestMask = 0;
    let minPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      this.applyMask(mask);
      this.drawFormatBits(mask);
      const penalty = this.penaltyScore();
      if (penalty < minPenalty) {
        minPenalty = penalty;
        bestMask = mask;
      }
      this.applyMask(mask); // undo (XOR mask is its own inverse)
    }
    this.applyMask(bestMask);
    this.drawFormatBits(bestMask);
  }

  private penaltyScore(): number {
    const size = this.size;
    let result = 0;

    // Rule 1 (rows) + rule 3 (finder-like patterns in rows).
    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runLen = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        if (this.get(x, y) === runColor) {
          runLen++;
          if (runLen === 5) {
            result += PENALTY_N1;
          } else if (runLen > 5) {
            result++;
          }
        } else {
          this.finderPenaltyAddHistory(runLen, runHistory);
          if (!runColor) {
            result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          }
          runColor = this.get(x, y);
          runLen = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runLen, runHistory) * PENALTY_N3;
    }

    // Rule 1 (columns) + rule 3 (finder-like patterns in columns).
    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runLen = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        if (this.get(x, y) === runColor) {
          runLen++;
          if (runLen === 5) {
            result += PENALTY_N1;
          } else if (runLen > 5) {
            result++;
          }
        } else {
          this.finderPenaltyAddHistory(runLen, runHistory);
          if (!runColor) {
            result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          }
          runColor = this.get(x, y);
          runLen = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runLen, runHistory) * PENALTY_N3;
    }

    // Rule 2: 2x2 blocks of one color.
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const color = this.get(x, y);
        if (
          color === this.get(x + 1, y) &&
          color === this.get(x, y + 1) &&
          color === this.get(x + 1, y + 1)
        ) {
          result += PENALTY_N2;
        }
      }
    }

    // Rule 4: proportion of dark modules.
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (this.get(x, y)) {
          dark++;
        }
      }
    }
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  }

  private finderPenaltyCountPatterns(runHistory: number[]): number {
    const n = runHistory[1]!;
    const core =
      n > 0 &&
      runHistory[2] === n &&
      runHistory[3] === n * 3 &&
      runHistory[4] === n &&
      runHistory[5] === n;
    return (
      (core && runHistory[0]! >= n * 4 && runHistory[6]! >= n ? 1 : 0) +
      (core && runHistory[6]! >= n * 4 && runHistory[0]! >= n ? 1 : 0)
    );
  }

  private finderPenaltyTerminateAndCount(
    currentRunColor: boolean,
    currentRunLength: number,
    runHistory: number[],
  ): number {
    let runLen = currentRunLength;
    if (currentRunColor) {
      this.finderPenaltyAddHistory(runLen, runHistory);
      runLen = 0;
    }
    runLen += this.size;
    this.finderPenaltyAddHistory(runLen, runHistory);
    return this.finderPenaltyCountPatterns(runHistory);
  }

  private finderPenaltyAddHistory(currentRunLength: number, runHistory: number[]): void {
    let runLen = currentRunLength;
    if (runHistory[0] === 0) {
      runLen += this.size; // add the implicit white border to the first run
    }
    runHistory.pop();
    runHistory.unshift(runLen);
  }
}

/** Choose the smallest supported version whose level-M capacity fits `bytes`. */
function chooseVersion(byteLength: number): number {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const capacityBits = getNumDataCodewords(version) * 8;
    const neededBits = 4 + byteModeCountBits(version) + 8 * byteLength;
    if (neededBits <= capacityBits) {
      return version;
    }
  }
  throw new Error(
    `Data too long for QR versions ${MIN_VERSION}-${MAX_VERSION} at EC level M (${byteLength} bytes)`,
  );
}

/**
 * Encode `text` (UTF-8, byte mode) into a QR code at error-correction level M.
 * Pure and deterministic: the same input always yields the same matrix.
 */
export function encodeQr(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const dataCodewords = encodeByteSegment(bytes, version);
  const allCodewords = addEccAndInterleave(dataCodewords, version);

  const matrix = new QrMatrix(version);
  matrix.build(allCodewords);

  return {
    version,
    size: matrix.size,
    ecLevel: EC_LEVEL,
    modules: matrix.modules,
  };
}

/**
 * Build an SVG `path` "d" attribute that draws every dark module as a 1x1 rect,
 * offset by `quietZone` modules. The SVG viewBox should be
 * `size + quietZone * 2` on each side. Returns an empty string if no dark
 * modules exist.
 */
export function modulesToSvgPath(modules: QrModules, quietZone = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < modules.length; y++) {
    const row = modules[y]!;
    for (let x = 0; x < row.length; x++) {
      if (row[x]) {
        parts.push(`M${x + quietZone} ${y + quietZone}h1v1h-1z`);
      }
    }
  }
  return parts.join('');
}
