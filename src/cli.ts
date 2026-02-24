#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { parseFritzingSvg } from './parser.js';
import { parseFritzingFz } from './fzParser.js';
import { snapTracesToPads } from './pads.js';
import { buildSvg } from './svgWriter.js';
import { buildStls } from './stlWriter.js';
import { DEFAULT_OPTIONS, type PrinterOptions } from './types.js';

const program = new Command();

program
  .name('pcbprinter')
  .description('Convert Fritzing PCB SVG exports to 3D-printable STL files')
  .argument('<input>', 'Fritzing PCB SVG export (.svg) or project file (.fz)')
  .option('-o, --out-dir <dir>', 'Output directory', DEFAULT_OPTIONS.outDir)
  .option('--svg', 'Also write intermediate SVG', false)
  .option('--board-color <hex>', 'SVG substrate colour', DEFAULT_OPTIONS.boardColor)
  .option('--board-thickness <mm>', 'STL board thickness in mm', String(DEFAULT_OPTIONS.boardThicknessMm))
  .option('--trace-recess <mm>', 'Depth of trace channels in pcb (= bump height on press)', String(DEFAULT_OPTIONS.traceRecessMm))
  .option('--trace-clearance <mm>', 'How much narrower press bumps are vs pcb channels', String(DEFAULT_OPTIONS.traceClearanceMm))
  .option('--bump-chamfer <mm>', 'Chamfer step width at top of press bumps (0 = none)', String(DEFAULT_OPTIONS.bumpChamferMm))
  .option('--press-thickness <mm>', 'Thickness of press backing plate in mm', String(DEFAULT_OPTIONS.pressThicknessMm))
  .option('--drill-diameter <mm>', 'Drill hole diameter in mm', String(DEFAULT_OPTIONS.drillDiameterMm))
  .option('--snap-tolerance <mm>', 'Max distance to snap trace end to pad centre in mm', String(DEFAULT_OPTIONS.snapToleranceMm))
  .option('--trace-segments <n>', 'Circle segments for rounded trace ends', String(DEFAULT_OPTIONS.traceSegments))
  .action(async (inputFile: string, opts) => {
    // Resolve input
    const inputPath = path.resolve(inputFile);
    if (!fs.existsSync(inputPath)) {
      console.error(chalk.red(`Error: file not found: ${inputPath}`));
      process.exit(1);
    }

    const stem = path.basename(inputPath, path.extname(inputPath));
    const outDir = path.resolve(opts.outDir);
    fs.mkdirSync(outDir, { recursive: true });

    const options: PrinterOptions = {
      outDir,
      writeSvg: opts.svg,
      boardColor: opts.boardColor,
      boardThicknessMm: parseFloat(opts.boardThickness),
      traceRecessMm: parseFloat(opts.traceRecess),
      traceClearanceMm: parseFloat(opts.traceClearance),
      bumpChamferMm: parseFloat(opts.bumpChamfer),
      pressThicknessMm: parseFloat(opts.pressThickness),
      drillDiameterMm: parseFloat(opts.drillDiameter),
      snapToleranceMm: parseFloat(opts.snapTolerance),
      traceSegments: parseInt(opts.traceSegments, 10),
    };

    console.log(chalk.cyan(`pcbprinter`) + ` — processing ${chalk.bold(path.basename(inputPath))}`);

    // Parse
    const source = fs.readFileSync(inputPath, 'utf8');
    const ext = path.extname(inputPath).toLowerCase();
    let model;
    try {
      if (ext === '.fz') {
        console.log(chalk.yellow('ℹ') + ` .fz mode — trace positions may differ from SVG export (see README)`);
        model = parseFritzingFz(source);
      } else {
        model = parseFritzingSvg(source, options);
      }
    } catch (err) {
      console.error(chalk.red('Parse error:'), (err as Error).message);
      process.exit(1);
    }
    console.log(chalk.green('✓') + ` parsed — ${model.traces.length} traces, ${model.pads.length} pads`);

    // Snap trace endpoints to pads
    snapTracesToPads(model, options);
    console.log(chalk.green('✓') + ` snapped trace endpoints`);

    // Write SVG if requested
    if (options.writeSvg) {
      const svgOut = path.join(outDir, `${stem}-fixed.svg`);
      fs.writeFileSync(svgOut, buildSvg(model, options), 'utf8');
      console.log(chalk.green('✓') + ` SVG  → ${svgOut}`);
    }

    // Build and write STLs
    let stls;
    try {
      stls = await buildStls(model, options);
    } catch (err) {
      console.error(chalk.red('STL generation error:'), (err as Error).message);
      process.exit(1);
    }

    const pcbPath = path.join(outDir, `${stem}-pcb.stl`);
    const pressPath = path.join(outDir, `${stem}-press.stl`);
    fs.writeFileSync(pcbPath, Buffer.from(stls.pcb));
    fs.writeFileSync(pressPath, Buffer.from(stls.press));

    console.log(chalk.green('✓') + ` pcb      → ${pcbPath}`);
    console.log(chalk.green('✓') + ` press → ${pressPath}`);
    console.log(chalk.bold.green('Done.'));
  });

program.parse();
