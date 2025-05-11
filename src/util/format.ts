export interface Format {
  time: (ticks: number) => string;
  timeStamp: (ticks: number) => string;
  ram: (number: number) => string;
  number: (number: number) => string;
  table: (data: string[][], opts?: Partial<TableOpts>) => string[];
  progressBar: (percentage: number, length: number) => string;
}

export interface TableOpts {
  ml: number;
  mr: number;
  headInset: number;
  alignNumbers: "left" | "right";
  head: "full" | "inline" | "dense";
  divider: "full" | "split" | "dense";
  separator: string;
  showSeparator: "always" | "noTrailing" | "never";
}

const PRECISION = 3;

const getReps = (symbols: string[], stepFunc: (n: number) => number = n => 1_000 ** n): { rep: string, value: number }[] => symbols.map((s, i) => ({
  value: stepFunc(i),
  rep: s
}));

const numberReps = getReps(["", "k", "m", "b", "t", "q", "Q"]);
const ramReps = getReps(["GB", "TB", "PB"], n => 1024 ** n);

function formatNumber(number: number, reps: { rep: string, value: number }[]) {
  const instance = reps.findLast(rep => rep.value <= number) ?? reps[0];
  const remaining = number / instance.value;
  return remaining.toPrecision(PRECISION) + instance.rep;
}

function time(ticks: number): string {
  const date = new Date(ticks);

  return Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    timeStyle: "medium",
    hourCycle: "h23",
  }).format(date);
}

function timeStamp(ticks: number): string {
  const date = new Date(Date.now() + ticks);

  return Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
    hourCycle: "h23",
  }).format(date);
}

const defaultTableOpts: TableOpts = {
  ml: 1,
  mr: 1,
  headInset: 1,
  alignNumbers: "right",
  head: "full",
  divider: "split",
  separator: ",",
  showSeparator: "noTrailing"
}

const BORDER = {
  top: {
    leftEdge: "┌",
    midPiece: "┬",
    rightEdge: "┐",
    horizontal: "─",
    vertical: "│"
  },
  mid: {
    leftEdge: "├",
    midPiece: "┼",
    rightEdge: "┤",
    horizontal: "─",
    vertical: "│"
  },
  bot: {
    leftEdge: "└",
    midPiece: "┴",
    rightEdge: "┘",
    horizontal: "─",
    vertical: "│"
  },
} as const;

const sanitizeData = (head: string[], data: string[][], opts: TableOpts): {
  columnLengths: number[],
  parsedData: (string | string[])[][],
  parsedHead: string[],
} => {
  const parsedHead: string[] = head.map(s => s.trim());
  const columnLengths: number[] = parsedHead.map(s => s.length);
  const parsedData: (string | string[])[][] = [];

  for (const row of data) {
    const parsedRow: (string | string[])[] = [];

    for (let i = 0; i < row.length; i++) {
      const entry = row[i];
      const split = entry.split(opts.separator);
      let length = 0;

      if (split.length === 1) {
        const sanitized = entry.trim();
        parsedRow.push(sanitized);
        length = Math.max(length, sanitized.length);
      }
      else parsedRow.push(split.map((s, i, arr) => {
        const entry = (opts.showSeparator === "never" ? s : (s + (i + 1 !== arr.length || opts.showSeparator === "always" ? opts.separator : ""))).trim();
        length = Math.max(length, entry.length);
        return entry;
      }));

      columnLengths[i] = Math.max(columnLengths[i] ?? 0, length);
    }

    parsedData.push(parsedRow);
  }

  const numColumns = [parsedHead, ...parsedData].reduce((acc, cur) => Math.max(acc, cur.length), 0);

  return {
    columnLengths: columnLengths.map(n => n + opts.ml + opts.mr + (opts.head !== "full" ? opts.headInset : 0)),
    parsedData: parsedData.map(r => r.concat(Array.from({ length: numColumns - r.length }, () => ""))),
    parsedHead: parsedHead.concat(Array.from({ length: numColumns - parsedHead.length }, () => ""))
  };
};

