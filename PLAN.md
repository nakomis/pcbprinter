# pcbprinter — Plan

> Inspired by https://castpixel.itch.io/pcb-forge

TypeScript CLI that takes a raw Fritzing PCB SVG export and outputs:
1. A clean intermediate SVG (useful for inspection / other tools)
2. **pcb.stl** — the PCB substrate with drill holes
3. **press.stl** — the conductive trace layer, designed to sit on top of the pcb

---

## Problem summary

Fritzing PCB exports have several issues that prevent them being used directly
with 3D printing pipelines:

1. **Watermark** — a `<g id="watermark">` group with filled grey paths.
2. **Stroked traces** — traces are `<line stroke="...">` elements; 3D print
   tools only recognise *filled* shapes as conductor.
3. **Part label text** — `<text fill="#000000">` groups that would print as
   solid blobs of conductor.
4. **No board background** — a solid filled rectangle is needed to define the
   board extent and substrate material.
5. **Missing through-hole pads** — component pins need a yellow annular pad
   with a black drill circle at the exact pad position.
6. **Trace endpoints offset from pad centres** — Fritzing routing often ends a
   trace slightly short of the pad centre; must snap endpoints to exact pad
   positions to avoid a gap.

---

## Output files

### intermediate SVG
Same format as the pcb-forge sample:

| Element | Meaning |
|---|---|
| Solid filled `<rect>` covering the board | PCB substrate |
| Filled `<path>` (non-black) | Conductor trace |
| `<circle>` with no fill (defaults black) | Drill hole |

Pads = two concentric circles: outer yellow (`r` = trace half-width) + inner
black (`r` = drill radius).

### pcb.stl
The PCB substrate:
- Board rect extruded to `boardThickness` (default 1.6 mm)
- Drill holes (cylinders) subtracted through the full thickness at every pad
  position
- Optionally: shallow channels routed into the top face at trace positions so
  the press layer registers precisely (controlled by `--trace-recess`)

### press.stl
The conductive trace layer:
- Every trace (rounded-rectangle solid) extruded to `traceHeight` (default
  0.2 mm), positioned to sit on top of the pcb (z = boardThickness)
- Every pad (cylinder) extruded to the same height, concentric with the drill
  holes in the pcb

Printed separately in conductive filament; holes in press align with holes
in pcb so the two parts stack correctly.

---

## Project structure

```
pcbprinter/
├── src/
│   ├── cli.ts            # Entry point — arg parsing, orchestration
│   ├── parser.ts         # Parse Fritzing SVG → internal model
│   ├── transform.ts      # Affine 3×3 matrix composition + point transforms
│   ├── geometry.ts       # Line → rounded-cap SVG path; polygon approximation
│   ├── pads.ts           # Resolve pad absolute positions; snap trace endpoints
│   ├── svgWriter.ts      # Render internal model → SVG string
│   └── stlWriter.ts      # Render internal model → pcb + press STL buffers
├── package.json
├── tsconfig.json
└── PLAN.md
```

---

## Internal model

```typescript
interface BoardModel {
  // SVG coordinate space throughout — convert to mm only in stlWriter
  svgUnitsPerMm: number;          // derived from viewBox width vs physical width attr
  boardRect: { x: number; y: number; w: number; h: number };
  traces: Trace[];
  pads: Pad[];
  footprintCircles: FootprintCircle[];  // fill="none" reference circles, SVG only
}

interface Trace {
  x1: number; y1: number;
  x2: number; y2: number;
  strokeWidth: number;
  color: string;
}

interface Pad {
  cx: number; cy: number;
  drillRadius: number;    // SVG units  (0.5 mm default = 1.4175 at 72 dpi)
  padRadius: number;      // SVG units  (= trace half-width, e.g. 2.88)
  color: string;
}

interface FootprintCircle {
  cx: number; cy: number; r: number;
}
```

---

## Step-by-step processing

### 1 — Parse the SVG

Use `@xmldom/xmldom`. Walk the element tree maintaining a **transform stack**
(see §2). Collect:

- Board outline `<rect>` (inside `<g id="board">`)
- All `<line>` elements inside groups with `id` starting `copper` → traces
- All `<circle>` inside copper groups → through-hole pads
- All `<rect>` inside copper groups → SMD pads (no drill hole)
- All `<circle>` inside copper groups that are footprint-only (large r, no
  connected trace) → footprintCircles

Skip entirely:
- `<g id="watermark">` and descendants
- `<g id="partLabel">` / `<g id="silkscreenLabel">` and descendants
- `<g id="silkscreen">` groups

### 2 — Resolve transforms

Build a transform stack as a 3×3 affine matrix. Push on `<g>` entry, pop on
exit. Compose by matrix multiplication:

```
translate(tx, ty)   →  [[1,0,tx], [0,1,ty], [0,0,1]]
matrix(a,b,c,d,e,f) →  [[a,c,e],  [b,d,f],  [0,0,1]]
rotate(deg)         →  standard 2D rotation matrix
```

