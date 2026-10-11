/**
 * The constitution as a PDF, laid out the way the Word file always was.
 *
 * Letter paper, one-inch margins, Carlito (the open twin of Calibri) at 11
 * points. "Revision N" and the date sit in the top left of every page, the
 * page number in the bottom right. The front page carries the champion, the
 * commissioner's letter, and the member table; the rules follow as a numbered
 * outline; the appendices, the amendment history, and a signature page close
 * it. Nothing here is interactive, so it reads the same on a phone, a laptop,
 * or paper.
 *
 * Everything rendered comes from the frozen version handed in. The server
 * never reaches past it for a newer rule.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import {
  formatWhen,
  franchiseIndex,
  memberTotals,
  rankRecords,
  seasonRows,
  type LeagueHistory,
} from '../../src/lib/league/history.js';
import {
  buildRulebookIndex,
  groupByArticle,
  resolveRefs,
  type Rulebook,
  type RulebookEntry,
  type RulebookIndex,
  type RulebookTable,
} from '../../src/lib/league/rulebook.js';
import {
  championBlock,
  longDate,
  memberRows,
  parseLetter,
  RULES_INTRO,
  shortDate,
  signatureRows,
  type LetterRun,
  type TeamName,
} from '../../src/lib/league/rulebookFront.js';
import {
  ACKNOWLEDGEMENT,
  type RulebookSignature,
} from '../../src/lib/league/rulebookSignatures.js';

export interface RulebookPdfInput {
  book: Rulebook;
  /** Null while the book is still a working draft. */
  versionId: string | null;
  publishedAt: string | null;
  /** True when this frozen version is no longer the one in force. */
  superseded: boolean;
  history: LeagueHistory;
  teams: TeamName[];
  signatures: RulebookSignature[];
  versions: Array<{ revision: number; publishedAt: string; publishedBy: string; notes: string }>;
  /** Full name of the member this copy is for, if anyone. */
  copyFor?: string | null;
  /** Today, for an unpublished draft's date line. Injected so tests are stable. */
  now?: string;
}

// ─── Fonts ───────────────────────────────────────────────────────────────────

// The .woff files, not .woff2: fontkit cannot subset a woff2 glyf table and
// throws at doc.end(). Carlito is Calibri's open, metric-matched twin (OFL).
const FONT_FILES = {
  body: 'carlito-latin-400-normal.woff',
  bold: 'carlito-latin-700-normal.woff',
  italic: 'carlito-latin-400-italic.woff',
  boldItalic: 'carlito-latin-700-italic.woff',
} as const;

/**
 * Fonts and the trophy live in server/assets, which vercel.json ships with
 * the function. On Vercel the bundle runs from the project root, so cwd finds
 * them; locally and in tests the module's own path does.
 */
function assetDir(...parts: string[]): string {
  const fromCwd = path.join(process.cwd(), 'server', 'assets', ...parts);
  if (existsSync(fromCwd)) return fromCwd;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', ...parts);
}

const fontDir = () => assetDir('fonts', 'carlito');
/** The league's trophy, the same picture the Word file carried. */
const trophyFile = () => assetDir('images', 'trophy.png');

// ─── Layout constants, in points ─────────────────────────────────────────────

const PAGE = { width: 612, height: 792 };
const MARGIN = 72;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const BODY = 11;
const GAP = 1.15;
const INDENT = 22;
const RULE = '#000000';
const MUTED = '#444444';

type Doc = PDFKit.PDFDocument;

/** Build the whole document and hand back its bytes. */
export function renderRulebookPdf(input: RulebookPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: `${input.book.title} (revision ${input.book.revision})`,
        Author: input.book.frontMatter?.writtenBy ?? 'The Nerds',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const dir = fontDir();
    for (const [name, file] of Object.entries(FONT_FILES)) {
      doc.registerFont(name, readFileSync(path.join(dir, file)));
    }

    const painter = new Painter(doc, input);
    painter.paint();
    doc.end();
  });
}