const padEntry = (entry: string, opts: TableOpts) => " ".repeat(opts.ml) + entry + " ".repeat(opts.mr);
const fill = (s: string, length: number, filler = " ", padStart = false) => s[padStart ? "padStart" : "padEnd"](length, filler);
const isNumber = (s: string, opts: TableOpts): boolean => new RegExp(
  `^(?:(?:\\$(?:[+-]\\s)?\\d+(?:\\.\\d+)?)|(?:[+-]\\s)?(?:\\d+(?:\\.\\d+)?(?:\\w|[€$%]){0,2}))(?:${opts.separator.split("").map(c => "\\" + c).join("")})?$`
).test(s);
const makeDivider = (columnLengths: number[]) => BORDER.mid.leftEdge + (columnLengths.map(n => BORDER.mid.horizontal.repeat(n)).join(BORDER.mid.midPiece)) + BORDER.mid.rightEdge;
const makeRow = (row: string[], columnLengths: number[], opts: TableOpts) => BORDER.mid.vertical + (
  row.map((s, i) => fill(padEntry(s, opts), columnLengths[i], " ", isNumber(s, opts))).join(BORDER.mid.vertical)
) + BORDER.mid.vertical;

const makeHead = (head: string[], columnLengths: number[], opts: TableOpts) => {
  if (opts.head === "full") return [
    BORDER.top.leftEdge + (columnLengths.map(n => BORDER.top.horizontal.repeat(n)).join(BORDER.top.midPiece)) + BORDER.top.rightEdge,
    BORDER.top.vertical + (head.map((entry, i) => fill(padEntry(entry, opts), columnLengths[i], " ", isNumber(entry, opts))).join(BORDER.top.vertical)) + BORDER.top.vertical,
    makeDivider(columnLengths)
  ];

  return [
    BORDER.top.leftEdge + (head.map((s, i) => (
      BORDER.top.horizontal.repeat(opts.headInset) + fill(
        (s.length > 0 ? padEntry(s, opts) : ""),
        columnLengths[i] - opts.headInset,
        BORDER.top.horizontal,
        isNumber(s, opts)
      ))).join(BORDER.top.midPiece)) + BORDER.top.rightEdge,
  ].concat(opts.head === "inline" ? [makeDivider(columnLengths)] : []);
}

const makeData = (data: (string | string[])[][], columnLengths: number[], opts: TableOpts) => {
  const dataRep: string[] = [];

  const midDivider = makeDivider(columnLengths);
  for (const row of data) {
    if (row.every(entry => !Array.isArray(entry))) dataRep.push(makeRow(row as string[], columnLengths, opts));
    else {
      const numSplits = row.reduce((acc, cur) => Math.max(acc, Array.isArray(cur) ? cur.length : 1), 0);
      const splitRows = Array.from({ length: numSplits }, (_, i) => row.map(r => (Array.isArray(r) ? r[i] : (i === 0 ? r : undefined)) ?? ""));

      for (const r of splitRows) {
        dataRep.push(makeRow(r, columnLengths, opts));
        if (opts.divider === "full") dataRep.push(midDivider);
      }
    }
    if (opts.divider !== "dense") dataRep.push(midDivider);
  }
  if (opts.divider !== "dense") dataRep.pop();

  return dataRep;
}

function table(data: string[][], opts?: Partial<TableOpts>) {
  const tableOpts: TableOpts = { ...defaultTableOpts, ...opts };

  const [head, ...rest] = data;
  const { columnLengths, parsedData, parsedHead } = sanitizeData(head, rest, tableOpts);

  const headRep = makeHead(parsedHead, columnLengths, tableOpts);
  const dataRep = makeData(parsedData, columnLengths, tableOpts);

  return [...headRep, ...dataRep, BORDER.bot.leftEdge + (columnLengths.map(n => BORDER.bot.horizontal.repeat(n)).join(BORDER.bot.midPiece)) + BORDER.bot.rightEdge];
}

const progressBar = (percentage: number, length: number, filled = Math.floor((length - 2) * percentage)) => `[${"|".repeat(filled) + "-".repeat(length - (2 + filled))}]`;

export const format: Format = {
  time,
  timeStamp,
  number: n => formatNumber(n, numberReps),
  ram: n => formatNumber(n, ramReps),
  table,
  progressBar
}

export async function main(ns: NS) {
  ns.tail();
  ns.clearLog();
  ns.disableLog("ALL");

  ns.printf("%s", format.table([
    ["Name", "Age", "Hobbies", "Friends"],
    ["Alice", "25", "Jogging,Tennis", "Bob,Charlie"],
    ["Bob", "26", "Darts", "Alice,Charlie"],
    ["Charlie", "28", "Football", "Alice,Bob"],
  ], {
    head: "inline",
    headInset: 0,
    divider: "split",
    separator: ",",
    showSeparator: "noTrailing",
  }).join("\n"));
}