Apply accumulated matrix to all extracted points so the internal model is
entirely in absolute SVG user-unit space.

### 3 — Convert traces to filled SVG paths

For each `Trace` with half-width `h`:

```
ux,uy  = normalise(x2−x1, y2−y1)
nx,ny  = (−uy, ux)

a = (x1+nx·h, y1+ny·h)   b = (x2+nx·h, y2+ny·h)
c = (x2−nx·h, y2−ny·h)   d = (x1−nx·h, y1−ny·h)

SVG path: M a L b A h,h 0 0,1 c L d A h,h 0 0,1 a Z
```

### 4 — Identify pads and snap trace endpoints

- Classify copper `<circle>` elements as through-hole pads (r within expected
  range for Fritzing, typically 1.7–2.1 SVG units).
- For each trace endpoint, find the nearest pad whose centre is within
  `snapTolerance` (default 1.5 mm converted to SVG units). If found, move the
  trace endpoint to the exact pad centre.

### 5 — Write SVG

Z-order:
1. Board background `<rect fill="#03A550">`
2. Board outline `<rect fill="none" stroke="#111111">`
3. Footprint circles `<circle fill="none" stroke="#F7BD13">`
4. Trace `<path fill="...">`
5. Pad pairs: outer `<circle fill="#f2c600">`, inner `<circle>` (black default)

### 6 — Generate STL geometry  *(new — see detail below)*

---

## STL generation detail

### Library: JSCAD

`@jscad/modeling` is a TypeScript-native solid modelling library. It supports:
- 2D primitives: `rectangle`, `circle`, `polygon`
- 3D operations: `extrudeLinear` (extrude 2D shape along Z)
- Boolean ops: `union`, `subtract`
- `@jscad/stl-serializer` → binary STL `Buffer`

No external processes required — pure Node.js.

### Unit conversion

```
svgUnitsPerMm = viewBoxWidth / physicalWidthInMm
                                       (parsed from SVG width="2.02928in" etc.)

toMm(svgVal) = svgVal / svgUnitsPerMm
```

All geometry passed to JSCAD is in mm.

### Rounded-rectangle 3D solid (for traces)

Rather than extruding the SVG arc path, compose from primitives:

```
for trace (x1,y1)→(x2,y2), half-width h, height t:

  bar    = cuboid({ size: [length, 2h, t], center: [midX, midY, t/2] })
             rotated to the trace angle
  capA   = cylinder({ radius: h, height: t, center: [x1, y1, t/2] })
  capB   = cylinder({ radius: h, height: t, center: [x2, y2, t/2] })
  solid  = union(bar, capA, capB)
```

`cylinder` uses 32 segments by default → smooth enough for printing.

### pcb.stl

```
boardSolid = extrudeLinear({ height: boardThickness },
               rectangle({ size: [boardW, boardH] }))

for each pad:
  drillCyl = cylinder({ radius: pad.drillRadius, height: boardThickness + 0.1 })
             // +0.1 mm ensures clean Boolean subtraction through both faces
  boardSolid = subtract(boardSolid, drillCyl)

// optional trace channels
if traceRecess > 0:
  for each trace:
    channel = traceRoundedRect(trace, height: traceRecess)
              translated to sit on top face (z = boardThickness - traceRecess)
    boardSolid = subtract(boardSolid, channel)
```

### press.stl

```
presss = []

for each trace:
  presss.push(traceRoundedRect(trace, height: traceHeight)
                  translated to z = boardThickness)

for each pad:
  padDisc = cylinder({ radius: pad.padRadius, height: traceHeight })
            translated to (pad.cx, pad.cy, boardThickness)
  drillCyl = cylinder({ radius: pad.drillRadius, height: traceHeight + 0.1 })
  presss.push(subtract(padDisc, drillCyl))

pressSolid = union(...presss)
```

### STL serialisation

```typescript
import { serialize } from '@jscad/stl-serializer'
const pcbBuffer    = serialize({ binary: true }, boardSolid)
const pressBuffer = serialize({ binary: true }, pressSolid)
fs.writeFileSync('pcb.stl', Buffer.from(pcbBuffer))
fs.writeFileSync('press.stl', Buffer.from(pressBuffer))
```

---

## CLI interface

```
pcbprinter [options] <input.svg>

Options:
  -o, --out-dir <dir>           Output directory (default: same dir as input)
  --svg                         Also write intermediate SVG (default: false)
  --board-color <hex>           SVG substrate colour (default: #03A550)
  --board-thickness <mm>        STL board thickness (default: 1.6)
  --trace-height <mm>           STL press trace extrusion height (default: 0.2)
  --trace-recess <mm>           Depth of channels routed into pcb for trace
                                registration; 0 = flat pcb (default: 0)
  --drill-diameter <mm>         Drill hole diameter (default: 1.0)
  --snap-tolerance <mm>         Max distance to snap trace end → pad (default: 1.5)
  --trace-segments <n>          Circle segments for rounded ends (default: 32)
```