/**
 * The one object that knows where the pen is. Every section is a method so the
 * order of the book is the order of `paint()`.
 */
class Painter {
  private readonly doc: Doc;
  private readonly input: RulebookPdfInput;
  private readonly index: RulebookIndex;
  private readonly dateLine: string;

  constructor(doc: Doc, input: RulebookPdfInput) {
    this.doc = doc;
    this.input = input;
    this.index = buildRulebookIndex(input.book);
    const stamp = input.publishedAt ?? input.now ?? new Date().toISOString();
    this.dateLine = shortDate(stamp);
    // The corner stamp goes on every page, including ones text overflows onto.
    doc.on('pageAdded', () => this.corner());
  }

  paint(): void {
    this.corner();
    this.frontPage();
    this.rules();
    this.appendices();
    this.amendmentHistory();
    this.signaturePage();
    this.pageNumbers();
  }

  // ─── Page furniture ───────────────────────────────────────────────────────

  /** "Revision 14" and the date, top left, outside the text area. */
  private corner(): void {
    const { doc } = this;
    const x = doc.x;
    const y = doc.y;
    doc.font('body').fontSize(BODY).fillColor(RULE);
    doc.text(`Revision ${this.input.book.revision}`, MARGIN, 38, { lineBreak: false });
    doc.text(this.dateLine, MARGIN, 38 + BODY * GAP, { lineBreak: false });
    if (this.input.copyFor) {
      doc.font('italic').fillColor(MUTED);
      doc.text(`Copy for ${this.input.copyFor}`, MARGIN, 38, {
        width: CONTENT_WIDTH,
        align: 'right',
        lineBreak: false,
      });
    }
    doc.font('body').fillColor(RULE);
    doc.x = x;
    doc.y = y;
  }

