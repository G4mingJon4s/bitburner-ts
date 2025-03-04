import { createProtocol } from "util/protocol.ts";
import * as t from "util/schema.ts";

const TITLEHEIGHT = 33;
const STARTWIDTH = 1600;
const STARTHEIGHT = 900;

const MINWIDTH = 500;
const MINHEIGHT = 500;
const GAP = 0;

const TilingMap: Record<number, { cols: number; rows: number; }> = {
  0: { cols: 0, rows: 0 },
  1: { cols: 1, rows: 1 },
  2: { cols: 2, rows: 1 },
  3: { cols: 2, rows: 2 },
  4: { cols: 2, rows: 2 },
  5: { cols: 3, rows: 2 },
  6: { cols: 3, rows: 2 },
  7: { cols: 4, rows: 2 },
  8: { cols: 4, rows: 2 },
};

export const getTailData = (ns: NS, pid: number): TailData => {
  const running = ns.getRunningScript(pid);
  if (running === null || running.tailProperties === null) return {
    position: [
      (ns.ui.windowSize()[0] - 500) / 2,
      (ns.ui.windowSize()[1] - 500) / 2
    ],
    size: [500, 500],
  };
  return {
    position: [running.tailProperties.x, running.tailProperties.y],
    size: [running.tailProperties.width, running.tailProperties.height],
  };
};

const detachWindow = (ns: NS, pid: number, initial: TailData) => {
  ns.moveTail(...initial.position, pid);
  ns.resizeTail(...initial.size, pid);
};

export const referenceSpanId = (pid: number) => `pid-id-${pid}`;
export const createReferenceSpan = async (ns: NS): Promise<void> => {
  ns.tail();

  ns.printRaw(React.createElement("span", { id: referenceSpanId(ns.pid) }));
  ns.setTitle(ns.self().title);

  // make sure the reference stays between log clearing
  const element = (eval("document") as Document).getElementById(referenceSpanId(ns.pid));
  if (element === null) throw new Error("No reference span");
  const parent = element.parentElement!.parentElement!;
  parent.appendChild(element);
  ns.clearLog();
}
export const getDraggable = (pid: number) => {
  const span = (eval("document") as Document).getElementById(referenceSpanId(pid));
  if (span === null) return null;
  let current = span;
  while (!current.classList.contains("react-draggable")) current = current.parentElement!;
  return current;
};

interface TailData {
  position: [number, number];
  size: [number, number];
}
export type Context = {
  tails: {
    pid: number;
    initialData: TailData;
    positionData: [number, number];
    draggable: HTMLElement;
    resizeElement: HTMLElement;
  }[];
  maxGrid: () => {
    cols: number;
    rows: number;
  };
  appliedTilingSize: number;
  forceUpdate: boolean;
};
export const p = createProtocol<Context>({
  port: 2000
});

export const router = p.router({
  attach: p.create()
    .output(t.boolean())
    .clientAction(async ns => {
      if ((eval("document") as Document).getElementById(referenceSpanId(ns.pid)) !== null) return;
      await createReferenceSpan(ns);
    })
    .resolver((ctx, { ns, origin }) => async () => {
      if (ctx.tails.some(a => a.pid === origin)) return true;
      const newCount = ctx.tails.length + 1;
      const tiling = TilingMap[newCount];
      if (tiling === undefined) return false;

      const max = ctx.maxGrid();
      if (tiling.cols > max.cols || tiling.rows > max.cols) return false;

      const draggable = getDraggable(origin);
      if (draggable === null) return false;

      const resize = draggable.querySelector<HTMLElement>(".react-resizable > span");
      if (resize === null) throw new Error("No resize element");
      resize.remove();
      draggable.style.userSelect = "none";

      ctx.tails = [...ctx.tails, {
        pid: origin,
        initialData: getTailData(ns, origin),
        positionData: [-1, -1],
        draggable,
        resizeElement: resize,
      }];
      ctx.forceUpdate = true;
      return true;
    }),
  detach: p.create()
    .resolver((ctx, { ns, origin }) => async () => {
      const values = ctx.tails.find(a => a.pid === origin);
      if (values === undefined) return;

      values.draggable.onmouseup = null;
      values.draggable.style.userSelect = "auto";
      const resizable = values.draggable.querySelector(".react-resizable");
      if (resizable !== null) {
        resizable.appendChild(values.resizeElement);
      }
      detachWindow(ns, origin, values.initialData);
      ctx.tails = ctx.tails.filter(a => a.pid !== origin);
      ctx.forceUpdate = true;
    })
});

const getMaxGrid = (size: [number, number]) => {
  let maxColumns = 0;
  while (MINWIDTH * maxColumns + Math.max(0, GAP * (maxColumns - 1)) < size[0]) maxColumns++;
  let maxRows = 0;
  while (MINHEIGHT * maxRows + Math.max(0, GAP * (maxRows - 1)) < (size[1] - TITLEHEIGHT)) maxRows++;
  return {
    cols: maxColumns,
    rows: maxRows,
  };
};