Outputs (named after input file stem):
- `<stem>-pcb.stl`
- `<stem>-press.stl`
- `<stem>-fixed.svg`  (only with --svg)

---

## Dependencies

| Package | Purpose |
|---|---|
| `@xmldom/xmldom` | DOM XML parser |
| `xpath` | Query SVG element tree |
| `@jscad/modeling` | 3D solid modelling (extrude, union, subtract) |
| `@jscad/stl-serializer` | Serialize JSCAD geometry → binary STL |
| `commander` | CLI arg parsing |
| `chalk` | Terminal output |

Dev: `typescript`, `ts-node`, `@types/node`, `vitest`

---

## Key edge cases

| Case | Handling |
|---|---|
| `rotate(-90)` shorthand | Convert to matrix before composing |
| `matrix(0,1,-1,0,0,0)` (90° rotation) | Standard matrix multiply |
| Zero-length trace | Emit a sphere (3D) / circle (SVG) instead |
| Multiple copper layers (copper0 / copper1) | Process both; deduplicate pads within 0.1 SVG units |
| SMD rect pads | Emit filled yellow rect (SVG) / extruded box (STL), no drill |
| Trace stroke-width in `px`/`pt` | Normalise to SVG user units via viewBox DPI |
| Overlapping traces | JSCAD union handles this; no special treatment needed |
| Drill cylinder must clear both board faces | Add 0.1 mm to drill height before subtract |

---

## Testing plan

- **Unit tests** (vitest):
  - `geometry.ts`: known line → expected SVG path string
  - `transform.ts`: compose translate + matrix → expected result; apply to point
  - `pads.ts`: snap with various offsets and tolerances
  - `stlWriter.ts`: simple single-trace board → non-zero STL buffer

- **Integration test**:
  - Input: `PrintedPCB_pcb.svg`
  - SVG output: diff against `PrintedPCB_pcb_fixed.svg` (known-good)
  - STL outputs: load with a mesh library, assert triangle count > 0, bounding
    box matches expected board dimensions

---

## Out of scope (v1)

- Multi-layer boards (front + back copper)
- Curved / arc traces
- Auto-calling a slicer (PrusaSlicer, Cura) after STL generation

---

## Sub-agent and worktree strategy

The modules are largely independent once shared types are defined, making this
project well-suited to parallel development using Claude sub-agents in git
worktrees.

### Model selection

| Task complexity | Model |
|---|---|
| Scaffolding, config files, trivial utilities | `claude-haiku-4-5-20251001` |
| Core modules — parser, geometry, writers | `claude-sonnet-4-6` |
| Complex 3D geometry (stlWriter) | `claude-sonnet-4-6` |
| Integration, review, merge conflicts | `claude-sonnet-4-6` (main agent) |

### Implementation phases

#### Phase 0 — Scaffold (main agent, main branch)
Single agent (Sonnet) sets up the project synchronously because everything
else depends on it:
- `package.json` + `tsconfig.json`
- `src/types.ts` — shared interfaces (`BoardModel`, `Trace`, `Pad`, etc.)
- Empty stub files for all modules with exported function signatures
- Commit: *"chore: project scaffold and shared types"*

The stub signatures act as a contract so all subsequent worktrees can
import from each other's stubs without waiting for full implementations.

#### Phase 1 — Parallel module development (3 worktrees)

Launch three sub-agents simultaneously, each in its own worktree
(`isolation: "worktree"`):

| Worktree | Agent | Modules | Model |
|---|---|---|---|
| `feat/math` | Sonnet | `transform.ts`, `geometry.ts` + their unit tests | sonnet |
| `feat/parser` | Sonnet | `parser.ts`, `pads.ts` + their unit tests | sonnet |
| `feat/writers` | Sonnet | `svgWriter.ts`, `stlWriter.ts` + their unit tests | sonnet |

Each agent is given:
- The full `PLAN.md` as context
- The `types.ts` contract
- Instruction to import from stubs for anything outside its own modules
- Instruction to commit at logical checkpoints (e.g. after each module,
  after tests pass)

#### Phase 2 — Integration (main agent)
Once worktrees are merged into main:
- Main agent implements `cli.ts`
- Runs full integration test against `PrintedPCB_pcb.svg`
- Commits: *"feat: cli entry point"*, *"test: integration test passing"*

#### Phase 3 — Push
`git push origin main`

### Worktree notes

- Worktrees live under `.git/worktrees/` (managed by `isolation: "worktree"`
  on the Task tool)
- Each sub-agent should `git add` and `git commit` regularly — at minimum
  after each module is complete and tests pass
- Sub-agents should **not** push; the main agent handles merging and pushing
- If two worktrees touch the same file (unlikely given clean module boundaries),
  the main agent resolves conflicts manually before merging