  /** Page numbers go on last, once the count is known. */
  private pageNumbers(): void {
    const { doc } = this;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      // Writing below the bottom margin would start a new page. Drop the
      // margin for the footer, then put it back.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('body').fontSize(BODY).fillColor(RULE);
      doc.text(String(i + 1), MARGIN, PAGE.height - 52, {
        width: CONTENT_WIDTH,
        align: 'right',
        lineBreak: false,
      });
      doc.page.margins.bottom = bottom;
    }
    doc.flushPages();
  }

  private body(): Doc {
    return this.doc.font('body').fontSize(BODY).fillColor(RULE);
  }

  private gap(lines = 1): void {
    this.doc.moveDown(lines);
  }

  /** Start a new page unless this one is still nearly empty. */
  private pageBreak(): void {
    if (this.doc.y > MARGIN + BODY * 3) this.doc.addPage();
  }

  /** Keep a heading with what follows it. */
  private keepRoom(points: number): void {
    if (this.doc.y + points > PAGE.height - MARGIN) this.doc.addPage();
  }

  /**
   * Start a new page if `text` would not fit on this one, so a run drawn in
   * pieces (a bold title, then its body) never breaks across pages. pdfkit
   * loses the join when a continued run meets a page break and prints the
   * second piece over the first. A run longer than a page still flows.
   */
  private keepTogether(text: string, width: number): void {
    const height = this.doc.font('body').fontSize(BODY).heightOfString(text, { width });
    this.keepRoom(Math.min(height, PAGE.height - MARGIN * 2 - BODY * 4) + BODY);
  }

  // ─── Front page ───────────────────────────────────────────────────────────

  private frontPage(): void {
    const { doc, input } = this;
    const front = input.book.frontMatter;

    doc.y = MARGIN;
    doc.font('bold').fontSize(12).fillColor(RULE);
    doc.text(input.book.title, MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });
    this.gap(0.6);

    if (input.superseded || input.versionId === null) {
      doc.font('italic').fontSize(BODY).fillColor(MUTED);
      doc.text(
        input.versionId === null
          ? 'Working draft. Not published, not ratified, not yet signed.'
          : 'A superseded revision. It is not the constitution in force.',
        { width: CONTENT_WIDTH, align: 'center' },
      );
      this.gap(0.4);
    }

    if (front?.writtenBy) {
      this.body();
      doc.font('bold').text('Written By: ', MARGIN, doc.y, { continued: true });
      doc.font('body').text(front.writtenBy);
      this.gap(0.6);
    }

    this.champion();

    if (front?.letter.trim()) {
      this.letter(front.letter);
      this.gap(0.4);
    }

    this.memberTable();
  }

  /** Last season's champion between two trophies, as on the original. */
  private champion(): void {
    const { doc, input } = this;
    const champ = championBlock(input.history, input.teams);
    if (!champ) return;

    const top = doc.y;
    const lines: Array<[string, 'bold' | 'body']> = [
      ["LAST SEASON'S CHAMPION", 'bold'],
      ...(champ.team ? ([[`TEAM: ${champ.team}`, 'bold']] as Array<[string, 'bold']>) : []),
      [`OWNER: ${champ.champion}`, 'bold'],
      ...(champ.runnerUp ? ([[`Runner Up: ${champ.runnerUp}`, 'body']] as Array<[string, 'body']>) : []),
    ];
    for (const [text, face] of lines) {
      doc.font(face).fontSize(BODY).fillColor(RULE);
      doc.text(text, MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });
    }
    const bottom = doc.y;
    // The trophy is 120 by 144 pixels; keep its shape and size it to the block.
    const h = Math.max(54, bottom - top + 10);
    const w = h * (120 / 144);
    const y = top - 5;
    const trophy = trophyFile();
    if (existsSync(trophy)) {
      doc.image(trophy, MARGIN + 36, y, { width: w, height: h });
      doc.image(trophy, PAGE.width - MARGIN - 36 - w, y, { width: w, height: h });
    }
    doc.y = bottom;
    this.gap(0.8);
  }

  /** The commissioner's letter, with its headings and bullets. */
  private letter(text: string): void {
    const { doc } = this;
    for (const block of parseLetter(text)) {
      if (block.kind === 'heading') {
        this.keepRoom(BODY * 3);
        this.gap(0.3);
        this.runs(block.runs, MARGIN, CONTENT_WIDTH, true);
        this.gap(0.2);
      } else if (block.kind === 'bullet') {
        const x = MARGIN + INDENT * (block.depth + 1);
        const markers = ['•', 'o', '▪', '-'];
        // Decide the page before the marker goes down, or it stays behind.
        this.keepTogether(block.runs.map((r) => r.text).join(''), CONTENT_WIDTH - (x - MARGIN));
        this.body();
        doc.text(markers[block.depth] ?? '-', x - 12, doc.y, { lineBreak: false });
        this.runs(block.runs, x, CONTENT_WIDTH - (x - MARGIN));
      } else {
        this.runs(block.runs, MARGIN, CONTENT_WIDTH);
        this.gap(0.5);
      }
    }
  }

  /** One line of mixed bold, italic, and plain text, wrapped to `width`. */
  private runs(runs: LetterRun[], x: number, width: number, allBold = false): void {
    const { doc } = this;
    this.keepTogether(runs.map((r) => r.text).join(''), width);
    const y = doc.y;
    doc.fontSize(BODY).fillColor(RULE);
    runs.forEach((run, i) => {
      const face = allBold || run.bold ? (run.italic ? 'boldItalic' : 'bold') : run.italic ? 'italic' : 'body';
      doc.font(face);
      const last = i === runs.length - 1;
      if (i === 0) doc.text(run.text, x, y, { width, continued: !last });
      else doc.text(run.text, { width, continued: !last });
    });
    doc.font('body');
  }

  /** LEAGUE MEMBERS, in draft order, with titles counted from history. */
  private memberTable(): void {
    const { doc, input } = this;
    const rows = memberRows(input.history, input.teams);
    if (!rows.length) return;
    this.keepRoom(BODY * GAP * (rows.length + 4));
    doc.font('bold').fontSize(BODY).fillColor(RULE);
    doc.text('LEAGUE MEMBERS ', MARGIN, doc.y, { continued: true });
    doc.font('body').text('(in order of draft position) *denotes original league member');
    this.gap(0.3);
    this.table(
      ['Member', 'Championships', 'Runners-Up'],
      rows.map((r) => [r.name, String(r.titles), String(r.runnerUps)]),
      [0.5, 0.25, 0.25],
    );
  }

  // ─── Rules ────────────────────────────────────────────────────────────────

  private rules(): void {
    const { doc } = this;
    this.pageBreak();
    doc.font('bold').fontSize(BODY).fillColor(RULE).text('LEAGUE RULES', MARGIN, doc.y);
    doc.font('italic').text(RULES_INTRO, { width: CONTENT_WIDTH });
    this.gap(0.6);

    for (const section of groupByArticle(this.index)) {
      if (section.heading.id.startsWith('appendix')) continue;
      this.article(section.heading, section.clauses);
    }
  }

  private article(heading: RulebookEntry, clauses: RulebookEntry[]): void {
    const { doc } = this;
    this.keepRoom(BODY * GAP * 4);
    this.gap(0.3);
    this.body();
    const label = `${heading.number}.`;
    doc.text(label, MARGIN, doc.y, { lineBreak: false });
    doc.text(heading.title ?? '', MARGIN + INDENT, doc.y, {
      width: CONTENT_WIDTH - INDENT,
      underline: true,
    });
    for (const clause of clauses) this.clause(clause);
  }

  private clause(entry: RulebookEntry): void {
    const { doc } = this;
    const x = MARGIN + INDENT * entry.depth;
    const width = CONTENT_WIDTH - (x - MARGIN);
    const label = `${entry.number}.`;
    this.body();
    const labelWidth = Math.max(doc.widthOfString(label) + 6, INDENT);

    if (entry.kind === 'table' && entry.table) {
      this.keepRoom(BODY * GAP * 4);
      doc.text(label, x, doc.y, { lineBreak: false });
      doc.text(entry.title ?? '', x + labelWidth, doc.y, { width: width - labelWidth });
      this.table(entry.table.columns, entry.table.rows, undefined, x + labelWidth, width - labelWidth);
      return;
    }

    const text = entry.text ? resolveRefs(entry.text, this.index) : '';
    const bodyWidth = width - labelWidth;
    this.keepTogether([entry.kind === 'example' ? 'Example: ' : '', entry.title ?? '', text].join(' '), bodyWidth);
    const y = doc.y;
    doc.text(label, x, y, { lineBreak: false });
    doc.x = x + labelWidth;
    doc.y = y;
    if (entry.kind === 'example') {
      doc.font('italic').text('Example: ', x + labelWidth, y, { width: bodyWidth, continued: true });
      doc.font('body').text(text, { width: bodyWidth });
    } else if (entry.title) {
      doc.font('bold').text(entry.title, x + labelWidth, y, { width: bodyWidth, continued: Boolean(text) });
      if (text) doc.font('body').text(`. ${text}`, { width: bodyWidth });
    } else {
      doc.text(text, x + labelWidth, y, { width: bodyWidth });
    }
    doc.x = MARGIN;
  }

  // ─── Appendices ───────────────────────────────────────────────────────────

  private appendices(): void {
    const { doc, input } = this;
    for (const appendix of input.book.appendices) {
      this.pageBreak();
      doc.font('bold').fontSize(BODY).fillColor(RULE);
      doc.text(`${appendix.label} – ${appendix.title}`, MARGIN, doc.y);
      // The records appendix carries an editor's note, not a reader's.
      if (appendix.note && appendix.kind !== 'records') {
        doc.font('italic').text(appendix.note, { width: CONTENT_WIDTH });
      }
      this.gap(0.5);
      if (appendix.kind === 'records') this.records();
      else if (appendix.table) {
        this.table(appendix.table.columns, appendix.table.rows, [0.35, 0.15]);
      }
    }
  }

  /** Appendix B from league history: the same three tables the app shows. */
  private records(): void {
    const { doc, input } = this;
    const history = input.history;
    const franchises = franchiseIndex(history);
    const category = history.recordCategories.find((c) => c.id === 'weekly-high-score');
    const ranked = rankRecords(history.records, 'weekly-high-score', category?.higherIsBetter ?? true);
    const former = (franchiseId: string | null) =>
      franchiseId !== null && franchises.get(franchiseId)?.active === false ? '*' : '';

    doc.font('bold').fontSize(BODY).text('HIGHEST SCORING WEEKS', MARGIN, doc.y);
    doc.font('italic').text(`${category?.criteria ?? 'Weekly high scores'}. ${category?.basisNote ?? ''}`.trim(), {
      width: CONTENT_WIDTH,
    });
    this.gap(0.3);
    this.table(
      ['#', 'Owner', 'When', 'Points'],
      ranked.map((r) => [String(r.rank), `${r.ownerName}${former(r.franchiseId)}`, formatWhen(r), r.value.toFixed(1)]),
      [0.1, 0.4, 0.3, 0.2],
    );
    doc.font('italic').fontSize(BODY).text('* No longer in the league.', MARGIN, doc.y);
    this.gap(0.8);

    const seasons = seasonRows(history);
    this.keepRoom(BODY * GAP * 6);
    doc.font('bold').text('CHAMPIONS', MARGIN, doc.y);
    this.gap(0.3);
    this.table(
      ['Season', 'Year', 'Champion', 'Runner-Up'],
      seasons.map((row) => [
        String(row.season.seasonNumber),
        row.season.label,
        row.champion?.ownerName ?? 'Unknown',
        row.runnerUp?.ownerName ?? 'Unknown',
      ]),
      [0.15, 0.2, 0.325, 0.325],
    );
    this.gap(0.8);

    const members = memberTotals(history);
    this.keepRoom(BODY * GAP * 6);
    doc.font('bold').text('TITLES BY MEMBER', MARGIN, doc.y);
    doc.font('italic').text('Counted from the seasons above, never typed.', { width: CONTENT_WIDTH });
    this.gap(0.3);
    this.table(
      ['Member', 'Titles', 'Runner-up', 'Finals'],
      members.map((row) => [
        `${row.currentOwner ?? row.name}${row.inherited ? ' †' : ''}`,
        String(row.titles),
        String(row.runnerUps),
        String(row.titles + row.runnerUps),
      ]),
      [0.4, 0.2, 0.2, 0.2],
    );
    if (members.some((row) => row.inherited)) {
      doc.font('italic').fontSize(BODY).text('† Counts every team this member has run.', MARGIN, doc.y);
    }
  }

  // ─── History and signatures ───────────────────────────────────────────────

  private amendmentHistory(): void {
    const { doc, input } = this;
    this.keepRoom(BODY * GAP * (input.versions.length + 4));
    this.gap(1);
    doc.font('bold').fontSize(BODY).fillColor(RULE).text('AMENDMENT HISTORY', MARGIN, doc.y);
    this.gap(0.3);
    this.body();
    if (!input.versions.length) {
      doc.text('No revision has been published yet.', MARGIN, doc.y, { width: CONTENT_WIDTH });
      return;
    }
    for (const v of [...input.versions].sort((a, b) => b.revision - a.revision)) {
      const x = MARGIN + INDENT;
      this.keepTogether(`Revision ${v.revision} ${v.publishedBy} ${v.notes}`, CONTENT_WIDTH - INDENT);
      doc.text('•', x - 12, doc.y, { lineBreak: false });
      doc.font('bold').text(`Revision ${v.revision}`, x, doc.y, { width: CONTENT_WIDTH - INDENT, continued: true });
      doc.font('body').text(` · ${longDate(v.publishedAt)} · ${v.publishedBy}${v.notes ? `. ${v.notes}` : ''}`, {
        width: CONTENT_WIDTH - INDENT,
      });
    }
  }

  /** One line per member. Signed in the app, or still blank. */
  private signaturePage(): void {
    const { doc, input } = this;
    doc.addPage();
    doc.font('bold').fontSize(12).fillColor(RULE);
    doc.text('SIGNATURES', MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });
    this.gap(0.5);
    this.body();
    doc.text(
      input.versionId
        ? `Each member signs revision ${input.book.revision} in the league app. A signature here records that.`
        : 'This is a working draft. Signing opens when the commissioner publishes it.',
      MARGIN,
      doc.y,
      { width: CONTENT_WIDTH },
    );
    this.gap(0.5);
    doc.font('italic').text(`“${ACKNOWLEDGEMENT}”`, MARGIN + INDENT, doc.y, {
      width: CONTENT_WIDTH - INDENT * 2,
    });
    this.gap(1.2);

    const rows = signatureRows(input.teams, input.signatures, input.versionId);
    const signed = rows.filter((r) => r.signedAt).length;
    this.body();
    doc.text(`${signed} of ${rows.length} members have signed.`, MARGIN, doc.y);
    this.gap(1);

    const nameWidth = CONTENT_WIDTH * 0.4;
    for (const row of rows) {
      this.keepRoom(BODY * GAP * 3);
      const y = doc.y;
      this.body();
      doc.text(row.name, MARGIN, y + 2, { width: nameWidth, lineBreak: false });
      const lineX = MARGIN + nameWidth;
      const lineRight = PAGE.width - MARGIN;
      if (row.signedAt) {
        doc.font('italic').fillColor(MUTED);
        doc.text(`Signed in the app, ${longDate(row.signedAt)}`, lineX, y + 2, {
          width: lineRight - lineX,
          lineBreak: false,
        });
        doc.fillColor(RULE);
      }
      doc
        .moveTo(lineX, y + BODY + 6)
        .lineTo(lineRight, y + BODY + 6)
        .lineWidth(0.6)
        .strokeColor(RULE)
        .stroke();
      doc.y = y + BODY * GAP * 2.2;
    }
  }

  // ─── Tables ───────────────────────────────────────────────────────────────

  /**
   * A plain ruled table. Rows never split across a page; a row that would
   * fall off the bottom starts the next page with the header repeated.
   */
  private table(
    columns: RulebookTable['columns'],
    rows: RulebookTable['rows'],
    fractions?: number[],
    x = MARGIN,
    width = CONTENT_WIDTH,
  ): void {
    const { doc } = this;
    const fr = fractions ?? columns.map(() => 1 / columns.length);
    const widths = fr.map((f) => f * width);
    const pad = 2.5;
    const size = 10;

    const rowHeight = (cells: string[], face: 'body' | 'bold') => {
      doc.font(face).fontSize(size);
      return (
        Math.max(...cells.map((cell, i) => doc.heightOfString(cell, { width: widths[i] - pad * 2 }))) +
        pad * 2
      );
    };

    const drawRow = (cells: string[], face: 'body' | 'bold') => {
      const h = rowHeight(cells, face);
      const y = doc.y;
      let cx = x;
      doc.font(face).fontSize(size).fillColor(RULE);
      cells.forEach((cell, i) => {
        doc.rect(cx, y, widths[i], h).lineWidth(0.5).strokeColor('#777777').stroke();
        doc.text(cell, cx + pad, y + pad, { width: widths[i] - pad * 2 });
        cx += widths[i];
      });
      doc.y = y + h;
      doc.x = x;
    };

    const header = () => drawRow(columns, 'bold');
    this.keepRoom(rowHeight(columns, 'bold') + (rows[0] ? rowHeight(rows[0], 'body') : 0));
    header();
    for (const row of rows) {
      const padded = columns.map((_, i) => row[i] ?? '');
      if (doc.y + rowHeight(padded, 'body') > PAGE.height - MARGIN) {
        doc.addPage();
        header();
      }
      drawRow(padded, 'body');
    }
    doc.font('body').fontSize(BODY);
    this.gap(0.5);
  }
}
