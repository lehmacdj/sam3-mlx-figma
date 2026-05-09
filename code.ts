// SAM3 Figma plugin — exports the selected node as PNG, hands it to the
// embedded Studio iframe at localhost:3000/figma, and pastes back the cutouts
// the user picks.

const UI_WIDTH = 520;
const UI_HEIGHT = 720;
const EXPORT_SCALE = 1;

interface CutoutMessage {
  type: "cutout";
  bytes: ArrayBuffer | Uint8Array | number[];
  mime: string;
  width: number;
  height: number;
  x: number;
  y: number;
  mode: "bbox" | "masked";
  score: number | null;
  sourceImageWidth: number;
  sourceImageHeight: number;
  sourceNode: { id?: string; x?: number; y?: number } | null;
}

type ImageMaskShape =
  | { type: "rect"; x: number; y: number; width: number; height: number }
  | {
      type: "vector";
      path: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };

interface ImageMaskMessage {
  type: "image-mask";
  inPlace: boolean;
  imageBytes?: ArrayBuffer | Uint8Array | number[];
  mime?: string;
  imageWidth: number;
  imageHeight: number;
  mask: ImageMaskShape;
  score: number | null;
  sourceNode: { id?: string; x?: number; y?: number } | null;
}

type Exportable = SceneNode & { exportAsync: SceneNode["exportAsync"] };

function isExportable(node: SceneNode): node is Exportable {
  return typeof (node as Exportable).exportAsync === "function";
}

function pickSelectedNode(): Exportable | null {
  const selection = figma.currentPage.selection;
  for (const node of selection) {
    if (isExportable(node)) return node;
  }
  return null;
}

function toUint8Array(
  bytes: ArrayBuffer | Uint8Array | number[]
): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return new Uint8Array(bytes);
}

interface PlacementTarget {
  parent: BaseNode & ChildrenMixin;
  index: number;
}

function placementForSource(source: SceneNode | null): PlacementTarget {
  if (source && source.parent) {
    const parent = source.parent as BaseNode & ChildrenMixin;
    const siblings = parent.children as ReadonlyArray<SceneNode>;
    const idx = siblings.indexOf(source);
    return { parent, index: idx >= 0 ? idx + 1 : siblings.length };
  }
  return {
    parent: figma.currentPage,
    index: figma.currentPage.children.length,
  };
}

interface SourceTransform {
  source: SceneNode | null;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
}

async function resolveSourceTransform(
  sourceNode: { id?: string; x?: number; y?: number } | null,
  sourceWidth: number,
  sourceHeight: number
): Promise<SourceTransform> {
  let source: SceneNode | null = null;
  let originX = 0;
  let originY = 0;
  let scaleX = 1;
  let scaleY = 1;
  if (sourceNode?.id) {
    const node = await figma.getNodeByIdAsync(sourceNode.id);
    if (node && "width" in node && "height" in node) {
      source = node as SceneNode;
      scaleX = (node as SceneNode).width / sourceWidth;
      scaleY = (node as SceneNode).height / sourceHeight;
      if ("x" in node) originX = (node as SceneNode).x;
      if ("y" in node) originY = (node as SceneNode).y;
    }
  }
  return { source, originX, originY, scaleX, scaleY };
}

function buildMaskNode(
  shape: ImageMaskShape,
  originX: number,
  originY: number,
  scaleX: number,
  scaleY: number
): RectangleNode | VectorNode {
  if (shape.type === "rect") {
    const r = figma.createRectangle();
    r.resize(
      Math.max(1, shape.width * scaleX),
      Math.max(1, shape.height * scaleY)
    );
    r.x = originX + shape.x * scaleX;
    r.y = originY + shape.y * scaleY;
    r.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
    r.name = "Mask (rect)";
    return r;
  }
  const v = figma.createVector();
  v.vectorPaths = [{ windingRule: "NONZERO", data: shape.path }];
  const uniformScale = (scaleX + scaleY) / 2;
  if (Math.abs(uniformScale - 1) > 1e-3) v.rescale(uniformScale);
  v.x = originX + shape.x * scaleX;
  v.y = originY + shape.y * scaleY;
  v.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
  v.name = "Mask (vector)";
  return v;
}