const getGridSize = (container: TailData, tiling: (typeof TilingMap)[keyof typeof TilingMap]): [number, number] => {
  const width = Math.floor((container.size[0] - GAP * Math.max(0, tiling.cols - 1)) / tiling.cols);
  const height = Math.floor((container.size[1] - (TITLEHEIGHT + GAP * Math.max(0, tiling.rows - 1))) / tiling.rows);
  return [width, height];
};

export async function initTail(ns: NS) {
  ns.disableLog("ALL");
  ns.clearLog();
  ns.tail();

  ns.print("Initializing window...");

  const client = p.client(ns, router);
  const online = await client.ping();
  if (!online) {
    ns.print("Couldn't reach server...");
  } else {
    await client.attach();
    ns.print("Successfully attached window...");
  }
  await ns.asleep(500);
  ns.clearLog();

  return client;
}

export async function main(ns: NS) {
  const maxGrid = () => getMaxGrid(getTailData(ns, ns.pid).size);
  const ctx: Context = {
    maxGrid,
    tails: [],
    appliedTilingSize: 0,
    forceUpdate: true
  };
  const server = p.server(router, ctx);

  ns.disableLog("ALL");
  ns.clearLog();
  ns.tail();
  ns.resizeTail(STARTWIDTH, STARTHEIGHT);
  ns.moveTail((ns.ui.windowSize()[0] - STARTWIDTH) / 2, (ns.ui.windowSize()[1] - STARTHEIGHT) / 2);

  await createReferenceSpan(ns);
  const containerElement = getDraggable(ns.pid);
  if (containerElement === null) throw new Error("Container not open");

  const updateLayers = () => {
    const base = Number(containerElement.style.zIndex);

    ctx.tails.forEach((data, i) => data.draggable.style.zIndex = `${base + i + 1}`);
    ctx.forceUpdate = true;
  };

  const observer = new MutationObserver(() => updateLayers());
  observer.observe(containerElement, { attributes: true, childList: true, subtree: true });
  containerElement.style.userSelect = "none";

  const dragInitiator = (tile: Context["tails"][number]) => () => {
    tile.draggable.style.zIndex = "99999";
  };
  const dragResolver = (tile: Context["tails"][number]) => (e: MouseEvent) => {
    e.preventDefault();
    const tiling = TilingMap[ctx.tails.length];
    if (tiling === undefined) throw new Error(`Invalid tiling for ${ctx.tails.length} tails`);

    const container = getTailData(ns, ns.pid);
    if (
      container.position[0] > e.x ||
      container.position[1] > e.y ||
      container.position[0] + container.size[0] < e.x ||
      container.position[1] + container.size[1] < e.y
    ) {
      ns.moveTail(...tile.positionData, tile.pid);
      return;
    }

    const [width, height] = getGridSize(container, tiling);
    const relativeX = e.x - container.position[0];
    const relativeY = e.y - container.position[1];
    const col = Math.floor(relativeX / (width + GAP));
    const row = Math.floor(relativeY / (height + GAP));

    const currentIndex = ctx.tails.indexOf(tile);
    if (currentIndex === -1) throw new Error("Couldn't find own tile");
    const targetIndex = Math.min(row * tiling.cols + col, ctx.tails.length - 1);
    if (currentIndex === targetIndex) return ns.moveTail(...tile.positionData, tile.pid);

    const temp = ctx.tails[currentIndex];
    ctx.tails[currentIndex] = ctx.tails[targetIndex];
    ctx.tails[targetIndex] = temp;

    ctx.forceUpdate = true;
  };

  ns.atExit(() => {
    ctx.tails.forEach(data => detachWindow(ns, data.pid, data.initialData));
    observer.disconnect();
    ns.closeTail();
  });

  while (true) {
    await ns.asleep(0);
    await server.tick(ns);

    ctx.tails.forEach(data => {
      const running = ns.getRunningScript(data.pid);
      if (running === null || running.tailProperties === null) {
        detachWindow(ns, data.pid, data.initialData);
        ctx.tails = ctx.tails.filter(a => a.pid !== data.pid);
        ns.closeTail(data.pid);
      }
    });

    if (!ctx.forceUpdate && ctx.appliedTilingSize === ctx.tails.length) continue;
    ctx.forceUpdate = false;

    const tiling = TilingMap[ctx.tails.length];
    if (tiling === undefined) throw new Error(`Invalid tiling for ${ctx.tails.length} tails`);
    ctx.appliedTilingSize = ctx.tails.length;

    const container = getTailData(ns, ns.pid);
    const [width, height] = getGridSize(container, tiling);

    ctx.tails.forEach((data, i) => {
      data.draggable.onmouseup = dragResolver(data);
      data.draggable.onmousedown = dragInitiator(data);
      const row = Math.floor(i / tiling.cols);
      const col = i % tiling.cols;

      const relativeX = (width + GAP) * col;
      const relativeY = (height + GAP) * row;
      data.positionData = [container.position[0] + relativeX, (container.position[1] + TITLEHEIGHT + 2) + relativeY];

      ns.tail(data.pid);
      ns.moveTail(...data.positionData, data.pid);
      ns.resizeTail(width, (height - 2), data.pid);
    });
  }
}