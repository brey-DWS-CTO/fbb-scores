/**
 * A rankings file a member picks on their phone or laptop, read in the
 * browser and turned into list text, one name a line. Excel files are read
 * sheet by sheet, first sheet only; anything else is read as plain text, which
 * covers .txt and .csv. The server never sees the file, only the text.
 */
import readXlsxFile from 'read-excel-file';
import { rowsToText } from './autoDraft.js';

/** The file types the picker offers. */
export const RANKINGS_FILE_ACCEPT = '.xlsx,.csv,.txt,.tsv';

const isExcel = (file: File): boolean =>
  /\.xlsx$/i.test(file.name)
  || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function readRankingsFile(file: File): Promise<string> {
  if (isExcel(file)) {
    const rows = await readXlsxFile(file);
    return rowsToText(rows);
  }
  if (/\.xls$/i.test(file.name)) {
    throw new Error('Save it as .xlsx first. The old .xls format cannot be read here.');
  }
  return file.text();
}