async function placeCutout(msg: CutoutMessage): Promise<void> {
  const u8 = toUint8Array(msg.bytes);
  const image = figma.createImage(u8);
  const rect = figma.createRectangle();

  const { source, originX, originY, scaleX, scaleY } =
    await resolveSourceTransform(
      msg.sourceNode,
      msg.sourceImageWidth || msg.width,
      msg.sourceImageHeight || msg.height
    );

  rect.resize(
    Math.max(1, msg.width * scaleX),
    Math.max(1, msg.height * scaleY)
  );
  rect.x = originX + msg.x * scaleX;
  rect.y = originY + msg.y * scaleY;
  rect.name =
    msg.mode === "masked" ? "SAM3 Cutout (masked)" : "SAM3 Cutout (bbox)";
  rect.fills = [
    {
      type: "IMAGE",
      scaleMode: "FILL",
      imageHash: image.hash,
    },
  ];

  const { parent, index } = placementForSource(source);
  parent.insertChild(index, rect);
}

async function placeImageWithMask(msg: ImageMaskMessage): Promise<void> {
  const { source, originX, originY, scaleX, scaleY } =
    await resolveSourceTransform(
      msg.sourceNode,
      msg.imageWidth,
      msg.imageHeight
    );

  if (msg.inPlace) {
    if (!source) {
      figma.ui.postMessage({
        type: "error",
        message: "In-place mask needs the original source node.",
      });
      return;
    }
    const maskNode = buildMaskNode(msg.mask, originX, originY, scaleX, scaleY);
    maskNode.isMask = true;

    const parent = (source.parent ?? figma.currentPage) as BaseNode &
      ChildrenMixin;
    // Mask must be the bottom child of the group so siblings above it are
    // clipped — insert mask just before the source instead of appending.
    const sourceIdx = parent.children.indexOf(source);
    parent.insertChild(sourceIdx >= 0 ? sourceIdx : parent.children.length, maskNode);

    const group = figma.group([maskNode, source], parent);
    group.name =
      msg.mask.type === "rect"
        ? "SAM3 Clipped (rect)"
        : "SAM3 Clipped (vector)";
    return;
  }

  if (!msg.imageBytes) {
    figma.ui.postMessage({
      type: "error",
      message: "Missing image bytes for copy mask.",
    });
    return;
  }

  const u8 = toUint8Array(msg.imageBytes);
  const image = figma.createImage(u8);

  const imageRect = figma.createRectangle();
  imageRect.resize(
    Math.max(1, msg.imageWidth * scaleX),
    Math.max(1, msg.imageHeight * scaleY)
  );
  imageRect.x = originX;
  imageRect.y = originY;
  imageRect.fills = [
    {
      type: "IMAGE",
      scaleMode: "FILL",
      imageHash: image.hash,
    },
  ];
  imageRect.name = "Image";

  const maskNode = buildMaskNode(msg.mask, originX, originY, scaleX, scaleY);
  maskNode.isMask = true;

  const { parent, index } = placementForSource(source);
  parent.appendChild(maskNode);
  parent.appendChild(imageRect);

  const group = figma.group([maskNode, imageRect], parent, index);
  group.name =
    msg.mask.type === "rect"
      ? "SAM3 Image (rect mask)"
      : "SAM3 Image (vector mask)";
}

async function sendCurrentSelection(): Promise<void> {
  const node = pickSelectedNode();
  if (!node) {
    figma.ui.postMessage({
      type: "no-selection",
      message: "Select a frame, group, or image to segment.",
    });
    return;
  }

  try {
    const bytes = await node.exportAsync({
      format: "PNG",
      constraint: { type: "SCALE", value: EXPORT_SCALE },
    });

    figma.ui.postMessage({
      type: "image",
      bytes,
      mime: "image/png",
      width: "width" in node ? node.width : undefined,
      height: "height" in node ? node.height : undefined,
      nodeId: node.id,
      nodeX: "x" in node ? node.x : undefined,
      nodeY: "y" in node ? node.y : undefined,
    });
  } catch (err) {
    figma.ui.postMessage({
      type: "error",
      message: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

figma.showUI(__html__, {
  width: UI_WIDTH,
  height: UI_HEIGHT,
  themeColors: true,
});

figma.on("selectionchange", () => {
  void sendCurrentSelection();
});

figma.ui.onmessage = (msg: { type?: string } & Record<string, unknown>) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "ready") {
    void sendCurrentSelection();
    return;
  }

  if (msg.type === "cutout") {
    void placeCutout(msg as unknown as CutoutMessage).catch((err) => {
      figma.ui.postMessage({
        type: "error",
        message: `Place failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
    return;
  }

  if (msg.type === "image-mask") {
    void placeImageWithMask(msg as unknown as ImageMaskMessage).catch((err) => {
      figma.ui.postMessage({
        type: "error",
        message: `Place failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
    return;
  }

  if (msg.type === "close") {
    figma.closePlugin();
  }
};
